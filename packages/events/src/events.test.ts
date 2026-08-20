import { appendFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { EventStore, ProjectId, UranusEvent } from '@uranus/core'
import { KERNEL_ACTOR, newEventId, newProjectId, silentLogger } from '@uranus/core'
import { FakeClock, InMemoryEventStore, RecordingLogger, withTempDir } from '@uranus/testkit'
import { InProcessEventBus } from './bus.js'
import { JsonlEventStore } from './store/jsonl-store.js'
import { parseSegmentName, segmentFilename, segmentIndexFor } from './store/segments.js'
import { collectEvents, isEvent, replay, replayAll, type Projection } from './replay.js'

const PROJECT: ProjectId = newProjectId(1_700_000_000_000)

function makeBus(store: EventStore, clock = new FakeClock()): InProcessEventBus {
  return new InProcessEventBus({
    store,
    clock,
    logger: silentLogger,
    projectId: PROJECT,
    defaultInterceptTimeoutMs: 200,
  })
}

function rawEvent(name: string, seqLess = true): Omit<UranusEvent, 'seq'> {
  void seqLess
  return {
    id: newEventId(),
    name: name as UranusEvent['name'],
    at: 1_700_000_000_000,
    actor: KERNEL_ACTOR,
    projectId: PROJECT,
    payload: { runId: 'run_x', reason: 'test', ticks: 0 } as never,
  }
}

describe('InProcessEventBus', () => {
  it('persiste antes de notificar (INV-3)', async () => {
    const store = new InMemoryEventStore()
    const bus = makeBus(store)
    let seqVistoNoHandler = -1

    bus.on('KernelPaused', async () => {
      seqVistoNoHandler = await store.head()
    })
    await bus.emit('KernelPaused', { runId: 'run_1' as never, reason: 'r' })

    expect(seqVistoNoHandler).toBe(1)
    expect(store.names()).toEqual(['KernelPaused'])
  })

  it('entrega para assinantes do nome e do curinga', async () => {
    const bus = makeBus(new InMemoryEventStore())
    const recebidos: string[] = []
    bus.on('KernelPaused', (e) => {
      recebidos.push(`especifico:${e.name}`)
    })
    bus.onAny((e) => {
      recebidos.push(`qualquer:${e.name}`)
    })
    await bus.emit('KernelPaused', { runId: 'run_1' as never, reason: 'r' })
    expect(recebidos).toEqual(['especifico:KernelPaused', 'qualquer:KernelPaused'])
  })

  it('once cancela após a primeira entrega; unsubscribe cancela sempre', async () => {
    const bus = makeBus(new InMemoryEventStore())
    let onceCount = 0
    let subCount = 0
    bus.on('KernelResumed', () => void onceCount++, { once: true })
    const unsubscribe = bus.on('KernelResumed', () => void subCount++)

    await bus.emit('KernelResumed', { runId: 'run_1' as never })
    await bus.emit('KernelResumed', { runId: 'run_1' as never })
    expect(onceCount).toBe(1)
    expect(subCount).toBe(2)

    unsubscribe()
    await bus.emit('KernelResumed', { runId: 'run_1' as never })
    expect(subCount).toBe(2)
  })

  it('erro em observador não interrompe os demais nem o emissor', async () => {
    const logger = new RecordingLogger()
    const store = new InMemoryEventStore()
    const bus = new InProcessEventBus({
      store,
      clock: new FakeClock(),
      logger: logger.logger,
      projectId: PROJECT,
    })
    let segundoRodou = false

    bus.on('KernelPaused', () => {
      throw new Error('handler quebrado')
    })
    bus.on('KernelPaused', () => {
      segundoRodou = true
    })

    await expect(
      bus.emit('KernelPaused', { runId: 'run_1' as never, reason: 'r' }),
    ).resolves.toBeDefined()
    expect(segundoRodou).toBe(true)
    expect(logger.has('error', 'Observador de evento falhou')).toBe(true)
  })

  it('assina múltiplos nomes de uma vez', async () => {
    const bus = makeBus(new InMemoryEventStore())
    const vistos: string[] = []
    const unsubscribe = bus.on(['KernelPaused', 'KernelResumed'], (e) => {
      vistos.push(e.name)
    })
    await bus.emit('KernelPaused', { runId: 'r' as never, reason: 'x' })
    await bus.emit('KernelResumed', { runId: 'r' as never })
    unsubscribe()
    await bus.emit('KernelResumed', { runId: 'r' as never })
    expect(vistos).toEqual(['KernelPaused', 'KernelResumed'])
  })

  describe('propose/intercept', () => {
    it('veto impede a persistência e registra o motivo', async () => {
      const store = new InMemoryEventStore()
      const bus = makeBus(store)
      bus.intercept('CommitCreated', () => ({ action: 'veto', reason: 'CI intocável' }))

      const outcome = await bus.propose('CommitCreated', {
        taskId: 'tsk_1' as never,
        sha: 'abc',
        subject: 's',
        diff: { files: [], totalAdded: 0, totalRemoved: 0, isEmpty: true },
      })

      expect(outcome.accepted).toBe(false)
      if (!outcome.accepted && 'vetoedBy' in outcome) {
        expect(outcome.reason).toBe('CI intocável')
      }
      // O evento vetado não entra no log; o veto em si entra.
      expect(store.names()).toEqual(['PluginVetoed'])
    })

    it('continue deixa passar e persiste', async () => {
      const store = new InMemoryEventStore()
      const bus = makeBus(store)
      bus.intercept('CommitCreated', () => ({ action: 'continue' }))

      const outcome = await bus.propose('CommitCreated', {
        taskId: 'tsk_1' as never,
        sha: 'abc',
        subject: 's',
        diff: { files: [], totalAdded: 0, totalRemoved: 0, isEmpty: true },
      })
      expect(outcome.accepted).toBe(true)
      expect(store.names()).toEqual(['CommitCreated'])
    })

    it('defer devolve o prazo sem persistir', async () => {
      const bus = makeBus(new InMemoryEventStore())
      bus.intercept('CommitCreated', () => ({
        action: 'defer',
        reason: 'aguardando aprovação',
        retryAfterMs: 5_000,
      }))
      const outcome = await bus.propose('CommitCreated', {
        taskId: 'tsk_1' as never,
        sha: 'abc',
        subject: 's',
        diff: { files: [], totalAdded: 0, totalRemoved: 0, isEmpty: true },
      })
      expect(outcome.accepted).toBe(false)
      if (!outcome.accepted && 'deferredBy' in outcome) {
        expect(outcome.retryAfterMs).toBe(5_000)
      }
    })

    it('prioridade maior roda antes', async () => {
      const bus = makeBus(new InMemoryEventStore())
      const ordem: string[] = []
      bus.intercept(
        'CommitCreated',
        () => {
          ordem.push('baixa')
          return { action: 'continue' }
        },
        { priority: 1 },
      )
      bus.intercept(
        'CommitCreated',
        () => {
          ordem.push('alta')
          return { action: 'veto', reason: 'primeiro' }
        },
        { priority: 10 },
      )

      await bus.propose('CommitCreated', {
        taskId: 'tsk_1' as never,
        sha: 'abc',
        subject: 's',
        diff: { files: [], totalAdded: 0, totalRemoved: 0, isEmpty: true },
      })
      // A de prioridade alta vetou; a baixa nem rodou.
      expect(ordem).toEqual(['alta'])
    })

    it('interceptor que trava vira continue por timeout, nunca veto', async () => {
      const logger = new RecordingLogger()
      const bus = new InProcessEventBus({
        store: new InMemoryEventStore(),
        clock: new FakeClock(),
        logger: logger.logger,
        projectId: PROJECT,
        defaultInterceptTimeoutMs: 50,
      })
      bus.intercept('CommitCreated', () => new Promise(() => undefined)) // nunca resolve

      const outcome = await bus.propose('CommitCreated', {
        taskId: 'tsk_1' as never,
        sha: 'abc',
        subject: 's',
        diff: { files: [], totalAdded: 0, totalRemoved: 0, isEmpty: true },
      })
      expect(outcome.accepted).toBe(true)
      expect(logger.has('warn', 'timeout')).toBe(true)
    })

    it('interceptor que lança vira continue com erro registrado', async () => {
      const logger = new RecordingLogger()
      const bus = new InProcessEventBus({
        store: new InMemoryEventStore(),
        clock: new FakeClock(),
        logger: logger.logger,
        projectId: PROJECT,
      })
      bus.intercept('CommitCreated', () => {
        throw new Error('interceptor quebrado')
      })
      const outcome = await bus.propose('CommitCreated', {
        taskId: 'tsk_1' as never,
        sha: 'abc',
        subject: 's',
        diff: { files: [], totalAdded: 0, totalRemoved: 0, isEmpty: true },
      })
      expect(outcome.accepted).toBe(true)
      expect(logger.has('error', 'Interceptor falhou')).toBe(true)
    })

    it('unsubscribe remove o interceptor', async () => {
      const bus = makeBus(new InMemoryEventStore())
      const unsubscribe = bus.intercept('CommitCreated', () => ({
        action: 'veto',
        reason: 'x',
      }))
      unsubscribe()
      const outcome = await bus.propose('CommitCreated', {
        taskId: 'tsk_1' as never,
        sha: 'abc',
        subject: 's',
        diff: { files: [], totalAdded: 0, totalRemoved: 0, isEmpty: true },
      })
      expect(outcome.accepted).toBe(true)
    })
  })
})

describe('segmentos', () => {
  it('codifica e decodifica o primeiro seq no nome', () => {
    expect(segmentFilename(1)).toBe('seg-000000000001.jsonl')
    expect(parseSegmentName('seg-000000000042.jsonl')).toBe(42)
    expect(parseSegmentName('outro.jsonl')).toBeUndefined()
  })

  it('localiza o segmento que contém um seq', () => {
    const segments = [
      { firstSeq: 1, filename: 'a', path: 'a' },
      { firstSeq: 100, filename: 'b', path: 'b' },
      { firstSeq: 200, filename: 'c', path: 'c' },
    ]
    expect(segmentIndexFor(segments, 1)).toBe(0)
    expect(segmentIndexFor(segments, 99)).toBe(0)
    expect(segmentIndexFor(segments, 100)).toBe(1)
    expect(segmentIndexFor(segments, 500)).toBe(2)
  })
})

describe('JsonlEventStore', () => {
  it('atribui seq monotônico e lê na ordem', async () => {
    await withTempDir(async (dir) => {
      const store = await JsonlEventStore.open({ dir })
      for (let i = 0; i < 50; i++) {
        await store.append(rawEvent('TickStarted'))
      }
      expect(await store.head()).toBe(50)

      const seqs: number[] = []
      for await (const event of store.read(1)) seqs.push(event.seq)
      expect(seqs).toEqual(Array.from({ length: 50 }, (_, i) => i + 1))
      await store.close()
    })
  })

  it('sobrevive a reabertura preservando todos os eventos (DoD F1)', async () => {
    await withTempDir(async (dir) => {
      const first = await JsonlEventStore.open({ dir, maxSegmentBytes: 4_096 })
      const TOTAL = 10_000
      for (let i = 0; i < TOTAL; i++) {
        await first.append(rawEvent('TickStarted'))
      }
      await first.close()

      // Processo "novo": reabre do disco.
      const second = await JsonlEventStore.open({ dir, maxSegmentBytes: 4_096 })
      expect(await second.head()).toBe(TOTAL)

      let count = 0
      let lastSeq = 0
      for await (const event of second.read(1)) {
        expect(event.seq).toBe(lastSeq + 1)
        lastSeq = event.seq
        count++
      }
      expect(count).toBe(TOTAL)

      // E continua atribuindo seq do ponto certo.
      const next = await second.append(rawEvent('TickCompleted'))
      expect(next.seq).toBe(TOTAL + 1)
      await second.close()
    })
  }, 30_000)

  it('trunca linha parcial deixada por crash no meio do append', async () => {
    await withTempDir(async (dir) => {
      const store = await JsonlEventStore.open({ dir })
      await store.append(rawEvent('TickStarted'))
      await store.append(rawEvent('TickStarted'))
      await store.close()

      // Simula o crash: acrescenta meio JSON sem newline.
      const segment = readdirSync(dir).find((f) => f.startsWith('seg-'))!
      appendFileSync(join(dir, segment), '{"seq":3,"name":"TickSt')

      const reopened = await JsonlEventStore.open({ dir })
      expect(await reopened.head()).toBe(2)
      const next = await reopened.append(rawEvent('TickCompleted'))
      expect(next.seq).toBe(3)

      let count = 0
      for await (const _ of reopened.read(1)) count++
      expect(count).toBe(3)
      await reopened.close()
    })
  })

  it('read com fromSeq e limit', async () => {
    await withTempDir(async (dir) => {
      const store = await JsonlEventStore.open({ dir })
      for (let i = 0; i < 10; i++) await store.append(rawEvent('TickStarted'))

      const seqs: number[] = []
      for await (const event of store.read(4, 3)) seqs.push(event.seq)
      expect(seqs).toEqual([4, 5, 6])
      await store.close()
    })
  })

  it('query filtra por nome', async () => {
    await withTempDir(async (dir) => {
      const store = await JsonlEventStore.open({ dir })
      await store.append(rawEvent('TickStarted'))
      await store.append(rawEvent('KernelPaused'))
      await store.append(rawEvent('TickStarted'))

      const names: string[] = []
      for await (const event of store.query({ names: ['TickStarted'] })) {
        names.push(event.name)
      }
      expect(names).toEqual(['TickStarted', 'TickStarted'])
      await store.close()
    })
  })

  it('rotaciona segmentos e seal fecha o atual', async () => {
    await withTempDir(async (dir) => {
      const store = await JsonlEventStore.open({ dir, maxSegmentBytes: 512 })
      for (let i = 0; i < 30; i++) await store.append(rawEvent('TickStarted'))
      await store.seal(await store.head())
      await store.append(rawEvent('TickCompleted'))
      await store.close()

      const { readdirSync } = await import('node:fs')
      const segments = readdirSync(dir).filter((f) => f.startsWith('seg-'))
      expect(segments.length).toBeGreaterThan(1)

      const reopened = await JsonlEventStore.open({ dir, maxSegmentBytes: 512 })
      expect(await reopened.head()).toBe(31)
      await reopened.close()
    })
  })

  it('prune apaga segmentos antigos mas nunca o atual (Fase 9)', async () => {
    await withTempDir(async (dir) => {
      const store = await JsonlEventStore.open({ dir, maxSegmentBytes: 200 })
      for (let i = 0; i < 60; i++) await store.append(rawEvent('TickStarted'))

      const { readdirSync } = await import('node:fs')
      const before = readdirSync(dir).filter((f) => f.startsWith('seg-'))
      expect(before.length).toBeGreaterThan(3)

      const deleted = await store.prune(2)
      expect(deleted).toBe(before.length - 2)

      const after = readdirSync(dir).filter((f) => f.startsWith('seg-'))
      expect(after.length).toBe(2)
      // O segmento mais recente (o que continua sendo escrito) sobrevive.
      expect(after).toContain(before[before.length - 1])

      // Continua legível e continua aceitando append depois da poda.
      const next = await store.append(rawEvent('TickCompleted'))
      expect(next.seq).toBe(61)
      let count = 0
      for await (const _ of store.read(1)) count++
      // Só o que sobrou nos 2 segmentos mantidos (+ o novo evento) é legível —
      // os eventos podados não existem mais, por design (Fase 9: poda real).
      expect(count).toBeGreaterThan(0)
      await store.close()
    })
  })

  it('prune não apaga nada quando já há poucos segmentos', async () => {
    await withTempDir(async (dir) => {
      const store = await JsonlEventStore.open({ dir })
      await store.append(rawEvent('TickStarted'))
      const deleted = await store.prune(200)
      expect(deleted).toBe(0)
      await store.close()
    })
  })
})

describe('replay', () => {
  function counter(): Projection<Record<string, number>> {
    return {
      name: 'counter',
      initial: {},
      apply(state, event) {
        return { ...state, [event.name]: (state[event.name] ?? 0) + 1 }
      },
    }
  }

  it('dobra eventos em estado', async () => {
    const store = new InMemoryEventStore()
    await store.append(rawEvent('TickStarted'))
    await store.append(rawEvent('TickStarted'))
    await store.append(rawEvent('KernelPaused'))

    const result = await replay(store, counter())
    expect(result.state).toEqual({ TickStarted: 2, KernelPaused: 1 })
    expect(result.eventsApplied).toBe(3)
    expect(result.lastSeq).toBe(3)
  })

  it('retoma de um offset — a base do recover (INV-4)', async () => {
    const store = new InMemoryEventStore()
    await store.append(rawEvent('TickStarted'))
    await store.append(rawEvent('TickStarted'))
    await store.append(rawEvent('KernelPaused'))

    // Snapshot hipotético cobriu até seq 2; só a cauda é reprocessada.
    const result = await replay(store, counter(), {
      fromSeq: 3,
      initial: { TickStarted: 2 },
    })
    expect(result.state).toEqual({ TickStarted: 2, KernelPaused: 1 })
    expect(result.eventsApplied).toBe(1)
  })

  it('replayAll compartilha uma única passagem', async () => {
    const store = new InMemoryEventStore()
    await store.append(rawEvent('TickStarted'))
    const other: Projection<number> = {
      name: 'total',
      initial: 0,
      apply: (state) => state + 1,
    }
    const { states, eventsApplied } = await replayAll(store, [counter(), other])
    expect(states.get('counter')).toEqual({ TickStarted: 1 })
    expect(states.get('total')).toBe(1)
    expect(eventsApplied).toBe(1)
  })

  it('collectEvents filtra com predicado e limite', async () => {
    const store = new InMemoryEventStore()
    await store.append(rawEvent('TickStarted'))
    await store.append(rawEvent('KernelPaused'))
    await store.append(rawEvent('TickStarted'))

    const found = await collectEvents(store, (e) => isEvent(e, 'TickStarted'), { limit: 1 })
    expect(found).toHaveLength(1)
    expect(found[0]!.name).toBe('TickStarted')
  })
})
