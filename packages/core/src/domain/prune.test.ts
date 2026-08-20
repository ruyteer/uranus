import { describe, expect, it } from 'vitest'
import type { Task, TaskState } from './task.js'
import type { TaskId } from '../ids.js'
import { DEFAULT_PRUNE_POLICY, orphanedBy, planPrune, summarizePrune } from './prune.js'

const AGORA = 1_800_000_000_000
const DIA = 24 * 60 * 60 * 1_000

let seq = 0

function task(overrides: Partial<Task> = {}): Task {
  seq += 1
  const criada = overrides.createdAt ?? AGORA - 30 * DIA
  return {
    id: `tsk_${String(seq).padStart(4, '0')}` as TaskId,
    projectId: 'prj_teste' as Task['projectId'],
    kind: 'feature',
    title: `Task ${String(seq)}`,
    intent: 'Fazer algo.',
    state: 'done',
    priority: 50,
    deps: [],
    touches: ['src/**'],
    acceptance: { checks: [{ kind: 'command', id: 'c', run: 'exit 0', timeoutMs: 1_000 }], requireAll: true },
    attempts: 1,
    maxAttempts: 3,
    repairAttempts: 0,
    labels: [],
    createdAt: criada,
    updatedAt: overrides.updatedAt ?? criada,
    ...overrides,
  }
}

function policy(overrides: Partial<Parameters<typeof planPrune>[1]> = {}) {
  return { ...DEFAULT_PRUNE_POLICY, now: AGORA, ...overrides }
}

describe('planPrune', () => {
  it('remove task concluída e antiga', () => {
    const antiga = task({ state: 'done', updatedAt: AGORA - 30 * DIA })
    const plano = planPrune([antiga], policy())
    expect(plano.remove.map((t) => t.id)).toEqual([antiga.id])
    expect(plano.keep).toEqual([])
  })

  it('preserva task concluída recentemente', () => {
    const recente = task({ state: 'done', updatedAt: AGORA - DIA })
    const plano = planPrune([recente], policy())
    expect(plano.remove).toEqual([])
    expect(plano.keep.map((k) => k.reason)).toEqual(['recente'])
  })

  it('nunca remove trabalho em voo, nem se for pedido explicitamente', () => {
    // O operador pediu `running` na linha de comando. A recusa é absoluta:
    // a task detém um lease e pode ter um worker escrevendo agora.
    const emVoo = task({ state: 'running', updatedAt: AGORA - 90 * DIA })
    const plano = planPrune([emVoo], policy({ states: ['running', 'done'] as TaskState[] }))
    expect(plano.remove).toEqual([])
    expect(plano.keep.map((k) => k.reason)).toEqual(['ativa'])
  })

  it('nunca remove trabalho pendente, nem se for pedido explicitamente', () => {
    const naFila = task({ state: 'ready', updatedAt: AGORA - 90 * DIA })
    const plano = planPrune([naFila], policy({ states: ['ready'] as TaskState[] }))
    expect(plano.remove).toEqual([])
    expect(plano.keep.map((k) => k.reason)).toEqual(['pendente'])
  })

  it('permite podar `failed`/`blocked` quando explicitamente pedido', () => {
    // Parecem lixo e não são — por isso ficam fora do default. Mas quem pede,
    // sabe: são estados que o kernel não escolhe sozinho.
    const falha = task({ state: 'failed', updatedAt: AGORA - 30 * DIA })
    expect(planPrune([falha], policy()).remove).toEqual([])
    expect(
      planPrune([falha], policy({ states: ['done', 'failed'] as TaskState[] })).remove,
    ).toHaveLength(1)
  })

  it('preserva task de que outra ainda depende', () => {
    // O modo de falha que isto evita: `dependenciesSatisfied` exige
    // `stateOf(dep) === 'done'`; uma dep apagada devolve `undefined` e a
    // dependente nunca mais é elegível — sem erro, sem log.
    const base = task({ state: 'done', updatedAt: AGORA - 30 * DIA })
    const dependente = task({ state: 'ready', deps: [base.id] })
    const plano = planPrune([base, dependente], policy())
    expect(plano.remove).toEqual([])
    const protegida = plano.keep.find((k) => k.task.id === base.id)
    expect(protegida?.reason).toBe('dependencia')
    expect(protegida?.requiredBy).toBe(dependente.id)
  })

  it('protege a cadeia inteira, não só o primeiro elo', () => {
    // viva → meio → base. Uma passada só protegeria `meio`; `base` escaparia
    // porque na hora de olhar para ela `meio` ainda parecia estar saindo.
    const base = task({ state: 'done', updatedAt: AGORA - 30 * DIA })
    const meio = task({ state: 'done', updatedAt: AGORA - 30 * DIA, deps: [base.id] })
    const viva = task({ state: 'ready', deps: [meio.id] })
    const plano = planPrune([base, meio, viva], policy())
    expect(plano.remove).toEqual([])
    expect(plano.keep.filter((k) => k.reason === 'dependencia').map((k) => k.task.id).sort()).toEqual(
      [base.id, meio.id].sort(),
    )
  })

  it('mas remove a dupla quando as duas saem juntas', () => {
    // Ninguém que fica depende delas, então a dependência interna não protege.
    const base = task({ state: 'done', updatedAt: AGORA - 30 * DIA })
    const dependente = task({ state: 'done', updatedAt: AGORA - 30 * DIA, deps: [base.id] })
    const plano = planPrune([base, dependente], policy())
    expect(plano.remove.map((t) => t.id).sort()).toEqual([base.id, dependente.id].sort())
  })

  it('dependência já ausente do estado não impede a poda', () => {
    // Poda anterior levou a dep. Isto não é motivo para preservar quem ficou.
    const orfa = task({ state: 'done', updatedAt: AGORA - 30 * DIA, deps: ['tsk_sumida' as TaskId] })
    expect(planPrune([orfa], policy()).remove).toHaveLength(1)
  })

  it('`olderThanMs: 0` poda tudo que está nos estados pedidos', () => {
    const agorinha = task({ state: 'done', updatedAt: AGORA })
    expect(planPrune([agorinha], policy({ olderThanMs: 0 })).remove).toHaveLength(1)
  })

  it('é pura: mesma entrada, mesmo plano', () => {
    const tasks = [
      task({ state: 'done', updatedAt: AGORA - 30 * DIA }),
      task({ state: 'ready' }),
    ]
    expect(planPrune(tasks, policy())).toEqual(planPrune(tasks, policy()))
  })

  it('não perde nenhuma task: tudo sai classificado', () => {
    const tasks = [
      task({ state: 'done', updatedAt: AGORA - 30 * DIA }),
      task({ state: 'done', updatedAt: AGORA }),
      task({ state: 'ready' }),
      task({ state: 'running' }),
      task({ state: 'blocked', updatedAt: AGORA - 30 * DIA }),
    ]
    const plano = planPrune(tasks, policy())
    expect(plano.remove.length + plano.keep.length).toBe(tasks.length)
  })
})

