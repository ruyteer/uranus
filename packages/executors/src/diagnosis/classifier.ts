import type {
  CheckResult,
  Diagnosis,
  DiagnosisCategory,
  Evidence,
  SuggestedAction,
  Task,
  Verification,
} from '@uranus/core'
import { truncateMiddle } from '@uranus/core'

/**
 * Classificador determinístico de falha (R3).
 *
 * A `RetryPolicy` decide retry/escalate/replan a partir da **categoria**, nunca
 * de heurística sobre texto livre. Este é o único lugar que olha para o texto —
 * e produz uma categoria estável, com a evidência anexada.
 */

interface Pattern {
  readonly category: DiagnosisCategory
  readonly test: RegExp
}

// Ordem importa: o primeiro que casa vence. Padrões mais específicos primeiro.
const STDERR_PATTERNS: readonly Pattern[] = [
  { category: 'type-error', test: /\bTS\d{4,5}\b|type error|TypeError: .* is not assignable/i },
  {
    category: 'compile-error',
    test: /SyntaxError|ParseError|compilation failed|cannot find module|ERR_MODULE_NOT_FOUND/i,
  },
  { category: 'lint-failure', test: /eslint|\d+ problems? \(\d+ errors?/i },
  { category: 'test-failure', test: /\d+ (failed|failing)|AssertionError|expect\(.*\)\./i },
  { category: 'permission-denied', test: /EACCES|EPERM|permission denied/i },
  { category: 'conflict', test: /merge conflict|CONFLICT \(/i },
]

export function categorizeCheck(result: CheckResult): DiagnosisCategory {
  const detail = result.detail ?? {}

  if (detail['timedOut'] === true) return 'timeout'
  if (typeof detail['skipped'] === 'string') return 'unknown'

  if (result.kind === 'diff') {
    const problems = detail['problems']
    const text = Array.isArray(problems) ? problems.join(' ') : ''
    if (text.includes('diff vazio')) return 'no-changes'
    if (text.includes('fora do escopo') || text.includes('proibidos')) return 'out-of-scope'
    return 'out-of-scope'
  }
  if (result.kind === 'schema') return 'schema-mismatch'
  if (result.kind === 'coverage') return 'coverage-shortfall'
  if (result.kind === 'tests') return 'test-failure'

  const text = `${result.stderr ?? ''}\n${result.stdout ?? ''}`
  for (const pattern of STDERR_PATTERNS) {
    if (pattern.test.test(text)) return pattern.category
  }
  if (result.exitCode === 127) return 'compile-error' // comando não encontrado
  return 'unknown'
}

function actionFor(category: DiagnosisCategory, task: Task): SuggestedAction {
  switch (category) {
    case 'budget':
    case 'permission-denied':
    case 'conflict':
      return 'block'
    case 'no-changes':
      // O modelo não fez nada: repetir com o mesmo contexto repetiria o nada.
      return 'retry-with-context'
    case 'out-of-scope':
      // Escopo errado sistematicamente é problema do plano, não da execução.
      return task.attempts >= 1 ? 'replan' : 'retry-with-context'
    case 'timeout':
      return 'retry'
    default:
      return 'retry-with-context'
  }
}

export function diagnose(verification: Verification, task: Task): Diagnosis {
  const failed = verification.results.filter((r) => !r.passed && !r.advisory)
  const primary = failed[0]

  if (primary === undefined) {
    return {
      category: 'unknown',
      summary: 'Verificação reprovada sem check reprovado identificável',
      evidence: [],
      suggestedAction: 'block',
    }
  }

  const category = categorizeCheck(primary)
  const evidence: Evidence[] = []
  for (const result of failed.slice(0, 3)) {
    if (result.stderr !== undefined && result.stderr.trim().length > 0) {
      evidence.push({
        kind: 'stderr',
        ref: result.checkId,
        excerpt: truncateMiddle(result.stderr, 2_000),
      })
    } else if (result.stdout !== undefined && result.stdout.trim().length > 0) {
      evidence.push({
        kind: 'stdout',
        ref: result.checkId,
        excerpt: truncateMiddle(result.stdout, 2_000),
      })
    } else if (result.detail !== undefined) {
      evidence.push({
        kind: 'event',
        ref: result.checkId,
        excerpt: truncateMiddle(JSON.stringify(result.detail), 1_000),
      })
    }
  }

  const failedIds = failed.map((r) => `${r.kind}:${r.checkId}`).join(', ')
  return {
    category,
    summary: `${String(failed.length)} check(s) reprovaram (${failedIds}); categoria primária: ${category}`,
    evidence,
    suggestedAction: actionFor(category, task),
  }
}
