import { describe, expect, it } from 'vitest'
import type { Lease, SchedulingContext, Task, TaskQueue, TaskKind } from '@uranus/core'
import { silentLogger, usd } from '@uranus/core'
import { makeTask } from '@uranus/testkit'
import { WeightedScheduler, formatExplanation } from './scheduler.js'
import { buildScheduler } from './build.js'
import {
  DEFAULT_WEIGHTS,
  blockerFirstPolicy,
  bugPriorityPolicy,
  fileLeasePolicy,
  mixQuotaPolicy,
  starvationGuardPolicy,
} from './policies.js'

const NOW = 1_700_000_000_000
const NEVER = new AbortController().signal

function fakeQueue(tasks: readonly Task[]): TaskQueue {
  return {
    enqueue: () => Promise.resolve({ ok: true, value: undefined }),
    update: () => Promise.resolve({ ok: true, value: undefined }),
    get: () => Promise.resolve(undefined),
    claim: () => Promise.reject(new Error('n/a')),
    renew: () => Promise.reject(new Error('n/a')),
    release: () => Promise.resolve({ ok: true, value: undefined }),
    eligible: () => Promise.resolve(tasks),
    activeLeases: () => Promise.resolve([]),
    reapExpired: () => Promise.resolve([]),
    stats: () => Promise.reject(new Error('n/a')),
    deadLetter: () => Promise.resolve([]),
  } as unknown as TaskQueue
}

function context(overrides: Partial<SchedulingContext> = {}): SchedulingContext {
  return {
    now: NOW,
    stats: {
      total: 0,
      byState: {
        draft: 0,
        ready: 0,
        claimed: 0,
        running: 0,
        verifying: 0,
        verified: 0,
        failed: 0,
        integrating: 0,
        blocked: 0,
        done: 0,
        abandoned: 0,
      },
      byKind: {} as Record<TaskKind, number>,
      deadLettered: 0,
    },
    budget: {
      run: {
        limits: { cost: usd(10), tokens: 1_000_000, wallclockMs: 3_600_000 },
        usedCost: usd(0),
        usedTokens: 0,
        usedWallclockMs: 0,
      },
      task: {
        limits: { cost: usd(2), tokens: 400_000, wallclockMs: 900_000 },
        usedCost: usd(0),
        usedTokens: 0,
        usedWallclockMs: 0,
      },
      onExhausted: 'pause',
    },
    activeLeases: [],
    recentOutcomes: [],
    mix: {},
    observedMix: {},
    providerHealth: {},
    restrictedMode: false,
    ...overrides,
  }
}

function build(
  tasks: readonly Task[],
  overrides: Partial<Parameters<typeof buildScheduler>[0]> = {},
) {
  return buildScheduler({
    queue: fakeQueue(tasks),
    logger: silentLogger,
    taskState: () => tasks,
    lastCompletedTouches: () => [],
    ...overrides,
  })
}

describe('políticas individuais', () => {
  it('blocker vai para o topo', () => {
    expect(blockerFirstPolicy.score(makeTask({ labels: ['blocker'] }), context())).toBe(10)
    expect(blockerFirstPolicy.score(makeTask(), context())).toBe(0)
  })

  it('bug e segurança acima de feature; bug antigo pesa mais', () => {
    const novo = bugPriorityPolicy.score(makeTask({ kind: 'bugfix', createdAt: NOW }), context())!
    const antigo = bugPriorityPolicy.score(
      makeTask({ kind: 'bugfix', createdAt: NOW - 10 * 86_400_000 }),
      context(),
    )!
    const feature = bugPriorityPolicy.score(makeTask({ kind: 'feature' }), context())!
    expect(novo).toBeGreaterThan(feature)
    expect(antigo).toBeGreaterThan(novo)
    expect(bugPriorityPolicy.score(makeTask({ kind: 'security' }), context())!).toBeGreaterThan(
      feature,
    )
  })

  it('lease conflitante veta (R6)', () => {
    const lease: Lease = {
      taskId: 'tsk_outro' as Lease['taskId'],
      owner: 'k',
      acquiredAt: NOW,
      expiresAt: NOW + 60_000,
      paths: ['src/api/**'],
    }
    expect(
      fileLeasePolicy.score(makeTask({ touches: ['src/**'] }), context({ activeLeases: [lease] })),
    ).toBeNull()
    expect(
      fileLeasePolicy.score(makeTask({ touches: ['docs/**'] }), context({ activeLeases: [lease] })),
    ).toBe(0)
  })

  it('anti-inanição cresce com a idade', () => {
    const guard = starvationGuardPolicy(3 * 86_400_000)
    const nova = guard.score(makeTask({ createdAt: NOW }), context())!
    const velha = guard.score(makeTask({ createdAt: NOW - 3 * 86_400_000 }), context())!
    expect(nova).toBe(0)
    expect(velha).toBe(10)
  })

  it('o peso da anti-inanição supera o de tipo — senão a inanição é real', () => {
    // Invariante documentado em `starvationGuardPolicy`. Se alguém baixar este
    // peso, tasks de docs/refactor param de executar em backlogs ativos.
    expect(DEFAULT_WEIGHTS['starvation-guard']!).toBeGreaterThan(DEFAULT_WEIGHTS['bug-priority']!)
  })

  it('cota premia o tipo sub-representado', () => {
    const ctx = context({
      mix: { docs: 0.2, feature: 0.5 },
      observedMix: { docs: 0.0, feature: 0.9 },
    })
    const docs = mixQuotaPolicy.score(makeTask({ kind: 'docs' }), ctx)!
    const feature = mixQuotaPolicy.score(makeTask({ kind: 'feature' }), ctx)!
    expect(docs).toBeGreaterThan(feature)
  })
})

