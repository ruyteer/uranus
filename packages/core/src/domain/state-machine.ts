import type { UranusError } from '../errors.js'
import { ConflictError } from '../errors.js'
import type { Result } from '../result.js'
import { err, ok } from '../result.js'
import type { BlockReason, Task, TaskState } from './task.js'
import { isTerminal } from './task.js'

/**
 * Máquina de estados de `Task` — funções puras, sem I/O.
 *
 * Está isolada aqui por um motivo específico: o teste de caos precisa provar que
 * nenhuma sequência de crash produz uma transição ilegal. Isso só é verificável
 * se a transição for uma função pura, testável exaustivamente sobre o produto
 * cartesiano de estados.
 *
 *        ┌──────────────────── replan ────────────────────┐
 *        │                                                │
 *  draft ─▶ ready ─▶ claimed ─▶ running ─▶ verifying ─┬─▶ verified ─▶ integrating ─▶ done
 *     ▲       ▲          │          │          │      │                    │
 *     │       │          ▼          ▼          ▼      └─▶ failed ─ retry ──┘
 *     │       └── unblock ── blocked ◀─────────┴───────────┘  │
 *     │       ▲                                               ▼
 *     │       └── interrupção: qualquer estado ativo ─▶ ready (kill -9 + recovery)
 *     └───────────────── abandoned ◀──────────────────── exhausted
 *
 * `verified` também vai direto pra `failed` (não desenhado acima pra não
 * poluir o diagrama): a cadeia de qualidade roda DEPOIS da verificação
 * passar, e um gate que bloqueia reprova uma task que já estava `verified`.
 */

const TRANSITIONS: Readonly<Record<TaskState, readonly TaskState[]>> = Object.freeze({
  // `draft → blocked` é obrigatório: uma task devolvida para replanejamento
  // cujo plano não pode ser produzido (sem Planner, ou plano inválido demais)
  // precisa de saída. Sem esta aresta ela ficava presa em `draft` e o kernel
  // girava para sempre tentando replanejá-la.
  draft: ['ready', 'blocked', 'abandoned'],
  ready: ['claimed', 'blocked', 'abandoned'],
  // `claimed → ready` é a devolução do lease sem execução (ex.: kernel pausado).
  claimed: ['running', 'ready', 'blocked', 'abandoned'],
  // `<ativo> → ready` é a interrupção (kill -9 + recovery): a task volta à fila
  // e a próxima tentativa parte limpa. Sem estas arestas, um crash nas fases
  // execute/verify/integrate deixaria a task presa para sempre (INV-4).
  running: ['verifying', 'failed', 'blocked', 'ready', 'abandoned'],
  verifying: ['verified', 'failed', 'blocked', 'ready'],
  // `verified → failed`: a cadeia de qualidade roda DEPOIS da verificação
  // passar — um gate que bloqueia (achado crítico) reprova uma task já
  // `verified`, e precisa do mesmo caminho de falha (registrar attempt,
  // decidir retry/replan/block) que `verifying`/`integrating` já têm.
  verified: ['integrating', 'failed', 'blocked', 'ready'],
  integrating: ['done', 'failed', 'blocked', 'ready'],
  // `failed → draft` é o replanejamento: a task volta ao Planner.
  failed: ['ready', 'blocked', 'draft', 'abandoned'],
  blocked: ['ready', 'draft', 'abandoned'],
  done: [],
  abandoned: [],
})

export function allowedTransitions(from: TaskState): readonly TaskState[] {
  return TRANSITIONS[from]
}

export function canTransition(from: TaskState, to: TaskState): boolean {
  return TRANSITIONS[from].includes(to)
}

export interface TransitionOptions {
  readonly at: number
  readonly blockReason?: BlockReason
  /** Incrementa o contador de tentativas (usado ao entrar em `running`). */
  readonly countAttempt?: boolean
  /** Incrementa `repairAttempts` — a volta para `ready` por falha de validação. */
  readonly countRepair?: boolean
  /**
   * Zera `repairAttempts`. Usado quando a verificação passa: reparo é dívida de
   * um ciclo, e uma task não deve chegar ao teto por reparos que já resolveu.
   */
  readonly resetRepair?: boolean
  readonly priority?: number
}

/**
 * Aplica uma transição. Retorna `Result` — não lança — porque transição ilegal
 * é falha de domínio que o kernel precisa tratar (e registrar), não um crash.
 */
