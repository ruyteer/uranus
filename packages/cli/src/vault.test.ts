import { describe, expect, it } from 'vitest'
import { buildVaultGraph, extractWikilinks } from './vault.js'

describe('extractWikilinks', () => {
  it('acha [[link]] simples e [[link|apelido]]', () => {
    expect(extractWikilinks('veja [[Estilo de commit]] e [[Convenção|aqui]].')).toEqual([
      'Estilo de commit',
      'Convenção',
    ])
  })

  it('texto sem link devolve lista vazia', () => {
    expect(extractWikilinks('nada aqui')).toEqual([])
  })

  it('ignora colchete duplo vazio', () => {
    expect(extractWikilinks('[[]] e [[  ]]')).toEqual([])
  })
})

describe('buildVaultGraph', () => {
  it('cada nota vira um nó, com id prefixado por tipo', () => {
    const graph = buildVaultGraph({
      memory: [
        { id: 'mem1', title: 'Convenção de nomes', key: 'k', scope: 'convention', body: 'x' },
      ],
      backlog: [{ id: 'item1', title: 'Exportar CSV', body: 'x' }],
      instructions: [{ id: 'note1', title: 'Estilo de commit', body: 'x' }],
    })
    expect(graph.nodes.map((n) => n.id).sort()).toEqual([
      'backlog:item1',
      'instruction:note1',
      'memory:mem1',
    ])
    expect(graph.nodes.find((n) => n.id === 'memory:mem1')?.kind).toBe('memory')
  })

  it('wikilink resolvido por título vira aresta, sem duplicar', () => {
    const graph = buildVaultGraph({
      memory: [],
      backlog: [{ id: 'item1', title: 'Exportar CSV', body: 'depende de [[Estilo de commit]]' }],
      instructions: [
        {
          id: 'note1',
          title: 'Estilo de commit',
          body: 'ligado a [[Exportar CSV]] e [[exportar csv]]',
        },
      ],
    })
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        { from: 'backlog:item1', to: 'instruction:note1' },
        { from: 'instruction:note1', to: 'backlog:item1' },
      ]),
    )
    // Case-insensitive: o segundo link de note1 aponta pro MESMO destino, não duplica a aresta.
    expect(graph.edges.filter((e) => e.from === 'instruction:note1')).toHaveLength(1)
  })

  it('link para título inexistente vira "unresolved", não quebra nada', () => {
    const graph = buildVaultGraph({
      memory: [],
      backlog: [],
      instructions: [{ id: 'note1', title: 'A', body: 'referencia [[Fantasma]]' }],
    })
    expect(graph.edges).toEqual([])
    expect(graph.unresolved).toEqual(['Fantasma'])
  })

  it('link para si mesmo não vira aresta', () => {
    const graph = buildVaultGraph({
      memory: [],
      backlog: [],
      instructions: [{ id: 'note1', title: 'A', body: 'eu mesmo: [[A]]' }],
    })
    expect(graph.edges).toEqual([])
  })

  it('excerto corta corpo longo e normaliza espaço em branco', () => {
    const longo = 'linha um\n\nlinha  dois '.repeat(20)
    const graph = buildVaultGraph({
      memory: [],
      backlog: [],
      instructions: [{ id: 'n', title: 'T', body: longo }],
    })
    const excerto = graph.nodes[0]!.excerpt
    expect(excerto.length).toBeLessThanOrEqual(161)
    expect(excerto).not.toContain('\n')
  })
})
