import type {
  BudgetGuard,
  Clock,
  DiffSummary,
  EventBus,
  EventName,
  HumanGate,
  Money,
  PullRequestRef,
  TaskId,
  TaskState,
  Unsubscribe,
  UranusEvent,
} from '@uranus/core'
import { formatMoney, moneyToNumber, redact, redactText } from '@uranus/core'
import type { DefaultCostAccountant } from './cost.js'
import type { DefaultTelemetry } from './metrics.js'

/**
 * Estado vivo do sistema, derivado **do log de eventos**.
 *
 * A escolha de derivar tudo de eventos em vez de o dashboard consultar o kernel
 * é o que mantém o INV-3 útil: qualquer coisa que o painel mostre aconteceu de
 * verdade e está no log. Também significa que o dashboard pode ser reconstruído
 * por replay — e que ligá-lo não muda o comportamento do kernel em nada.
 *
 * Custo de memória é limitado por construção: timeline e listas são anéis com
 * teto, e task encerrada há muito tempo sai do detalhe. Um run de 8 horas não
 * pode ficar mais lento por causa do painel que o observa.
 */

export type Severity = 'info' | 'warn' | 'error'

export interface TimelineEntry {
  readonly at: number
  readonly seq: number
  readonly name: EventName
  readonly taskId?: string
  readonly summary: string
  readonly severity: Severity
}

export interface TaskView {
  readonly id: string
  title: string
  kind: string
  state: TaskState | 'unknown'
  attempts: number
  agent?: string
  provider?: string
  startedAt?: number
  updatedAt: number
  costMicros: number
  blockReason?: string
  lastEvent?: string
}

export interface FindingView {
  readonly at: number
  readonly kind: 'security' | 'bug' | 'review'
  readonly title: string
  readonly severity: string
  readonly taskId?: string
}

export interface CommitView {
  readonly at: number
  readonly taskId: string
  readonly sha: string
  readonly subject: string
  readonly files: number
  readonly insertions: number
  readonly deletions: number
}

export interface PullRequestView {
  readonly at: number
  readonly taskId: string
  readonly number: number
  readonly url: string
  readonly title: string
  readonly state: string
}

export interface ProviderHealthView {
  degraded: boolean
  reason?: string
  consecutiveFailures: number
  rateLimitedUntil?: number
}

const TIMELINE_CAP = 500
const LIST_CAP = 100
const TASK_CAP = 500

export interface AggregatorOptions {
  readonly clock: Clock
  readonly events: EventBus
  readonly cost: DefaultCostAccountant
  readonly telemetry: DefaultTelemetry
  readonly budget?: BudgetGuard
  readonly humanGate?: HumanGate
  /** Chamado a cada mudança. O servidor usa isto para empurrar via SSE. */
  readonly onChange?: (entry: TimelineEntry) => void
  /**
   * Providers registrados na composição.
   *
   * Sem isto o painel de Saúde só mostrava provider que já tinha falhado — ou
   * seja, ficava vazio justamente quando estava tudo bem, e o usuário não tinha
   * como confirmar qual modelo o Uranus ia usar.
   */
  readonly providers?: () => readonly { id: string; kind: string }[]
}

export class TelemetryAggregator {
  private unsubscribe: Unsubscribe | undefined

  private run: {
    runId?: string
    startedAt?: number
    stoppedAt?: number
    reason?: string
    ticks: number
    phase?: string
    status: 'idle' | 'running' | 'paused' | 'stopped'
  } = { ticks: 0, status: 'idle' }

  private readonly tasks = new Map<string, TaskView>()
  private readonly timeline: TimelineEntry[] = []
  private readonly findings: FindingView[] = []
  private readonly commits: CommitView[] = []
  private readonly pullRequests: PullRequestView[] = []
  private readonly providerHealth = new Map<string, ProviderHealthView>()
  private readonly pluginFailures: { at: number; pluginId: string; error: string }[] = []

  private quality = { gatesRun: 0, blocked: 0, findings: 0, followUps: 0 }
  private checks = { passed: 0, failed: 0 }
  private memory = { updates: 0, conflicts: 0, compactions: 0, invalidations: 0 }
  private approvals = { requested: 0, granted: 0, denied: 0 }
  private planning = { created: 0, rejected: 0 }

  constructor(private readonly options: AggregatorOptions) {}

