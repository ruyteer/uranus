import type {
  AgentRegistry,
  AgentRuntime,
  BudgetGuard,
  Clock,
  ContextPacker,
  DiffSummary,
  EventBus,
  Finding,
  FindingsOutput,
  GateOutcome,
  GatePolicy,
  GateReport,
  Logger,
  ProjectRef,
  ProviderRegistry,
  SpawnableFinding,
  Task,
  TaskDraft,
  Workspace,
} from '@uranus/core'
import {
  EMPTY_USAGE,
  ZERO_USD,
  applyGatePolicy,
  effectiveContextBudget,
  explainContextClamp,
  findingTouches,
  followUpFindings,
  newAttemptId,
  severityRank,
  taskGeneration,
  taskRoot,
} from '@uranus/core'

export interface GateDefinition {
  /** Nome do agente registrado (`reviewer`, `security`, `qa`). */
  readonly agent: string
  /** Gate desligado não roda; permite ligar QA só onde faz sentido. */
  readonly enabled: boolean
  /** Política própria; sem ela, vale a do pipeline. */
  readonly policy?: GatePolicy
}

export interface GatePipelineOptions {
  readonly project: ProjectRef
  readonly agents: AgentRegistry
  readonly agentRuntime: AgentRuntime
  readonly providers: ProviderRegistry
  readonly context: ContextPacker
  readonly events: EventBus
  readonly clock: Clock
  readonly logger: Logger
  readonly providerId: string
  readonly contextBudgetTokens: number
  readonly gates: readonly GateDefinition[]
  readonly policy: GatePolicy
  /**
   * Orçamento do run.
   *
   * Sem isto, a cadeia de qualidade gastava fora do INV-7: cada gate é uma
   * sessão de modelo, e um limite de custo que ignora dois terços do gasto não
   * é um limite. É opcional apenas para não quebrar chamadores antigos — a
   * composição sempre injeta.
   */
  readonly budget?: BudgetGuard
}

/**
 * Cadeia de qualidade: `Verifier(código) → Reviewer → Security → [QA] → PR`.
 *
 * Três decisões que valem explicação:
 *
 * 1. **Roda depois da verificação por código**, nunca antes. Gastar uma sessão
 *    de modelo revisando código que não compila é desperdício puro — e o
 *    Verifier é mais barato e mais confiável para essa pergunta.
 *
 * 2. **Curto-circuito no primeiro bloqueio.** Se o Reviewer já barrou, rodar o
 *    Security custa dinheiro para descobrir o que não muda a decisão. Os gates
 *    seguintes são pulados e registrados como tal.
 *
 * 3. **O agente relata, o harness decide** (INV-1). `applyGatePolicy` é função
 *    pura: mesma lista de findings, mesma decisão, sempre.
 */
export class GatePipeline {
  constructor(private readonly options: GatePipelineOptions) {}

  async run(
    task: Task,
    workspace: Workspace,
    diff: DiffSummary,
    signal: AbortSignal,
  ): Promise<GateOutcome> {
    const reports: GateReport[] = []
    let blocked = false

    for (const gate of this.options.gates) {
      if (!gate.enabled) continue
      if (signal.aborted) break

      if (blocked) {
        this.options.logger.debug('Gate pulado: bloqueio anterior já decidiu', {
          gate: gate.agent,
          taskId: task.id,
        })
        continue
      }

      const report = await this.runGate(gate, task, workspace, diff, signal)
      if (report === undefined) continue
      reports.push(report)

      for (const finding of report.findings) {
        await this.emitFinding(gate.agent, task, finding)
      }
      await this.options.events.emit('ReviewCompleted', {
        taskId: task.id,
        verdict: report.blocked ? 'blocked' : 'passed',
        findings: report.findings.length,
        blocking: report.blockingFindings.length,
      })

      if (report.blocked) blocked = true
    }

    const followUps = reports.flatMap((report) => followUpFindings(report, this.options.policy))

    return { taskId: task.id, reports, blocked, followUps }
  }

