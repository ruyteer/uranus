import type { AttemptId, CheckpointId, RunId, TaskId } from '../ids.js'
import type { Result } from '../result.js'
import type { Attempt } from '../domain/attempt.js'
import type { BudgetState } from '../domain/budget.js'
import type { Run, TickPhase } from '../domain/project.js'
import type { Task } from '../domain/task.js'
import type { WorkspaceRef } from '../domain/vcs.js'
import type { Lease } from './queue.js'

/**
 * Projeção do estado do kernel em um instante. É o que um checkpoint guarda.
 *
 * Deliberadamente pequeno: o event log é a fonte da verdade (ADR-006), e o
 * snapshot existe para evitar reprocessar milhões de eventos na recuperação.
 */
export interface KernelSnapshot {
  readonly phase: TickPhase
  readonly tick: number
  readonly tasks: readonly Task[]
  readonly leases: readonly Lease[]
  readonly budget: BudgetState
  readonly activeAttempt?: Attempt
  readonly contextDigests: Readonly<Record<string, string>>
  readonly pendingApprovals: readonly string[]
}

export interface Checkpoint {
  readonly id: CheckpointId
  readonly runId: RunId
  readonly seq: number
  readonly at: number
  /** Posição exata no event log. Recuperação reprocessa a partir daqui. */
  readonly eventOffset: number
  readonly snapshot: KernelSnapshot
  readonly workspaces: readonly WorkspaceRef[]
  /** Integridade. Checkpoint com digest divergente nunca é restaurado (R11). */
  readonly digest: string
}

export interface CheckpointRef {
  readonly id: CheckpointId
  readonly runId: RunId
  readonly seq: number
  readonly at: number
  readonly eventOffset: number
}

export interface CheckpointManager {
  /**
   * Escrita atômica: `tmp` → `fsync` → `rename`.
   * Um checkpoint corrompido nunca substitui um íntegro.
   */
  create(
    runId: RunId,
    snapshot: KernelSnapshot,
    eventOffset: number,
    workspaces: readonly WorkspaceRef[],
  ): Promise<Result<Checkpoint>>

  latest(runId: RunId): Promise<Checkpoint | undefined>
  load(id: CheckpointId): Promise<Result<Checkpoint>>
  list(runId: RunId): Promise<readonly CheckpointRef[]>
  prune(runId: RunId, keep: number): Promise<number>
}

export interface RecoveryReport {
  readonly runId: RunId
  readonly fromCheckpoint?: CheckpointId
  readonly eventsReplayed: number
  readonly tasksReset: readonly TaskId[]
  readonly leasesExpired: readonly TaskId[]
  readonly orphanWorkspaces: readonly WorkspaceRef[]
  readonly durationMs: number
}

/** INV-4: perda máxima em qualquer interrupção é de um tick. */
export interface RecoveryManager {
  needsRecovery(runId: RunId): Promise<boolean>
  recover(runId: RunId, signal: AbortSignal): Promise<Result<RecoveryReport>>
}

// ── Repositórios ────────────────────────────────────────────────────────────

export interface TaskRepository {
  save(task: Task): Promise<Result<void>>
  find(id: TaskId): Promise<Task | undefined>
  all(): Promise<readonly Task[]>
  byState(state: Task['state']): Promise<readonly Task[]>
  delete(id: TaskId): Promise<Result<void>>
}

export interface AttemptRepository {
  save(attempt: Attempt): Promise<Result<void>>
  find(id: AttemptId): Promise<Attempt | undefined>
  /** Ordenado por `n` crescente. A `RetryPolicy` depende dessa ordem (R3). */
  byTask(taskId: TaskId): Promise<readonly Attempt[]>
}

export interface RunRepository {
  save(run: Run): Promise<Result<void>>
  find(id: RunId): Promise<Run | undefined>
  latest(): Promise<Run | undefined>
  unfinished(): Promise<readonly Run[]>
  /**
   * IDs de runs já terminados (`completed`/`failed`), do mais antigo pro mais
   * recente, além dos últimos `keepMostRecent` — candidatos a ter os
   * checkpoints podados (Fase 9). As linhas de `runs` em si NÃO são apagadas
   * por este método: histórico de run é barato e serve `uranus status`/logs;
   * só os checkpoints (arquivo + índice) desses runs antigos são descartáveis.
   */
  oldFinished(keepMostRecent: number): Promise<readonly RunId[]>
}
