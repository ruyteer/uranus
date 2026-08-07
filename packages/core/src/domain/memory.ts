import type { MemoryId, ProjectId } from '../ids.js'

export type MemoryScope =
  | 'architecture'
  | 'decision'
  | 'bug'
  | 'preference'
  | 'stack'
  | 'pattern'
  | 'convention'
  | 'roadmap'
  | 'history'
  | 'context'

export const MEMORY_SCOPES: readonly MemoryScope[] = [
  'architecture',
  'decision',
  'bug',
  'preference',
  'stack',
  'pattern',
  'convention',
  'roadmap',
  'history',
  'context',
]

export interface MemorySource {
  readonly kind: 'agent' | 'human' | 'derived' | 'imported'
  /** runId, commit sha, caminho de arquivo — a evidência concreta. */
  readonly ref: string
}

/**
 * Referência a código. O `checksum` é o que permite invalidar memória quando o
 * arquivo referenciado muda (R9) — sem isso, o sistema "lembra" de código que
 * não existe mais e toma decisões sobre uma realidade obsoleta.
 */
export interface CodeRef {
  readonly path: string
  readonly checksum: string
  readonly range?: readonly [number, number]
}

export interface MemoryRecord {
  readonly id: MemoryId
  readonly projectId: ProjectId
  readonly scope: MemoryScope
  /** Slug estável. Duas escritas com a mesma chave são a mesma memória. */
  readonly key: string
  readonly title: string
  readonly body: string
  readonly tags: readonly string[]
  /**
   * 0..1. Memória sem evidência nasce com confiança baixa e é a primeira a cair
   * na compactação.
   */
  readonly confidence: number
  readonly source: MemorySource
  readonly refs: readonly CodeRef[]
  readonly supersedes?: MemoryId
  readonly supersededBy?: MemoryId
  readonly validFrom: number
  readonly validUntil?: number
  readonly checksum: string
}

export type MemoryDraft = Omit<
  MemoryRecord,
  'id' | 'checksum' | 'validFrom' | 'supersededBy' | 'projectId'
>

export interface MemoryQuery {
  readonly scopes?: readonly MemoryScope[]
  readonly tags?: readonly string[]
  readonly text?: string
  readonly semantic?: string
  readonly minConfidence?: number
  readonly includeSuperseded?: boolean
  readonly limit?: number
}

export interface CompactionPolicy {
  readonly maxRecords: number
  readonly minConfidence: number
  readonly olderThanMs?: number
}

export interface CompactionReport {
  readonly scope: MemoryScope
  readonly before: number
  readonly after: number
  readonly merged: readonly MemoryId[]
  readonly dropped: readonly MemoryId[]
}

export interface RevalidationReport {
  readonly checked: number
  readonly invalidated: readonly MemoryId[]
  readonly missingFiles: readonly string[]
}

export function isActiveMemory(record: MemoryRecord, now: number): boolean {
  if (record.supersededBy !== undefined) return false
  if (record.validUntil !== undefined && record.validUntil <= now) return false
  return record.validFrom <= now
}

/**
 * Ordem de curadoria: confiança primeiro, recência como desempate.
 * Usada tanto no ranqueamento de contexto quanto na escolha do que compactar.
 */
export function compareForRetention(a: MemoryRecord, b: MemoryRecord): number {
  if (a.confidence !== b.confidence) return b.confidence - a.confidence
  return b.validFrom - a.validFrom
}
