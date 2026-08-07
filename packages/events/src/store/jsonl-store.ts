import { closeSync, createReadStream, fsyncSync, openSync, statSync, writeSync } from 'node:fs'
import { mkdir, truncate } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import type { EventName, EventQuery, EventStore, UranusEvent } from '@uranus/core'
import { IoError, tryParseJson } from '@uranus/core'
import { listSegments, segmentFilename, segmentIndexFor, type SegmentRef } from './segments.js'

export interface JsonlEventStoreOptions {
  readonly dir: string
  /** Tamanho máximo por segmento antes de rotacionar. */
  readonly maxSegmentBytes?: number
  /**
   * `fsync` a cada N appends.
   *
   * `1` custa caro; `0` nunca sincroniza sozinho. O default (`0`) é seguro porque
   * o kernel chama `flush()` explicitamente antes de cada checkpoint — e o
   * checkpoint é quem define o ponto de recuperação (INV-4). Eventos escritos
   * depois do último checkpoint e perdidos em um crash simplesmente não são
   * reproduzidos, o que é consistente.
   */
  readonly fsyncEvery?: number
}

const DEFAULT_MAX_SEGMENT_BYTES = 8 * 1024 * 1024

/**
 * Log append-only em JSONL segmentado. Fonte da verdade do sistema (ADR-006).
 *
 * Escolha de formato: JSONL e não um banco. O event log precisa ser inspecionável
 * com `tail`, `grep` e `jq` quando algo dá errado às 3 da manhã — e precisa
 * sobreviver a uma versão futura do Uranus que não consiga abrir o banco antigo.
 */
export class JsonlEventStore implements EventStore {
  private readonly dir: string
  private readonly maxSegmentBytes: number
  private readonly fsyncEvery: number

  private segments: SegmentRef[] = []
  private currentPath = ''
  private fd: number | undefined
  private currentBytes = 0
  private headSeq = 0
  private sinceSync = 0
  private opened = false

  constructor(options: JsonlEventStoreOptions) {
    this.dir = options.dir
    this.maxSegmentBytes = options.maxSegmentBytes ?? DEFAULT_MAX_SEGMENT_BYTES
    this.fsyncEvery = options.fsyncEvery ?? 0
  }

  static async open(options: JsonlEventStoreOptions): Promise<JsonlEventStore> {
    const store = new JsonlEventStore(options)
    await store.init()
    return store
  }

  async init(): Promise<void> {
    if (this.opened) return
    await mkdir(this.dir, { recursive: true })
    this.segments = [...(await listSegments(this.dir))]

    if (this.segments.length === 0) {
      const filename = segmentFilename(1)
      this.segments = [{ firstSeq: 1, filename, path: join(this.dir, filename) }]
      this.headSeq = 0
    } else {
      const last = this.segments[this.segments.length - 1]!
      const scan = await scanSegment(last.path)
      // Uma linha parcial no fim é a assinatura de um crash durante o append.
      // Truncar é a única opção correta: manter meio evento significaria falhar
      // o parse em toda leitura futura.
      if (scan.truncateTo !== undefined) {
        await truncate(last.path, scan.truncateTo)
      }
      this.headSeq = scan.maxSeq ?? last.firstSeq - 1
    }

    const current = this.segments[this.segments.length - 1]!
    this.currentPath = current.path
    this.currentBytes = safeSize(this.currentPath)
    this.opened = true
  }

  async append<N extends EventName>(event: Omit<UranusEvent<N>, 'seq'>): Promise<UranusEvent<N>> {
    await this.init()
    const stored = { ...event, seq: ++this.headSeq } as UranusEvent<N>
    const line = `${JSON.stringify(stored)}\n`
    const bytes = Buffer.byteLength(line, 'utf8')

    if (this.currentBytes > 0 && this.currentBytes + bytes > this.maxSegmentBytes) {
      await this.rotate(stored.seq)
    }

    try {
      writeSync(this.handle(), line)
    } catch (error: unknown) {
      this.headSeq--
      throw new IoError('Falha ao gravar evento no log', {
        cause: error,
        context: { path: this.currentPath, event: event.name },
      })
    }
    this.currentBytes += bytes

    if (this.fsyncEvery > 0 && ++this.sinceSync >= this.fsyncEvery) {
      this.flushSync()
    }
    return stored
  }

  async *read(fromSeq: number, limit?: number): AsyncIterable<UranusEvent> {
    await this.init()
    let emitted = 0
    const start = segmentIndexFor(this.segments, Math.max(1, fromSeq))
    for (let i = start; i < this.segments.length; i++) {
      for await (const event of readEvents(this.segments[i]!.path)) {
        if (event.seq < fromSeq) continue
        yield event
        emitted++
        if (limit !== undefined && emitted >= limit) return
      }
    }
  }

