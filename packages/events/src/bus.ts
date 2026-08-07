import type {
  Clock,
  EventBus,
  EventHandler,
  EventMeta,
  EventName,
  EventPayloads,
  EventStore,
  InterceptHandler,
  InterceptOptions,
  Logger,
  ProjectId,
  ProposalOutcome,
  SubscribeOptions,
  UranusEvent,
  Unsubscribe,
} from '@uranus/core'
import { KERNEL_ACTOR, newEventId, toUranusError } from '@uranus/core'

const ANY = '*' as const

/** `Array.isArray` sobre união com readonly array degrada para `any[]`; isto preserva `N`. */
function toArray<N extends EventName>(name: N | readonly N[]): readonly N[] {
  return (Array.isArray(name) ? name : [name]) as readonly N[]
}

interface Subscription<N extends EventName> {
  readonly handler: EventHandler<N>
  readonly once: boolean
}

interface Interception {
  readonly handler: InterceptHandler<EventName>
  readonly priority: number
  readonly timeoutMs: number
  readonly id: string
}

export interface EventBusOptions {
  readonly store: EventStore
  readonly clock: Clock
  readonly logger: Logger
  readonly projectId: ProjectId
  readonly defaultInterceptTimeoutMs?: number
}

/**
 * Barramento in-process.
 *
 * Três decisões que valem o comentário:
 *
 * 1. **Persistir antes de notificar.** Um observador que roda antes do `append`
 *    poderia reagir a um evento que, por falha de escrita, nunca existiu — e o
 *    INV-3 ("sem evento, não aconteceu") deixaria de valer.
 *
 * 2. **Erro de observador nunca propaga.** Um handler de telemetria com bug não
 *    pode derrubar um run de 8 horas. Ele é registrado e engolido.
 *
 * 3. **Interceptor que estoura o timeout equivale a `continue`.** Um plugin
 *    travado não pode bloquear o kernel *nem* vetar por omissão — as duas falhas
 *    são inaceitáveis, e "continuar + avisar" é a única saída que não é nenhuma
 *    das duas.
 */
export class InProcessEventBus implements EventBus {
  private readonly subscriptions = new Map<string, Set<Subscription<EventName>>>()
  private readonly interceptions = new Map<string, Interception[]>()
  private readonly store: EventStore
  private readonly clock: Clock
  private readonly logger: Logger
  private readonly projectId: ProjectId
  private readonly defaultInterceptTimeoutMs: number
  private interceptorSeq = 0

  constructor(options: EventBusOptions) {
    this.store = options.store
    this.clock = options.clock
    this.logger = options.logger.child({ component: 'event-bus' })
    this.projectId = options.projectId
    this.defaultInterceptTimeoutMs = options.defaultInterceptTimeoutMs ?? 5_000
  }

  async emit<N extends EventName>(
    name: N,
    payload: EventPayloads[N],
    meta: EventMeta = {},
  ): Promise<UranusEvent<N>> {
    const stored = await this.store.append(this.build(name, payload, meta))
    await this.dispatch(stored)
    return stored
  }

  async propose<N extends EventName>(
    name: N,
    payload: EventPayloads[N],
    meta: EventMeta = {},
  ): Promise<ProposalOutcome<N>> {
    const candidate = { ...this.build(name, payload, meta), seq: -1 } as UranusEvent<N>

    for (const interception of this.interceptorsFor(name)) {
      const decision = await this.runInterceptor(interception, candidate)
      if (decision.action === 'veto') {
        await this.emit('PluginVetoed', {
          pluginId: interception.id,
          event: name,
          reason: decision.reason,
        })
        return { accepted: false, vetoedBy: interception.id, reason: decision.reason }
      }
      if (decision.action === 'defer') {
        return {
          accepted: false,
          deferredBy: interception.id,
          reason: decision.reason,
          retryAfterMs: decision.retryAfterMs,
        }
      }
    }

    const stored = await this.store.append(this.build(name, payload, meta))
    await this.dispatch(stored)
    return { accepted: true, event: stored }
  }

  on<N extends EventName>(
    name: N | readonly N[],
    handler: EventHandler<N>,
    options: SubscribeOptions = {},
  ): Unsubscribe {
    const names = toArray(name)
    const entries = names.map((n) => this.addSubscription(n, handler, options.once === true))
    return () => {
      for (const undo of entries) undo()
    }
  }

