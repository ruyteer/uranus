import type {
  AgentOutput,
  AgentRegistry,
  AgentRunContext,
  AgentRuntime,
  AgentSpec,
  Check,
  EventBus,
  Logger,
  PermissionSet,
  PromptRegistry,
  SessionRequest,
} from '@uranus/core'
import { ProviderError, intersectPermissions, unwrap } from '@uranus/core'

export interface DefaultAgentRuntimeOptions {
  readonly prompts: PromptRegistry
  readonly registry: AgentRegistry
  readonly logger: Logger
  /**
   * Opcional, mas é o que torna o custo por agente observável.
   *
   * Este é o único ponto do sistema por onde passa **toda** execução de agente
   * — Executor, Planner e cada gate de qualidade. Emitir daqui significa que
   * nenhum gasto fica invisível; emitir de cada chamador significaria descobrir
   * um esquecido só quando a fatura não fechasse.
   */
  readonly events?: EventBus
}

/**
 * Runtime único para todos os agentes (ADR-008).
 *
 * O fluxo é fixo: renderizar prompts → montar `SessionRequest` → rodar a sessão
 * do provider → normalizar em `AgentOutput`. Especialização vem da spec e dos
 * hooks — nunca de um runtime alternativo.
 */
export class DefaultAgentRuntime implements AgentRuntime {
  private readonly prompts: PromptRegistry
  private readonly registry: AgentRegistry
  private readonly logger: Logger
  private readonly events: EventBus | undefined

  constructor(options: DefaultAgentRuntimeOptions) {
    this.prompts = options.prompts
    this.registry = options.registry
    this.logger = options.logger.child({ component: 'agent-runtime' })
    this.events = options.events
  }

  async run(spec: AgentSpec, context: AgentRunContext, signal: AbortSignal): Promise<AgentOutput> {
    const hooks = this.registry.hooks(spec.name)
    const prepared = hooks?.beforeRun !== undefined ? await hooks.beforeRun(context) : context

    const request = this.buildRequest(spec, prepared)
    const session = await prepared.provider.createSession(request, signal)

    await this.events?.emit(
      'AgentRunStarted',
      {
        sessionId: session.id,
        attemptId: prepared.attempt.id,
        agent: spec.name,
        provider: prepared.provider.id,
        model: request.model ?? prepared.attempt.model,
        contextDigest: prepared.context.digest,
      },
      { actor: { type: 'agent', name: spec.name }, taskId: prepared.task.id },
    )

    // Drena o stream (eventos de progresso vão para log; o resultado é o que conta).
    for await (const event of session.stream()) {
      if (event.type === 'warning') {
        this.logger.warn('Aviso do provider', { message: event.message })
      }
      if (event.type === 'error') {
        this.logger.error('Erro do provider durante a sessão', { error: event.error })
      }
      if (signal.aborted) {
        await session.interrupt('abortado pelo kernel')
        break
      }
    }

    const result = await session.result()

    // Emitido ANTES do short-circuit de erro abaixo, de propósito: uma sessão
    // que morreu no meio já queimou tokens, e não contabilizá-los seria a
    // fatura vindo maior que o relatado exatamente no caso ruim.
    await this.events?.emit(
      'AgentRunFinished',
      {
        sessionId: session.id,
        status: result.status,
        turns: result.turns,
        usage: result.usage,
        cost: result.cost,
      },
      { actor: { type: 'agent', name: spec.name }, taskId: prepared.task.id },
    )

    // Sessão que morreu (auth, rede, limite) NÃO segue para verificação: o
    // workspace intocado produziria "diff vazio" e enterraria a causa real.
    // O texto do provider ("Not logged in · Please run /login", etc.) é o
    // diagnóstico — ele sobe no erro e chega ao blockReason da task.
    if (result.status === 'error' || result.status === 'limit_reached') {
      throw new ProviderError(
        `Sessão do provider terminou com "${result.status}": ${result.text.slice(0, 500)}`,
        {
          context: {
            status: result.status,
            usage: result.usage,
            costMicros: result.cost.micros,
          },
        },
      )
    }

    if (hooks?.afterRun !== undefined) {
      return hooks.afterRun(prepared, result)
    }
    return {
      summary: result.text.slice(0, 2_000),
      memoryDrafts: [],
      followUps: [],
      usage: result.usage,
      cost: result.cost,
      ...(result.structured === undefined ? {} : { structured: result.structured }),
    }
  }

