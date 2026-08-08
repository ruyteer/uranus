import { describe, expect, it } from 'vitest'
import { unwrap } from '@uranus/core'
import type { PlannerOutput } from '@uranus/backlog'
import { createGitRepo, gitIn, withTempDir } from '@uranus/testkit'
import { makeTestStack } from './test-stack.js'

const NEVER = new AbortController().signal

/** Repo com sinal de verificação real (node --test), para sair do modo restrito. */
function repoComTestes(dir: string): void {
  createGitRepo({
    dir,
    files: {
      'package.json': JSON.stringify({
        name: 'alvo',
        scripts: { test: 'node --test' },
      }),
      'src/calc.mjs': 'export const soma = (a, b) => a + b\n',
      'test/calc.test.mjs': [
        "import { test } from 'node:test'",
        "import assert from 'node:assert/strict'",
        "import { soma } from '../src/calc.mjs'",
        "test('soma', () => { assert.equal(soma(1, 2), 3) })",
        '',
      ].join('\n'),
    },
  })
}

/** Plano bem formado que o validador aceita. */
const PLANO_BOM: PlannerOutput = {
  summary: 'Adicionar subtração ao módulo de cálculo, com testes.',
  rationale:
    'Uma tarefa só: a mudança é pequena, coesa e verificável pela suíte existente do projeto.',
  tasks: [
    {
      ref: 'sub',
      kind: 'feature',
      title: 'Adicionar função de subtração',
      intent:
        'Exportar `subtrai(a, b)` em src/calc.mjs devolvendo a diferença, e cobrir com teste em test/.',
      touches: ['src/**', 'test/**'],
      acceptance: {
        checks: [
          { kind: 'command', id: 'suite', run: 'node --test' },
          {
            kind: 'artifact',
            id: 'funcao',
            path: 'src/calc.mjs',
            mustExist: true,
            matches: 'subtrai',
          },
        ],
      },
    },
  ],
}

/** Plano que viola três regras de uma vez. */
const PLANO_RUIM: PlannerOutput = {
  summary: 'Plano que o validador precisa recusar.',
  rationale: 'Existe para provar que a rejeição acontece antes de qualquer efeito no repositório.',
  tasks: [
    {
      ref: 'a',
      kind: 'feature',
      title: 'Task com escopo amplo demais',
      intent: 'Mexer em tudo que for necessário para resolver o problema de alguma forma.',
      touches: ['**'], // amplo demais
      acceptance: {
        checks: [{ kind: 'diff', id: 'd', requireNonEmpty: true }], // não prova comportamento
      },
    },
    {
      ref: 'b',
      kind: 'feature',
      title: 'Task que depende de fantasma',
      intent: 'Depende de uma task que não existe no plano, o que quebra o grafo.',
      touches: ['.github/workflows/**'], // caminho proibido
      dependsOn: ['inexistente'],
      acceptance: { checks: [{ kind: 'command', id: 'c', run: 'rm -rf dist' }] }, // destrutivo
    },
  ],
}

