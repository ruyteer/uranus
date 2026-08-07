import { describe, expect, it } from 'vitest'
import type { AgentRunContext, ProviderCapabilities } from '@uranus/core'
import { EMPTY_USAGE, ZERO_USD, silentLogger, unwrap } from '@uranus/core'
import { DefaultPromptRegistry, registerBuiltinPrompts } from '@uranus/prompts'
import { ScriptedProvider, makeAttempt, makeTask, withTempDir } from '@uranus/testkit'
import { DefaultAgentRegistry, validateSpec } from './registry.js'
import { DefaultAgentRuntime, effectivePermissions } from './runtime.js'
import { EXECUTOR_SPEC } from './executor-spec.js'

const CAPS: ProviderCapabilities = {
  streaming: true,
  nativeFileEditing: true,
  toolUse: true,
  structuredOutput: false,
  resumableSessions: false,
  vision: false,
  maxContextTokens: 200_000,
  models: ['m'],
  maxConcurrentSessions: 1,
}

describe('validateSpec', () => {
  it('aprova a spec do executor', () => {
    expect(validateSpec(EXECUTOR_SPEC)).toEqual([])
  })

  it('reprova spec sem critério de sucesso executável (INV-2)', () => {
    const invalid = {
      ...EXECUTOR_SPEC,
      successCriteria: { checks: [], requireAll: true },
    }
    expect(validateSpec(invalid).some((p) => p.includes('successCriteria'))).toBe(true)
  })

  it('reprova spec sem handles ou sem missão', () => {
    expect(validateSpec({ ...EXECUTOR_SPEC, handles: [] })).not.toEqual([])
    expect(validateSpec({ ...EXECUTOR_SPEC, mission: 'x' })).not.toEqual([])
  })
})

describe('DefaultAgentRegistry', () => {
  it('registra e roteia por kind', () => {
    const registry = new DefaultAgentRegistry()
    unwrap(registry.register(EXECUTOR_SPEC))

    const resolved = registry.resolve(makeTask({ kind: 'feature' }), CAPS)
    expect(resolved.ok && resolved.value.name).toBe('executor')
  })

  it('specificity maior vence — plugins sobrescrevem genéricos', () => {
    const registry = new DefaultAgentRegistry()
    unwrap(registry.register(EXECUTOR_SPEC))
    unwrap(
      registry.register({
        ...EXECUTOR_SPEC,
        name: 'backend-laravel',
        specificity: 10,
      }),
    )
    const resolved = registry.resolve(makeTask({ kind: 'feature' }), CAPS)
    expect(resolved.ok && resolved.value.name).toBe('backend-laravel')
  })

  it('agentHint tem precedência quando compatível', () => {
    const registry = new DefaultAgentRegistry()
    unwrap(registry.register(EXECUTOR_SPEC))
    unwrap(registry.register({ ...EXECUTOR_SPEC, name: 'especial', specificity: -1 }))
    const resolved = registry.resolve(makeTask({ agentHint: 'especial' }), CAPS)
    expect(resolved.ok && resolved.value.name).toBe('especial')
  })

  it('kind sem agente registrado falha com contexto', () => {
    const registry = new DefaultAgentRegistry()
    unwrap(registry.register(EXECUTOR_SPEC))
    const resolved = registry.resolve(makeTask({ kind: 'security' }), CAPS)
    expect(resolved.ok).toBe(false)
  })

  it('rejeita spec inválida no registro, não no uso', () => {
    const registry = new DefaultAgentRegistry()
    const result = registry.register({ ...EXECUTOR_SPEC, handles: [] })
    expect(result.ok).toBe(false)
    expect(registry.get(EXECUTOR_SPEC.name)).toBeUndefined()
  })
})

describe('effectivePermissions (INV-5)', () => {
  it('intersecta fs.write da spec com o escopo da task', () => {
    const effective = effectivePermissions(EXECUTOR_SPEC, ['src/api/**'])
    expect(effective.fs.write).toContain('src/api/**')
    expect(effective.fs.write).not.toContain('**')
    // deny da spec sobrevive à interseção.
    expect(effective.fs.deny).toContain('.env')
    // rede continua desligada (spec nega).
    expect(effective.network).toBe(false)
  })
})

