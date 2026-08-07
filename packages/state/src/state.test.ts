import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Run, TaskId } from '@uranus/core'
import { IntegrityError, newRunId, unwrap, usd } from '@uranus/core'
import { FakeClock, makeAttempt, makeTask, withTempDir } from '@uranus/testkit'
import { openState, stateDbPath } from './db.js'
import { currentVersion, migrate } from './migrations.js'
import { openSqlite } from './node-sqlite-driver.js'
import { readDigested, writeDigested, writeFileAtomic } from './snapshot.js'

const NOW = 1_700_000_000_000

describe('conversões do driver', () => {
  it('booleanos convertem nos dois sentidos', async () => {
    const { toSqlBool, fromSqlBool } = await import('./driver.js')
    expect(toSqlBool(true)).toBe(1)
    expect(toSqlBool(false)).toBe(0)
    expect(fromSqlBool(1)).toBe(true)
    expect(fromSqlBool('1')).toBe(true)
    expect(fromSqlBool(1n)).toBe(true)
    expect(fromSqlBool(0)).toBe(false)
    expect(fromSqlBool(undefined)).toBe(false)
  })

  it('json usa fallback em valor ausente ou corrompido', async () => {
    const { toSqlJson, fromSqlJson } = await import('./driver.js')
    expect(toSqlJson({ a: 1 })).toBe('{"a":1}')
    expect(toSqlJson(undefined)).toBe('null')
    expect(fromSqlJson('{"a":1}', {})).toEqual({ a: 1 })
    expect(fromSqlJson('{quebrado', 'fb')).toBe('fb')
    expect(fromSqlJson(null, 'fb')).toBe('fb')
    expect(fromSqlJson('', 'fb')).toBe('fb')
  })

  it('nullable e number tratam ausência', async () => {
    const { toSqlNullable, fromSqlNullable, toSqlNumber, fromSqlNumber } =
      await import('./driver.js')
    expect(toSqlNullable(undefined)).toBeNull()
    expect(toSqlNullable('x')).toBe('x')
    expect(fromSqlNullable(null)).toBeUndefined()
    expect(fromSqlNullable('x')).toBe('x')
    expect(toSqlNumber(undefined)).toBeNull()
    expect(toSqlNumber(5)).toBe(5)
    expect(fromSqlNumber(null)).toBeUndefined()
    expect(fromSqlNumber(5)).toBe(5)
  })
})

describe('driver + migrations', () => {
  it('falha alto ao abrir caminho impossível', () => {
    expect(() => openSqlite({ path: 'Z:\\nao\\existe\\state.db' })).toThrow()
  })

  it('driver reporta aberto/fechado e ignora close duplo', () => {
    const db = openSqlite({ path: ':memory:', wal: false })
    expect(db.open).toBe(true)
    db.close()
    expect(db.open).toBe(false)
    db.close() // idempotente
  })

  it('aplica migrations uma única vez', () => {
    const db = openSqlite({ path: ':memory:', wal: false })
    const first = migrate(db, NOW)
    expect(first.applied).toEqual([1])
    expect(first.currentVersion).toBe(1)

    const second = migrate(db, NOW)
    expect(second.applied).toEqual([])
    expect(currentVersion(db)).toBe(1)
    db.close()
  })

  it('transação faz rollback em exceção', () => {
    const db = openSqlite({ path: ':memory:', wal: false })
    migrate(db, NOW)
    const insert = db.prepare(
      "INSERT INTO runs (id, project_id, started_at, status, tick) VALUES (?, 'p', 1, 'running', 0)",
    )

    expect(() =>
      db.transaction(() => {
        insert.run('run_a')
        throw new Error('aborta')
      }),
    ).toThrow('aborta')

    const count = db.prepare('SELECT COUNT(*) AS c FROM runs').get<{ c: number }>()
    expect(count?.c).toBe(0)
    db.close()
  })

  it('transações aninhadas usam savepoint', () => {
    const db = openSqlite({ path: ':memory:', wal: false })
    migrate(db, NOW)
    const insert = db.prepare(
      "INSERT INTO runs (id, project_id, started_at, status, tick) VALUES (?, 'p', 1, 'running', 0)",
    )

    db.transaction(() => {
      insert.run('run_outer')
      expect(() =>
        db.transaction(() => {
          insert.run('run_inner')
          throw new Error('interna falha')
        }),
      ).toThrow('interna falha')
    })

    const rows = db.prepare('SELECT id FROM runs').all<{ id: string }>()
    // A externa comitou; a interna reverteu no savepoint.
    expect(rows.map((r) => r.id)).toEqual(['run_outer'])
    db.close()
  })
})

