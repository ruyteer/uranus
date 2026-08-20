import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { withTempDir } from '@uranus/testkit'
import { readGraphifyGraph } from './graphify.js'

async function writeGraph(dir: string, data: unknown): Promise<void> {
  const out = join(dir, 'graphify-out')
  await mkdir(out, { recursive: true })
  await writeFile(join(out, 'graph.json'), JSON.stringify(data), 'utf8')
}

describe('readGraphifyGraph', () => {
  it('sem graphify-out/graph.json, devolve grafo vazio', async () => {
    await withTempDir(async (dir) => {
      const graph = await readGraphifyGraph(dir)
      expect(graph).toEqual({ nodes: [], edges: [], communities: [], godNodes: [] })
    })
  })

  it('graph.json ilegível (JSON inválido), devolve grafo vazio', async () => {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, 'graphify-out'), { recursive: true })
      await writeFile(join(dir, 'graphify-out', 'graph.json'), '{ não é json', 'utf8')
      const graph = await readGraphifyGraph(dir)
      expect(graph.nodes).toEqual([])
    })
  })

  it('adapta nodes/links do formato node_link_data do networkx', async () => {
    await withTempDir(async (dir) => {
      await writeGraph(dir, {
        directed: false,
        nodes: [
          { id: 'auth', label: 'AuthModule', file_type: 'code', source_file: 'src/auth.ts', community: 0, community_name: 'Autenticação' },
          { id: 'db', label: 'Database', file_type: 'code', source_file: 'src/db.ts', community: 1 },
        ],
        links: [{ source: 'auth', target: 'db', relation: 'calls', confidence: 'EXTRACTED' }],
      })

      const graph = await readGraphifyGraph(dir)
      expect(graph.nodes).toHaveLength(2)
      expect(graph.nodes.find((n) => n.id === 'auth')).toMatchObject({
        title: 'AuthModule',
        fileType: 'code',
        sourceFile: 'src/auth.ts',
        community: 0,
        communityName: 'Autenticação',
      })
      expect(graph.edges).toEqual([{ from: 'auth', to: 'db', relation: 'calls' }])
    })
  })

  it('nó sem label usa o id como título', async () => {
    await withTempDir(async (dir) => {
      await writeGraph(dir, { nodes: [{ id: 'x' }], links: [] })
      const graph = await readGraphifyGraph(dir)
      expect(graph.nodes).toEqual([{ id: 'x', title: 'x' }])
    })
  })

  it('aresta com ponta que não casa com nenhum nó conhecido é descartada', async () => {
    await withTempDir(async (dir) => {
      await writeGraph(dir, {
        nodes: [{ id: 'a', label: 'A' }],
        links: [{ source: 'a', target: 'fantasma' }],
      })
      const graph = await readGraphifyGraph(dir)
      expect(graph.edges).toEqual([])
    })
  })

  it('agrupa comunidades por tamanho, maior primeiro', async () => {
    await withTempDir(async (dir) => {
      await writeGraph(dir, {
        nodes: [
          { id: 'a', label: 'A', community: 0, community_name: 'Núcleo' },
          { id: 'b', label: 'B', community: 0, community_name: 'Núcleo' },
          { id: 'c', label: 'C', community: 1, community_name: 'Periferia' },
        ],
        links: [],
      })
      const graph = await readGraphifyGraph(dir)
      expect(graph.communities).toEqual([
        { id: 0, label: 'Núcleo', size: 2 },
        { id: 1, label: 'Periferia', size: 1 },
      ])
    })
  })

  it('god nodes são os de maior grau, maior primeiro', async () => {
    await withTempDir(async (dir) => {
      await writeGraph(dir, {
        nodes: [{ id: 'hub', label: 'Hub' }, { id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
        links: [
          { source: 'hub', target: 'a' },
          { source: 'hub', target: 'b' },
        ],
      })
      const graph = await readGraphifyGraph(dir)
      expect(graph.godNodes[0]).toEqual({ id: 'hub', title: 'Hub', degree: 2 })
    })
  })
})
