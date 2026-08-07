import { describe, expect, it } from 'vitest'
import { ConflictError } from '../errors.js'
import { isErr, isOk, unwrap } from '../result.js'
import {
  allowedTransitions,
  canTransition,
  decideAfterFailure,
  stateAfterInterruption,
  transition,
} from './state-machine.js'
import type { BlockReason, Task, TaskState } from './task.js'
import { TERMINAL_STATES, isActive, isTerminal } from './task.js'
import { newProjectId, newTaskId } from '../ids.js'

const ALL_STATES: readonly TaskState[] = [
  'draft',
  'ready',
  'claimed',
  'running',
  'verifying',
  'verified',
  'failed',
  'integrating',
  'blocked',
  'done',
  'abandoned',
]

const NOW = 1_700_000_000_000

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: newTaskId(NOW),
    projectId: newProjectId(NOW),
    kind: 'feature',
    title: 't',
    intent: 'i',
    state: 'ready',
    priority: 50,
    deps: [],
    touches: ['src/**'],
    acceptance: { checks: [], requireAll: true },
    attempts: 0,
    maxAttempts: 3,
    labels: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

const BLOCK: BlockReason = {
  kind: 'human',
  message: 'precisa de revisão',
  resolvableBy: 'human',
}

describe('máquina de estados', () => {
  it('estados terminais não têm saída', () => {
    for (const state of TERMINAL_STATES) {
      expect(allowedTransitions(state)).toHaveLength(0)
    }
  })

  it('cobre o produto cartesiano de estados sem transição indefinida', () => {
    // Exaustivo de propósito: o teste de caos precisa que nenhuma sequência de
    // crash consiga produzir uma transição fora da tabela.
    for (const from of ALL_STATES) {
      for (const to of ALL_STATES) {
        expect(typeof canTransition(from, to)).toBe('boolean')
      }
    }
  })

  it('nenhum estado alcança "done" sem passar por verificação', () => {
    // INV-2: o único caminho para `done` é integrating, que exige verified.
    const intoDone = ALL_STATES.filter((s) => canTransition(s, 'done'))
    expect(intoDone).toEqual(['integrating'])

    const intoIntegrating = ALL_STATES.filter((s) => canTransition(s, 'integrating'))
    expect(intoIntegrating).toEqual(['verified'])

    const intoVerified = ALL_STATES.filter((s) => canTransition(s, 'verified'))
    expect(intoVerified).toEqual(['verifying'])
  })

  it('aplica transição válida atualizando o timestamp', () => {
    const result = transition(task({ state: 'ready' }), 'claimed', { at: NOW + 10 })
    const next = unwrap(result)
    expect(next.state).toBe('claimed')
    expect(next.updatedAt).toBe(NOW + 10)
  })

  it('rejeita transição ilegal com o conjunto permitido no contexto', () => {
    const result = transition(task({ state: 'ready' }), 'done', { at: NOW })
    expect(isErr(result)).toBe(true)
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ConflictError)
      expect(result.error.context['allowed']).toEqual(allowedTransitions('ready'))
    }
  })

  it('rejeita transição para o mesmo estado', () => {
    expect(isErr(transition(task({ state: 'ready' }), 'ready', { at: NOW }))).toBe(true)
  })

  it('exige BlockReason acionável ao bloquear', () => {
    expect(isErr(transition(task({ state: 'ready' }), 'blocked', { at: NOW }))).toBe(true)
    const withReason = transition(task({ state: 'ready' }), 'blocked', {
      at: NOW,
      blockReason: BLOCK,
    })
    expect(isOk(withReason)).toBe(true)
    expect(unwrap(withReason).blockReason).toEqual(BLOCK)
  })

  it('limpa o BlockReason ao desbloquear', () => {
    const blocked = task({ state: 'blocked', blockReason: BLOCK })
    const next = unwrap(transition(blocked, 'ready', { at: NOW + 1 }))
    expect(next.blockReason).toBeUndefined()
    expect('blockReason' in next).toBe(false)
  })

  it('conta a tentativa apenas quando pedido', () => {
    const base = task({ state: 'claimed', attempts: 1 })
    expect(unwrap(transition(base, 'running', { at: NOW })).attempts).toBe(1)
    expect(unwrap(transition(base, 'running', { at: NOW, countAttempt: true })).attempts).toBe(2)
  })

  it('classifica estados ativos e terminais', () => {
    expect(isActive('running')).toBe(true)
    expect(isActive('ready')).toBe(false)
    expect(isTerminal('done')).toBe(true)
    expect(isTerminal('blocked')).toBe(false)
  })
})

describe('decideAfterFailure', () => {
  it('bloqueia quando a categoria não é resolvível por nova tentativa', () => {
    const decision = decideAfterFailure(task(), {
      retryableCategory: false,
      repeatedCategory: false,
      suggestedAction: 'retry',
    })
    expect(decision.next).toBe('blocked')
    expect(decision.blockReason?.resolvableBy).toBe('human')
  })

  it('bloqueia quando o agente pede intervenção', () => {
    const decision = decideAfterFailure(task(), {
      retryableCategory: true,
      repeatedCategory: false,
      suggestedAction: 'block',
    })
    expect(decision.next).toBe('blocked')
  })

  it('bloqueia ao esgotar as tentativas em vez de repetir para sempre', () => {
    const decision = decideAfterFailure(task({ attempts: 3, maxAttempts: 3 }), {
      retryableCategory: true,
      repeatedCategory: false,
      suggestedAction: 'retry',
    })
    expect(decision.next).toBe('blocked')
    expect(decision.blockReason?.kind).toBe('exhausted')
  })

  it('replaneja quando a mesma categoria se repete (R3)', () => {
    const decision = decideAfterFailure(task({ attempts: 1 }), {
      retryableCategory: true,
      repeatedCategory: true,
      suggestedAction: 'retry',
    })
    expect(decision.next).toBe('draft')
  })

  it('replaneja quando o diagnóstico sugere replan', () => {
    const decision = decideAfterFailure(task({ attempts: 1 }), {
      retryableCategory: true,
      repeatedCategory: false,
      suggestedAction: 'replan',
    })
    expect(decision.next).toBe('draft')
  })

  it('repete com contexto enriquecido no caso comum', () => {
    const decision = decideAfterFailure(task({ attempts: 1 }), {
      retryableCategory: true,
      repeatedCategory: false,
      suggestedAction: 'retry-with-context',
    })
    expect(decision.next).toBe('ready')
  })
})

describe('stateAfterInterruption', () => {
  it('devolve tasks ativas para a fila', () => {
    for (const state of ['claimed', 'running', 'verifying', 'verified', 'integrating'] as const) {
      expect(stateAfterInterruption(state)).toBe('ready')
    }
  })

  it('preserva estados que não estavam em execução', () => {
    for (const state of ['draft', 'ready', 'blocked', 'done', 'abandoned'] as const) {
      expect(stateAfterInterruption(state)).toBe(state)
    }
  })

  it('devolve failed para a fila para que a política de retry decida', () => {
    expect(stateAfterInterruption('failed')).toBe('ready')
  })
})
