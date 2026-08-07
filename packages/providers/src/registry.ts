import type { Provider, ProviderRegistry, ProviderRequirements, Result } from '@uranus/core'
import { NotFoundError, err, ok } from '@uranus/core'

interface BreakerState {
  consecutiveFailures: number
  openUntil: number
}

export interface DefaultProviderRegistryOptions {
  /** Falhas consecutivas para abrir o circuito. */
  readonly breakerThreshold?: number
  /** Quanto tempo o circuito fica aberto. */
  readonly breakerCooldownMs?: number
  readonly fallbackOrder?: readonly string[]
  readonly now?: () => number
}

/**
 * Registro com circuit breaker por provider (R14).
 *
 * O breaker existe para uma situação específica: o provider primário caiu e cada
 * task gastaria um timeout inteiro para redescobrir isso. Com o circuito aberto,
 * `resolve` pula direto para o fallback até o cooldown vencer.
 */
export class DefaultProviderRegistry implements ProviderRegistry {
  private readonly providers = new Map<string, Provider>()
  private readonly breakers = new Map<string, BreakerState>()
  private readonly threshold: number
  private readonly cooldownMs: number
  private fallbackOrder: readonly string[]
  private readonly now: () => number

  constructor(options: DefaultProviderRegistryOptions = {}) {
    this.threshold = options.breakerThreshold ?? 3
    this.cooldownMs = options.breakerCooldownMs ?? 60_000
    this.fallbackOrder = options.fallbackOrder ?? []
    this.now = options.now ?? Date.now
  }

  register(provider: Provider): void {
    this.providers.set(provider.id, provider)
  }

  get(id: string): Provider | undefined {
    return this.providers.get(id)
  }

  setFallbackOrder(order: readonly string[]): void {
    this.fallbackOrder = order
  }

  reportFailure(id: string): void {
    const state = this.breakers.get(id) ?? { consecutiveFailures: 0, openUntil: 0 }
    state.consecutiveFailures += 1
    if (state.consecutiveFailures >= this.threshold) {
      state.openUntil = this.now() + this.cooldownMs
    }
    this.breakers.set(id, state)
  }

  reportSuccess(id: string): void {
    this.breakers.delete(id)
  }

  isOpen(id: string): boolean {
    const state = this.breakers.get(id)
    return state !== undefined && state.openUntil > this.now()
  }

  resolve(requirements: ProviderRequirements): Result<Provider> {
    const order: string[] = []
    if (requirements.preferred !== undefined) order.push(requirements.preferred)
    order.push(...this.fallbackOrder.filter((id) => !order.includes(id)))
    for (const id of this.providers.keys()) {
      if (!order.includes(id)) order.push(id)
    }

    const rejections: string[] = []
    for (const id of order) {
      const provider = this.providers.get(id)
      if (provider === undefined) {
        rejections.push(`${id}: não registrado`)
        continue
      }
      if (this.isOpen(id)) {
        rejections.push(`${id}: circuito aberto`)
        continue
      }
      if (!satisfies(provider, requirements)) {
        rejections.push(`${id}: capabilities insuficientes`)
        continue
      }
      return ok(provider)
    }

    return err(
      new NotFoundError('Nenhum provider satisfaz os requisitos', {
        context: { rejections },
      }),
    )
  }

  list(): readonly Provider[] {
    return [...this.providers.values()]
  }
}

function satisfies(provider: Provider, requirements: ProviderRequirements): boolean {
  const needed = requirements.capabilities
  if (needed === undefined) return true
  const caps = provider.capabilities as unknown as Record<string, unknown>
  for (const [key, value] of Object.entries(needed) as [string, unknown][]) {
    if (value === undefined) continue
    const actual = caps[key]
    if (typeof value === 'boolean' && value && actual !== true) return false
    if (typeof value === 'number' && typeof actual === 'number' && actual < value) return false
  }
  return true
}
