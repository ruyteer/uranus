import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AttemptRepository, RunRepository, TaskRepository } from '@uranus/core'
import type { SqliteDriver } from './driver.js'
import { openSqlite } from './node-sqlite-driver.js'
import { migrate, type MigrationResult } from './migrations.js'
import { createLeaseStore, type LeaseStore } from './leases.js'
import { createTaskRepository } from './repositories/task-repository.js'
import { createAttemptRepository } from './repositories/attempt-repository.js'
import { createRunRepository } from './repositories/run-repository.js'

export interface StateStore {
  readonly db: SqliteDriver
  readonly tasks: TaskRepository
  readonly attempts: AttemptRepository
  readonly runs: RunRepository
  readonly leases: LeaseStore
  readonly migrations: MigrationResult
  close(): void
}

export interface OpenStateOptions {
  /** Caminho do arquivo `.db`, ou `:memory:` para testes. */
  readonly path: string
  readonly now: number
  readonly wal?: boolean
}

export function stateDbPath(uranusDir: string): string {
  return join(uranusDir, 'state.db')
}

/**
 * Abre (e migra) o estado quente.
 *
 * A migração acontece no `open` e não em um comando separado por decisão: um
 * kernel que roda por horas não pode descobrir no meio do trabalho que o schema
 * está atrasado. Falhar aqui é falhar cedo.
 */
export function openState(options: OpenStateOptions): StateStore {
  if (options.path !== ':memory:') {
    mkdirSync(dirname(options.path), { recursive: true })
  }

  const db = openSqlite({
    path: options.path,
    // `:memory:` não tem arquivo para WAL escrever.
    wal: options.wal ?? options.path !== ':memory:',
  })

  const migrations = migrate(db, options.now)

  return {
    db,
    migrations,
    tasks: createTaskRepository(db),
    attempts: createAttemptRepository(db),
    runs: createRunRepository(db),
    leases: createLeaseStore(db),
    close(): void {
      db.close()
    },
  }
}
