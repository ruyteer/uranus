import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { silentLogger, systemClock } from '@uranus/core'
import { DefaultShellRunner } from '@uranus/executors'
import {
  ScriptedProvider,
  describeProviderContract,
  startFakeChatServer,
  type FakeChatServer,
} from '@uranus/testkit'
import { ApiProvider } from './api/api-provider.js'
import { ClaudeCodeProvider } from './claude-code/provider.js'
import { PRESET_NAMES, buildPreset, isPresetName, presetCapabilities } from './api/presets.js'

/**
 * A mesma suíte roda contra todos os providers. É isto que torna
 * "trocar de provider não muda mais nada" uma propriedade verificada.
 */

const shell = new DefaultShellRunner({ clock: systemClock, logger: silentLogger })

// ── ApiProvider contra servidor falso ───────────────────────────────────────

describeProviderContract('ApiProvider (servidor OpenAI-compatible)', async () => {
  const server: FakeChatServer = await startFakeChatServer([{ content: 'OK' }])
  return {
    provider: new ApiProvider({
      id: 'contrato-api',
      baseUrl: server.baseUrl,
      defaultModel: 'modelo-teste',
      shell,
      clock: systemClock,
      logger: silentLogger,
    }),
    workdir: mkdtempSync(join(tmpdir(), 'urn-ct-')),
    cleanup: () => server.close(),
  }
})

// ── ScriptedProvider (o fake usado nos testes do kernel) ────────────────────

describeProviderContract('ScriptedProvider', () => ({
  provider: new ScriptedProvider([{ text: 'OK' }]),
  workdir: mkdtempSync(join(tmpdir(), 'urn-ct-')),
}))

// ── ClaudeCodeProvider ──────────────────────────────────────────────────────
//
// Só as partes que não exigem o binário instalado nem gastam tokens. O caminho
// completo é exercitado pelos testes de integração do kernel e pelo uso real.

describe('contrato de Provider: ClaudeCodeProvider (parcial)', () => {
  const provider = new ClaudeCodeProvider({ shell, logger: silentLogger })

  it('declara capacidades coerentes', () => {
    expect(provider.id).toBe('claude-code')
    expect(provider.kind).toBe('cli')
    // Edita arquivos por conta própria — é a diferença para o ApiProvider.
    expect(provider.capabilities.nativeFileEditing).toBe(true)
    expect(provider.capabilities.maxContextTokens).toBeGreaterThan(0)
  })

  it('estimateCost é monotônico e não-negativo', () => {
    const zero = provider.estimateCost(
      { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
      'sonnet',
    )
    const algum = provider.estimateCost(
      { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
      'sonnet',
    )
    expect(zero.micros).toBe(0)
    expect(algum.micros).toBeGreaterThan(0)
  })

  it('opus custa mais que haiku para o mesmo uso', () => {
    const usage = { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }
    expect(provider.estimateCost(usage, 'opus').micros).toBeGreaterThan(
      provider.estimateCost(usage, 'haiku').micros,
    )
  })

  it('health() nunca lança mesmo sem o binário', async () => {
    const semBinario = new ClaudeCodeProvider({
      shell,
      logger: silentLogger,
      binary: 'binario-que-nao-existe-xyz',
    })
    const report = await semBinario.health(new AbortController().signal)
    expect(report.healthy).toBe(false)
    expect(report.detail).toContain('Claude Code CLI')
  })
})

// ── Presets ─────────────────────────────────────────────────────────────────

describe('presets de provider', () => {
  it('todos os presets instanciam sem rede', () => {
    for (const name of PRESET_NAMES) {
      const provider = buildPreset(name, { shell, clock: systemClock, logger: silentLogger })
      expect(provider.id).toBeTruthy()
      expect(provider.kind).toBe('api')
      // Nenhum provider de API edita arquivos sozinho: quem edita é o Uranus.
      expect(provider.capabilities.nativeFileEditing).toBe(false)
      expect(provider.capabilities.toolUse).toBe(true)
    }
  })

  it('presets locais são conservadores em contexto e concorrência', () => {
    for (const name of ['ollama', 'lmstudio', 'local'] as const) {
      const caps = presetCapabilities(name)
      // Estourar a janela de um modelo local trunca o prompt em silêncio — o
      // pior modo de falha, porque parece que funcionou.
      expect(caps.maxContextTokens).toBeLessThanOrEqual(32_768)
      // GPU única: paralelismo só piora a latência.
      expect(caps.maxConcurrentSessions).toBe(1)
    }
  })

  it('modelo local não tem custo em dinheiro; o orçamento passa a ser tokens', () => {
    const ollama = buildPreset('ollama', { shell, clock: systemClock, logger: silentLogger })
    const cost = ollama.estimateCost(
      { input: 10_000_000, output: 10_000_000, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
      'qwen',
    )
    expect(cost.micros).toBe(0)
  })

  it('serviço pago tem custo proporcional ao uso', () => {
    const gpt = buildPreset('openai-gpt', { shell, clock: systemClock, logger: silentLogger })
    const cost = gpt.estimateCost(
      { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
      'gpt-4.1',
    )
    expect(cost.micros).toBeGreaterThan(0)
  })

  it('isPresetName reconhece os válidos e recusa os demais', () => {
    expect(isPresetName('ollama')).toBe(true)
    expect(isPresetName('openrouter')).toBe(true)
    expect(isPresetName('inventado')).toBe(false)
  })

  it('baseUrl e modelo são sobrescrevíveis pela config', async () => {
    const server = await startFakeChatServer([], { models: ['meu-modelo'] })
    try {
      const provider = buildPreset('ollama', {
        shell,
        clock: systemClock,
        logger: silentLogger,
        baseUrl: server.baseUrl,
        model: 'meu-modelo',
      })
      const report = await provider.health(new AbortController().signal)
      expect(report.healthy).toBe(true)
    } finally {
      await server.close()
    }
  })
})
