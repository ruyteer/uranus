import type { TaskId } from '../ids.js'
import type { Task, TaskState } from './task.js'
import { isActive } from './task.js'

/**
 * Poda do estado quente.
 *
 * O log de eventos (`.uranus/events/`) é o registro durável e append-only —
 * ele NÃO é tocado aqui. A tabela de tasks é estado quente: serve para decidir
 * o que executar agora. Uma task concluída há três semanas não participa mais
 * de nenhuma decisão, e mantê-la só torna `task list` ilegível.
 *
 * Por isso a poda é segura por construção: o que ela apaga já está contado no
 * log, e o que ela se recusa a apagar é o que ainda decide alguma coisa.
 */

export interface PrunePolicy {
  /** Estados que o operador pediu para podar. */
  readonly states: readonly TaskState[]
  /** Idade mínima desde `updatedAt`. Zero poda tudo que estiver nos estados. */
  readonly olderThanMs: number
  readonly now: number
}

export const DEFAULT_PRUNE_POLICY: Omit<PrunePolicy, 'now'> = Object.freeze({
  states: ['done', 'abandoned'] as readonly TaskState[],
  olderThanMs: 7 * 24 * 60 * 60 * 1_000,
})

/**
 * Estados que nenhuma poda remove, nem com `--state` explícito.
 *
 * `claimed`…`integrating` detêm lease e podem ter worker em voo. `draft` e
 * `ready` são trabalho que ainda vai acontecer — apagá-los seria descartar em
 * silêncio o que alguém pediu. `failed` e `blocked` ficam de fora desta lista
 * de propósito: parecem lixo, não são (é retry pendente ou humano pendente),
 * mas o operador pode pedi-los explicitamente quando sabe o que está fazendo.
 */
const NEVER_PRUNABLE: ReadonlySet<TaskState> = new Set<TaskState>([
  'draft',
  'ready',
  'claimed',
  'running',
  'verifying',
  'verified',
  'integrating',
])

/** Por que uma task candidata ficou de fora. É isto que o operador lê. */
export type PruneRefusal =
  /** Detém (ou pode deter) um lease e trabalho em voo. Nunca podável. */
  | 'ativa'
  /** Trabalho pendente (`draft`/`ready`). Nunca podável. */
  | 'pendente'
  /** Estado fora do que o comando pediu. */
  | 'estado-nao-pedido'
  /** Terminou recentemente demais para a janela pedida. */
  | 'recente'
  /** Outra task que fica declara esta em `deps`. */
  | 'dependencia'

export interface PruneKeep {
  readonly task: Task
  readonly reason: PruneRefusal
  /** Para `dependencia`: quem ainda depende desta task. */
  readonly requiredBy?: TaskId
}

export interface PrunePlan {
  readonly remove: readonly Task[]
  readonly keep: readonly PruneKeep[]
}

/**
 * Decide o que pode sair, sem apagar nada.
 *
 * `NEVER_PRUNABLE` é absoluto e ignora o que foi pedido na linha de comando.
 *
 * A recusa por dependência é a que evita o modo de falha silencioso:
 * `dependenciesSatisfied` exige `stateOf(dep) === 'done'`, e uma dependência
 * apagada devolve `undefined`. Podar uma task que alguém lista em `deps`
 * tornaria a dependente **inelegível para sempre**, sem erro e sem log. Então
 * não podamos — a menos que a dependente também esteja saindo na mesma poda.
 */
export function planPrune(all: readonly Task[], policy: PrunePolicy): PrunePlan {
  const wanted = new Set(policy.states)
  const keep: PruneKeep[] = []
  const candidates = new Map<TaskId, Task>()

  for (const task of all) {
    if (NEVER_PRUNABLE.has(task.state)) {
      keep.push({ task, reason: isActive(task.state) ? 'ativa' : 'pendente' })
      continue
    }
    if (!wanted.has(task.state)) {
      keep.push({ task, reason: 'estado-nao-pedido' })
      continue
    }
    if (policy.now - task.updatedAt < policy.olderThanMs) {
      keep.push({ task, reason: 'recente' })
      continue
    }
    candidates.set(task.id, task)
  }

  // Ponto fixo: proteger uma task por dependência a transforma em sobrevivente,
  // e uma sobrevivente pode por sua vez proteger as dependências DELA. Uma
  // passada só deixaria escapar cadeias com mais de um elo.
  for (;;) {
    let changed = false
    for (const task of all) {
      if (candidates.has(task.id)) continue // quem está saindo não protege nada
      for (const dep of task.deps) {
        const protegida = candidates.get(dep)
        if (protegida === undefined) continue
        candidates.delete(dep)
        keep.push({ task: protegida, reason: 'dependencia', requiredBy: task.id })
        changed = true
      }
    }
    if (!changed) break
  }

  // Ordem estável: mais antigas primeiro, como em `tasks.all()`.
  const remove = [...candidates.values()].sort((a, b) => a.createdAt - b.createdAt)
  return { remove, keep }
}

/**
 * Tasks que ficam vivas mas passam a depender de algo que saiu de cena.
 *
 * `dependenciesSatisfied` exige `stateOf(dep) === 'done'`. Uma dependência
 * apagada devolve `undefined`; uma abandonada devolve `'abandoned'`. Nos dois
 * casos a dependente nunca mais é elegível — e nos dois casos isso acontece
 * sem erro e sem log. `planPrune` evita o problema recusando a poda; abandonar
 * em lote não pode recusar (matar uma árvore inteira é um pedido legítimo),
 * então aqui o trabalho é **mostrar** quem fica preso antes de confirmar.
 */
export function orphanedBy(
  all: readonly Task[],
  leaving: ReadonlySet<TaskId>,
): readonly { readonly task: Task; readonly missingDep: TaskId }[] {
  const orphans: { task: Task; missingDep: TaskId }[] = []
  for (const task of all) {
    if (leaving.has(task.id)) continue
    if (isTerminalish(task.state)) continue
    for (const dep of task.deps) {
      if (leaving.has(dep)) orphans.push({ task, missingDep: dep })
    }
  }
  return orphans
}

/** `done`/`abandoned` já não esperam por nada; ficar sem dependência não os afeta. */
function isTerminalish(state: TaskState): boolean {
  return state === 'done' || state === 'abandoned'
}

/** Resumo por estado e por tipo, para o relatório do comando. */
export function summarizePrune(tasks: readonly Task[]): {
  readonly byState: Readonly<Record<string, number>>
  readonly byKind: Readonly<Record<string, number>>
} {
  const byState: Record<string, number> = {}
  const byKind: Record<string, number> = {}
  for (const task of tasks) {
    byState[task.state] = (byState[task.state] ?? 0) + 1
    byKind[task.kind] = (byKind[task.kind] ?? 0) + 1
  }
  return { byState, byKind }
}
