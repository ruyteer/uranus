import type { MemoryId, MemoryRecord, MemoryScope } from '@uranus/core'
import type { SqliteDriver } from '@uranus/state'

/**
 * Índice de busca lexical sobre a memória.
 *
 * O índice é **derivado e descartável**: os arquivos Markdown são a fonte da
 * verdade (ADR-004), e o índice é reconstruído do zero sempre que diverge.
 * Preferimos FTS5 (bm25); se o SQLite do runtime não tiver o módulo, cai para
 * LIKE — mais lento e sem ranking, mas funcional. A degradação é registrada,
 * não silenciosa.
 */
export class MemorySearchIndex {
  private fts: boolean

  constructor(private readonly db: SqliteDriver) {
    this.fts = this.tryCreateFts()
    if (!this.fts) this.createFallback()
  }

  get usingFts(): boolean {
    return this.fts
  }

  private tryCreateFts(): boolean {
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS mem_fts USING fts5(
          id UNINDEXED, scope UNINDEXED, title, body, tags,
          tokenize = 'unicode61 remove_diacritics 2'
        );
      `)
      return true
    } catch {
      return false
    }
  }

  private createFallback(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mem_plain (
        id    TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        title TEXT NOT NULL,
        body  TEXT NOT NULL,
        tags  TEXT NOT NULL
      );
    `)
  }

  rebuild(records: readonly MemoryRecord[]): void {
    this.db.transaction(() => {
      this.db.exec(this.fts ? 'DELETE FROM mem_fts' : 'DELETE FROM mem_plain')
      const insert = this.db.prepare(
        this.fts
          ? 'INSERT INTO mem_fts (id, scope, title, body, tags) VALUES (?, ?, ?, ?, ?)'
          : 'INSERT INTO mem_plain (id, scope, title, body, tags) VALUES (?, ?, ?, ?, ?)',
      )
      for (const record of records) {
        insert.run(record.id, record.scope, record.title, record.body, record.tags.join(' '))
      }
    })
  }

  upsert(record: MemoryRecord): void {
    this.remove(record.id)
    this.db
      .prepare(
        this.fts
          ? 'INSERT INTO mem_fts (id, scope, title, body, tags) VALUES (?, ?, ?, ?, ?)'
          : 'INSERT INTO mem_plain (id, scope, title, body, tags) VALUES (?, ?, ?, ?, ?)',
      )
      .run(record.id, record.scope, record.title, record.body, record.tags.join(' '))
  }

  remove(id: MemoryId): void {
    this.db
      .prepare(this.fts ? 'DELETE FROM mem_fts WHERE id = ?' : 'DELETE FROM mem_plain WHERE id = ?')
      .run(id)
  }

  /** Ids ordenados por relevância (bm25 no FTS; ordem de inserção no fallback). */
  search(text: string, scopes?: readonly MemoryScope[], limit = 50): readonly MemoryId[] {
    const scopeFilter =
      scopes === undefined || scopes.length === 0
        ? ''
        : ` AND scope IN (${scopes.map(() => '?').join(',')})`
    const scopeParams = scopes ?? []

    if (this.fts) {
      try {
        const rows = this.db
          .prepare(
            `SELECT id FROM mem_fts WHERE mem_fts MATCH ?${scopeFilter} ORDER BY bm25(mem_fts) LIMIT ?`,
          )
          .all<{ id: string }>(ftsQuery(text), ...scopeParams, limit)
        return rows.map((row) => row.id as MemoryId)
      } catch {
        // Sintaxe de MATCH inválida para o texto dado: sem resultados é melhor
        // que exceção — busca é auxiliar, não crítica.
        return []
      }
    }

    const like = `%${text.replace(/[%_]/g, '')}%`
    const rows = this.db
      .prepare(
        `SELECT id FROM mem_plain WHERE (title LIKE ? OR body LIKE ? OR tags LIKE ?)${scopeFilter} LIMIT ?`,
      )
      .all<{ id: string }>(like, like, like, ...scopeParams, limit)
    return rows.map((row) => row.id as MemoryId)
  }
}

/** Sanitiza texto livre para a sintaxe de query do FTS5 (termos AND). */
function ftsQuery(text: string): string {
  const terms = text
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}_-]/gu, ''))
    .filter((t) => t.length > 1)
    .slice(0, 8)
  return terms.length === 0 ? '""' : terms.map((t) => `"${t}"`).join(' ')
}