describe('PlanningService — item de backlog vira tasks (DoD Fase 4)', () => {
  it('um item em prosa vira tasks válidas na fila', async () => {
    await withTempDir(async (dir) => {
      repoComTestes(dir)
      const stack = await makeTestStack(dir, [
        { text: JSON.stringify(PLANO_BOM), status: 'completed' },
      ])
      try {
        const item = unwrap(
          await stack.backlog.add({
            title: 'Preciso de subtração na calculadora',
            body: 'Hoje só temos soma. Quero poder subtrair também, com teste cobrindo.',
            createdAt: Date.now(),
          }),
        )

        const digest = await stack.deps.contextManager.digest(stack.project)
        const result = unwrap(await stack.planning.planItem(item, digest, NEVER))

        expect(result.created).toHaveLength(1)
        const task = result.created[0]!
        expect(task.kind).toBe('feature')
        expect(task.state).toBe('ready')
        expect(task.touches).toEqual(['src/**', 'test/**'])
        // O harness acrescentou o DiffCheck de escopo mesmo o plano não pedindo.
        expect(task.acceptance.checks.map((check) => check.kind)).toContain('diff')
        expect(task.acceptance.checks.map((check) => check.kind)).toContain('command')

        // A task está de fato na fila, recuperável por um processo novo.
        const fromDb = await stack.state.tasks.find(task.id)
        expect(fromDb?.title).toBe('Adicionar função de subtração')

        const names: string[] = []
        for await (const event of stack.eventStore.read(1)) names.push(event.name)
        expect(names).toContain('PlanCreated')
        expect(names).toContain('TaskCreated')
      } finally {
        await stack.close()
      }
    })
  }, 60_000)

  it('plano inválido é REJEITADO sem tocar o repositório (ADR-002)', async () => {
    await withTempDir(async (dir) => {
      repoComTestes(dir)
      const headAntes = gitIn(dir, 'rev-parse', 'HEAD')
      // As duas tentativas devolvem o mesmo plano ruim.
      const stack = await makeTestStack(dir, [
        { text: JSON.stringify(PLANO_RUIM) },
        { text: JSON.stringify(PLANO_RUIM) },
      ])
      try {
        const item = unwrap(
          await stack.backlog.add({ title: 'Item impossível', body: 'x', createdAt: Date.now() }),
        )
        const result = await stack.planning.planItem(item, undefined, NEVER)

        expect(result.ok).toBe(false)

        // Nenhuma task entrou na fila.
        expect(await stack.state.tasks.all()).toHaveLength(0)

        // O repositório está exatamente como estava: mesmo HEAD, nada sujo,
        // nenhum worktree criado. A rejeição acontece ANTES de qualquer efeito.
        expect(gitIn(dir, 'rev-parse', 'HEAD')).toBe(headAntes)
        expect(gitIn(dir, 'status', '--porcelain')).toBe('')
        expect(await stack.deps.sandbox.list()).toHaveLength(0)

        // O evento registra os problemas concretos para o humano.
        const rejected: string[] = []
        for await (const event of stack.eventStore.read(1)) {
          if (event.name === 'PlanRejected') {
            const payload = event.payload as { rejections: { code: string; message: string }[] }
            rejected.push(...payload.rejections.map((r) => r.code))
          }
        }
        expect(rejected.length).toBeGreaterThan(0)
        expect(rejected).toContain('paths-out-of-scope')
        expect(rejected).toContain('unenforceable-acceptance')
        expect(rejected).toContain('unknown-dependency')
      } finally {
        await stack.close()
      }
    })
  }, 60_000)

  it('Planner corrige na segunda tentativa após rejeição', async () => {
    await withTempDir(async (dir) => {
      repoComTestes(dir)
      const stack = await makeTestStack(dir, [
        { text: JSON.stringify(PLANO_RUIM) }, // 1ª: rejeitada
        { text: JSON.stringify(PLANO_BOM) }, // 2ª: aceita
      ])
      try {
        const item = unwrap(
          await stack.backlog.add({
            title: 'Subtração',
            body: 'quero subtrair',
            createdAt: Date.now(),
          }),
        )
        const result = unwrap(await stack.planning.planItem(item, undefined, NEVER))
        expect(result.created).toHaveLength(1)
        expect(stack.provider.sessions).toHaveLength(2)
      } finally {
        await stack.close()
      }
    })
  }, 60_000)

  it('saída não-estruturada do Planner falha com mensagem clara', async () => {
    await withTempDir(async (dir) => {
      repoComTestes(dir)
      const stack = await makeTestStack(dir, [
        { text: 'Aqui está meu plano: faça o que achar melhor.' },
      ])
      try {
        const item = unwrap(
          await stack.backlog.add({ title: 'X', body: 'y', createdAt: Date.now() }),
        )
        const result = await stack.planning.planItem(item, undefined, NEVER)
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error.message).toContain('estruturada')
      } finally {
        await stack.close()
      }
    })
  }, 60_000)

  it('ciclo completo: backlog → plano → execução → commit', async () => {
    await withTempDir(async (dir) => {
      repoComTestes(dir)
      const stack = await makeTestStack(dir, [
        // 1ª sessão: o Planner devolve o plano.
        { text: JSON.stringify(PLANO_BOM) },
        // 2ª sessão: o Executor implementa de verdade.
        {
          writes: {
            'src/calc.mjs':
              'export const soma = (a, b) => a + b\nexport const subtrai = (a, b) => a - b\n',
            'test/subtrai.test.mjs': [
              "import { test } from 'node:test'",
              "import assert from 'node:assert/strict'",
              "import { subtrai } from '../src/calc.mjs'",
              "test('subtrai', () => { assert.equal(subtrai(3, 1), 2) })",
              '',
            ].join('\n'),
          },
        },
      ])
      try {
        const item = unwrap(
          await stack.backlog.add({
            title: 'Preciso de subtração',
            body: 'Hoje só temos soma.',
            createdAt: Date.now(),
          }),
        )

        const planned = unwrap(await stack.planning.planItem(item, undefined, NEVER))
        expect(planned.created).toHaveLength(1)

        unwrap(await stack.kernel.start({ projectId: stack.project.id }))
        await stack.kernel.wait()

        const task = await stack.state.tasks.find(planned.created[0]!.id)
        expect(task?.state).toBe('done')

        // O commit existe e a suíte do projeto passou de verdade.
        const commits = gitIn(dir, 'log', '--all', '--oneline', '--grep', 'Adicionar função')
        expect(commits.split('\n').filter((line) => line.trim() !== '')).toHaveLength(1)
        expect(gitIn(dir, 'status', '--porcelain')).toBe('')
      } finally {
        await stack.close()
      }
    })
  }, 90_000)

  it('task que falha repetidamente é replanejada e substituída (fecha o ciclo da F2)', async () => {
    await withTempDir(async (dir) => {
      repoComTestes(dir)
      const stack = await makeTestStack(
        dir,
        [
          // Executor: duas tentativas sem escrever nada → no-changes → draft.
          { text: 'Pronto!' },
          { text: 'Agora sim!' },
          // Planner: decompõe a task devolvida.
          { text: JSON.stringify(PLANO_BOM) },
          // Executor da task nova: implementa de verdade.
          {
            writes: {
              'src/calc.mjs':
                'export const soma = (a, b) => a + b\nexport const subtrai = (a, b) => a - b\n',
            },
          },
        ],
        { withReplanner: true },
      )
      try {
        const original = await stack.enqueue({
          title: 'Task que vai falhar',
          touches: ['src/**'],
          acceptance: {
            checks: [
              {
                kind: 'artifact',
                id: 'algo',
                path: 'src/inexistente.mjs',
                mustExist: true,
                timeoutMs: 5_000,
              },
            ],
            requireAll: true,
          },
        })

        unwrap(await stack.kernel.start({ projectId: stack.project.id }))
        await stack.kernel.wait()

        // A original foi abandonada em favor das novas.
        const final = await stack.state.tasks.find(original.id)
        expect(final?.state).toBe('abandoned')

        // Tasks novas nasceram do replanejamento.
        const todas = await stack.state.tasks.all()
        const novas = todas.filter((t) => t.id !== original.id)
        expect(novas.length).toBeGreaterThanOrEqual(1)

        const names: string[] = []
        for await (const event of stack.eventStore.read(1)) names.push(event.name)
        expect(names).toContain('TaskReplanned')
        expect(names).toContain('TaskAbandoned')
        expect(names).toContain('PlanCreated')
      } finally {
        await stack.close()
      }
    })
  }, 90_000)

  it('sem replanejador configurado, draft vira blocked com motivo — nunca limbo', async () => {
    await withTempDir(async (dir) => {
      repoComTestes(dir)
      const stack = await makeTestStack(dir, [{ text: 'nada' }, { text: 'nada de novo' }])
      try {
        const task = await stack.enqueue({
          title: 'Sem planner',
          touches: ['src/**'],
          acceptance: {
            checks: [
              {
                kind: 'artifact',
                id: 'x',
                path: 'src/nunca.mjs',
                mustExist: true,
                timeoutMs: 5_000,
              },
            ],
            requireAll: true,
          },
        })

        unwrap(await stack.kernel.start({ projectId: stack.project.id }))
        await stack.kernel.wait()

        const final = await stack.state.tasks.find(task.id)
        expect(final?.state).toBe('blocked')
        expect(final?.blockReason?.message).toContain('Planner')
      } finally {
        await stack.close()
      }
    })
  }, 90_000)
})
