import type { AttemptId, SessionId, TaskId, WorkspaceId } from '../ids.js'
import type { Money, TokenUsage } from './usage.js'
import type { Diagnosis, DiagnosisCategory, Verification } from './verification.js'
import type { DiffSummary } from './vcs.js'

/**
 * Uma tentativa de executar uma task. Attempts são **imutáveis e acumulam** —
 * nunca são sobrescritos por uma nova tentativa.
 *
 * O motivo é o R3: para decidir entre repetir, escalar e replanejar, o kernel
 * precisa saber *como* as tentativas anteriores falharam. Guardar só a última
 * transforma um loop de oscilação em algo invisível.
 */
export interface Attempt {
  readonly id: AttemptId
  readonly taskId: TaskId
  readonly n: number
  readonly agent: string
  readonly provider: string
  readonly model: string
  /** Prova de qual contexto o agente recebeu (ADR-007). */
  readonly contextDigest: string
  readonly workspaceId: WorkspaceId
  readonly startedAt: number
  readonly finishedAt?: number
  readonly outcome?: AttemptOutcome
  readonly usage: TokenUsage
  readonly cost: Money
}

export interface AttemptOutcome {
  readonly status: 'verified' | 'failed' | 'interrupted' | 'aborted'
  readonly verification?: Verification
  readonly diagnosis?: Diagnosis
  readonly diff?: DiffSummary
  /** Hash do diff — detecta oscilação entre tentativas (R3). */
  readonly diffDigest?: string
}

export interface AgentRun {
  readonly sessionId: SessionId
  readonly attemptId: AttemptId
  readonly agent: string
  readonly provider: string
  readonly model: string
  readonly startedAt: number
  readonly finishedAt?: number
  readonly turns: number
  readonly usage: TokenUsage
  readonly cost: Money
  readonly status: 'completed' | 'interrupted' | 'error' | 'limit_reached'
}

/** Categorias de falha vistas nas tentativas anteriores, na ordem em que ocorreram. */
export function failureHistory(attempts: readonly Attempt[]): readonly DiagnosisCategory[] {
  return attempts
    .map((a) => a.outcome?.diagnosis?.category)
    .filter((c): c is DiagnosisCategory => c !== undefined)
}

/** R3: o agente está produzindo o mesmo diff repetidamente? */
export function isOscillating(attempts: readonly Attempt[]): boolean {
  const digests = attempts
    .map((a) => a.outcome?.diffDigest)
    .filter((d): d is string => d !== undefined)
  if (digests.length < 2) return false
  return new Set(digests).size < digests.length
}

/** A última categoria se repetiu? Dispara escalada para outro agente. */
export function repeatedLastCategory(attempts: readonly Attempt[]): boolean {
  const history = failureHistory(attempts)
  if (history.length < 2) return false
  return history[history.length - 1] === history[history.length - 2]
}
