import type { CodeRef } from './memory.js'

export type FragmentKind =
  'digest' | 'code' | 'memory' | 'task' | 'diff' | 'doc' | 'error' | 'external'

export const FRAGMENT_KINDS: readonly FragmentKind[] = [
  'digest',
  'code',
  'memory',
  'task',
  'diff',
  'doc',
  'error',
  'external',
]

export interface ContextFragment {
  readonly id: string
  readonly sourceId: string
  readonly kind: FragmentKind
  readonly title: string
  readonly body: string
  readonly tokens: number
  /** 0..100. Entra no ranqueamento; não é ordem de inserção. */
  readonly priority: number
  /** Nunca descartado pelo orçamento. Use com parcimônia. */
  readonly pinned: boolean
  /**
   * INV-6 — conteúdo não-confiável.
   *
   * Tudo que vem do repositório, de issues, de logs ou da web é **dado**. O packer
   * encapsula fragmentos marcados assim, e nenhuma instrução dentro deles altera
   * o fluxo. É a defesa contra prompt injection (R7).
   */
  readonly untrusted: boolean
  readonly refs: readonly CodeRef[]
}

export interface DroppedFragment {
  readonly id: string
  readonly tokens: number
  readonly reason: 'budget' | 'section-budget' | 'duplicate' | 'stale'
}

export interface ContextPack {
  readonly fragments: readonly ContextFragment[]
  readonly tokens: number
  readonly budgetTokens: number
  readonly dropped: readonly DroppedFragment[]
  /**
   * Hash determinístico do conteúdo. Dois runs com o mesmo digest receberam
   * exatamente o mesmo contexto — o que torna comparações de qualidade de prompt
   * cientificamente válidas em vez de anedóticas (ADR-007).
   */
  readonly digest: string
  readonly builtAt: number
}

export type SectionBudgets = Readonly<Partial<Record<FragmentKind, number>>>

export const DEFAULT_SECTION_BUDGETS: SectionBudgets = Object.freeze({
  digest: 0.15,
  code: 0.4,
  memory: 0.2,
  task: 0.15,
  error: 0.1,
})

export interface ProjectDigest {
  readonly languages: readonly { name: string; loc: number; share: number }[]
  readonly frameworks: readonly string[]
  readonly architecture: {
    readonly style: string
    readonly layers: readonly string[]
    readonly entrypoints: readonly string[]
  }
  readonly dependencies: {
    readonly direct: number
    readonly outdated: number
    readonly vulnerable: number
  }
  readonly tests: {
    readonly runner?: string
    readonly command?: string
    readonly count?: number
    readonly coverage?: number
  }
  readonly ci: { readonly provider?: string; readonly requiredChecks: readonly string[] }
  readonly database: {
    readonly engine?: string
    readonly orm?: string
    readonly migrations?: string
  }
  readonly docs: readonly string[]
  readonly conventions: readonly string[]
  readonly vcs: { readonly defaultBranch: string; readonly commitStyle?: string }
  readonly summary: string
  /** Chave de frescor: HEAD + hash dos lockfiles + hash dos configs. */
  readonly freshness: string
  readonly generatedAt: number
}

/**
 * Força do sinal de verificação disponível no projeto (0..100) — R4.
 *
 * Abaixo do limiar mínimo o Uranus entra em modo restrito: só aceita tasks do
 * tipo `test`, porque autonomia sem verificação é geração de código não-verificado.
 */
export const MIN_VERIFICATION_SIGNAL = 30

export function verificationSignalStrength(digest: ProjectDigest): number {
  let score = 0
  if (digest.tests.runner !== undefined && digest.tests.command !== undefined) score += 40
  if ((digest.tests.count ?? 0) > 0) score += 20
  if ((digest.tests.coverage ?? 0) >= 0.5) score += 15
  if (digest.ci.provider !== undefined) score += 15
  if (digest.ci.requiredChecks.length > 0) score += 10
  return Math.min(100, score)
}

export function isRestrictedMode(digest: ProjectDigest): boolean {
  return verificationSignalStrength(digest) < MIN_VERIFICATION_SIGNAL
}
