import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  ContextFragment,
  ContextPack,
  ContextPacker,
  ContextRequest,
  ContextSource,
  Clock,
} from '@uranus/core'
import {
  createMatcher,
  digestOf,
  estimateTokens,
  literalPrefix,
  truncateMiddle,
} from '@uranus/core'

/**
 * ContextPacker mínimo do MVP (Fase 2).
 *
 * Contexto explícito e pequeno: os arquivos que casam com `task.touches`, mais
 * nada. Sem descoberta automática — isso é a Fase 3. O que já vale desde já:
 * orçamento respeitado, `dropped` registrado e `digest` determinístico (ADR-007).
 *
 * Conteúdo de arquivo do repositório entra como `untrusted: true` (INV-6).
 */
export class MinimalContextPacker implements ContextPacker {
  private readonly extraSources: ContextSource[] = []

  constructor(private readonly clock: Clock) {}

  addSource(source: ContextSource): void {
    this.extraSources.push(source)
  }

  sources(): readonly ContextSource[] {
    return this.extraSources
  }

  async pack(request: ContextRequest, signal: AbortSignal): Promise<ContextPack> {
    const fragments: ContextFragment[] = []
    const dropped: { id: string; tokens: number; reason: 'budget' }[] = []
    let used = 0
    const budget = request.budgetTokens

    const push = (fragment: ContextFragment): void => {
      if (!fragment.pinned && used + fragment.tokens > budget) {
        dropped.push({ id: fragment.id, tokens: fragment.tokens, reason: 'budget' })
        return
      }
      fragments.push(fragment)
      used += fragment.tokens
    }

    // Arquivos do escopo da task, do maior interesse (prefixo literal mais
    // específico primeiro), truncados individualmente.
    const task = request.task
    if (task !== undefined && task.touches.length > 0) {
      const files = await this.collectScopeFiles(request.project.rootDir, task.touches, signal)
      for (const file of files) {
        const body = truncateMiddle(file.content, 24_000)
        push({
          id: `code:${file.path}`,
          sourceId: 'minimal',
          kind: 'code',
          title: `Arquivo: ${file.path}`,
          body,
          tokens: estimateTokens(body, 'code'),
          priority: 60,
          pinned: false,
          untrusted: true, // INV-6
          refs: [],
        })
      }
    }

    for (const source of this.extraSources) {
      const collected = await source.collect(
        { project: request.project, hints: request.hints, ...(task === undefined ? {} : { task }) },
        signal,
      )
      for (const fragment of collected) push(fragment)
    }

    return {
      fragments,
      tokens: used,
      budgetTokens: budget,
      dropped,
      digest: digestOf(fragments.map((f) => ({ id: f.id, body: f.body }))),
      builtAt: this.clock.now(),
    }
  }

  private async collectScopeFiles(
    rootDir: string,
    touches: readonly string[],
    _signal: AbortSignal,
  ): Promise<readonly { path: string; content: string }[]> {
    const matcher = createMatcher(touches)
    const roots = [...new Set(touches.map((glob) => literalPrefix(glob)).filter((p) => p !== ''))]
    const files: { path: string; content: string }[] = []
    const MAX_FILES = 12

    const walk = async (relDir: string): Promise<void> => {
      if (files.length >= MAX_FILES) return
      const { readdir } = await import('node:fs/promises')
      let entries
      try {
        entries = await readdir(join(rootDir, relDir), { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (files.length >= MAX_FILES) return
        const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.uranus') {
            continue
          }
          await walk(rel)
        } else if (matcher(rel)) {
          try {
            const content = await readFile(join(rootDir, rel), 'utf8')
            files.push({ path: rel, content })
          } catch {
            /* binário ou ilegível: pula */
          }
        }
      }
    }

    for (const root of roots.length > 0 ? roots : ['']) {
      await walk(root)
    }
    return files
  }
}
