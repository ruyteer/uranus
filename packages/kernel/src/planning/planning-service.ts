import type {
  AgentRegistry,
  AgentRuntime,
  BudgetGuard,
  Clock,
  ContextPacker,
  EventBus,
  Logger,
  PlanId,
  PlanRejection,
  ProjectDigest,
  ProjectRef,
  PromptRegistry,
  Provider,
  ProviderRegistry,
  Result,
  Task,
  TaskId,
  TaskQueue,
  TaskRepository,
} from '@uranus/core'
import {
  EMPTY_USAGE,
  ValidationError,
  ZERO_USD,
  err,
  isRestrictedMode,
  newAttemptId,
  newPlanId,
  newTaskId,
  ok,
  transition,
} from '@uranus/core'
import {
  validatePlan,
  type PlanValidationOptions,
  type PlannerOutput,
  type ValidatedPlan,
} from '@uranus/backlog'
import type { StoredBacklogItem } from '@uranus/backlog'

/**
 * Escrita no backlog de projetos vizinhos, vista pelo planejamento
 * (categoria ④).
 *
 * Porta, e não dependência concreta: o kernel não conhece `FileBacklogStore`,
 * nem o `.uranus` alheio, nem a config que autorizou a escrita. Mesmo padrão
 * de `BacklogPort` — a composição liga, o serviço só declara a necessidade.
 *
 * Ausente em `PlanningServiceOptions` ⇒ comportamento anterior a esta
 * categoria, intacto: nenhum vizinho é oferecido ao Planner e qualquer
 * `crossProject` que ele invente é plano rejeitado.
 */
export interface CrossProjectBacklog {
  /**
   * Vizinhos onde este projeto pode criar itens (`backlogWrite: true`).
   * Alimenta o prompt do Planner E a lista de aliases aceitos pelo validador —
   * a MESMA lista nos dois lados, ou o Planner receberia uma oferta que o
   * validador recusa.
   */
  writableProjects(): readonly { readonly alias: string; readonly description?: string }[]
  /**
   * Cria o item no vizinho. A IMPLEMENTAÇÃO é idempotente por `externalRef`
   * (`created: false` quando o item já existia) e garante que o arquivo
   * escrito fica dentro da raiz declarada do vizinho.
   */
  create(input: {
    readonly project: string
    readonly title: string
    readonly intent: string
    readonly kind?: string
    readonly originProjectName: string
    readonly originItemId: string
  }): Promise<Result<{ readonly itemId: string; readonly created: boolean }>>
}

export interface PlanningServiceOptions {
  readonly project: ProjectRef
  readonly agents: AgentRegistry
  readonly agentRuntime: AgentRuntime
  readonly providers: ProviderRegistry
  readonly context: ContextPacker
  readonly queue: TaskQueue
  readonly tasks: TaskRepository
  readonly events: EventBus
  readonly clock: Clock
  readonly logger: Logger
  /** Opcional: usado para renderizar o contexto de replanejamento. */
  readonly prompts?: PromptRegistry
  readonly providerId: string
  readonly contextBudgetTokens: number
  readonly allowedPaths: readonly string[]
  readonly forbiddenPaths: readonly string[]
  readonly allowedCommands: readonly string[]
  readonly maxTasksPerPlan: number
  readonly maxAttemptsPerTask: number
  /**
   * Runners de teste ensinados por plugins, além do detectado no digest.
   *
   * Supplier em vez de lista fixa porque plugins podem ativar depois desta
   * construção; e sem isto o validador rejeitaria um plano que cita `vitest`
   * num projeto onde o plugin `node` acabou de registrar exatamente esse runner.
   */
  readonly extraTestRunners?: () => readonly string[]
  /** Tentativas de planejamento antes de devolver o item ao humano. */
  readonly maxPlanningAttempts: number
  /**
   * Orçamento do run. O Planner é uma sessão de modelo como qualquer outra e
   * precisa entrar no INV-7 — inclusive quando o plano é rejeitado, porque a
   * tentativa rejeitada custou igual.
   */
  readonly budget?: BudgetGuard
  /**
   * Backlog de projetos vizinhos. Ausente ⇒ o Planner nem fica sabendo que
   * existem vizinhos graváveis, e nada é escrito fora deste projeto.
   */
  readonly crossProject?: CrossProjectBacklog
}

