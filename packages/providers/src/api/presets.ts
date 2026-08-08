import type { Clock, Logger, ModelPricing, ProviderCapabilities, ShellRunner } from '@uranus/core'
import { ApiProvider, type ApiProviderOptions } from './api-provider.js'

/**
 * Presets de provider.
 *
 * Todos usam o mesmo `ApiProvider` — o que muda é `baseUrl`, autenticação,
 * capacidades e preço. Adicionar um servidor novo compatível com OpenAI é
 * acrescentar um preset aqui, não escrever um adaptador.
 */

export interface PresetDeps {
  readonly shell: ShellRunner
  readonly clock: Clock
  readonly logger: Logger
  readonly apiKey?: string
  readonly model?: string
  readonly baseUrl?: string
  readonly temperature?: number
  readonly requestTimeoutMs?: number
}

// ── Modelos locais ──────────────────────────────────────────────────────────

/**
 * Ollama — `ollama serve` na porta 11434.
 *
 * Três ajustes existem por razões concretas de modelo local:
 *  - `maxContextTokens` conservador: a maioria dos modelos locais roda com
 *    janela bem menor que a nominal, e estourá-la trunca silenciosamente o
 *    prompt — o pior modo de falha possível, porque parece que funcionou.
 *  - Timeout longo: a primeira chamada carrega os pesos na memória.
 *  - `structuredOutput: true` porque o Ollama suporta `format: json`; a
 *    conformidade real continua sendo garantida pelo SchemaCheck (INV-2).
 */
export function ollamaProvider(deps: PresetDeps): ApiProvider {
  return new ApiProvider({
    id: 'ollama',
    baseUrl: deps.baseUrl ?? 'http://127.0.0.1:11434/v1',
    defaultModel: deps.model ?? 'qwen2.5-coder:14b',
    shell: deps.shell,
    clock: deps.clock,
    logger: deps.logger,
    requestTimeoutMs: deps.requestTimeoutMs ?? 600_000,
    temperature: deps.temperature ?? 0.1,
    capabilities: {
      maxContextTokens: 32_768,
      maxConcurrentSessions: 1, // GPU única: paralelismo só piora a latência
    },
    // Sem `pricing`: o custo em dinheiro é zero e o BudgetGuard passa a
    // governar por tokens e tempo, que é o que realmente limita aqui.
  })
}

/** LM Studio — servidor local na porta 1234. */
export function lmStudioProvider(deps: PresetDeps): ApiProvider {
  return new ApiProvider({
    id: 'lmstudio',
    baseUrl: deps.baseUrl ?? 'http://127.0.0.1:1234/v1',
    defaultModel: deps.model ?? 'local-model',
    shell: deps.shell,
    clock: deps.clock,
    logger: deps.logger,
    requestTimeoutMs: deps.requestTimeoutMs ?? 600_000,
    temperature: deps.temperature ?? 0.1,
    capabilities: { maxContextTokens: 32_768, maxConcurrentSessions: 1 },
  })
}

/** vLLM, llama.cpp server, TGI — qualquer servidor OpenAI-compatible. */
export function localProvider(deps: PresetDeps & { readonly baseUrl: string }): ApiProvider {
  return new ApiProvider({
    id: 'local',
    baseUrl: deps.baseUrl,
    ...(deps.apiKey === undefined ? {} : { apiKey: deps.apiKey }),
    defaultModel: deps.model ?? 'local-model',
    shell: deps.shell,
    clock: deps.clock,
    logger: deps.logger,
    requestTimeoutMs: deps.requestTimeoutMs ?? 600_000,
    temperature: deps.temperature ?? 0.1,
    capabilities: { maxContextTokens: 32_768, maxConcurrentSessions: 1 },
  })
}

// ── Serviços pagos ──────────────────────────────────────────────────────────

const GPT_PRICING: ModelPricing = {
  model: 'gpt-4.1',
  inputPerMillion: 2,
  outputPerMillion: 8,
  cacheReadPerMillion: 0.5,
  cacheWritePerMillion: 2,
  effectiveFrom: 0,
}

