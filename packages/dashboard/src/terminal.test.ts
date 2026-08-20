import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { silentLogger } from '@uranus/core'
import { TerminalSessionManager } from './terminal.js'

/** O suficiente de `ws.WebSocket` para os testes: eventos + `send`/`close`. */
class FakeSocket extends EventEmitter {
  readonly sent: string[] = []
  closed = false

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.closed = true
    this.emit('close')
  }
}

interface SentMessage {
  readonly type: string
  readonly data?: string
  readonly exitCode?: number | null
}

function parseSent(raw: string): SentMessage {
  return JSON.parse(raw) as SentMessage
}

function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tick = (): void => {
      if (predicate()) {
        resolve()
        return
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error('timeout esperando condição'))
        return
      }
      setTimeout(tick, 20)
    }
    tick()
  })
}

describe('TerminalSessionManager', () => {
  it('comando inexistente devolve Result de erro, não lança', () => {
    const manager = new TerminalSessionManager(silentLogger)
    const result = manager.create({ command: '/definitivamente/nao/existe/xyz', cwd: process.cwd() })
    expect(result.ok).toBe(false)
  })

  it('spawna, transmite a saída real do processo pro socket atrelado, e fecha ao sair', async () => {
    const manager = new TerminalSessionManager(silentLogger)
    const created = manager.create({
      command: process.execPath,
      args: ['-e', "process.stdout.write('ola-do-pty')"],
      cwd: process.cwd(),
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const socket = new FakeSocket()
    expect(manager.attach(created.value.id, socket)).toBe(true)

    await waitFor(() => socket.sent.some((raw) => parseSent(raw).data?.includes('ola-do-pty')))

    await waitFor(() => socket.sent.some((raw) => parseSent(raw).type === 'exit'))
    const exitMsg = socket.sent.map(parseSent).find((m) => m.type === 'exit')
    expect(exitMsg?.exitCode).toBe(0)
  }, 10_000)

  it('attach numa sessão inexistente devolve false, sem lançar', () => {
    const manager = new TerminalSessionManager(silentLogger)
    const socket = new FakeSocket()
    expect(manager.attach('nao-existe', socket)).toBe(false)
  })

  it('quem conecta depois ainda vê o scrollback já produzido', async () => {
    const manager = new TerminalSessionManager(silentLogger)
    const created = manager.create({
      command: process.execPath,
      args: ['-e', "process.stdout.write('primeiro'); setTimeout(() => {}, 300)"],
      cwd: process.cwd(),
    })
    if (!created.ok) throw new Error('falhou ao criar')

    const early = new FakeSocket()
    manager.attach(created.value.id, early)
    await waitFor(() => early.sent.some((raw) => parseSent(raw).data?.includes('primeiro')))

    const late = new FakeSocket()
    manager.attach(created.value.id, late)
    // O anexo tardio recebe o buffer acumulado na hora do attach, sem esperar
    // novo output do processo.
    expect(late.sent.some((raw) => parseSent(raw).data?.includes('primeiro'))).toBe(true)

    manager.close(created.value.id)
  }, 10_000)

  it('input do socket vai para o processo de verdade (digitado no PTY, ecoado de volta)', async () => {
    // Um shell real (`cmd.exe`), não `node -e`: o PTY expõe um console de
    // verdade, e é isso que se comporta como o terminal do usuário — um
    // script `node -e` lendo `process.stdin` tem TTY-detection própria que
    // não reflete o caminho real (validado à mão: escrever num `cmd.exe`
    // aberto por este mesmo `TerminalSessionManager` ecoa o comando; escrever
    // num `node -e` não, porque o script nem entra em modo flowing).
    const manager = new TerminalSessionManager(silentLogger)
    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh'
    const created = manager.create({ command: shell, cwd: process.cwd() })
    if (!created.ok) throw new Error('falhou ao criar')

    const socket = new FakeSocket()
    manager.attach(created.value.id, socket)
    socket.emit('message', JSON.stringify({ type: 'input', data: 'echo recebi-do-socket\r' }))

    await waitFor(() =>
      socket.sent.some((raw) => parseSent(raw).data?.includes('recebi-do-socket')),
    )
    manager.close(created.value.id)
  }, 10_000)

  it('close mata o processo e fecha os sockets atrelados', () => {
    const manager = new TerminalSessionManager(silentLogger)
    const created = manager.create({
      command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 5000)'],
      cwd: process.cwd(),
    })
    if (!created.ok) throw new Error('falhou ao criar')

    const socket = new FakeSocket()
    manager.attach(created.value.id, socket)
    expect(manager.close(created.value.id)).toBe(true)
    expect(socket.closed).toBe(true)
    expect(manager.list()).toHaveLength(0)
    // Fechar de novo é idempotente-friendly: não existe mais, devolve false.
    expect(manager.close(created.value.id)).toBe(false)
  })

  it('list() reflete as sessões abertas com id/label/command', () => {
    const manager = new TerminalSessionManager(silentLogger)
    const created = manager.create({
      command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 5000)'],
      label: 'minha sessão',
      cwd: process.cwd(),
    })
    if (!created.ok) throw new Error('falhou ao criar')

    const listed = manager.list()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.label).toBe('minha sessão')
    expect(listed[0]?.alive).toBe(true)
    manager.closeAll()
  })

  it('mensagem de resize malformada não derruba a sessão', () => {
    const manager = new TerminalSessionManager(silentLogger)
    const created = manager.create({
      command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 300)'],
      cwd: process.cwd(),
    })
    if (!created.ok) throw new Error('falhou ao criar')
    const socket = new FakeSocket()
    manager.attach(created.value.id, socket)

    expect(() => socket.emit('message', 'isto não é json')).not.toThrow()
    expect(() => socket.emit('message', JSON.stringify({ type: 'resize', cols: 'x' }))).not.toThrow()
    manager.close(created.value.id)
  })
})
