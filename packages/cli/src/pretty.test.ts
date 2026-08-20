import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventName, EventPayloads, ProjectId, Task, TaskId, UranusEvent } from '@uranus/core'
import { KERNEL_ACTOR, newEventId, newProjectId, newTaskId, usd } from '@uranus/core'
import { createPrettyPrinter } from './pretty.js'

const PROJECT: ProjectId = newProjectId(1_700_000_000_000)
const TASK_ID: TaskId = newTaskId(1_700_000_000_000)

function makeEvent<N extends EventName>(
  name: N,
  payload: EventPayloads[N],
  taskId?: TaskId,
): UranusEvent<N> {
  return {
    id: newEventId(),
    seq: 1,
    name,
    at: 1_700_000_000_000,
    actor: KERNEL_ACTOR,
    projectId: PROJECT,
    ...(taskId === undefined ? {} : { taskId }),
    payload,
  }
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: TASK_ID,
    projectId: PROJECT,
    kind: 'feature',
    title: 'Adicionar exportação em CSV',
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
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  }
}

describe('createPrettyPrinter', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // TTY/cor não importa pro conteúdo textual das asserções — style noop-eia
    // sem TTY, então o texto sai puro e fica fácil de comparar.
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    logSpy.mockRestore()
  })

  it('TaskStarted usa o título cacheado pelo TaskCreated, sem consultar o repositório', async () => {
    const find = vi.fn((): Promise<Task | undefined> => {
      throw new Error('não deveria consultar — título já estava em cache')
    })
    const print = createPrettyPrinter({ tasks: { find } })

    await print(
      makeEvent('TaskCreated', { taskId: TASK_ID, kind: 'feature', title: 'Minha task' }, TASK_ID),
    )
    expect(logSpy).not.toHaveBeenCalled() // TaskCreated só popula o cache, não imprime

    await print(
      makeEvent(
        'TaskStarted',
        { taskId: TASK_ID, attemptId: 'att_x' as never, agent: 'executor', provider: 'p' },
        TASK_ID,
      ),
    )
    expect(find).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(String(logSpy.mock.calls[0]![0])).toContain('Minha task')
  })

  it('TaskStarted sem TaskCreated prévio consulta o repositório (task já existia antes do run)', async () => {
    const find = vi.fn((): Promise<Task | undefined> => Promise.resolve(makeTask()))
    const print = createPrettyPrinter({ tasks: { find } })

    await print(
      makeEvent(
        'TaskStarted',
        { taskId: TASK_ID, attemptId: 'att_x' as never, agent: 'executor', provider: 'p' },
        TASK_ID,
      ),
    )
    expect(find).toHaveBeenCalledTimes(1)
    expect(String(logSpy.mock.calls[0]![0])).toContain('Adicionar exportação em CSV')

    // Segunda vez usa o cache — não consulta de novo.
    await print(
      makeEvent(
        'TaskCompleted',
        { taskId: TASK_ID, attempts: 1, totalCost: usd(0.5) },
        TASK_ID,
      ),
    )
    expect(find).toHaveBeenCalledTimes(1)
  })

  it('VerificationCompleted resume os checks (passou e falhou)', async () => {
    const find = vi.fn((): Promise<Task | undefined> => Promise.resolve(undefined))
    const print = createPrettyPrinter({ tasks: { find } })

    await print(
      makeEvent(
        'VerificationCompleted',
        {
          taskId: TASK_ID,
          attemptId: 'att_x' as never,
          verification: {
            passed: true,
            durationMs: 10,
            results: [
              { checkId: 'a', kind: 'command', passed: true, advisory: false, durationMs: 1 },
              { checkId: 'b', kind: 'command', passed: true, advisory: false, durationMs: 1 },
            ],
          },
        },
        TASK_ID,
      ),
    )
    expect(String(logSpy.mock.calls[0]![0])).toContain('2/2 checks passaram')

    await print(
      makeEvent(
        'VerificationCompleted',
        {
          taskId: TASK_ID,
          attemptId: 'att_x' as never,
          verification: {
            passed: false,
            durationMs: 10,
            results: [
              { checkId: 'a', kind: 'command', passed: true, advisory: false, durationMs: 1 },
              { checkId: 'existing-tests-pass', kind: 'tests', passed: false, advisory: false, durationMs: 1 },
            ],
          },
        },
        TASK_ID,
      ),
    )
    const secondLine = String(logSpy.mock.calls[1]![0])
    expect(secondLine).toContain('1/2 checks')
    expect(secondLine).toContain('existing-tests-pass')
  })

  it('ignora eventos de ruído interno (TickStarted, WorkspaceCreated, CheckpointCreated)', async () => {
    const find = vi.fn((): Promise<Task | undefined> => Promise.resolve(undefined))
    const print = createPrettyPrinter({ tasks: { find } })

    await print(makeEvent('TickStarted', { runId: 'run_x' as never, tick: 1 }))
    await print(
      makeEvent('WorkspaceCreated', {
        workspaceId: 'wsp_x' as never,
        taskId: TASK_ID,
        branch: 'b',
        rootDir: '/x',
      }),
    )
    await print(
      makeEvent('CheckpointCreated', { checkpointId: 'chk_x' as never, eventOffset: 1, digest: 'd' }),
    )
    expect(logSpy).not.toHaveBeenCalled()
  })
})