export function openAiProvider(deps: PresetDeps): ApiProvider {
  return new ApiProvider({
    id: 'openai-gpt',
    baseUrl: deps.baseUrl ?? 'https://api.openai.com/v1',
    ...(deps.apiKey === undefined ? {} : { apiKey: deps.apiKey }),
    defaultModel: deps.model ?? 'gpt-4.1',
    shell: deps.shell,
    clock: deps.clock,
    logger: deps.logger,
    pricing: GPT_PRICING,
    capabilities: { maxContextTokens: 128_000, vision: true, maxConcurrentSessions: 4 },
    ...(deps.temperature === undefined ? {} : { temperature: deps.temperature }),
  })
}

/**
 * OpenRouter — roteador para centenas de modelos.
 *
 * O preço varia por modelo, então não há tabela fixa: o custo em dinheiro fica
 * zerado e o orçamento governa por tokens. A Fase 7 (telemetria) lê o preço
 * real da resposta do OpenRouter.
 */
export function openRouterProvider(deps: PresetDeps): ApiProvider {
  return new ApiProvider({
    id: 'openrouter',
    baseUrl: deps.baseUrl ?? 'https://openrouter.ai/api/v1',
    ...(deps.apiKey === undefined ? {} : { apiKey: deps.apiKey }),
    defaultModel: deps.model ?? 'anthropic/claude-sonnet-4',
    shell: deps.shell,
    clock: deps.clock,
    logger: deps.logger,
    headers: {
      'HTTP-Referer': 'https://github.com/ruyteer/uranus',
      'X-Title': 'Uranus',
    },
    capabilities: { maxContextTokens: 200_000, maxConcurrentSessions: 4 },
    ...(deps.temperature === undefined ? {} : { temperature: deps.temperature }),
  })
}

/** Groq — inferência rápida, bom para os gates. */
export function groqProvider(deps: PresetDeps): ApiProvider {
  return new ApiProvider({
    id: 'groq',
    baseUrl: deps.baseUrl ?? 'https://api.groq.com/openai/v1',
    ...(deps.apiKey === undefined ? {} : { apiKey: deps.apiKey }),
    defaultModel: deps.model ?? 'llama-3.3-70b-versatile',
    shell: deps.shell,
    clock: deps.clock,
    logger: deps.logger,
    capabilities: { maxContextTokens: 128_000, maxConcurrentSessions: 2 },
    ...(deps.temperature === undefined ? {} : { temperature: deps.temperature }),
  })
}

/** Gemini expõe endpoint OpenAI-compatible desde 2024. */
export function geminiProvider(deps: PresetDeps): ApiProvider {
  return new ApiProvider({
    id: 'gemini',
    baseUrl: deps.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta/openai',
    ...(deps.apiKey === undefined ? {} : { apiKey: deps.apiKey }),
    defaultModel: deps.model ?? 'gemini-2.0-flash',
    shell: deps.shell,
    clock: deps.clock,
    logger: deps.logger,
    capabilities: { maxContextTokens: 1_000_000, vision: true, maxConcurrentSessions: 4 },
    ...(deps.temperature === undefined ? {} : { temperature: deps.temperature }),
  })
}

export type PresetName =
  'ollama' | 'lmstudio' | 'local' | 'openai-gpt' | 'openrouter' | 'groq' | 'gemini'

export const PRESET_NAMES: readonly PresetName[] = [
  'ollama',
  'lmstudio',
  'local',
  'openai-gpt',
  'openrouter',
  'groq',
  'gemini',
]

const BUILDERS: Record<PresetName, (deps: PresetDeps) => ApiProvider> = {
  ollama: ollamaProvider,
  lmstudio: lmStudioProvider,
  local: (deps) => localProvider({ ...deps, baseUrl: deps.baseUrl ?? 'http://127.0.0.1:8000/v1' }),
  'openai-gpt': openAiProvider,
  openrouter: openRouterProvider,
  groq: groqProvider,
  gemini: geminiProvider,
}

export function buildPreset(name: PresetName, deps: PresetDeps): ApiProvider {
  return BUILDERS[name](deps)
}

export function isPresetName(value: string): value is PresetName {
  return (PRESET_NAMES as readonly string[]).includes(value)
}

/** Capacidades declaradas de um preset, sem instanciá-lo. */
export function presetCapabilities(name: PresetName): Partial<ProviderCapabilities> {
  const isLocal = name === 'ollama' || name === 'lmstudio' || name === 'local'
  return {
    nativeFileEditing: false,
    toolUse: true,
    structuredOutput: true,
    maxContextTokens: isLocal ? 32_768 : 128_000,
    maxConcurrentSessions: isLocal ? 1 : 4,
  }
}

export type { ApiProviderOptions }
