import { describe, expect, it } from 'vitest'
import type { Provider, ProviderCapabilities } from '@uranus/core'
import { silentLogger, usd } from '@uranus/core'
import { DefaultProviderRegistry } from './registry.js'
import { ProviderRouter } from './router.js'

function fake(id: string, caps: Partial<ProviderCapabilities> = {}): Provider {
  return {
    id,
    kind: 'api',
    capabilities: {
      streaming: false,
      nativeFileEditing: false,
      toolUse: true,
      structuredOutput: true,
      resumableSessions: false,
      vision: false,
      maxContextTokens: 128_000,
      models: [],
      maxConcurrentSessions: 1,
      ...caps,
    },
    health: () => Promise.resolve({ healthy: true, detail: '', checkedAt: 0 }),
    createSession: () => Promise.reject(new Error('não usado')),
    estimateCost: () => usd(0),
    estimateTokens: () => 0,
  }
}

function setup(rules: ConstructorParameters<typeof ProviderRouter>[1]) {
  const registry = new DefaultProviderRegistry({ breakerThreshold: 2, breakerCooldownMs: 1_000 })
  registry.register(fake('claude-code', { nativeFileEditing: true }))
  registry.register(fake('ollama', { maxContextTokens: 32_768 }))
  registry.register(fake('openrouter'))
  return { registry, router: new ProviderRouter(registry, rules, silentLogger) }
}

const RULES = {
  byAgent: { executor: 'claude-code', reviewer: 'ollama', security: 'ollama' },
  byTier: { deep: 'claude-code', balanced: 'openrouter', fast: 'ollama' },
  default: 'claude-code',
  fallback: ['openrouter'],
}

describe('ProviderRouter — o híbrido que viabiliza modelo local', () => {
  it('roteia por papel: Executor no modelo forte, gates no local', () => {
    const { router } = setup(RULES)

    expect(
      router.resolve({ agent: 'executor' }).ok && router.resolve({ agent: 'executor' }),
    ).toMatchObject({ value: { id: 'claude-code' } })
    expect(router.resolve({ agent: 'reviewer' })).toMatchObject({ value: { id: 'ollama' } })
    expect(router.resolve({ agent: 'security' })).toMatchObject({ value: { id: 'ollama' } })
  })

  it('papel vence tier quando ambos apontam para lugares diferentes', () => {
    const { router } = setup(RULES)
    // `security` tem tier `deep` (→ claude-code) mas byAgent manda para ollama.
    const resolved = router.resolve({ agent: 'security', tier: 'deep' })
    expect(resolved).toMatchObject({ value: { id: 'ollama' } })
  })

  it('sem regra de papel, roteia por tier', () => {
    const { router } = setup(RULES)
    expect(router.resolve({ agent: 'desconhecido', tier: 'fast' })).toMatchObject({
      value: { id: 'ollama' },
    })
    expect(router.resolve({ agent: 'desconhecido', tier: 'balanced' })).toMatchObject({
      value: { id: 'openrouter' },
    })
  })

  it('sem papel nem tier, usa o default', () => {
    const { router } = setup(RULES)
    expect(router.resolve({})).toMatchObject({ value: { id: 'claude-code' } })
  })

  it('preferred explícito vence todo o resto', () => {
    const { router } = setup(RULES)
    expect(router.resolve({ agent: 'executor', preferred: 'openrouter' })).toMatchObject({
      value: { id: 'openrouter' },
    })
  })

  it('failover: provider degradado é pulado sem falhar a task', () => {
    const { registry, router } = setup(RULES)

    // Duas falhas abrem o circuito do claude-code.
    registry.reportFailure('claude-code')
    registry.reportFailure('claude-code')

    const resolved = router.resolve({ agent: 'executor' })
    expect(resolved.ok).toBe(true)
    expect(resolved.ok && resolved.value.id).not.toBe('claude-code')
  })

  it('respeita capacidades exigidas pelo agente', () => {
    const registry = new DefaultProviderRegistry()
    registry.register(fake('sem-schema', { structuredOutput: false }))
    registry.register(fake('com-schema', { structuredOutput: true }))
    const router = new ProviderRouter(
      registry,
      { default: 'sem-schema', byAgent: {}, byTier: {} },
      silentLogger,
    )

    const resolved = router.resolve({ capabilities: { structuredOutput: true } })
    expect(resolved).toMatchObject({ value: { id: 'com-schema' } })
  })

  it('provider inexistente na regra não quebra — cai para o próximo', () => {
    const { router } = setup({
      byAgent: { executor: 'provider-fantasma' },
      byTier: {},
      default: 'ollama',
    })
    expect(router.resolve({ agent: 'executor' })).toMatchObject({ value: { id: 'ollama' } })
  })

  it('nenhum provider satisfaz: erro com contexto, não exceção', () => {
    const registry = new DefaultProviderRegistry()
    registry.register(fake('simples', { structuredOutput: false }))
    const router = new ProviderRouter(
      registry,
      { default: 'simples', byAgent: {}, byTier: {} },
      silentLogger,
    )
    const resolved = router.resolve({ capabilities: { structuredOutput: true } })
    expect(resolved.ok).toBe(false)
  })

  it('candidateOrder não repete e segue a precedência declarada', () => {
    const { router } = setup(RULES)
    const order = router.candidateOrder({ agent: 'reviewer', tier: 'fast' })
    expect(order).toEqual(['ollama', 'claude-code', 'openrouter'])
    expect(new Set(order).size).toBe(order.length)
  })

  it('explain lista os candidatos e o modo de cada um', () => {
    const { router } = setup(RULES)
    const text = router.explain({ agent: 'executor', tier: 'deep' })
    expect(text).toContain('executor')
    expect(text).toContain('claude-code')
    expect(text).toContain('edita arquivos')
    expect(text).toContain('ferramentas via Uranus')
  })

  it('delega register/get/list ao registry — entra no lugar dele na injeção', () => {
    const { router } = setup(RULES)
    expect(router.list()).toHaveLength(3)
    expect(router.get('ollama')?.id).toBe('ollama')

    router.register(fake('novo'))
    expect(router.get('novo')?.id).toBe('novo')
  })
})