describe('repositórios', () => {
  it('save devolve Err em vez de lançar quando o banco recusa', async () => {
    const state = openState({ path: ':memory:', now: NOW })
    // Attempt referenciando task inexistente: a FK recusa e o repositório
    // converte em Result — o kernel trata, não crasha.
    const orphan = makeAttempt()
    const saved = await state.attempts.save(orphan)
    expect(saved.ok).toBe(false)

    // Task com FK ok mas banco fechado: caminho de erro do task repository.
    const task = makeTask()
    state.close()
    expect((await state.tasks.save(task)).ok).toBe(false)
    expect(
      (
        await state.runs.save({
          id: newRunId(NOW),
          projectId: task.projectId,
          startedAt: NOW,
          status: 'running',
          tick: 0,
        })
      ).ok,
    ).toBe(false)
  })

  it('task faz round-trip completo incluindo campos opcionais', async () => {
    const state = openState({ path: ':memory:', now: NOW })
    const task = makeTask({
      blockReason: { kind: 'budget', message: 'estourou', resolvableBy: 'human' },
      agentHint: 'executor',
      labels: ['mvp'],
    })

    unwrap(await state.tasks.save(task))
    const loaded = await state.tasks.find(task.id)
    expect(loaded).toEqual(task)
    state.close()
  })

  it('task sem opcionais volta sem os campos', async () => {
    const state = openState({ path: ':memory:', now: NOW })
    const task = makeTask()
    unwrap(await state.tasks.save(task))
    const loaded = await state.tasks.find(task.id)
    expect(loaded?.blockReason).toBeUndefined()
    expect(loaded?.agentHint).toBeUndefined()
    state.close()
  })

  it('upsert atualiza estado sem duplicar', async () => {
    const state = openState({ path: ':memory:', now: NOW })
    const task = makeTask()
    unwrap(await state.tasks.save(task))
    unwrap(await state.tasks.save({ ...task, state: 'running', attempts: 1 }))

    expect(await state.tasks.all()).toHaveLength(1)
    expect((await state.tasks.find(task.id))?.state).toBe('running')
    state.close()
  })

  it('byState filtra e ordena por prioridade', async () => {
    const state = openState({ path: ':memory:', now: NOW })
    unwrap(await state.tasks.save(makeTask({ priority: 10, title: 'baixa' })))
    unwrap(await state.tasks.save(makeTask({ priority: 90, title: 'alta' })))
    unwrap(await state.tasks.save(makeTask({ state: 'done', title: 'feita' })))

    const ready = await state.tasks.byState('ready')
    expect(ready.map((t) => t.title)).toEqual(['alta', 'baixa'])
    state.close()
  })

  it('delete remove a task', async () => {
    const state = openState({ path: ':memory:', now: NOW })
    const task = makeTask()
    unwrap(await state.tasks.save(task))
    unwrap(await state.tasks.delete(task.id))
    expect(await state.tasks.find(task.id)).toBeUndefined()
    state.close()
  })

  it('attempt faz round-trip e ordena por n (R3)', async () => {
    const state = openState({ path: ':memory:', now: NOW })
    const task = makeTask()
    unwrap(await state.tasks.save(task))

    const a2 = makeAttempt({ taskId: task.id, n: 2, cost: usd(0.5) })
    const a1 = makeAttempt({
      taskId: task.id,
      n: 1,
      finishedAt: NOW + 100,
      outcome: {
        status: 'failed',
        diagnosis: {
          category: 'test-failure',
          summary: 'quebrou',
          evidence: [],
          suggestedAction: 'retry',
        },
      },
    })
    unwrap(await state.attempts.save(a2))
    unwrap(await state.attempts.save(a1))

    const list = await state.attempts.byTask(task.id)
    expect(list.map((a) => a.n)).toEqual([1, 2])
    expect(list[0]).toEqual(a1)
    expect(list[1]!.cost.micros).toBe(500_000)
    expect(await state.attempts.find(a1.id)).toEqual(a1)
    state.close()
  })

  it('run faz round-trip e lista os não finalizados (entrada do recover)', async () => {
    const state = openState({ path: ':memory:', now: NOW })
    const running: Run = {
      id: newRunId(NOW),
      projectId: makeTask().projectId,
      startedAt: NOW,
      status: 'running',
      tick: 5,
    }
    const done: Run = {
      id: newRunId(NOW + 1),
      projectId: running.projectId,
      startedAt: NOW - 100,
      finishedAt: NOW,
      status: 'completed',
      tick: 42,
      stopReason: 'fila vazia',
    }
    unwrap(await state.runs.save(running))
    unwrap(await state.runs.save(done))

    expect(await state.runs.find(running.id)).toEqual(running)
    expect((await state.runs.unfinished()).map((r) => r.id)).toEqual([running.id])
    expect((await state.runs.latest())?.id).toBe(running.id)
    state.close()
  })
})