export interface PlanningResult {
  readonly planId: PlanId
  readonly created: readonly Task[]
  readonly summary: string
  /**
   * Itens criados no backlog de vizinhos. NÃO são tasks deste projeto e nunca
   * aparecem em `created` — quem os executa é o `uranus start` de lá.
   */
  readonly crossProject: readonly CrossProjectOutcome[]
}

export interface CrossProjectOutcome {
  readonly project: string
  readonly itemId: string
  readonly title: string
  /** `false` quando o item já existia no vizinho (replanejamento do mesmo item). */
  readonly created: boolean
}

/**
 * Planejamento: item de backlog em prosa → tasks na fila.
 *
 * O ponto inteiro deste serviço é a assimetria: o modelo propõe, o validador
 * dispõe. Um plano rejeitado emite `PlanRejected` e volta ao Planner com os
 * problemas concretos — no máximo `maxPlanningAttempts` vezes. Depois disso o
 * item volta para o humano, porque insistir custa dinheiro sem convergir.
 *
 * Nenhum worktree é criado aqui. O Planner é somente-leitura e roda direto na
 * raiz do repositório: um plano ruim não deixa rastro nenhum no disco.
 */
export class PlanningService {
  constructor(private readonly options: PlanningServiceOptions) {}

  async planItem(
    item: StoredBacklogItem,
    digest: ProjectDigest | undefined,
    signal: AbortSignal,
  ): Promise<Result<PlanningResult>> {
    // Item real do backlog: as tasks nascem atreladas a ele (§1).
    return this.planFor(item, digest, signal, item.id)
  }

  /**
   * Núcleo do planejamento, com o vínculo de backlog explícito.
   *
   * `backlogItemId` é parâmetro em vez de `item.id` porque o replanejamento
   * fabrica um item sintético (`replan-<taskId>`) que não existe em store
   * nenhum — gravar esse id nas tasks criaria um vínculo para um item
   * inexistente, e o item de verdade (o da task original) perderia as filhas
   * da contagem e nunca fecharia.
   */
  private async planFor(
    item: StoredBacklogItem,
    digest: ProjectDigest | undefined,
    signal: AbortSignal,
    backlogItemId: string | undefined,
  ): Promise<Result<PlanningResult>> {
    const { logger, events, clock } = this.options

    const spec = this.options.agents.get('planner')
    if (spec === undefined) {
      return err(new ValidationError('Agente "planner" não registrado.'))
    }
    const provider = this.options.providers.resolve({
      agent: spec.name,
      ...(spec.model?.tier === undefined ? {} : { tier: spec.model.tier }),
      capabilities: spec.requires ?? {},
    })
    if (!provider.ok) return err(provider.error)

    const validationOptions = this.validationOptions(digest)
    let rejections: readonly PlanRejection[] = []

    for (let attempt = 1; attempt <= this.options.maxPlanningAttempts; attempt++) {
      if (signal.aborted) break

      const output = await this.runPlanner(
        item,
        provider.value,
        digest,
        rejections,
        attempt,
        signal,
      )
      if (!output.ok) return err(output.error)

      const validated = validatePlan(output.value, validationOptions)
      if (validated.ok) {
        // Os vizinhos ANTES da fila local, de propósito: se a escrita no outro
        // projeto falhar, nada foi enfileirado aqui e o item continua `open`
        // para uma nova tentativa. O contrário deixaria metade do plano em
        // produção e a outra metade perdida — e a criação lá é idempotente,
        // então retentar é seguro.
        //
        // A origem é o item REAL (`backlogItemId`), não o sintético do
        // replanejamento: é ele que mantém o `externalRef` estável, e portanto
        // é ele que impede o vizinho de ganhar uma cópia por replanejamento.
        const crossProject = await this.dispatchCrossProject(
          validated.value,
          backlogItemId ?? item.id,
        )
        if (!crossProject.ok) return err(crossProject.error)

        const created = await this.materialize(item, validated.value, clock.now(), backlogItemId)
        if (!created.ok) return err(created.error)

        const planId = newPlanId(clock.now())
        await events.emit('PlanCreated', {
          planId,
          sourceItemId: item.id,
          tasks: created.value.length,
        })
        logger.info('Plano aceito', {
          item: item.id,
          tasks: created.value.length,
          crossProject: crossProject.value.length,
          attempt,
        })
        return ok({
          planId,
          created: created.value,
          summary: validated.value.summary,
          crossProject: crossProject.value,
        })
      }

      rejections = validated.error
      await events.emit('PlanRejected', { sourceItemId: item.id, rejections })
      logger.warn('Plano rejeitado pelo validador', {
        item: item.id,
        attempt,
        problems: rejections.map((rejection) => rejection.message),
      })
    }

    return err(
      new ValidationError(
        `O Planner não produziu um plano válido em ${String(this.options.maxPlanningAttempts)} tentativas.`,
        { context: { itemId: item.id, rejections: rejections.map((r) => r.message) } },
      ),
    )
  }

