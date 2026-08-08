import type { SchedulerPolicy, Task, TaskKind } from '@uranus/core'
import { globsIntersect } from '@uranus/core'

/**
 * Políticas de priorização.
 *
 * Contrato de cada uma: `null` = veto (inelegível, incompensável por qualquer
 * outra dimensão); `number` = contribuição, normalizada em 0..10 para que os
 * pesos da config signifiquem o mesmo entre políticas.
 *
 * Nenhuma delas consulta modelo — prioridade é decisão do harness (INV-1).
 */

const MAX_SCORE = 10

// ── Vetos ───────────────────────────────────────────────────────────────────

/** Dependência não satisfeita: incompensável. */
export function dependencyReadyPolicy(
  stateOf: (id: string) => string | undefined,
): SchedulerPolicy {
  return {
    id: 'dependency-ready',
    score(task) {
      const pending = task.deps.filter((id) => stateOf(id) !== 'done')
      return pending.length === 0 ? 0 : null
    },
  }
}

/** Conflito de arquivo com lease ativo (R6): espera, não bloqueia. */
export const fileLeasePolicy: SchedulerPolicy = {
  id: 'file-lease',
  score(task, context) {
    const conflicting = context.activeLeases.some(
      (lease) => lease.taskId !== task.id && globsIntersect(lease.paths, task.touches),
    )
    return conflicting ? null : 0
  },
}

/** Orçamento restante não comporta nem o mínimo de uma task. */
export const budgetAwarePolicy: SchedulerPolicy = {
  id: 'budget-aware',
  score(_task, context) {
    const run = context.budget.run
    const costLeft = run.limits.cost.micros - run.usedCost.micros
    const tokensLeft = run.limits.tokens - run.usedTokens
    return costLeft <= 0 || tokensLeft <= 0 ? null : 0
  },
}

/**
 * Cooldown pós-falha (R3): uma task que acabou de falhar cede a vez.
 * Veto TEMPORAL — ela volta a ser elegível quando o cooldown passa, o que
 * quebra o hot-loop sem descartar o trabalho.
 */
export function failureCooldownPolicy(cooldownMs: number): SchedulerPolicy {
  return {
    id: 'failure-cooldown',
    score(task, context) {
      if (cooldownMs <= 0) return 0
      const lastFailure = context.recentOutcomes
        .filter((outcome) => outcome.taskId === task.id && outcome.status === 'failed')
        .at(-1)
      if (lastFailure === undefined) return 0
      return context.now - lastFailure.at < cooldownMs ? null : 0
    },
  }
}

/** Limite de trabalho em progresso por tipo. */
export function wipLimitPolicy(limit: number): SchedulerPolicy {
  return {
    id: 'wip-limit',
    score(task, context) {
      const active =
        context.stats.byState.running +
        context.stats.byState.verifying +
        context.stats.byState.integrating
      void task
      return active >= limit ? null : 0
    },
  }
}

/** Modo restrito (R4): sem sinal de verificação, só tasks que o constroem. */
export const restrictedModePolicy: SchedulerPolicy = {
  id: 'restricted-mode',
  score(task, context) {
    if (!context.restrictedMode) return 0
    return task.kind === 'test' ? MAX_SCORE : null
  },
}

// ── Contribuições ───────────────────────────────────────────────────────────

/** Blocker declarado e regressão de CI vão para o topo, sempre. */
export const blockerFirstPolicy: SchedulerPolicy = {
  id: 'blocker-first',
  score(task) {
    if (task.labels.includes('blocker')) return MAX_SCORE
    if (task.labels.includes('regression')) return MAX_SCORE
    return 0
  },
}

const KIND_BASE: Readonly<Record<TaskKind, number>> = {
  security: 9,
  bugfix: 8,
  migration: 6,
  feature: 5,
  test: 5,
  infra: 4,
  perf: 4,
  deps: 3,
  refactor: 3,
  docs: 2,
  chore: 2,
  review: 6,
  investigation: 5,
}

/** Bug/segurança acima de feature; peso cresce com a idade do bug. */
export const bugPriorityPolicy: SchedulerPolicy = {
  id: 'bug-priority',
  score(task, context) {
    const base = KIND_BASE[task.kind]
    if (task.kind !== 'bugfix' && task.kind !== 'security') return base
    const ageDays = Math.max(0, (context.now - task.createdAt) / 86_400_000)
    return Math.min(MAX_SCORE, base + Math.min(2, ageDays / 3))
  },
}