describe('leases (DoD F1: TTL expira sem processo vivo)', () => {
  // A FK exige que a task exista: lease órfão é exatamente o que o schema proíbe.
  async function savedTaskId(state: ReturnType<typeof openState>, at = NOW): Promise<TaskId> {
    const task = makeTask({ createdAt: at })
    unwrap(await state.tasks.save(task))
    return task.id
  }

  it('adquire, renova e libera', async () => {
    const state = openState({ path: ':memory:', now: NOW })
    const clock = new FakeClock(NOW)
    const taskId = await savedTaskId(state)

    const lease = unwrap(state.leases.acquire(taskId, 'kernel-1', ['src/**'], 60_000, clock.now()))
    expect(lease.expiresAt).toBe(NOW + 60_000)
    expect(state.leases.active(clock.now())).toHaveLength(1)

    const renewed = unwrap(state.leases.renew(lease, 120_000, clock.now()))
    expect(renewed.expiresAt).toBe(NOW + 120_000)

    unwrap(state.leases.release(taskId))
    expect(state.leases.active(clock.now())).toHaveLength(0)
    state.close()
  })

  it('lease expirado é colhido sem nenhum processo liberar', async () => {
    const state = openState({ path: ':memory:', now: NOW })
    const clock = new FakeClock(NOW)
    const taskId = await savedTaskId(state)

    unwrap(state.leases.acquire(taskId, 'kernel-morto', ['src/**'], 60_000, clock.now()))

    // O "processo" morreu. Só o tempo passa.
    clock.advance(60_001)

    expect(state.leases.active(clock.now())).toHaveLength(0)
    expect(state.leases.reapExpired(clock.now())).toEqual([taskId])
    // Depois de colhido, o caminho está livre para outro claim.
    const again = state.leases.acquire(taskId, 'kernel-2', ['src/**'], 60_000, clock.now())
    expect(again.ok).toBe(true)
    state.close()
  })

  it('rejeita segundo claim da mesma task', async () => {
    const state = openState({ path: ':memory:', now: NOW })
    const taskId = await savedTaskId(state)
    unwrap(state.leases.acquire(taskId, 'a', [], 60_000, NOW))
    const second = state.leases.acquire(taskId, 'b', [], 60_000, NOW)
    expect(second.ok).toBe(false)
    state.close()
  })

  it('claim sobre lease expirado da mesma task substitui', async () => {
    const state = openState({ path: ':memory:', now: NOW })
    const taskId = await savedTaskId(state)
    unwrap(state.leases.acquire(taskId, 'velho', [], 1_000, NOW))
    const second = state.leases.acquire(taskId, 'novo', [], 1_000, NOW + 2_000)
    expect(second.ok).toBe(true)
    state.close()
  })

  it('bloqueia paths que se sobrepõem entre tasks (R6)', async () => {
    const state = openState({ path: ':memory:', now: NOW })
    const holder = await savedTaskId(state)
    unwrap(state.leases.acquire(holder, 'a', ['src/api/**'], 60_000, NOW))

    const conflicting = state.leases.acquire(
      await savedTaskId(state, NOW + 1),
      'b',
      ['src/**'],
      60_000,
      NOW,
    )
    expect(conflicting.ok).toBe(false)

    const disjoint = state.leases.acquire(
      await savedTaskId(state, NOW + 2),
      'c',
      ['docs/**'],
      60_000,
      NOW,
    )
    expect(disjoint.ok).toBe(true)
    state.close()
  })

  it('renew exige o mesmo owner', async () => {
    const state = openState({ path: ':memory:', now: NOW })
    const taskId = await savedTaskId(state)
    const lease = unwrap(state.leases.acquire(taskId, 'dono', [], 60_000, NOW))
    const stolen = state.leases.renew({ ...lease, owner: 'ladrao' }, 60_000, NOW)
    expect(stolen.ok).toBe(false)
    state.close()
  })

  it('conflicts expõe quem segura o quê', async () => {
    const state = openState({ path: ':memory:', now: NOW })
    const holder = await savedTaskId(state)
    unwrap(state.leases.acquire(holder, 'a', ['src/**'], 60_000, NOW))
    const found = state.leases.conflicts(['src/x.ts'], NOW)
    expect(found.map((l) => l.taskId)).toEqual([holder])
    expect(state.leases.conflicts(['src/x.ts'], NOW, holder)).toHaveLength(0)
    state.close()
  })
})

