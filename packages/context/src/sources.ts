import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ContextFragment, ContextManager, ContextSource, MemoryStore } from '@uranus/core'
import {
  createMatcher,
  estimateTokens,
  hashText,
  literalPrefix,
  truncateMiddle,
} from '@uranus/core'

/**
 * Sources de fragmento do pack. Convenção de confiança (INV-6):
 *  - digest/memória: gerados pelo próprio Uranus → confiáveis;
 *  - conteúdo de ARQUIVO do repositório e docs: `untrusted: true`, sempre —
 *    é exatamente onde uma prompt injection viveria.
 */

export function digestSource(manager: ContextManager): ContextSource {
  return {
    id: 'digest',
    cost: 'cheap',
    kinds: ['digest'],
    async collect(input, _signal): Promise<readonly ContextFragment[]> {
      const digest = await manager.digest(input.project)
      if (digest === undefined) return []
      return [
        {
          id: 'digest:summary',
          sourceId: 'digest',
          kind: 'digest',
          title: 'Resumo do projeto',
          body: digest.summary,
          tokens: estimateTokens(digest.summary),
          priority: 90,
          pinned: true,
          untrusted: false,
          refs: [],
        },
        {
          id: 'digest:conventions',
          sourceId: 'digest',
          kind: 'digest',
          title: 'Convenções e estrutura',
          body: [
            digest.conventions.length > 0
              ? `Arquivos de convenção: ${digest.conventions.join(', ')}`
              : 'Sem arquivos de convenção detectados.',
            digest.architecture.entrypoints.length > 0
              ? `Entrypoints: ${digest.architecture.entrypoints.join(', ')}`
              : '',
            digest.vcs.commitStyle === undefined
              ? ''
              : `Estilo de commit: ${digest.vcs.commitStyle}`,
          ]
            .filter((line) => line !== '')
            .join('\n'),
          tokens: 80,
          priority: 60,
          pinned: false,
          untrusted: false,
          refs: [],
        },
      ]
    },
    async freshness(input, _signal): Promise<string> {
      const digest = await manager.digest(input.project)
      return digest?.freshness ?? 'none'
    },
  }
}

export function memorySource(store: MemoryStore): ContextSource {
  return {
    id: 'memory',
    cost: 'cheap',
    kinds: ['memory'],
    async collect(input, _signal): Promise<readonly ContextFragment[]> {
      const text = [input.task?.title ?? '', input.task?.intent ?? '', ...input.hints]
        .join(' ')
        .trim()
      const relevant = await store.query({
        scopes: ['convention', 'pattern', 'stack', 'decision', 'bug', 'architecture'],
        ...(text === '' ? {} : { text }),
        minConfidence: 0.3,
        limit: 8,
      })
      // Busca vazia com texto: cai para os registros de maior confiança.
      const records =
        relevant.length > 0
          ? relevant
          : await store.query({
              scopes: ['convention', 'pattern', 'stack'],
              minConfidence: 0.5,
              limit: 4,
            })

      return records.map((record) => ({
        id: `memory:${record.id}`,
        sourceId: 'memory',
        kind: 'memory' as const,
        title: `Memória [${record.scope}]: ${record.title}`,
        body: truncateMiddle(record.body, 4_000),
        tokens: estimateTokens(record.body.slice(0, 4_000)),
        priority: 50 + Math.round(record.confidence * 30),
        pinned: false,
        // Memória curada pelo Uranus é confiável; memória importada não.
        untrusted: record.source.kind === 'imported',
        refs: [...record.refs],
      }))
    },
    freshness(_input, _signal): Promise<string> {
      return Promise.resolve(String(Date.now())) // memória muda dentro do run; sem cache
    },
  }
}

export interface CodeSourceOptions {
  readonly maxFiles?: number
  readonly maxCharsPerFile?: number
}

/** Arquivos do escopo (`task.touches`) — SEMPRE `untrusted` (INV-6). */
export function codeSource(options: CodeSourceOptions = {}): ContextSource {
  const maxFiles = options.maxFiles ?? 12
  const maxChars = options.maxCharsPerFile ?? 24_000

  return {
    id: 'code',
    cost: 'moderate',
    kinds: ['code'],
    async collect(input, signal): Promise<readonly ContextFragment[]> {
      const task = input.task
      if (task === undefined || task.touches.length === 0) return []

      const matcher = createMatcher(task.touches)
      const roots = [
        ...new Set(task.touches.map((glob) => literalPrefix(glob)).filter((p) => p !== '')),
      ]
      const found: { path: string; content: string }[] = []

      const walk = async (relDir: string): Promise<void> => {
        if (found.length >= maxFiles || signal.aborted) return
        const { readdir } = await import('node:fs/promises')
        let entries
        try {
          entries = await readdir(join(input.project.rootDir, relDir), { withFileTypes: true })
        } catch {
          return
        }
        entries.sort((a, b) => a.name.localeCompare(b.name))
        for (const entry of entries) {
          if (found.length >= maxFiles) return
          const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`
          if (entry.isDirectory()) {
            if (['node_modules', '.git', '.uranus', 'dist', 'vendor'].includes(entry.name)) continue
            await walk(rel)
          } else if (matcher(rel)) {
            try {
              const content = await readFile(join(input.project.rootDir, rel), 'utf8')
              found.push({ path: rel, content })
            } catch {
              /* binário: pula */
            }
          }
        }
      }
      for (const root of roots.length > 0 ? roots : ['']) await walk(root)

      return found.map((file) => {
        const body = truncateMiddle(file.content, maxChars)
        return {
          id: `code:${file.path}`,
          sourceId: 'code',
          kind: 'code' as const,
          title: `Arquivo: ${file.path}`,
          body,
          tokens: estimateTokens(body, 'code'),
          priority: 60,
          pinned: false,
          untrusted: true, // INV-6
          refs: [{ path: file.path, checksum: hashText(file.content) }],
        }
      })
    },
    freshness(_input, _signal): Promise<string> {
      return Promise.resolve(String(Date.now()))
    },
  }
}

/** README do projeto, truncado — `untrusted` como todo conteúdo do repo. */
export function readmeSource(): ContextSource {
  return {
    id: 'readme',
    cost: 'cheap',
    kinds: ['doc'],
    async collect(input, _signal): Promise<readonly ContextFragment[]> {
      for (const name of ['README.md', 'readme.md', 'README.rst', 'README.txt']) {
        try {
          const content = await readFile(join(input.project.rootDir, name), 'utf8')
          const body = truncateMiddle(content, 6_000)
          return [
            {
              id: 'doc:readme',
              sourceId: 'readme',
              kind: 'doc',
              title: `Documentação: ${name}`,
              body,
              tokens: estimateTokens(body),
              priority: 40,
              pinned: false,
              untrusted: true, // INV-6
              refs: [{ path: name, checksum: hashText(content) }],
            },
          ]
        } catch {
          continue
        }
      }
      return []
    },
    freshness(_input, _signal): Promise<string> {
      return Promise.resolve('readme')
    },
  }
}