export function transition(
  task: Task,
  to: TaskState,
  options: TransitionOptions,
): Result<Task, UranusError> {
  if (task.state === to) {
    return err(
      new ConflictError(`Task já está em "${to}"`, {
        context: { taskId: task.id, state: to },
      }),
    )
  }
  if (!canTransition(task.state, to)) {
    return err(
      new ConflictError(`Transição ilegal: ${task.state} → ${to}`, {
        context: {
          taskId: task.id,
          from: task.state,
          to,
          allowed: allowedTransitions(task.state),
        },
      }),
    )
  }
  if (to === 'blocked' && options.blockReason === undefined) {
    return err(
      new ConflictError('Transição para "blocked" exige um BlockReason acionável', {
        context: { taskId: task.id },
      }),
    )
  }

  const attempts = options.countAttempt === true ? task.attempts + 1 : task.attempts
  // `resetRepair` vence: quem zera está declarando que o ciclo fechou bem, e
  // incrementar em seguida ressuscitaria uma dívida já quitada.
  const repairAttempts =
    options.resetRepair === true
      ? 0
      : options.countRepair === true
        ? task.repairAttempts + 1
        : task.repairAttempts
  const base = {
    ...task,
    state: to,
    attempts,
    repairAttempts,
    priority: options.priority ?? task.priority,
    updatedAt: options.at,
  }

  if (to === 'blocked' && options.blockReason !== undefined) {
    return ok({ ...base, blockReason: options.blockReason })
  }
  // `blockReason` só existe enquanto a task está bloqueada. Mantê-lo depois faria
  // o dashboard exibir um bloqueio que já foi resolvido.
  const { blockReason: _cleared, ...unblocked } = base
  return ok(unblocked)
}

/**
 * A decisão pós-falha. Note que ela **não** consulta o modelo: recebe apenas o
 * estado da task e a categoria do diagnóstico (INV-1).
 */
export interface RetryDecision {
  readonly next: TaskState
  readonly reason: string
  readonly blockReason?: BlockReason
}

export function decideAfterFailure(
  task: Task,
  input: {
    readonly retryableCategory: boolean
    readonly repeatedCategory: boolean
    readonly suggestedAction: 'retry' | 'retry-with-context' | 'escalate' | 'replan' | 'block'
    /**
     * Existe um agente especializado ainda não tentado para esta task?
     *
     * A ordem importa: quando a mesma categoria se repete, escalar vem ANTES de
     * replanejar. Trocar de agente é mais barato que refazer o plano, e o caso
     * comum é o plano estar certo com o executor genérico sendo insuficiente.
     * Só quando a escalada também falha é que o plano vira suspeito.
     */
    readonly escalationAvailable?: boolean
  },
): RetryDecision {
  if (input.suggestedAction === 'block' || !input.retryableCategory) {
    return {
      next: 'blocked',
      reason: 'Categoria de falha não é resolvível por nova tentativa',
      blockReason: {
        kind: 'human',
        message: 'Falha exige intervenção humana',
        resolvableBy: 'human',
      },
    }
  }
  if (task.attempts >= task.maxAttempts) {
    return {
      next: 'blocked',
      reason: `Tentativas esgotadas (${task.attempts}/${task.maxAttempts})`,
      blockReason: {
        kind: 'exhausted',
        message: `Falhou ${task.attempts} vezes; histórico completo preservado nos attempts`,
        resolvableBy: 'human',
      },
    }
  }
  // R3: repetir o que já falhou do mesmo jeito é a definição do loop infinito.
  // A saída, em ordem de custo: escalar → replanejar.
  const stuck = input.repeatedCategory || input.suggestedAction === 'escalate'
  if (stuck && input.escalationAvailable === true) {
    return { next: 'ready', reason: 'Escalando para agente especializado' }
  }
  if (stuck || input.suggestedAction === 'replan') {
    return { next: 'draft', reason: 'Mesma categoria de falha repetida — replanejar' }
  }
  return { next: 'ready', reason: 'Nova tentativa com o diagnóstico no contexto' }
}

/** Estados de onde uma interrupção do kernel deve devolver a task para a fila. */
export function stateAfterInterruption(state: TaskState): TaskState {
  if (isTerminal(state) || state === 'blocked' || state === 'ready' || state === 'draft') {
    return state
  }
  return 'ready'
}