  onAny(handler: EventHandler<EventName>, options: SubscribeOptions = {}): Unsubscribe {
    return this.addSubscription(ANY, handler, options.once === true)
  }

  intercept<N extends EventName>(
    name: N | readonly N[],
    handler: InterceptHandler<N>,
    options: InterceptOptions = {},
  ): Unsubscribe {
    const names = toArray(name)
    const id = `interceptor#${String(++this.interceptorSeq)}`
    const entry: Interception = {
      handler: handler as InterceptHandler<EventName>,
      priority: options.priority ?? 0,
      timeoutMs: options.timeoutMs ?? this.defaultInterceptTimeoutMs,
      id,
    }
    for (const n of names) {
      const list = this.interceptions.get(n) ?? []
      list.push(entry)
      list.sort((a, b) => b.priority - a.priority)
      this.interceptions.set(n, list)
    }
    return () => {
      for (const n of names) {
        const list = this.interceptions.get(n)
        if (list === undefined) continue
        const index = list.indexOf(entry)
        if (index >= 0) list.splice(index, 1)
      }
    }
  }

  // ── Interno ───────────────────────────────────────────────────────────────

  private build<N extends EventName>(
    name: N,
    payload: EventPayloads[N],
    meta: EventMeta,
  ): Omit<UranusEvent<N>, 'seq'> {
    const at = this.clock.now()
    return {
      id: newEventId(at),
      name,
      at,
      actor: meta.actor ?? KERNEL_ACTOR,
      projectId: this.projectId,
      payload,
      ...(meta.runId === undefined ? {} : { runId: meta.runId }),
      ...(meta.taskId === undefined ? {} : { taskId: meta.taskId }),
      ...(meta.attemptId === undefined ? {} : { attemptId: meta.attemptId }),
      ...(meta.causationId === undefined ? {} : { causationId: meta.causationId }),
      ...(meta.correlationId === undefined ? {} : { correlationId: meta.correlationId }),
    }
  }

  private addSubscription(key: string, handler: EventHandler<never>, once: boolean): Unsubscribe {
    const set = this.subscriptions.get(key) ?? new Set<Subscription<EventName>>()
    const subscription = { handler: handler as EventHandler<EventName>, once }
    set.add(subscription)
    this.subscriptions.set(key, set)
    return () => set.delete(subscription)
  }

  private async dispatch(event: UranusEvent): Promise<void> {
    const targets = [
      ...(this.subscriptions.get(event.name) ?? []),
      ...(this.subscriptions.get(ANY) ?? []),
    ]
    for (const subscription of targets) {
      if (subscription.once) {
        this.subscriptions.get(event.name)?.delete(subscription)
        this.subscriptions.get(ANY)?.delete(subscription)
      }
      try {
        await subscription.handler(event)
      } catch (error: unknown) {
        // Ver decisão 2 no comentário da classe.
        this.logger.error('Observador de evento falhou', {
          event: event.name,
          error: toUranusError(error).toJSON(),
        })
      }
    }
  }

  private interceptorsFor(name: EventName): readonly Interception[] {
    return this.interceptions.get(name) ?? []
  }

  private async runInterceptor(
    interception: Interception,
    event: UranusEvent,
  ): Promise<
    | { action: 'continue' }
    | { action: 'veto'; reason: string }
    | {
        action: 'defer'
        reason: string
        retryAfterMs: number
      }
  > {
    let timer: NodeJS.Timeout | undefined
    try {
      const timeout = new Promise<{ action: 'continue' }>((resolve) => {
        timer = setTimeout(() => {
          this.logger.warn('Interceptor estourou o timeout; tratado como continue', {
            interceptor: interception.id,
            event: event.name,
            timeoutMs: interception.timeoutMs,
          })
          resolve({ action: 'continue' })
        }, interception.timeoutMs)
      })
      return await Promise.race([Promise.resolve(interception.handler(event)), timeout])
    } catch (error: unknown) {
      this.logger.error('Interceptor falhou; tratado como continue', {
        interceptor: interception.id,
        event: event.name,
        error: toUranusError(error).toJSON(),
      })
      return { action: 'continue' }
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }
}
