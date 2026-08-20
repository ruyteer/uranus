import { readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Nomeação de segmentos: `seg-<primeiroSeq com 12 dígitos>.jsonl`.
 *
 * Codificar o primeiro `seq` no nome elimina a necessidade de um índice separado
 * para responder "qual segmento contém o seq N?" — e um índice separado é mais
 * uma estrutura que pode divergir do dado real depois de um crash.
 */

const SEGMENT_RE = /^seg-(\d{12})\.jsonl$/
const SEQ_DIGITS = 12

export interface SegmentRef {
  readonly firstSeq: number
  readonly filename: string
  readonly path: string
}

export function segmentFilename(firstSeq: number): string {
  return `seg-${String(firstSeq).padStart(SEQ_DIGITS, '0')}.jsonl`
}

export function parseSegmentName(filename: string): number | undefined {
  const match = SEGMENT_RE.exec(filename)
  return match === null ? undefined : Number.parseInt(match[1]!, 10)
}

export async function listSegments(dir: string): Promise<readonly SegmentRef[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }
  const segments: SegmentRef[] = []
  for (const filename of entries) {
    const firstSeq = parseSegmentName(filename)
    if (firstSeq === undefined) continue
    segments.push({ firstSeq, filename, path: join(dir, filename) })
  }
  segments.sort((a, b) => a.firstSeq - b.firstSeq)
  return segments
}

/**
 * Índice do primeiro segmento que pode conter `seq`.
 * É o último segmento cujo `firstSeq` é menor ou igual a `seq`.
 */
export function segmentIndexFor(segments: readonly SegmentRef[], seq: number): number {
  let index = 0
  for (let i = 0; i < segments.length; i++) {
    if (segments[i]!.firstSeq <= seq) index = i
    else break
  }
  return index
}

/**
 * Apaga os segmentos mais antigos além dos últimos `keep`. O segmento mais
 * recente (o que está sendo escrito agora) nunca é apagado, mesmo se
 * `keep < 1` — o log JSONL não faz sentido sem um segmento ativo (Fase 9:
 * "poda de eventos", o log é fonte da verdade mas não pode crescer pra
 * sempre num run de longa duração).
 */
export async function pruneSegments(
  dir: string,
  opts: { readonly keep: number },
): Promise<readonly SegmentRef[]> {
  const segments = await listSegments(dir)
  const keep = Math.max(1, opts.keep)
  if (segments.length <= keep) return []

  const toDelete = segments.slice(0, segments.length - keep)
  const deleted: SegmentRef[] = []
  for (const segment of toDelete) {
    try {
      await unlink(segment.path)
      deleted.push(segment)
    } catch {
      // Já não existe ou está travado — não é fatal, a próxima poda tenta de novo.
    }
  }
  return deleted
}
