import { describe, expect, it } from 'vitest'
import type {
  Clock,
  EventBus,
  EventName,
  EventPayloads,
  PlanId,
  PlanRejection,
  ProjectId,
  Result,
  Task,
  TaskState,
  UranusEvent,
} from '@uranus/core'
import {
  KERNEL_ACTOR,
  ValidationError,
  err,
  newEventId,
  newProjectId,
  newTaskId,
  ok,
} from '@uranus/core'
import type { StoredBacklogItem } from '@uranus/backlog'
import type { PlanningResult } from '@uranus/kernel'
import { createBacklogPort, type BacklogPortDeps } from './backlog-port.js'

const PROJECT: ProjectId = newProjectId(1_700_000_000_000)
const AGORA = 1_700_000_500_000

function makeItem(overrides: Partial<StoredBacklogItem> = {}): StoredBacklogItem {
  return {
    id: 'trocar-login-abc123',
    projectId: PROJECT,
    title: 'Trocar o login',
    body: 'corpo',
    labels: [],
    priority: 50,
    source: 'manual',
    createdAt: 1_700_000_000_000,
    state: 'open',
    ...overrides,
  }
}

function makeTask(state: TaskState, backlogItemId?: string): Task {
  const now = 1_700_000_000_000
  return {
    id: newTaskId(now),
    projectId: PROJECT,
    kind: 'feature',
    title: 't',
    intent: 'i',
    state,
    priority: 50,
    deps: [],
    touches: [],
    acceptance: { checks: [], requireAll: true },
    attempts: 0,
    maxAttempts: 3,
    repairAttempts: 0,
    labels: [],
    createdAt: now,
    updatedAt: now,
    ...(backlogItemId === undefined ? {} : { backlogItemId }),
  }
}

interface EmittedEvent {
  readonly name: EventName
  readonly payload: unknown
}

/** Barramento mínimo: guarda o que foi emitido e reentrega o que foi assinado. */
function fakeEvents(): Pick<EventBus, 'emit' | 'on'> & {
  readonly emitted: EmittedEvent[]
  fire<N extends EventName>(name: N, payload: EventPayloads[N]): void
} {
  const emitted: EmittedEvent[] = []
  const handlers = new Map<string, ((event: UranusEvent<never>) => void)[]>()

  const build = <N extends EventName>(name: N, payload: EventPayloads[N]): UranusEvent<N> => ({
    id: newEventId(AGORA),
    seq: emitted.length + 1,
    name,
    at: AGORA,
    actor: KERNEL_ACTOR,
    projectId: PROJECT,
    payload,
  })

  return {
    emitted,
    emit<N extends EventName>(name: N, payload: EventPayloads[N]): Promise<UranusEvent<N>> {
      emitted.push({ name, payload })
      return Promise.resolve(build(name, payload))
    },
    on<N extends EventName>(name: N | readonly N[], handler: (event: UranusEvent<N>) => void) {
      const chave = String(name)
      const lista = handlers.get(chave) ?? []
      lista.push(handler)
      handlers.set(chave, lista)
      return () => {
        handlers.set(
          chave,
          (handlers.get(chave) ?? []).filter((h) => h !== handler),
        )
      }
    },
    fire<N extends EventName>(name: N, payload: EventPayloads[N]): void {
      for (const handler of handlers.get(name) ?? []) {
        ;(handler as (event: UranusEvent<N>) => void)(build(name, payload))
      }
    },
  }
}

interface Harness {
  readonly deps: BacklogPortDeps
  readonly events: ReturnType<typeof fakeEvents>
  readonly gravados: StoredBacklogItem[]
  readonly itens: Map<string, StoredBacklogItem>
}

function harness(options: {
  itens: readonly StoredBacklogItem[]
  plan?: (item: StoredBacklogItem) => Result<PlanningResult>
  autoPlan?: boolean
  maxPlanningFailures?: number
  onPlan?: () => void
}): Harness {
  const itens = new Map(options.itens.map((item) => [item.id, item]))
  const gravados: StoredBacklogItem[] = []
  const events = fakeEvents()
  const clock: Pick<Clock, 'now'> = { now: () => AGORA }

  const deps: BacklogPortDeps = {
    backlog: {
      list: (state) =>
        Promise.resolve(
          [...itens.values()].filter((item) => state === undefined || item.state === state),
        ),
      get: (id) => Promise.resolve(itens.get(id)),
      update: (item) => {
        gravados.push(item)
        itens.set(item.id, item)
        return Promise.resolve(ok())
      },
    },
    planning: {
      planItem: (item) => {
        options.onPlan?.()
        return Promise.resolve(
          options.plan?.(item) ?? err(new ValidationError('sem planejador no teste')),
        )
      },
    },
    events,
    clock,
    digest: () => Promise.resolve(undefined),
    autoPlan: options.autoPlan ?? true,
    maxPlanningFailures: options.maxPlanningFailures ?? 2,
  }
  return { deps, events, gravados, itens }
}

