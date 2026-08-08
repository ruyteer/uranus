import type { BudgetGuard, Clock, EventBus, HumanGate, Logger } from '@uranus/core'
import {
  DefaultCostAccountant,
  DefaultTelemetry,
  TelemetryAggregator,
  attachCostAccounting,
  attachOperationalMetrics,
  createPricingTable,
  OtlpMetricsExporter,
} from '@uranus/telemetry'
import type { ModelPricing } from '@uranus/core'
import { DashboardServer, type DashboardControl } from './server.js'
import { SseHub } from './sse.js'

export interface StartDashboardOptions {
  readonly events: EventBus
  readonly clock: Clock
  readonly logger: Logger
  readonly budget?: BudgetGuard
  readonly humanGate?: HumanGate
  readonly control?: DashboardControl
  readonly port?: number
  readonly host?: string
  readonly token?: string
  readonly otlpEndpoint?: string
  readonly pricing?: Readonly<Record<string, readonly ModelPricing[]>>
}

export interface RunningDashboard {
  readonly url: string
  readonly port: number
  readonly aggregator: TelemetryAggregator
  readonly cost: DefaultCostAccountant
  readonly telemetry: DefaultTelemetry
  close(): Promise<void>
}

/**
 * Monta a pilha inteira de observabilidade e sobe o servidor.
 *
 * Existe para que `uranus dashboard` e o `uranus start --dashboard` compartilhem
 * exatamente a mesma montagem: telemetria, contabilidade, agregador e servidor
 * nascem juntos ou o painel mostra um recorte diferente do que o CLI reporta.
 */
export async function startDashboard(options: StartDashboardOptions): Promise<RunningDashboard> {
  const telemetry = new DefaultTelemetry({ clock: options.clock, logger: options.logger })
  const cost = new DefaultCostAccountant({ pricing: createPricingTable(options.pricing ?? {}) })

  const hub = new SseHub()
  const aggregator = new TelemetryAggregator({
    clock: options.clock,
    events: options.events,
    cost,
    telemetry,
    ...(options.budget === undefined ? {} : { budget: options.budget }),
    ...(options.humanGate === undefined ? {} : { humanGate: options.humanGate }),
  })

  const detachCost = attachCostAccounting({
    events: options.events,
    cost,
    telemetry,
    logger: options.logger,
  })
  const detachMetrics = attachOperationalMetrics({ events: options.events, telemetry })
  aggregator.start()

  const exporter =
    options.otlpEndpoint === undefined
      ? undefined
      : new OtlpMetricsExporter({
          endpoint: options.otlpEndpoint,
          logger: options.logger,
          snapshot: () => telemetry.snapshot(),
        })
  exporter?.start()

  const server = new DashboardServer(
    {
      aggregator,
      events: options.events,
      logger: options.logger,
      clock: options.clock,
      ...(options.humanGate === undefined ? {} : { humanGate: options.humanGate }),
      ...(options.control === undefined ? {} : { control: options.control }),
      ...(options.port === undefined ? {} : { port: options.port }),
      ...(options.host === undefined ? {} : { host: options.host }),
      ...(options.token === undefined ? {} : { token: options.token }),
    },
    hub,
  )

  const { url, port } = await server.listen()
  options.logger.info('Dashboard no ar', { url })

  return {
    url,
    port,
    aggregator,
    cost,
    telemetry,
    async close(): Promise<void> {
      exporter?.stop()
      detachCost()
      detachMetrics()
      aggregator.stop()
      await server.close()
    },
  }
}