  /**
   * Replanejamento de uma task que falhou repetidamente (`draft`).
   *
   * Trata a task como um item de backlog: o diagnóstico das tentativas entra
   * como contexto, e as tasks novas substituem a original. É o que fecha o
   * caminho `failed → draft → ready` que a Fase 2 deixou em aberto.
   */
  async replanTask(
    task: Task,
    digest: ProjectDigest | undefined,
    signal: AbortSignal,
  ): Promise<Result<PlanningResult>> {
    const attempts = await this.options.tasks.find(task.id)
    void attempts

    const asItem: StoredBacklogItem = {
      id: `replan-${task.id}`,
      projectId: task.projectId,
      title: task.title,
      body: [
        task.intent,
        '',
        'Esta tarefa já falhou repetidamente na verificação e foi devolvida para replanejamento.',
        'Decomponha em passos menores e verificáveis, ou reformule a abordagem.',
      ].join('\n'),
      labels: [...task.labels, 'replanejada'],
      priority: task.priority,
      source: 'manual',
      createdAt: task.createdAt,
      state: 'open',
    }

    // As tasks novas substituem a original — e herdam o item de backlog dela,
    // se houver. Uma decomposição não muda de dono.
    const result = await this.planFor(asItem, digest, signal, task.backlogItemId)
    if (result.ok) {
      // A task original sai de cena: foi substituída pelas novas. Via
      // `transition` para que a mudança passe pela mesma validação de sempre.
      const abandoned = transition(task, 'abandoned', { at: this.options.clock.now() })
      if (abandoned.ok) {
        await this.options.queue.update(abandoned.value)
        await this.options.events.emit('TaskAbandoned', {
          taskId: task.id,
          reason: `substituída por ${String(result.value.created.length)} tasks do replanejamento`,
        })
      }
    }
    return result
  }

  // ── Interno ───────────────────────────────────────────────────────────────

  /** Runners que um plano pode citar: o do digest mais os de plugins. */
  private knownRunners(digest: ProjectDigest | undefined): readonly string[] {
    return [
      ...new Set([
        ...(digest?.tests.runner === undefined ? [] : [digest.tests.runner]),
        ...(this.options.extraTestRunners?.() ?? []),
      ]),
    ]
  }

  /** Vizinhos graváveis. Sem porta injetada, a lista é vazia — nunca `undefined`. */
  private writableProjects(): readonly { readonly alias: string; readonly description?: string }[] {
    return this.options.crossProject?.writableProjects() ?? []
  }

  private validationOptions(digest: ProjectDigest | undefined): PlanValidationOptions {
    return {
      allowedPaths: this.options.allowedPaths,
      forbiddenPaths: this.options.forbiddenPaths,
      knownTestRunners: this.knownRunners(digest),
      allowedCommands: this.options.allowedCommands,
      maxTasks: this.options.maxTasksPerPlan,
      restrictedMode: digest !== undefined && isRestrictedMode(digest),
      // A mesma lista que foi oferecida ao Planner no prompt. Ler os aliases
      // de outra fonte abriria a porta para o validador aceitar um vizinho que
      // o prompt não ofereceu, ou recusar um que ofereceu.
      writableProjects: this.writableProjects().map((neighbor) => neighbor.alias),
    }
  }