  /** Liga o agregador ao barramento. Idempotente. */
  start(): void {
    if (this.unsubscribe !== undefined) return
    this.unsubscribe = this.options.events.onAny((event) => {
      // Nada aqui pode derrubar o barramento: o painel é um observador, e um
      // observador que quebra o observado é pior que nenhum painel.
      try {
        this.apply(event)
      } catch {
        /* evento malformado não interrompe o run */
      }
    })
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = undefined
  }

  // ── Ingestão ──────────────────────────────────────────────────────────────

  private apply(event: UranusEvent): void {
    const summary = this.summarize(event)
    switch (event.name) {
      case 'KernelStarted': {
        const payload = event.payload as { runId: string }
        this.run = {
          runId: payload.runId,
          startedAt: event.at,
          ticks: 0,
          status: 'running',
        }
        break
      }
      case 'KernelStopped': {
        const payload = event.payload as { reason: string; ticks: number }
        this.run = {
          ...this.run,
          stoppedAt: event.at,
          reason: payload.reason,
          ticks: payload.ticks,
          status: 'stopped',
        }
        break
      }
      case 'KernelPaused':
        this.run = { ...this.run, status: 'paused' }
        break
      case 'KernelResumed':
        this.run = { ...this.run, status: 'running' }
        break
      case 'TickStarted': {
        const payload = event.payload as { tick: number }
        this.run = { ...this.run, ticks: payload.tick, status: 'running' }
        break
      }
      case 'TickCompleted': {
        const payload = event.payload as { phase: string }
        this.run = { ...this.run, phase: payload.phase }
        break
      }

      case 'TaskQueued': {
        const payload = event.payload as { taskId: string }
        this.upsertTask(payload.taskId, event.at, (task) => {
          if (task.state === 'unknown') task.state = 'ready'
        })
        break
      }
      case 'TaskCreated': {
        const payload = event.payload as { taskId: string; kind: string; title: string }
        this.upsertTask(payload.taskId, event.at, (task) => {
          task.title = redactText(payload.title)
          task.kind = payload.kind
        })
        break
      }
      case 'TaskStarted': {
        const payload = event.payload as { taskId: string; agent: string; provider: string }
        this.upsertTask(payload.taskId, event.at, (task) => {
          task.agent = payload.agent
          task.provider = payload.provider
          task.startedAt ??= event.at
          task.attempts++
        })
        break
      }
      case 'TaskStateChanged': {
        const payload = event.payload as { taskId: string; to: TaskState }
        this.upsertTask(payload.taskId, event.at, (task) => {
          task.state = payload.to
        })
        break
      }
      case 'TaskBlocked': {
        const payload = event.payload as { taskId: string; message: string }
        this.upsertTask(payload.taskId, event.at, (task) => {
          task.state = 'blocked'
          task.blockReason = redactText(payload.message)
        })
        break
      }
      case 'TaskCompleted': {
        const payload = event.payload as { taskId: string; totalCost: Money }
        this.upsertTask(payload.taskId, event.at, (task) => {
          task.state = 'done'
          task.costMicros = payload.totalCost.micros
        })
        this.options.cost.recordTaskCompleted(payload.taskId as TaskId)
        break
      }
      case 'TokensConsumed': {
        const payload = event.payload as {
          taskId?: string
          cost: Money
          provider: string
          usage: { input: number; output: number }
        }
        if (payload.taskId !== undefined) {
          this.upsertTask(payload.taskId, event.at, (task) => {
            task.costMicros += payload.cost.micros
          })
        }
        break
      }

      case 'CheckPassed':
        this.checks.passed++
        break
      case 'CheckFailed':
        this.checks.failed++
        break

      case 'ReviewCompleted': {
        const payload = event.payload as { findings: number; blocking: number }
        this.quality.gatesRun++
        this.quality.findings += payload.findings
        if (payload.blocking > 0) this.quality.blocked++
        break
      }
      case 'SecurityFindingRaised': {
        const payload = event.payload as { title: string; severity: string; taskId?: string }
        this.pushCapped(this.findings, {
          at: event.at,
          kind: 'security',
          title: redactText(payload.title),
          severity: payload.severity,
          ...(payload.taskId === undefined ? {} : { taskId: payload.taskId }),
        })
        break
      }
      case 'BugDetected': {
        const payload = event.payload as { title: string; severity: string; taskId?: string }
        this.pushCapped(this.findings, {
          at: event.at,
          kind: 'bug',
          title: redactText(payload.title),
          severity: payload.severity,
          ...(payload.taskId === undefined ? {} : { taskId: payload.taskId }),
        })
        break
      }

      case 'CommitCreated': {
        const payload = event.payload as unknown as {
          taskId: string
          sha: string
          subject: string
          diff: DiffSummary
        }
        this.pushCapped(this.commits, {
          at: event.at,
          taskId: payload.taskId,
          sha: payload.sha.slice(0, 10),
          subject: redactText(payload.subject),
          files: payload.diff.files.length,
          insertions: payload.diff.totalAdded,
          deletions: payload.diff.totalRemoved,
        })
        break
      }
      case 'PRCreated':
      case 'PRUpdated': {
        const payload = event.payload as unknown as {
          taskId: string
          pr: PullRequestRef
        }
        this.pushCapped(this.pullRequests, {
          at: event.at,
          taskId: payload.taskId,
          number: payload.pr.number,
          url: payload.pr.url,
          title: `${payload.pr.repo}#${String(payload.pr.number)}`,
          state: 'open',
        })
        break
      }

      case 'MemoryUpdated':
        this.memory.updates++
        break
      case 'MemoryConflictDetected':
        this.memory.conflicts++
        break
      case 'MemoryCompacted':
        this.memory.compactions++
        break
      case 'MemoryInvalidated':
        this.memory.invalidations++
        break

      case 'ApprovalRequested':
        this.approvals.requested++
        break
      case 'ApprovalGranted':
        this.approvals.granted++
        break
      case 'ApprovalDenied':
        this.approvals.denied++
        break

      case 'PlanCreated':
        this.planning.created++
        break
      case 'PlanRejected':
        this.planning.rejected++
        break

      case 'ProviderDegraded': {
        const payload = event.payload as {
          provider: string
          reason: string
          consecutiveFailures: number
        }
        this.providerHealth.set(payload.provider, {
          degraded: true,
          reason: redactText(payload.reason),
          consecutiveFailures: payload.consecutiveFailures,
        })
        break
      }
      case 'RateLimited': {
        const payload = event.payload as { provider: string; retryAfterMs: number }
        const current = this.providerHealth.get(payload.provider) ?? {
          degraded: false,
          consecutiveFailures: 0,
        }
        this.providerHealth.set(payload.provider, {
          ...current,
          rateLimitedUntil: event.at + payload.retryAfterMs,
        })
        break
      }
      case 'PluginFailed': {
        const payload = event.payload as { pluginId: string; error: string }
        this.pushCapped(this.pluginFailures, {
          at: event.at,
          pluginId: payload.pluginId,
          error: redactText(payload.error),
        })
        break
      }
      default:
        break
    }

    const entry: TimelineEntry = {
      at: event.at,
      seq: event.seq,
      name: event.name,
      ...(event.taskId === undefined ? {} : { taskId: event.taskId }),
      summary,
      severity: severityOf(event.name),
    }
    this.timeline.push(entry)
    if (this.timeline.length > TIMELINE_CAP) {
      this.timeline.splice(0, this.timeline.length - TIMELINE_CAP)
    }
    this.options.onChange?.(entry)
  }

