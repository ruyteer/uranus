import type { ProjectId, Result, Run, RunId, RunRepository, RunStatus } from '@uranus/core'
import { StateError, err, ok } from '@uranus/core'
import type { SqlValue, SqliteDriver } from '../driver.js'
import { fromSqlNullable, fromSqlNumber, toSqlNullable, toSqlNumber } from '../driver.js'

interface RunRow extends Record<string, SqlValue> {
  id: string
  project_id: string
  started_at: number
  finished_at: number | null
  status: string
  tick: number
  stop_reason: string | null
  resumed_from: string | null
}

const COLUMNS = 'id, project_id, started_at, finished_at, status, tick, stop_reason, resumed_from'

/** Runs cujo processo morreu sem transição terminal. Entrada da recuperação (INV-4). */
const UNFINISHED_STATES = ['running', 'paused', 'stopping'] as const
const FINISHED_STATES = ['completed', 'failed'] as const

export function createRunRepository(db: SqliteDriver): RunRepository {
  const upsert = db.prepare(`
    INSERT INTO runs (${COLUMNS})
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      finished_at  = excluded.finished_at,
      status       = excluded.status,
      tick         = excluded.tick,
      stop_reason  = excluded.stop_reason
  `)
  const selectOne = db.prepare(`SELECT ${COLUMNS} FROM runs WHERE id = ?`)
  const selectLatest = db.prepare(`SELECT ${COLUMNS} FROM runs ORDER BY started_at DESC LIMIT 1`)
  const selectUnfinished = db.prepare(
    `SELECT ${COLUMNS} FROM runs WHERE status IN (${UNFINISHED_STATES.map(() => '?').join(', ')}) ORDER BY started_at ASC`,
  )
  const selectFinishedDesc = db.prepare(
    `SELECT id FROM runs WHERE status IN (${FINISHED_STATES.map(() => '?').join(', ')}) ORDER BY started_at DESC`,
  )

  return {
    save(run: Run): Promise<Result<void>> {
      try {
        upsert.run(
          run.id,
          run.projectId,
          run.startedAt,
          toSqlNumber(run.finishedAt),
          run.status,
          run.tick,
          toSqlNullable(run.stopReason),
          toSqlNullable(run.resumedFrom),
        )
        return Promise.resolve(ok())
      } catch (error: unknown) {
        return Promise.resolve(
          err(new StateError('Falha ao salvar run', { cause: error, context: { id: run.id } })),
        )
      }
    },

    find(id: RunId): Promise<Run | undefined> {
      const row = selectOne.get<RunRow>(id)
      return Promise.resolve(row === undefined ? undefined : toRun(row))
    },

    latest(): Promise<Run | undefined> {
      const row = selectLatest.get<RunRow>()
      return Promise.resolve(row === undefined ? undefined : toRun(row))
    },

    unfinished(): Promise<readonly Run[]> {
      return Promise.resolve(selectUnfinished.all<RunRow>(...UNFINISHED_STATES).map(toRun))
    },

    oldFinished(keepMostRecent: number): Promise<readonly RunId[]> {
      const rows = selectFinishedDesc.all<Pick<RunRow, 'id'>>(...FINISHED_STATES)
      const stale = rows.slice(Math.max(0, keepMostRecent))
      return Promise.resolve(stale.map((row) => row.id as RunId))
    },
  }
}

function toRun(row: RunRow): Run {
  const finishedAt = fromSqlNumber(row.finished_at)
  const stopReason = fromSqlNullable(row.stop_reason)
  const resumedFrom = fromSqlNullable(row.resumed_from)

  return {
    id: row.id as RunId,
    projectId: row.project_id as ProjectId,
    startedAt: row.started_at,
    ...(finishedAt === undefined ? {} : { finishedAt }),
    status: row.status as RunStatus,
    tick: row.tick,
    ...(stopReason === undefined ? {} : { stopReason }),
    ...(resumedFrom === undefined ? {} : { resumedFrom: resumedFrom as RunId }),
  }
}
