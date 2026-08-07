import type { EventName, EventStore, UranusEvent } from '@uranus/core'

/**
 * Projeção: uma função que dobra eventos em estado.
 *
 * O estado do Uranus é derivado do log (ADR-006). Isolar a dobra aqui é o que
 * permite reconstruir qualquer projeção a partir de um checkpoint, e é a base do
 * `recover` — que reproduz apenas a cauda a partir do `eventOffset`.
 */
export interface Projection<S> {
  readonly name: string
  readonly initial: S
  /**
   * Deve ser **idempotente por evento**: a recuperação pode reprocessar eventos
   * já aplicados se o checkpoint estiver atrás do log.
   */
  apply(state: S, event: UranusEvent): S
}

export interface ReplayResult<S> {
  readonly state: S
  readonly eventsApplied: number
  readonly lastSeq: number
}

export async function replay<S>(
  store: EventStore,
  projection: Projection<S>,
  options: { fromSeq?: number; toSeq?: number; initial?: S } = {},
): Promise<ReplayResult<S>> {
  let state = options.initial ?? projection.initial
  let applied = 0
  let lastSeq = (options.fromSeq ?? 1) - 1

  for await (const event of store.read(options.fromSeq ?? 1)) {
    if (options.toSeq !== undefined && event.seq > options.toSeq) break
    state = projection.apply(state, event)
    applied++
    lastSeq = event.seq
  }

  return { state, eventsApplied: applied, lastSeq }
}

/** Aplica várias projeções em uma única passagem pelo log. */
export async function replayAll(
  store: EventStore,
  projections: readonly Projection<unknown>[],
  options: { fromSeq?: number; toSeq?: number } = {},
): Promise<{ states: Map<string, unknown>; eventsApplied: number; lastSeq: number }> {
  const states = new Map<string, unknown>(projections.map((p) => [p.name, p.initial]))
  let applied = 0
  let lastSeq = (options.fromSeq ?? 1) - 1

  for await (const event of store.read(options.fromSeq ?? 1)) {
    if (options.toSeq !== undefined && event.seq > options.toSeq) break
    for (const projection of projections) {
      states.set(projection.name, projection.apply(states.get(projection.name), event))
    }
    applied++
    lastSeq = event.seq
  }

  return { states, eventsApplied: applied, lastSeq }
}

/** Coleta eventos que satisfazem um predicado. Ferramenta de diagnóstico. */
export async function collectEvents(
  store: EventStore,
  predicate: (event: UranusEvent) => boolean,
  options: { fromSeq?: number; limit?: number } = {},
): Promise<readonly UranusEvent[]> {
  const found: UranusEvent[] = []
  for await (const event of store.read(options.fromSeq ?? 1)) {
    if (!predicate(event)) continue
    found.push(event)
    if (options.limit !== undefined && found.length >= options.limit) break
  }
  return found
}

export function isEvent<N extends EventName>(event: UranusEvent, name: N): event is UranusEvent<N> {
  return event.name === name
}
