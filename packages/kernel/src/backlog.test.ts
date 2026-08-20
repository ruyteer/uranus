import { describe, expect, it } from 'vitest'
import type { Task } from '@uranus/core'
import { isTerminal, unwrap } from '@uranus/core'
import { createGitRepo, withTempDir } from '@uranus/testkit'
import type { BacklogPort } from './kernel.js'
import { artifactAcceptance, makeTestStack, type TestStack } from './test-stack.js'

interface FakeItem {
  readonly id: string
  readonly title: string
  /** Um arquivo por task que o plano deste item gera. */
  readonly files: readonly string[]
  /** Plano sempre recusado pelo validador — exercita o teto de recusas. */
  readonly alwaysRejected?: boolean
}

type ItemState = 'open' | 'planned' | 'done'

interface FakeBacklog extends BacklogPort {
  /** Rastro exato das chamadas, na ordem — é a prova de "1 item por vez". */
  readonly calls: string[]
  /** Ligado depois que o stack existe: `plan()` precisa enfileirar tasks. */
  attach(stack: TestStack): void
  stateOf(itemId: string): ItemState
}

/**
 * Fake da porta, no lugar do `FileBacklogStore`.
 *
 * O contrato diz que o filtro de elegibilidade e a decisão de fechamento são da
 * IMPLEMENTAÇÃO — então o fake precisa mesmo tê-los, senão o teste provaria uma
 * divisão de responsabilidade diferente da real.
 */
function fakeBacklog(items: readonly FakeItem[], maxPlanningFailures = 2): FakeBacklog {
  const calls: string[] = []
  const states = new Map<string, ItemState>(items.map((item) => [item.id, 'open']))
  const failures = new Map<string, number>(items.map((item) => [item.id, 0]))
  let stack: TestStack | undefined

  return {
    calls,
    attach(value: TestStack): void {
      stack = value
    },
    stateOf(itemId: string): ItemState {
      return states.get(itemId) ?? 'open'
    },

    nextPlannable(): Promise<{ id: string; title: string } | undefined> {
      const item = items.find(
        (candidate) =>
          states.get(candidate.id) === 'open' &&
          (failures.get(candidate.id) ?? 0) < maxPlanningFailures,
      )
      calls.push(`nextPlannable→${item?.id ?? '(nenhum)'}`)
      return Promise.resolve(item === undefined ? undefined : { id: item.id, title: item.title })
    },

    async plan(itemId: string): Promise<number | undefined> {
      const item = items.find((candidate) => candidate.id === itemId)!
      if (item.alwaysRejected === true) {
        failures.set(itemId, (failures.get(itemId) ?? 0) + 1)
        calls.push(`planRecusado:${itemId}:${String(failures.get(itemId))}`)
        return undefined
      }
      for (const file of item.files) {
        await stack!.enqueue({
          title: `${item.title} — ${file}`,
          backlogItemId: item.id,
          touches: ['src/**'],
          acceptance: artifactAcceptance(file, 'ok'),
        })
      }
      states.set(itemId, 'planned')
      calls.push(`plan:${itemId}:${String(item.files.length)}`)
      return item.files.length
    },

    taskFinished(itemId: string, siblings: readonly Task[]): Promise<void> {
      const done = siblings.filter((task) => task.state === 'done').length
      calls.push(`taskFinished:${itemId}:${String(done)}/${String(siblings.length)}`)
      const complete =
        siblings.length > 0 &&
        siblings.every((task) => isTerminal(task.state)) &&
        siblings.some((task) => task.state === 'done')
      if (complete) states.set(itemId, 'done')
      return Promise.resolve()
    },
  }
}

/** Escreve os dois arquivos do item A em qualquer ordem de execução das tasks. */
const WRITES_A = { 'src/a1.ts': 'ok\n', 'src/a2.ts': 'ok\n' }

