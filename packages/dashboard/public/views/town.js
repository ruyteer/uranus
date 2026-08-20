/**
 * Aba Sala — os agentes do Uranus como bonequinhos de pixel art, ao vivo.
 *
 * Mesma fonte que a aba Chat (`ctx.res('chat')`, alimentada pelos hooks
 * NATIVOS do Claude Code `SubagentStart`/`SubagentStop` via `uranus relay` —
 * ver `packages/cli/src/relay.ts`), só que em vez de uma lista de texto,
 * cada entrada anima um personagem: o orquestrador (a sessão `uranus chat`
 * em si) e um por subagente despachado. `SubagentStart` é o que deixa o
 * personagem "trabalhando" enquanto o subagente roda, não só piscar no fim.
 *
 * Motor: `agent-town` (vendorizado, canvas puro, zero dependência — ver
 * `lib/agent-town/VENDORED.md`). A instância vive no módulo, como o
 * grafo/terminal: recriar a cada redesenho da aba perderia posição e
 * reiniciaria a "caminhada" dos personagens.
 */
import { h } from '../lib/dom.js'
import { notice, page, pageHead } from '../lib/ui.js'
import { asArray } from '../lib/aggregate.js'
import { AgentTown } from '../lib/agent-town/agent-town.mjs'

export const meta = {
  id: 'town',
  label: 'Sala',
  group: 'Acompanhar',
  icon: 'cpu',
  needs: ['chat'],
}

const ORCHESTRATOR_ID = 'orchestrator'
const FADE_MS = 6000
const BUBBLE_MAX = 70

let town
let wrap
let lastSeenAt
let initialized = false
const knownAgents = new Set()
const fadeTimers = new Map()

function truncate(text) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > BUBBLE_MAX ? `${flat.slice(0, BUBBLE_MAX).trimEnd()}…` : flat
}

function labelFor(agentId) {
  return agentId.charAt(0).toUpperCase() + agentId.slice(1).replace(/-/g, ' ')
}

function scheduleFade(id) {
  const existing = fadeTimers.get(id)
  if (existing !== undefined) clearTimeout(existing)
  fadeTimers.set(
    id,
    setTimeout(() => {
      fadeTimers.delete(id)
      town.updateAgent(id, { status: 'idle', message: null })
    }, FADE_MS),
  )
}

function ensureAgent(id) {
  if (knownAgents.has(id)) return
  knownAgents.add(id)
  town.addAgent({ id, name: labelFor(id), role: 'Especialista' })
}

function ensureTown() {
  if (town !== undefined) return town
  const canvas = h('div', { class: 'town-canvas' })
  wrap = h('div', { class: 'town-wrap' }, canvas)
  // `environment: 'town'`, não `'office'`: na versão vendorizada, TODO
  // ambiente que não é `'town'` cai em `buildKanbanRooms` (salas
  // Backlog/To Do/In Progress/Review/Done vazias — sem `addTask`, viram só
  // retângulos bege com um cartaz) e a decoração por `buildingStyle` é
  // código morto (`populateRoomByStyle` ignora o parâmetro). `'town'` é o
  // único ambiente com layout de verdade nesta versão: rua, calçada,
  // fonte, prédios com telhado colorido — ver `World.buildTownRooms`.
  // `roomMode` não existe mais aqui de propósito: o parâmetro está na
  // API/README da lib mas não tem efeito nenhum na versão vendorizada.
  town = new AgentTown({ container: canvas, environment: 'town', officeSize: 'medium', autoSize: true })
  knownAgents.add(ORCHESTRATOR_ID)
  town.addAgent({ id: ORCHESTRATOR_ID, name: 'Claude', role: 'Orquestrador', status: 'idle' })

  // A lib não expõe pausar/retomar na API pública, e o motor dela roda um
  // loop de `requestAnimationFrame` incondicional pra sempre — mesmo com o
  // `<canvas>` desconectado do DOM, o que acontece toda vez que o usuário
  // troca de aba (`app.js` substitui o conteúdo de `#view` inteiro). Sem
  // isto, a primeira visita à Sala deixava um motor de jogo queimando CPU
  // em segundo plano pelo resto da sessão do painel — o "pesado" relatado.
  // `town.engine` é campo interno (privado só em tempo de compilação — em
  // JS puro dá pra acessar); a checagem defensiva faz isto degradar pra
  // no-op, não quebrar, se uma versão futura da lib mudar por dentro.
  new IntersectionObserver(([visible]) => {
    const engine = town.engine
    if (typeof engine?.start !== 'function' || typeof engine.stop !== 'function') return
    if (visible.isIntersecting) engine.start()
    else engine.stop()
  }).observe(wrap)

  return town
}

