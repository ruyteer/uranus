import type { TaskId } from '../ids.js'
import type { Money, ModelPricing, TokenUsage } from '../domain/usage.js'

export type MetricLabels = Readonly<Record<string, string>>

export interface Telemetry {
  counter(name: string, value: number, labels?: MetricLabels): void
  gauge(name: string, value: number, labels?: MetricLabels): void
  histogram(name: string, value: number, labels?: MetricLabels): void
  /** Span com fim garantido mesmo em exceção. Um tick é um trace; fases são spans. */
  span<T>(name: string, fn: (span: Span) => Promise<T>, labels?: MetricLabels): Promise<T>
  snapshot(): Promise<MetricsSnapshot>
}

export interface Span {
  setAttribute(key: string, value: string | number | boolean): void
  addEvent(name: string, attributes?: MetricLabels): void
  recordError(error: unknown): void
}

export interface MetricsSnapshot {
  readonly at: number
  readonly counters: Readonly<Record<string, number>>
  readonly gauges: Readonly<Record<string, number>>
  readonly histograms: Readonly<Record<string, HistogramSummary>>
}

export interface HistogramSummary {
  readonly count: number
  readonly sum: number
  readonly min: number
  readonly max: number
  readonly p50: number
  readonly p95: number
}

/**
 * Contabilidade de custo. Sempre a partir do `usage` real do provider (R18);
 * a estimativa de `util/tokens.ts` serve apenas para admissão.
 */
export interface CostAccountant {
  record(entry: CostEntry): void
  byTask(taskId: TaskId): Money
  byAgent(agent: string): Money
  byDay(dayEpochMs: number): Money
  total(): Money
  /** Projeção linear do custo restante no ritmo atual. Alimenta o dashboard. */
  project(remainingTasks: number): Money
}

export interface CostEntry {
  readonly at: number
  readonly taskId?: TaskId
  readonly agent: string
  readonly provider: string
  readonly model: string
  readonly usage: TokenUsage
  readonly cost: Money
}

export interface PricingTable {
  /** Tabela versionada por `effectiveFrom`; runs antigos mantêm o preço da época. */
  lookup(provider: string, model: string, at: number): ModelPricing | undefined
  register(provider: string, pricing: ModelPricing): void
}
