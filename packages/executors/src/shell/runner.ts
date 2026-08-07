import { execFile, spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import type {
  Clock,
  Logger,
  ShellCommand,
  ShellProcess,
  ShellResult,
  ShellRunner,
} from '@uranus/core'
import { redactText } from '@uranus/core'
import { OutputCollector } from './output.js'

const DEFAULT_MAX_OUTPUT = 1024 * 1024 // 1 MiB por stream

export interface DefaultShellRunnerOptions {
  readonly clock: Clock
  readonly logger: Logger
}

/**
 * Implementação única de execução de processos (ADR-011).
 *
 * Decisões que diferem do `child_process` cru:
 *  - `shell: true` no Windows usa `cmd.exe /d /s /c`; em POSIX, `/bin/sh`. Nunca
 *    montamos a string do comando por concatenação fora daqui.
 *  - Timeout mata a **árvore** de processos: `taskkill /T /F` no Windows,
 *    kill de process group (`-pid`) em POSIX. Matar só o pai deixa um `vitest`
 *    órfão rodando para sempre — e o teto de tempo do contrato viraria ficção.
 *  - stdout/stderr passam por redação de segredos antes de sair daqui (R12).
 */
export class DefaultShellRunner implements ShellRunner {
  private readonly clock: Clock
  private readonly logger: Logger

  constructor(options: DefaultShellRunnerOptions) {
    this.clock = options.clock
    this.logger = options.logger.child({ component: 'shell' })
  }

  async run(command: ShellCommand, signal: AbortSignal): Promise<ShellResult> {
    return this.spawn(command, signal).wait()
  }

  spawn(command: ShellCommand, signal: AbortSignal): ShellProcess {
    const started = this.clock.monotonic()
    const maxBytes = command.maxOutputBytes ?? DEFAULT_MAX_OUTPUT
    const stdout = new OutputCollector(maxBytes)
    const stderr = new OutputCollector(maxBytes)

    const useShell = command.shell === true
    const child = spawn(command.command, command.args === undefined ? [] : [...command.args], {
      cwd: command.cwd,
      env: { ...process.env, ...command.env },
      shell: useShell,
      windowsHide: true,
      // POSIX: grupo próprio para conseguir matar a árvore com kill(-pid).
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let timedOut = false
    let settled = false
    let spawnError: Error | undefined

    const killTree = (): void => {
      if (child.pid === undefined || settled) return
      killProcessTree(child)
    }

    const timer = setTimeout(() => {
      timedOut = true
      this.logger.warn('Comando estourou o timeout; matando a árvore de processos', {
        command: command.command,
        timeoutMs: command.timeoutMs,
      })
      killTree()
    }, command.timeoutMs)

    const onAbort = (): void => {
      killTree()
    }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()

    child.stdout.on('data', (chunk: Buffer) => {
      stdout.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr.push(chunk)
    })
    child.on('error', (error) => {
      spawnError = error
    })

    if (command.stdin !== undefined) {
      child.stdin.write(command.stdin)
    }
    child.stdin.end()

    const result = new Promise<ShellResult>((resolve) => {
      child.on('close', (code, sig) => {
        settled = true
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)

        // ENOENT e afins não emitem 'close' com código útil; o erro de spawn é
        // reportado como exit 127 (convenção "command not found") com a mensagem
        // no stderr — assim o Verifier e o classificador têm um caminho só.
        const exitCode = spawnError !== undefined ? 127 : (code ?? (timedOut ? 124 : 1))
        const stderrText =
          spawnError !== undefined
            ? `${redactText(stderr.toString())}\n${spawnError.message}`
            : redactText(stderr.toString())

        resolve({
          exitCode,
          stdout: redactText(stdout.toString()),
          stderr: stderrText,
          durationMs: Math.round(this.clock.monotonic() - started),
          timedOut,
          truncated: stdout.truncated || stderr.truncated,
          ...(sig === null ? {} : { signal: sig }),
        })
      })
    })

    return {
      ...(child.pid === undefined ? {} : { pid: child.pid }),
      stdout: () => streamLines(child, 'stdout'),
      stderr: () => streamLines(child, 'stderr'),
      write: (data: string) =>
        new Promise<void>((resolve, reject) => {
          child.stdin.write(data, (error) => {
            if (error == null) resolve()
            else reject(error)
          })
        }),
      wait: () => result,
      kill: (sig?: string) => {
        if (sig === undefined) killTree()
        else child.kill(sig as NodeJS.Signals)
        return Promise.resolve()
      },
    }
  }
}

function killProcessTree(child: ChildProcess): void {
  const pid = child.pid
  if (pid === undefined) return
  if (process.platform === 'win32') {
    // /T = árvore inteira, /F = forçado. É o único jeito confiável no Windows.
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => {
      /* processo pode já ter morrido; nada a fazer */
    })
  } else {
    try {
      process.kill(-pid, 'SIGKILL') // grupo (detached acima)
    } catch {
      child.kill('SIGKILL')
    }
  }
}

async function* streamLines(
  child: ChildProcess,
  which: 'stdout' | 'stderr',
): AsyncIterable<string> {
  const stream = which === 'stdout' ? child.stdout : child.stderr
  if (stream === null) return
  let buffer = ''
  for await (const chunk of stream) {
    buffer += (chunk as Buffer).toString('utf8')
    let index = buffer.indexOf('\n')
    while (index >= 0) {
      yield redactText(buffer.slice(0, index).replace(/\r$/, ''))
      buffer = buffer.slice(index + 1)
      index = buffer.indexOf('\n')
    }
  }
  if (buffer.length > 0) yield redactText(buffer)
}
