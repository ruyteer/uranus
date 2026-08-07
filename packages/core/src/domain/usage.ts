/** Consumo de tokens reportado pelo provider. Sempre valor real, nunca estimativa (R18). */
export interface TokenUsage {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly reasoning: number
}

export const EMPTY_USAGE: TokenUsage = Object.freeze({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
})

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    reasoning: a.reasoning + b.reasoning,
  }
}

export function sumUsage(items: readonly TokenUsage[]): TokenUsage {
  return items.reduce(addUsage, EMPTY_USAGE)
}

/** Total de tokens faturáveis. Cache de leitura conta, mas com preço diferente. */
export function totalTokens(usage: TokenUsage): number {
  return usage.input + usage.output + usage.cacheRead + usage.cacheWrite + usage.reasoning
}

// ── Dinheiro ────────────────────────────────────────────────────────────────

/**
 * Valor monetário em micro-unidades inteiras (1 USD = 1_000_000 micros).
 *
 * Ponto flutuante em dinheiro acumula erro, e o `BudgetGuard` soma milhares de
 * chamadas ao longo de um run de 8 horas. `0.1 + 0.2 !== 0.3` seria um limite
 * de orçamento que vaza alguns centavos por hora — silenciosamente.
 */
export interface Money {
  readonly micros: number
  readonly currency: 'USD'
}

export const MICROS_PER_UNIT = 1_000_000

export const ZERO_USD: Money = Object.freeze({ micros: 0, currency: 'USD' })

export function usd(amount: number): Money {
  return { micros: Math.round(amount * MICROS_PER_UNIT), currency: 'USD' }
}

export function moneyFromMicros(value: number): Money {
  return { micros: Math.round(value), currency: 'USD' }
}

export function addMoney(a: Money, b: Money): Money {
  return { micros: a.micros + b.micros, currency: 'USD' }
}

export function sumMoney(items: readonly Money[]): Money {
  return items.reduce(addMoney, ZERO_USD)
}

export function subtractMoney(a: Money, b: Money): Money {
  return { micros: a.micros - b.micros, currency: 'USD' }
}

export function multiplyMoney(m: Money, factor: number): Money {
  return { micros: Math.round(m.micros * factor), currency: 'USD' }
}

export function compareMoney(a: Money, b: Money): number {
  return a.micros - b.micros
}

export function moneyToNumber(m: Money): number {
  return m.micros / MICROS_PER_UNIT
}

export function formatMoney(m: Money, fractionDigits = 4): string {
  return `$${moneyToNumber(m).toFixed(fractionDigits)}`
}

// ── Preços ──────────────────────────────────────────────────────────────────

/** Preço por milhão de tokens, por categoria. Tabela versionada em telemetry. */
export interface ModelPricing {
  readonly model: string
  readonly inputPerMillion: number
  readonly outputPerMillion: number
  readonly cacheReadPerMillion: number
  readonly cacheWritePerMillion: number
  readonly effectiveFrom: number
}

export function priceUsage(usage: TokenUsage, pricing: ModelPricing): Money {
  const perMillion = (tokens: number, rate: number): number =>
    (tokens / 1_000_000) * rate * MICROS_PER_UNIT
  return moneyFromMicros(
    perMillion(usage.input + usage.reasoning, pricing.inputPerMillion) +
      perMillion(usage.output, pricing.outputPerMillion) +
      perMillion(usage.cacheRead, pricing.cacheReadPerMillion) +
      perMillion(usage.cacheWrite, pricing.cacheWritePerMillion),
  )
}