describe('summarizePrune', () => {
  it('conta por estado e por tipo', () => {
    const resumo = summarizePrune([
      task({ state: 'done', kind: 'bugfix' }),
      task({ state: 'done', kind: 'bugfix' }),
      task({ state: 'abandoned', kind: 'docs' }),
    ])
    expect(resumo.byState).toEqual({ done: 2, abandoned: 1 })
    expect(resumo.byKind).toEqual({ bugfix: 2, docs: 1 })
  })
})

describe('orphanedBy', () => {
  it('aponta quem fica preso quando a dependência sai', () => {
    const base = task({ state: 'ready' })
    const dependente = task({ state: 'ready', deps: [base.id] })
    const orfas = orphanedBy([base, dependente], new Set([base.id]))
    expect(orfas).toEqual([{ task: dependente, missingDep: base.id }])
  })

  it('ignora quem também está saindo', () => {
    const base = task({ state: 'ready' })
    const dependente = task({ state: 'ready', deps: [base.id] })
    expect(orphanedBy([base, dependente], new Set([base.id, dependente.id]))).toEqual([])
  })

  it('ignora quem já terminou: não espera mais por nada', () => {
    const base = task({ state: 'ready' })
    const pronta = task({ state: 'done', deps: [base.id] })
    const largada = task({ state: 'abandoned', deps: [base.id] })
    expect(orphanedBy([base, pronta, largada], new Set([base.id]))).toEqual([])
  })

  it('reporta `blocked`, que ainda pode voltar para a fila', () => {
    const base = task({ state: 'ready' })
    const travada = task({ state: 'blocked', deps: [base.id] })
    expect(orphanedBy([base, travada], new Set([base.id]))).toHaveLength(1)
  })

  it('sem ninguém saindo, ninguém fica órfão', () => {
    const base = task({ state: 'ready' })
    const dependente = task({ state: 'ready', deps: [base.id] })
    expect(orphanedBy([base, dependente], new Set())).toEqual([])
  })
})
