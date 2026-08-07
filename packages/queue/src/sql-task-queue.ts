import type {
  Lease,
  QueueStats,
  Result,
  SchedulingContext,
  Task,
  TaskId,
  TaskKind,
  TaskQueue,
  TaskState,
} from '@uranus/core'
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  dependenciesSatisfied,
  err,
  globsIntersect,
  isEnforceable,
  ok,
  transition,
} from '@uranus/core'
import type { StateStore } from '@uranus/state'

const TASK_STATES: readonly TaskState[] = [
  'draft',
  'ready',
  'claimed',
  'running',
  'verifying',
  'verified',
  'failed',
  'integrating',
  'blocked',
  'done',
  'abandoned',
]

/**
 * Fila persistente sobre o `StateStore`.
 *
 * A regra de admissão do INV-2 vive aqui, na porta de entrada: uma task sem
 * contrato de aceite executável **não entra na fila**. Barrar na inserção — e
 * não na execução — significa que nenhum caminho de código posterior precisa
 * se defender de tasks inverificáveis.
 */
export class SqlTaskQueue implements TaskQueue {
  constructor(private readonly state: StateStore) {}

  async enqueue(task: Task): Promise<Result<void>> {
    if (!isEnforceable(task.acceptance)) {
      return err(
        new ValidationError(
          'Task sem check bloqueante no contrato de aceite não pode ser enfileirada (INV-2)',
          { context: { taskId: task.id, title: task.title } },
        ),
      )
    }
    return this.state.tasks.save(task)
  }

  update(task: Task): Promise<Result<void>> {
    return this.state.tasks.save(task)
  }

  get(id: TaskId): Promise<Task | undefined> {
    return this.state.tasks.find(id)
  }

  async claim(id: TaskId, owner: string, ttlMs: number, now: number): Promise<Result<Lease>> {
    const task = await this.state.tasks.find(id)
    if (task === undefined) {
      return err(new NotFoundError('Task não encontrada', { context: { id } }))
    }
    if (task.state !== 'ready') {
      return err(
        new ConflictError(`Task não está pronta para claim (estado: ${task.state})`, {
          context: { id, state: task.state },
        }),
      )
    }

    const lease = this.state.leases.acquire(id, owner, task.touches, ttlMs, now)
    if (!lease.ok) return lease

    const claimed = transition(task, 'claimed', { at: now })
    if (!claimed.ok) {
      this.state.leases.release(id)
      return err(claimed.error)
    }
    const saved = await this.state.tasks.save(claimed.value)
    if (!saved.ok) {
      this.state.leases.release(id)
      return err(saved.error)
    }
    return lease
  }

  renew(lease: Lease, ttlMs: number, now: number): Promise<Result<Lease>> {
    return Promise.resolve(this.state.leases.renew(lease, ttlMs, now))
  }

  async release(lease: Lease, next: TaskState, now: number): Promise<Result<void>> {
    const task = await this.state.tasks.find(lease.taskId)
    this.state.leases.release(lease.taskId)
    if (task === undefined) {
      return err(new NotFoundError('Task do lease não existe', { context: { id: lease.taskId } }))
    }
    if (task.state === next) return ok()
    const moved = transition(task, next, { at: now })
    if (!moved.ok) return err(moved.error)
    return this.state.tasks.save(moved.value)
  }

  async eligible(context: SchedulingContext): Promise<readonly Task[]> {
    const ready = await this.state.tasks.byState('ready')
    if (ready.length === 0) return []

    const all = await this.state.tasks.all()
    const stateOf = new Map<TaskId, TaskState>(all.map((t) => [t.id, t.state]))
    const activeLeases = context.activeLeases

    return ready.filter((task) => {
      if (!dependenciesSatisfied(task, (id) => stateOf.get(id))) return false
      // R6: paths sobrepostos com lease ativo tornam a task inelegível agora
      // (não bloqueada — ela volta a ser elegível quando o lease sair).
      const conflicting = activeLeases.some(
        (lease) => lease.taskId !== task.id && globsIntersect(lease.paths, task.touches),
      )
      if (conflicting) return false
      // R4: em modo restrito, só tasks que constroem o sinal de verificação.
      if (context.restrictedMode && task.kind !== 'test') return false
      return true
    })
  }

  activeLeases(now: number): Promise<readonly Lease[]> {
    return Promise.resolve(this.state.leases.active(now))
  }

  async reapExpired(now: number): Promise<readonly TaskId[]> {
    const expired = this.state.leases.reapExpired(now)
    // Tasks cujo lease expirou estavam com um kernel que morreu: voltam à fila.
    for (const id of expired) {
      const task = await this.state.tasks.find(id)
      if (task === undefined) continue
      if (task.state === 'claimed' || task.state === 'running' || task.state === 'verifying') {
        const moved = transition(task, task.state === 'claimed' ? 'ready' : 'failed', { at: now })
        if (moved.ok) await this.state.tasks.save(moved.value)
      }
    }
    return expired
  }

  async stats(): Promise<QueueStats> {
    const all = await this.state.tasks.all()
    const byState = Object.fromEntries(TASK_STATES.map((s) => [s, 0])) as Record<TaskState, number>
    const byKind: Partial<Record<TaskKind, number>> = {}
    let oldestReadyAt: number | undefined
    let deadLettered = 0

    for (const task of all) {
      byState[task.state] += 1
      byKind[task.kind] = (byKind[task.kind] ?? 0) + 1
      if (task.state === 'ready') {
        oldestReadyAt =
          oldestReadyAt === undefined ? task.createdAt : Math.min(oldestReadyAt, task.createdAt)
      }
      if (task.state === 'blocked' && task.blockReason?.kind === 'exhausted') deadLettered += 1
    }

    return {
      total: all.length,
      byState,
      byKind: byKind as QueueStats['byKind'],
      ...(oldestReadyAt === undefined ? {} : { oldestReadyAt }),
      deadLettered,
    }
  }

  async deadLetter(): Promise<readonly Task[]> {
    const blocked = await this.state.tasks.byState('blocked')
    return blocked.filter((t) => t.blockReason?.kind === 'exhausted')
  }
}
