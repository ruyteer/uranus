import type {
  Clock,
  ContextFragment,
  ContextPack,
  ContextPacker,
  ContextRequest,
  ContextSource,
  DroppedFragment,
  FragmentKind,
  Logger,
} from '@uranus/core'
import { DEFAULT_SECTION_BUDGETS, digestOf } from '@uranus/core'

export interface DefaultContextPackerOptions {
  readonly clock: Clock
  readonly logger: Logger
}

/**
 * Empacotador com orçamento por seção (ADR-007).
 *
 * Regras, na ordem em que valem:
 *  1. `pinned` entra sempre, mesmo estourando a seção (mas conta no total).
 *  2. Cada `kind` tem uma fração do orçamento; o que não couber na seção cai
 *     com motivo `section-budget`.
 *  3. O teto global nunca é ultrapassado — nem por pinned: se os pinned sozinhos
 *     estouram o teto, é erro de configuração e o packer corta os não-pinned
 *     inteiros e registra tudo em `dropped`.
 *  4. Dois fragmentos com o mesmo id: vence o de maior prioridade (`duplicate`).
 *  5. O `digest` cobre id+corpo na ordem final — mesmo estado ⇒ mesmo digest.
 */
export class DefaultContextPacker implements ContextPacker {
  private readonly clock: Clock
  private readonly logger: Logger
  private readonly registered: ContextSource[] = []

  constructor(options: DefaultContextPackerOptions) {
    this.clock = options.clock
    this.logger = options.logger.child({ component: 'context-packer' })
  }

  addSource(source: ContextSource): void {
    this.registered.push(source)
  }

  sources(): readonly ContextSource[] {
    return this.registered
  }

  async pack(request: ContextRequest, signal: AbortSignal): Promise<ContextPack> {
    // 1. Coleta de todas as sources (ordem estável por id da source).
    const collected: ContextFragment[] = []
    for (const source of [...this.registered].sort((a, b) => a.id.localeCompare(b.id))) {
      if (signal.aborted) break
      try {
        const fragments = await source.collect(
          {
            project: request.project,
            hints: request.hints,
            ...(request.task === undefined ? {} : { task: request.task }),
          },
          signal,
        )
        collected.push(...fragments)
      } catch (error: unknown) {
        // Uma source quebrada degrada o contexto, não o tick.
        this.logger.warn('ContextSource falhou; seguindo sem ela', {
          source: source.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // 2. Dedupe por id (maior prioridade vence).
    const dropped: DroppedFragment[] = []
    const byId = new Map<string, ContextFragment>()
    for (const fragment of collected) {
      const existing = byId.get(fragment.id)
      if (existing === undefined || fragment.priority > existing.priority) {
        if (existing !== undefined) {
          dropped.push({ id: existing.id, tokens: existing.tokens, reason: 'duplicate' })
        }
        byId.set(fragment.id, fragment)
      } else {
        dropped.push({ id: fragment.id, tokens: fragment.tokens, reason: 'duplicate' })
      }
    }

    // 3. Orçamento por seção.
    const sectionBudgets: Partial<Record<FragmentKind, number>> = {}
    const fractions = { ...DEFAULT_SECTION_BUDGETS, ...request.sectionBudgets }
    for (const [kind, fraction] of Object.entries(fractions) as [FragmentKind, number][]) {
      sectionBudgets[kind] = Math.floor(request.budgetTokens * fraction)
    }

    const mustInclude = new Set(request.mustInclude)
    const ordered = [...byId.values()].sort(rankFragments)
    const sectionUsed: Partial<Record<FragmentKind, number>> = {}
    const kept: ContextFragment[] = []
    let totalUsed = 0

    for (const fragment of ordered) {
      const isPinned = fragment.pinned || mustInclude.has(fragment.id)
      const sectionLimit = sectionBudgets[fragment.kind] ?? Math.floor(request.budgetTokens * 0.1)
      const usedInSection = sectionUsed[fragment.kind] ?? 0

      if (!isPinned && usedInSection + fragment.tokens > sectionLimit) {
        dropped.push({ id: fragment.id, tokens: fragment.tokens, reason: 'section-budget' })
        continue
      }
      if (totalUsed + fragment.tokens > request.budgetTokens) {
        if (isPinned) {
          // Pinned que não cabe no teto GLOBAL é violação de configuração:
          // melhor visível no log do que um pack estourado silenciosamente.
          this.logger.warn('Fragmento pinned excede o orçamento global; descartado', {
            id: fragment.id,
            tokens: fragment.tokens,
          })
        }
        dropped.push({ id: fragment.id, tokens: fragment.tokens, reason: 'budget' })
        continue
      }

      kept.push(fragment)
      sectionUsed[fragment.kind] = usedInSection + fragment.tokens
      totalUsed += fragment.tokens
    }

    // 4. Ordem final estável: seção (kind), depois prioridade, depois id.
    kept.sort(
      (a, b) =>
        kindOrder(a.kind) - kindOrder(b.kind) ||
        b.priority - a.priority ||
        a.id.localeCompare(b.id),
    )

    return {
      fragments: kept,
      tokens: totalUsed,
      budgetTokens: request.budgetTokens,
      dropped,
      digest: digestOf(kept.map((fragment) => ({ id: fragment.id, body: fragment.body }))),
      builtAt: this.clock.now(),
    }
  }
}

function rankFragments(a: ContextFragment, b: ContextFragment): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  if (a.priority !== b.priority) return b.priority - a.priority
  return a.id.localeCompare(b.id)
}

/** Ordem de apresentação no prompt: visão geral → tarefa → memória → código → erro. */
function kindOrder(kind: FragmentKind): number {
  switch (kind) {
    case 'digest':
      return 0
    case 'task':
      return 1
    case 'memory':
      return 2
    case 'doc':
      return 3
    case 'code':
      return 4
    case 'diff':
      return 5
    case 'error':
      return 6
    case 'external':
      return 7
  }
}
