import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  Clock,
  CompactionPolicy,
  CompactionReport,
  Logger,
  MemoryDraft,
  MemoryId,
  MemoryQuery,
  MemoryRecord,
  MemoryScope,
  MemoryStore,
  ProjectId,
  Result,
  RevalidationReport,
} from '@uranus/core'
import {
  MEMORY_SCOPES,
  NotFoundError,
  compareForRetention,
  err,
  hashText,
  isActiveMemory,
  newMemoryId,
  ok,
  toNative,
} from '@uranus/core'
import { openSqlite, type SqliteDriver } from '@uranus/state'
import { keyToFilename, parseRecord, recordChecksum, serializeRecord } from './frontmatter.js'
import { MemorySearchIndex } from './search-index.js'

export interface MarkdownMemoryStoreOptions {
  /** `.uranus/memory` — commitável, legível, editável (ADR-004). */
  readonly dir: string
  /** Raiz do projeto, para revalidar `CodeRef` por checksum. */
  readonly projectRootDir: string
  readonly projectId: ProjectId
  readonly clock: Clock
  readonly logger: Logger
  /** Caminho do índice derivado. `:memory:` em testes. */
  readonly indexPath?: string
}

/**
 * Store de memória em Markdown + frontmatter.
 *
 * Regras de escrita (R9):
 *  - `put` com a mesma (scope, key) e mesmo conteúdo é idempotente.
 *  - Conteúdo diferente NUNCA sobrescreve: cria registro novo com `supersedes`
 *    apontando para o antigo, e o antigo ganha `supersededBy`. O histórico
 *    inteiro fica no diretório; o que muda é qual registro está ativo.
 *  - Arquivo editado à mão é detectado por checksum e reindexado como está —
 *    a correção humana vence.
 */
export class MarkdownMemoryStore implements MemoryStore {
  private readonly dir: string
  private readonly projectRootDir: string
  private readonly projectId: ProjectId
  private readonly clock: Clock
  private readonly logger: Logger
  private readonly db: SqliteDriver
  private readonly index: MemorySearchIndex

  /** Cache em memória: id → registro. Fonte continua sendo o disco. */
  private records = new Map<MemoryId, MemoryRecord>()
  private loaded = false

  constructor(options: MarkdownMemoryStoreOptions) {
    this.dir = options.dir
    this.projectRootDir = options.projectRootDir
    this.projectId = options.projectId
    this.clock = options.clock
    this.logger = options.logger.child({ component: 'memory' })
    this.db = openSqlite({ path: options.indexPath ?? ':memory:', wal: false })
    this.index = new MemorySearchIndex(this.db)
  }

  // ── Carga ─────────────────────────────────────────────────────────────────

  private async load(): Promise<void> {
    if (this.loaded) return
    this.records = new Map()
    for (const scope of MEMORY_SCOPES) {
      const scopeDir = join(this.dir, scope)
      let files: string[]
      try {
        files = await readdir(scopeDir)
      } catch {
        continue
      }
      for (const file of files) {
        if (!file.endsWith('.md')) continue
        try {
          const raw = await readFile(join(scopeDir, file), 'utf8')
          const parsed = parseRecord(raw)
          if (parsed === undefined) {
            this.logger.warn('Arquivo de memória ilegível; ignorado', { file })
            continue
          }
          // Edição manual: o checksum gravado não bate com o conteúdo atual.
          // O conteúdo do arquivo vence — recalculamos e seguimos.
          const actual = recordChecksum(parsed)
          const record = actual === parsed.checksum ? parsed : { ...parsed, checksum: actual }
          this.records.set(record.id, record)
        } catch {
          /* arquivo sumiu no meio: ignora */
        }
      }
    }
    this.index.rebuild([...this.records.values()])
    this.loaded = true
  }

  /** Recarrega do disco (usado após edição manual em sessão longa). */
  async reload(): Promise<void> {
    this.loaded = false
    await this.load()
  }

  // ── Escrita ───────────────────────────────────────────────────────────────

