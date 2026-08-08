import type {
  Clock,
  HistogramSummary,
  Logger,
  MetricLabels,
  MetricsSnapshot,
  Span,
  Telemetry,
} from '@uranus/core'

export interface TelemetryOptions {
  readonly clock: Clock
  readonly logger?: Logger
  /**
   * Teto de séries distintas. Passou disso, novas combinações de label caem
   * numa série `{overflow}` em vez de crescer sem limite.
   */
  readonly maxSeries?: number
  /** Amostras retidas por histograma. Percentis usam esta janela. */
  readonly reservoirSize?: number
  readonly onSpanEnd?: (span: FinishedSpan) => void
}

export interface FinishedSpan {
  readonly name: string
  readonly traceId: string
  readonly spanId: string
  readonly parentSpanId?: string
  readonly startedAt: number
  readonly durationMs: number
  readonly labels: MetricLabels
  readonly attributes: Readonly<Record<string, string | number | boolean>>
  readonly events: readonly { name: string; at: number; attributes?: MetricLabels }[]
  readonly error?: string
}

const OVERFLOW = '{overflow}'

/**
 * Telemetria em processo.
 *
 * Três coisas que a versão de brinquedo da Fase 2 não fazia e que quebram num
 * run de 8 horas:
 *
 * 1. **Cardinalidade limitada.** `taskId` como label geraria uma série por
 *    task. Passando de `maxSeries`, novas combinações caem numa série de
 *    overflow — a métrica degrada, a memória não.
 *
 * 2. **Reservatório limitado por histograma.** Guardar toda amostra de duração
 *    de tick é um vazamento lento. Amostragem por reservatório (Vitter R) dá
 *    percentis estatisticamente válidos com memória constante.
 *
 * 3. **Spans encadeados de verdade.** Um tick é um trace e cada fase é um span
 *    filho, com `parentSpanId` correto mesmo com `span()` aninhado. É o que
 *    torna a timeline do dashboard legível em vez de uma lista plana.
 */
export class DefaultTelemetry implements Telemetry {
  private readonly counters = new Map<string, number>()
  private readonly gauges = new Map<string, number>()
  private readonly histograms = new Map<string, Reservoir>()
  private readonly finished: FinishedSpan[] = []
  private readonly stack: { traceId: string; spanId: string }[] = []
  private seriesCount = 0
  private spanSeq = 0

  constructor(private readonly options: TelemetryOptions) {}

  counter(name: string, value: number, labels?: MetricLabels): void {
    const key = this.key(name, labels)
    this.counters.set(key, (this.counters.get(key) ?? 0) + value)
  }

  gauge(name: string, value: number, labels?: MetricLabels): void {
    this.gauges.set(this.key(name, labels), value)
  }

  histogram(name: string, value: number, labels?: MetricLabels): void {
    const key = this.key(name, labels)
    const reservoir = this.histograms.get(key) ?? new Reservoir(this.options.reservoirSize ?? 1_024)
    this.histograms.set(key, reservoir)
    reservoir.add(value)
  }

  async span<T>(name: string, fn: (span: Span) => Promise<T>, labels?: MetricLabels): Promise<T> {
    const parent = this.stack[this.stack.length - 1]
    const traceId = parent?.traceId ?? this.newId('trc')
    const spanId = this.newId('spn')
    const startedAt = this.options.clock.now()
    const startedMono = this.options.clock.monotonic()

    const attributes: Record<string, string | number | boolean> = {}
    const events: { name: string; at: number; attributes?: MetricLabels }[] = []
    let error: string | undefined

    const handle: Span = {
      setAttribute: (key, value) => {
        attributes[key] = value
      },
      addEvent: (eventName, eventAttributes) => {
        events.push({
          name: eventName,
          at: this.options.clock.now(),
          ...(eventAttributes === undefined ? {} : { attributes: eventAttributes }),
        })
      },
      recordError: (thrown) => {
        error = thrown instanceof Error ? thrown.message : String(thrown)
      },
    }

    this.stack.push({ traceId, spanId })
    try {
      return await fn(handle)
    } catch (thrown: unknown) {
      // Erro que sobe também é registrado: um span sem `recordError` explícito
      // no `catch` do chamador some do trace justamente quando importa.
      error ??= thrown instanceof Error ? thrown.message : String(thrown)
      throw thrown
    } finally {
      this.stack.pop()
      const durationMs = this.options.clock.monotonic() - startedMono
      this.histogram(`span.${name}.ms`, durationMs, labels)
      const record: FinishedSpan = {
        name,
        traceId,
        spanId,
        ...(parent === undefined ? {} : { parentSpanId: parent.spanId }),
        startedAt,
        durationMs,
        labels: labels ?? {},
        attributes,
        events,
        ...(error === undefined ? {} : { error }),
      }
      this.finished.push(record)
      if (this.finished.length > 2_000) this.finished.splice(0, this.finished.length - 2_000)
      this.options.onSpanEnd?.(record)
    }
  }

