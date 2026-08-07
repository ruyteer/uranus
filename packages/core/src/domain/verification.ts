import type { CheckKind } from './acceptance.js'

/**
 * Resultado da verificação. Imutável e preservado no event log — é a evidência
 * de que o INV-2 foi cumprido, e o que permite auditar uma task `done` meses depois.
 */

export interface CheckResult {
  readonly checkId: string
  readonly kind: CheckKind
  readonly passed: boolean
  readonly advisory: boolean
  readonly durationMs: number
  readonly exitCode?: number
  /** Truncado no meio (início + fim). O bruto fica em `runs/<runId>/`. */
  readonly stdout?: string
  readonly stderr?: string
  readonly detail?: Readonly<Record<string, unknown>>
}

export interface Verification {
  readonly passed: boolean
  readonly results: readonly CheckResult[]
  readonly durationMs: number
  readonly diagnosis?: Diagnosis
}

/**
 * Categorias de falha.
 *
 * R3 (loop de correção infinito) depende disto: a `RetryPolicy` decide entre
 * repetir, escalar para outro agente ou replanejar a partir da *categoria*, não
 * de heurística sobre texto de erro. Mesma categoria repetida ⇒ escalar, porque
 * tentar de novo o que já falhou do mesmo jeito é a definição do loop.
 */
export type DiagnosisCategory =
  | 'compile-error'
  | 'type-error'
  | 'test-failure'
  | 'lint-failure'
  | 'coverage-shortfall'
  | 'no-changes'
  | 'out-of-scope'
  | 'timeout'
  | 'budget'
  | 'permission-denied'
  | 'provider-error'
  | 'conflict'
  | 'interrupted'
  | 'schema-mismatch'
  | 'unknown'

export type SuggestedAction = 'retry' | 'retry-with-context' | 'escalate' | 'replan' | 'block'

export interface Evidence {
  readonly kind: 'stdout' | 'stderr' | 'file' | 'diff' | 'event'
  readonly ref: string
  readonly excerpt: string
}

export interface Diagnosis {
  readonly category: DiagnosisCategory
  readonly summary: string
  readonly evidence: readonly Evidence[]
  readonly suggestedAction: SuggestedAction
  readonly suggestedAgent?: string
}

/**
 * Categorias em que repetir o mesmo agente com o mesmo contexto não tem chance
 * de mudar o resultado.
 */
const NON_RETRYABLE: ReadonlySet<DiagnosisCategory> = new Set([
  'budget',
  'permission-denied',
  'conflict',
])

export function isRetryableCategory(category: DiagnosisCategory): boolean {
  return !NON_RETRYABLE.has(category)
}

export function passedBlocking(verification: Verification): boolean {
  return verification.results.every((r) => r.advisory || r.passed)
}

export function failedChecks(verification: Verification): readonly CheckResult[] {
  return verification.results.filter((r) => !r.passed && !r.advisory)
}

export const PASSED_VERIFICATION: Verification = Object.freeze({
  passed: true,
  results: Object.freeze([]),
  durationMs: 0,
})