  private upsertTask(id: string, at: number, mutate: (task: TaskView) => void): void {
    let task = this.tasks.get(id)
    if (task === undefined) {
      task = {
        id,
        title: id,
        kind: 'unknown',
        state: 'unknown',
        attempts: 0,
        updatedAt: at,
        costMicros: 0,
      }
      this.tasks.set(id, task)
      this.evictFinishedTasks()
    }
    mutate(task)
    task.updatedAt = at
    task.lastEvent = new Date(at).toISOString()
  }

  /** Só tasks terminadas saem: uma task viva nunca some do painel. */
  private evictFinishedTasks(): void {
    if (this.tasks.size <= TASK_CAP) return
    const finished = [...this.tasks.values()]
      .filter((task) => task.state === 'done' || task.state === 'abandoned')
      .sort((a, b) => a.updatedAt - b.updatedAt)
    for (const task of finished) {
      if (this.tasks.size <= TASK_CAP) break
      this.tasks.delete(task.id)
    }
  }

  private pushCapped<T>(list: T[], item: T): void {
    list.push(item)
    if (list.length > LIST_CAP) list.splice(0, list.length - LIST_CAP)
  }

  private summarize(event: UranusEvent): string {
    const payload = event.payload as Record<string, unknown>
    const pick = (key: string): string | undefined => {
      const value = payload[key]
      return typeof value === 'string' ? redactText(value) : undefined
    }
    return (
      pick('title') ??
      pick('reason') ??
      pick('message') ??
      pick('subject') ??
      pick('error') ??
      pick('phase') ??
      ''
    )
  }

