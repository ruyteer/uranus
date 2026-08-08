import type {
  CostAccountant,
  CostEntry,
  Money,
  PricingTable,
  TaskId,
  TokenUsage,
} from '@uranus/core'
import {
  EMPTY_USAGE,
  ZERO_USD,
  addMoney,
  addUsage,
  moneyFromMicros,
  priceUsage,
} from '@uranus/core'

const DAY_MS = 86_400_000

export interface CostAccountantOptions {
  readonly pricing: PricingTable
  /** Fuso para agrupar por dia. Minutos de offset em relação a UTC. */
  readonly timezoneOffsetMinutes?: number
  /** Teto de entradas detalhadas retidas. O agregado nunca é descartado. */
  readonly maxEntries?: number
}

export interface CostBreakdown {
  readonly key: string
  readonly cost: Money
  readonly usage: TokenUsage
  readonly calls: number
}

interface Bucket {
  cost: Money
  usage: TokenUsage
  calls: number
}

function emptyBucket(): Bucket {
  return { cost: ZERO_USD, usage: EMPTY_USAGE, calls: 0 }
}

function accumulate(bucket: Bucket, entry: CostEntry): Bucket {
  return {
    cost: addMoney(bucket.cost, entry.cost),
    usage: addUsage(bucket.usage, entry.usage),
    calls: bucket.calls + 1,
  }
}

/**
 * Contabilidade de custo.
 *
 * **A regra que define este módulo:** o custo vem do `usage` real reportado
 * pelo provider e, quando o provider reporta o custo em dinheiro — como o
 * Claude Code CLI faz com `total_cost_usd` — é esse valor que entra. A tabela
 * de preços é o plano B, não o plano A (R18).
 *
 * É o que torna o alvo de ±3% contra a fatura alcançável: na maior parte dos
 * runs o número não é nosso, é do provider. `reconcile()` fecha o ciclo
 * comparando o total com o extrato real.
 */
export class DefaultCostAccountant implements CostAccountant {
  private readonly entries: CostEntry[] = []
  private readonly perTask = new Map<string, Bucket>()
  private readonly perAgent = new Map<string, Bucket>()
  private readonly perModel = new Map<string, Bucket>()
  private readonly perDay = new Map<number, Money>()
  private runningTotal: Money = ZERO_USD
  private totalCalls = 0
  private completedTasks = 0
  private costOfCompletedTasks: Money = ZERO_USD
  private droppedEntries = 0

  constructor(private readonly options: CostAccountantOptions) {}

  record(entry: CostEntry): void {
    this.entries.push(entry)
    // O detalhe antigo sai, o agregado fica. Um run de 8 horas não pode virar
    // vazamento de memória por causa do painel de custo.
    const max = this.options.maxEntries ?? 20_000
    if (this.entries.length > max) {
      this.droppedEntries += this.entries.length - max
      this.entries.splice(0, this.entries.length - max)
    }

    this.totalCalls++
    this.runningTotal = addMoney(this.runningTotal, entry.cost)

    if (entry.taskId !== undefined) {
      this.perTask.set(
        entry.taskId,
        accumulate(this.perTask.get(entry.taskId) ?? emptyBucket(), entry),
      )
    }
    this.perAgent.set(
      entry.agent,
      accumulate(this.perAgent.get(entry.agent) ?? emptyBucket(), entry),
    )

    const modelKey = `${entry.provider}/${entry.model}`
    this.perModel.set(modelKey, accumulate(this.perModel.get(modelKey) ?? emptyBucket(), entry))

    const day = this.dayOf(entry.at)
    this.perDay.set(day, addMoney(this.perDay.get(day) ?? ZERO_USD, entry.cost))
  }

  /**
   * Marca uma task como concluída, com o custo que ela custou.
   *
   * A projeção precisa de custo **por task terminada**, não por chamada: uma
   * task que falhou três vezes e foi replanejada custou o que custou, e é essa
   * média que prevê o restante da fila.
   */
  recordTaskCompleted(taskId: TaskId): void {
    this.completedTasks++
    this.costOfCompletedTasks = addMoney(this.costOfCompletedTasks, this.byTask(taskId))
  }

  byTask(taskId: TaskId): Money {
    return this.perTask.get(taskId)?.cost ?? ZERO_USD
  }

