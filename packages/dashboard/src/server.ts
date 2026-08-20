import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { timingSafeEqual } from 'node:crypto'
import { WebSocketServer } from 'ws'
import type {
  ApprovalDecision,
  ApprovalId,
  ApprovalRequest,
  Clock,
  EventBus,
  HumanGate,
  Logger,
  Result,
} from '@uranus/core'
import type { TelemetryAggregator } from '@uranus/telemetry'
import type { DashboardData } from './data.js'
import { DataRoutes } from './data-routes.js'
import { ClaudeActivityLog, isClaudeActivityEntry } from './claude-activity.js'
import { SECURITY_HEADERS, errorMessage, methodNotAllowed, readJson, sendJson } from './http.js'
import { readPublicAsset } from './static-files.js'
import type { SseHub } from './sse.js'
import { TerminalSessionManager, type TerminalSpawnOptions } from './terminal.js'

export interface DashboardOptions {
  readonly aggregator: TelemetryAggregator
  readonly events: EventBus
  readonly humanGate?: HumanGate
  readonly logger: Logger
  readonly clock: Clock
  readonly port?: number
  /**
   * Endereço de escuta. O padrão é loopback e é deliberado: este servidor
   * mostra o código do usuário e concede aprovações. Expor na rede é uma
   * decisão que precisa ser tomada, não herdada.
   */
  readonly host?: string
  /** Token exigido em toda requisição. Obrigatório fora de loopback. */
  readonly token?: string
  /** Ações que mudam estado (aprovar, pausar). Sem isto, o painel é só leitura. */
  readonly control?: DashboardControl
  /**
   * Porta de leitura e escrita de tasks, backlog e config.
   *
   * Ausente, as rotas de CRUD devolvem 503 e o painel continua sendo o
   * observador que sempre foi. É opcional porque `uranus dashboard` pode subir
   * sem um projeto montado por trás, e nesse caso não há o que gerenciar.
   */
  readonly data?: DashboardData
  /**
   * Perfis de terminal que a aba "Terminal" pode abrir (`claude`, `shell`, …).
   * Ausente, `/api/terminals` devolve 503 — mesmo critério de `data`: sem
   * projeto montado, não há `cwd` nem binário do Claude para spawnar.
   */
  readonly terminalProfiles?: Readonly<Record<string, TerminalSpawnOptions>>
}

export interface DashboardControl {
  pause?(reason: string): Promise<void> | void
  resume?(): Promise<void> | void
  stop?(reason: string): Promise<void> | void
}

/**
 * Servidor do dashboard.
 *
 * **Sobre não usar Fastify + React**, que era o plano da arquitetura: o painel
 * é uma página, um fluxo de eventos e um punhado de rotas. Um `node:http` com
 * SSE e assets estáticos servidos daqui entrega isso sem acrescentar um
 * bundler, um framework de UI e a cadeia de dependências dos dois a um
 * monorepo que hoje instala em segundos. A troca só vale a pena quando o painel
 * virar um produto com navegação e estado próprios — e, quando virar, o
 * roteador aqui é o único arquivo que muda.
 *
 * **Segurança:** liga em `127.0.0.1` por padrão; fora de loopback, exige token
 * e recusa subir sem ele. A autorização acontece antes do despacho, então vale
 * igualmente para as rotas de escrita. Toda resposta JSON passa por `redact`
 * (R12), e o CSP proíbe qualquer origem externa — o painel não faz chamada para
 * fora, e uma injeção que chegue ao HTML não consegue exfiltrar nada. Os
 * arquivos estáticos saem de `public/` e só de lá (ver `static-files.ts`).
 */
export class DashboardServer {
  private server: Server | undefined
  private readonly hub: SseHub
  private readonly routes: DataRoutes
  private readonly claudeActivity = new ClaudeActivityLog()
  private readonly terminals: TerminalSessionManager
  private readonly wss = new WebSocketServer({ noServer: true })
  private boundPort = 0
  private stopMemoryWatch: (() => void) | undefined

  constructor(
    private readonly options: DashboardOptions,
    hub: SseHub,
  ) {
    this.hub = hub
    this.routes = new DataRoutes(options.data, () => this.options.clock.now())
    this.terminals = new TerminalSessionManager(options.logger)
  }

