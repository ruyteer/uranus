/**
 * Ponto de entrada do painel.
 *
 * Faz três coisas: escolhe a aba pelo hash, mantém o cache de recursos vivo
 * (SSE + rede de segurança de 10 s) e redesenha a aba ativa quando algo muda.
 * Nenhuma view fala com o servidor sozinha para LER — quem lê é o `store`, e
 * é por isso que duas abas nunca disparam a mesma requisição em paralelo.
 *
 * Sem framework, sem bundler, sem CDN: módulos ES nativos servidos pelo mesmo
 * `node:http` que serve a API. É a decisão registrada em `server.ts`, e ela
 * continua valendo — o que mudou é que o HTML monolítico virou arquivos.
 */
import { clear, h, replace, svg } from './lib/dom.js'
import { icon } from './lib/icons.js'
import { qs } from './lib/api.js'
import { emit, load, loadAll, resource, store, subscribe, writable } from './lib/store.js'

import * as backlog from './views/backlog.js'
import * as terminal from './views/terminal.js'
import * as instructions from './views/instructions.js'
import * as skills from './views/skills.js'
import * as config from './views/config.js'
import * as vault from './views/vault.js'
import * as town from './views/town.js'
import * as memory from './views/memory.js'
import * as git from './views/git.js'

/**
 * Ordem da barra lateral.
 *
 * Backlog é a tela principal: o resto do painel existe para dar suporte a ela
 * e ao terminal, não para instrumentar um Kernel que por padrão não roda mais
 * sozinho (ver docs/00-ARCHITECTURE — pivot "Uranus é armadura"). As abas de
 * instrumentação do run (Tasks, Qualidade, Custo, Aprovações, Timeline,
 * Visão geral, Saúde) saíram da navegação — os arquivos continuam em
 * `views/` e as rotas de API continuam de pé, só não aparecem mais aqui.
 * A aba Grafo (graphify) saiu pelo mesmo motivo: o grafo de uma codebase
 * inteira chega a milhares de nós e ficava pesado demais no navegador —
 * `views/graphify.js` continua no repo, só não está listado abaixo.
 */
const VIEWS = [
  backlog,
  terminal,
  instructions,
  skills,
  config,
  vault,
  town,
  memory,
  git,
]

const byId = new Map(VIEWS.map((view) => [view.meta.id, view]))
const DEFAULT_VIEW = backlog.meta.id

const ctx = {
  store,
  res: resource,
  writable,
  snap: () => resource('state').data ?? {},
  /** Recarrega recursos de verdade (ignora cache em voo) e redesenha. */
  reload: (names) => loadAll(names, true),
}

// ── roteamento ───────────────────────────────────────────────────────────────

