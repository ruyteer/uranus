import type { Logger, MetricsSnapshot } from '@uranus/core'
import { redactText } from '@uranus/core'

export interface OtlpExporterOptions {
  /** Endpoint OTLP/HTTP, ex.: `http://localhost:4318`. */
  readonly endpoint: string
  readonly headers?: Readonly<Record<string, string>>
  readonly serviceName?: string
  readonly intervalMs?: number
  readonly logger: Logger
  readonly snapshot: () => Promise<MetricsSnapshot>
}

/**
 * Exportador OTLP/HTTP de métricas.
 *
 * **Best-effort por definição.** Coletor fora do ar não pode atrasar nem
 * derrubar um run: a falha é logada em `debug` e a próxima janela tenta de
 * novo. Telemetria que interfere no que ela observa é pior que telemetria
 * ausente.
 *
 * Só métricas. Traces exigiriam propagação de contexto e o pacote oficial do
 * OpenTelemetry — o custo não se paga enquanto os spans do Uranus cabem no
 * dashboard próprio. Quando pagar, este arquivo é o lugar.
 */
export class OtlpMetricsExporter {
  private timer: NodeJS.Timeout | undefined
  private consecutiveFailures = 0

  constructor(private readonly options: OtlpExporterOptions) {}

  start(): void {
    if (this.timer !== undefined) return
    const interval = this.options.intervalMs ?? 30_000
    this.timer = setInterval(() => {
      void this.exportOnce()
    }, interval)
    // Não segura o processo vivo: o run termina quando o trabalho termina, não
    // quando o exportador desiste.
    this.timer.unref()
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
  }

  async exportOnce(): Promise<boolean> {
    let snapshot: MetricsSnapshot
    try {
      snapshot = await this.options.snapshot()
    } catch {
      return false
    }

    try {
      const response = await fetch(`${this.options.endpoint.replace(/\/$/, '')}/v1/metrics`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.options.headers },
        body: JSON.stringify(this.toOtlp(snapshot)),
        signal: AbortSignal.timeout(5_000),
      })
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
      this.consecutiveFailures = 0
      return true
    } catch (error: unknown) {
      this.consecutiveFailures++
      // Ruidoso na primeira falha (provavelmente config errada), silencioso
      // depois (provavelmente coletor fora do ar, e já avisamos).
      const message = redactText(error instanceof Error ? error.message : String(error))
      if (this.consecutiveFailures === 1) {
        this.options.logger.warn('Falha ao exportar métricas OTLP', {
          endpoint: this.options.endpoint,
          error: message,
        })
      } else {
        this.options.logger.debug('Falha ao exportar métricas OTLP', {
          consecutivas: this.consecutiveFailures,
        })
      }
      return false
    }
  }

  private toOtlp(snapshot: MetricsSnapshot): unknown {
    const nano = String(snapshot.at * 1_000_000)
    const metrics: unknown[] = []

    for (const [key, value] of Object.entries(snapshot.counters)) {
      const { name, attributes } = parseKey(key)
      metrics.push({
        name: `uranus.${name}`,
        sum: {
          aggregationTemporality: 2, // cumulative
          isMonotonic: true,
          dataPoints: [{ asDouble: value, timeUnixNano: nano, attributes }],
        },
      })
    }
    for (const [key, value] of Object.entries(snapshot.gauges)) {
      const { name, attributes } = parseKey(key)
      metrics.push({
        name: `uranus.${name}`,
        gauge: { dataPoints: [{ asDouble: value, timeUnixNano: nano, attributes }] },
      })
    }
    for (const [key, summary] of Object.entries(snapshot.histograms)) {
      const { name, attributes } = parseKey(key)
      metrics.push({
        name: `uranus.${name}`,
        summary: {
          dataPoints: [
            {
              count: String(summary.count),
              sum: summary.sum,
              timeUnixNano: nano,
              attributes,
              quantileValues: [
                { quantile: 0.5, value: summary.p50 },
                { quantile: 0.95, value: summary.p95 },
              ],
            },
          ],
        },
      })
    }

    return {
      resourceMetrics: [
        {
          resource: {
            attributes: [
              {
                key: 'service.name',
                value: { stringValue: this.options.serviceName ?? 'uranus' },
              },
            ],
          },
          scopeMetrics: [{ scope: { name: 'uranus' }, metrics }],
        },
      ],
    }
  }
}

/** `tick.ms{phase=execute}` → nome + atributos OTLP. */
function parseKey(key: string): {
  name: string
  attributes: readonly { key: string; value: { stringValue: string } }[]
} {
  const open = key.indexOf('{')
  if (open < 0) return { name: key, attributes: [] }
  const name = key.slice(0, open)
  const attributes = key
    .slice(open + 1, key.lastIndexOf('}'))
    .split(',')
    .filter((part) => part !== '')
    .map((part) => {
      const equals = part.indexOf('=')
      return {
        key: equals < 0 ? part : part.slice(0, equals),
        value: { stringValue: equals < 0 ? '' : part.slice(equals + 1) },
      }
    })
  return { name, attributes }
}
