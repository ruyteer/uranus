import type {
  EventMeta,
  EventName,
  EventPayloads,
  EventQuery,
  UranusEvent,
} from '../domain/events.js'
import type { Unsubscribe } from './common.js'

export type EventHandler<N extends EventName> = (event: UranusEvent<N>) => void | Promise<void>

export type InterceptDecision =
  | { readonly action: 'continue' }
  | { readonly action: 'veto'; readonly reason: string }
  | { readonly action: 'defer'; readonly reason: string; readonly retryAfterMs: number }

export type InterceptHandler<N extends EventName> = (
  event: UranusEvent<N>,
) => InterceptDecision | Promise<InterceptDecision>

export interface SubscribeOptions {
  readonly once?: boolean
}

export interface InterceptOptions {
  /** Maior roda antes. Empate resolve por ordem de registro. */
  readonly priority?: number
  /**
   * Estouro de timeout é tratado como `continue` + warning, nunca como veto.
   * Um plugin lento não pode travar o kernel, e um plugin travado não pode
   * bloquear o trabalho por omissão.
   */
  readonly timeoutMs?: number
}

/**
 * Barramento de eventos.
 *
 * Dois tipos de assinante, com garantias diferentes:
 *  - `on`        — observador. Fire-and-forget, não altera o fluxo. É o padrão.
 *  - `intercept` — interceptor. Aguardado, pode **vetar**. Existe para plugins de
 *                  compliance ("bloqueie qualquer commit que toque em CI/"), e é
 *                  o único ponto onde um plugin influencia uma decisão do kernel.
 */
export type ProposalOutcome<N extends EventName> =
  | { readonly accepted: true; readonly event: UranusEvent<N> }
  | { readonly accepted: false; readonly vetoedBy: string; readonly reason: string }
  | {
      readonly accepted: false
      readonly deferredBy: string
      readonly reason: string
      readonly retryAfterMs: number
    }

export interface EventBus {
  /**
   * Registra um fato consumado. Interceptors observam mas não podem vetar — o
   * efeito já aconteceu, e um veto aqui só criaria divergência entre o log e a
   * realidade.
   */
  emit<N extends EventName>(
    name: N,
    payload: EventPayloads[N],
    meta?: EventMeta,
  ): Promise<UranusEvent<N>>

  /**
   * Propõe uma ação **antes** de executá-la, dando aos interceptors a chance de
   * vetar. É o caminho obrigatório para efeitos irreversíveis (commit, push, PR,
   * merge). Só quando `accepted` é `true` o evento entra no log e a ação prossegue.
   */
  propose<N extends EventName>(
    name: N,
    payload: EventPayloads[N],
    meta?: EventMeta,
  ): Promise<ProposalOutcome<N>>

  on<N extends EventName>(
    name: N | readonly N[],
    handler: EventHandler<N>,
    options?: SubscribeOptions,
  ): Unsubscribe

  /** Assina todos os eventos. Usado por telemetria e pelo stream do dashboard. */
  onAny(handler: EventHandler<EventName>, options?: SubscribeOptions): Unsubscribe

  intercept<N extends EventName>(
    name: N | readonly N[],
    handler: InterceptHandler<N>,
    options?: InterceptOptions,
  ): Unsubscribe
}

/**
 * Log append-only. Fonte da verdade do sistema (ADR-006); o estado em SQLite é
 * uma projeção derivada dele.
 */
export interface EventStore {
  /** Atribui `seq` monotônico e persiste de forma durável antes de retornar. */
  append<N extends EventName>(event: Omit<UranusEvent<N>, 'seq'>): Promise<UranusEvent<N>>

  read(fromSeq: number, limit?: number): AsyncIterable<UranusEvent>

  query(query: EventQuery): AsyncIterable<UranusEvent>

  /** Maior `seq` persistido. É o `eventOffset` gravado no checkpoint. */
  head(): Promise<number>

  /** Sela segmentos antigos (imutáveis a partir daí) e permite compactar. */
  seal(beforeSeq: number): Promise<void>

  close(): Promise<void>

  /**
   * Apaga segmentos além dos últimos `keep` (Fase 9: poda de eventos).
   * Opcional — stores sem armazenamento em segmento (ex.: fakes em memória
   * de teste) simplesmente não implementam.
   */
  prune?(keep: number): Promise<number>
}
