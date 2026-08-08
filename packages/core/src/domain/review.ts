import type { TaskId } from '../ids.js'
import type { Glob } from '../util/glob.js'

/**
 * Achados de revisão — como agentes de julgamento convivem com o INV-1.
 *
 * A tensão é real: `Reviewer` e `Security` avaliam código, e avaliação é
 * julgamento. A resolução está na fronteira entre dado e controle:
 *
 *   - o agente produz FINDINGS (dados: severidade, categoria, arquivo, motivo);
 *   - uma política em CÓDIGO decide o que bloqueia.
 *
 * Um agente devolvendo `{ verdict: "aprovado" }` violaria o INV-1 — seria o
 * modelo decidindo o fluxo. Um agente devolvendo `{ severity: "critical" }` e
 * o harness decidindo "critical bloqueia" não viola: a regra é nossa, auditável
 * e a mesma para todos os agentes.
 */

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'

export const SEVERITY_ORDER: readonly FindingSeverity[] = [
  'critical',
  'high',
  'medium',
  'low',
  'info',
]

export function severityRank(severity: FindingSeverity): number {
  return SEVERITY_ORDER.indexOf(severity)
}

/** `true` se `severity` for pelo menos tão grave quanto `threshold`. */
export function isAtLeastAsSevere(severity: FindingSeverity, threshold: FindingSeverity): boolean {
  return severityRank(severity) <= severityRank(threshold)
}

export interface Finding {
  readonly id: string
  readonly severity: FindingSeverity
  /** Slug curto: `sql-injection`, `missing-test`, `naming-convention`. */
  readonly category: string
  readonly title: string
  readonly detail: string
  readonly file?: string
  readonly line?: number
  /** Como corrigir. Vira o `intent` da sub-task de correção. */
  readonly suggestion?: string
}

export interface GateReport {
  readonly agent: string
  readonly findings: readonly Finding[]
  readonly durationMs: number
  /** Decidido pela política do harness, nunca pelo agente. */
  readonly blocked: boolean
  readonly blockingFindings: readonly Finding[]
}

export interface GatePolicy {
  /** Severidade mínima que impede a integração. */
  readonly blockAt: FindingSeverity
  /** Findings não-bloqueantes viram tasks de correção quando >= esta severidade. */
  readonly followUpAt: FindingSeverity
  /** Teto de findings considerados por gate — evita explosão de sub-tasks. */
  readonly maxFindings: number
}

export const DEFAULT_GATE_POLICY: GatePolicy = Object.freeze({
  blockAt: 'high',
  followUpAt: 'medium',
  maxFindings: 20,
})

/**
 * Aplica a política a um conjunto de findings. Função pura — é ela que decide,
 * não o agente.
 */
export function applyGatePolicy(
  agent: string,
  findings: readonly Finding[],
  policy: GatePolicy,
  durationMs: number,
): GateReport {
  const considered = [...findings]
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
    .slice(0, policy.maxFindings)

  const blockingFindings = considered.filter((finding) =>
    isAtLeastAsSevere(finding.severity, policy.blockAt),
  )

  return {
    agent,
    findings: considered,
    durationMs,
    blocked: blockingFindings.length > 0,
    blockingFindings,
  }
}

/** Findings que merecem virar trabalho, mas não impedem a integração agora. */
export function followUpFindings(report: GateReport, policy: GatePolicy): readonly Finding[] {
  return report.findings.filter(
    (finding) =>
      !report.blockingFindings.includes(finding) &&
      isAtLeastAsSevere(finding.severity, policy.followUpAt),
  )
}

/** Escopo de uma sub-task derivada de um finding. */
export function findingTouches(finding: Finding, fallback: readonly Glob[]): readonly Glob[] {
  return finding.file === undefined ? fallback : [finding.file]
}

export interface GateOutcome {
  readonly taskId: TaskId
  readonly reports: readonly GateReport[]
  readonly blocked: boolean
  readonly followUps: readonly Finding[]
}

/** Schema da saída estruturada exigida de todo agente de revisão. */
export const FINDINGS_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      maxItems: 30,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'category', 'title', 'detail'],
        properties: {
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
          category: { type: 'string', pattern: '^[a-z0-9-]{2,40}$' },
          title: { type: 'string', minLength: 5, maxLength: 200 },
          detail: { type: 'string', minLength: 10, maxLength: 2000 },
          file: { type: 'string', maxLength: 300 },
          line: { type: 'integer', minimum: 1 },
          suggestion: { type: 'string', maxLength: 1000 },
        },
      },
    },
  },
})

export interface FindingsOutput {
  readonly findings: readonly Omit<Finding, 'id'>[]
}
