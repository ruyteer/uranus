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
  /**
   * Severidade mínima que impede a integração, ou `'never'` — a cadeia de
   * qualidade roda e registra achados normalmente, mas nunca bloqueia a
   * integração (perfil "advisory": o julgamento vira dado para o humano
   * revisar no dashboard/backlog, não um gate automático).
   */
  readonly blockAt: FindingSeverity | 'never'
  /** Findings não-bloqueantes viram tasks de correção quando >= esta severidade. */
  readonly followUpAt: FindingSeverity
  /** Teto de findings considerados por gate — evita explosão de sub-tasks. */
  readonly maxFindings: number
  /**
   * Geração máxima de task derivada de achado (ver `TaskLineage`).
   *
   * Este é o caso base da recorrência. Com `1`, uma task que o humano pediu
   * pode gerar correções; essas correções são revisadas normalmente, mas seus
   * achados NÃO viram trabalho automático — vão para o backlog. `0` desliga a
   * derivação por completo (achados só informam).
   */
  readonly maxGeneration: number
  /**
   * Teto de tasks derivadas por run, somando todos os gates e todas as tasks.
   *
   * O teto por gate (`maxFindings`) limita a largura de UMA revisão; ele não
   * limita nada quando são 30 revisões no mesmo run. Este limita o run.
   */
  readonly maxFollowUpsPerRun: number
  /**
   * Categorias que nunca viram task automática, só item de backlog.
   *
   * Serve ao caso que motivou tudo isto: o modelo classifica preferência de
   * estilo como "medium" e o harness gasta uma sessão, um worktree e uma PR
   * para renomear uma variável. A categoria vem do agente (dado); a decisão de
   * ignorá-la é nossa (controle) — INV-1 intacto.
   */
  readonly followUpDenyCategories: readonly string[]
}

/**
 * Categorias que, por padrão, informam mas não geram trabalho.
 *
 * Todas são melhorias legítimas — e nenhuma justifica sozinha uma sessão de
 * modelo, um worktree, uma PR e uma revisão própria (que por sua vez gera
 * mais achados). Elas continuam registradas no backlog, onde o humano decide.
 */
export const DEFAULT_FOLLOW_UP_DENY_CATEGORIES: readonly string[] = Object.freeze([
  'naming-convention',
  'naming',
  'readability',
  'style',
  'formatting',
  'code-style',
  'duplication',
  'typo',
  'comment',
  'comments',
  'documentation',
  'docs',
  'scope-violation',
  'scope-gap',
  'nitpick',
])

/**
 * `followUpAt === blockAt` por padrão, e isso é intencional: só vira task
 * automática o achado que de fato impediu a integração. Um achado que não foi
 * grave o bastante para parar o merge não é grave o bastante para gerar uma PR
 * sozinho — ele vai para o backlog, onde custa zero e o humano prioriza.
 * Baixar `followUpAt` para `medium` reativa o comportamento antigo, agora com
 * teto de geração, deduplicação e teto por run como rede de segurança.
 */
