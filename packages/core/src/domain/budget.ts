import type { Money, TokenUsage } from './usage.js'
import { ZERO_USD, addMoney, compareMoney, subtractMoney, totalTokens } from './usage.js'

/**
 * Orçamento — INV-7: limite duro, não aviso.
 *
 * Três dimensões (dinheiro, tokens, tempo) porque cada uma falha de um jeito:
 * dinheiro é o custo direto, tokens pegam o caso do provider sem preço conhecido,
 * e tempo pega o run que trava sem consumir nada. Estourar qualquer uma para o
 * ciclo.
 */

export interface BudgetLimits {
  readonly cost: Money
  readonly tokens: number
  readonly wallclockMs: number
}

export interface BudgetWindow {
  readonly limits: BudgetLimits
  readonly usedCost: Money
  readonly usedTokens: number
  readonly usedWallclockMs: number
}

export type BudgetExhaustionPolicy = 'pause' | 'stop' | 'ask'

export interface BudgetState {
  readonly run: BudgetWindow
  readonly task: BudgetWindow
  readonly onExhausted: BudgetExhaustionPolicy
}

export type BudgetDimension = 'cost' | 'tokens' | 'wallclock'

export interface BudgetVerdict {
  readonly admitted: boolean
  readonly exceeded?: { readonly window: 'run' | 'task'; readonly dimension: BudgetDimension }
  /** Dimensões acima do limiar de alerta, para emitir `BudgetThresholdReached`. */
  readonly warnings: readonly { window: 'run' | 'task'; dimension: BudgetDimension }[]
}

export interface CostEstimate {
  readonly cost: Money
  readonly tokens: number
  readonly wallclockMs: number
}

export function emptyWindow(limits: BudgetLimits): BudgetWindow {
  return { limits, usedCost: ZERO_USD, usedTokens: 0, usedWallclockMs: 0 }
}

export function remainingBudget(window: BudgetWindow): CostEstimate {
  return {
    cost: subtractMoney(window.limits.cost, window.usedCost),
    tokens: window.limits.tokens - window.usedTokens,
    wallclockMs: window.limits.wallclockMs - window.usedWallclockMs,
  }
}

export function isBudgetExhausted(window: BudgetWindow): BudgetDimension | undefined {
  const left = remainingBudget(window)
  if (left.cost.micros <= 0) return 'cost'
  if (left.tokens <= 0) return 'tokens'
  if (left.wallclockMs <= 0) return 'wallclock'
  return undefined
}

/**
 * Admissão: a estimativa cabe no que resta?
 *
 * Deliberadamente avaliado *antes* de gastar, com a estimativa pessimista de
 * `util/tokens.ts`. Verificar só depois seria descobrir o estouro quando o
 * dinheiro já saiu.
 */
export function admitBudget(
  state: BudgetState,
  estimate: CostEstimate,
  warnAt = 0.8,
): BudgetVerdict {
  const warnings: { window: 'run' | 'task'; dimension: BudgetDimension }[] = []

  for (const [name, window] of [
    ['run', state.run],
    ['task', state.task],
  ] as const) {
    const left = remainingBudget(window)
    if (compareMoney(estimate.cost, left.cost) > 0) {
      return { admitted: false, exceeded: { window: name, dimension: 'cost' }, warnings }
    }
    if (estimate.tokens > left.tokens) {
      return { admitted: false, exceeded: { window: name, dimension: 'tokens' }, warnings }
    }
    if (estimate.wallclockMs > left.wallclockMs) {
      return { admitted: false, exceeded: { window: name, dimension: 'wallclock' }, warnings }
    }

    const projectedCost = addMoney(window.usedCost, estimate.cost)
    if (
      window.limits.cost.micros > 0 &&
      projectedCost.micros / window.limits.cost.micros >= warnAt
    ) {
      warnings.push({ window: name, dimension: 'cost' })
    }
    if (
      window.limits.tokens > 0 &&
      (window.usedTokens + estimate.tokens) / window.limits.tokens >= warnAt
    ) {
      warnings.push({ window: name, dimension: 'tokens' })
    }
  }

  return { admitted: true, warnings }
}

export function consumeBudget(
  window: BudgetWindow,
  actual: { usage: TokenUsage; cost: Money; wallclockMs: number },
): BudgetWindow {
  return {
    limits: window.limits,
    usedCost: addMoney(window.usedCost, actual.cost),
    usedTokens: window.usedTokens + totalTokens(actual.usage),
    usedWallclockMs: window.usedWallclockMs + actual.wallclockMs,
  }
}

/** Reinicia a janela por task. Chamado ao iniciar cada attempt. */
export function resetTaskWindow(state: BudgetState): BudgetState {
  return { ...state, task: emptyWindow(state.task.limits) }
}
