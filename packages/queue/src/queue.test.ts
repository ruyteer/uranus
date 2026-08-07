import { describe, expect, it } from 'vitest'
import type { SchedulingContext } from '@uranus/core'
import { unwrap } from '@uranus/core'
import { openState } from '@uranus/state'
import { makeTask, passingCheck } from '@uranus/testkit'
import { SqlTaskQueue } from './sql-task-queue.js'

const NOW = 1_700_000_000_000

function setup(): { queue: SqlTaskQueue; state: ReturnType<typeof openState> } {
  const state = openState({ path: ':memory:', now: NOW })
  return { queue: new SqlTaskQueue(state), state }
}

function context(queueStats: Partial<SchedulingContext> = {}): SchedulingContext {
  return {
    now: NOW,
    stats: {
      total: 0,
      byState: {} as SchedulingContext['stats']['byState'],
      byKind: {} as SchedulingContext['stats']['byKind'],
      deadLettered: 0,
    },
    budget: {} as SchedulingContext['budget'],
    activeLeases: [],
    recentOutcomes: [],
    mix: {},
    observedMix: {},
    providerHealth: {},
    restrictedMode: false,
    ...queueStats,
  }
}

describe('SqlTaskQueue', () => {
  it('rejeita task sem contrato executável na porta (INV-2)', async () => {
    const { queue } = setup()
    const invalid = makeTask({ acceptance: { checks: [], requireAll: true } })
    const result = await queue.enqueue(invalid)
    expect(result.ok).toBe(false)

    const advisoryOnly = makeTask({
      acceptance: { checks: [{ ...passingCheck(), advisory: true }], requireAll: true },
    })
    expect((await queue.enqueue(advisoryOnly)).ok).toBe(false)

    const valid = makeTask()
    expect((await queue.enqueue(valid)).ok).toBe(true)
  })

  it('claim → lease + estado claimed; segundo claim falha', async () => {
    const { queue } = setup()
    const task = makeTask()
    unwrap(await queue.enqueue(task))

    const lease = unwrap(await queue.claim(task.id, 'k1', 60_000, NOW))
    expect(lease.paths).toEqual(task.touches)
    expect((await queue.get(task.id))?.state).toBe('claimed')

    expect((await queue.claim(task.id, 'k2', 60_000, NOW)).ok).toBe(false)
  })

  it('release devolve a task ao estado pedido e solta o lease', async () => {
    const { queue } = setup()
    const task = makeTask()
    unwrap(await queue.enqueue(task))
    const lease = unwrap(await queue.claim(task.id, 'k1', 60_000, NOW))

    unwrap(await queue.release(lease, 'ready', NOW + 1))
    expect((await queue.get(task.id))?.state).toBe('ready')
    expect(await queue.activeLeases(NOW + 1)).toHaveLength(0)
  })

  it('eligible respeita dependências', async () => {
    const { queue } = setup()
    const dep = makeTask({ title: 'dependência' })
    const dependent = makeTask({ title: 'dependente', deps: [dep.id], touches: ['docs/**'] })
    unwrap(await queue.enqueue(dep))
    unwrap(await queue.enqueue(dependent))

    const before = await queue.eligible(context())
    expect(before.map((t) => t.title)).toEqual(['dependência'])

    // Dependência concluída ⇒ dependente elegível.
    unwrap(await queue.update({ ...dep, state: 'done' }))
    const after = await queue.eligible(context())
    expect(after.map((t) => t.title)).toEqual(['dependente'])
  })

  it('eligible exclui conflito de paths com lease ativo (R6)', async () => {
    const { queue } = setup()
    const holder = makeTask({ touches: ['src/api/**'] })
    const overlapping = makeTask({ touches: ['src/**'] })
    const disjoint = makeTask({ touches: ['docs/**'] })
    unwrap(await queue.enqueue(holder))
    unwrap(await queue.enqueue(overlapping))
    unwrap(await queue.enqueue(disjoint))
    unwrap(await queue.claim(holder.id, 'k1', 60_000, NOW))

    const eligible = await queue.eligible(context({ activeLeases: await queue.activeLeases(NOW) }))
    expect(eligible.map((t) => t.id)).toEqual([disjoint.id])
  })

  it('modo restrito só deixa passar tasks de teste (R4)', async () => {
    const { queue } = setup()
    const feature = makeTask({ kind: 'feature' })
    const test = makeTask({ kind: 'test', touches: ['tests/**'] })
    unwrap(await queue.enqueue(feature))
    unwrap(await queue.enqueue(test))

    const eligible = await queue.eligible(context({ restrictedMode: true }))
    expect(eligible.map((t) => t.kind)).toEqual(['test'])
  })

  it('reapExpired devolve claimed→ready e running→failed', async () => {
    const { queue } = setup()
    const claimed = makeTask()
    const running = makeTask({ touches: ['docs/**'] })
    unwrap(await queue.enqueue(claimed))
    unwrap(await queue.enqueue(running))
    unwrap(await queue.claim(claimed.id, 'morto', 1_000, NOW))
    unwrap(await queue.claim(running.id, 'morto', 1_000, NOW))
    unwrap(await queue.update({ ...(await queue.get(running.id))!, state: 'running' }))

    const reaped = await queue.reapExpired(NOW + 2_000)
    expect(new Set(reaped)).toEqual(new Set([claimed.id, running.id]))
    expect((await queue.get(claimed.id))?.state).toBe('ready')
    expect((await queue.get(running.id))?.state).toBe('failed')
  })

  it('stats e deadLetter', async () => {
    const { queue } = setup()
    unwrap(await queue.enqueue(makeTask()))
    const exhausted = makeTask({
      state: 'blocked',
      blockReason: { kind: 'exhausted', message: '3 falhas', resolvableBy: 'human' },
    })
    unwrap(await queue.update(exhausted))

    const stats = await queue.stats()
    expect(stats.total).toBe(2)
    expect(stats.byState.ready).toBe(1)
    expect(stats.byState.blocked).toBe(1)
    expect(stats.deadLettered).toBe(1)
    expect(stats.oldestReadyAt).toBeDefined()

    const dead = await queue.deadLetter()
    expect(dead.map((t) => t.id)).toEqual([exhausted.id])
  })
})