  snapshot(): Promise<MetricsSnapshot> {
    const histograms: Record<string, HistogramSummary> = {}
    for (const [key, reservoir] of this.histograms) histograms[key] = reservoir.summary()
    return Promise.resolve({
      at: this.options.clock.now(),
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms,
    })
  }

  /** Spans recentes, do mais novo para o mais antigo. Alimenta a timeline. */
  spans(limit = 200): readonly FinishedSpan[] {
    return this.finished.slice(-limit).reverse()
  }

  reset(): void {
    this.counters.clear()
    this.gauges.clear()
    this.histograms.clear()
    this.finished.length = 0
    this.seriesCount = 0
  }

  private key(name: string, labels?: MetricLabels): string {
    const key = metricKey(name, labels)
    if (this.counters.has(key) || this.gauges.has(key) || this.histograms.has(key)) return key

    const max = this.options.maxSeries ?? 2_000
    if (this.seriesCount >= max) {
      this.options.logger?.warn('Cardinalidade de métrica no teto; agregando em overflow', {
        metric: name,
        maxSeries: max,
      })
      return `${name}${OVERFLOW}`
    }
    this.seriesCount++
    return key
  }

  private newId(prefix: string): string {
    this.spanSeq++
    return `${prefix}_${this.options.clock.now().toString(36)}_${this.spanSeq.toString(36)}`
  }
}

export function metricKey(name: string, labels?: MetricLabels): string {
  if (labels === undefined) return name
  const parts = Object.entries(labels)
    .filter(([, value]) => value !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
  return parts.length === 0 ? name : `${name}{${parts.join(',')}}`
}

/**
 * Amostragem por reservatório (Vitter R).
 *
 * Depois de `size` amostras, cada nova entra com probabilidade `size/n`. A
 * janela deixa de ser "as últimas N" e passa a ser uma amostra uniforme de
 * tudo — que é o que faz um p95 significar alguma coisa num run longo.
 *
 * `count`, `sum`, `min` e `max` são exatos: só os percentis são amostrados.
 */
class Reservoir {
  private readonly samples: number[] = []
  private seen = 0
  private sum = 0
  private min = Number.POSITIVE_INFINITY
  private max = Number.NEGATIVE_INFINITY

  constructor(private readonly size: number) {}

  add(value: number): void {
    this.seen++
    this.sum += value
    if (value < this.min) this.min = value
    if (value > this.max) this.max = value

    if (this.samples.length < this.size) {
      this.samples.push(value)
      return
    }
    const index = Math.floor(Math.random() * this.seen)
    if (index < this.size) this.samples[index] = value
  }

  summary(): HistogramSummary {
    if (this.seen === 0) {
      return { count: 0, sum: 0, min: 0, max: 0, p50: 0, p95: 0 }
    }
    const sorted = [...this.samples].sort((a, b) => a - b)
    return {
      count: this.seen,
      sum: this.sum,
      min: this.min,
      max: this.max,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
    }
  }
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0
  // `ceil - 1` em vez de `floor`: com 20 amostras, o p95 é a 19ª, não a 20ª.
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))
  return sorted[index] ?? 0
}
