import { describe, expect, it } from 'vitest'
import type { EventPayloads } from '@uranus/core'
import { newProjectId, silentLogger, unwrap } from '@uranus/core'
import type { PlannerOutput } from '@uranus/backlog'
import { FileBacklogStore, createCrossProjectItem, crossProjectBacklogDir } from '@uranus/backlog'
import { createGitRepo, gitIn, withTempDir } from '@uranus/testkit'
import { makeTestStack } from './test-stack.js'
import type { CrossProjectBacklog } from './planning/planning-service.js'

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

/** O mesmo plano bom, mais uma necessidade que pertence ao projeto vizinho. */
const PEDIDO_NO_VIZINHO = {
  project: 'api',
  title: 'Expor GET /health com status das dependências',
  intent:
    'O painel do front precisa de um endpoint que responda 200 com o status do banco e da fila.',
}

const PLANO_COM_VIZINHO: PlannerOutput = { ...PLANO_BOM, crossProject: [PEDIDO_NO_VIZINHO] }

/**
 * Porta cross-project montada como a composição vai montá-la: uma
 * `FileBacklogStore` apontada para o `.uranus/backlog` do vizinho, com a
 * guarda de caminho e a idempotência vindas de `@uranus/backlog`.
 *
 * Fake só no que é fiação (ler a config); o que importa provar — o item nasce
 * lá, uma vez só — acontece em disco de verdade.
 */
function portaDoVizinho(
  vizinhos: readonly { alias: string; description?: string; root: string }[],
): CrossProjectBacklog {
  const stores = new Map<string, FileBacklogStore>()
  for (const vizinho of vizinhos) {
    stores.set(
      vizinho.alias,
      new FileBacklogStore({
        dir: unwrap(crossProjectBacklogDir(vizinho.root)),
        projectId: newProjectId(1),
        logger: silentLogger,
      }),
    )
  }
  return {
    writableProjects: () =>
      vizinhos.map((vizinho) => ({
        alias: vizinho.alias,
        ...(vizinho.description === undefined ? {} : { description: vizinho.description }),
      })),
    create: async (input) => {
      const store = stores.get(input.project)
      if (store === undefined) throw new Error(`vizinho inesperado: ${input.project}`)
      return createCrossProjectItem(store, input, Date.now())
    },
  }
}

