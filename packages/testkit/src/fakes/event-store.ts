import type { EventName, EventQuery, EventStore, UranusEvent } from '@uranus/core'

/**
 * Event store em memória.
 *
 * Implementa o mesmo contrato do `JsonlEventStore`, o que permite rodar a suíte
 * de contrato contra os dois e provar que a diferença é só durabilidade.
 */
export class InMemoryEventStore implements EventStore {
  private readonly events: UranusEvent[] = []
  private seq = 0
  private sealedBefore = 0

  append<N extends EventName>(event: Omit<UranusEvent<N>, 'seq'>): Promise<UranusEvent<N>> {
    const stored = { ...event, seq: ++this.seq } as UranusEvent<N>
    this.events.push(stored)
    return Promise.resolve(stored)
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async *read(fromSeq: number, limit?: number): AsyncIterable<UranusEvent> {
    let emitted = 0
    for (const event of this.events) {
      if (event.seq < fromSeq) continue
      yield event
      emitted++
      if (limit !== undefined && emitted >= limit) return
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

  head(): Promise<number> {
    return Promise.resolve(this.seq)
  }

  seal(beforeSeq: number): Promise<void> {
    this.sealedBefore = beforeSeq
    return Promise.resolve()
  }

  close(): Promise<void> {
    return Promise.resolve()
  }

  // ── Auxiliares de teste ───────────────────────────────────────────────────

  all(): readonly UranusEvent[] {
    return this.events
  }

  names(): readonly string[] {
    return this.events.map((e) => e.name)
  }

  byName<N extends EventName>(name: N): readonly UranusEvent<N>[] {
    return this.events.filter((e): e is UranusEvent<N> => e.name === name)
  }

  get sealedAt(): number {
    return this.sealedBefore
  }

  clear(): void {
    this.events.length = 0
    this.seq = 0
  }
}
