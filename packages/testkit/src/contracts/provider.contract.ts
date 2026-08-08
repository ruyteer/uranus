import { describe, expect, it } from 'vitest'
import type { ContextPack, Provider, SessionRequest } from '@uranus/core'
import { usd } from '@uranus/core'

/**
 * Suíte de contrato de `Provider`.
 *
 * **Todo** provider — CLI, API, local ou de terceiros — precisa passar nesta
 * suíte. É ela que torna a promessa "trocar de provider não muda mais nada"
 * verificável em vez de aspiracional: o kernel só usa o que está aqui.
 *
 * Uso:
 * ```ts
 * describeProviderContract('meu-provider', () => ({
 *   provider: new MeuProvider(...),
 *   cleanup: async () => { ... },
 * }))
 * ```
 */

export interface ProviderContractSetup {
  readonly provider: Provider
  /** Diretório de trabalho para a sessão de teste. */
  readonly workdir: string
  cleanup?: () => Promise<void>
}

const EMPTY_PACK: ContextPack = {
  fragments: [],
  tokens: 0,
  budgetTokens: 10_000,
  dropped: [],
  digest: 'contract',
  builtAt: 0,
}

export function minimalSessionRequest(workdir: string): SessionRequest {
  return {
    systemPrompt: 'Responda de forma breve.',
    instruction: 'Responda apenas: OK',
    context: EMPTY_PACK,
    tools: [],
    workdir,
    permissions: {
      tools: { allow: ['*'], deny: [] },
      fs: { read: ['**'], write: [], deny: [] },
      network: false,
      exec: false,
      secrets: { allow: [] },
    },
    limits: { maxTokens: 10_000, maxWallclockMs: 60_000, maxTurns: 3, maxCost: usd(1) },
    metadata: { taskId: 'contract-test' },
  }
}

export function describeProviderContract(
  name: string,
  setup: () => Promise<ProviderContractSetup> | ProviderContractSetup,
): void {
  describe(`contrato de Provider: ${name}`, () => {
    it('declara identidade e capacidades coerentes', async () => {
      const { provider, cleanup } = await setup()
      try {
        expect(provider.id).toBeTruthy()
        expect(['cli', 'api']).toContain(provider.kind)

        const caps = provider.capabilities
        expect(typeof caps.nativeFileEditing).toBe('boolean')
        expect(typeof caps.toolUse).toBe('boolean')
        expect(typeof caps.structuredOutput).toBe('boolean')
        expect(caps.maxContextTokens).toBeGreaterThan(0)
        expect(caps.maxConcurrentSessions).toBeGreaterThanOrEqual(1)

        // Um provider que NÃO edita arquivos precisa oferecer ferramentas —
        // caso contrário o Executor não teria como produzir diff nenhum.
        if (!caps.nativeFileEditing) {
          expect(caps.toolUse).toBe(true)
        }
      } finally {
        await cleanup?.()
      }
    })

    it('health() nunca lança, mesmo com o serviço fora do ar', async () => {
      const { provider, cleanup } = await setup()
      try {
        const report = await provider.health(new AbortController().signal)
        expect(typeof report.healthy).toBe('boolean')
        expect(report.detail).toBeTruthy()
        expect(report.checkedAt).toBeGreaterThanOrEqual(0)
      } finally {
        await cleanup?.()
      }
    })

    it('estimateTokens é positivo e cresce com a entrada', async () => {
      const { provider, workdir, cleanup } = await setup()
      try {
        const pequeno = provider.estimateTokens(minimalSessionRequest(workdir))
        const grande = provider.estimateTokens({
          ...minimalSessionRequest(workdir),
          instruction: 'x'.repeat(10_000),
        })
        expect(pequeno).toBeGreaterThan(0)
        expect(grande).toBeGreaterThan(pequeno)
      } finally {
        await cleanup?.()
      }
    })

    it('estimateCost é não-negativo e monotônico no uso', async () => {
      const { provider, cleanup } = await setup()
      try {
        const zero = provider.estimateCost(
          { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
          'qualquer',
        )
        const algum = provider.estimateCost(
          { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
          'qualquer',
        )
        expect(zero.micros).toBe(0)
        expect(algum.micros).toBeGreaterThanOrEqual(zero.micros)
        expect(algum.currency).toBe('USD')
      } finally {
        await cleanup?.()
      }
    })

    it('createSession devolve sessão com id e resultado bem formado', async () => {
      const { provider, workdir, cleanup } = await setup()
      try {
        const session = await provider.createSession(
          minimalSessionRequest(workdir),
          new AbortController().signal,
        )
        expect(session.id).toBeTruthy()

        const result = await session.result()
        expect(['completed', 'interrupted', 'error', 'limit_reached']).toContain(result.status)
        expect(typeof result.text).toBe('string')
        expect(result.turns).toBeGreaterThanOrEqual(0)
        expect(Array.isArray(result.filesTouched)).toBe(true)

        // O uso é sempre um objeto completo — o BudgetGuard soma sem checar nulo.
        for (const field of ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning'] as const) {
          expect(typeof result.usage[field]).toBe('number')
          expect(result.usage[field]).toBeGreaterThanOrEqual(0)
        }
        expect(result.cost.currency).toBe('USD')
      } finally {
        await cleanup?.()
      }
    })

    it('result() é idempotente — chamar duas vezes devolve o mesmo resultado', async () => {
      const { provider, workdir, cleanup } = await setup()
      try {
        const session = await provider.createSession(
          minimalSessionRequest(workdir),
          new AbortController().signal,
        )
        const primeiro = await session.result()
        const segundo = await session.result()
        // O kernel chama `result()` depois de drenar o stream; uma segunda
        // execução da sessão duplicaria custo e efeitos.
        expect(segundo).toEqual(primeiro)
      } finally {
        await cleanup?.()
      }
    })

    it('stream() termina com um evento done contendo o resultado', async () => {
      const { provider, workdir, cleanup } = await setup()
      try {
        const session = await provider.createSession(
          minimalSessionRequest(workdir),
          new AbortController().signal,
        )
        const events = []
        for await (const event of session.stream()) events.push(event)

        expect(events.length).toBeGreaterThan(0)
        const last = events.at(-1)!
        expect(last.type).toBe('done')
        if (last.type === 'done') {
          expect(last.result.status).toBeTruthy()
        }
      } finally {
        await cleanup?.()
      }
    })

    it('interrupt() nunca lança', async () => {
      const { provider, workdir, cleanup } = await setup()
      try {
        const session = await provider.createSession(
          minimalSessionRequest(workdir),
          new AbortController().signal,
        )
        await expect(session.interrupt('teste de contrato')).resolves.toBeUndefined()
      } finally {
        await cleanup?.()
      }
    })
  })
}
