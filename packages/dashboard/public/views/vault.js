/**
 * Aba Vault — o Uranus como um Obsidian do projeto.
 *
 * Memória, backlog e instruções já são notas em Markdown/YAML (ADR-004); o
 * vault só desenha como elas se referenciam via `[[wikilink]]`, navegável em
 * 3D — arrastar orbita a câmera, roda do mouse aproxima/afasta, clicar num
 * nó voa até ele, "passear entre as notas como se fossem constelações".
 * Motor: `lib/graph-view-3d.js` (Three.js/WebGL vendorizado — ver
 * `lib/3d-force-graph/VENDORED.md`). Era 2D e compartilhava motor com a
 * antiga aba Grafo (graphify); essa aba saiu da navegação por ficar pesada
 * demais com o grafo de uma codebase inteira (milhares de nós), e o vault
 * herdou o motor 3D — bem mais leve aqui porque só tem as notas curadas à
 * mão via `[[wikilink]]`, não o projeto inteiro.
 */
import { h } from '../lib/dom.js'
import { empty, notice, openDrawer, page, pageHead, pill, readOnlyNotice, skeletonRows } from '../lib/ui.js'
import { asArray } from '../lib/aggregate.js'
import { emit } from '../lib/store.js'
import { createGraphView3D } from '../lib/graph-view-3d.js'

export const meta = {
  id: 'vault',
  label: 'Vault',
  group: 'Acompanhar',
  icon: 'network',
  needs: ['vault'],
}

const KIND_TONE = { memory: 'info', backlog: 'neutral', instruction: 'warning' }
const KIND_LABEL = { memory: 'memória', backlog: 'backlog', instruction: 'instrução' }
const KIND_COLOR = {
  memory: 'rgb(var(--info))',
  backlog: 'rgb(var(--fg-2))',
  instruction: 'rgb(var(--warning))',
}

// Vive no módulo (sobrevive a redesenhos da aba) pelo mesmo motivo do
// terminal: recriar o grafo a cada evento do SSE perderia zoom/posição e
// reiniciaria a simulação física a cada rajada.
let selected
let view
// `createGraphView` só é chamado uma vez (a instância sobrevive aos
// redesenhos, acima); o handler de clique precisa indireção por uma
// variável de módulo em vez de fechar sobre o `onSelect` do primeiro
// `render()` — senão todo clique depois do primeiro chama a closure do
// PRIMEIRO desenho, com o `graph` daquele instante (dado velho assim que a
// vault muda).
let latestOnSelect

function ensureView() {
  if (view !== undefined) return view
  view = createGraphView3D({
    onNodeClick: (id) => latestOnSelect?.(id),
    onBackgroundClick: () => {
      selected = undefined
      emit()
    },
  })
  return view
}

function openNodeDrawer(graph, nodeId, onNavigate) {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (node === undefined) return

  const out = graph.edges.filter((e) => e.from === nodeId).map((e) => graph.nodes.find((n) => n.id === e.to))
  const back = graph.edges.filter((e) => e.to === nodeId).map((e) => graph.nodes.find((n) => n.id === e.from))

  function linkRow(target) {
    if (target === undefined) return null
    return h(
      'button',
      {
        type: 'button',
        class: 'navitem',
        style: { width: '100%' },
        on: { click: () => onNavigate(target.id) },
      },
      pill(KIND_LABEL[target.kind] ?? target.kind, KIND_TONE[target.kind] ?? 'neutral'),
      h('span', { text: target.title }),
    )
  }

  openDrawer({
    title: node.title,
    subtitle: node.scope
      ? `${KIND_LABEL[node.kind] ?? node.kind} · ${node.scope}`
      : (KIND_LABEL[node.kind] ?? node.kind),
    body: h(
      'div',
      { class: 'stack' },
      h('p', { class: 'prose', text: node.excerpt || '(sem conteúdo)' }),
      h('h3', { class: 'section__title', text: `Liga para (${String(out.length)})` }),
      out.length === 0
        ? h('p', { class: 'muted', text: 'Nenhum link daqui.' })
        : h('div', { class: 'stack' }, out.map(linkRow)),
      h('h3', { class: 'section__title', text: `Backlinks (${String(back.length)})` }),
      back.length === 0
        ? h('p', { class: 'muted', text: 'Nada linka para cá ainda.' })
        : h('div', { class: 'stack' }, back.map(linkRow)),
    ),
  })
}

export function render(ctx) {
  const resource = ctx.res('vault')

  if (resource.status === 'loading') {
    return page(pageHead({ title: 'Vault' }), skeletonRows(6))
  }

  const graph = resource.data ?? { nodes: [], edges: [], unresolved: [] }
  const nodes = asArray(graph.nodes)
  const edges = asArray(graph.edges)
  const unresolved = asArray(graph.unresolved)

  if (selected !== undefined && !nodes.some((n) => n.id === selected)) selected = undefined

  if (nodes.length === 0) {
    return page(
      pageHead({
        title: 'Vault',
        description: 'Como memória, backlog e instruções se referenciam entre si, via [[wikilinks]] no texto.',
      }),
      resource.status === 'unavailable' ? readOnlyNotice('ver o vault') : null,
      empty({
        iconName: 'network',
        title: 'Vault vazio',
        description:
          'Ainda não há memória, backlog ou instruções para desenhar. Escreva `[[Nome de outra nota]]` ' +
          'dentro de qualquer uma delas para criar um link.',
      }),
    )
  }

  const onSelect = (id) => {
    selected = id
    graphView.setSelected(id)
    openNodeDrawer(graph, id, onSelect)
    emit()
  }
  latestOnSelect = onSelect
  const graphView = ensureView()
  graphView.setSelected(selected)
  graphView.setData(
    nodes.map((n) => ({ id: n.id, title: n.title, color: KIND_COLOR[n.kind] ?? 'rgb(var(--fg-2))' })),
    edges,
  )
  requestAnimationFrame(() => graphView.resize())

  // Sem `page()`/`pageHead()` de propósito: o grafo é o conteúdo inteiro da
  // aba, não uma seção dentro de uma página com título — `.graph-page`
  // cancela o padding de leitura que `.view` aplicaria por padrão.
  return h(
    'div',
    { class: 'graph-page' },
    resource.status === 'unavailable' ? readOnlyNotice('ver o vault') : null,
    resource.status === 'error'
      ? notice({ tone: 'danger', title: 'Falha ao ler o vault', text: resource.error?.message })
      : null,
    unresolved.length > 0
      ? notice({
          tone: 'neutral',
          title: `${String(unresolved.length)} link(s) apontam para notas que não existem`,
          text: unresolved.join(', '),
        })
      : null,
    graphView.wrap,
  )
}
