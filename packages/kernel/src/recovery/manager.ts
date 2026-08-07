import type {
  CheckpointManager,
  Clock,
  EventStore,
  Logger,
  RecoveryManager,
  RecoveryReport,
  Result,
  RunId,
  Sandbox,
  TaskId,
} from '@uranus/core'
import { isActive, ok, stateAfterInterruption, transition } from '@uranus/core'
import type { StateStore } from '@uranus/state'
import type { DefaultBudgetGuard } from '../guards/budget-guard.js'

export interface DefaultRecoveryManagerOptions {
  readonly state: StateStore
  readonly checkpoints: CheckpointManager
  readonly eventStore: EventStore
  readonly sandbox: Sandbox
  readonly budget: DefaultBudgetGuard
  readonly clock: Clock
  readonly logger: Logger
}

/**
 * Recuperação pós-crash (INV-4): perda máxima = 1 tick.
 *
 * Quatro passos, nesta ordem:
 *  1. Restaura o último checkpoint íntegro (orçamento incluso — sem isso, um
 *     crash "zeraria" o gasto e o R2 voltaria pela porta dos fundos).
 *  2. Colhe leases expirados e devolve as tasks à fila.
 *  3. Tasks que estavam ativas voltam a `ready` com o diagnóstico implícito
 *     de interrupção — a política de retry decide o resto.
 *  4. Workspaces órfãos são arquivados, nunca apagados: podem conter trabalho
 *     útil da tentativa interrompida, e a decisão de descartar é humana.
 */
export class DefaultRecoveryManager implements RecoveryManager {
  private readonly deps: DefaultRecoveryManagerOptions

  constructor(options: DefaultRecoveryManagerOptions) {
    this.deps = options
  }

  async needsRecovery(runId: RunId): Promise<boolean> {
    const run = await this.deps.state.runs.find(runId)
    return run !== undefined && (run.status === 'running' || run.status === 'paused')
  }

  async recover(runId: RunId, _signal: AbortSignal): Promise<Result<RecoveryReport>> {
    const { state, checkpoints, eventStore, sandbox, budget, clock, logger } = this.deps
    const started = clock.monotonic()
    const now = clock.now()

    const checkpoint = await checkpoints.latest(runId)
    if (checkpoint !== undefined) {
      budget.restore(checkpoint.snapshot.budget)
    }

    const eventsHead = await eventStore.head()
    const eventsReplayed =
      checkpoint === undefined ? eventsHead : Math.max(0, eventsHead - checkpoint.eventOffset)

    // 2) Leases do processo morto.
    const leasesExpired: TaskId[] = [...this.deps.state.leases.reapExpired(now)]
    // O processo morreu, então TODO lease deste run é órfão — não só os vencidos.
    for (const lease of state.leases.active(now)) {
      state.leases.release(lease.taskId)
      leasesExpired.push(lease.taskId)
    }

    // 3) Tasks ativas voltam à fila.
    const tasksReset: TaskId[] = []
    for (const task of await state.tasks.all()) {
      if (!isActive(task.state)) continue
      const target = stateAfterInterruption(task.state)
      if (target === task.state) continue
      const moved = transition(task, target, { at: now })
      if (moved.ok) {
        await state.tasks.save(moved.value)
        tasksReset.push(task.id)
      }
    }

    // 4) Workspaces sem task ativa.
    const activeIds = new Set<string>(
      (await state.tasks.all()).filter((t) => isActive(t.state)).map((t) => t.id),
    )
    const orphanWorkspaces = await sandbox.orphans(activeIds)
    for (const orphan of orphanWorkspaces) {
      await sandbox.release(orphan, 'archive')
    }

    const report: RecoveryReport = {
      runId,
      ...(checkpoint === undefined ? {} : { fromCheckpoint: checkpoint.id }),
      eventsReplayed,
      tasksReset,
      leasesExpired: [...new Set(leasesExpired)],
      orphanWorkspaces,
      durationMs: Math.round(clock.monotonic() - started),
    }

    logger.info('Recuperação concluída', {
      runId,
      tasksReset: tasksReset.length,
      orphans: orphanWorkspaces.length,
      fromCheckpoint: checkpoint?.id,
    })
    return ok(report)
  }
}