describe('DefaultAgentRuntime', () => {
  function makeRuntime(): { runtime: DefaultAgentRuntime; registry: DefaultAgentRegistry } {
    const prompts = new DefaultPromptRegistry()
    registerBuiltinPrompts(prompts)
    const registry = new DefaultAgentRegistry()
    unwrap(registry.register(EXECUTOR_SPEC))
    return {
      runtime: new DefaultAgentRuntime({ prompts, registry, logger: silentLogger }),
      registry,
    }
  }

  function makeContext(workdir: string, provider: ScriptedProvider): AgentRunContext {
    const task = makeTask({ title: 'Adicionar endpoint', intent: 'Criar GET /health.' })
    return {
      task,
      attempt: makeAttempt({ taskId: task.id }),
      workspace: {
        id: 'wsp_x' as never,
        taskId: task.id,
        rootDir: workdir,
        branch: 'b',
        baseCommit: 'c',
        ownedPaths: task.touches,
        createdAt: 0,
      },
      context: {
        fragments: [],
        tokens: 0,
        budgetTokens: 100,
        dropped: [],
        digest: 'd',
        builtAt: 0,
      },
      provider,
      logger: silentLogger,
    }
  }

  it('monta o SessionRequest com prompts renderizados e escopo da task', async () => {
    await withTempDir(async (dir) => {
      const { runtime } = makeRuntime()
      const provider = new ScriptedProvider([{ writes: { 'src/feito.ts': 'ok' } }])
      const output = await runtime.run(
        EXECUTOR_SPEC,
        makeContext(dir, provider),
        new AbortController().signal,
      )

      expect(provider.sessions).toHaveLength(1)
      const request = provider.sessions[0]!
      expect(request.instruction).toContain('Adicionar endpoint')
      expect(request.instruction).toContain('Criar GET /health.')
      expect(request.instruction).toContain('src/**')
      expect(request.systemPrompt).toContain('Executor')
      expect(request.workdir).toBe(dir)
      expect(request.permissions.fs.write).toContain('src/**')

      expect(output.summary.length).toBeGreaterThan(0)
      expect(output.usage.input).toBeGreaterThan(0)
    })
  })

  it('injeta o diagnóstico da tentativa anterior no retry (R3)', async () => {
    await withTempDir(async (dir) => {
      const { runtime } = makeRuntime()
      const provider = new ScriptedProvider([{}])
      const context = makeContext(dir, provider)
      const withDiagnosis: AgentRunContext = {
        ...context,
        attempt: {
          ...context.attempt,
          n: 2,
          outcome: {
            status: 'failed',
            diagnosis: {
              category: 'test-failure',
              summary: 'AssertionError em soma.test.ts',
              evidence: [{ kind: 'stderr', ref: 'tests', excerpt: 'expected 2 to be 3' }],
              suggestedAction: 'retry-with-context',
            },
          },
        },
      }
      await runtime.run(EXECUTOR_SPEC, withDiagnosis, new AbortController().signal)

      const request = provider.sessions[0]!
      expect(request.instruction).toContain('FALHOU na verificação')
      expect(request.instruction).toContain('test-failure')
      expect(request.instruction).toContain('expected 2 to be 3')
    })
  })

  it('primeira tentativa não tem bloco de falha', async () => {
    await withTempDir(async (dir) => {
      const { runtime } = makeRuntime()
      const provider = new ScriptedProvider([{}])
      await runtime.run(EXECUTOR_SPEC, makeContext(dir, provider), new AbortController().signal)
      expect(provider.sessions[0]!.instruction).not.toContain('FALHOU')
    })
  })

  it('sessão com status error lança ProviderError com a causa e o usage (INV-7)', async () => {
    await withTempDir(async (dir) => {
      const { runtime } = makeRuntime()
      const provider = new ScriptedProvider([
        {
          status: 'error',
          text: 'Not logged in · Please run /login',
          usage: { ...EMPTY_USAGE, input: 42 },
          costUsd: 0.001,
        },
      ])
      await expect(
        runtime.run(EXECUTOR_SPEC, makeContext(dir, provider), new AbortController().signal),
      ).rejects.toMatchObject({
        code: 'E_PROVIDER',
        message: expect.stringContaining('Not logged in') as string,
        context: expect.objectContaining({
          usage: expect.objectContaining({ input: 42 }) as unknown,
        }) as unknown,
      })
    })
  })

  it('hooks afterRun substituem a normalização default', async () => {
    await withTempDir(async (dir) => {
      const prompts = new DefaultPromptRegistry()
      registerBuiltinPrompts(prompts)
      const registry = new DefaultAgentRegistry()
      unwrap(
        registry.register(EXECUTOR_SPEC, {
          afterRun: (_context, result) =>
            Promise.resolve({
              summary: `hook:${result.status}`,
              memoryDrafts: [],
              followUps: [],
              usage: EMPTY_USAGE,
              cost: ZERO_USD,
            }),
        }),
      )
      const runtime = new DefaultAgentRuntime({ prompts, registry, logger: silentLogger })
      const provider = new ScriptedProvider([{}])
      const output = await runtime.run(
        EXECUTOR_SPEC,
        makeContext(dir, provider),
        new AbortController().signal,
      )
      expect(output.summary).toBe('hook:completed')
    })
  })
})
