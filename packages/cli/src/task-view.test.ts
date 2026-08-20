import { describe, expect, it } from 'vitest'
import type { ProjectId, Task, TaskId, ValidationPolicyInput } from '@uranus/core'
import {
  DEFAULT_VALIDATION_POLICY,
  newProjectId,
  newTaskId,
  resolveValidationPolicy,
} from '@uranus/core'
import {
  describeValidationRules,
  explainIllegalTransition,
  formatTaskLine,
  groupTasks,
  renderValidations,
} from './task-view.js'

const PROJECT: ProjectId = newProjectId(1_700_000_000_000)

// Fixture local, como em `pretty.test.ts`: `@uranus/testkit` não é dependência
// do CLI, e este pacote não é lugar para criar uma.
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

describe('groupTasks', () => {
  it('agrupa os onze estados nos quatro grupos, com o que pede decisão primeiro', () => {
    const tasks: Task[] = [
      makeTask({ state: 'done', title: 'concluída' }),
      makeTask({ state: 'ready', title: 'na fila' }),
      makeTask({ state: 'running', title: 'rodando' }),
      makeTask({ state: 'blocked', title: 'travada' }),
      makeTask({ state: 'draft', title: 'rascunho' }),
    ]

    expect(groupTasks(tasks).map((g) => [g.group, g.label, g.tasks.map((t) => t.title)])).toEqual([
      ['attention', 'Precisa de você', ['travada']],
      ['working', 'Em andamento', ['rodando']],
      ['queued', 'Na fila', ['na fila', 'rascunho']],
      ['finished', 'Encerrada', ['concluída']],
    ])
  })

  it('omite grupo vazio e preserva a ordem recebida dentro do grupo', () => {
    const primeira = makeTask({ state: 'failed', title: 'a' })
    const segunda = makeTask({ state: 'blocked', title: 'b' })
    const grupos = groupTasks([primeira, segunda])

    expect(grupos).toHaveLength(1)
    expect(grupos[0]?.tasks.map((t) => t.title)).toEqual(['a', 'b'])
  })

  it('sem tasks não devolve grupo nenhum', () => {
    expect(groupTasks([])).toEqual([])
  })
})

describe('formatTaskLine', () => {
  it('usa o rótulo humano do estado, não o estado cru', () => {
    const linha = formatTaskLine(makeTask({ state: 'verifying' }))
    expect(linha).toContain('Verificando')
    expect(linha).not.toContain('verifying')
  })

  it('mostra reparos só quando existem', () => {
    expect(formatTaskLine(makeTask({ repairAttempts: 0 }))).not.toContain('↻')
    expect(formatTaskLine(makeTask({ attempts: 1, repairAttempts: 2 }))).toContain('1/3 ↻2')
  })

  it('diz de que item de backlog a task veio, e nada quando não veio de nenhum', () => {
    expect(formatTaskLine(makeTask({ backlogItemId: 'trocar-login-abc123' }))).toContain(
      '(item trocar-login-abc123)',
    )
    expect(formatTaskLine(makeTask())).not.toContain('(item ')
  })

  it('marca ascendência e motivo do bloqueio', () => {
    const linha = formatTaskLine(
      makeTask({
        state: 'blocked',
        title: 'corrigir',
        blockReason: { kind: 'human', message: 'esperando o dono', resolvableBy: 'human' },
        lineage: {
          rootTaskId: 'tsk_raiz' as TaskId,
          parentTaskId: 'tsk_pai' as TaskId,
          generation: 1,
        },
      }),
    )
    expect(linha).toContain('(↳ g1 de tsk_pai)')
    expect(linha).toContain('[esperando o dono]')
  })
})

describe('explainIllegalTransition', () => {
  it('lista os destinos reais a partir do estado atual', () => {
    const msg = explainIllegalTransition('ready', 'done')
    expect(msg).toContain('Transição ilegal: ready → done')
    expect(msg).toContain('claimed (Reservada)')
    expect(msg).toContain('blocked (Bloqueada)')
    // `ready → verifying` não existe: prometer o destino errado é pior que recusar.
    expect(msg).not.toContain('verifying')
  })

  it('estado terminal diz que não há saída, em vez de listar vazio', () => {
    expect(explainIllegalTransition('done', 'ready')).toContain('estado terminal')
  })
})

describe('describeValidationRules', () => {
  it('distingue o default do Uranus da severidade declarada pelo projeto', () => {
    const input: ValidationPolicyInput = { rules: { scope: 'advisory' } }
    const views = describeValidationRules(resolveValidationPolicy(input), input)

    expect(views.find((v) => v.rule === 'scope')).toEqual({
      rule: 'scope',
      severity: 'advisory',
      origin: 'config',
    })
    expect(views.find((v) => v.rule === 'tests')).toEqual({
      rule: 'tests',
      severity: 'blocking',
      origin: 'default',
    })
  })

  it('config que repete o default ainda é config — a procedência não é adivinhada', () => {
    const input: ValidationPolicyInput = { rules: { lint: 'blocking' } }
    const views = describeValidationRules(resolveValidationPolicy(input), input)
    expect(views.find((v) => v.rule === 'lint')?.origin).toBe('config')
  })

  it('enabled: false zera a severidade efetiva de tudo e diz de onde vem', () => {
    const input: ValidationPolicyInput = { enabled: false, rules: { scope: 'blocking' } }
    const views = describeValidationRules(resolveValidationPolicy(input), input)
    expect(views.every((v) => v.severity === 'off')).toBe(true)
    expect(views.every((v) => v.origin === 'global-off')).toBe(true)
  })

  it('sem config, toda regra é default e nenhuma some da lista', () => {
    const views = describeValidationRules(DEFAULT_VALIDATION_POLICY)
    expect(views).toHaveLength(10)
    expect(views.every((v) => v.origin === 'default' && v.severity === 'blocking')).toBe(true)
  })
})

describe('renderValidations', () => {
  it('mostra as duas chaves que mudam o tratamento da falha', () => {
    const texto = renderValidations(DEFAULT_VALIDATION_POLICY).join('\n')
    expect(texto).toContain('countTowardAttempts : false')
    expect(texto).toContain('maxRepairAttempts   : 3')
    expect(texto).toContain('Validações: ligadas')
  })

  it('anuncia em alto e bom som quando tudo está desligado', () => {
    const policy = resolveValidationPolicy({ enabled: false })
    expect(renderValidations(policy).join('\n')).toContain('DESLIGADAS')
  })
})
