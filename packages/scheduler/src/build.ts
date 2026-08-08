import type { Logger, Task, TaskId, TaskQueue } from '@uranus/core'
import { WeightedScheduler } from './scheduler.js'
import {
  DEFAULT_WEIGHTS,
  blockerFirstPolicy,
  budgetAwarePolicy,
  bugPriorityPolicy,
  contextLocalityPolicy,
  criticalPathPolicy,
  dependencyReadyPolicy,
  explicitPriorityPolicy,
  failureCooldownPolicy,
  fileLeasePolicy,
  mixQuotaPolicy,
  providerHealthPolicy,
  restrictedModePolicy,
  starvationGuardPolicy,
  wipLimitPolicy,
} from './policies.js'

export interface SchedulerBuildOptions {
  readonly queue: TaskQueue
  readonly logger: Logger
  readonly weights?: Readonly<Record<string, number>>
  readonly failureCooldownMs?: number
  readonly wipLimit?: number
  /** Estado das tasks, para resolver dependências e caminho crítico. */
  readonly taskState: () => readonly Task[]
  /** `touches` da última task concluída, para localidade de contexto. */
  readonly lastCompletedTouches: () => readonly string[]
}

/**
 * Monta o scheduler com o conjunto completo de políticas.
 *
 * Os pesos vêm da config (`scheduler.weights`) — ajustar prioridade é editar
 * YAML, não recompilar. Peso ausente usa o default; peso 0 desliga a política.
 */
export function buildScheduler(options: SchedulerBuildOptions): WeightedScheduler {
  const scheduler = new WeightedScheduler({ queue: options.queue, logger: options.logger })
  const weights = { ...DEFAULT_WEIGHTS, ...options.weights }
  const weightOf = (id: string): number => weights[id] ?? 1

  const stateOf = (id: string): string | undefined =>
    options.taskState().find((task) => task.id === (id as TaskId))?.state

  const dependentsOf = (id: TaskId): number =>
    options.taskState().filter((task) => task.deps.includes(id)).length

  // Vetos primeiro — a ordem não altera o resultado, mas deixa a explicação
  // legível de cima para baixo.
  scheduler.addPolicy(dependencyReadyPolicy(stateOf), weightOf('dependency-ready'))
  scheduler.addPolicy(fileLeasePolicy, weightOf('file-lease'))
  scheduler.addPolicy(budgetAwarePolicy, weightOf('budget-aware'))
  scheduler.addPolicy(providerHealthPolicy, weightOf('provider-health'))
  scheduler.addPolicy(restrictedModePolicy, weightOf('restricted-mode'))
  scheduler.addPolicy(
    failureCooldownPolicy(options.failureCooldownMs ?? 120_000),
    weightOf('failure-cooldown'),
  )
  scheduler.addPolicy(wipLimitPolicy(options.wipLimit ?? 4), weightOf('wip-limit'))

  scheduler.addPolicy(blockerFirstPolicy, weightOf('blocker-first'))
  scheduler.addPolicy(bugPriorityPolicy, weightOf('bug-priority'))
  scheduler.addPolicy(mixQuotaPolicy, weightOf('mix-quota'))
  scheduler.addPolicy(starvationGuardPolicy(), weightOf('starvation-guard'))
  scheduler.addPolicy(explicitPriorityPolicy, weightOf('explicit-priority'))
  scheduler.addPolicy(criticalPathPolicy(dependentsOf), weightOf('critical-path'))
  scheduler.addPolicy(
    contextLocalityPolicy(options.lastCompletedTouches),
    weightOf('context-locality'),
  )

  return scheduler
}