  async listen(): Promise<{ url: string; port: number }> {
    const host = this.options.host ?? '127.0.0.1'
    const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1'
    if (!loopback && (this.options.token ?? '') === '') {
      throw new Error(
        `Recusando escutar em ${host} sem token. O dashboard concede aprovações e mostra o seu código; ` +
          'defina telemetry.dashboard.token ou use o host padrão 127.0.0.1.',
      )
    }

    const server = createServer((request, response) => {
      void this.handle(request, response).catch((error: unknown) => {
        this.options.logger.error('Erro no dashboard', {
          error: error instanceof Error ? error.message : String(error),
        })
        if (!response.headersSent) response.writeHead(500)
        response.end('erro interno')
      })
    })
    this.server = server
    server.on('upgrade', (request, socket, head) => {
      this.handleUpgrade(request, socket as Socket, head)
    })

    const port = await new Promise<number>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.options.port ?? 4319, host, () => {
        const address = server.address()
        resolve(typeof address === 'object' && address !== null ? address.port : 0)
      })
    })
    this.boundPort = port

    // Uma linha da timeline por evento. O painel não faz polling: o `snapshot`
    // completo só é pedido na abertura e depois de uma reconexão.
    this.options.events.onAny((event) => {
      this.hub.broadcast('event', {
        at: event.at,
        seq: event.seq,
        name: event.name,
        taskId: event.taskId,
      })
    })

    // Memória é escrita por processos que este `EventBus` (em memória, por
    // processo) nunca vê — `uranus start`/`uranus chat` rodando em outro
    // terminal. Sem isto, a aba Memória só convergia no poll de 10s do
    // cliente (e só se estivesse aberta); com isto, vira um SSE quase
    // imediato, igual a qualquer outro evento.
    this.stopMemoryWatch = this.options.data?.memory?.watch?.(() => {
      this.hub.broadcast('event', {
        at: this.options.clock.now(),
        seq: -1,
        name: 'MemoryUpdatedExternally',
      })
    })

    return { url: `http://${loopback ? 'localhost' : host}:${String(port)}`, port }
  }

  async close(): Promise<void> {
    this.stopMemoryWatch?.()
    this.hub.close()
    this.terminals.closeAll()
    const server = this.server
    if (server === undefined) return
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
      // Conexões SSE são de longa duração: sem isto, `close()` esperaria para
      // sempre por um painel que ainda está aberto.
      server.closeAllConnections()
    })
    this.server = undefined
  }

  get port(): number {
    return this.boundPort
  }

  // ── Roteamento ────────────────────────────────────────────────────────────

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const path = url.pathname
    const method = request.method ?? 'GET'

    // A autorização é a PRIMEIRA coisa para tudo sob `/api/`: assim não existe
    // rota de dados — nem as de hoje, nem uma acrescentada amanhã — que consiga
    // nascer fora dela.
    //
    // Os assets estáticos ficam de fora, e isso é necessário, não uma
    // conveniência: o navegador não propaga o `?token=` da URL da página para
    // os sub-recursos (folha de estilo, módulos ES, `.woff2`). Exigir token
    // neles devolvia 401 em todos e o painel travava na tela de carregamento
    // sempre que `telemetry.dashboard.token` estivesse configurado — ou seja,
    // exatamente na configuração que existe para poder expor o painel fora de
    // loopback. O que eles servem é o código do próprio painel, sem nenhum
    // dado do projeto; o segredo continua atrás de `/api/`.
    if (!path.startsWith('/api/')) {
      await this.serveStatic(method, path, response)
      return
    }

    if (!this.authorize(request, url)) {
      sendJson(response, 401, { error: 'token inválido ou ausente' })
      return
    }
    if (await this.handleObserve(method, path, request, response)) return
    if (await this.routes.handle(method, path, request, response)) return

    sendJson(response, 404, { error: 'rota desconhecida' })
  }

  /** Rotas de leitura e de controle do run. `true` = já respondida. */
  private async handleObserve(
    method: string,
    path: string,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<boolean> {
    switch (path) {
      case '/api/stream': {
        if (method !== 'GET') methodNotAllowed(response, ['GET'])
        else this.hub.add(response)
        return true
      }
      case '/api/state': {
        if (method !== 'GET') {
          methodNotAllowed(response, ['GET'])
          return true
        }
        const pending = (await this.options.humanGate?.pending()) ?? []
        sendJson(response, 200, this.options.aggregator.snapshot(pending.map(approvalView)))
        return true
      }
      case '/api/metrics': {
        if (method !== 'GET') {
          methodNotAllowed(response, ['GET'])
          return true
        }
        const text = await this.options.aggregator.prometheus()
        response.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' })
        response.end(text)
        return true
      }
      case '/api/health': {
        if (method !== 'GET') methodNotAllowed(response, ['GET'])
        else
          sendJson(response, 200, {
            ok: true,
            clients: this.hub.size,
            at: this.options.clock.now(),
          })
        return true
      }
      case '/api/claude-activity': {
        if (method === 'GET') {
          sendJson(response, 200, { entries: this.claudeActivity.recent() })
          return true
        }
        if (method !== 'POST') {
          methodNotAllowed(response, ['GET', 'POST'])
          return true
        }
        // O relay dos hooks do Claude Code roda fora do controle do usuário no
        // momento em que dispara (é o próprio Claude Code chamando); um corpo
        // mal formado é ruído a ignorar, não motivo para responder erro — o
        // hook não deve travar a sessão do usuário por causa do painel.
        const body = await readJson(request)
        const entry = body === undefined ? undefined : isClaudeActivityEntry(body)
        if (entry !== undefined) {
          this.claudeActivity.push(entry)
          this.hub.broadcast('claude-activity', entry)
        }
        sendJson(response, 200, { ok: entry !== undefined })
        return true
      }
      case '/api/control/pause': {
        if (method !== 'POST') {
          methodNotAllowed(response, ['POST'])
          return true
        }
        await this.options.control?.pause?.('pausado pelo dashboard')
        sendJson(response, 200, { ok: this.options.control?.pause !== undefined })
        return true
      }
      case '/api/control/resume': {
        if (method !== 'POST') {
          methodNotAllowed(response, ['POST'])
          return true
        }
        await this.options.control?.resume?.()
        sendJson(response, 200, { ok: this.options.control?.resume !== undefined })
        return true
      }
      case '/api/terminals': {
        if (method === 'GET') {
          sendJson(response, 200, { sessions: this.terminals.list(), profiles: this.terminalProfileIds() })
          return true
        }
        if (method !== 'POST') {
          methodNotAllowed(response, ['GET', 'POST'])
          return true
        }
        await this.createTerminal(request, response)
        return true
      }
      default:
        break
    }

    if (path.startsWith('/api/approvals/')) {
      if (method !== 'POST') methodNotAllowed(response, ['POST'])
      else await this.handleApproval(request, response, path.slice('/api/approvals/'.length))
      return true
    }
    if (path.startsWith('/api/terminals/')) {
      const id = decodeURIComponent(path.slice('/api/terminals/'.length))
      if (method !== 'DELETE' || id === '' || id.includes('/')) {
        methodNotAllowed(response, ['DELETE'])
        return true
      }
      sendJson(response, 200, { ok: this.terminals.close(id) })
      return true
    }
    return false
  }

  private terminalProfileIds(): readonly string[] {
    return Object.keys(this.options.terminalProfiles ?? {})
  }

  private async createTerminal(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const profiles = this.options.terminalProfiles
    if (profiles === undefined || Object.keys(profiles).length === 0) {
      sendJson(response, 503, { error: 'nenhum perfil de terminal configurado para este projeto' })
      return
    }
    const body = await readJson(request)
    const profileId = typeof body?.['profile'] === 'string' ? body['profile'] : undefined
    const profile = profileId === undefined ? undefined : profiles[profileId]
    if (profile === undefined) {
      sendJson(response, 400, {
        error: `perfil inválido; use um de: ${Object.keys(profiles).join(', ')}`,
      })
      return
    }
    const created = this.terminals.create(profile)
    if (!created.ok) {
      sendJson(response, 500, { error: errorMessage(created.error) })
      return
    }
    sendJson(response, 201, { session: created.value })
  }

  /**
   * Upgrade HTTP → WebSocket para `/api/terminals/<id>/socket`.
   *
   * Fora do roteador JSON de propósito: `ws` intercepta o evento `upgrade` do
   * `http.Server` diretamente, antes de qualquer coisa virar `IncomingMessage`
   * respondível. A autorização é a mesma de `/api/*` — token na query, porque
   * o `WebSocket` do navegador não manda cabeçalho `Authorization` custom.
   */
  private handleUpgrade(request: IncomingMessage, socket: Socket, head: Buffer): void {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const match = /^\/api\/terminals\/([^/]+)\/socket$/.exec(url.pathname)
    if (match === null || !this.authorize(request, url)) {
      socket.destroy()
      return
    }
    const id = decodeURIComponent(match[1] ?? '')
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      if (!this.terminals.attach(id, ws)) {
        ws.close(4004, 'sessão não existe')
      }
    })
  }

  private async handleApproval(
    request: IncomingMessage,
    response: ServerResponse,
    rawId: string,
  ): Promise<void> {
    const gate = this.options.humanGate
    if (gate === undefined) {
      sendJson(response, 503, { error: 'nenhuma fila de aprovação conectada' })
      return
    }

    const body = await readJson(request)
    const effect = body?.['effect']
    if (body === undefined || (effect !== 'granted' && effect !== 'denied')) {
      sendJson(response, 400, { error: 'effect deve ser "granted" ou "denied"' })
      return
    }

    const note = typeof body['note'] === 'string' ? body['note'] : undefined
    const at = this.options.clock.now()
    // `by` identifica que veio do painel. Uma aprovação sem autor rastreável
    // não é supervisão humana registrada, é um carimbo.
    const decision: ApprovalDecision =
      effect === 'granted'
        ? { effect: 'granted', by: 'dashboard', at, ...(note === undefined ? {} : { note }) }
        : { effect: 'denied', by: 'dashboard', at, reason: note ?? 'negado pelo dashboard' }

    const result: Result<void> = await gate.resolve(
      decodeURIComponent(rawId) as ApprovalId,
      decision,
    )
    if (!result.ok) {
      // 409 e não 500: a causa quase sempre é a aprovação já ter sido decidida
      // em outra aba ou pelo CLI, e isso é conflito de estado, não defeito.
      sendJson(response, 409, { error: result.error.message })
      return
    }
    sendJson(response, 200, { ok: true })
  }

  private authorize(request: IncomingMessage, url: URL): boolean {
    const expected = this.options.token
    if (expected === undefined || expected === '') return true
    const header = request.headers.authorization ?? ''
    const provided = header.startsWith('Bearer ')
      ? header.slice(7)
      : (url.searchParams.get('token') ?? '')
    return safeEqual(provided, expected)
  }

  /**
   * Assets de `public/`: o HTML, a folha de estilo, os módulos e as fontes.
   *
   * Toda a checagem de caminho mora em `readPublicAsset` — este método só
   * escolhe o verbo e escreve os cabeçalhos. `no-store` porque o painel serve
   * uma pessoa numa máquina local: economizar um GET de CSS não vale um
   * "recarreguei e continua a versão velha".
   */
  private async serveStatic(method: string, path: string, response: ServerResponse): Promise<void> {
    if (method !== 'GET' && method !== 'HEAD') {
      methodNotAllowed(response, ['GET', 'HEAD'])
      return
    }
    const asset = await readPublicAsset(path)
    if (asset === undefined) {
      sendJson(response, 404, { error: 'arquivo não encontrado' })
      return
    }
    response.writeHead(200, {
      'content-type': asset.contentType,
      'content-length': asset.body.byteLength,
      'cache-control': 'no-store',
      ...SECURITY_HEADERS,
    })
    response.end(method === 'HEAD' ? undefined : asset.body)
  }
}

function approvalView(request: ApprovalRequest): Record<string, unknown> {
  return {
    id: request.id,
    kind: request.kind,
    title: request.title,
    detail: request.detail,
    risk: request.risk,
    taskId: request.taskId,
    requestedAt: request.requestedAt,
    expiresAt: request.expiresAt,
  }
}

/** Comparação em tempo constante: token não vaza por diferença de tempo. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export { uiPath } from './static-files.js'
