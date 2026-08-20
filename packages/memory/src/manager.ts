import type {
  CompactionReport,
  EventBus,
  Logger,
  MemoryDraft,
  MemoryManager,
  MemoryQuery,
  MemoryRecord,
  MemoryScope,
  MemoryStore,
} from '@uranus/core'
import { MEMORY_SCOPES } from '@uranus/core'

export interface DefaultMemoryManagerOptions {
  readonly store: MemoryStore
  readonly events: EventBus
  readonly logger: Logger
  readonly maxRecordsPerScope: number
  readonly minConfidence: number
  /**
   * Registros supersedidos há mais que isto são removidos do disco e do
   * cache em processo a cada `maintain()` (Fase 9). Default generoso (30
   * dias) — o objetivo é limitar crescimento num run muito longo, não
   * apagar histórico recente que ainda pode interessar a um humano.
   */
  readonly pruneSupersededOlderThanMs?: number
}

const DEFAULT_PRUNE_SUPERSEDED_OLDER_THAN_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Curadoria de memória — a única porta de escrita para agentes (R9).
 *
 * O que o manager acrescenta sobre o store:
 *  - dedupe dentro do lote (dois drafts com a mesma chave: vence o de maior
 *    confiança);
 *  - piso de confiança: rascunho abaixo do mínimo não vira memória — evita que
 *    palpites de baixa qualidade se acumulem até a compactação;
 *  - contradição vira EVENTO: quando um fato novo supersede um antigo de
 *    confiança comparável, `MemoryConflictDetected` vai para a fila de revisão
 *    humana em vez de ser resolvido silenciosamente.
 */
export class DefaultMemoryManager implements MemoryManager {
  private readonly store: MemoryStore
  private readonly events: EventBus
  private readonly logger: Logger
  private readonly maxRecordsPerScope: number
  private readonly minConfidence: number
  private readonly pruneSupersededOlderThanMs: number

  constructor(options: DefaultMemoryManagerOptions) {
    this.store = options.store
    this.events = options.events
    this.logger = options.logger.child({ component: 'memory-manager' })
    this.maxRecordsPerScope = options.maxRecordsPerScope
    this.minConfidence = options.minConfidence
    this.pruneSupersededOlderThanMs =
      options.pruneSupersededOlderThanMs ?? DEFAULT_PRUNE_SUPERSEDED_OLDER_THAN_MS
  }

  async remember(drafts: readonly MemoryDraft[]): Promise<readonly MemoryRecord[]> {
    const admitted = new Map<string, MemoryDraft>()
    for (const draft of drafts) {
      if (draft.confidence < this.minConfidence) {
        this.logger.debug('Rascunho de memória abaixo do piso de confiança; descartado', {
          scope: draft.scope,
          key: draft.key,
          confidence: draft.confidence,
        })
        continue
      }
      const dedupeKey = `${draft.scope}:${draft.key}`
      const current = admitted.get(dedupeKey)
      if (current === undefined || draft.confidence > current.confidence) {
        admitted.set(dedupeKey, draft)
      }
    }

    const saved: MemoryRecord[] = []
    for (const draft of admitted.values()) {
      const existing = await this.store.getByKey(draft.scope, draft.key)
      const result = await this.store.put(draft)
      if (!result.ok) {
        this.logger.warn('Falha ao gravar memória', {
          scope: draft.scope,
          key: draft.key,
          error: result.error.message,
        })
        continue
      }
      saved.push(result.value)

      // Supersessão real (não idempotente) com confiança comparável = o novo
      // fato CONTRADIZ o antigo sem autoridade clara. Humano decide.
      const superseded = existing !== undefined && result.value.supersedes === existing.id
      if (superseded && Math.abs(existing.confidence - draft.confidence) < 0.2) {
        await this.events.emit('MemoryConflictDetected', {
          scope: draft.scope,
          key: draft.key,
          existingId: existing.id,
          reason: `novo registro (confiança ${String(draft.confidence)}) contradiz o anterior (${String(existing.confidence)})`,
        })
      }

      await this.events.emit('MemoryUpdated', {
        memoryId: result.value.id,
        scope: result.value.scope,
        key: result.value.key,
        confidence: result.value.confidence,
      })
    }
    return saved
  }

  recall(query: MemoryQuery): Promise<readonly MemoryRecord[]> {
    return this.store.query(query)
  }

  /** Fase `learn` do tick: revalida refs e compacta escopos acima do orçamento. */
  async maintain(signal: AbortSignal): Promise<readonly CompactionReport[]> {
    const revalidation = await this.store.revalidate(signal)
    for (const id of revalidation.invalidated) {
      await this.events.emit('MemoryInvalidated', {
        memoryId: id,
        reason: 'código referenciado mudou (checksum divergente)',
      })
    }

    const reports: CompactionReport[] = []
    for (const scope of MEMORY_SCOPES) {
      const active = await this.store.query({ scopes: [scope], limit: this.maxRecordsPerScope + 1 })
      if (active.length <= this.maxRecordsPerScope) continue
      const report = await this.store.compact(scope, {
        maxRecords: this.maxRecordsPerScope,
        minConfidence: this.minConfidence,
      })
      if (report.merged.length > 0) {
        await this.events.emit('MemoryCompacted', {
          scope,
          before: report.before,
          after: report.after,
        })
        reports.push(report)
      }
    }

    const pruned = await this.store.pruneSuperseded?.(this.pruneSupersededOlderThanMs)
    if (pruned !== undefined && pruned > 0) {
      this.logger.debug('Registros supersedidos antigos removidos', { count: pruned })
    }

    return reports
  }
}

export function scopesOf(records: readonly MemoryRecord[]): readonly MemoryScope[] {
  return [...new Set(records.map((record) => record.scope))]
}
