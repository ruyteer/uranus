import type {
  Logger,
  PolicyContribution,
  Scheduler,
  SchedulerPolicy,
  SchedulingContext,
  SchedulingExplanation,
  Task,
  TaskQueue,
} from '@uranus/core'

export interface WeightedSchedulerOptions {
  readonly queue: TaskQueue
  readonly logger: Logger
}

/**
 * Scheduler multi-critério.
 *
 * `score(task) = Σ policy_i(task) × weight_i`, com veto incompensável: qualquer
 * política que retorne `null` torna a task inelegível, independentemente do
 * quanto as outras somem. É o que impede uma task com prioridade altíssima de
 * atropelar uma dependência não satisfeita ou um lease de arquivo.
 *
 * Desempate estável por id — duas execuções com o mesmo estado escolhem a mesma
 * task, o que é pré-requisito para o teste de caos ser reproduzível.
 */
export class WeightedScheduler implements Scheduler {
  private readonly entries: { policy: SchedulerPolicy; weight: number }[] = []
  private readonly queue: TaskQueue
  private readonly logger: Logger

  constructor(options: WeightedSchedulerOptions) {
    this.queue = options.queue
    this.logger = options.logger.child({ component: 'scheduler' })
  }

  addPolicy(policy: SchedulerPolicy, weight: number): void {
    if (weight === 0) return // peso zero = política desligada na config
    this.entries.push({ policy, weight })
  }

  get policyCount(): number {
    return this.entries.length
  }

  async next(context: SchedulingContext, _signal: AbortSignal): Promise<Task | null> {
    const eligible = await this.queue.eligible(context)
    if (eligible.length === 0) return null

    let best: Task | null = null
    let bestScore = Number.NEGATIVE_INFINITY

    for (const task of eligible) {
      const explanation = this.explain(task, context)
      if (!explanation.eligible) continue
      if (
        explanation.total > bestScore ||
        (explanation.total === bestScore && best !== null && task.id < best.id)
      ) {
        bestScore = explanation.total
        best = task
      }
    }

    if (best !== null) {
      this.logger.debug('Task selecionada', {
        taskId: best.id,
        score: Math.round(bestScore * 100) / 100,
        candidates: eligible.length,
      })
    }
    return best
  }

  /**
   * Por que ESTA task e não outra. Alimenta `uranus task why` e o dashboard —
   * um scheduler cujas decisões não podem ser auditadas é indistinguível de um
   * scheduler com bug.
   */
  explain(task: Task, context: SchedulingContext): SchedulingExplanation {
    const contributions: PolicyContribution[] = []
    const vetoedBy: string[] = []
    let total = 0

    for (const { policy, weight } of this.entries) {
      let raw: number | null
      try {
        raw = policy.score(task, context)
      } catch (error: unknown) {
        // Política com bug não pode derrubar o ciclo nem vetar por omissão.
        this.logger.warn('Política de scheduling falhou; tratada como neutra', {
          policy: policy.id,
          error: error instanceof Error ? error.message : String(error),
        })
        raw = 0
      }
      const weighted = raw === null ? 0 : raw * weight
      contributions.push({ policyId: policy.id, raw, weight, weighted })
      if (raw === null) vetoedBy.push(policy.id)
      else total += weighted
    }

    return {
      taskId: task.id,
      eligible: vetoedBy.length === 0,
      total: Math.round(total * 1000) / 1000,
      contributions: contributions.sort((a, b) => b.weighted - a.weighted),
      vetoedBy,
    }
  }

  /** Ranking completo, para depuração e para o dashboard. */
  async rank(
    context: SchedulingContext,
  ): Promise<readonly { task: Task; explanation: SchedulingExplanation }[]> {
    const eligible = await this.queue.eligible(context)
    return eligible
      .map((task) => ({ task, explanation: this.explain(task, context) }))
      .sort((a, b) => {
        if (a.explanation.eligible !== b.explanation.eligible) {
          return a.explanation.eligible ? -1 : 1
        }
        return b.explanation.total - a.explanation.total || a.task.id.localeCompare(b.task.id)
      })
  }
}

/** Formata a explicação para o terminal. */
export function formatExplanation(explanation: SchedulingExplanation, title: string): string {
  const lines: string[] = [
    title,
    `  elegível : ${explanation.eligible ? 'sim' : `NÃO (vetada por ${explanation.vetoedBy.join(', ')})`}`,
    `  score    : ${explanation.total.toFixed(2)}`,
  ]
  for (const contribution of explanation.contributions) {
    const raw = contribution.raw === null ? 'VETO' : contribution.raw.toFixed(1)
    lines.push(
      `    ${contribution.policyId.padEnd(20)} ${raw.padStart(5)} × ${String(contribution.weight).padStart(2)} = ${contribution.weighted.toFixed(2)}`,
    )
  }
  return lines.join('\n')
}
