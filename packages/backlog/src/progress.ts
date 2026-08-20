import type { Task } from '@uranus/core'
import { isActive, isTerminal } from '@uranus/core'

/**
 * Quanto do trabalho de um item de backlog já andou.
 *
 * Os contadores particionam o conjunto: `total = done + abandoned + blocked +
 * active + queued` (`abandoned` não tem contador próprio porque ninguém precisa
 * dele para decidir nada; entra em `total` e some do resto). `failed` conta como
 * `queued`: a task ainda vai voltar para a fila, e mostrá-la como parada
 * assustaria o humano por um estado transitório.
 */
export interface BacklogProgress {
  readonly total: number
  readonly done: number
  readonly blocked: number
  readonly active: number
  readonly queued: number
  /** Todas terminais E pelo menos uma `done`. */
  readonly complete: boolean
}

/**
 * Progresso das tasks de um item — função pura, sem I/O, para o kernel decidir
 * se fecha o item e para o CLI e a dashboard mostrarem `3/5 · 1 bloqueada`.
 *
 * `complete` exige `total > 0` e ao menos uma `done`: um item cujo plano não
 * gerou task nenhuma, ou cujas tasks foram todas abandonadas, não está pronto —
 * está quebrado, e marcá-lo `done` esconderia exatamente a falha que o humano
 * precisa ver.
 */
export function backlogProgress(tasks: readonly Task[]): BacklogProgress {
  let done = 0
  let blocked = 0
  let active = 0
  let queued = 0
  let terminal = 0

  for (const task of tasks) {
    if (isTerminal(task.state)) {
      terminal++
      if (task.state === 'done') done++
      continue
    }
    if (task.state === 'blocked') blocked++
    else if (isActive(task.state)) active++
    else queued++
  }

  return {
    total: tasks.length,
    done,
    blocked,
    active,
    queued,
    complete: tasks.length > 0 && done > 0 && terminal === tasks.length,
  }
}