describe('snapshot atômico (R11)', () => {
  it('escreve e lê com digest íntegro', async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, 'checkpoint.json')
      const payload = { tick: 42, tasks: ['a', 'b'] }

      const digest = unwrap(await writeDigested(path, payload))
      expect(digest).toMatch(/^[0-9a-f]{64}$/)

      const loaded = unwrap(await readDigested<typeof payload>(path))
      expect(loaded.payload).toEqual(payload)
      expect(loaded.digest).toBe(digest)
    })
  })

  it('recusa arquivo corrompido em vez de restaurar estado plausível e errado', async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, 'checkpoint.json')
      unwrap(await writeDigested(path, { tick: 42 }))

      // Corrompe um byte do payload mantendo JSON válido.
      const { readFileSync, writeFileSync } = await import('node:fs')
      const raw = readFileSync(path, 'utf8').replace('42', '43')
      writeFileSync(path, raw)

      const result = await readDigested(path)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toBeInstanceOf(IntegrityError)
    })
  })

  it('recusa arquivo ilegível e ausente', async () => {
    await withTempDir(async (dir) => {
      const bad = join(dir, 'bad.json')
      unwrap(await writeFileAtomic(bad, '{nem json'))
      expect((await readDigested(bad)).ok).toBe(false)
      expect((await readDigested(join(dir, 'nao-existe.json'))).ok).toBe(false)
    })
  })

  it('recusa arquivo sem campo digest', async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, 'no-digest.json')
      unwrap(await writeFileAtomic(path, JSON.stringify({ payload: 1 })))
      const result = await readDigested(path)
      expect(result.ok).toBe(false)
    })
  })

  it('escrita atômica não deixa arquivo temporário para trás', async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, 'atomic.json')
      unwrap(await writeFileAtomic(path, 'conteudo'))
      const { readdirSync } = await import('node:fs')
      expect(readdirSync(dir)).toEqual(['atomic.json'])
    })
  })

  it('sobrescrita preserva o destino se sempre passa pelo rename', async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, 'file.json')
      unwrap(await writeFileAtomic(path, 'v1'))
      unwrap(await writeFileAtomic(path, 'v2'))
      const { readFileSync } = await import('node:fs')
      expect(readFileSync(path, 'utf8')).toBe('v2')
    })
  })
})

describe('openState em arquivo real', () => {
  it('persiste através de reabertura (WAL)', async () => {
    await withTempDir(async (dir) => {
      const path = stateDbPath(join(dir, '.uranus'))

      const first = openState({ path, now: NOW })
      const task = makeTask()
      unwrap(await first.tasks.save(task))
      first.close()

      const second = openState({ path, now: NOW })
      expect(await second.tasks.find(task.id)).toEqual(task)
      expect(second.migrations.applied).toEqual([])
      second.close()
    })
  })

  it('leases sobrevivem a reabertura — o TTL é quem manda', async () => {
    await withTempDir(async (dir) => {
      const path = stateDbPath(join(dir, '.uranus'))

      const first = openState({ path, now: NOW })
      const task = makeTask()
      const taskId: TaskId = task.id
      unwrap(await first.tasks.save(task))
      unwrap(first.leases.acquire(taskId, 'kernel-1', ['src/**'], 60_000, NOW))
      first.close() // kill -9 simulado: o lease fica no banco

      const second = openState({ path, now: NOW })
      // Antes do TTL: ainda bloqueia.
      expect(second.leases.active(NOW + 1_000)).toHaveLength(1)
      // Depois do TTL: expira sozinho.
      expect(second.leases.active(NOW + 61_000)).toHaveLength(0)
      expect(second.leases.reapExpired(NOW + 61_000)).toEqual([taskId])
      second.close()
    })
  })
})
