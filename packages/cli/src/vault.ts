/**
 * Vault — o Uranus como um Obsidian do projeto.
 *
 * Três fontes já existem e já são Markdown/YAML legível (ADR-004): memória
 * semântica (`.uranus/memory`), backlog (`.uranus/backlog`) e instruções
 * (`.uranus/instructions`). O vault não inventa um quarto formato — só lê as
 * três, acha `[[wikilinks]]` no texto de cada uma, e monta o grafo de como
 * elas se referenciam. Uma nota sem link nenhum ainda aparece: um nó isolado
 * é informação (não vinculado a nada), não um bug.
 */
export type VaultNodeKind = 'memory' | 'backlog' | 'instruction'

export interface VaultNode {
  readonly id: string
  readonly title: string
  readonly kind: VaultNodeKind
  /** Escopo de memória, ou pasta da instrução. Ausente = sem escopo/global. */
  readonly scope?: string
  readonly excerpt: string
}

export interface VaultEdge {
  readonly from: string
  readonly to: string
}

export interface VaultGraph {
  readonly nodes: readonly VaultNode[]
  readonly edges: readonly VaultEdge[]
  /** Wikilinks que não casaram com nenhuma nota — mostrados como "a criar". */
  readonly unresolved: readonly string[]
}

const WIKILINK = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g

export function extractWikilinks(text: string): readonly string[] {
  const links: string[] = []
  for (const match of text.matchAll(WIKILINK)) {
    const target = match[1]?.trim()
    if (target !== undefined && target !== '') links.push(target)
  }
  return links
}

function excerptOf(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat
}

/** Interfaces estruturais mínimas — as reais vêm de `@uranus/core`/`@uranus/backlog`. */
export interface VaultMemoryRecordLike {
  readonly id: string
  readonly title: string
  readonly key: string
  readonly scope: string
  readonly body: string
}

export interface VaultBacklogItemLike {
  readonly id: string
  readonly title: string
  readonly body: string
}

export interface VaultInstructionLike {
  readonly id: string
  readonly title: string
  readonly scope?: string
  readonly body: string
}

export interface BuildVaultGraphInput {
  readonly memory: readonly VaultMemoryRecordLike[]
  readonly backlog: readonly VaultBacklogItemLike[]
  readonly instructions: readonly VaultInstructionLike[]
}

export function buildVaultGraph(input: BuildVaultGraphInput): VaultGraph {
  const nodes: VaultNode[] = []
  const bodyOf = new Map<string, string>()

  for (const record of input.memory) {
    const id = `memory:${record.id}`
    const title = record.title.trim() !== '' ? record.title : record.key
    nodes.push({ id, title, kind: 'memory', scope: record.scope, excerpt: excerptOf(record.body) })
    bodyOf.set(id, record.body)
  }
  for (const item of input.backlog) {
    const id = `backlog:${item.id}`
    nodes.push({ id, title: item.title, kind: 'backlog', excerpt: excerptOf(item.body) })
    bodyOf.set(id, item.body)
  }
  for (const note of input.instructions) {
    const id = `instruction:${note.id}`
    nodes.push({
      id,
      title: note.title,
      kind: 'instruction',
      ...(note.scope === undefined ? {} : { scope: note.scope }),
      excerpt: excerptOf(note.body),
    })
    bodyOf.set(id, note.body)
  }

  // Resolução por título (case-insensitive) — é o que alguém digita num
  // `[[wikilink]]`; ninguém escreve o id interno de propósito.
  const byTitle = new Map<string, string>()
  for (const node of nodes) {
    const key = node.title.toLowerCase()
    if (!byTitle.has(key)) byTitle.set(key, node.id)
  }

  const edges: VaultEdge[] = []
  const seenEdges = new Set<string>()
  const unresolved = new Set<string>()

  for (const node of nodes) {
    const body = bodyOf.get(node.id) ?? ''
    for (const link of extractWikilinks(body)) {
      const targetId = byTitle.get(link.toLowerCase())
      if (targetId === undefined) {
        unresolved.add(link)
        continue
      }
      if (targetId === node.id) continue
      const key = `${node.id}→${targetId}`
      if (seenEdges.has(key)) continue
      seenEdges.add(key)
      edges.push({ from: node.id, to: targetId })
    }
  }

  return { nodes, edges, unresolved: [...unresolved].sort() }
}
