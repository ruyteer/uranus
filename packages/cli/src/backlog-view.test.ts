import { describe, expect, it } from 'vitest'
import type { PlanId, ProjectId, Task, TaskState } from '@uranus/core'
import { newProjectId, newTaskId } from '@uranus/core'
import type { StoredBacklogItem } from '@uranus/backlog'
import {
  formatBacklogProgress,
  gaveUpPlanning,
  itemProgress,
  parseLabels,
  parsePriority,
  renderBacklogList,
  renderBacklogShow,
  tasksOfItem,
} from './backlog-view.js'

const PROJECT: ProjectId = newProjectId(1_700_000_000_000)

// Fixture local, como em `task-view.test.ts`: `@uranus/testkit` não é
// dependência do CLI, e este pacote não é lugar para criar uma.
function makeTask(overrides: Partial<Task> = {}): Task {
  const now = overrides.createdAt ?? 1_700_000_000_000
  return {
    id: newTaskId(now),
    projectId: PROJECT,
    kind: 'feature',
    title: 'Tarefa de teste',
    intent: 'i',
    state: 'ready',
    priority: 50,
    deps: [],
    touches: ['src/**'],
    acceptance: { checks: [], requireAll: true },
    attempts: 0,
    maxAttempts: 3,
    repairAttempts: 0,
    labels: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function makeItem(overrides: Partial<StoredBacklogItem> = {}): StoredBacklogItem {
  return {
    id: 'trocar-login-abc123',
    projectId: PROJECT,
    title: 'Trocar o login',
    body: 'O login precisa aceitar e-mail.',
    labels: [],
    priority: 70,
    source: 'manual',
    createdAt: 1_700_000_000_000,
    state: 'open',
    ...overrides,
  }
}

const state = (s: TaskState, item?: string): Task =>
  makeTask({ state: s, ...(item === undefined ? {} : { backlogItemId: item }) })

describe('tasksOfItem', () => {
  it('casa pelo id do item, ignorando task de outro item e task avulsa', () => {
    const item = makeItem()
    const minha = state('ready', item.id)
    const alheia = state('ready', 'outro-item')
    const avulsa = state('ready')

    expect(tasksOfItem([minha, alheia, avulsa], item)).toEqual([minha])
  })

  it('cai no planId para tasks materializadas antes de backlogItemId existir', () => {
    const item = makeItem({ planId: 'pln_1' })
    const antiga = makeTask({ planId: 'pln_1' as PlanId })
    const deOutroPlano = makeTask({ planId: 'pln_2' as PlanId })

    expect(tasksOfItem([antiga, deOutroPlano], item)).toEqual([antiga])
  })

  it('o vínculo explícito vence o plano: task de outro item não entra pelo planId', () => {
    const item = makeItem({ planId: 'pln_1' })
    const replanejada = makeTask({ planId: 'pln_1' as PlanId, backlogItemId: 'outro-item' })

    expect(tasksOfItem([replanejada], item)).toEqual([])
  })
})

describe('formatBacklogProgress', () => {
  it('conta as bloqueadas e as que estão andando', () => {
    const item = makeItem()
    const progresso = itemProgress(
      [
        state('done', item.id),
        state('done', item.id),
        state('blocked', item.id),
        state('running', item.id),
        state('ready', item.id),
      ],
      item,
    )

    expect(formatBacklogProgress(progresso)).toBe('2/5 · 1 bloqueada · 1 rodando')
  })

  it('task falha volta para a fila, não conta como bloqueada', () => {
    const item = makeItem()
    const progresso = itemProgress([state('failed', item.id), state('done', item.id)], item)
    expect(formatBacklogProgress(progresso)).toBe('1/2 subtasks')
  })

  it('sem subtask nenhuma mostra travessão, não "0/0"', () => {
    expect(formatBacklogProgress(itemProgress([], makeItem()))).toBe('—')
  })

  it('anuncia o fim quando tudo terminou', () => {
    const item = makeItem()
    const progresso = itemProgress([state('done', item.id), state('abandoned', item.id)], item)
    expect(formatBacklogProgress(progresso)).toBe('1/2 · tudo pronto')
  })
})

describe('gaveUpPlanning', () => {
  it('desistiu ao bater o teto de recusas', () => {
    expect(gaveUpPlanning(makeItem({ planningFailures: 2 }), 2)).toBe(true)
    expect(gaveUpPlanning(makeItem({ planningFailures: 1 }), 2)).toBe(false)
    expect(gaveUpPlanning(makeItem(), 2)).toBe(false)
  })

  it('item já planejado carrega o contador como histórico, não como alarme', () => {
    expect(gaveUpPlanning(makeItem({ state: 'planned', planningFailures: 5 }), 2)).toBe(false)
  })
})

describe('renderBacklogList', () => {
  it('mostra estado em português, prioridade e progresso por item', () => {
    const item = makeItem({ state: 'planned', planId: 'pln_1' })
    const texto = renderBacklogList(
      [item],
      [state('done', item.id), state('blocked', item.id)],
      2,
    ).join('\n')

    expect(texto).toContain('trocar-login-abc123')
    expect(texto).toContain('Planejado')
    expect(texto).toContain('p 70')
    expect(texto).toContain('1/2 · 1 bloqueada')
    expect(texto).toContain('Trocar o login')
  })

  it('destaca o item com recusas de planejamento e aponta o comando que explica', () => {
    const item = makeItem({ planningFailures: 2 })
    const texto = renderBacklogList([item], [], 2).join('\n')

    expect(texto).toContain('2 recusas de plano registradas')
    expect(texto).toContain('uranus backlog show trocar-login-abc123')
    expect(texto).toContain('1 item(ns) carregam recusas de planejamento')
  })

  it('backlog saudável não ganha aviso nenhum', () => {
    const texto = renderBacklogList([makeItem()], [], 2).join('\n')
    expect(texto).not.toContain('recusa')
  })
})

describe('renderBacklogShow', () => {
  it('traz corpo, plano e as subtasks com rótulo humano de estado', () => {
    const item = makeItem({ state: 'planned', planId: 'pln_1', startedAt: 1_700_000_100_000 })
    const subtask = makeTask({ state: 'verifying', title: 'Ajustar o formulário' })
    const texto = renderBacklogShow(
      item,
      [{ ...subtask, backlogItemId: item.id }],
      2,
    ).join('\n')

    expect(texto).toContain('# Trocar o login')
    expect(texto).toContain('O login precisa aceitar e-mail.')
    expect(texto).toContain('plano      : pln_1')
    expect(texto).toContain('Verificando')
    expect(texto).toContain('Ajustar o formulário')
    // O estado cru só aparece se o rótulo humano falhar.
    expect(texto).not.toContain('verifying')
  })

  it('lista as recusas do validador e explica a desistência', () => {
    const item = makeItem({
      planningFailures: 2,
      lastRejections: ['escopo amplo demais', 'aceite não verificável'],
    })
    const texto = renderBacklogShow(item, [], 2).join('\n')

    expect(texto).toContain('O validador recusou o último plano por:')
    expect(texto).toContain('• escopo amplo demais')
    expect(texto).toContain('backlog.maxPlanningFailures: 2')
  })

  it('distingue "ainda não planejado" de "o plano não gerou task"', () => {
    expect(renderBacklogShow(makeItem(), [], 2).join('\n')).toContain('ainda não foi planejado')
    expect(
      renderBacklogShow(makeItem({ state: 'planned', planId: 'pln_1' }), [], 2).join('\n'),
    ).toContain('não materializou nada')
  })
})

describe('parsePriority', () => {
  it('vazio e lixo mantêm o default em vez de derrubar o diálogo', () => {
    expect(parsePriority('', 50)).toBe(50)
    expect(parsePriority('   ', 50)).toBe(50)
    expect(parsePriority('abc', 50)).toBe(50)
  })

  it('grampeia na faixa 0-100', () => {
    expect(parsePriority('70', 50)).toBe(70)
    expect(parsePriority('-5', 50)).toBe(0)
    expect(parsePriority('999', 50)).toBe(100)
  })
})

describe('parseLabels', () => {
  it('separa por vírgula, apara espaços e descarta o vazio', () => {
    expect(parseLabels(' ui , , backend ')).toEqual(['ui', 'backend'])
    expect(parseLabels('')).toEqual([])
  })
})
