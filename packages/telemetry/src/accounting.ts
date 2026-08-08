import type { EventBus, Logger, Money, TaskId, TokenUsage, Unsubscribe } from '@uranus/core'
import { ZERO_USD, totalTokens } from '@uranus/core'
import type { DefaultCostAccountant } from './cost.js'
import type { DefaultTelemetry } from './metrics.js'

interface OpenSession {
  readonly agent: string
  readonly provider: string
  readonly model: string
  readonly taskId?: TaskId
  readonly at: number
}

export interface CostAccountingOptions {
  readonly events: EventBus
  readonly cost: DefaultCostAccountant
  readonly telemetry: DefaultTelemetry
  readonly logger: Logger
}

/**
 * Liga o log de eventos à contabilidade de custo.
 *
 * **Por que `AgentRunStarted`/`AgentRunFinished` e não `TokensConsumed`:** o
 * `TokensConsumed` é emitido uma vez por tick, com o gasto do Executor. Ele
 * ignora o Planner e ignora cada gate de qualidade — e a cadeia de qualidade
 * é justamente o que multiplica o custo por task. Contabilizar por sessão de
 * agente é o que faz o total bater com a fatura, e de quebra dá a atribuição
 * por agente que o painel de custo mostra.
 *
 * O par é unido por `sessionId`: o `Started` traz quem/qual modelo, o
 * `Finished` traz quanto. Uma sessão que morre sem `Finished` é descartada —
 * nunca contabilizada com dados inventados.
 */
export function attachCostAccounting(options: CostAccountingOptions): Unsubscribe {
  const open = new Map<string, OpenSession>()

  const unsubscribeStarted = options.events.on('AgentRunStarted', (event) => {
    const payload = event.payload
    open.set(payload.sessionId, {
      agent: payload.agent,
      provider: payload.provider,
      model: payload.model,
      ...(event.taskId === undefined ? {} : { taskId: event.taskId }),
      at: event.at,
    })
    // Teto de segurança: sessões que nunca terminam não podem crescer sem fim.
    if (open.size > 1_000) {
      const oldest = [...open.entries()].sort((a, b) => a[1].at - b[1].at)[0]
      if (oldest !== undefined) open.delete(oldest[0])
    }
    options.telemetry.counter('agent.runs', 1, { agent: payload.agent })
  })

  const unsubscribeFinished = options.events.on('AgentRunFinished', (event) => {
    const payload = event.payload
    const session = open.get(payload.sessionId)
    open.delete(payload.sessionId)
    if (session === undefined) {
      options.logger.debug('AgentRunFinished sem Started correspondente; custo ignorado', {
        sessionId: payload.sessionId,
      })
      return
    }

    const usage: TokenUsage = payload.usage
    const cost: Money =
      payload.cost.micros > 0 ? payload.cost : resolveCost(session, usage, event.at)

    options.cost.record({
      at: event.at,
      ...(session.taskId === undefined ? {} : { taskId: session.taskId }),
      agent: session.agent,
      provider: session.provider,
      model: session.model,
      usage,
      cost,
    })

    const labels = { agent: session.agent, provider: session.provider }
    options.telemetry.counter('agent.tokens', totalTokens(usage), labels)
    options.telemetry.counter('agent.cost_micros', cost.micros, labels)
    options.telemetry.counter('agent.turns', payload.turns, labels)
    options.telemetry.histogram('agent.session_ms', Math.max(0, event.at - session.at), labels)
    if (payload.status !== 'completed') {
      options.telemetry.counter('agent.sessions_failed', 1, {
        ...labels,
        status: payload.status,
      })
    }
  })

  /**
   * O provider não reportou custo: cai na tabela de preços. `undefined` da
   * tabela vira zero **e um aviso** — silenciar um modelo desconhecido é
   * exatamente como o relatório fica menor que a fatura sem ninguém notar.
   */
  function resolveCost(session: OpenSession, usage: TokenUsage, at: number): Money {
    if (totalTokens(usage) === 0) return ZERO_USD
    const priced = options.cost.priceFor(session.provider, session.model, usage, at)
    if (priced !== undefined) return priced
    options.logger.warn('Sem preço conhecido para o modelo; custo contabilizado como zero', {
      provider: session.provider,
      model: session.model,
      tokens: totalTokens(usage),
      dica: 'defina telemetry.pricing na config para este modelo',
    })
    return ZERO_USD
  }

  return () => {
    unsubscribeStarted()
    unsubscribeFinished()
  }
}

/**
 * Métricas operacionais derivadas do log.
 *
 * Separado da contabilidade de propósito: são preocupações diferentes com
 * ciclos de vida diferentes, e juntá-las produziria uma função que ninguém
 * consegue mudar sem medo.
 */
export function attachOperationalMetrics(options: {
  readonly events: EventBus
  readonly telemetry: DefaultTelemetry
}): Unsubscribe {
  const { events, telemetry } = options
  const unsubscribes: Unsubscribe[] = [
    events.on('TaskCompleted', (event) => {
      telemetry.counter('task.completed', 1)
      telemetry.histogram('task.attempts', event.payload.attempts)
    }),
    events.on('TaskFailed', (event) => {
      telemetry.counter('task.failed', 1, { category: event.payload.diagnosis.category })
    }),
    events.on('TaskBlocked', (event) => {
      telemetry.counter('task.blocked', 1, { kind: event.payload.kind })
    }),
    events.on('CheckPassed', (event) => {
      telemetry.counter('check.passed', 1, { kind: event.payload.result.kind })
      telemetry.histogram('check.ms', event.payload.result.durationMs, {
        kind: event.payload.result.kind,
      })
    }),
    events.on('CheckFailed', (event) => {
      telemetry.counter('check.failed', 1, { kind: event.payload.result.kind })
    }),
    events.on('TickCompleted', (event) => {
      telemetry.histogram('tick.ms', event.payload.durationMs, { phase: event.payload.phase })
    }),
    events.on('RateLimited', (event) => {
      telemetry.counter('provider.rate_limited', 1, { provider: event.payload.provider })
    }),
    events.on('ProviderDegraded', (event) => {
      telemetry.counter('provider.degraded', 1, { provider: event.payload.provider })
    }),
    events.on('ReviewCompleted', (event) => {
      telemetry.counter('gate.completed', 1)
      telemetry.counter('gate.findings', event.payload.findings)
      telemetry.counter('gate.blocking', event.payload.blocking)
    }),
  ]
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe()
  }
}
