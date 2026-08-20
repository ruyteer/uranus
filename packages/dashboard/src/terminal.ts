import { randomUUID } from 'node:crypto'
import * as pty from 'node-pty'
import type { IPty } from 'node-pty'
import type { WebSocket } from 'ws'
import type { Logger, Result } from '@uranus/core'
import { ValidationError, err, ok } from '@uranus/core'

/**
 * Terminal embutido — sessões de PTY de verdade, não um mock de linha de
 * comando.
 *
 * "Uranus é a armadura" (ver `docs/00-ARCHITECTURE`) significa que a
 * ferramenta de trabalho é uma sessão real do `claude` (ou de qualquer shell),
 * a mesma que rodaria no terminal do usuário — só que espelhada no navegador
 * via WebSocket, com múltiplas sessões e reconexão sem perder o que já
 * apareceu na tela (`buffer` reproduz o scrollback recente pra quem
 * reconecta).
 *
 * Cada sessão pode ter mais de um `WebSocket` atrelado (a mesma aba, ou duas
 * abas do painel abertas): todos veem o mesmo PTY, e a entrada de qualquer um
 * vai para o mesmo processo — é literalmente a mesma sessão, espelhada.
 */

export interface TerminalSpawnOptions {
  readonly command: string
  readonly args?: readonly string[]
  readonly cwd: string
  readonly label?: string
}

export interface TerminalSessionInfo {
  readonly id: string
  readonly label: string
  readonly command: string
  readonly startedAt: number
  readonly alive: boolean
}

/** Scrollback replay para quem conecta depois do processo já ter escrito algo. */
const SCROLLBACK_BYTES = 64 * 1024
const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24

interface Session {
  readonly id: string
  readonly label: string
  readonly command: string
  readonly startedAt: number
  readonly child: IPty
  readonly sockets: Set<WebSocket>
  buffer: string
  alive: boolean
}

export class TerminalSessionManager {
  private readonly sessions = new Map<string, Session>()

  constructor(private readonly logger: Logger) {}

  create(options: TerminalSpawnOptions): Result<TerminalSessionInfo> {
    const id = randomUUID()
    let child: IPty
    try {
      child = pty.spawn(options.command, [...(options.args ?? [])], {
        name: 'xterm-256color',
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
        cwd: options.cwd,
        env: process.env,
      })
    } catch (error: unknown) {
      return err(
        new ValidationError(`Não deu para abrir "${options.command}": ${errorText(error)}`, {
          cause: error,
        }),
      )
    }

    const session: Session = {
      id,
      label: options.label ?? options.command,
      command: options.command,
      startedAt: Date.now(),
      child,
      sockets: new Set(),
      buffer: '',
      alive: true,
    }

    child.onData((data) => {
      session.buffer = (session.buffer + data).slice(-SCROLLBACK_BYTES)
      this.broadcast(session, { type: 'data', data })
    })
    child.onExit(({ exitCode }) => {
      session.alive = false
      this.broadcast(session, { type: 'exit', exitCode })
      this.logger.info('Sessão de terminal encerrada', { id, exitCode })
    })

    this.sessions.set(id, session)
    this.logger.info('Sessão de terminal aberta', { id, command: options.command })
    return ok(this.info(session))
  }

  list(): readonly TerminalSessionInfo[] {
    return [...this.sessions.values()].map((session) => this.info(session))
  }

  /** `true` se a sessão existe e o socket foi atrelado a ela. */
  attach(id: string, socket: WebSocket): boolean {
    const session = this.sessions.get(id)
    if (session === undefined) return false

    session.sockets.add(socket)
    if (session.buffer !== '') safeSend(socket, { type: 'data', data: session.buffer })
    if (!session.alive) safeSend(socket, { type: 'exit', exitCode: null })

    socket.on('message', (raw: Buffer | string) => {
      const message = parseClientMessage(raw)
      if (message === undefined) return
      if (message.type === 'input') session.child.write(message.data)
      else {
        try {
          session.child.resize(Math.max(1, message.cols), Math.max(1, message.rows))
        } catch {
          // Resize num PTY já morto — ignora, o exit já foi/vai ser avisado.
        }
      }
    })
    socket.on('close', () => session.sockets.delete(socket))
    return true
  }

  close(id: string): boolean {
    const session = this.sessions.get(id)
    if (session === undefined) return false
    try {
      session.child.kill()
    } catch {
      // Já morto — fim que já queríamos.
    }
    for (const socket of session.sockets) {
      try {
        socket.close()
      } catch {
        /* já fechado */
      }
    }
    this.sessions.delete(id)
    return true
  }

  closeAll(): void {
    for (const id of [...this.sessions.keys()]) this.close(id)
  }

  private broadcast(session: Session, message: ServerMessage): void {
    for (const socket of session.sockets) safeSend(socket, message)
  }

  private info(session: Session): TerminalSessionInfo {
    return {
      id: session.id,
      label: session.label,
      command: session.command,
      startedAt: session.startedAt,
      alive: session.alive,
    }
  }
}

type ServerMessage = { type: 'data'; data: string } | { type: 'exit'; exitCode: number | null }
type ClientMessage =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }

function safeSend(socket: WebSocket, message: ServerMessage): void {
  try {
    socket.send(JSON.stringify(message))
  } catch {
    // Socket fechando no meio do envio — o handler de 'close' cuida da limpeza.
  }
}

function parseClientMessage(raw: Buffer | string): ClientMessage | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'))
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const value = parsed as Record<string, unknown>
  if (value['type'] === 'input' && typeof value['data'] === 'string') {
    return { type: 'input', data: value['data'] }
  }
  if (value['type'] === 'resize' && typeof value['cols'] === 'number' && typeof value['rows'] === 'number') {
    return { type: 'resize', cols: value['cols'], rows: value['rows'] }
  }
  return undefined
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