describe('WeightedScheduler', () => {
  it('veto é incompensável por qualquer soma', async () => {
    // Task com TUDO a favor, mas com lease conflitante.
    const blocked = makeTask({
      labels: ['blocker'],
      kind: 'security',
      priority: 100,
      touches: ['src/**'],
      createdAt: NOW - 30 * 86_400_000,
    })
    const humble = makeTask({ kind: 'chore', priority: 1, touches: ['docs/**'] })
    const lease: Lease = {
      taskId: 'tsk_outro' as Lease['taskId'],
      owner: 'k',
      acquiredAt: NOW,
      expiresAt: NOW + 60_000,
      paths: ['src/**'],
    }

    const scheduler = build([blocked, humble])
    const chosen = await scheduler.next(context({ activeLeases: [lease] }), NEVER)
    expect(chosen?.id).toBe(humble.id)

    const explanation = scheduler.explain(blocked, context({ activeLeases: [lease] }))
    expect(explanation.eligible).toBe(false)
    expect(explanation.vetoedBy).toContain('file-lease')
  })

  it('escolhe a de maior score entre elegíveis', async () => {
    const bug = makeTask({ kind: 'bugfix', title: 'bug', touches: ['src/a/**'] })
    const doc = makeTask({ kind: 'docs', title: 'doc', touches: ['docs/**'] })
    const chosen = await build([doc, bug]).next(context(), NEVER)
    expect(chosen?.title).toBe('bug')
  })

  it('desempate é estável por id (reprodutibilidade)', async () => {
    const a = makeTask({ kind: 'chore', touches: ['src/a/**'], createdAt: NOW })
    const b = makeTask({ kind: 'chore', touches: ['src/b/**'], createdAt: NOW })
    const expected = a.id < b.id ? a.id : b.id

    for (let run = 0; run < 5; run++) {
      const chosen = await build([a, b]).next(context(), NEVER)
      expect(chosen?.id).toBe(expected)
    }
  })

  it('dependência não satisfeita veta', async () => {
    const dep = makeTask({ title: 'dep', state: 'ready', touches: ['src/dep/**'] })
    const dependent = makeTask({ title: 'dependente', deps: [dep.id], touches: ['src/x/**'] })
    const scheduler = build([dep, dependent])

    expect((await scheduler.next(context(), NEVER))?.title).toBe('dep')
    expect(scheduler.explain(dependent, context()).vetoedBy).toContain('dependency-ready')

    // Dependência concluída: o dependente destrava.
    const done = { ...dep, state: 'done' as const }
    const after = build([done, dependent])
    expect(after.explain(dependent, context()).eligible).toBe(true)
  })

  it('cooldown pós-falha é veto temporal, não permanente (R3)', () => {
    const task = makeTask()
    const scheduler = build([task], { failureCooldownMs: 60_000 })
    const recent = context({
      recentOutcomes: [{ taskId: task.id, status: 'failed', at: NOW - 10_000 }],
    })
    expect(scheduler.explain(task, recent).vetoedBy).toContain('failure-cooldown')

    const later = context({
      now: NOW + 120_000,
      recentOutcomes: [{ taskId: task.id, status: 'failed', at: NOW - 10_000 }],
    })
    expect(scheduler.explain(task, later).eligible).toBe(true)
  })

  it('orçamento esgotado veta tudo', () => {
    const exhausted = context()
    const drained = {
      ...exhausted,
      budget: {
        ...exhausted.budget,
        run: { ...exhausted.budget.run, usedCost: usd(10) },
      },
    }
    expect(build([makeTask()]).explain(makeTask(), drained).vetoedBy).toContain('budget-aware')
  })

  it('modo restrito veta tudo que não constrói o sinal (R4)', () => {
    const scheduler = build([makeTask()])
    const restricted = context({ restrictedMode: true })
    expect(scheduler.explain(makeTask({ kind: 'feature' }), restricted).vetoedBy).toContain(
      'restricted-mode',
    )
    expect(scheduler.explain(makeTask({ kind: 'test' }), restricted).eligible).toBe(true)
  })

  it('caminho crítico prioriza quem destrava mais trabalho', () => {
    const gargalo = makeTask({ title: 'gargalo', touches: ['src/core/**'] })
    const dependentes = [1, 2, 3].map((n) =>
      makeTask({ title: `d${String(n)}`, deps: [gargalo.id], touches: [`src/d${String(n)}/**`] }),
    )
    const scheduler = build([gargalo, ...dependentes])
    const explanation = scheduler.explain(gargalo, context())
    const critical = explanation.contributions.find((c) => c.policyId === 'critical-path')
    expect(critical?.raw).toBeGreaterThan(0)
  })

  it('política com bug é tratada como neutra, não derruba o ciclo', () => {
    const scheduler = new WeightedScheduler({ queue: fakeQueue([]), logger: silentLogger })
    scheduler.addPolicy(
      {
        id: 'quebrada',
        score() {
          throw new Error('boom')
        },
      },
      5,
    )
    const explanation = scheduler.explain(makeTask(), context())
    expect(explanation.eligible).toBe(true)
    expect(explanation.contributions.find((c) => c.policyId === 'quebrada')?.raw).toBe(0)
  })

  it('peso 0 desliga a política', () => {
    const scheduler = build([makeTask()], { weights: { 'blocker-first': 0 } })
    const explanation = scheduler.explain(makeTask({ labels: ['blocker'] }), context())
    expect(explanation.contributions.some((c) => c.policyId === 'blocker-first')).toBe(false)
  })

  it('explain é auditável: mostra cada contribuição', () => {
    const scheduler = build([makeTask()])
    const explanation = scheduler.explain(makeTask({ kind: 'bugfix' }), context())
    expect(explanation.contributions.length).toBeGreaterThan(5)
    for (const contribution of explanation.contributions) {
      expect(contribution.policyId).toBeTruthy()
      expect(typeof contribution.weight).toBe('number')
    }
    const formatted = formatExplanation(explanation, 'Task de teste')
    expect(formatted).toContain('score')
    expect(formatted).toContain('bug-priority')
  })

  it('rank ordena elegíveis à frente de vetadas', async () => {
    const bug = makeTask({ kind: 'bugfix', touches: ['src/a/**'] })
    const doc = makeTask({ kind: 'docs', touches: ['docs/**'] })
    const ranked = await build([doc, bug]).rank(context())
    expect(ranked[0]!.task.id).toBe(bug.id)
    expect(ranked.every((entry) => entry.explanation.eligible)).toBe(true)
  })

  it('sem tasks elegíveis devolve null', async () => {
    expect(await build([]).next(context(), NEVER)).toBeNull()
  })
})

