/**
 * Grafo força-dirigido compartilhado — Vault (memória/backlog/instruções) e o
 * Grafo (graphify, codebase inteira) são conceitos de domínio diferentes,
 * mas o desenho é o mesmo problema: nós, arestas, física, pan/zoom, tela
 * cheia. Em vez de duas implementações, as duas views decoram os dados
 * (`title`, `color`, `id`) e chamam este componente.
 *
 * Renderiza em canvas via `force-graph` vendorizado (motor por trás do
 * `react-force-graph`, sem o wrapper React que este painel não usa — ver
 * `lib/force-graph/VENDORED.md`).
 *
 * Como o terminal e o vault antigo já faziam com seus próprios containers: a
 * instância precisa sobreviver a redesenhos da aba (`app.js` troca o DOM do
 * `#view` inteiro a cada evento do SSE). Quem chama guarda o objeto retornado
 * por `createGraphView` num módulo, reencaixa o mesmo `wrap` a cada
 * `render()`, e só chama `setData` quando os dados de fato mudaram — recriar
 * a cada redesenho perderia zoom/posição e reiniciaria a simulação física.
 */
import ForceGraph from './force-graph/force-graph.mjs'
import { h } from './dom.js'
import { button } from './ui.js'

function idOf(value) {
  return typeof value === 'object' && value !== null ? value.id : value
}

/**
 * `rgb(var(--info))` funciona como CSS de verdade (o motor de estilo resolve
 * a custom property), mas o canvas 2D não passa por esse motor: `ctx.fillStyle
 * = 'rgb(var(--info))'` é um valor inválido, e o Canvas ignora silenciosamente
 * — o nó fica preto (o default do fillStyle), sem erro nenhum no console.
 * Por isso `node.color`/`link.color` precisam ser cor literal antes de chegar
 * no `force-graph`; esta função resolve `var(--x)` contra o valor computado da
 * custom property (lido do `:root`) e devolve uma string que o canvas entende.
 * Cores que já são literais (`hsl(...)`, `rgba(...)`) passam direto.
 */
export function themeColor(value) {
  if (typeof value !== 'string' || !value.includes('var(')) return value
  const root = getComputedStyle(document.documentElement)
  return value.replace(/var\((--[a-z0-9-]+)\)/gi, (_, name) => root.getPropertyValue(name).trim())
}

/** Lido uma vez (o painel não troca de tema sem recarregar a página). */
let palette
function themePalette() {
  if (palette !== undefined) return palette
  palette = {
    bg: themeColor('rgb(var(--bg-1))'),
    fg: themeColor('rgb(var(--fg-1))'),
    fgDim: themeColor('rgb(var(--fg-2))'),
  }
  return palette
}

function nodeRadius(node) {
  return 4 + Math.min(9, (node.degree ?? 0) * 1.4)
}

/** Raio mínimo em pixels de tela, qualquer que seja o zoom. */
const MIN_NODE_SCREEN_R = 3
/** Abaixo desse `globalScale`, o rótulo some (só a bolinha fica). */
const LABEL_MIN_SCALE = 0.4