  buildRequest(spec: AgentSpec, context: AgentRunContext): SessionRequest {
    const { task, workspace } = context

    const system = unwrap(this.prompts.render(spec.prompts.system, {}))
    // Variáveis derivadas da task + as fornecidas pelo chamador (que vencem).
    const instruction = unwrap(
      this.prompts.render(spec.prompts.instruction, {
        title: task.title,
        intent: task.intent,
        touches: task.touches.join('\n'),
        acceptance: describeContract(task.acceptance.checks),
        failureContext: renderFailureContext(this.prompts, context),
        ...context.promptVariables,
      }),
    )

    return {
      systemPrompt: system,
      instruction,
      context: context.context,
      tools: [],
      workdir: workspace.rootDir,
      permissions: effectivePermissions(spec, task.touches),
      limits: spec.limits,
      ...(spec.outputs.schema === undefined ? {} : { outputSchema: spec.outputs.schema }),
      metadata: {
        taskId: task.id,
        attemptId: context.attempt.id,
        agent: spec.name,
      },
    }
  }
}

/**
 * Permissões efetivas da sessão: as da spec **intersectadas** com o escopo da
 * task. O agente pode ter `fs.write: ['**']`, mas a task só declara `touches`
 * de `src/api/**` — a sessão só escreve ali (INV-5).
 */
export function effectivePermissions(spec: AgentSpec, touches: readonly string[]): PermissionSet {
  const taskScope: PermissionSet = {
    tools: { allow: ['*'], deny: [] },
    fs: {
      read: ['**'],
      // O escopo da task + arquivos de teste (implementar sem testar reprova).
      write: [...touches, '**/*.test.*', '**/*.spec.*', 'URANUS_BLOCKED.md'],
      deny: [],
    },
    network: { allow: ['*'] },
    exec: { allow: ['*'] },
    secrets: { allow: ['*'] },
  }
  return intersectPermissions(spec.permissions, taskScope)
}

function describeContract(checks: readonly Check[]): string {
  return checks
    .map((check) => {
      switch (check.kind) {
        case 'command':
          return `- comando: \`${check.run}\` deve sair com código ${String(check.expectExit ?? 0)}`
        case 'tests':
          return `- testes (${check.runner}) devem passar${check.requireNewTests === true ? ', incluindo ao menos um teste novo/alterado' : ''}`
        case 'diff':
          return `- o diff deve ${check.requireNonEmpty === true ? 'ser não-vazio e ' : ''}ficar dentro do escopo declarado`
        case 'coverage':
          return `- cobertura mínima de ${String(Math.round(check.min * 100))}% (${check.scope})`
        case 'artifact':
          return `- o arquivo \`${check.path}\` deve ${check.mustExist ? 'existir' : 'não existir'}${check.matches === undefined ? '' : ` e casar com /${check.matches}/`}`
        case 'schema':
          return '- a saída estruturada deve validar contra o schema fornecido'
        case 'plugin':
          return `- check de plugin: ${check.check}`
      }
    })
    .join('\n')
}

function renderFailureContext(prompts: PromptRegistry, context: AgentRunContext): string {
  const diagnosis = context.attempt.outcome?.diagnosis
  if (diagnosis === undefined) return ''
  const rendered = prompts.render('executor/failure-context@1', {
    attemptNumber: String(context.attempt.n - 1),
    category: diagnosis.category,
    summary: diagnosis.summary,
    evidence: diagnosis.evidence.map((e) => `[${e.kind} ${e.ref}]\n${e.excerpt}`).join('\n\n'),
  })
  return rendered.ok ? rendered.value : ''
}
