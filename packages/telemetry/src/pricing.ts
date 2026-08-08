import type { ModelPricing, PricingTable } from '@uranus/core'

/**
 * Tabela de preços versionada.
 *
 * Duas decisões que parecem detalhe e não são:
 *
 * 1. **Versionada por `effectiveFrom`.** Um run de três meses atrás precisa ser
 *    reprecificado com o preço daquela época, ou o relatório de custo histórico
 *    muda sozinho toda vez que um provider reajusta. `lookup` recebe o instante
 *    e devolve o preço vigente naquele instante — nunca o mais recente.
 *
 * 2. **Casamento por família, do mais específico para o menos.** Modelos vêm
 *    com sufixo de data (`claude-sonnet-4-5-20250929`) e o preço é da família.
 *    Registrar cada snapshot seria uma tabela desatualizada por construção.
 *
 * **Sobre a exatidão desta tabela:** ela é um retrato de preços públicos e
 * envelhece. Ela existe para (a) modelos locais, onde o custo é zero de
 * verdade, e (b) providers que não reportam custo. Quando o provider reporta
 * custo real — o Claude Code CLI reporta `total_cost_usd` — esse valor vence a
 * tabela sempre (R18). Corrija o que estiver errado em `telemetry.pricing` na
 * config; `uranus cost reconcile` compara o total do Uranus com a sua fatura.
 */
export class DefaultPricingTable implements PricingTable {
  private readonly byProvider = new Map<string, { pricing: ModelPricing; seq: number }[]>()
  private readonly overrides = new Map<string, { pricing: ModelPricing; seq: number }[]>()
  private seq = 0

  register(provider: string, pricing: ModelPricing): void {
    this.registerIn(this.byProvider, provider, pricing)
  }

  /**
   * Preço definido pelo usuário. Vive numa camada própria e é consultado antes
   * da embutida — inclusive quando é menos específico.
   *
   * Sem a camada separada, escrever `claude-sonnet` na config não sobrescreveria
   * nada: o `claude-sonnet-4` embutido é um casamento mais específico e venceria.
   * Quem edita a config quer corrigir a família inteira, não descobrir que
   * precisa enumerar cada variante.
   */
  registerOverride(provider: string, pricing: ModelPricing): void {
    this.registerIn(this.overrides, provider, pricing)
  }

  private registerIn(
    target: Map<string, { pricing: ModelPricing; seq: number }[]>,
    provider: string,
    pricing: ModelPricing,
  ): void {
    const list = target.get(provider) ?? []
    list.push({ pricing, seq: this.seq++ })
    // Mais recente primeiro: o primeiro `effectiveFrom <= at` é o vigente.
    // O desempate por ordem de registro importa — é o que faz um override do
    // usuário com a mesma data vencer o preço embutido em vez de empatar e
    // depender da estabilidade do sort.
    list.sort((a, b) => b.pricing.effectiveFrom - a.pricing.effectiveFrom || b.seq - a.seq)
    target.set(provider, list)
  }

  lookup(provider: string, model: string, at: number): ModelPricing | undefined {
    const override = this.lookupIn(provider, model, at, this.overrides)
    if (override !== undefined) return override

    const direct = this.lookupIn(provider, model, at)
    if (direct !== undefined) return direct
    // Um provider agregador (OpenRouter, Groq) serve modelos de terceiros com
    // o nome de origem. Cair na tabela do dono do modelo é melhor que reportar
    // custo zero, que se confunde com "modelo local".
    //
    // `allowWildcard: false` é essencial aqui: os providers locais registram um
    // coringa de preço zero, e sem essa restrição um provider desconhecido
    // herdaria "de graça" de qualquer um deles — o jeito mais silencioso
    // possível de o relatório sair menor que a fatura.
    for (const other of this.byProvider.keys()) {
      if (other === provider) continue
      const found = this.lookupIn(other, model, at, this.byProvider, false)
      if (found !== undefined) return found
    }
    return undefined
  }

  providers(): readonly string[] {
    return [...this.byProvider.keys()]
  }

  entries(provider: string): readonly ModelPricing[] {
    return (this.byProvider.get(provider) ?? []).map((entry) => entry.pricing)
  }

  private lookupIn(
    provider: string,
    model: string,
    at: number,
    source: Map<string, { pricing: ModelPricing; seq: number }[]> = this.byProvider,
    allowWildcard = true,
  ): ModelPricing | undefined {
    const list = source.get(provider)
    if (list === undefined) return undefined

    const normalized = normalizeModel(model)
    let best: ModelPricing | undefined
    let bestScore = -1

    for (const { pricing } of list) {
      if (pricing.effectiveFrom > at) continue
      const score = matchScore(normalized, normalizeModel(pricing.model))
      if (score < 0) continue
      if (!allowWildcard && pricing.model === '*') continue
      // A lista já está ordenada por vigência; com o mesmo score, o primeiro
      // encontrado é o correto. Só um casamento mais específico o desbanca.
      if (score > bestScore) {
        best = pricing
        bestScore = score
      }
    }
    return best
  }
}