describe('cotas de mix ao longo do tempo', () => {
  it('a distribuição executada converge para a configurada (±10%)', async () => {
    // 40 tasks disponíveis de 4 tipos, todas elegíveis e de mesma idade.
    const kinds: TaskKind[] = ['feature', 'bugfix', 'refactor', 'docs']
    const pool: Task[] = []
    for (let index = 0; index < 40; index++) {
      const kind = kinds[index % kinds.length]!
      pool.push(makeTask({ kind, touches: [`src/m${String(index)}/**`], createdAt: NOW }))
    }

    const mix = { feature: 0.5, bugfix: 0.25, refactor: 0.15, docs: 0.1 }
    const executed: TaskKind[] = []
    const remaining = new Map(pool.map((task) => [task.id, task]))

    for (let step = 0; step < 20; step++) {
      const available = [...remaining.values()]
      const observed: Partial<Record<TaskKind, number>> = {}
      for (const kind of kinds) {
        observed[kind] =
          executed.length === 0
            ? 0
            : executed.filter((executedKind) => executedKind === kind).length / executed.length
      }

      const scheduler = build(available, {
        // Pesos que privilegiam a cota: o teste mede a cota, não o tipo.
        weights: { 'mix-quota': 10, 'bug-priority': 1, 'starvation-guard': 0 },
      })
      const chosen = await scheduler.next(context({ mix, observedMix: observed }), NEVER)
      if (chosen === null) break
      executed.push(chosen.kind)
      remaining.delete(chosen.id)
    }

    expect(executed).toHaveLength(20)
    for (const kind of kinds) {
      const share =
        executed.filter((executedKind) => executedKind === kind).length / executed.length
      expect(Math.abs(share - mix[kind as keyof typeof mix])).toBeLessThanOrEqual(0.1)
    }
  })

  it('nenhuma task fica sem executar indefinidamente (anti-inanição)', async () => {
    // Um doc velho contra um fluxo constante de bugs novos.
    const velhoDoc = makeTask({
      kind: 'docs',
      title: 'doc esquecido',
      touches: ['docs/**'],
      createdAt: NOW - 10 * 86_400_000,
    })
    const bugsNovos = [1, 2, 3].map((n) =>
      makeTask({ kind: 'bugfix', touches: [`src/b${String(n)}/**`], createdAt: NOW }),
    )

    const scheduler = build([velhoDoc, ...bugsNovos])
    const ranked = await scheduler.rank(context())
    // O doc de 10 dias supera os bugs recém-criados.
    expect(ranked[0]!.task.title).toBe('doc esquecido')
  })
})
