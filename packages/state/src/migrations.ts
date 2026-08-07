import type { SqliteDriver } from './driver.js'

/**
 * Migrations versionadas e ordenadas.
 *
 * `down` é opcional mas encorajado: sem reversão, um upgrade ruim no meio de um
 * run de 8 horas não tem saída além de restaurar backup — e o estado quente é
 * justamente o que não está no git.
 */
export interface Migration {
  readonly version: number
  readonly name: string
  readonly up: string
  readonly down?: string
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'init',
    up: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     INTEGER PRIMARY KEY,
        name        TEXT    NOT NULL,
        applied_at  INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS runs (
        id           TEXT    PRIMARY KEY,
        project_id   TEXT    NOT NULL,
        started_at   INTEGER NOT NULL,
        finished_at  INTEGER,
        status       TEXT    NOT NULL,
        tick         INTEGER NOT NULL DEFAULT 0,
        stop_reason  TEXT,
        resumed_from TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);

      CREATE TABLE IF NOT EXISTS tasks (
        id            TEXT    PRIMARY KEY,
        project_id    TEXT    NOT NULL,
        plan_id       TEXT,
        kind          TEXT    NOT NULL,
        title         TEXT    NOT NULL,
        intent        TEXT    NOT NULL,
        state         TEXT    NOT NULL,
        priority      INTEGER NOT NULL DEFAULT 0,
        deps          TEXT    NOT NULL DEFAULT '[]',
        touches       TEXT    NOT NULL DEFAULT '[]',
        acceptance    TEXT    NOT NULL,
        agent_hint    TEXT,
        attempts      INTEGER NOT NULL DEFAULT 0,
        max_attempts  INTEGER NOT NULL DEFAULT 3,
        block_reason  TEXT,
        labels        TEXT    NOT NULL DEFAULT '[]',
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_state    ON tasks(state);
      CREATE INDEX IF NOT EXISTS idx_tasks_kind     ON tasks(kind);
      CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(state, priority DESC);

      CREATE TABLE IF NOT EXISTS attempts (
        id             TEXT    PRIMARY KEY,
        task_id        TEXT    NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        n              INTEGER NOT NULL,
        agent          TEXT    NOT NULL,
        provider       TEXT    NOT NULL,
        model          TEXT    NOT NULL,
        context_digest TEXT    NOT NULL,
        workspace_id   TEXT    NOT NULL,
        started_at     INTEGER NOT NULL,
        finished_at    INTEGER,
        outcome        TEXT,
        usage          TEXT    NOT NULL,
        cost_micros    INTEGER NOT NULL DEFAULT 0,
        UNIQUE (task_id, n)
      );
      CREATE INDEX IF NOT EXISTS idx_attempts_task ON attempts(task_id, n);

      -- Lease com TTL. Ver comentário em contracts/queue.ts: o TTL é a garantia
      -- de recuperação após um kill -9, não uma otimização.
      CREATE TABLE IF NOT EXISTS leases (
        task_id     TEXT    PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
        owner       TEXT    NOT NULL,
        acquired_at INTEGER NOT NULL,
        expires_at  INTEGER NOT NULL,
        paths       TEXT    NOT NULL DEFAULT '[]'
      );
      CREATE INDEX IF NOT EXISTS idx_leases_expires ON leases(expires_at);

      CREATE TABLE IF NOT EXISTS checkpoints (
        id           TEXT    PRIMARY KEY,
        run_id       TEXT    NOT NULL,
        seq          INTEGER NOT NULL,
        at           INTEGER NOT NULL,
        event_offset INTEGER NOT NULL,
        path         TEXT    NOT NULL,
        digest       TEXT    NOT NULL,
        UNIQUE (run_id, seq)
      );
      CREATE INDEX IF NOT EXISTS idx_checkpoints_run ON checkpoints(run_id, seq DESC);

      CREATE TABLE IF NOT EXISTS metrics (
        id     INTEGER PRIMARY KEY AUTOINCREMENT,
        at     INTEGER NOT NULL,
        name   TEXT    NOT NULL,
        value  REAL    NOT NULL,
        labels TEXT    NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_metrics_name ON metrics(name, at);
    `,
    down: `
      DROP TABLE IF EXISTS metrics;
      DROP TABLE IF EXISTS checkpoints;
      DROP TABLE IF EXISTS leases;
      DROP TABLE IF EXISTS attempts;
      DROP TABLE IF EXISTS tasks;
      DROP TABLE IF EXISTS runs;
      DROP TABLE IF EXISTS schema_migrations;
    `,
  },
]

export interface MigrationResult {
  readonly applied: readonly number[]
  readonly currentVersion: number
}

export function currentVersion(db: SqliteDriver): number {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT    NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `)
  const row = db
    .prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations')
    .get<{ v: number }>()
  return row?.v ?? 0
}

export function migrate(
  db: SqliteDriver,
  now: number,
  migrations: readonly Migration[] = MIGRATIONS,
): MigrationResult {
  const from = currentVersion(db)
  const pending = migrations.filter((m) => m.version > from).sort((a, b) => a.version - b.version)
  const applied: number[] = []

  for (const migration of pending) {
    db.transaction(() => {
      db.exec(migration.up)
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        migration.version,
        migration.name,
        now,
      )
    })
    applied.push(migration.version)
  }

  return { applied, currentVersion: currentVersion(db) }
}