  async *query(query: EventQuery): AsyncIterable<UranusEvent> {
    const names = query.names === undefined ? undefined : new Set<string>(query.names)
    let emitted = 0
    for await (const event of this.read(query.fromSeq ?? 1)) {
      if (query.toSeq !== undefined && event.seq > query.toSeq) return
      if (names !== undefined && !names.has(event.name)) continue
      if (query.runId !== undefined && event.runId !== query.runId) continue
      if (query.taskId !== undefined && event.taskId !== query.taskId) continue
      if (query.fromAt !== undefined && event.at < query.fromAt) continue
      if (query.toAt !== undefined && event.at > query.toAt) continue
      yield event
      emitted++
      if (query.limit !== undefined && emitted >= query.limit) return
    }
  }

  async head(): Promise<number> {
    await this.init()
    return this.headSeq
  }

  /** Fecha o segmento atual para que tudo até aqui vire imutável. */
  async seal(beforeSeq: number): Promise<void> {
    await this.init()
    if (this.headSeq >= beforeSeq && this.currentBytes > 0) {
      await this.rotate(this.headSeq + 1)
    }
  }

  /** Durabilidade explícita. Chamado pelo kernel antes de cada checkpoint. */
  flush(): void {
    if (this.fd !== undefined) this.flushSync()
  }

  async close(): Promise<void> {
    if (this.fd !== undefined) {
      this.flushSync()
      closeSync(this.fd)
      this.fd = undefined
    }
    this.opened = false
    return Promise.resolve()
  }

  // ── Interno ───────────────────────────────────────────────────────────────

  private handle(): number {
    this.fd ??= openSync(this.currentPath, 'a')
    return this.fd
  }

  private flushSync(): void {
    if (this.fd === undefined) return
    fsyncSync(this.fd)
    this.sinceSync = 0
  }

  private async rotate(nextFirstSeq: number): Promise<void> {
    if (this.fd !== undefined) {
      this.flushSync()
      closeSync(this.fd)
      this.fd = undefined
    }
    const filename = segmentFilename(nextFirstSeq)
    const path = join(this.dir, filename)
    this.segments.push({ firstSeq: nextFirstSeq, filename, path })
    this.currentPath = path
    this.currentBytes = 0
    return Promise.resolve()
  }
}

function safeSize(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

interface SegmentScan {
  readonly maxSeq?: number
  /** Byte offset até onde o arquivo é válido, quando há linha parcial no fim. */
  readonly truncateTo?: number
}

async function scanSegment(path: string): Promise<SegmentScan> {
  let maxSeq: number | undefined
  let validBytes = 0
  let sawPartial = false

  try {
    for await (const line of lines(path)) {
      const bytes = Buffer.byteLength(line.text, 'utf8') + 1
      if (!line.complete) {
        sawPartial = true
        break
      }
      const parsed = tryParseJson<UranusEvent>(line.text)
      if (parsed === undefined || typeof parsed.seq !== 'number') {
        sawPartial = true
        break
      }
      maxSeq = maxSeq === undefined ? parsed.seq : Math.max(maxSeq, parsed.seq)
      validBytes += bytes
    }
  } catch {
    return {}
  }

  return {
    ...(maxSeq === undefined ? {} : { maxSeq }),
    ...(sawPartial ? { truncateTo: validBytes } : {}),
  }
}

async function* lines(path: string): AsyncIterable<{ text: string; complete: boolean }> {
  const stream = createReadStream(path, { encoding: 'utf8' })
  let buffer = ''
  try {
    for await (const chunk of stream) {
      buffer += chunk as string
      let index = buffer.indexOf('\n')
      while (index >= 0) {
        yield { text: buffer.slice(0, index), complete: true }
        buffer = buffer.slice(index + 1)
        index = buffer.indexOf('\n')
      }
    }
  } finally {
    stream.destroy()
  }
  if (buffer.length > 0) yield { text: buffer, complete: false }
}

async function* readEvents(path: string): AsyncIterable<UranusEvent> {
  let stream
  try {
    stream = createReadStream(path, { encoding: 'utf8' })
  } catch {
    return
  }
  const reader = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY })
  try {
    for await (const line of reader) {
      if (line.length === 0) continue
      const event = tryParseJson<UranusEvent>(line)
      // Linha ilegível não interrompe a leitura: o resto do log continua válido
      // e útil, e a alternativa (abortar) tornaria o log inutilizável por um byte.
      if (event !== undefined && typeof event.seq === 'number') yield event
    }
  } finally {
    reader.close()
    stream.destroy()
  }
}
