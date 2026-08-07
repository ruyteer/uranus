import type { MemoryId } from '../ids.js'
import type { Result } from '../result.js'
import type {
  CompactionPolicy,
  CompactionReport,
  MemoryDraft,
  MemoryQuery,
  MemoryRecord,
  MemoryScope,
  RevalidationReport,
} from '../domain/memory.js'

/**
 * Persistência de memória semântica.
 *
 * Implementação padrão: Markdown + frontmatter em `.uranus/memory/` (ADR-004).
 * A escolha é deliberada — memória precisa ser legível, editável à mão e
 * versionável em git, porque supervisão humana sobre um banco binário opaco é
 * ficção. O índice de busca é derivado, não a fonte.
 */
export interface MemoryStore {
  /**
   * Escreve um registro. Aplica dedupe por `key` e detecção de contradição.
   *
   * Um fato novo que contradiz um existente **não sobrescreve**: cria supersessão
   * e emite `MemoryConflictDetected`. Sobrescrever silenciosamente é como uma
   * memória errada gravada cedo envenena todas as decisões seguintes (R9).
   */
  put(draft: MemoryDraft): Promise<Result<MemoryRecord>>

  get(id: MemoryId): Promise<MemoryRecord | undefined>
  getByKey(scope: MemoryScope, key: string): Promise<MemoryRecord | undefined>
  query(query: MemoryQuery): Promise<readonly MemoryRecord[]>

  supersede(id: MemoryId, by: MemoryId, reason: string): Promise<Result<void>>

  /** Invalida registros cujos `CodeRef.checksum` não batem mais com o disco. */
  revalidate(signal: AbortSignal): Promise<RevalidationReport>

  compact(scope: MemoryScope, policy: CompactionPolicy): Promise<CompactionReport>

  export(): AsyncIterable<MemoryRecord>
  close(): Promise<void>
}

/**
 * Curadoria. Agentes **não** escrevem direto no store — passam por aqui, que é
 * onde dedupe, contradição e confiança são aplicados de forma uniforme.
 */
export interface MemoryManager {
  remember(drafts: readonly MemoryDraft[]): Promise<readonly MemoryRecord[]>
  recall(query: MemoryQuery): Promise<readonly MemoryRecord[]>
  /** Compacta escopos acima do orçamento. Chamado na fase `learn` do tick. */
  maintain(signal: AbortSignal): Promise<readonly CompactionReport[]>
}
