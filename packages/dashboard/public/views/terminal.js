/**
 * Aba Terminal — sessões reais, não um mock de linha de comando.
 *
 * "Uranus é a armadura, o Claude é quem age" (ver `docs/00-ARCHITECTURE`):
 * esta aba é o encaixe da armadura com a ferramenta de verdade — um PTY real
 * (`node-pty` no servidor) espelhado aqui via WebSocket e desenhado com
 * xterm.js (vendorizado em `lib/xterm/`, sem CDN). Múltiplas sessões podem
 * ficar abertas ao mesmo tempo; trocar de aba não mata a sessão de trás.
 *
 * **Por que o terminal não é recriado a cada redesenho.** O resto do painel
 * substitui o DOM da aba inteira a cada evento (`app.js#paint`). Um
 * `Terminal` do xterm e o `WebSocket` da sessão não sobrevivem a isso se
 * forem recriados toda vez — perderiam conexão e scrollback a cada rajada de
 * evento do kernel. A saída: o container de cada sessão é criado UMA vez e
 * guardado em `SESSIONS` (módulo, sobrevive a redesenhos); `render()` só
 * reencaixa o mesmo nó na árvore nova, o que o DOM trata como mover, não
 * recriar — o xterm dentro dele nem percebe.
 */
import { h } from '../lib/dom.js'
import { api, apiPath, qs } from '../lib/api.js'
import {
  button,
  card,
  confirmDialog,
  empty,
  notice,
  page,
  pageHead,
  pill,
  readOnlyNotice,
  skeletonRows,
  toast,
  toastError,
} from '../lib/ui.js'
import { asArray } from '../lib/aggregate.js'
import { since } from '../lib/format.js'
import { emit } from '../lib/store.js'
import { Terminal } from '../lib/xterm/xterm.mjs'
import { FitAddon } from '../lib/xterm/addon-fit.mjs'
import { Unicode11Addon } from '../lib/xterm/addon-unicode11.mjs'

export const meta = {
  id: 'terminal',
  label: 'Terminal',
  group: 'Gerenciar',
  icon: 'terminal',
  needs: ['terminals'],
}

/** `id da sessão → { div, term, fit, socket }`. Vive entre redesenhos. */
const SESSIONS = new Map()
let active

function xtermTheme() {
  const styles = getComputedStyle(document.documentElement)
  // `--bg-2`/`--fg-1` são canais "R G B" crus (precisam do wrapper `rgb()`);
  // `--tint-3` já é um `rgb(... / alfa)` completo — embrulhar de novo quebraria.
  const rgb = (name) => `rgb(${styles.getPropertyValue(name).trim()})`
  return {
    background: rgb('--bg-2'),
    foreground: rgb('--fg-1'),
    cursor: rgb('--fg-1'),
    selectionBackground: styles.getPropertyValue('--tint-3').trim(),
  }
}

function socketUrl(id) {
  const base = location.origin.replace(/^http/, 'ws')
  return `${base}/api/terminals/${encodeURIComponent(id)}/socket${qs}`
}

function ensureSession(id) {
  let entry = SESSIONS.get(id)
  if (entry !== undefined) return entry

  const div = h('div', { class: 'terminal-pane' })
  const term = new Terminal({
    fontSize: 13,
    // Fonte mono real, com cobertura completa de box-drawing e braille — é o
    // que o Claude Code (Ink) usa pro spinner e pros quadros da tela cheia.
    // `Cascadia Mono`/`Consolas` vêm antes das fontes do sistema por isso.
    fontFamily: '"Cascadia Mono", Consolas, "SFMono-Regular", ui-monospace, Menlo, monospace',
    cursorBlink: true,
    scrollback: 5000,
    // Sem isto o xterm mede largura de caractere "wide" (CJK/emoji/box-drawing)
    // pela heurística antiga, que erra especificamente nos glifos que o
    // spinner e a arte do Claude Code usam — era a causa do "boneco bugado":
    // colunas desalinhando a cada frame redesenhado pelo Ink.
    allowProposedApi: true,
    theme: xtermTheme(),
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.loadAddon(new Unicode11Addon())
  term.unicode.activeVersion = '11'
  term.open(div)

  // `ResizeObserver` em vez de só `window.resize` + um `requestAnimationFrame`
  // único: cobre trocar de aba (o container passa de `display:none` para
  // visível, o que não dispara resize nenhum do browser), redimensionar a
  // janela, e a barra lateral. Sem isso o xterm e o PTY do servidor podiam
  // divergir de tamanho pro resto da sessão inteira — a segunda causa mais
  // provável de tela desalinhada num app de tela cheia como o Claude Code.
  const resizeObserver = new ResizeObserver(() => fit.fit())
  resizeObserver.observe(div)

  let socket
  const connect = () => {
    socket = new WebSocket(socketUrl(id))
    socket.addEventListener('open', () => {
      // Espera as fontes carregarem antes da primeira medição: `fit()` antes
      // disso mede a métrica de caractere com uma fonte de fallback e o
      // primeiro frame já nasce com cols/rows errados.
      void (document.fonts?.ready ?? Promise.resolve()).then(() => {
        fit.fit()
        sendResize()
      })
    })
    socket.addEventListener('message', (event) => {
      let msg
      try {
        msg = JSON.parse(event.data)
      } catch {
        return
      }
      if (msg.type === 'data') term.write(msg.data)
      else if (msg.type === 'exit') {
        term.write(`\r\n\r\n[processo encerrado${msg.exitCode === null ? '' : ` — código ${msg.exitCode}`}]\r\n`)
      }
    })
    socket.addEventListener('close', () => {
      // Reconecta sozinho se a sessão ainda existir do lado do servidor —
      // uma queda de rede não devia obrigar a pessoa a abrir tudo de novo.
      if (SESSIONS.has(id)) setTimeout(() => reconnectIfNeeded(id), 1500)
    })
  }
  const reconnectIfNeeded = (sessionId) => {
    const current = SESSIONS.get(sessionId)
    if (current === undefined || current.socket?.readyState === WebSocket.OPEN) return
    connect()
  }
  connect()

  const sendResize = () => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
    }
  }

  term.onData((data) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'input', data }))
  })
  term.onResize(sendResize)

  entry = {
    div,
    term,
    fit,
    resizeObserver,
    get socket() { return socket },
    set socket(value) { socket = value },
  }
  SESSIONS.set(id, entry)
  return entry
}

