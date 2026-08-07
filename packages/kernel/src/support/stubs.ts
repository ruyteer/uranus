import type {
  CompactionReport,
  ContextManager,
  MemoryDraft,
  MemoryManager,
  MemoryQuery,
  MemoryRecord,
  MemoryStore,
  MetricLabels,
  MetricsSnapshot,
  ProjectDigest,
  ProjectRef,
  Result,
  RevalidationReport,
  Span,
  Telemetry,
} from '@uranus/core'
import { NotFoundError, err, ok } from '@uranus/core'

/**
 * Stubs da Fase 2 para contratos cujas implementações reais chegam depois.
 *
 * São **explícitos e nomeados** — não mocks escondidos. O composition root da
 * CLI os injeta com um log claro, e a Fase 3 os substitui sem tocar no kernel.
 */

export class NoopMemoryStore implements MemoryStore {
  put(_draft: MemoryDraft): Promise<Result<MemoryRecord>> {
    return Promise.resolve(err(new NotFoundError('Memória chega na Fase 3')))
  }
  get(): Promise<MemoryRecord | undefined> {
    return Promise.resolve(undefined)
  }
  getByKey(): Promise<MemoryRecord | undefined> {
    return Promise.resolve(undefined)
  }
  query(_query: MemoryQuery): Promise<readonly MemoryRecord[]> {
    return Promise.resolve([])
  }
  supersede(): Promise<Result<void>> {
    return Promise.resolve(ok())
  }
  revalidate(): Promise<RevalidationReport> {
    return Promise.resolve({ checked: 0, invalidated: [], missingFiles: [] })
  }
  compact(): Promise<CompactionReport> {
    return Promise.resolve({ scope: 'history', before: 0, after: 0, merged: [], dropped: [] })
  }

  async *export(): AsyncIterable<MemoryRecord> {
    /* vazio */
  }
  close(): Promise<void> {
    return Promise.resolve()
  }
}

export class NoopMemoryManager implements MemoryManager {
  remember(_drafts: readonly MemoryDraft[]): Promise<readonly MemoryRecord[]> {
    return Promise.resolve([])
  }
  recall(_query: MemoryQuery): Promise<readonly MemoryRecord[]> {
    return Promise.resolve([])
  }
  maintain(): Promise<readonly CompactionReport[]> {
    return Promise.resolve([])
  }
}

export interface StaticContextManagerOptions {
  readonly testsCommand?: string
  readonly testsRunner?: string
}

/**
 * ContextManager da Fase 2: o digest vem da config, não de descoberta.
 * A informação de testes é a que importa — é o que decide o modo restrito (R4).
 */
export class StaticContextManager implements ContextManager {
  private digest_: ProjectDigest | undefined

  constructor(private readonly options: StaticContextManagerOptions) {}

  bootstrap(project: ProjectRef, _signal: AbortSignal): Promise<ProjectDigest> {
    this.digest_ = {
      languages: [],
      frameworks: [],
      architecture: { style: 'unknown', layers: [], entrypoints: [] },
      dependencies: { direct: 0, outdated: 0, vulnerable: 0 },
      tests: {
        ...(this.options.testsRunner === undefined ? {} : { runner: this.options.testsRunner }),
        ...(this.options.testsCommand === undefined ? {} : { command: this.options.testsCommand }),
        count: this.options.testsCommand === undefined ? 0 : 1,
      },
      ci: { requiredChecks: [] },
      database: {},
      docs: [],
      conventions: [],
      vcs: { defaultBranch: 'main' },
      summary: `Projeto ${project.name} (digest estático da Fase 2)`,
      freshness: 'static',
      generatedAt: Date.now(),
    }
    return Promise.resolve(this.digest_)
  }

  digest(_project: ProjectRef): Promise<ProjectDigest | undefined> {
    return Promise.resolve(this.digest_)
  }

  isStale(): Promise<boolean> {
    return Promise.resolve(false)
  }

  invalidate(): void {
    /* nada a invalidar */
  }
}

export class InMemoryTelemetry implements Telemetry {
  readonly counters = new Map<string, number>()
  readonly gauges = new Map<string, number>()
  readonly histogramValues = new Map<string, number[]>()

  counter(name: string, value: number, labels?: MetricLabels): void {
    const key = metricKey(name, labels)
    this.counters.set(key, (this.counters.get(key) ?? 0) + value)
  }
  gauge(name: string, value: number, labels?: MetricLabels): void {
    this.gauges.set(metricKey(name, labels), value)
  }
  histogram(name: string, value: number, labels?: MetricLabels): void {
    const key = metricKey(name, labels)
    const values = this.histogramValues.get(key) ?? []
    values.push(value)
    this.histogramValues.set(key, values)
  }
  async span<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T> {
    const span: Span = {
      setAttribute: () => undefined,
      addEvent: () => undefined,
      recordError: () => undefined,
    }
    const started = performance.now()
    try {
      return await fn(span)
    } finally {
      this.histogram(`span.${name}.ms`, performance.now() - started)
    }
  }
  snapshot(): Promise<MetricsSnapshot> {
    const histograms: Record<string, MetricsSnapshot['histograms'][string]> = {}
    for (const [key, values] of this.histogramValues) {
      const sorted = [...values].sort((a, b) => a - b)
      const sum = sorted.reduce((a, b) => a + b, 0)
      histograms[key] = {
        count: sorted.length,
        sum,
        min: sorted[0] ?? 0,
        max: sorted[sorted.length - 1] ?? 0,
        p50: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
        p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      }
    }
    return Promise.resolve({
      at: Date.now(),
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms,
    })
  }
}

function metricKey(name: string, labels?: MetricLabels): string {
  if (labels === undefined || Object.keys(labels).length === 0) return name
  const parts = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
  return `${name}{${parts.join(',')}}`
}
