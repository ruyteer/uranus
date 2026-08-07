import type { Glob, Lease, Result, TaskId } from '@uranus/core'
import { ConflictError, err, globsIntersect, ok } from '@uranus/core'
import type { SqlValue, SqliteDriver } from './driver.js'
import { fromSqlJson, toSqlJson } from './driver.js'

interface LeaseRow extends Record<string, SqlValue> {
  task_id: string
  owner: string
  acquired_at: number
  expires_at: number
  paths: string
}

/**
 * Armazenamento de leases.
 *
 * Duas responsabilidades que precisam viver juntas para serem atômicas:
 *  1. exclusividade por task
 *  2. exclusividade por *conjunto de arquivos* (R6 — merge hell)
 *
 * Separá-las abriria uma janela entre "verifiquei que não conflita" e "gravei o
 * lease" em que outra task poderia tomar os mesmos arquivos.
 */
export interface LeaseStore {
  acquire(
    taskId: TaskId,
    owner: string,
    paths: readonly Glob[],
    ttlMs: number,
    now: number,
  ): Result<Lease>
  renew(lease: Lease, ttlMs: number, now: number): Result<Lease>
  release(taskId: TaskId): Result<void>
  active(now: number): readonly Lease[]
  /** Remove leases vencidos e devolve as tasks afetadas. Chamado a cada tick. */
  reapExpired(now: number): readonly TaskId[]
  conflicts(paths: readonly Glob[], now: number, exclude?: TaskId): readonly Lease[]
}

export function createLeaseStore(db: SqliteDriver): LeaseStore {
  const insert = db.prepare(
    'INSERT INTO leases (task_id, owner, acquired_at, expires_at, paths) VALUES (?, ?, ?, ?, ?)',
  )
  const update = db.prepare('UPDATE leases SET expires_at = ? WHERE task_id = ? AND owner = ?')
  const remove = db.prepare('DELETE FROM leases WHERE task_id = ?')
  const selectActive = db.prepare('SELECT * FROM leases WHERE expires_at > ?')
  const selectExpired = db.prepare('SELECT task_id FROM leases WHERE expires_at <= ?')
  const deleteExpired = db.prepare('DELETE FROM leases WHERE expires_at <= ?')
  const selectOne = db.prepare('SELECT * FROM leases WHERE task_id = ?')

  const activeLeases = (now: number): Lease[] => selectActive.all<LeaseRow>(now).map(toLease)

  const findConflicts = (paths: readonly Glob[], now: number, exclude?: TaskId): readonly Lease[] =>
    activeLeases(now).filter(
      (lease) => lease.taskId !== exclude && globsIntersect(lease.paths, paths),
    )

  return {
    acquire(taskId, owner, paths, ttlMs, now): Result<Lease> {
      return db.transaction(() => {
        const existing = selectOne.get<LeaseRow>(taskId)
        if (existing !== undefined && existing.expires_at > now) {
          return err(
            new ConflictError('Task já possui lease ativo', {
              context: { taskId, owner: existing.owner },
            }),
          )
        }
        if (existing !== undefined) remove.run(taskId)

        const blocking = findConflicts(paths, now, taskId)
        if (blocking.length > 0) {
          return err(
            new ConflictError('Conflito de propriedade de arquivo com task em execução', {
              context: {
                taskId,
                conflictsWith: blocking.map((l) => l.taskId),
              },
            }),
          )
        }

        const lease: Lease = {
          taskId,
          owner,
          acquiredAt: now,
          expiresAt: now + ttlMs,
          paths,
        }
        insert.run(taskId, owner, lease.acquiredAt, lease.expiresAt, toSqlJson(paths))
        return ok(lease)
      })
    },

    renew(lease, ttlMs, now): Result<Lease> {
      const expiresAt = now + ttlMs
      const result = update.run(expiresAt, lease.taskId, lease.owner)
      if (result.changes === 0) {
        return err(
          new ConflictError('Lease não encontrado ou pertence a outro owner', {
            context: { taskId: lease.taskId, owner: lease.owner },
          }),
        )
      }
      return ok({ ...lease, expiresAt })
    },

    release(taskId): Result<void> {
      remove.run(taskId)
      return ok()
    },

    active(now): readonly Lease[] {
      return activeLeases(now)
    },

    reapExpired(now): readonly TaskId[] {
      return db.transaction(() => {
        const expired = selectExpired.all<{ task_id: string }>(now).map((r) => r.task_id as TaskId)
        if (expired.length > 0) deleteExpired.run(now)
        return expired
      })
    },

    conflicts(paths, now, exclude): readonly Lease[] {
      return findConflicts(paths, now, exclude)
    },
  }
}

function toLease(row: LeaseRow): Lease {
  return {
    taskId: row.task_id as TaskId,
    owner: row.owner,
    acquiredAt: row.acquired_at,
    expiresAt: row.expires_at,
    paths: fromSqlJson<Glob[]>(row.paths, []),
  }
}