  // ── Leitura ───────────────────────────────────────────────────────────────

  /**
   * Retrato completo, já redigido e pronto para virar JSON.
   *
   * A redação acontece **aqui**, na fronteira, e não só na entrada: um segredo
   * que escapou de um `redactText` na ingestão ainda não sai pela porta (R12).
   */
  snapshot(pendingApprovals: readonly unknown[] = []): Record<string, unknown> {
    const now = this.options.clock.now()
    const tasks = [...this.tasks.values()].sort((a, b) => b.updatedAt - a.updatedAt)
    const byState: Record<string, number> = {}
    for (const task of tasks) byState[task.state] = (byState[task.state] ?? 0) + 1

    const remaining = tasks.filter(
      (task) => task.state !== 'done' && task.state !== 'abandoned',
    ).length
    const budget = this.options.budget?.state()
    const totalChecks = this.checks.passed + this.checks.failed

    return redact({
      at: now,
      run: this.run,
      queue: { byState, total: tasks.length, remaining },
      tasks: tasks.slice(0, 100),
      timeline: [...this.timeline].reverse().slice(0, 200),
      cost: {
        totalUsd: moneyToNumber(this.options.cost.total()),
        totalLabel: formatMoney(this.options.cost.total()),
        projectedRemainingUsd: moneyToNumber(this.options.cost.project(remaining)),
        byAgent: this.options.cost.breakdownByAgent().map(toCostRow),
        byModel: this.options.cost.breakdownByModel().map(toCostRow),
        byTask: this.options.cost.breakdownByTask().slice(0, 20).map(toCostRow),
        daily: this.options.cost.daily(14, now).map((entry) => ({
          day: entry.day,
          usd: moneyToNumber(entry.cost),
        })),
        stats: this.options.cost.stats(),
      },
      budget:
        budget === undefined
          ? undefined
          : {
              run: budgetWindow(budget.run),
              task: budgetWindow(budget.task),
            },
      quality: {
        gatesRun: this.quality.gatesRun,
        blocked: this.quality.blocked,
        // Contador e lista têm nomes diferentes de propósito: um `findings`
        // que às vezes é número e às vezes é array é a origem clássica de
        // "[object Object]" na tela.
        findingsCount: this.quality.findings,
        followUps: this.quality.followUps,
        checks: this.checks,
        passRate: totalChecks === 0 ? null : this.checks.passed / totalChecks,
        findings: this.findings.slice().reverse(),
      },
      git: {
        commits: this.commits.slice().reverse(),
        pullRequests: this.pullRequests.slice().reverse(),
      },
      memory: this.memory,
      planning: this.planning,
      approvals: { ...this.approvals, pending: pendingApprovals },
      health: {
        providers: this.providersView(),
        pluginFailures: this.pluginFailures.slice().reverse(),
        spans: this.options.telemetry.spans(60),
      },
    }) as Record<string, unknown>
  }

  /** Métricas em formato de exposição Prometheus. */
  async prometheus(): Promise<string> {
    const snapshot = await this.options.telemetry.snapshot()
    const lines: string[] = []
    const emit = (name: string, value: number): void => {
      lines.push(`${promName(name)} ${String(Number.isFinite(value) ? value : 0)}`)
    }
    for (const [key, value] of Object.entries(snapshot.counters)) emit(key, value)
    for (const [key, value] of Object.entries(snapshot.gauges)) emit(key, value)
    for (const [key, value] of Object.entries(snapshot.histograms)) {
      emit(`${key}_count`, value.count)
      emit(`${key}_sum`, value.sum)
      emit(`${key}_p50`, value.p50)
      emit(`${key}_p95`, value.p95)
    }
    emit('uranus_cost_total_usd', moneyToNumber(this.options.cost.total()))
    emit('uranus_tasks_total', this.tasks.size)
    emit('uranus_ticks_total', this.run.ticks)
    return `${lines.join('\n')}\n`
  }

