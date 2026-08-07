import type { TaskId } from '../ids.js'
import type { Result } from '../result.js'
import type { BudgetState } from '../domain/budget.js'
import type { QueueStats } from '../domain/project.js'
import type { Task, TaskKind, TaskState } from '../domain/task.js'
import type { Glob } from '../util/glob.js'

/**
 * Lease com TTL.
 *
 * O TTL não é otimização — é a garantia de recuperação. Se o kernel morre com
 * uma task `claimed`, nenhum processo vai liberá-la; o TTL expira sozinho e a
 * task volta para a fila. Sem isso, um `kill -9` deixaria trabalho preso para
 * sempre.
 */
export interface Lease {
  readonly taskId: TaskId
  readonly owner: string
  readonly acquiredAt: number
  readonly expiresAt: number
  /** Propriedade exclusiva de arquivo entre worktrees paralelos (R6). */
  readonly paths: readonly Glob[]
}

export interface TaskQueue {
  enqueue(task: Task): Promise<Result<void>>
  update(task: Task): Promise<Result<void>>
  get(id: TaskId): Promise<Task | undefined>

  claim(id: TaskId, owner: string, ttlMs: number, now: number): Promise<Result<Lease>>
  renew(lease: Lease, ttlMs: number, now: number): Promise<Result<Lease>>
  release(lease: Lease, next: TaskState, now: number): Promise<Result<void>>

  /** Tasks elegíveis: estado `ready`, dependências satisfeitas, sem conflito de lease. */
  eligible(context: SchedulingContext): Promise<readonly Task[]>
  activeLeases(now: number): Promise<readonly Lease[]>
  /** Remove leases expirados e devolve as tasks à fila. Chamado a cada tick. */
  reapExpired(now: number): Promise<readonly TaskId[]>

  stats(): Promise<QueueStats>
  deadLetter(): Promise<readonly Task[]>
}

export interface SchedulingContext {
  readonly now: number
  readonly stats: QueueStats
  readonly budget: BudgetState
  readonly activeLeases: readonly Lease[]
  readonly recentOutcomes: readonly {
    readonly taskId: TaskId
    readonly status: string
    readonly at: number
  }[]
  /** Cotas-alvo por tipo, vindas da config. */
  readonly mix: Readonly<Partial<Record<TaskKind, number>>>
  readonly observedMix: Readonly<Partial<Record<TaskKind, number>>>
  readonly providerHealth: Readonly<Record<string, 'up' | 'degraded' | 'down'>>
  readonly restrictedMode: boolean
}

/**
 * Política de priorização.
 *
 * `null` é veto (inelegível), `number` é contribuição para o score. A separação
 * importa: um veto por dependência não satisfeita não deve ser compensável por
 * prioridade alta em outra dimensão.
 */
export interface SchedulerPolicy {
  readonly id: string
  score(task: Task, context: SchedulingContext): number | null
}

export interface PolicyContribution {
  readonly policyId: string
  readonly raw: number | null
  readonly weight: number
  readonly weighted: number
}

export interface SchedulingExplanation {
  readonly taskId: TaskId
  readonly eligible: boolean
  readonly total: number
  readonly contributions: readonly PolicyContribution[]
  readonly vetoedBy: readonly string[]
}

export interface Scheduler {
  next(context: SchedulingContext, signal: AbortSignal): Promise<Task | null>
  addPolicy(policy: SchedulerPolicy, weight: number): void
  /** Auditabilidade: por que *esta* task foi escolhida e não outra. */
  explain(task: Task, context: SchedulingContext): SchedulingExplanation
}
