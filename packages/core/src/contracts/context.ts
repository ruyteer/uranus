import type { ProjectRef } from '../domain/project.js'
import type {
  ContextFragment,
  ContextPack,
  FragmentKind,
  ProjectDigest,
  SectionBudgets,
} from '../domain/context.js'
import type { Task } from '../domain/task.js'
import type { AgentSpec } from './agent.js'

export interface CollectInput {
  readonly project: ProjectRef
  readonly task?: Task
  readonly hints: readonly string[]
}

export interface ContextSource {
  readonly id: string
  /** Guia o packer sobre quando vale coletar. `expensive` só sob demanda. */
  readonly cost: 'cheap' | 'moderate' | 'expensive'
  readonly kinds: readonly FragmentKind[]

  collect(input: CollectInput, signal: AbortSignal): Promise<readonly ContextFragment[]>

  /**
   * Chave de frescor. Se mudou, o cache desta source é invalidado.
   * Tipicamente: HEAD + hash de lockfiles + hash de configs relevantes.
   */
  freshness(input: CollectInput, signal: AbortSignal): Promise<string>
}

export interface ContextRequest {
  readonly budgetTokens: number
  readonly sectionBudgets: SectionBudgets
  readonly agent: AgentSpec
  readonly task?: Task
  readonly project: ProjectRef
  /** Ids de fragmentos que não podem ser descartados. */
  readonly mustInclude: readonly string[]
  readonly hints: readonly string[]
}

/**
 * Montagem com orçamento (ADR-007).
 *
 * Não existe concatenação ad-hoc no Uranus. O packer recebe um teto em tokens e
 * produz um pack determinístico com `digest` e lista do que foi descartado —
 * o que torna "context rot" (R8) um problema mensurável em vez de uma suspeita.
 */
export interface ContextPacker {
  pack(request: ContextRequest, signal: AbortSignal): Promise<ContextPack>
  addSource(source: ContextSource): void
  sources(): readonly ContextSource[]
}

export interface ContextManager {
  /** Reconstrói o entendimento do projeto do zero. Roda no `project attach`. */
  bootstrap(project: ProjectRef, signal: AbortSignal): Promise<ProjectDigest>
  digest(project: ProjectRef): Promise<ProjectDigest | undefined>
  /** `true` se o `FreshnessKey` mudou desde a última geração. */
  isStale(project: ProjectRef, signal: AbortSignal): Promise<boolean>
  invalidate(sourceId?: string): void
}
