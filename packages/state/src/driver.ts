/**
 * Driver SQLite abstrato.
 *
 * A implementação padrão usa `node:sqlite` (builtin do Node ≥ 22) em vez de
 * `better-sqlite3`. O motivo é R10: `better-sqlite3` é módulo nativo e exige
 * toolchain de compilação no Windows — uma barreira de instalação real para o
 * ambiente-alvo primário. A abstração existe para que trocar seja uma linha, e
 * não uma refatoração (ADR-004, sem lock-in de esquema).
 */

export type SqlValue = string | number | bigint | null | Uint8Array

export interface SqlStatement {
  run(...params: readonly SqlValue[]): { changes: number; lastInsertRowid: number | bigint }
  get<T = Record<string, SqlValue>>(...params: readonly SqlValue[]): T | undefined
  all<T = Record<string, SqlValue>>(...params: readonly SqlValue[]): T[]
}

export interface SqliteDriver {
  exec(sql: string): void
  prepare(sql: string): SqlStatement
  /** Transação síncrona. Rollback automático se `fn` lançar. */
  transaction<T>(fn: () => T): T
  close(): void
  readonly open: boolean
}

/** Booleanos não são um tipo nativo do SQLite. Conversão explícita nos dois sentidos. */
export function toSqlBool(value: boolean): number {
  return value ? 1 : 0
}

export function fromSqlBool(value: SqlValue | undefined): boolean {
  return value === 1 || value === '1' || value === 1n
}

export function toSqlJson(value: unknown): string {
  return JSON.stringify(value ?? null)
}

export function fromSqlJson<T>(value: SqlValue | undefined, fallback: T): T {
  if (typeof value !== 'string' || value.length === 0) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export function toSqlNullable(value: string | undefined): string | null {
  return value ?? null
}

export function fromSqlNullable(value: SqlValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function toSqlNumber(value: number | undefined): number | null {
  return value ?? null
}

export function fromSqlNumber(value: SqlValue | undefined): number | undefined {
  return typeof value === 'number' ? value : undefined
}