describe('PlanningService — trabalho no backlog do vizinho (categoria ④)', () => {
  it('crossProject vira item NO VIZINHO, e nenhuma task extra na fila daqui', async () => {
    await withTempDir(async (dir) => {
      await withTempDir(async (vizinhoDir) => {
        repoComTestes(dir)
        const stack = await makeTestStack(dir, [{ text: JSON.stringify(PLANO_COM_VIZINHO) }], {
          crossProject: portaDoVizinho([
            { alias: 'api', description: 'API REST em Fastify.', root: vizinhoDir },
          ]),
        })
        try {
          const item = unwrap(
            await stack.backlog.add({
              title: 'Painel de saúde no front',
              body: 'Quero ver o status das dependências no painel.',
              createdAt: Date.now(),
            }),
          )
          const result = unwrap(await stack.planning.planItem(item, undefined, NEVER))

          // O pedido do vizinho NÃO virou task daqui — é o ponto do pedido.
          expect(result.created).toHaveLength(1)
          expect(await stack.state.tasks.all()).toHaveLength(1)
          expect(result.created[0]!.title).toBe('Adicionar função de subtração')

          // …e nasceu lá, com a origem escrita no corpo.
          const doVizinho = new FileBacklogStore({
            dir: unwrap(crossProjectBacklogDir(vizinhoDir)),
            projectId: newProjectId(1),
            logger: silentLogger,
          })
          const criados = await doVizinho.list()
          expect(criados).toHaveLength(1)
          expect(criados[0]!.title).toBe(PEDIDO_NO_VIZINHO.title)
          expect(criados[0]!.source).toBe('linked-project')
          expect(criados[0]!.body).toContain(stack.project.name)
          expect(criados[0]!.body).toContain(item.id)

          expect(result.crossProject).toEqual([
            {
              project: 'api',
              itemId: criados[0]!.id,
              title: PEDIDO_NO_VIZINHO.title,
              created: true,
            },
          ])

          const eventos: string[] = []
          for await (const event of stack.eventStore.read(1)) eventos.push(event.name)
          expect(eventos).toContain('CrossProjectItemCreated')
        } finally {
          await stack.close()
        }
      })
    })
  }, 60_000)

  it('planejar o mesmo item duas vezes cria UM item no vizinho', async () => {
    await withTempDir(async (dir) => {
      await withTempDir(async (vizinhoDir) => {
        repoComTestes(dir)
        const stack = await makeTestStack(
          dir,
          [
            { text: JSON.stringify(PLANO_COM_VIZINHO) },
            { text: JSON.stringify(PLANO_COM_VIZINHO) },
          ],
          { crossProject: portaDoVizinho([{ alias: 'api', root: vizinhoDir }]) },
        )
        try {
          const item = unwrap(
            await stack.backlog.add({ title: 'Painel de saúde', body: 'x', createdAt: Date.now() }),
          )
          unwrap(await stack.planning.planItem(item, undefined, NEVER))
          const segundo = unwrap(await stack.planning.planItem(item, undefined, NEVER))

          const doVizinho = new FileBacklogStore({
            dir: unwrap(crossProjectBacklogDir(vizinhoDir)),
            projectId: newProjectId(1),
            logger: silentLogger,
          })
          expect(await doVizinho.list()).toHaveLength(1)
          // A segunda passagem reencontrou o item; nada de "criado" no log.
          expect(segundo.crossProject[0]!.created).toBe(false)

          const criados = []
          for await (const event of stack.eventStore.read(1)) {
            if (event.name === 'CrossProjectItemCreated') criados.push(event)
          }
          expect(criados).toHaveLength(1)
        } finally {
          await stack.close()
        }
      })
    })
  }, 60_000)

  it('alias desconhecido REJEITA o plano — não escreve em lugar nenhum', async () => {
    await withTempDir(async (dir) => {
      await withTempDir(async (vizinhoDir) => {
        repoComTestes(dir)
        const plano: PlannerOutput = {
          ...PLANO_BOM,
          crossProject: [{ ...PEDIDO_NO_VIZINHO, project: 'mobile' }],
        }
        const stack = await makeTestStack(
          dir,
          [{ text: JSON.stringify(plano) }, { text: JSON.stringify(plano) }],
          { crossProject: portaDoVizinho([{ alias: 'api', root: vizinhoDir }]) },
        )
        try {
          const item = unwrap(
            await stack.backlog.add({ title: 'Painel', body: 'x', createdAt: Date.now() }),
          )
          const result = await stack.planning.planItem(item, undefined, NEVER)
          expect(result.ok).toBe(false)

          // Nem task aqui, nem item lá: a rejeição é total.
          expect(await stack.state.tasks.all()).toHaveLength(0)
          const doVizinho = new FileBacklogStore({
            dir: unwrap(crossProjectBacklogDir(vizinhoDir)),
            projectId: newProjectId(1),
            logger: silentLogger,
          })
          expect(await doVizinho.list()).toHaveLength(0)

          const codigos: string[] = []
          for await (const event of stack.eventStore.read(1)) {
            if (event.name !== 'PlanRejected') continue
            const payload = event.payload as EventPayloads['PlanRejected']
            codigos.push(...payload.rejections.map((rejection) => rejection.code))
          }
          expect(codigos).toContain('unknown-cross-project')
        } finally {
          await stack.close()
        }
      })
    })
  }, 60_000)

  it('o prompt lista os vizinhos graváveis, com alias e descrição', async () => {
    await withTempDir(async (dir) => {
      await withTempDir(async (vizinhoDir) => {
        repoComTestes(dir)
        const stack = await makeTestStack(dir, [{ text: JSON.stringify(PLANO_BOM) }], {
          crossProject: portaDoVizinho([
            { alias: 'api', description: 'API REST em Fastify.', root: vizinhoDir },
          ]),
        })
        try {
          const item = unwrap(
            await stack.backlog.add({ title: 'Painel', body: 'x', createdAt: Date.now() }),
          )
          unwrap(await stack.planning.planItem(item, undefined, NEVER))

          const instrucao = stack.provider.sessions[0]!.instruction
          expect(instrucao).toContain('crossProject')
          expect(instrucao).toContain('`api`')
          expect(instrucao).toContain('API REST em Fastify.')
        } finally {
          await stack.close()
        }
      })
    })
  }, 60_000)
})

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
            // `UranusEvent` sem parâmetro é a UNIÃO de todos os payloads, e
            // `event.name` não a estreita. Estreitar para o membro certo da
            // própria união é o cast que o compilador aceita — um tipo
            // estrutural inventado à parte não sobrepõe a união inteira.
            const payload = event.payload as EventPayloads['PlanRejected']
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

  it('sem porta cross-project, o Planner nem fica sabendo que o campo existe', async () => {
    await withTempDir(async (dir) => {
      repoComTestes(dir)
      const stack = await makeTestStack(dir, [
        { text: JSON.stringify(PLANO_COM_VIZINHO) },
        { text: JSON.stringify(PLANO_COM_VIZINHO) },
      ])
      try {
        const item = unwrap(
          await stack.backlog.add({ title: 'Painel de saúde', body: 'x', createdAt: Date.now() }),
        )
        const result = await stack.planning.planItem(item, undefined, NEVER)

        // O bloco de vizinhos não foi oferecido…
        expect(stack.provider.sessions[0]!.instruction).not.toContain('crossProject')
        // …e um plano que usa o campo mesmo assim é recusado, não aceito pela
        // metade: sem vizinho gravável não há para onde mandar o pedido.
        expect(result.ok).toBe(false)
        expect(await stack.state.tasks.all()).toHaveLength(0)
      } finally {
        await stack.close()
      }
    })
  }, 60_000)

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