  async put(draft: MemoryDraft): Promise<Result<MemoryRecord>> {
    await this.load()
    const now = this.clock.now()

    const existing = this.activeByKey(draft.scope, draft.key)
    const checksum = recordChecksum(draft)

    if (existing?.checksum === checksum) {
      return ok(existing) // idempotente
    }

    const record: MemoryRecord = {
      ...draft,
      id: newMemoryId(now),
      projectId: this.projectId,
      validFrom: now,
      checksum,
      ...(existing === undefined ? {} : { supersedes: existing.id }),
    }

    const written = await this.write(record)
    if (!written.ok) return written

    if (existing !== undefined) {
      const superseded: MemoryRecord = { ...existing, supersededBy: record.id }
      const supersededWrite = await this.write(superseded)
      if (!supersededWrite.ok) return supersededWrite
      this.index.remove(existing.id)
    }

    this.index.upsert(record)
    return ok(record)
  }

  private async write(record: MemoryRecord): Promise<Result<MemoryRecord>> {
    const scopeDir = join(this.dir, record.scope)
    await mkdir(scopeDir, { recursive: true })
    // Registros supersedidos ficam em arquivo próprio sufixado pelo id curto —
    // o arquivo "principal" da chave sempre aponta para o registro ativo.
    const active = record.supersededBy === undefined
    const filename = active
      ? keyToFilename(record.key)
      : `${keyToFilename(record.key).replace(/\.md$/, '')}.${record.id.slice(-8)}.md`
    try {
      await writeFile(join(scopeDir, filename), serializeRecord(record))
      this.records.set(record.id, record)
      return ok(record)
    } catch (error: unknown) {
      return err(
        new NotFoundError('Falha ao gravar memória', {
          cause: error,
          context: { scope: record.scope, key: record.key },
        }),
      )
    }
  }

  // ── Leitura ───────────────────────────────────────────────────────────────

  async get(id: MemoryId): Promise<MemoryRecord | undefined> {
    await this.load()
    return this.records.get(id)
  }

  async getByKey(scope: MemoryScope, key: string): Promise<MemoryRecord | undefined> {
    await this.load()
    return this.activeByKey(scope, key)
  }

  private activeByKey(scope: MemoryScope, key: string): MemoryRecord | undefined {
    for (const record of this.records.values()) {
      if (
        record.scope === scope &&
        record.key === key &&
        isActiveMemory(record, this.clock.now())
      ) {
        return record
      }
    }
    return undefined
  }

  async query(query: MemoryQuery): Promise<readonly MemoryRecord[]> {
    await this.load()
    const now = this.clock.now()
    let candidates = [...this.records.values()]

    if (query.includeSuperseded !== true) {
      candidates = candidates.filter((record) => isActiveMemory(record, now))
    }
    if (query.scopes !== undefined && query.scopes.length > 0) {
      const scopes = new Set(query.scopes)
      candidates = candidates.filter((record) => scopes.has(record.scope))
    }
    if (query.tags !== undefined && query.tags.length > 0) {
      candidates = candidates.filter((record) =>
        query.tags!.some((tag) => record.tags.includes(tag)),
      )
    }
    if (query.minConfidence !== undefined) {
      candidates = candidates.filter((record) => record.confidence >= query.minConfidence!)
    }

    if (query.text !== undefined && query.text.trim() !== '') {
      const ranked = this.index.search(query.text, query.scopes, query.limit ?? 50)
      const rank = new Map(ranked.map((id, position) => [id, position]))
      candidates = candidates
        .filter((record) => rank.has(record.id))
        .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
    } else {
      candidates.sort(compareForRetention)
    }

    return candidates.slice(0, query.limit ?? 100)
  }

  // ── Manutenção ────────────────────────────────────────────────────────────

  async supersede(id: MemoryId, by: MemoryId, _reason: string): Promise<Result<void>> {
    await this.load()
    const record = this.records.get(id)
    if (record === undefined) {
      return err(new NotFoundError('Memória não encontrada', { context: { id } }))
    }
    const written = await this.write({ ...record, supersededBy: by })
    if (!written.ok) return err(written.error)
    this.index.remove(id)
    return ok()
  }