function disposeSession(id) {
  const entry = SESSIONS.get(id)
  if (entry === undefined) return
  entry.resizeObserver.disconnect()
  try {
    entry.socket?.close()
  } catch {
    /* já fechado */
  }
  entry.term.dispose()
  SESSIONS.delete(id)
}

async function createSession(ctx, profile) {
  try {
    const created = await api.post('/api/terminals', { profile })
    active = created.session.id
    await ctx.reload(['terminals'])
  } catch (error) {
    toastError(error)
  }
}

async function closeSession(ctx, id) {
  const yes = await confirmDialog({
    title: 'Encerrar esta sessão?',
    description: 'O processo é morto de verdade — como fechar um terminal de verdade.',
    confirmLabel: 'Encerrar',
  })
  if (!yes) return
  try {
    await api.del(apiPath('/api/terminals', id))
    disposeSession(id)
    if (active === id) active = undefined
    toast('Sessão encerrada.', 'success')
    await ctx.reload(['terminals'])
  } catch (error) {
    toastError(error)
  }
}

function sessionTab(ctx, session) {
  const isActive = session.id === active
  return h(
    'button',
    {
      type: 'button',
      class: 'navitem',
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        width: 'auto',
        ...(isActive ? { background: 'var(--tint-2)' } : {}),
      },
      'aria-current': isActive ? 'page' : undefined,
      on: {
        click: () => {
          active = session.id
          emit()
        },
      },
    },
    pill(session.label, session.alive ? 'success' : 'neutral'),
    h('span', { text: session.id.slice(0, 8) }),
    h('span', {
      class: 'navitem__count',
      text: '×',
      title: 'Encerrar sessão',
      on: {
        click: (event) => {
          event.stopPropagation()
          void closeSession(ctx, session.id)
        },
      },
    }),
  )
}

export function render(ctx) {
  const resource = ctx.res('terminals')

  if (resource.status === 'loading') {
    return page(pageHead({ title: 'Terminal' }), skeletonRows(4))
  }

  const payload = resource.data ?? { sessions: [], profiles: [] }
  const sessions = asArray(payload.sessions)
  const profiles = asArray(payload.profiles)

  // Sessões que sumiram do servidor (encerradas em outra aba) perdem o xterm.
  for (const id of [...SESSIONS.keys()]) {
    if (!sessions.some((s) => s.id === id)) disposeSession(id)
  }
  if (active === undefined || !sessions.some((s) => s.id === active)) {
    active = sessions[0]?.id
  }

  const head = pageHead({
    title: 'Terminal',
    description: 'Sessões de verdade — o mesmo `claude` ou shell que rodaria no seu terminal.',
    actions:
      resource.status === 'unavailable'
        ? []
        : profiles.map((profile) =>
            button({
              label: `+ ${profile}`,
              iconName: 'plus',
              onClick: () => createSession(ctx, profile),
            }),
          ),
  })

  if (resource.status === 'unavailable') {
    return page(head, readOnlyNotice('abrir terminais'))
  }

  if (profiles.length === 0 && sessions.length === 0) {
    return page(
      head,
      notice({
        tone: 'neutral',
        title: 'Nenhum perfil de terminal configurado',
        text: 'Suba o painel a partir de um projeto com `uranus dashboard` ou `uranus start` para ' +
          'ter os perfis "claude" e "shell" disponíveis.',
      }),
    )
  }

  if (sessions.length === 0) {
    return page(
      head,
      card({
        body: empty({
          iconName: 'terminal',
          title: 'Nenhuma sessão aberta',
          description: 'Abra uma sessão do Claude ou de um shell — cada uma é um processo de verdade.',
          action: button({
            label: `Abrir ${profiles[0]}`,
            variant: 'primary',
            iconName: 'plus',
            onClick: () => createSession(ctx, profiles[0]),
          }),
        }),
      }),
    )
  }

  const activeSession = sessions.find((s) => s.id === active)
  const entry = activeSession ? ensureSession(activeSession.id) : undefined
  if (entry !== undefined) requestAnimationFrame(() => entry.fit.fit())

  return page(
    head,
    h('div', { class: 'terminal-tabs' }, sessions.map((session) => sessionTab(ctx, session))),
    card({
      flush: true,
      body: entry !== undefined ? entry.div : empty({ iconName: 'terminal', title: 'Selecione uma sessão' }),
    }),
  )
}