export const DEFAULT_GATE_POLICY: GatePolicy = Object.freeze({
  blockAt: 'high',
  followUpAt: 'high',
  maxFindings: 20,
  maxGeneration: 1,
  maxFollowUpsPerRun: 8,
  followUpDenyCategories: DEFAULT_FOLLOW_UP_DENY_CATEGORIES,
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

  const blockAt = policy.blockAt
  const blockingFindings =
    blockAt === 'never'
      ? []
      : considered.filter((finding) => isAtLeastAsSevere(finding.severity, blockAt))

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

// ── Contenção da cadeia de correções ────────────────────────────────────────

/**
 * Identidade estável de um achado.
 *
 * Deliberadamente NÃO inclui a task de origem nem a linha. Não incluir a
 * origem é o que faz "o mesmo problema, apontado de novo na revisão seguinte"
 * ser reconhecido como repetido em vez de virar a décima task idêntica. Não
 * incluir a linha é o que faz a queixa sobreviver a um `git format` — uma
 * linha que anda não é um problema novo.
 */
export function findingFingerprint(finding: Pick<Finding, 'category' | 'title' | 'file'>): string {
  const title = finding.title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return fnv1a(`${finding.category}|${finding.file ?? '*'}|${title}`)
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** Por que um achado não virou task. Vai para o log, o evento e o backlog. */
export type DeferralReason =
  /** A task de origem já é uma correção; a cadeia para aqui. */
  | 'generation'
  /** Esta queixa já tem task (aberta ou concluída). */
  | 'duplicate'
  /** O run já derivou o máximo de tasks permitido. */
  | 'run-budget'
  /** Categoria que, por política, informa mas não gera trabalho. */
  | 'category'
  /** Abaixo de `followUpAt`: registrado, não trabalhado. */
  | 'severity'

export interface DeferredFinding {
  readonly finding: Finding
  readonly fingerprint: string
  readonly reason: DeferralReason
}

/** Achado aprovado para virar task, com a identidade que a task vai carregar. */
export interface SpawnableFinding {
  readonly finding: Finding
  readonly fingerprint: string
}

export interface FollowUpPlan {
  /** Achados que viram task, já com fingerprint calculado. */
  readonly spawn: readonly SpawnableFinding[]
  /** Achados que viram item de backlog, com o motivo. */
  readonly deferred: readonly DeferredFinding[]
}

export interface FollowUpContext {
  /** Revisão de UM gate, já com a política de bloqueio aplicada. */
  readonly report: GateReport
  /** Geração que as tasks derivadas teriam (`taskGeneration(origem) + 1`). */
  readonly generation: number
  readonly policy: GatePolicy
  /** Fingerprints que já viraram task alguma vez, neste run ou em runs passados. */
  readonly known: ReadonlySet<string>
  /** Quantas tasks derivadas ainda cabem neste run. */
  readonly remaining: number
}

/**
 * Decide, sem consultar modelo nenhum, quais achados viram trabalho.
 *
 * Todo achado sai daqui classificado: ou vira task, ou vira registro com o
 * motivo. Nada evapora — e isso é o que torna a contenção aceitável. "Derive
 * tudo" era a escolha errada por excesso de zelo: o medo legítimo de perder
 * um achado levou a um sistema em que a fila crescia mais rápido do que
 * drenava. O registro resolve o medo sem pagar o preço.
 *
 * Os cortes, nesta ordem — a ordem importa porque o motivo gravado é o
 * primeiro que se aplica, e é ele que o humano lê no backlog:
 *
 *  1. **Geração.** Correção de correção não gera correção. É o caso base: sem
 *     ele a árvore não tem profundidade máxima e o run não termina.
 *  2. **Severidade.** Abaixo de `followUpAt` o achado informa, não emprega.
 *  3. **Categoria.** Preferência de estilo informa, não emprega.
 *  4. **Duplicata.** A mesma queixa nunca vira duas tasks — inclusive entre
 *     runs, porque o fingerprint fica gravado na task derivada.
 *  5. **Orçamento do run.** Teto duro, somando todos os gates e todas as
 *     tasks do run.
 *
 * Bloqueantes escapam do corte 3: um achado grave o bastante para parar o
 * merge precisa de correção rastreável, mesmo que o agente tenha escolhido um
 * slug de categoria ruim. Não escapam dos outros.
 */
export function planFollowUps(context: FollowUpContext): FollowUpPlan {
  const { policy, report } = context
  const spawn: SpawnableFinding[] = []
  const deferred: DeferredFinding[] = []
  const deny = new Set(policy.followUpDenyCategories.map((c) => c.toLowerCase()))
  // Cópia local: dois gates da mesma revisão podem relatar o mesmo problema, e
  // o segundo precisa enxergar o que o primeiro acabou de reservar.
  const seen = new Set(context.known)
  let remaining = context.remaining

  const blocking = new Set(report.blockingFindings)

  for (const finding of report.findings) {
    const isBlocking = blocking.has(finding)
    const fingerprint = findingFingerprint(finding)
    const defer = (reason: DeferralReason): void => {
      // `info` é, por definição da escala, "observação sem ação necessária".
      // Registrar isso como item de backlog transformaria o backlog em ruído,
      // que é a mesma doença numa outra fila. Fica no log de eventos.
      if (finding.severity === 'info') return
      deferred.push({ finding, fingerprint, reason })
    }

    if (context.generation > policy.maxGeneration) {
      defer('generation')
      continue
    }
    if (!isBlocking && !isAtLeastAsSevere(finding.severity, policy.followUpAt)) {
      defer('severity')
      continue
    }
    if (!isBlocking && deny.has(finding.category.toLowerCase())) {
      defer('category')
      continue
    }
    if (seen.has(fingerprint)) {
      defer('duplicate')
      continue
    }
    if (remaining <= 0) {
      defer('run-budget')
      continue
    }

    seen.add(fingerprint)
    remaining -= 1
    spawn.push({ finding, fingerprint })
  }

  return { spawn, deferred }
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
