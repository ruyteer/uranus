/**
 * Grafo 3D — motor da aba Vault (`views/vault.js`). Navegar com a câmera em
 * 3D (arrastar = orbitar, roda = zoom, botão direito = pan) separa notas que
 * se sobrepõem em 2D, e é o que "passear entre as notas como se fossem
 * constelações" pede: clicar num nó voa a câmera até ele, em vez de só
 * marcar seleção parado no lugar.
 *
 * A aba Grafo (graphify) foi removida da navegação — o grafo de uma
 * codebase inteira chega a milhares de nós (um projeto real mostrou 3078) e
 * ficava pesado demais pro navegador; o vault é bem menor (memória, backlog
 * e instruções curadas à mão via `[[wikilink]]`), então esse motor serve bem
 * aqui sem o mesmo custo. `views/graphify.js` continua no repo (fora da
 * navegação, mesmo padrão já usado pras antigas abas de instrumentação de
 * run em `app.js`) caso valha a pena reativar mais pra frente.
 *
 * Motor: `3d-force-graph` vendorizado (Three.js + WebGL — ver
 * `lib/3d-force-graph/VENDORED.md`).
 */
import ForceGraph3D from './3d-force-graph/3d-force-graph.mjs'
import { h } from './dom.js'
import { button } from './ui.js'
import { themeColor } from './graph-view.js'

function idOf(value) {
  return typeof value === 'object' && value !== null ? value.id : value
}

export function createGraphView3D({ onNodeClick, onBackgroundClick } = {}) {
  const canvas = h('div', { class: 'graph-canvas' })
  const wrap = h('div', { class: 'graph-wrap' }, canvas)

  let neighbors = new Map()
  let hoverId
  let selectedId
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

  const instance = new ForceGraph3D(canvas, { controlType: 'orbit' })
  instance
    .backgroundColor('#04050c')
    .showNavInfo(false)
    // Arrastar nó pra reposicionar não faz sentido pra "passear entre
    // constelações" (só clicar/voar importa aqui) — e o handoff entre o
    // DragControls da lib e o OrbitControls quebra: um pointerup depois de
    // um pointerdown em cima de um nó lança `Cannot read properties of
    // undefined (reading 'x')` dentro do próprio 3d-force-graph, abortando
    // o clique antes do nosso `onNodeClick` rodar — por isso a câmera nunca
    // "chegava" no nó e o drawer nunca abria. Desligar o drag evita o
    // conflito na raiz em vez de tentar rastrear o bug upstream.
    .enableNodeDrag(false)
    .nodeRelSize(3)
    .nodeVal((node) => 1 + Math.min(6, (node.degree ?? 0) * 0.6))
    .nodeColor((node) => (isDimNode(node.id) ? 'rgba(140,150,170,0.12)' : (node.color ?? 'rgb(180,190,210)')))
    .nodeLabel((node) => node.title ?? String(node.id))
    .nodeOpacity(0.95)
    .linkColor((link) => (isDimLink(link) ? 'rgba(120,130,160,0.03)' : 'rgba(150,160,200,0.25)'))
    .linkWidth(0.4)
    .linkOpacity(1)
    .onNodeHover((node) => {
      hoverId = node?.id
      canvas.style.cursor = node ? 'pointer' : 'grab'
    })
    .onNodeClick((node) => {
      selectedId = node.id
      flyTo(node)
      onNodeClick?.(node.id)
    })
    .onBackgroundClick(() => {
      selectedId = undefined
      onBackgroundClick?.()
    })
    // Mesma lição do `graph-view.js` 2D: o fit automático precisa esperar a
    // simulação assentar (`onEngineStop`), não rodar no primeiro frame — os
    // nós nascem perto da origem e a câmera "chegaria" antes deles se
    // espalharem, sobrando espaço vazio até a física terminar.
    .onEngineStop(() => {
      if (fitted) return
      fitted = true
      instance.zoomToFit(600, 80)
    })

  /**
   * Voa a câmera até perto do nó, olhando pra ele — o "passear" pedido.
   *
   * Deliberadamente NÃO escala pela distância do nó até a origem (o jeito
   * mais comum de fazer isso na lib): num grafo grande e denso, muitos nós
   * assentam bem perto do centro depois da física — com origem-relativa, um
   * `hyp` pequeno faz a razão explodir e a câmera "foge" pro espaço em vez
   * de chegar perto. Um deslocamento fixo a partir da POSIÇÃO DO NÓ (não da
   * origem) funciona igual não importa onde o nó pousou.
   */
  function flyTo(node) {
    const distance = 60
    const target = {
      x: (node.x ?? 0) + distance,
      y: (node.y ?? 0) + distance,
      z: (node.z ?? 0) + distance,
    }
    instance.cameraPosition(target, node, 1200)
  }

  const controls = h(
    'div',
    { class: 'graph-controls' },
    button({ iconName: 'maximize', title: 'Ajustar à tela', onClick: () => instance.zoomToFit(600, 80) }),
    button({
      iconName: 'expand',
      title: 'Tela cheia',
      onClick: () => {
        if (document.fullscreenElement) void document.exitFullscreen()
        else void wrap.requestFullscreen?.()
      },
    }),
  )
  wrap.append(controls)

  function resize() {
    const rect = wrap.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) instance.width(rect.width).height(rect.height)
  }
  new ResizeObserver(resize).observe(wrap)

  // WebGL 3D é caro — pausa a renderização quando a aba não está visível
  // (troca de aba do painel desconecta este `<canvas>` do DOM; `app.js`
  // substitui `#view` inteiro). Mesma lição da aba Sala, mas aqui a lib já
  // expõe pause/resume na API pública — sem precisar mexer em campo interno.
  //
  // Pegadinha: `.observe(wrap)` roda ANTES do chamador (`views/vault.js`)
  // encaixar `wrap` de volta na página — `wrap` ainda está desanexado do
  // DOM neste ponto, então o primeiro callback do observer chega com
  // `isIntersecting: false` e pausa a animação antes dela sequer começar.
  // Sem a trava `everVisible`, essa primeira pausa espúria congela a matriz
  // da câmera pro resto da vida do componente sempre que o "true" seguinte
  // (quando `wrap` é realmente inserido) não chega a tempo de desfazê-la —
  // e com a câmera congelada, tanto o clique (raycasting) quanto
  // `graph2ScreenCoords` ficam calculando em cima de uma matriz velha:
  // clicar num nó simplesmente não acerta nada, silenciosamente. Só pausa
  // de verdade depois de já termos visto a cena ficar visível ao menos uma
  // vez — daí sim um "false" é uma troca de aba de verdade, não a criação.
  let everVisible = false
  new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting) {
      everVisible = true
      instance.resumeAnimation()
    } else if (everVisible) {
      instance.pauseAnimation()
    }
  }).observe(wrap)

  let signature

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
    // Rede de segurança pro race acima: se por algum motivo o primeiro
    // `isIntersecting` ainda não chegou quando os dados entram, força a
    // animação a rodar mesmo assim — `setData` só é chamado quando a aba
    // está sendo desenhada de verdade, então nunca é cedo demais pra rodar.
    instance.resumeAnimation()
    requestAnimationFrame(resize)
  }

  function setSelected(id) {
    selectedId = id
  }

  return { wrap, instance, setData, setSelected, resize }
}