function routeId() {
  const raw = location.hash.replace(/^#\/?/, '')
  return byId.has(raw) ? raw : DEFAULT_VIEW
}

function currentView() {
  return byId.get(routeId()) ?? overview
}

function navigate(id) {
  if (routeId() === id) return
  location.hash = `#/${id}`
}

// ── barra lateral ────────────────────────────────────────────────────────────

const navRefs = new Map()

function buildNav() {
  const nav = document.getElementById('nav')
  clear(nav)
  navRefs.clear()
  let lastGroup

  for (const view of VIEWS) {
    if (view.meta.group !== lastGroup) {
      lastGroup = view.meta.group
      nav.append(h('div', { class: 'sidebar__group', text: lastGroup }))
    }
    const count = h('span', { class: 'navitem__count', hidden: true })
    const item = h(
      'button',
      {
        class: 'navitem',
        type: 'button',
        dataset: { view: view.meta.id },
        on: { click: () => navigate(view.meta.id) },
      },
      svg(icon(view.meta.icon)),
      h('span', { class: 'navitem__label', text: view.meta.label }),
      count,
    )
    navRefs.set(view.meta.id, { item, count })
    nav.append(item)
  }
}

function paintNav() {
  const active = routeId()
  for (const view of VIEWS) {
    const refs = navRefs.get(view.meta.id)
    if (!refs) continue
    if (view.meta.id === active) refs.item.setAttribute('aria-current', 'page')
    else refs.item.removeAttribute('aria-current')

    const value = typeof view.meta.badge === 'function' ? Number(view.meta.badge(ctx)) : 0
    refs.count.hidden = !Number.isFinite(value) || value <= 0
    refs.count.textContent = String(value)
  }
}

// ── barra superior ───────────────────────────────────────────────────────────

function paintTopbar() {
  const dot = document.getElementById('live')
  dot.className = `dot ${store.live ? 'dot--live' : 'dot--down'}`
  dot.title = store.live ? 'Recebendo eventos ao vivo' : 'Fluxo de eventos desconectado'
  document.getElementById('runstate').textContent = store.live ? 'conectado' : 'desconectado'

  const foot = document.getElementById('lastevent')
  foot.textContent = store.lastEvent ? `último evento: ${store.lastEvent}` : 'aguardando eventos…'
}

// ── desenho da aba ───────────────────────────────────────────────────────────

let dirty = false

function typing() {
  const active = document.activeElement
  if (!active) return false
  const host = document.getElementById('view')
  return (
    host.contains(active) &&
    (active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA')
  )
}

function paint() {
  paintNav()
  paintTopbar()

  const host = document.getElementById('view')
  // Redesenhar por baixo de quem está digitando destruiria o campo e o cursor.
  // O SSE dispara a cada rajada de eventos; sem esta guarda, preencher um
  // formulário no meio de um run seria impossível.
  if (typing()) {
    dirty = true
    return
  }
  dirty = false

  const scroll = host.scrollTop
  try {
    replace(host, currentView().render(ctx))
  } catch (error) {
    // Uma view que estoura não pode levar o painel inteiro junto: a barra
    // lateral continua navegável e o erro aparece escrito, não só no console.
    replace(
      host,
      h(
        'div',
        { class: 'view__inner' },
        h('h1', { text: 'Esta aba falhou ao desenhar' }),
        h('p', { class: 'prose', text: error instanceof Error ? error.message : String(error) }),
      ),
    )
    console.error('Falha ao desenhar a aba', error)
  }
  host.scrollTop = scroll
}

function activate() {
  const view = currentView()
  document.title = `Uranus · ${view.meta.label}`
  paint()
  void loadAll(view.meta.needs ?? ['state'])
}

// ── ligação ao servidor ──────────────────────────────────────────────────────

let pendingRefresh = null

/**
 * Coalescência: uma rajada de eventos vira UM refetch. Sem isto, um tick que
 * emite 30 eventos dispararia 30 requisições e o painel ficaria mais pesado
 * que o kernel que ele observa. É o mesmo mecanismo do painel antigo.
 */
function scheduleRefresh() {
  if (pendingRefresh !== null) return
  pendingRefresh = setTimeout(() => {
    pendingRefresh = null
    const needs = new Set(['state', ...(currentView().meta.needs ?? [])])
    void loadAll([...needs], true)
  }, 200)
}

function connect() {
  const source = new EventSource(`/api/stream${qs}`)

  source.onopen = () => {
    store.live = true
    void load('state', true)
    emit()
  }

  source.addEventListener('event', (message) => {
    store.live = true
    try {
      const entry = JSON.parse(message.data)
      store.lastEvent = entry.name
    } catch {
      /* linha malformada não derruba o painel */
    }
    scheduleRefresh()
  })

  // Atividade do `uranus chat` (hooks do Claude Code) chega por um evento SSE
  // à parte: entra direto no cache do recurso `chat`, sem round-trip de GET —
  // é o mesmo dado que o servidor já mandou, só falta desenhar de novo.
  source.addEventListener('claude-activity', (message) => {
    store.live = true
    try {
      const entry = JSON.parse(message.data)
      const current = resource('chat').data ?? { entries: [] }
      store.res.chat = { status: 'ready', data: { entries: [...current.entries, entry] } }
      emit()
    } catch {
      /* linha malformada não derruba o painel */
    }
  })

  source.onerror = () => {
    store.live = false
    emit()
    // O EventSource reconecta sozinho; não fechamos aqui de propósito.
  }
}

// ── arranque ─────────────────────────────────────────────────────────────────

buildNav()
subscribe(paint)
document.getElementById('view').addEventListener('focusout', () => {
  // Terminou de digitar e havia render pendente: agora dá para redesenhar.
  if (dirty) setTimeout(() => { if (!typing()) paint() }, 0)
})
window.addEventListener('hashchange', activate)

activate()
void loadAll(['state'], true)
connect()

// Rede de segurança: se o fluxo cair sem disparar erro, o painel ainda
// converge. 10 s é raro o bastante para não pesar e curto o bastante para
// ninguém olhar dados velhos sem perceber.
setInterval(() => {
  const needs = new Set(['state', ...(currentView().meta.needs ?? [])])
  void loadAll([...needs], true)
}, 10_000)