  /**
   * Leva ao vizinho o que o plano declarou para ele.
   *
   * Nenhum destes vira task na fila deste projeto — o trabalho é do outro
   * lado, e quem decompõe é o Planner de lá quando o `uranus start` dele
   * rodar. Uma falha aqui aborta o plano inteiro: "planejei" com metade do
   * trabalho no vazio é pior do que não ter planejado.
   */
  private async dispatchCrossProject(
    plan: ValidatedPlan,
    originItemId: string,
  ): Promise<Result<readonly CrossProjectOutcome[]>> {
    if (plan.crossProject.length === 0) return ok([])

    const port = this.options.crossProject
    if (port === undefined) {
      // Inalcançável: sem porta, `writableProjects` é vazio e o validador já
      // rejeitou. Guarda contra regressão, no espírito de `toDraft`.
      return err(
        new ValidationError(
          'O plano declarou trabalho em projetos vizinhos, mas não há backlog cross-project configurado.',
        ),
      )
    }

    const outcomes: CrossProjectOutcome[] = []
    for (const wanted of plan.crossProject) {
      const created = await port.create({
        project: wanted.project,
        title: wanted.title,
        intent: wanted.intent,
        ...(wanted.kind === undefined ? {} : { kind: wanted.kind }),
        originProjectName: this.options.project.name,
        originItemId,
      })
      if (!created.ok) return err(created.error)

      outcomes.push({
        project: wanted.project,
        itemId: created.value.itemId,
        title: wanted.title,
        created: created.value.created,
      })
      // Só o que de fato nasceu vira fato no log: reemitir a cada
      // replanejamento faria o log contar N criações de um item que existe uma
      // vez só.
      if (created.value.created) {
        await this.options.events.emit('CrossProjectItemCreated', {
          project: wanted.project,
          itemId: created.value.itemId,
          originItemId,
          title: wanted.title,
        })
      }
    }
    return ok(outcomes)
  }

  /** Bloco de vizinhos para o prompt. Vazio quando não há nenhum gravável. */
  private renderCrossProjects(): string {
    const neighbors = this.writableProjects()
    if (neighbors.length === 0) return ''

    const projects = neighbors
      .map(
        (neighbor) =>
          `- \`${neighbor.alias}\`${neighbor.description === undefined ? '' : ` — ${neighbor.description}`}`,
      )
      .join('\n')
    const rendered = this.options.prompts?.render('planner/cross-project@1', { projects })
    if (rendered?.ok === true) return rendered.value
    // Sem registry injetado, a lista crua ainda é melhor que silêncio: o campo
    // existe no schema de qualquer jeito, e sem os aliases o Planner só
    // conseguiria chutar nomes que o validador recusa.
    return `## Projetos vizinhos onde você PODE criar trabalho (campo "crossProject")\n\n${projects}`
  }

  private async runPlanner(
    item: StoredBacklogItem,
    provider: Provider,
    digest: ProjectDigest | undefined,
    rejections: readonly PlanRejection[],
    attemptNumber: number,
    signal: AbortSignal,
  ): Promise<Result<PlannerOutput>> {
    const spec = this.options.agents.get('planner')!
    const now = this.options.clock.now()

    // Task sintética: o Planner precisa de um `Task` para o runtime, mas ela
    // nunca entra na fila nem é persistida — é o veículo do prompt.
    const syntheticTask: Task = {
      id: newTaskId(now),
      projectId: this.options.project.id,
      kind: 'investigation',
      title: item.title,
      intent: item.body,
      state: 'running',
      priority: item.priority,
      deps: [],
      touches: [],
      acceptance: spec.successCriteria,
      attempts: attemptNumber,
      maxAttempts: this.options.maxPlanningAttempts,
      repairAttempts: 0,
      labels: [...item.labels],
      createdAt: now,
      updatedAt: now,
    }

    const contextPack = await this.options.context.pack(
      {
        budgetTokens: this.options.contextBudgetTokens,
        sectionBudgets: { digest: 0.25, memory: 0.35, doc: 0.2, task: 0.2 },
        agent: spec,
        task: syntheticTask,
        project: this.options.project,
        mustInclude: ['digest:summary'],
        hints: [item.title, ...item.labels],
      },
      signal,
    )

    // Render estrito (ver `DefaultPromptRegistry`): toda variável do template
    // precisa ser fornecida. É o que garante que o Planner nunca receba um
    // `{{replanContext}}` silenciosamente vazio depois de uma rejeição.
    const promptVariables: Record<string, string> = {
      title: item.title,
      body: item.body,
      testRunners:
        this.knownRunners(digest).join(', ') ||
        'nenhum runner detectado — só tarefas de teste são aceitas',
      testCommand: digest?.tests.command ?? '(não detectado)',
      allowedPaths: this.options.allowedPaths.join(', '),
      crossProjects: this.renderCrossProjects(),
      replanContext: rejections.length === 0 ? '' : this.renderRejections(rejections),
    }

    const output = await this.options.agentRuntime.run(
      spec,
      {
        promptVariables,
        task: syntheticTask,
        attempt: {
          id: newAttemptId(now),
          taskId: syntheticTask.id,
          n: attemptNumber,
          agent: spec.name,
          provider: provider.id,
          model: 'default',
          contextDigest: contextPack.digest,
          workspaceId: 'wsp_planner' as never,
          startedAt: now,
          usage: EMPTY_USAGE,
          cost: ZERO_USD,
        },
        // O Planner é somente-leitura: trabalha na raiz, sem worktree.
        workspace: {
          id: 'wsp_planner' as never,
          rootDir: this.options.project.rootDir,
          branch: '(read-only)',
          baseCommit: '',
          ownedPaths: [],
          createdAt: now,
        },
        context: contextPack,
        provider,
        logger: this.options.logger.child({ agent: 'planner', item: item.id }),
      },
      signal,
    )

    // Antes de qualquer saída de erro: a tentativa de planejamento gastou
    // tokens mesmo quando o plano é inútil, e é assim que ela entra no INV-7.
    this.options.budget?.consume({
      usage: output.usage,
      cost: output.cost,
      wallclockMs: Math.max(0, this.options.clock.now() - now),
    })

    if (output.structured === undefined) {
      return err(
        new ValidationError('O Planner não produziu saída estruturada.', {
          context: { itemId: item.id, summary: output.summary.slice(0, 300) },
        }),
      )
    }

    return ok(output.structured as PlannerOutput)
  }

