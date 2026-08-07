import type { AcceptanceContract, Attempt, Check, ProjectId, Task, TaskDraft } from '@uranus/core'
import {
  EMPTY_USAGE,
  ZERO_USD,
  newAttemptId,
  newProjectId,
  newTaskId,
  newWorkspaceId,
} from '@uranus/core'

export const FIXTURE_PROJECT_ID: ProjectId = newProjectId(1_700_000_000_000)

/** Check trivial que sempre passa. Use quando o teste não é sobre verificação. */
export function passingCheck(id = 'always-pass'): Check {
  return { kind: 'command', id, run: 'exit 0', timeoutMs: 5_000 }
}

export function failingCheck(id = 'always-fail'): Check {
  return { kind: 'command', id, run: 'exit 1', timeoutMs: 5_000 }
}

export function makeContract(checks: readonly Check[] = [passingCheck()]): AcceptanceContract {
  return { checks, requireAll: true }
}

/**
 * Task válida por padrão.
 *
 * Note que o contrato de aceite não é opcional nem vazio: uma fixture que
 * produzisse task sem contrato tornaria fácil escrever testes que passam
 * violando o INV-2 — exatamente o inverso do que o testkit deve encorajar.
 */
export function makeTask(overrides: Partial<Task> = {}): Task {
  const now = overrides.createdAt ?? 1_700_000_000_000
  return {
    id: newTaskId(now),
    projectId: FIXTURE_PROJECT_ID,
    kind: 'feature',
    title: 'Tarefa de teste',
    intent: 'Implementar comportamento de teste.',
    state: 'ready',
    priority: 50,
    deps: [],
    touches: ['src/**'],
    acceptance: makeContract(),
    attempts: 0,
    maxAttempts: 3,
    labels: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function makeTaskDraft(overrides: Partial<TaskDraft> = {}): TaskDraft {
  return {
    kind: 'feature',
    title: 'Rascunho de teste',
    intent: 'Implementar comportamento de teste.',
    touches: ['src/**'],
    acceptance: makeContract(),
    ...overrides,
  }
}

export function makeAttempt(overrides: Partial<Attempt> = {}): Attempt {
  const now = overrides.startedAt ?? 1_700_000_000_000
  return {
    id: newAttemptId(now),
    taskId: newTaskId(now),
    n: 1,
    agent: 'executor',
    provider: 'fake',
    model: 'fake-model',
    contextDigest: 'a'.repeat(64),
    workspaceId: newWorkspaceId(now),
    startedAt: now,
    usage: EMPTY_USAGE,
    cost: ZERO_USD,
    ...overrides,
  }
}