  byAgent(agent: string): Money {
    return this.perAgent.get(agent)?.cost ?? ZERO_USD
  }

  byDay(dayEpochMs: number): Money {
    return this.perDay.get(this.dayOf(dayEpochMs)) ?? ZERO_USD
  }

  total(): Money {
    return this.runningTotal
  }

  /**
   * Projeção linear do custo restante.
   *
   * Sem nenhuma task concluída, cai na média por chamada com um multiplicador
   * pessimista — estimador pior, mas melhor do que devolver zero e passar a
   * impressão de que o resto sai de graça.
   */
  project(remainingTasks: number): Money {
    if (remainingTasks <= 0) return ZERO_USD
    // A média por task concluída só vale se ela existir de fato: tasks
    // concluídas com custo zero atribuído (provider local, ou atribuição
    // ausente) produziriam a projeção "o resto é de graça", que é a resposta
    // errada com cara de resposta.
    if (this.completedTasks > 0 && this.costOfCompletedTasks.micros > 0) {
      return moneyFromMicros(
        (this.costOfCompletedTasks.micros / this.completedTasks) * remainingTasks,
      )
    }
    if (this.totalCalls === 0 || this.runningTotal.micros === 0) return ZERO_USD
    // Chute honesto de chamadas por task: execução + verificação + um gate.
    return moneyFromMicros((this.runningTotal.micros / this.totalCalls) * 3 * remainingTasks)
  }

  // ── Leitura para o dashboard ──────────────────────────────────────────────

  breakdownByAgent(): readonly CostBreakdown[] {
    return toBreakdown(this.perAgent)
  }

  breakdownByModel(): readonly CostBreakdown[] {
    return toBreakdown(this.perModel)
  }

  breakdownByTask(): readonly CostBreakdown[] {
    return toBreakdown(this.perTask)
  }

  /** Série diária, do mais antigo para o mais recente. */
  daily(days = 14, now = Date.now()): readonly { day: number; cost: Money }[] {
    const out: { day: number; cost: Money }[] = []
    const today = this.dayOf(now)
    for (let index = days - 1; index >= 0; index--) {
      const day = today - index * DAY_MS
      out.push({ day, cost: this.perDay.get(day) ?? ZERO_USD })
    }
    return out
  }

  recent(limit = 50): readonly CostEntry[] {
    return this.entries.slice(-limit).reverse()
  }

  stats(): { entries: number; dropped: number; calls: number; completedTasks: number } {
    return {
      entries: this.entries.length,
      dropped: this.droppedEntries,
      calls: this.totalCalls,
      completedTasks: this.completedTasks,
    }
  }

  /**
   * Compara o total contabilizado com o valor real da fatura.
   *
   * Existe porque a única prova de que a contabilidade está certa é o extrato
   * do provider — não um teste unitário sobre a nossa própria tabela.
   */
  reconcile(invoiceUsd: number): {
    reported: Money
    invoice: Money
    deltaRatio: number
    withinTolerance: boolean
  } {
    const invoice = moneyFromMicros(invoiceUsd * 1_000_000)
    const deltaRatio =
      invoice.micros === 0
        ? this.runningTotal.micros === 0
          ? 0
          : 1
        : (this.runningTotal.micros - invoice.micros) / invoice.micros
    return {
      reported: this.runningTotal,
      invoice,
      deltaRatio,
      withinTolerance: Math.abs(deltaRatio) <= 0.03,
    }
  }

  /**
   * Preço a partir do `usage`, quando o provider não reportou custo.
   *
   * Devolve `undefined` — e não zero — quando não há preço conhecido: zero
   * significa "modelo local", que é uma afirmação diferente de "não sei".
   */
  priceFor(provider: string, model: string, usage: TokenUsage, at: number): Money | undefined {
    const pricing = this.options.pricing.lookup(provider, model, at)
    return pricing === undefined ? undefined : priceUsage(usage, pricing)
  }

  private dayOf(at: number): number {
    const offset = (this.options.timezoneOffsetMinutes ?? 0) * 60_000
    return Math.floor((at + offset) / DAY_MS) * DAY_MS - offset
  }
}

function toBreakdown(map: ReadonlyMap<string, Bucket>): readonly CostBreakdown[] {
  return [...map.entries()]
    .map(([key, bucket]) => ({ key, ...bucket }))
    .sort((a, b) => b.cost.micros - a.cost.micros)
}