  /** Todo provider registrado, com a saúde que se souber dele. */
  private providersView(): Record<string, ProviderHealthView & { kind?: string }> {
    const out: Record<string, ProviderHealthView & { kind?: string }> = {}
    for (const provider of this.options.providers?.() ?? []) {
      out[provider.id] = { degraded: false, consecutiveFailures: 0, kind: provider.kind }
    }
    for (const [id, health] of this.providerHealth) {
      out[id] = { ...out[id], ...health }
    }
    return out
  }

  /**
   * Popula o painel com tasks que já existiam antes deste processo subir.
   *
   * O agregador deriva tudo de eventos, e eventos de runs anteriores não são
   * reproduzidos. Sem esta hidratação, uma task criada ontem aparecia com o id
   * no lugar do título, tipo `unknown` e zero tentativas — o painel contradizia
   * o `uranus task list`, que é a pior forma de perder a confiança de quem olha.
   */
  hydrate(
    tasks: readonly {
      id: string
      title: string
      kind: string
      state: TaskState
      attempts: number
      updatedAt: number
      agentHint?: string
      blockReason?: { message: string }
    }[],
  ): void {
    for (const task of tasks) {
      const view: TaskView = {
        id: task.id,
        title: redactText(task.title),
        kind: task.kind,
        state: task.state,
        attempts: task.attempts,
        updatedAt: task.updatedAt,
        costMicros: 0,
        ...(task.agentHint === undefined ? {} : { agent: task.agentHint }),
        ...(task.blockReason === undefined
          ? {}
          : { blockReason: redactText(task.blockReason.message) }),
      }
      // Eventos deste processo são mais recentes que o disco e vencem sempre.
      const existing = this.tasks.get(task.id)
      if (existing === undefined) this.tasks.set(task.id, view)
    }
  }

  recentTimeline(limit = 50): readonly TimelineEntry[] {
    return [...this.timeline].reverse().slice(0, limit)
  }
}

function toCostRow(row: { key: string; cost: Money; calls: number }): Record<string, unknown> {
  return { key: row.key, usd: moneyToNumber(row.cost), calls: row.calls }
}

function budgetWindow(window: {
  limits: { cost: Money; tokens: number; wallclockMs: number }
  usedCost: Money
  usedTokens: number
  usedWallclockMs: number
}): Record<string, unknown> {
  return {
    limitUsd: moneyToNumber(window.limits.cost),
    usedUsd: moneyToNumber(window.usedCost),
    limitTokens: window.limits.tokens,
    usedTokens: window.usedTokens,
    limitWallclockMs: window.limits.wallclockMs,
    usedWallclockMs: window.usedWallclockMs,
  }
}

/**
 * O nome do evento define a cor da linha na timeline. É a diferença entre um
 * painel que se lê de relance e uma lista de texto cinza.
 */
function severityOf(name: EventName): Severity {
  if (
    name.endsWith('Failed') ||
    name.endsWith('Denied') ||
    name.endsWith('Corrupted') ||
    name === 'TaskBlocked' ||
    name === 'BudgetExhausted' ||
    name === 'ProviderDegraded' ||
    name === 'CheckFailed' ||
    name === 'TestsFailed' ||
    name === 'SecurityFindingRaised' ||
    name === 'BugDetected'
  ) {
    return 'error'
  }
  if (
    name === 'TaskRetried' ||
    name === 'TaskReplanned' ||
    name === 'PlanRejected' ||
    name === 'RateLimited' ||
    name === 'BudgetThresholdReached' ||
    name === 'MemoryConflictDetected' ||
    name === 'ApprovalRequested' ||
    name === 'HumanInterventionRequested' ||
    name === 'WorkspaceOrphaned' ||
    name === 'ToolDenied'
  ) {
    return 'warn'
  }
  return 'info'
}

const PROM_INVALID = /[^a-zA-Z0-9_]/g

function promName(key: string): string {
  const [name, labels] = key.split('{')
  const base = `uranus_${(name ?? key).replace(PROM_INVALID, '_')}`
  if (labels === undefined) return base
  const inner = labels
    .replace(/\}$/, '')
    .split(',')
    .filter((part) => part !== '')
    .map((part) => {
      const [labelKey, ...rest] = part.split('=')
      return `${(labelKey ?? '').replace(PROM_INVALID, '_')}="${rest.join('=').replace(/"/g, '')}"`
    })
  return inner.length === 0 ? base : `${base}{${inner.join(',')}}`
}
