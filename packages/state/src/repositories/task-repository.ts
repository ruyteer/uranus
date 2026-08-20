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
  TaskLineage,
  TaskState,
  TaskRepository,
} from '@uranus/core'
import { StateError, err, ok } from '@uranus/core'
import type { SqlValue, SqliteDriver } from '../driver.js'
import { fromSqlJson, fromSqlNullable, fromSqlNumber, toSqlJson, toSqlNullable } from '../driver.js'

interface TaskRow extends Record<string, SqlValue> {
  id: string
  project_id: string
  plan_id: string | null
  /** Nulo quando a task não veio de um item do backlog (criada à mão). */
  backlog_item_id: string | null
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
  /** Nulo só em teoria (a coluna nasceu `NOT NULL DEFAULT 0`); ver `toTask`. */
  repair_attempts: number | null
  block_reason: string | null
  labels: string
  lineage: string | null
  created_at: number
  updated_at: number
}

const COLUMNS =
  'id, project_id, plan_id, backlog_item_id, kind, title, intent, state, priority, deps, touches, acceptance, agent_hint, attempts, max_attempts, repair_attempts, block_reason, labels, lineage, created_at, updated_at'

export function createTaskRepository(db: SqliteDriver): TaskRepository {
  const upsert = db.prepare(`
    INSERT INTO tasks (${COLUMNS})
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      plan_id      = excluded.plan_id,
      backlog_item_id = excluded.backlog_item_id,
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
      repair_attempts = excluded.repair_attempts,
      block_reason = excluded.block_reason,
      labels       = excluded.labels,
      lineage      = excluded.lineage,
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
          toSqlNullable(task.backlogItemId),
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
          task.repairAttempts,
          task.blockReason === undefined ? null : toSqlJson(task.blockReason),
          toSqlJson(task.labels),
          task.lineage === undefined ? null : toSqlJson(task.lineage),
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

/**
 * Leitura síncrona direta, sem o `Promise.resolve()` do repositório.
 *
 * Existe pro `taskState()` do scheduler (`buildScheduler`), que é síncrono por
 * contrato — uma promise nunca resolve a tempo dentro de uma função síncrona.
 * O design anterior cacheava o resultado via listener fire-and-forget em
 * `TickStarted`, sem tratamento de erro: uma falha silenciosa na atualização
 * deixava o cache — e com ele `dependencyReadyPolicy` — parado para sempre,
 * vetando uma task cuja dependência já estava `done` de verdade no banco.
 * SQLite via `node:sqlite` já é síncrono por baixo do capô; isto só evita o
 * wrapper que escondia essa garantia.
 */
export function selectAllTasksSync(db: SqliteDriver): readonly Task[] {
  return db
    .prepare(`SELECT ${COLUMNS} FROM tasks ORDER BY created_at ASC`)
    .all<TaskRow>()
    .map(toTask)
}

export function toTask(row: TaskRow): Task {
  const planId = fromSqlNullable(row.plan_id)
  const backlogItemId = fromSqlNullable(row.backlog_item_id)
  const agentHint = fromSqlNullable(row.agent_hint)
  const blockReasonRaw = fromSqlNullable(row.block_reason)
  const lineageRaw = fromSqlNullable(row.lineage)

  return {
    id: row.id as TaskId,
    projectId: row.project_id as ProjectId,
    ...(planId === undefined ? {} : { planId: planId as PlanId }),
    ...(backlogItemId === undefined ? {} : { backlogItemId }),
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
    // `?? 0` cobre a leitura de um banco em que a migração v3 ainda não rodou
    // (ex.: um `SELECT` montado à mão em teste ou ferramenta externa): sem ele,
    // `repairAttempts` viria `undefined` num campo declarado obrigatório e o
    // primeiro incremento produziria `NaN`.
    repairAttempts: fromSqlNumber(row.repair_attempts) ?? 0,
    ...(blockReasonRaw === undefined
      ? {}
      : { blockReason: JSON.parse(blockReasonRaw) as BlockReason }),
    labels: fromSqlJson<string[]>(row.labels, []),
    ...(lineageRaw === undefined ? {} : { lineage: JSON.parse(lineageRaw) as TaskLineage }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
