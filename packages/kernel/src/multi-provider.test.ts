import { afterEach, describe, expect, it } from 'vitest'
import { silentLogger, systemClock, unwrap } from '@uranus/core'
import { DefaultShellRunner } from '@uranus/executors'
import { ApiProvider, DefaultProviderRegistry, ProviderRouter } from '@uranus/providers'
import {
  createGitRepo,
  gitIn,
  startFakeChatServer,
  withTempDir,
  type FakeChatServer,
} from '@uranus/testkit'
import { makeTestStack } from './test-stack.js'

const shell = new DefaultShellRunner({ clock: systemClock, logger: silentLogger })
const servers: FakeChatServer[] = []

afterEach(async () => {
  await Promise.all(servers.map((server) => server.close()))
  servers.length = 0
})

async function apiProvider(
  id: string,
  turns: Parameters<typeof startFakeChatServer>[0],
): Promise<ApiProvider> {
  const server = await startFakeChatServer(turns)
  servers.push(server)
  return new ApiProvider({
    id,
    baseUrl: server.baseUrl,
    defaultModel: 'modelo-teste',
    shell,
    clock: systemClock,
    logger: silentLogger,
  })
}

function repoComTestes(dir: string): void {
  createGitRepo({
    dir,
    files: {
      'package.json': JSON.stringify({ name: 'alvo', scripts: { test: 'node --test' } }),
      'src/calc.mjs': 'export const soma = (a, b) => a + b\n',
      'test/calc.test.mjs': [
        "import { test } from 'node:test'",
        "import assert from 'node:assert/strict'",
        "test('ok', () => { assert.ok(true) })",
        '',
      ].join('\n'),
    },
  })
}

describe('ApiProvider dentro do kernel (DoD Fase 8)', () => {
  it('uma task completa de ponta a ponta usando API em vez de CLI', async () => {
    await withTempDir(async (dir) => {
      repoComTestes(dir)

      // O "modelo" lê, edita e encerra — exatamente como um modelo local faria.
      const provider = await apiProvider('local-teste', [
        { toolCalls: [{ name: 'read_file', arguments: { path: 'src/calc.mjs' } }] },
        {
          toolCalls: [
            {
              name: 'write_file',
              arguments: {
                path: 'src/calc.mjs',
                content:
                  'export const soma = (a, b) => a + b\nexport const subtrai = (a, b) => a - b\n',
              },
            },
          ],
        },
        { content: 'Adicionei a função subtrai.' },
      ])

      const stack = await makeTestStack(dir, [], { providerOverride: provider })
      try {
        const task = await stack.enqueue({
          title: 'Adicionar subtracao',
          touches: ['src/**'],
          acceptance: {
            checks: [
              { kind: 'command', id: 'suite', run: 'node --test', timeoutMs: 120_000 },
              {
                kind: 'artifact',
                id: 'funcao',
                path: 'src/calc.mjs',
                mustExist: true,
                matches: 'subtrai',
                timeoutMs: 5_000,
              },
            ],
            requireAll: true,
          },
        })

        unwrap(await stack.kernel.start({ projectId: stack.project.id }))
        await stack.kernel.wait()

        const final = await stack.state.tasks.find(task.id)
        expect(final?.state).toBe('done')

        // O ciclo inteiro funcionou igual: commit criado, main intocada.
        const commits = gitIn(dir, 'log', '--all', '--oneline', '--grep', 'Adicionar subtracao')
        expect(commits.split('\n').filter((l) => l.trim() !== '')).toHaveLength(1)
        expect(gitIn(dir, 'status', '--porcelain')).toBe('')
      } finally {
        await stack.close()
      }
    })
  }, 90_000)

  it('escrita fora do escopo é barrada NA CHAMADA, não descoberta no diff', async () => {
    await withTempDir(async (dir) => {
      repoComTestes(dir)

      const provider = await apiProvider('local-teste', [
        // Tenta escapar do escopo declarado da task.
        {
          toolCalls: [
            {
              name: 'write_file',
              arguments: { path: '.github/workflows/ci.yml', content: 'malicioso' },
            },
          ],
        },
        // Informado da negação, faz o trabalho certo.
        {
          toolCalls: [
            {
              name: 'write_file',
              arguments: { path: 'src/ok.mjs', content: 'export const ok = 1\n' },
            },
          ],
        },
        { content: 'Fiz apenas dentro do escopo.' },
      ])

      const stack = await makeTestStack(dir, [], { providerOverride: provider })
      try {
        const task = await stack.enqueue({
          title: 'Respeitar escopo',
          touches: ['src/**'],
          acceptance: {
            checks: [
              {
                kind: 'artifact',
                id: 'arquivo',
                path: 'src/ok.mjs',
                mustExist: true,
                timeoutMs: 5_000,
              },
            ],
            requireAll: true,
          },
        })

        unwrap(await stack.kernel.start({ projectId: stack.project.id }))
        await stack.kernel.wait()

        // A task passou: a tentativa de escape virou uma correção do próprio
        // modelo, não uma reprovação tardia pelo DiffCheck.
        expect((await stack.state.tasks.find(task.id))?.state).toBe('done')

        // E o arquivo de CI nunca foi criado em lugar nenhum.
        const commits = gitIn(dir, 'log', '--all', '--name-only', '--format=')
        expect(commits).not.toContain('.github/workflows/ci.yml')
      } finally {
        await stack.close()
      }
    })
  }, 90_000)

  it('híbrido: Executor num provider, gates em outro', async () => {
    await withTempDir(async (dir) => {
      repoComTestes(dir)

      const executor = await apiProvider('forte', [
        {
          toolCalls: [
            {
              name: 'write_file',
              arguments: { path: 'src/novo.mjs', content: 'export const n = 1\n' },
            },
          ],
        },
        { content: 'Feito.' },
      ])
      const revisor = await apiProvider('barato', [{ content: '```json\n{"findings": []}\n```' }])

      const registry = new DefaultProviderRegistry()
      registry.register(executor)
      registry.register(revisor)
      const router = new ProviderRouter(
        registry,
        {
          byAgent: { executor: 'forte', reviewer: 'barato' },
          byTier: {},
          default: 'forte',
        },
        silentLogger,
      )

      const stack = await makeTestStack(dir, [], {
        providerOverride: executor,
        providerRegistry: router,
        gates: ['reviewer'],
      })
      try {
        const task = await stack.enqueue({
          title: 'Task hibrida',
          touches: ['src/**'],
          acceptance: {
            checks: [
              {
                kind: 'artifact',
                id: 'a',
                path: 'src/novo.mjs',
                mustExist: true,
                timeoutMs: 5_000,
              },
            ],
            requireAll: true,
          },
        })

        unwrap(await stack.kernel.start({ projectId: stack.project.id }))
        await stack.kernel.wait()

        expect((await stack.state.tasks.find(task.id))?.state).toBe('done')

        // Cada provider recebeu exatamente o trabalho do seu papel.
        expect(servers[0]!.callCount).toBeGreaterThan(0) // executor
        expect(servers[1]!.callCount).toBe(1) // revisor: uma passada só
      } finally {
        await stack.close()
      }
    })
  }, 90_000)
})