describe('backlog autônomo no `uranus start` (categoria ②, §5 e §6)', () => {
  it('item no backlog é planejado sozinho, executa e é fechado pela porta', async () => {
    await withTempDir(async (dir) => {
      createGitRepo({ dir, files: { 'src/index.ts': 'export {}\n' } })
      const backlog = fakeBacklog([
        { id: 'itm_a', title: 'Primeiro item', files: ['src/a1.ts', 'src/a2.ts'] },
      ])
      const stack = await makeTestStack(dir, [{ writes: WRITES_A }, { writes: WRITES_A }], {
        backlogPort: backlog,
      })
      backlog.attach(stack)
      try {
        // Nada na fila: sem o §5 o kernel drenaria no primeiro tick.
        expect((await stack.deps.queue.stats()).total).toBe(0)

        unwrap(await stack.kernel.start({ projectId: stack.project.id }))
        await stack.kernel.wait()

        const tasks = await stack.state.tasks.all()
        expect(tasks).toHaveLength(2)
        // O vínculo sobrevive ao round-trip pelo banco — é o que o kernel usa
        // para achar as irmãs quando a última termina.
        expect(tasks.every((task) => task.backlogItemId === 'itm_a')).toBe(true)
        expect(tasks.every((task) => task.state === 'done')).toBe(true)

        expect(backlog.stateOf('itm_a')).toBe('done')
        expect(backlog.calls).toEqual([
          'nextPlannable→itm_a',
          'plan:itm_a:2',
          'taskFinished:itm_a:1/2',
          'taskFinished:itm_a:2/2',
          'nextPlannable→(nenhum)',
        ])

        const run = await stack.state.runs.latest()
        expect(run?.status).toBe('completed')
      } finally {
        await stack.close()
      }
    })
  }, 90_000)

  it('um item de cada vez: o segundo só é planejado quando as tasks do primeiro saem da fila', async () => {
    await withTempDir(async (dir) => {
      createGitRepo({ dir, files: { 'src/index.ts': 'export {}\n' } })
      const backlog = fakeBacklog([
        { id: 'itm_a', title: 'Primeiro item', files: ['src/a1.ts', 'src/a2.ts'] },
        { id: 'itm_b', title: 'Segundo item', files: ['src/b1.ts'] },
      ])
      const stack = await makeTestStack(
        dir,
        [{ writes: WRITES_A }, { writes: WRITES_A }, { writes: { 'src/b1.ts': 'ok\n' } }],
        { backlogPort: backlog },
      )
      backlog.attach(stack)
      try {
        unwrap(await stack.kernel.start({ projectId: stack.project.id }))
        await stack.kernel.wait()

        // A ordem é a prova: `plan:itm_b` só aparece depois das DUAS tasks do
        // item A terminarem. Nenhuma trava faz isso — é o lugar da chamada.
        expect(backlog.calls).toEqual([
          'nextPlannable→itm_a',
          'plan:itm_a:2',
          'taskFinished:itm_a:1/2',
          'taskFinished:itm_a:2/2',
          'nextPlannable→itm_b',
          'plan:itm_b:1',
          'taskFinished:itm_b:1/1',
          'nextPlannable→(nenhum)',
        ])
        expect(backlog.stateOf('itm_a')).toBe('done')
        expect(backlog.stateOf('itm_b')).toBe('done')
      } finally {
        await stack.close()
      }
    })
  }, 120_000)

  it('plano recusado repetidamente não prende o kernel: o teto de recusas drena o run', async () => {
    await withTempDir(async (dir) => {
      createGitRepo({ dir, files: { 'src/index.ts': 'export {}\n' } })
      const backlog = fakeBacklog(
        [{ id: 'itm_ruim', title: 'Item que o Planner não resolve', files: [], alwaysRejected: true }],
        2,
      )
      const stack = await makeTestStack(dir, [], { backlogPort: backlog })
      backlog.attach(stack)
      try {
        unwrap(await stack.kernel.start({ projectId: stack.project.id }))
        // Se o kernel girasse para sempre sobre o mesmo item, `wait()` nunca
        // resolveria — é exatamente esse o loop que o teto existe pra cortar.
        await stack.kernel.wait()

        expect(backlog.calls).toEqual([
          'nextPlannable→itm_ruim',
          'planRecusado:itm_ruim:1',
          'nextPlannable→itm_ruim',
          'planRecusado:itm_ruim:2',
          'nextPlannable→(nenhum)',
        ])
        expect(await stack.state.tasks.all()).toHaveLength(0)

        const run = await stack.state.runs.latest()
        expect(run?.status).toBe('completed')
        expect(run?.stopReason).toContain('não há mais tasks')
      } finally {
        await stack.close()
      }
    })
  }, 60_000)

  it('autoPlan desligado: o backlog não é sequer consultado', async () => {
    await withTempDir(async (dir) => {
      createGitRepo({ dir, files: { 'src/index.ts': 'export {}\n' } })
      const backlog = fakeBacklog([{ id: 'itm_a', title: 'Item ignorado', files: ['src/a1.ts'] }])
      const stack = await makeTestStack(dir, [], {
        backlogPort: backlog,
        autoPlanBacklog: false,
      })
      backlog.attach(stack)
      try {
        unwrap(await stack.kernel.start({ projectId: stack.project.id }))
        await stack.kernel.wait()

        expect(backlog.calls).toEqual([])
        expect(backlog.stateOf('itm_a')).toBe('open')
        expect(await stack.state.tasks.all()).toHaveLength(0)
      } finally {
        await stack.close()
      }
    })
  }, 60_000)

  it('orçamento do run esgotado não planeja item nenhum (R2)', async () => {
    await withTempDir(async (dir) => {
      createGitRepo({ dir, files: { 'src/index.ts': 'export {}\n' } })
      const backlog = fakeBacklog([{ id: 'itm_a', title: 'Item caro', files: ['src/a1.ts'] }])
      const stack = await makeTestStack(dir, [], { backlogPort: backlog, budgetUsd: 0 })
      backlog.attach(stack)
      try {
        unwrap(await stack.kernel.start({ projectId: stack.project.id }))
        await stack.kernel.wait()

        // Nem `nextPlannable` foi chamado: planejar é sessão de modelo, e sem
        // orçamento a resposta é não antes de qualquer I/O.
        expect(backlog.calls).toEqual([])
        expect(await stack.state.tasks.all()).toHaveLength(0)

        const names: string[] = []
        for await (const event of stack.eventStore.read(1)) names.push(event.name)
        // Silêncio seria pior que a recusa: o humano precisa saber que o
        // backlog ficou parado por dinheiro, não por falta de item.
        expect(names.filter((name) => name === 'BudgetExhausted')).toHaveLength(1)
      } finally {
        await stack.close()
      }
    })
  }, 60_000)
})
