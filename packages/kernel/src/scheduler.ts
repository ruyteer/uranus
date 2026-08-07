import type {
  PolicyContribution,
  Scheduler,
  SchedulerPolicy,
  SchedulingContext,
  SchedulingExplanation,
  Task,
  TaskQueue,
} from '@uranus/core'

/**
 * Scheduler da Fase 2 — priorização mínima, contrato completo.
 *
 * Políticas embutidas: blockers/bugs primeiro, cooldown pós-falha, FIFO por
 * idade. A Fase 4 substitui por `@uranus/scheduler` com o conjunto inteiro;
 * o kernel não muda uma linha porque o contrato é o mesmo.
 */
export class SimpleScheduler implements Scheduler {
  private readonly policies: { policy: SchedulerPolicy; weight: number }[] = []

  constructor(
    private readonly queue: TaskQueue,
    private readonly failureCooldownMs = 60_000,
  ) {
    this.addPolicy(bugFirstPolicy, 6)
    this.addPolicy(agePolicy, 1)
    this.addPolicy(failureCooldownPolicy(failureCooldownMs), 2)
  }

  addPolicy(policy: SchedulerPolicy, weight: number): void {
    this.policies.push({ policy, weight })
  }

  async next(context: SchedulingContext, _signal: AbortSignal): Promise<Task | null> {
    const eligible = await this.queue.eligible(context)
    if (eligible.length === 0) return null

    let best: Task | null = null
    let bestScore = Number.NEGATIVE_INFINITY
    for (const task of eligible) {
      const { total, vetoed } = this.score(task, context)
      if (vetoed) continue
      if (total > bestScore) {
        bestScore = total
        best = task
      }
    }
    return best
  }

  explain(task: Task, context: SchedulingContext): SchedulingExplanation {
    const contributions: PolicyContribution[] = []
    const vetoedBy: string[] = []
    let total = 0

    for (const { policy, weight } of this.policies) {
      const raw = policy.score(task, context)
      const weighted = raw === null ? 0 : raw * weight
      contributions.push({ policyId: policy.id, raw, weight, weighted })
      if (raw === null) vetoedBy.push(policy.id)
      else total += weighted
    }

    return {
      taskId: task.id,
      eligible: vetoedBy.length === 0,
      total,
      contributions,
      vetoedBy,
    }
  }

  private score(task: Task, context: SchedulingContext): { total: number; vetoed: boolean } {
    let total = 0
    for (const { policy, weight } of this.policies) {
      const raw = policy.score(task, context)
      if (raw === null) return { total: 0, vetoed: true }
      total += raw * weight
    }
    return { total, vetoed: false }
  }
}

const bugFirstPolicy: SchedulerPolicy = {
  id: 'bug-first',
  score(task) {
    if (task.kind === 'bugfix' || task.kind === 'security') return 10
    if (task.kind === 'feature') return 5
    return 3
  },
}

const agePolicy: SchedulerPolicy = {
  id: 'age',
  score(task, context) {
    // Boost linear por idade em horas, com teto — evita inanição sem inverter
    // completamente a prioridade por tipo.
    const hours = Math.max(0, (context.now - task.createdAt) / 3_600_000)
    return Math.min(10, hours)
  },
}

function failureCooldownPolicy(cooldownMs: number): SchedulerPolicy {
  return {
    id: 'failure-cooldown',
    score(task, context) {
      const lastFailure = context.recentOutcomes.find(
        (outcome) => outcome.taskId === task.id && outcome.status === 'failed',
      )
      if (lastFailure !== undefined && context.now - lastFailure.at < cooldownMs) {
        // Veto temporário: falhou agora há pouco, dê espaço para outras tasks
        // (e evite o hot-loop do R3 no nível do scheduler também).
        return null
      }
      return 0
    },
  }
}
