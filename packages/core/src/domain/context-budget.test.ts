import { describe, expect, it } from 'vitest'
import { DEFAULT_PACK_SHARE, effectiveContextBudget, explainContextClamp } from './context-budget.js'

describe('effectiveContextBudget', () => {
  it('corta o pack para caber na janela do provider', () => {
    // O caso real: config global de 120k, servidor Ollama com num_ctx de 4096.
    // Sem o corte, o servidor descarta ~97% do pack e não avisa ninguém.
    const decisao = effectiveContextBudget(120_000, 4_096)
    expect(decisao.tokens).toBe(2_048)
    expect(decisao.clamped).toBe(true)
  })

  it('respeita a config quando ela é menor que a janela', () => {
    // A config é teto, não meta: janela grande não autoriza gastar mais.
    const decisao = effectiveContextBudget(8_000, 200_000)
    expect(decisao.tokens).toBe(8_000)
    expect(decisao.clamped).toBe(false)
  })

  it('reserva espaço para o laço de ferramentas, não só para o pack', () => {
    // O pack é a entrada inicial; o conteúdo lido pelo modelo durante o laço
    // divide a mesma janela. Ocupá-la inteira com o pack deixaria o agente sem
    // espaço para ler o primeiro arquivo.
    expect(effectiveContextBudget(1_000_000, 100_000).tokens).toBe(100_000 * DEFAULT_PACK_SHARE)
  })

  it('aceita `packShare` explícito', () => {
    expect(effectiveContextBudget(1_000_000, 100_000, 0.25).tokens).toBe(25_000)
    expect(effectiveContextBudget(1_000_000, 100_000, 1).tokens).toBe(100_000)
  })

  it('trata `packShare` fora de faixa sem explodir', () => {
    expect(effectiveContextBudget(1_000_000, 100_000, 5).tokens).toBe(100_000)
    expect(effectiveContextBudget(1_000_000, 100_000, -1).tokens).toBe(1)
  })

  it('provider sem janela declarada cai na config, não em zero', () => {
    // Zerar o contexto por falta de metadado seria trocar um bug silencioso
    // por outro: o agente rodaria cego.
    for (const invalido of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(effectiveContextBudget(50_000, invalido).tokens).toBe(50_000)
    }
  })

  it('nunca devolve zero ou negativo', () => {
    expect(effectiveContextBudget(10, 1).tokens).toBeGreaterThan(0)
    expect(effectiveContextBudget(1, 1).tokens).toBeGreaterThan(0)
  })

  it('é pura', () => {
    expect(effectiveContextBudget(120_000, 4_096)).toEqual(effectiveContextBudget(120_000, 4_096))
  })

  it('a explicação nomeia o provider e os dois números', () => {
    const texto = explainContextClamp(effectiveContextBudget(120_000, 4_096), 'ollama')
    expect(texto).toContain('ollama')
    expect(texto).toContain('120000')
    expect(texto).toContain('2048')
  })
})
