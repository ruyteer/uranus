import type {
  Attempt,
  AttemptId,
  AttemptOutcome,
  AttemptRepository,
  Result,
  TaskId,
  TokenUsage,
  WorkspaceId,
} from '@uranus/core'
import { EMPTY_USAGE, StateError, err, moneyFromMicros, ok } from '@uranus/core'
import type { SqlValue, SqliteDriver } from '../driver.js'
import { fromSqlJson, fromSqlNullable, fromSqlNumber, toSqlJson, toSqlNumber } from '../driver.js'

interface AttemptRow extends Record<string, SqlValue> {
  id: string
  task_id: string
  n: number
  agent: string
  provider: string
  model: string
  context_digest: string
  workspace_id: string
  started_at: number
  finished_at: number | null
  outcome: string | null
  usage: string
  cost_micros: number
}

const COLUMNS =
  'id, task_id, n, agent, provider, model, context_digest, workspace_id, started_at, finished_at, outcome, usage, cost_micros'

export function createAttemptRepository(db: SqliteDriver): AttemptRepository {
  const upsert = db.prepare(`
    INSERT INTO attempts (${COLUMNS})
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      finished_at = excluded.finished_at,
      outcome     = excluded.outcome,
      usage       = excluded.usage,
      cost_micros = excluded.cost_micros
  `)
  const selectOne = db.prepare(`SELECT ${COLUMNS} FROM attempts WHERE id = ?`)
  // A ordem por `n` não é cosmética: a RetryPolicy lê o histórico de categorias
  // em sequência para detectar repetição e oscilação (R3).
  const selectByTask = db.prepare(
    `SELECT ${COLUMNS} FROM attempts WHERE task_id = ? ORDER BY n ASC`,
  )

  return {
    save(attempt: Attempt): Promise<Result<void>> {
      try {
        upsert.run(
          attempt.id,
          attempt.taskId,
          attempt.n,
          attempt.agent,
          attempt.provider,
          attempt.model,
          attempt.contextDigest,
          attempt.workspaceId,
          attempt.startedAt,
          toSqlNumber(attempt.finishedAt),
          attempt.outcome === undefined ? null : toSqlJson(attempt.outcome),
          toSqlJson(attempt.usage),
          attempt.cost.micros,
        )
        return Promise.resolve(ok())
      } catch (error: unknown) {
        return Promise.resolve(
          err(
            new StateError('Falha ao salvar attempt', {
              cause: error,
              context: { id: attempt.id },
            }),
          ),
        )
      }
    },

    find(id: AttemptId): Promise<Attempt | undefined> {
      const row = selectOne.get<AttemptRow>(id)
      return Promise.resolve(row === undefined ? undefined : toAttempt(row))
    },

    byTask(taskId: TaskId): Promise<readonly Attempt[]> {
      return Promise.resolve(selectByTask.all<AttemptRow>(taskId).map(toAttempt))
    },
  }
}

function toAttempt(row: AttemptRow): Attempt {
  const finishedAt = fromSqlNumber(row.finished_at)
  const outcomeRaw = fromSqlNullable(row.outcome)

  return {
    id: row.id as AttemptId,
    taskId: row.task_id as TaskId,
    n: row.n,
    agent: row.agent,
    provider: row.provider,
    model: row.model,
    contextDigest: row.context_digest,
    workspaceId: row.workspace_id as WorkspaceId,
    startedAt: row.started_at,
    ...(finishedAt === undefined ? {} : { finishedAt }),
    ...(outcomeRaw === undefined ? {} : { outcome: JSON.parse(outcomeRaw) as AttemptOutcome }),
    usage: fromSqlJson<TokenUsage>(row.usage, EMPTY_USAGE),
    cost: moneyFromMicros(row.cost_micros),
  }
}
