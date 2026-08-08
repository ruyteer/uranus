import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
import { redact } from '@uranus/core'
import type { TelemetryAggregator } from '@uranus/telemetry'
import type { SseHub } from './sse.js'

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
 * é uma página, um fluxo de eventos e três POSTs. Um `node:http` com SSE e um
 * HTML autocontido entrega isso sem acrescentar um bundler, um framework de
 * UI e a cadeia de dependências dos dois a um monorepo que hoje instala em
 * segundos. A troca só vale a pena quando o painel virar um produto com
 * navegação e estado próprios — e, quando virar, o roteador aqui é o único
 * arquivo que muda.
 *
 * **Segurança:** liga em `127.0.0.1` por padrão; fora de loopback, exige token
 * e recusa subir sem ele. Toda resposta passa por `redact` (R12), e o CSP
 * proíbe qualquer origem externa — o painel não faz chamada para fora, e uma
 * injeção que chegue ao HTML não consegue exfiltrar nada.
 */
export class DashboardServer {
  private server: Server | undefined
  private readonly hub: SseHub
  private uiCache: string | undefined
  private boundPort = 0

  constructor(
    private readonly options: DashboardOptions,
    hub: SseHub,
  ) {
    this.hub = hub
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

    return { url: `http://${loopback ? 'localhost' : host}:${String(port)}`, port }
  }

  async close(): Promise<void> {
    this.hub.close()
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

    if (!this.authorize(request, url)) {
      this.json(response, 401, { error: 'token inválido ou ausente' })
      return
    }

    if (request.method === 'GET' && (path === '/' || path === '/index.html')) {
      await this.serveUi(response)
      return
    }
    if (request.method === 'GET' && path === '/api/stream') {
      this.hub.add(response)
      return
    }
    if (request.method === 'GET' && path === '/api/state') {
      const pending = (await this.options.humanGate?.pending()) ?? []
      this.json(response, 200, this.options.aggregator.snapshot(pending.map(approvalView)))
      return
    }
    if (request.method === 'GET' && path === '/api/metrics') {
      const text = await this.options.aggregator.prometheus()
      response.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' })
      response.end(text)
      return
    }
    if (request.method === 'GET' && path === '/api/health') {
      this.json(response, 200, { ok: true, clients: this.hub.size, at: this.options.clock.now() })
      return
    }
    if (request.method === 'POST' && path.startsWith('/api/approvals/')) {
      await this.handleApproval(request, response, path.slice('/api/approvals/'.length))
      return
    }
    if (request.method === 'POST' && path === '/api/control/pause') {
      await this.options.control?.pause?.('pausado pelo dashboard')
      this.json(response, 200, { ok: this.options.control?.pause !== undefined })
      return
    }
    if (request.method === 'POST' && path === '/api/control/resume') {
      await this.options.control?.resume?.()
      this.json(response, 200, { ok: this.options.control?.resume !== undefined })
      return
    }

    this.json(response, 404, { error: 'rota desconhecida' })
  }

  private async handleApproval(
    request: IncomingMessage,
    response: ServerResponse,
    rawId: string,
  ): Promise<void> {
    const gate = this.options.humanGate
    if (gate === undefined) {
      this.json(response, 503, { error: 'nenhuma fila de aprovação conectada' })
      return
    }

    const body = await readJson(request)
    const effect = body?.['effect']
    if (body === undefined || (effect !== 'granted' && effect !== 'denied')) {
      this.json(response, 400, { error: 'effect deve ser "granted" ou "denied"' })
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
      this.json(response, 409, { error: result.error.message })
      return
    }
    this.json(response, 200, { ok: true })
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

  private json(response: ServerResponse, status: number, body: unknown): void {
    // Redação na saída, sempre. É a última barreira antes de um segredo virar
    // pixel na tela de alguém (R12).
    const payload = JSON.stringify(redact(body))
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...SECURITY_HEADERS,
    })
    response.end(payload)
  }

  private async serveUi(response: ServerResponse): Promise<void> {
    this.uiCache ??= await readFile(uiPath(), 'utf8')
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      ...SECURITY_HEADERS,
    })
    response.end(this.uiCache)
  }
}

/**
 * O painel não carrega nada de fora e não fala com nada de fora. Se um título
 * de task com HTML malicioso chegar à página, ele não tem para onde vazar.
 */
const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy':
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data:",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
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

async function readJson(request: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > 64 * 1024) return undefined
    chunks.push(buffer)
  }
  if (chunks.length === 0) return undefined
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

/** Comparação em tempo constante: token não vaza por diferença de tempo. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/** `dist/server.js` → `../public/index.html`, e o mesmo a partir de `src/`. */
export function uiPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'index.html')
}