function applyEntry(entry) {
  if (entry.role === 'user') {
    const existing = fadeTimers.get(ORCHESTRATOR_ID)
    if (existing !== undefined) clearTimeout(existing)
    town.updateAgent(ORCHESTRATOR_ID, { status: 'thinking', message: truncate(entry.summary) })
    return
  }
  if (entry.event === 'Stop') {
    town.updateAgent(ORCHESTRATOR_ID, { status: 'success', message: truncate(entry.summary) })
    scheduleFade(ORCHESTRATOR_ID)
    return
  }
  if (entry.agent === undefined) return
  if (entry.event === 'SubagentStart') {
    ensureAgent(entry.agent)
    const existing = fadeTimers.get(entry.agent)
    if (existing !== undefined) clearTimeout(existing)
    town.updateAgent(entry.agent, { status: 'typing', message: truncate(entry.summary) })
    return
  }
  if (entry.event === 'SubagentStop') {
    ensureAgent(entry.agent)
    town.updateAgent(entry.agent, { status: 'success', message: truncate(entry.summary) })
    scheduleFade(entry.agent)
  }
}

export function render(ctx) {
  const resource = ctx.res('chat')

  const head = pageHead({
    title: 'Sala',
    description: 'Os agentes do Uranus, ao vivo — a mesma atividade da aba Chat, só que em pixel art.',
  })

  // `chat`/`claude-activity` é servido direto por `server.ts` (buffer em
  // memória do processo do painel), não por `DashboardData` — ao contrário
  // de vault/grafo/git, não existe modo "painel sem porta de dados" pra essa
  // fonte, então não há branch `unavailable` aqui (nunca dispararia).
  const entries = asArray(resource.data?.entries)
  // `AgentTown` observa o próprio tamanho de container sozinho (ResizeObserver
  // interno) — nada aqui precisa chamar `.resize()` manualmente.
  ensureTown()

  // O primeiro `render()` da aba acontece ANTES do fetch assíncrono
  // resolver (`entries` ainda vazio) — só trata como "carregado de verdade"
  // quando `status` vira `ready`; senão `initialized` travaria com
  // `lastSeenAt = 0` e o PRÓXIMO render (já com dado real) reproduziria a
  // história inteira de uma vez, o que é exatamente o que essa baseline
  // existe pra evitar.
  if (resource.status === 'ready') {
    if (!initialized) {
      // Primeira vez que a aba abre: só marca onde a história já ia, sem
      // reproduzir tudo de uma vez — a Sala mostra atividade daqui pra
      // frente, não um replay acelerado da sessão inteira.
      initialized = true
      lastSeenAt = entries.length > 0 ? entries[entries.length - 1].at : 0
    } else {
      const fresh = entries.filter((entry) => entry.at > lastSeenAt)
      for (const entry of fresh) applyEntry(entry)
      if (fresh.length > 0) lastSeenAt = fresh[fresh.length - 1].at
    }
  }

  return page(
    head,
    resource.status === 'error'
      ? notice({ tone: 'danger', title: 'Falha ao ler a atividade', text: resource.error?.message })
      : null,
    entries.length === 0
      ? h('p', { class: 'muted', text: 'Nenhuma atividade ainda — abra uma sessão com `uranus chat` neste projeto.' })
      : null,
    wrap,
  )
}