  private renderRejections(rejections: readonly PlanRejection[]): string {
    const rendered = this.options.prompts?.render('planner/replan-context@1', {
      rejections: formatRejections(rejections),
    })
    if (rendered?.ok === true) return rendered.value
    // Sem registry de prompts injetado, ainda entregamos os problemas crus —
    // um replanejamento sem o motivo da rejeição é um replanejamento cego.
    return `## Tentativa anterior rejeitada\n\n${formatRejections(rejections)}`
  }

  private async materialize(
    item: StoredBacklogItem,
    plan: ValidatedPlan,
    now: number,
    backlogItemId: string | undefined,
  ): Promise<Result<readonly Task[]>> {
    const planId = newPlanId(now)
    const idByRef = new Map<string, TaskId>()
    const created: Task[] = []

    // Ordem topológica garante que a dependência já tem id quando o dependente
    // é criado — por isso o validador devolve `drafts` ordenado.
    for (let index = 0; index < plan.drafts.length; index++) {
      const draft = plan.drafts[index]!
      const ref = plan.refOrder[index]!
      const id = newTaskId(now + index)
      idByRef.set(ref, id)

      const deps = (plan.dependencies[ref] ?? [])
        .map((dependencyRef) => idByRef.get(dependencyRef))
        .filter((dependencyId): dependencyId is TaskId => dependencyId !== undefined)

      const task: Task = {
        id,
        projectId: this.options.project.id,
        planId,
        // Link reverso direto para o item (§1). Descobrir "de que item veio
        // esta task" pelo `planId` exigiria varrer o backlog inteiro, e um
        // replanejamento troca o `planId` — o id do item é o estável.
        ...(backlogItemId === undefined ? {} : { backlogItemId }),
        kind: draft.kind,
        title: draft.title,
        intent: draft.intent,
        state: 'ready',
        priority: item.priority,
        deps,
        touches: draft.touches,
        acceptance: draft.acceptance,
        attempts: 0,
        maxAttempts: draft.maxAttempts ?? this.options.maxAttemptsPerTask,
        repairAttempts: 0,
        labels: [...(draft.labels ?? []), ...item.labels],
        createdAt: now,
        updatedAt: now,
      }

      const queued = await this.options.queue.enqueue(task)
      if (!queued.ok) return err(queued.error)

      await this.options.events.emit('TaskCreated', {
        taskId: task.id,
        kind: task.kind,
        title: task.title,
        planId,
      })
      created.push(task)
    }

    return ok(created)
  }
}

/** Formata rejeições para o prompt de replanejamento. */
export function formatRejections(rejections: readonly PlanRejection[]): string {
  return rejections
    .map((rejection) => {
      const where =
        rejection.taskIndex === undefined ? '' : ` (task #${String(rejection.taskIndex + 1)})`
      return `- [${rejection.code}]${where} ${rejection.message}`
    })
    .join('\n')
}
