import { DatabaseSync } from 'node:sqlite'
import { StateError } from '@uranus/core'
import type { SqlStatement, SqlValue, SqliteDriver } from './driver.js'

export interface NodeSqliteOptions {
  readonly path: string
  /**
   * WAL permite leitura concorrente durante escrita — necessário para o dashboard
   * consultar o estado enquanto o kernel trabalha.
   */
  readonly wal?: boolean
  readonly busyTimeoutMs?: number
  readonly readOnly?: boolean
}

export function openSqlite(options: NodeSqliteOptions): SqliteDriver {
  let db: DatabaseSync
  try {
    db = new DatabaseSync(options.path, { readOnly: options.readOnly ?? false })
  } catch (error: unknown) {
    throw new StateError(`Falha ao abrir o banco de estado: ${options.path}`, {
      cause: error,
      context: { path: options.path },
    })
  }

  if (options.readOnly !== true) {
    db.exec(`PRAGMA journal_mode = ${options.wal === false ? 'DELETE' : 'WAL'};`)
    db.exec('PRAGMA synchronous = NORMAL;')
    db.exec('PRAGMA foreign_keys = ON;')
    db.exec(`PRAGMA busy_timeout = ${String(options.busyTimeoutMs ?? 5_000)};`)
  }

  let closed = false
  let depth = 0

  return {
    get open(): boolean {
      return !closed
    },

    exec(sql: string): void {
      db.exec(sql)
    },

    prepare(sql: string): SqlStatement {
      const stmt = db.prepare(sql)
      return {
        run(...params: readonly SqlValue[]) {
          const result = stmt.run(...(params as SqlValue[]))
          return {
            changes: Number(result.changes),
            lastInsertRowid: result.lastInsertRowid,
          }
        },
        get<T>(...params: readonly SqlValue[]): T | undefined {
          return stmt.get(...(params as SqlValue[])) as T | undefined
        },
        all<T>(...params: readonly SqlValue[]): T[] {
          return stmt.all(...(params as SqlValue[])) as T[]
        },
      }
    },

    /**
     * Transações aninhadas viram savepoints. O kernel compõe operações
     * (salvar task + registrar attempt + expirar lease) e cada uma quer sua
     * própria atomicidade; sem savepoint, um `BEGIN` aninhado seria erro.
     */
    transaction<T>(fn: () => T): T {
      const savepoint = `sp_${String(depth)}`
      db.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`)
      depth++
      try {
        const result = fn()
        depth--
        db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${savepoint}`)
        return result
      } catch (error: unknown) {
        depth--
        try {
          db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}`)
        } catch {
          // Rollback falhou: o erro original é o que importa reportar.
        }
        throw error
      }
    },

    close(): void {
      if (closed) return
      closed = true
      db.close()
    },
  }
}