const sinal = new AbortController().signal

const planoAceito = (tasks: number): Result<PlanningResult> =>
  ok({
    planId: 'pln_1' as PlanId,
    created: Array.from({ length: tasks }, () => makeTask('ready')),
    summary: 'resumo',
    crossProject: [],
  })

describe('nextPlannable', () => {
  it('devolve o primeiro item na ordem que o store já entregou', async () => {
    const { deps } = harness({
      itens: [makeItem({ id: 'primeiro' }), makeItem({ id: 'segundo' })],
    })
    await expect(createBacklogPort(deps).nextPlannable(sinal)).resolves.toEqual({
      id: 'primeiro',
      title: 'Trocar o login',
    })
  })

  it('pula quem já esgotou as tentativas de planejamento', async () => {
    const { deps } = harness({
      itens: [
        makeItem({ id: 'desistido', planningFailures: 2 }),
        makeItem({ id: 'viavel', planningFailures: 1 }),
      ],
      maxPlanningFailures: 2,
    })
    const alvo = await createBacklogPort(deps).nextPlannable(sinal)
    expect(alvo?.id).toBe('viavel')
  })

  it('nada elegível devolve undefined — é o que deixa o kernel drenar', async () => {
    const { deps } = harness({ itens: [makeItem({ planningFailures: 9 })] })
    await expect(createBacklogPort(deps).nextPlannable(sinal)).resolves.toBeUndefined()
  })

  it('autoPlan desligado não oferece item nenhum', async () => {
    const { deps } = harness({ itens: [makeItem()], autoPlan: false })
    await expect(createBacklogPort(deps).nextPlannable(sinal)).resolves.toBeUndefined()
  })
})

describe('plan', () => {
  it('plano aceito marca planned, grava planId e startedAt e emite BacklogItemPlanned', async () => {
    const item = makeItem()
    const { deps, events, gravados } = harness({ itens: [item], plan: () => planoAceito(3) })

    await expect(createBacklogPort(deps).plan(item.id, sinal)).resolves.toBe(3)
    expect(gravados[0]).toMatchObject({
      state: 'planned',
      planId: 'pln_1',
      startedAt: AGORA,
    })
    expect(events.emitted).toEqual([
      { name: 'BacklogItemPlanned', payload: { itemId: item.id, planId: 'pln_1', tasks: 3 } },
    ])
  })

  it('sucesso apaga as recusas antigas — elas descrevem um plano que não existe mais', async () => {
    const item = makeItem({ planningFailures: 1, lastRejections: ['escopo amplo'] })
    const { deps, gravados } = harness({ itens: [item], plan: () => planoAceito(1) })

    await createBacklogPort(deps).plan(item.id, sinal)
    expect(gravados[0]).not.toHaveProperty('lastRejections')
    // O contador fica: é histórico do item, não alarme (o estado já é `planned`).
    expect(gravados[0]?.planningFailures).toBe(1)
  })

  it('recusa incrementa o contador, grava as mensagens e emite as recusas íntegras', async () => {
    const item = makeItem({ planningFailures: 1 })
    const recusas: readonly PlanRejection[] = [
      { code: 'too-large', message: 'plano grande demais' },
      { code: 'unenforceable-acceptance', message: 'aceite não verificável' },
    ]
    const { deps, events, gravados } = harness({
      itens: [item],
      plan: () => err(new ValidationError('não convergiu')),
      // O `PlanningService` emite `PlanRejected` durante o `planItem`; é dali
      // que sai o `code` de cada recusa, que o erro devolvido já perdeu.
      onPlan: () => {
        events.fire('PlanRejected', { sourceItemId: item.id, rejections: recusas })
      },
    })

    await expect(createBacklogPort(deps).plan(item.id, sinal)).resolves.toBeUndefined()
    expect(gravados[0]).toMatchObject({
      state: 'open',
      planningFailures: 2,
      lastRejections: ['plano grande demais', 'aceite não verificável'],
    })
    expect(events.emitted).toEqual([
      {
        name: 'BacklogItemPlanningFailed',
        payload: { itemId: item.id, failures: 2, rejections: recusas },
      },
    ])
  })

  it('falha sem recusa nenhuma (provider fora do ar) grava o erro para o humano ler', async () => {
    const item = makeItem()
    const { deps, gravados } = harness({
      itens: [item],
      plan: () => err(new ValidationError('provider indisponível')),
    })

    await createBacklogPort(deps).plan(item.id, sinal)
    expect(gravados[0]?.lastRejections).toEqual(['provider indisponível'])
  })

  it('recusa de OUTRO item não contamina as recusas deste', async () => {
    const item = makeItem()
    // `PlanRejected` é global: sem filtrar por `sourceItemId`, um replanejamento
    // concorrente gravaria as recusas dele no item errado.
    const alheio: { fire?: () => void } = {}
    const { deps, events, gravados } = harness({
      itens: [item],
      plan: () => err(new ValidationError('não convergiu')),
      onPlan: () => {
        alheio.fire?.()
      },
    })
    alheio.fire = () => {
      events.fire('PlanRejected', {
        sourceItemId: 'outro-item',
        rejections: [{ code: 'empty', message: 'plano vazio do vizinho' }],
      })
    }

    await createBacklogPort(deps).plan(item.id, sinal)
    expect(gravados[0]?.lastRejections).toEqual(['não convergiu'])
  })

  it('planItem que LANÇA também deixa rastro no item, e repropaga', async () => {
    // O caminho de exceção (provider fora do ar, rate limit) escapava sem
    // gravar nada: o humano abria `backlog show` e não via motivo nenhum, e o
    // teto de recusas nunca engatava — todo `uranus start` retentava o mesmo
    // item para sempre.
    const item = makeItem()
    const { deps, gravados, events } = harness({
      itens: [item],
      plan: () => {
        throw new Error('rate limit do provider')
      },
    })

    await expect(createBacklogPort(deps).plan(item.id, sinal)).rejects.toThrow(
      'rate limit do provider',
    )
    expect(gravados[0]?.planningFailures).toBe(1)
    expect(gravados[0]?.lastRejections).toEqual(['rate limit do provider'])
    expect(events.emitted.map((evento) => evento.name)).toContain('BacklogItemPlanningFailed')
  })

  it('exceção repetida acaba esgotando o teto, em vez de retentar para sempre', async () => {
    const item = makeItem({ planningFailures: 1 })
    const { deps, gravados } = harness({
      itens: [item],
      plan: () => {
        throw new Error('provider caiu de novo')
      },
    })

    await expect(createBacklogPort(deps).plan(item.id, sinal)).rejects.toThrow()
    expect(gravados[0]?.planningFailures).toBe(2)
  })

  it('item inexistente não explode nem grava nada', async () => {
    const { deps, gravados } = harness({ itens: [] })
    await expect(createBacklogPort(deps).plan('fantasma', sinal)).resolves.toBeUndefined()
    expect(gravados).toEqual([])
  })
})

