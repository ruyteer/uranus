import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Grafo do graphify — leitura de `graphify-out/graph.json`.
 *
 * Diferente do vault (`vault.ts`, calculado na hora a partir de memória/
 * backlog/instruções), este é um SNAPSHOT: quem produz o arquivo é a skill
 * `/graphify` (fora do processo do Uranus, via subagentes do Claude Code +
 * AST), não o painel. `readGraphifyGraph` só lê e adapta o que já está em
 * disco — arquivo ausente é "grafo nunca gerado neste projeto", não erro.
 *
 * O schema de `graph.json` é o `networkx.node_link_data` do graphify
 * (`nodes`/`links`, mais `community`/`community_name` que o `export.py` dele
 * anota depois do clustering) — não um contrato do Uranus. Por isso a leitura
 * é toda defensiva: campo no formato errado é ignorado, não lançado.
 */
export interface GraphifyNode {
  readonly id: string
  readonly title: string
  readonly fileType?: string
  readonly sourceFile?: string
  readonly sourceLocation?: string
  readonly community?: number
  readonly communityName?: string
}

export interface GraphifyEdge {
  readonly from: string
  readonly to: string
  readonly relation?: string
}

export interface GraphifyCommunity {
  readonly id: number
  readonly label?: string
  readonly size: number
}

export interface GraphifyGodNode {
  readonly id: string
  readonly title: string
  readonly degree: number
}

export interface GraphifyGraph {
  readonly nodes: readonly GraphifyNode[]
  readonly edges: readonly GraphifyEdge[]
  readonly communities: readonly GraphifyCommunity[]
  readonly godNodes: readonly GraphifyGodNode[]
}

const EMPTY_GRAPH: GraphifyGraph = { nodes: [], edges: [], communities: [], godNodes: [] }

export async function readGraphifyGraph(projectDir: string): Promise<GraphifyGraph> {
  let raw: string
  try {
    raw = await readFile(join(projectDir, 'graphify-out', 'graph.json'), 'utf8')
  } catch {
    return EMPTY_GRAPH
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return EMPTY_GRAPH
  }
  if (!isRecord(parsed)) return EMPTY_GRAPH

  const nodes = parseNodes(parsed['nodes'])
  const knownIds = new Set(nodes.map((n) => n.id))
  const edges = parseEdges(parsed['links'], knownIds)

  return { nodes, edges, communities: communitiesOf(nodes), godNodes: godNodesOf(nodes, edges) }
}

function parseNodes(value: unknown): GraphifyNode[] {
  if (!Array.isArray(value)) return []
  const nodes: GraphifyNode[] = []
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry['id'] !== 'string') continue
    const id = entry['id']
    const label = typeof entry['label'] === 'string' && entry['label'] !== '' ? entry['label'] : id
    nodes.push({
      id,
      title: label,
      ...(typeof entry['file_type'] === 'string' ? { fileType: entry['file_type'] } : {}),
      ...(typeof entry['source_file'] === 'string' ? { sourceFile: entry['source_file'] } : {}),
      ...(typeof entry['source_location'] === 'string' ? { sourceLocation: entry['source_location'] } : {}),
      ...(typeof entry['community'] === 'number' ? { community: entry['community'] } : {}),
      ...(typeof entry['community_name'] === 'string' ? { communityName: entry['community_name'] } : {}),
    })
  }
  return nodes
}

function parseEdges(value: unknown, knownIds: ReadonlySet<string>): GraphifyEdge[] {
  if (!Array.isArray(value)) return []
  const edges: GraphifyEdge[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const from = endpointId(entry['source'])
    const to = endpointId(entry['target'])
    // Endpoint que não casa com nenhum nó conhecido: node_link_data nunca
    // deveria produzir isso, mas um graph.json escrito por uma versão
    // diferente do graphify (schema mudou) não pode virar aresta pendurada.
    if (from === undefined || to === undefined || !knownIds.has(from) || !knownIds.has(to)) continue
    edges.push({ from, to, ...(typeof entry['relation'] === 'string' ? { relation: entry['relation'] } : {}) })
  }
  return edges
}

function endpointId(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return undefined
}

function communitiesOf(nodes: readonly GraphifyNode[]): readonly GraphifyCommunity[] {
  const byId = new Map<number, { size: number; label?: string }>()
  for (const node of nodes) {
    if (node.community === undefined) continue
    const current = byId.get(node.community) ?? { size: 0 }
    const label = node.communityName ?? current.label
    byId.set(node.community, { size: current.size + 1, ...(label === undefined ? {} : { label }) })
  }
  return [...byId.entries()]
    .map(([id, v]) => ({ id, size: v.size, ...(v.label === undefined ? {} : { label: v.label }) }))
    .sort((a, b) => b.size - a.size)
}

/**
 * Aproximação de `graphify.analyze.god_nodes` (grau puro, maior primeiro).
 * Não reproduz os filtros exatos do Python (excluir nó-arquivo, nó-conceito,
 * ruído de builtin) — para destacar hubs visualmente na tela, grau já basta.
 */
function godNodesOf(
  nodes: readonly GraphifyNode[],
  edges: readonly GraphifyEdge[],
  topN = 10,
): readonly GraphifyGodNode[] {
  const degree = new Map<string, number>()
  for (const edge of edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1)
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1)
  }
  const byId = new Map(nodes.map((n) => [n.id, n]))
  return [...degree.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([id, deg]) => ({ id, title: byId.get(id)?.title ?? id, degree: deg }))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