export function createGraphView({ onNodeClick, onBackgroundClick } = {}) {
  const canvasHost = h('div', { class: 'graph-canvas' })

  let neighbors = new Map()
  let hoverId
  let selectedId
  let lastSize
  let fitted = false

  function focusId() {
    return hoverId ?? selectedId
  }
  function isDimNode(id) {
    const focus = focusId()
    return focus !== undefined && id !== focus && !(neighbors.get(focus)?.has(id) ?? false)
  }
  function isDimLink(link) {
    const focus = focusId()
    return focus !== undefined && idOf(link.source) !== focus && idOf(link.target) !== focus
  }

  const instance = new ForceGraph(canvasHost)
  instance
    .backgroundColor('rgba(0,0,0,0)')
    .nodeRelSize(4)
    .nodeVal((node) => 1 + Math.min(6, (node.degree ?? 0) * 0.6))
    .linkColor((link) => (isDimLink(link) ? 'rgba(140,150,170,.08)' : 'rgba(140,150,170,.35)'))
    .linkWidth(1)
    .linkDirectionalArrowLength(0)
    .cooldownTicks(200)
    // Título sempre visível ao lado do nó (não só em hover) — é o que o SVG
    // antigo do vault fazia, e sem isso o grafo vira uma nuvem de bolinhas
    // indistinguíveis. `nodePointerAreaPaint` mantém a área clicável do
    // mesmo tamanho do círculo desenhado, já que o render deixou de ser o
    // default do force-graph.
    .nodeCanvasObject((node, ctx, globalScale) => {
      const dim = isDimNode(node.id)
      const { bg, fg, fgDim } = themePalette()

      // Piso de tamanho NA TELA para a bolinha — sem isso ela encolhe com o
      // zoom-out (raio fixo no espaço do grafo) enquanto o rótulo abaixo faz
      // o oposto de propósito (contra-escala pra ficar sempre legível): de
      // longe, só nome, bolinha some. A bolinha é a informação primária.
      const r = Math.max(nodeRadius(node), MIN_NODE_SCREEN_R / globalScale)
      ctx.beginPath()
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI)
      ctx.fillStyle = dim ? 'rgba(140,150,170,.25)' : (node.color ?? 'rgb(140,150,170)')
      ctx.fill()
      if (node.id === selectedId) {
        ctx.lineWidth = 2 / globalScale
        ctx.strokeStyle = fg
        ctx.stroke()
      }

      // Rótulo só a partir de um certo zoom — de longe (grafo grande visto
      // por inteiro) seria só parede de texto ilegível sobre bolinhas
      // minúsculas; de perto continua sempre visível, como grafos pequenos
      // (vault) já carregam nesse nível de zoom por padrão.
      if (globalScale < LABEL_MIN_SCALE) return

      const label = String(node.title ?? node.id)
      const text = label.length > 40 ? `${label.slice(0, 40)}…` : label
      const fontSize = Math.max(4, 12 / globalScale)
      // Fonte literal, não `var(--font-sans)`: canvas font (assim como
      // fillStyle) não resolve custom property — ver comentário de `themeColor`.
      ctx.font = `${String(fontSize)}px -apple-system, "Segoe UI", sans-serif`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      // Halo (stroke atrás do texto) em vez de fundo sólido — legível tanto
      // sobre o canvas vazio quanto sobre uma aresta cruzando por baixo.
      ctx.lineWidth = 3 / globalScale
      ctx.strokeStyle = bg
      ctx.lineJoin = 'round'
      ctx.strokeText(text, node.x + r + 4, node.y)
      ctx.fillStyle = dim ? fgDim : fg
      ctx.fillText(text, node.x + r + 4, node.y)
    })
    .nodePointerAreaPaint((node, color, ctx, globalScale) => {
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(node.x, node.y, Math.max(nodeRadius(node), MIN_NODE_SCREEN_R / globalScale) + 2, 0, 2 * Math.PI)
      ctx.fill()
    })
    .onNodeHover((node) => {
      hoverId = node?.id
      canvasHost.style.cursor = node ? 'pointer' : 'grab'
    })
    .onNodeClick((node) => {
      selectedId = node.id
      onNodeClick?.(node.id)
    })
    .onBackgroundClick(() => {
      selectedId = undefined
      onBackgroundClick?.()
    })
    // O fit automático precisa esperar a simulação física ASSENTAR, não só o
    // primeiro frame disponível: `graphData()` nasce com os nós agrupados
    // perto da origem, e `zoomToFit` logo ali enquadra ESSA bolinha minúscula
    // — aí a física espalha os nós pra fora do que já foi enquadrado, e o
    // usuário vê o grafo "preso" num canto vazio até clicar em "ajustar à
    // tela" de novo (que reenquadra com os nós já no lugar final). Num grafo
    // de 14 notas isso assenta rápido o bastante pra não notar; num de 3000+
    // nós (graphify) a simulação leva segundos — tempo de sobra pra parecer
    // travado. `onEngineStop` dispara quando a simulação para de verdade.
    .onEngineStop(() => {
      if (fitted) return
      fitted = true
      instance.zoomToFit(400, 60)
    })

  const controls = h(
    'div',
    { class: 'graph-controls' },
    button({
      iconName: 'plus',
      title: 'Aumentar zoom',
      onClick: () => instance.zoom(instance.zoom() * 1.3, 200),
    }),
    button({
      iconName: 'minus',
      title: 'Diminuir zoom',
      onClick: () => instance.zoom(instance.zoom() / 1.3, 200),
    }),
    button({ iconName: 'maximize', title: 'Ajustar à tela', onClick: () => instance.zoomToFit(400, 60) }),
    button({
      iconName: 'expand',
      title: 'Tela cheia',
      onClick: () => {
        if (document.fullscreenElement) void document.exitFullscreen()
        else void wrap.requestFullscreen?.()
      },
    }),
  )
  const wrap = h('div', { class: 'graph-wrap' }, canvasHost, controls)

  // Só redimensiona o canvas — `adjustCanvasSize` do force-graph reposiciona
  // a câmera a cada width/height novo, então chamar isto redundantemente (a
  // cada redesenho da aba: SSE, poll de 10s) brigaria com o que o usuário
  // ajustou à mão. O ENQUADRAMENTO automático é responsabilidade só do
  // `onEngineStop` acima, não daqui.
  function resize() {
    const rect = wrap.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const key = `${String(Math.round(rect.width))}x${String(Math.round(rect.height))}`
    if (key === lastSize) return
    lastSize = key
    instance.width(rect.width).height(rect.height)
  }
  // ResizeObserver cobre tanto o resize da janela quanto a troca de aba (o
  // container só ganha tamanho real ao entrar no DOM) e a tela cheia — um
  // único mecanismo em vez de três listeners separados.
  new ResizeObserver(resize).observe(wrap)

  let signature

  /**
   * `nodes`: `{id, title, color, ...}`. `edges`: `{from, to, ...}`. Não
   * redesenha (nem reinicia a física) se a assinatura (ids + arestas) não
   * mudou desde a última chamada — é o que deixa clicar/passar o mouse sem
   * a simulação "pular".
   */
  function setData(nodes, edges) {
    const sig = `${nodes.map((n) => n.id).join(',')}|${edges.map((e) => `${e.from}>${e.to}`).join(',')}`
    if (sig === signature) return
    signature = sig
    fitted = false

    neighbors = new Map(nodes.map((n) => [n.id, new Set([n.id])]))
    const degree = new Map()
    for (const edge of edges) {
      neighbors.get(edge.from)?.add(edge.to)
      neighbors.get(edge.to)?.add(edge.from)
      degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1)
      degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1)
    }

    instance.graphData({
      nodes: nodes.map((n) => ({ ...n, color: themeColor(n.color), degree: degree.get(n.id) ?? 0 })),
      links: edges.map((e) => ({ ...e, source: e.from, target: e.to })),
    })
    // `wrap` só ganha tamanho real depois de entrar no DOM, o que acontece
    // DEPOIS deste `render()` retornar — por isso um frame de espera.
    requestAnimationFrame(resize)
  }

  function setSelected(id) {
    selectedId = id
  }

  return { wrap, instance, setData, setSelected, resize }
}
