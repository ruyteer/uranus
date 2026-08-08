import type {
  AgentRegistry,
  AgentRuntime,
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
  /** Tentativas de planejamento antes de devolver o item ao humano. */
  readonly maxPlanningAttempts: number
}

export interface PlanningResult {
  readonly planId: PlanId
  readonly created: readonly Task[]
  readonly summary: string
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
        const created = await this.materialize(item, validated.value, clock.now())
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
          attempt,
        })
        return ok({ planId, created: created.value, summary: validated.value.summary })
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

    const result = await this.planItem(asItem, digest, signal)
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

  private validationOptions(digest: ProjectDigest | undefined): PlanValidationOptions {
    const runners = digest?.tests.runner === undefined ? [] : [digest.tests.runner]
    return {
      allowedPaths: this.options.allowedPaths,
      forbiddenPaths: this.options.forbiddenPaths,
      knownTestRunners: runners,
      allowedCommands: this.options.allowedCommands,
      maxTasks: this.options.maxTasksPerPlan,
      restrictedMode: digest !== undefined && isRestrictedMode(digest),
    }
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
        digest?.tests.runner ?? 'nenhum runner detectado — só tarefas de teste são aceitas',
      testCommand: digest?.tests.command ?? '(não detectado)',
      allowedPaths: this.options.allowedPaths.join(', '),
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