  private async runGate(
    gate: GateDefinition,
    task: Task,
    workspace: Workspace,
    diff: DiffSummary,
    signal: AbortSignal,
  ): Promise<GateReport | undefined> {
    const spec = this.options.agents.get(gate.agent)
    if (spec === undefined) {
      this.options.logger.warn('Gate configurado mas agente não registrado; pulado', {
        gate: gate.agent,
      })
      return undefined
    }

    // Roteia pelo NOME DO GATE: é aqui que um modelo local barato entra sem
    // que o Executor deixe de usar o modelo forte. Sem `preferred` — ver a
    // nota em `UranusKernel.admit`.
    const provider = this.options.providers.resolve({
      agent: spec.name,
      ...(spec.model?.tier === undefined ? {} : { tier: spec.model.tier }),
      capabilities: spec.requires ?? {},
    })
    if (!provider.ok) {
      this.options.logger.warn('Nenhum provider satisfaz o gate; pulado', {
        gate: gate.agent,
        error: provider.error.message,
      })
      return undefined
    }

    const started = this.options.clock.monotonic()
    const now = this.options.clock.now()

    // Mesmo motivo do Executor: o gate roda no provider dele, e é a janela
    // DESSE provider que manda. É aqui que o híbrido (Claude no Executor,
    // modelo local nos gates) para de truncar em silêncio.
    const budget = effectiveContextBudget(
      this.options.contextBudgetTokens,
      provider.value.capabilities.maxContextTokens,
    )
    if (budget.clamped) {
      this.options.logger.warn(explainContextClamp(budget, provider.value.id), {
        gate: gate.agent,
        taskId: task.id,
      })
    }

    const contextPack = await this.options.context.pack(
      {
        budgetTokens: budget.tokens,
        sectionBudgets: { digest: 0.1, memory: 0.35, code: 0.35, task: 0.2 },
        agent: spec,
        task,
        project: this.options.project,
        mustInclude: [],
        hints: [gate.agent, ...task.labels],
      },
      signal,
    )

    let output
    try {
      output = await this.options.agentRuntime.run(
        spec,
        {
          task,
          attempt: {
            id: newAttemptId(now),
            taskId: task.id,
            n: 1,
            agent: spec.name,
            provider: provider.value.id,
            model: 'default',
            contextDigest: contextPack.digest,
            workspaceId: workspace.id,
            startedAt: now,
            usage: EMPTY_USAGE,
            cost: ZERO_USD,
          },
          workspace,
          context: contextPack,
          provider: provider.value,
          logger: this.options.logger.child({ gate: gate.agent, taskId: task.id }),
          promptVariables: {
            diff: renderDiff(diff),
            conventions: '', // preenchido pelo pack de memória
          },
        },
        signal,
      )
    } catch (error: unknown) {
      // Gate que falha por infra NÃO bloqueia a integração: o sinal de
      // qualidade é opcional; o sinal de correção (Verifier) já passou. Mas
      // fica registrado — um gate silenciosamente quebrado é pior que ausente.
      this.options.logger.error('Gate falhou; integração segue sem ele', {
        gate: gate.agent,
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error),
      })
      return undefined
    }

    // Custo do gate entra no orçamento e na contabilidade. Um gate é uma
    // sessão de modelo como qualquer outra.
    this.options.budget?.consume({
      usage: output.usage,
      cost: output.cost,
      wallclockMs: Math.round(this.options.clock.monotonic() - started),
    })

    const findings = extractFindings(output.structured, gate.agent)
    return applyGatePolicy(
      gate.agent,
      findings,
      gate.policy ?? this.options.policy,
      Math.round(this.options.clock.monotonic() - started),
    )
  }

  private async emitFinding(agent: string, task: Task, finding: Finding): Promise<void> {
    if (agent === 'security') {
      await this.options.events.emit('SecurityFindingRaised', {
        taskId: task.id,
        title: finding.title,
        severity: finding.severity,
        ...(finding.file === undefined ? {} : { path: finding.file }),
      })
    } else {
      await this.options.events.emit('BugDetected', {
        taskId: task.id,
        title: finding.title,
        severity: finding.severity,
        evidence: finding.detail.slice(0, 500),
      })
    }
  }
}

