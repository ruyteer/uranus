import type {
  AcceptanceContract,
  BlockReason,
  Glob,
  PlanId,
  ProjectId,
  Result,
  Task,
  TaskId,
  TaskKind,
  TaskState,
  TaskRepository,
} from '@uranus/core'
import { StateError, err, ok } from '@uranus/core'
import type { SqlValue, SqliteDriver } from '../driver.js'
import { fromSqlJson, fromSqlNullable, toSqlJson, toSqlNullable } from '../driver.js'

interface TaskRow extends Record<string, SqlValue> {
  id: string
  project_id: string
  plan_id: string | null
  kind: string
  title: string
  intent: string
  state: string
  priority: number
  deps: string
  touches: string
  acceptance: string
  agent_hint: string | null
  attempts: number
  max_attempts: number
  block_reason: string | null
  labels: string
  created_at: number
  updated_at: number
}

const COLUMNS =
  'id, project_id, plan_id, kind, title, intent, state, priority, deps, touches, acceptance, agent_hint, attempts, max_attempts, block_reason, labels, created_at, updated_at'

export function createTaskRepository(db: SqliteDriver): TaskRepository {
  const upsert = db.prepare(`
    INSERT INTO tasks (${COLUMNS})
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      plan_id      = excluded.plan_id,
      kind         = excluded.kind,
      title        = excluded.title,
      intent       = excluded.intent,
      state        = excluded.state,
      priority     = excluded.priority,
      deps         = excluded.deps,
      touches      = excluded.touches,
      acceptance   = excluded.acceptance,
      agent_hint   = excluded.agent_hint,
      attempts     = excluded.attempts,
      max_attempts = excluded.max_attempts,
      block_reason = excluded.block_reason,
      labels       = excluded.labels,
      updated_at   = excluded.updated_at
  `)
  const selectOne = db.prepare(`SELECT ${COLUMNS} FROM tasks WHERE id = ?`)
  const selectAll = db.prepare(`SELECT ${COLUMNS} FROM tasks ORDER BY created_at ASC`)
  const selectByState = db.prepare(
    `SELECT ${COLUMNS} FROM tasks WHERE state = ? ORDER BY priority DESC, created_at ASC`,
  )
  const remove = db.prepare('DELETE FROM tasks WHERE id = ?')

  return {
    save(task: Task): Promise<Result<void>> {
      try {
        upsert.run(
          task.id,
          task.projectId,
          toSqlNullable(task.planId),
          task.kind,
          task.title,
          task.intent,
          task.state,
          task.priority,
          toSqlJson(task.deps),
          toSqlJson(task.touches),
          toSqlJson(task.acceptance),
          toSqlNullable(task.agentHint),
          task.attempts,
          task.maxAttempts,
          task.blockReason === undefined ? null : toSqlJson(task.blockReason),
          toSqlJson(task.labels),
          task.createdAt,
          task.updatedAt,
        )
        return Promise.resolve(ok())
      } catch (error: unknown) {
        return Promise.resolve(
          err(new StateError('Falha ao salvar task', { cause: error, context: { id: task.id } })),
        )
      }
    },

    find(id: TaskId): Promise<Task | undefined> {
      const row = selectOne.get<TaskRow>(id)
      return Promise.resolve(row === undefined ? undefined : toTask(row))
    },

    all(): Promise<readonly Task[]> {
      return Promise.resolve(selectAll.all<TaskRow>().map(toTask))
    },

    byState(state: TaskState): Promise<readonly Task[]> {
      return Promise.resolve(selectByState.all<TaskRow>(state).map(toTask))
    },

    delete(id: TaskId): Promise<Result<void>> {
      try {
        remove.run(id)
        return Promise.resolve(ok())
      } catch (error: unknown) {
        return Promise.resolve(
          err(new StateError('Falha ao remover task', { cause: error, context: { id } })),
        )
      }
    },
  }
}

export function toTask(row: TaskRow): Task {
  const planId = fromSqlNullable(row.plan_id)
  const agentHint = fromSqlNullable(row.agent_hint)
  const blockReasonRaw = fromSqlNullable(row.block_reason)

  return {
    id: row.id as TaskId,
    projectId: row.project_id as ProjectId,
    ...(planId === undefined ? {} : { planId: planId as PlanId }),
    kind: row.kind as TaskKind,
    title: row.title,
    intent: row.intent,
    state: row.state as TaskState,
    priority: row.priority,
    deps: fromSqlJson<TaskId[]>(row.deps, []),
    touches: fromSqlJson<Glob[]>(row.touches, []),
    acceptance: fromSqlJson<AcceptanceContract>(row.acceptance, { checks: [], requireAll: true }),
    ...(agentHint === undefined ? {} : { agentHint }),
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    ...(blockReasonRaw === undefined
      ? {}
      : { blockReason: JSON.parse(blockReasonRaw) as BlockReason }),
    labels: fromSqlJson<string[]>(row.labels, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