  /**
   * Invalida registros cujos `CodeRef` não batem mais com o disco (R9).
   * Memória que referencia código que mudou está falando de uma realidade que
   * não existe — mantê-la ativa envenenaria toda decisão seguinte.
   */
  async revalidate(_signal: AbortSignal): Promise<RevalidationReport> {
    await this.load()
    const now = this.clock.now()
    const invalidated: MemoryId[] = []
    const missingFiles: string[] = []
    let checked = 0

    for (const record of this.records.values()) {
      if (!isActiveMemory(record, now) || record.refs.length === 0) continue
      checked++
      let stale = false
      for (const ref of record.refs) {
        try {
          const content = await readFile(join(this.projectRootDir, toNative(ref.path)), 'utf8')
          if (hashText(content) !== ref.checksum) {
            stale = true
            break
          }
        } catch {
          missingFiles.push(ref.path)
          stale = true
          break
        }
      }
      if (stale) {
        await this.write({ ...record, validUntil: now })
        this.index.remove(record.id)
        invalidated.push(record.id)
      }
    }

    if (invalidated.length > 0) {
      this.logger.info('Memória invalidada por mudança de código', {
        count: invalidated.length,
      })
    }
    return { checked, invalidated, missingFiles: [...new Set(missingFiles)] }
  }

  /**
   * Compacta um escopo acima do orçamento: mantém os melhores registros
   * (confiança > recência) e funde os demais em um resumo `derived`.
   * Os originais são supersedidos, nunca apagados — o histórico fica no git.
   */
  async compact(scope: MemoryScope, policy: CompactionPolicy): Promise<CompactionReport> {
    await this.load()
    const now = this.clock.now()
    const active = [...this.records.values()]
      .filter((record) => record.scope === scope && isActiveMemory(record, now))
      .sort(compareForRetention)

    const cutByAge =
      policy.olderThanMs === undefined
        ? active
        : active.filter(
            (record, position) =>
              position < policy.maxRecords || now - record.validFrom > policy.olderThanMs!,
          )
    const keep = cutByAge.slice(0, policy.maxRecords)
    const merge = cutByAge
      .slice(policy.maxRecords)
      .concat(active.filter((r) => r.confidence < policy.minConfidence && !keep.includes(r)))
    const unique = [...new Set(merge)].filter((r) => !keep.includes(r))

    if (unique.length === 0) {
      return { scope, before: active.length, after: active.length, merged: [], dropped: [] }
    }

    const summaryBody = unique
      .map(
        (record) =>
          `- **${record.title}** (confiança ${record.confidence}): ${firstLine(record.body)}`,
      )
      .join('\n')

    const summary = await this.put({
      scope,
      key: `compactado-${String(now)}`,
      title: `Resumo de compactação (${String(unique.length)} registros)`,
      body: `Registros de baixa prioridade fundidos automaticamente:\n\n${summaryBody}`,
      tags: ['compactado'],
      confidence: Math.max(...unique.map((r) => r.confidence)),
      source: { kind: 'derived', ref: `compaction@${String(now)}` },
      refs: [],
    })

    const merged: MemoryId[] = []
    if (summary.ok) {
      for (const record of unique) {
        await this.supersede(record.id, summary.value.id, 'compactação')
        merged.push(record.id)
      }
    }

    return {
      scope,
      before: active.length,
      after: keep.length + 1,
      merged,
      dropped: [],
    }
  }

  async *export(): AsyncIterable<MemoryRecord> {
    await this.load()
    for (const record of this.records.values()) yield record
  }

  close(): Promise<void> {
    this.db.close()
    return Promise.resolve()
  }

  /** Remove arquivos de registros supersedidos antigos. Uso via CLI, opt-in. */
  async pruneSuperseded(olderThanMs: number): Promise<number> {
    await this.load()
    const now = this.clock.now()
    let removed = 0
    for (const record of [...this.records.values()]) {
      if (record.supersededBy === undefined) continue
      if (now - record.validFrom < olderThanMs) continue
      const filename = `${keyToFilename(record.key).replace(/\.md$/, '')}.${record.id.slice(-8)}.md`
      await unlink(join(this.dir, record.scope, filename)).catch(() => undefined)
      this.records.delete(record.id)
      removed++
    }
    return removed
  }
}

function firstLine(text: string): string {
  return text.split('\n')[0]?.slice(0, 200) ?? ''
}
