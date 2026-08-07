import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { MemoryRecord } from '@uranus/core'
import { hashText } from '@uranus/core'

/**
 * Serialização de um `MemoryRecord` como Markdown + frontmatter YAML.
 *
 * O formato é a interface humana da memória (ADR-004): precisa sobreviver a
 * edição manual, diff de git e leitura casual. Por isso o corpo é Markdown puro
 * e o frontmatter carrega só metadados.
 *
 * O `checksum` cobre corpo + campos semânticos. Ele detecta edição manual: se o
 * humano corrigiu o arquivo no editor, o checksum diverge e o store reindexa o
 * conteúdo novo em vez de sobrescrever a correção.
 */

const DELIMITER = '---'

export function serializeRecord(record: MemoryRecord): string {
  const frontmatter: Record<string, unknown> = {
    id: record.id,
    projectId: record.projectId,
    scope: record.scope,
    key: record.key,
    title: record.title,
    tags: [...record.tags],
    confidence: record.confidence,
    source: { kind: record.source.kind, ref: record.source.ref },
    refs: record.refs.map((ref) => ({
      path: ref.path,
      checksum: ref.checksum,
      ...(ref.range === undefined ? {} : { range: [...ref.range] }),
    })),
    validFrom: record.validFrom,
    checksum: record.checksum,
  }
  if (record.supersedes !== undefined) frontmatter['supersedes'] = record.supersedes
  if (record.supersededBy !== undefined) frontmatter['supersededBy'] = record.supersededBy
  if (record.validUntil !== undefined) frontmatter['validUntil'] = record.validUntil

  return `${DELIMITER}\n${stringifyYaml(frontmatter)}${DELIMITER}\n\n${record.body.trim()}\n`
}

export function parseRecord(raw: string): MemoryRecord | undefined {
  if (!raw.startsWith(DELIMITER)) return undefined
  const end = raw.indexOf(`\n${DELIMITER}`, DELIMITER.length)
  if (end < 0) return undefined

  let meta: Record<string, unknown>
  try {
    const parsed: unknown = parseYaml(raw.slice(DELIMITER.length + 1, end))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    meta = parsed as Record<string, unknown>
  } catch {
    return undefined
  }
  const body = raw.slice(end + DELIMITER.length + 1).trim()

  const source = (meta['source'] ?? {}) as { kind?: string; ref?: string }
  const refs = Array.isArray(meta['refs'])
    ? (meta['refs'] as { path: string; checksum: string; range?: number[] }[]).map((r) => ({
        path: r.path,
        checksum: r.checksum,
        ...(Array.isArray(r.range) && r.range.length === 2
          ? { range: [r.range[0]!, r.range[1]!] as readonly [number, number] }
          : {}),
      }))
    : []

  if (typeof meta['id'] !== 'string' || typeof meta['scope'] !== 'string') return undefined

  const str = (value: unknown): string => (typeof value === 'string' ? value : '')

  return {
    id: meta['id'] as MemoryRecord['id'],
    projectId: str(meta['projectId']) as MemoryRecord['projectId'],
    scope: meta['scope'] as MemoryRecord['scope'],
    key: str(meta['key']),
    title: str(meta['title']),
    body,
    tags: Array.isArray(meta['tags']) ? (meta['tags'] as string[]).map(String) : [],
    confidence: typeof meta['confidence'] === 'number' ? meta['confidence'] : 0.5,
    source: {
      kind: (source.kind ?? 'imported') as MemoryRecord['source']['kind'],
      ref: source.ref ?? '',
    },
    refs,
    ...(typeof meta['supersedes'] === 'string'
      ? { supersedes: meta['supersedes'] as NonNullable<MemoryRecord['supersedes']> }
      : {}),
    ...(typeof meta['supersededBy'] === 'string'
      ? { supersededBy: meta['supersededBy'] as NonNullable<MemoryRecord['supersededBy']> }
      : {}),
    validFrom: typeof meta['validFrom'] === 'number' ? meta['validFrom'] : 0,
    ...(typeof meta['validUntil'] === 'number' ? { validUntil: meta['validUntil'] } : {}),
    checksum: str(meta['checksum']),
  }
}

/** Checksum semântico: corpo + campos que definem o significado do registro. */
export function recordChecksum(
  record: Pick<MemoryRecord, 'scope' | 'key' | 'title' | 'body' | 'tags' | 'confidence'>,
): string {
  return hashText(
    [record.scope, record.key, record.title, record.body, record.tags.join(','), record.confidence]
      .map(String)
      .join('\n'),
  )
}

/** Slug de arquivo estável a partir da chave. */
export function keyToFilename(key: string): string {
  const slug = key
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return `${slug === '' ? 'sem-chave' : slug}.md`
}