/**
 * Converte findings já aprovados pela política em tasks de correção.
 *
 * Bloqueantes viram tasks urgentes com dependência implícita (a task original
 * volta a falhar); não-bloqueantes viram trabalho normal na fila. Em ambos os
 * casos o contrato de aceite é herdado da task original — o INV-2 não afrouxa
 * porque o trabalho nasceu de um finding.
 *
 * A entrada é `SpawnableFinding`, não `Finding`: quem chega aqui já passou por
 * `planFollowUps`. Isso é de propósito — o tipo impede que um caminho novo
 * enfileire achados crus sem passar pelos cortes de geração, categoria,
 * duplicata e orçamento.
 */
export function findingsToTaskDrafts(
  spawnable: readonly SpawnableFinding[],
  origin: Task,
  agent: string,
): readonly TaskDraft[] {
  const lineageBase = {
    rootTaskId: taskRoot(origin),
    parentTaskId: origin.id,
    generation: taskGeneration(origin) + 1,
    raisedBy: agent,
  }

  return spawnable.map(({ finding, fingerprint }) => ({
    kind: agent === 'security' ? ('security' as const) : ('bugfix' as const),
    title: `${finding.category}: ${finding.title}`.slice(0, 120),
    intent: [
      finding.detail,
      '',
      finding.suggestion === undefined ? '' : `Correção sugerida: ${finding.suggestion}`,
      '',
      `Achado por ${agent} ao revisar a tarefa "${origin.title}".`,
      finding.file === undefined
        ? ''
        : `Arquivo: ${finding.file}${finding.line === undefined ? '' : `:${String(finding.line)}`}`,
    ]
      .filter((line) => line !== '')
      .join('\n'),
    touches: findingTouches(finding, origin.touches),
    // Herda o contrato da origem: a correção precisa provar o mesmo que a
    // task original provou, mais o que o finding apontou.
    acceptance: origin.acceptance,
    labels: [`achado:${agent}`, `severidade:${finding.severity}`],
    lineage: { ...lineageBase, fingerprint },
  }))
}

function extractFindings(structured: unknown, agent: string): readonly Finding[] {
  if (structured === null || typeof structured !== 'object') return []
  const output = structured as Partial<FindingsOutput>
  if (!Array.isArray(output.findings)) return []

  return output.findings
    .filter((finding): finding is Omit<Finding, 'id'> => {
      return (
        typeof finding === 'object' &&
        finding !== null &&
        typeof (finding as { title?: unknown }).title === 'string' &&
        typeof (finding as { severity?: unknown }).severity === 'string' &&
        severityRank((finding as Finding).severity) >= 0
      )
    })
    .map((finding, index) => ({ ...finding, id: `${agent}-${String(index + 1)}` }))
}

/** Renderiza o diff para o prompt de revisão, com teto de tamanho. */
export function renderDiff(diff: DiffSummary, maxFiles = 40): string {
  if (diff.isEmpty) return '(diff vazio)'
  const lines = diff.files
    .slice(0, maxFiles)
    .map(
      (file) =>
        `${file.status.padEnd(10)} +${String(file.added).padStart(4)} -${String(file.removed).padStart(4)}  ${file.path}`,
    )
  const omitted = diff.files.length - lines.length
  return [
    `${String(diff.files.length)} arquivo(s), +${String(diff.totalAdded)} / -${String(diff.totalRemoved)}`,
    '',
    ...lines,
    omitted > 0 ? `… e mais ${String(omitted)} arquivo(s)` : '',
  ]
    .filter((line) => line !== '')
    .join('\n')
}