describe('taskFinished', () => {
  it('fecha o item quando todas terminaram e emite a duração desde o planejamento', async () => {
    const item = makeItem({ state: 'planned', startedAt: AGORA - 60_000 })
    const { deps, events, gravados } = harness({ itens: [item] })

    await createBacklogPort(deps).taskFinished(item.id, [
      makeTask('done', item.id),
      makeTask('done', item.id),
    ])

    expect(gravados[0]?.state).toBe('done')
    expect(events.emitted).toEqual([
      {
        name: 'BacklogItemCompleted',
        payload: { itemId: item.id, tasks: 2, durationMs: 60_000 },
      },
    ])
  })

  it('com irmã ainda na fila não fecha nada', async () => {
    const item = makeItem({ state: 'planned' })
    const { deps, events, gravados } = harness({ itens: [item] })

    await createBacklogPort(deps).taskFinished(item.id, [
      makeTask('done', item.id),
      makeTask('ready', item.id),
    ])

    expect(gravados).toEqual([])
    expect(events.emitted).toEqual([])
  })

  it('todas abandonadas não é item pronto — é item quebrado', async () => {
    const item = makeItem({ state: 'planned' })
    const { deps, gravados } = harness({ itens: [item] })

    await createBacklogPort(deps).taskFinished(item.id, [makeTask('abandoned', item.id)])
    expect(gravados).toEqual([])
  })

  it('item já concluído não emite BacklogItemCompleted de novo', async () => {
    const item = makeItem({ state: 'done' })
    const { deps, events } = harness({ itens: [item] })

    await createBacklogPort(deps).taskFinished(item.id, [makeTask('done', item.id)])
    expect(events.emitted).toEqual([])
  })

  it('sem startedAt a duração é zero em vez de um relógio inventado', async () => {
    const item = makeItem({ state: 'planned' })
    const { deps, events } = harness({ itens: [item] })

    await createBacklogPort(deps).taskFinished(item.id, [makeTask('done', item.id)])
    expect(events.emitted[0]?.payload).toMatchObject({ durationMs: 0 })
  })
})
