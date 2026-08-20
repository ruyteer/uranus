/**
 * Aba Grafo — o grafo de conhecimento gerado pela skill `/graphify` (AST do
 * código + extração semântica de docs, comunidades, god nodes), navegável em
 * 3D — arrastar orbita a câmera, roda do mouse aproxima/afasta, clicar num
 * nó voa até ele. "Passear entre as notas como se fossem constelações."
 *
 * Domínio diferente do Vault (`vault.js`): aquele é curado à mão via
 * `[[wikilink]]` em memória/backlog/instruções, e continua 2D (força-
 * dirigida em canvas, `lib/graph-view.js`) — este é auto-extraído do projeto
 * inteiro pelo graphify, fora do processo do Uranus, e pode chegar a
 * milhares de nós (um projeto real já mostrou 3078), onde navegar em 3D
 * separa aglomerados que se sobrepõem em 2D. Motor: `lib/graph-view-3d.js`
 * (Three.js/WebGL vendorizado — ver `lib/3d-force-graph/VENDORED.md`).
 *
 * O que o painel mostra é sempre o ÚLTIMO `graphify-out/graph.json` escrito
 * em disco — um snapshot, não algo recalculado ao vivo. Rodar `/graphify`
 * de novo (numa sessão do Claude Code) é o que atualiza; o painel pega a
 * mudança sozinho no poll de 10s.
 */
import { h } from '../lib/dom.js'
import { empty, notice, openDrawer, page, pageHead, pill, readOnlyNotice, skeletonRows } from '../lib/ui.js'
import { asArray } from '../lib/aggregate.js'
import { emit } from '../lib/store.js'
import { createGraphView3D } from '../lib/graph-view-3d.js'

export const meta = {
  id: 'graphify',
  label: 'Grafo',
  group: 'Acompanhar',
  icon: 'layers',
  needs: ['graphify'],
}

const UNASSIGNED_COLOR = 'rgb(var(--fg-2))'

/** Ângulo dourado: N cores igualmente separadas em matiz, sem precisar de paleta fixa para um número de comunidades que não é conhecido de antemão. */
function communityColor(id) {
  const hue = (id * 137.508) % 360
  return `hsl(${hue.toFixed(1)} 65% 55%)`
}

let selected
let view
// Ver o comentário equivalente em `views/vault.js`: a instância do grafo só
// é criada uma vez, então o handler de clique precisa ler o `onSelect` mais
// recente por uma variável de módulo, não fechar sobre o do primeiro
// `render()`.
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

  const out = graph.edges
    .filter((e) => e.from === nodeId)
    .map((e) => ({ relation: e.relation, node: graph.nodes.find((n) => n.id === e.to) }))
  const back = graph.edges
    .filter((e) => e.to === nodeId)
    .map((e) => ({ relation: e.relation, node: graph.nodes.find((n) => n.id === e.from) }))

  function linkRow({ relation, node: target }) {
    if (target === undefined) return null
    return h(
      'button',
      {
        type: 'button',
        class: 'navitem',
        style: { width: '100%' },
        on: { click: () => onNavigate(target.id) },
      },
      relation ? pill(relation, 'neutral') : null,
      h('span', { text: target.title }),
    )
  }

  const subtitleParts = [
    node.fileType,
    node.communityName,
    node.sourceFile ? `${node.sourceFile}${node.sourceLocation ? `:${node.sourceLocation}` : ''}` : undefined,
  ].filter((part) => part !== undefined && part !== '')

  openDrawer({
    title: node.title,
    subtitle: subtitleParts.join(' · ') || undefined,
    body: h(
      'div',
      { class: 'stack' },
      h('h3', { class: 'section__title', text: `Liga para (${String(out.length)})` }),
      out.length === 0
        ? h('p', { class: 'muted', text: 'Nenhuma aresta saindo deste nó.' })
        : h('div', { class: 'stack' }, out.map(linkRow)),
      h('h3', { class: 'section__title', text: `Referenciado por (${String(back.length)})` }),
      back.length === 0
        ? h('p', { class: 'muted', text: 'Nada referencia este nó ainda.' })
        : h('div', { class: 'stack' }, back.map(linkRow)),
    ),
  })
}

export function render(ctx) {
  const resource = ctx.res('graphify')

  if (resource.status === 'loading') {
    return page(pageHead({ title: 'Grafo' }), skeletonRows(6))
  }

  const graph = resource.data ?? { nodes: [], edges: [], communities: [], godNodes: [] }
  const nodes = asArray(graph.nodes)
  const edges = asArray(graph.edges)
  const godNodes = asArray(graph.godNodes)

  if (selected !== undefined && !nodes.some((n) => n.id === selected)) selected = undefined

  if (nodes.length === 0) {
    return page(
      pageHead({
        title: 'Grafo',
        description: 'Grafo de conhecimento do projeto (código + docs), gerado pela skill /graphify.',
      }),
      resource.status === 'unavailable' ? readOnlyNotice('ver o grafo') : null,
      empty({
        iconName: 'layers',
        title: 'Nenhum grafo ainda',
        description:
          'Este projeto ainda não tem graphify-out/graph.json. Rode a skill /graphify numa sessão do Claude ' +
          'Code (uranus chat) para gerar o grafo — o painel mostra o resultado assim que o arquivo existir.',
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
    nodes.map((n) => ({
      id: n.id,
      title: n.title,
      color: n.community === undefined ? UNASSIGNED_COLOR : communityColor(n.community),
    })),
    edges,
  )
  requestAnimationFrame(() => graphView.resize())

  // Sem `page()`/`pageHead()` de propósito: o grafo é o conteúdo inteiro da
  // aba, não uma seção dentro de uma página com título — `.graph-page`
  // cancela o padding de leitura que `.view` aplicaria por padrão.
  return h(
    'div',
    { class: 'graph-page' },
    resource.status === 'unavailable' ? readOnlyNotice('ver o grafo') : null,
    resource.status === 'error'
      ? notice({ tone: 'danger', title: 'Falha ao ler o grafo', text: resource.error?.message })
      : null,
    godNodes.length > 0
      ? notice({
          tone: 'neutral',
          iconName: 'spark',
          title: 'God nodes (os hubs do grafo)',
          text: godNodes.map((g) => `${g.title} (${String(g.degree)})`).join(' · '),
        })
      : null,
    graphView.wrap,
  )
}
