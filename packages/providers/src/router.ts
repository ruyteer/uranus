import type { Logger, Provider, ProviderRegistry, ProviderRequirements, Result } from '@uranus/core'
import { NotFoundError, err } from '@uranus/core'

/**
 * Roteamento por papel e por tier.
 *
 * É o que torna o híbrido viável: o Executor (edição multi-turno com
 * ferramentas, onde modelos pequenos quebram) usa um modelo forte, enquanto os
 * gates (uma passada, saída estruturada — tratáveis localmente) usam um modelo
 * local de custo zero.
 *
 * A resolução tenta, em ordem: papel específico → tier → padrão → registry.
 * Cada etapa respeita o circuit breaker, então um provider fora do ar é pulado
 * sem que a task falhe.
 */

export interface RoutingRules {
  /** `executor: 'claude-code'`, `reviewer: 'ollama'`. Vence tudo. */
  readonly byAgent?: Readonly<Record<string, string>>
  /** `deep: 'claude-code'`, `fast: 'ollama'`. */
  readonly byTier?: Readonly<Record<string, string>>
  readonly default: string
  readonly fallback?: readonly string[]
}

export type RouteRequest = ProviderRequirements

/**
 * Implementa `ProviderRegistry` delegando register/get/list ao registro real e
 * sobrescrevendo apenas `resolve`. Assim o roteador entra no lugar do registry
 * na injeção do kernel sem que o kernel precise conhecer roteamento.
 */
export class ProviderRouter implements ProviderRegistry {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly rules: RoutingRules,
    private readonly logger: Logger,
  ) {}

  register(provider: Provider): void {
    this.registry.register(provider)
  }

  get(id: string): Provider | undefined {
    return this.registry.get(id)
  }

  list(): readonly Provider[] {
    return this.registry.list()
  }

  resolve(request: RouteRequest): Result<Provider> {
    const candidates = this.candidateOrder(request)
    const rejected: string[] = []

    for (const id of candidates) {
      const resolved = this.registry.resolve({
        ...(request.capabilities === undefined ? {} : { capabilities: request.capabilities }),
        preferred: id,
      })
      // `resolve` do registry só devolve o preferido se ele existir, estiver
      // saudável e satisfizer as capacidades — caso contrário cai para o
      // próprio fallback dele, o que aqui seria pular a nossa ordem. Por isso
      // conferimos que veio exatamente quem pedimos.
      if (resolved.ok && resolved.value.id === id) return resolved
      rejected.push(id)
    }

    // Nenhum candidato específico serviu: aceita qualquer um que satisfaça.
    const anyProvider = this.registry.resolve(
      request.capabilities === undefined ? {} : { capabilities: request.capabilities },
    )
    if (anyProvider.ok) {
      this.logger.warn('Roteamento caiu para provider genérico', {
        agent: request.agent,
        rejected,
        chosen: anyProvider.value.id,
      })
      return anyProvider
    }

    return err(
      new NotFoundError('Nenhum provider disponível satisfaz os requisitos', {
        context: { agent: request.agent, tier: request.tier, rejected },
      }),
    )
  }

  /** Ordem de preferência, sem duplicatas. Exposto para `uranus provider list`. */
  candidateOrder(request: RouteRequest): readonly string[] {
    const order: string[] = []
    const push = (id: string | undefined): void => {
      if (id !== undefined && id !== '' && !order.includes(id)) order.push(id)
    }

    if (request.preferred !== undefined) push(request.preferred)
    if (request.agent !== undefined) push(this.rules.byAgent?.[request.agent])
    if (request.tier !== undefined) push(this.rules.byTier?.[request.tier])
    push(this.rules.default)
    for (const id of this.rules.fallback ?? []) push(id)

    return order
  }

  /** Explica a escolha — alimenta `uranus provider list` e o diagnóstico. */
  explain(request: RouteRequest): string {
    const order = this.candidateOrder(request)
    const lines = order.map((id, index) => {
      const provider = this.registry.get(id)
      const state =
        provider === undefined
          ? 'não registrado'
          : `${provider.kind}, ${provider.capabilities.nativeFileEditing ? 'edita arquivos' : 'ferramentas via Uranus'}`
      return `  ${String(index + 1)}. ${id.padEnd(14)} ${state}`
    })
    return [
      `Roteamento para ${request.agent ?? '(sem agente)'}${request.tier === undefined ? '' : ` [tier ${request.tier}]`}:`,
      ...lines,
    ].join('\n')
  }
}