/** `claude-sonnet-4-5-20250929` e `claude.sonnet.4.5` viram a mesma chave. */
function normalizeModel(model: string): string {
  return model.toLowerCase().replace(/[._]/g, '-')
}

/**
 * Quanto o padrão registrado descreve o modelo pedido. Maior = mais específico.
 * `-1` quando não casa.
 */
function matchScore(model: string, pattern: string): number {
  // `*` é o coringa do provider: casa qualquer modelo com o menor score
  // possível, para que um padrão nomeado sempre o desbanque. É como o preço
  // zero dos providers locais cobre um modelo que ninguém cadastrou.
  if (pattern === '*') return 0
  if (model === pattern) return 1_000
  if (model.startsWith(pattern)) return pattern.length
  if (model.includes(pattern)) return pattern.length - 1
  return -1
}

// ── Tabela embutida ─────────────────────────────────────────────────────────

const JAN_2025 = Date.UTC(2025, 0, 1)

/** Anthropic: cache de leitura custa 0,1× a entrada; escrita, 1,25×. */
function anthropic(model: string, input: number, output: number): ModelPricing {
  return {
    model,
    inputPerMillion: input,
    outputPerMillion: output,
    cacheReadPerMillion: input * 0.1,
    cacheWritePerMillion: input * 1.25,
    effectiveFrom: JAN_2025,
  }
}

function openai(
  model: string,
  input: number,
  output: number,
  cacheRead = input * 0.5,
): ModelPricing {
  return {
    model,
    inputPerMillion: input,
    outputPerMillion: output,
    cacheReadPerMillion: cacheRead,
    cacheWritePerMillion: input,
    effectiveFrom: JAN_2025,
  }
}

/** Preço zero e explícito: modelo local não passa pelo orçamento em dinheiro. */
export const FREE_PRICING: ModelPricing = Object.freeze({
  model: '*',
  inputPerMillion: 0,
  outputPerMillion: 0,
  cacheReadPerMillion: 0,
  cacheWritePerMillion: 0,
  effectiveFrom: 0,
})

/**
 * Registra os preços públicos conhecidos.
 *
 * Preços em dólares por milhão de tokens. Não pretende ser exaustivo nem
 * eterno — ver a nota de exatidão no topo do arquivo.
 */
export function registerBuiltinPricing(table: PricingTable): void {
  for (const pricing of [
    anthropic('claude-opus-4', 15, 75),
    anthropic('claude-opus', 15, 75),
    anthropic('claude-sonnet-4', 3, 15),
    anthropic('claude-sonnet', 3, 15),
    anthropic('claude-haiku-4', 1, 5),
    anthropic('claude-haiku', 1, 5),
    anthropic('claude-3-5-haiku', 0.8, 4),
    anthropic('claude-3-opus', 15, 75),
  ]) {
    table.register('anthropic', pricing)
    table.register('claude-code', pricing)
  }

  for (const pricing of [
    openai('gpt-4o-mini', 0.15, 0.6),
    openai('gpt-4o', 2.5, 10),
    openai('gpt-4.1-mini', 0.4, 1.6),
    openai('gpt-4.1', 2, 8),
    openai('o4-mini', 1.1, 4.4),
    openai('o3-mini', 1.1, 4.4),
    openai('o3', 2, 8),
  ]) {
    table.register('openai', pricing)
  }

  for (const pricing of [
    openai('gemini-2.5-pro', 1.25, 10),
    openai('gemini-2.5-flash', 0.3, 2.5),
    openai('gemini-2.0-flash', 0.1, 0.4),
  ]) {
    table.register('gemini', pricing)
  }

  // Locais: custo zero é a verdade, não uma lacuna. A eletricidade não passa
  // pelo BudgetGuard, mas os limites de token e de tempo continuam valendo.
  for (const provider of ['ollama', 'lmstudio', 'llamacpp', 'vllm', 'local']) {
    table.register(provider, FREE_PRICING)
  }
}

/** Constrói a tabela padrão já povoada. */
export function createPricingTable(
  overrides: Readonly<Record<string, readonly ModelPricing[]>> = {},
): DefaultPricingTable {
  const table = new DefaultPricingTable()
  registerBuiltinPricing(table)
  // Numa camada própria, consultada primeiro — ver `registerOverride`.
  for (const [provider, list] of Object.entries(overrides)) {
    for (const pricing of list) table.registerOverride(provider, pricing)
  }
  return table
}