/**
 * Anti-inanição: idade empurra qualquer task para cima.
 *
 * **Invariante desta política:** com boost máximo, ela precisa SUPERAR a maior
 * contribuição possível de tipo. Caso contrário docs e refactor jamais rodariam
 * num backlog que recebe bugs continuamente — a task velha perderia para cada
 * bug novo, para sempre. É por isso que o peso default é 8: `10 × 8 = 80` vence
 * `10 × 6 = 60` de `bug-priority`. Mexer nos pesos sem preservar essa relação
 * reintroduz a inanição (há teste cobrindo).
 *
 * A rampa de 7 dias mantém a ordenação de curto prazo intacta: um bug novo
 * ainda ganha de um doc de ontem; o cruzamento acontece por volta de 3 dias.
 */
export function starvationGuardPolicy(fullBoostAfterMs = 7 * 86_400_000): SchedulerPolicy {
  return {
    id: 'starvation-guard',
    score(task, context) {
      const age = Math.max(0, context.now - task.createdAt)
      return Math.min(MAX_SCORE, (age / fullBoostAfterMs) * MAX_SCORE)
    },
  }
}

/**
 * Cotas por tipo: aproxima a distribuição executada da configurada.
 *
 * Compara a fração observada com a alvo e premia quem está sub-representado.
 * É contribuição, não veto — uma cota estourada não impede trabalho urgente.
 */
export const mixQuotaPolicy: SchedulerPolicy = {
  id: 'mix-quota',
  score(task, context) {
    const target = context.mix[task.kind]
    if (target === undefined || target <= 0) return 0
    const observed = context.observedMix[task.kind] ?? 0
    const deficit = target - observed
    // deficit ∈ [-1, 1] → score ∈ [0, 10], centrado em 5 quando na cota.
    return Math.max(0, Math.min(MAX_SCORE, (deficit + 1) * (MAX_SCORE / 2)))
  },
}

/**
 * Localidade de contexto: prefere tasks cujo escopo se parece com o da última
 * concluída. O ganho é real — cache de prompt e menos arquivos novos por pack.
 */
export function contextLocalityPolicy(lastTouches: () => readonly string[]): SchedulerPolicy {
  return {
    id: 'context-locality',
    score(task) {
      const previous = lastTouches()
      if (previous.length === 0) return 0
      return globsIntersect(previous, task.touches) ? MAX_SCORE : 0
    },
  }
}

/** Tasks com mais dependentes destravam mais trabalho: rodam antes. */
export function criticalPathPolicy(dependentsOf: (id: Task['id']) => number): SchedulerPolicy {
  return {
    id: 'critical-path',
    score(task) {
      return Math.min(MAX_SCORE, dependentsOf(task.id) * 3)
    },
  }
}

/** Prioridade explícita do item de backlog (0..100 → 0..10). */
export const explicitPriorityPolicy: SchedulerPolicy = {
  id: 'explicit-priority',
  score(task) {
    return Math.max(0, Math.min(MAX_SCORE, task.priority / 10))
  },
}

/** Provider degradado torna qualquer task inelegível — nada a fazer agora. */
export const providerHealthPolicy: SchedulerPolicy = {
  id: 'provider-health',
  score(_task, context) {
    const states = Object.values(context.providerHealth)
    if (states.length === 0) return 0
    return states.some((state) => state !== 'down') ? 0 : null
  },
}

export const DEFAULT_WEIGHTS: Readonly<Record<string, number>> = Object.freeze({
  'blocker-first': 10,
  'bug-priority': 6,
  'mix-quota': 3,
  // 8 > 6: ver o invariante em `starvationGuardPolicy`. Reduzir isto abaixo do
  // peso de `bug-priority` faz tasks de baixa prioridade nunca executarem.
  'starvation-guard': 8,
  'explicit-priority': 2,
  'critical-path': 2,
  'context-locality': 1,
  'restricted-mode': 1,
  'dependency-ready': 1,
  'file-lease': 1,
  'budget-aware': 1,
  'failure-cooldown': 1,
  'wip-limit': 1,
  'provider-health': 1,
})
