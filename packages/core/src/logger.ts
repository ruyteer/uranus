import { redact } from './util/redact.js'
import type { Clock } from './clock.js'
import { systemClock } from './clock.js'

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent'

const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  silent: 100,
}

export interface Logger {
  readonly level: LogLevel
  child(bindings: Readonly<Record<string, unknown>>): Logger
  trace(message: string, data?: Readonly<Record<string, unknown>>): void
  debug(message: string, data?: Readonly<Record<string, unknown>>): void
  info(message: string, data?: Readonly<Record<string, unknown>>): void
  warn(message: string, data?: Readonly<Record<string, unknown>>): void
  error(message: string, data?: Readonly<Record<string, unknown>>): void
}

export interface LogRecord {
  readonly at: number
  readonly level: Exclude<LogLevel, 'silent'>
  readonly message: string
  readonly bindings: Readonly<Record<string, unknown>>
  readonly data?: Readonly<Record<string, unknown>>
}

export type LogSink = (record: LogRecord) => void

export interface LoggerOptions {
  readonly level?: LogLevel
  readonly bindings?: Readonly<Record<string, unknown>>
  readonly sink?: LogSink
  readonly clock?: Clock
}

/**
 * Sink padrão: uma linha JSON por registro em stdout.
 *
 * Logs do Uranus são consumidos por máquina (dashboard, `uranus logs --json`)
 * antes de por humano. Formatação legível é responsabilidade da CLI, não daqui.
 */
export const jsonSink: LogSink = (record) => {
  process.stdout.write(`${JSON.stringify(record)}\n`)
}

export const nullSink: LogSink = () => {
  /* descarta */
}

class StructuredLogger implements Logger {
  constructor(
    readonly level: LogLevel,
    private readonly bindings: Readonly<Record<string, unknown>>,
    private readonly sink: LogSink,
    private readonly clock: Clock,
  ) {}

  child(bindings: Readonly<Record<string, unknown>>): Logger {
    return new StructuredLogger(
      this.level,
      { ...this.bindings, ...bindings },
      this.sink,
      this.clock,
    )
  }

  trace(message: string, data?: Readonly<Record<string, unknown>>): void {
    this.emit('trace', message, data)
  }
  debug(message: string, data?: Readonly<Record<string, unknown>>): void {
    this.emit('debug', message, data)
  }
  info(message: string, data?: Readonly<Record<string, unknown>>): void {
    this.emit('info', message, data)
  }
  warn(message: string, data?: Readonly<Record<string, unknown>>): void {
    this.emit('warn', message, data)
  }
  error(message: string, data?: Readonly<Record<string, unknown>>): void {
    this.emit('error', message, data)
  }

  private emit(
    level: Exclude<LogLevel, 'silent'>,
    message: string,
    data?: Readonly<Record<string, unknown>>,
  ): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return
    // R12: redação acontece na borda de saída, não no chamador. Um único ponto
    // para auditar é a diferença entre garantir e torcer.
    const record: LogRecord = {
      at: this.clock.now(),
      level,
      message: redact(message) as string,
      bindings: redact(this.bindings) as Record<string, unknown>,
      ...(data === undefined ? {} : { data: redact(data) as Record<string, unknown> }),
    }
    this.sink(record)
  }
}

export function createLogger(options: LoggerOptions = {}): Logger {
  return new StructuredLogger(
    options.level ?? 'info',
    options.bindings ?? {},
    options.sink ?? jsonSink,
    options.clock ?? systemClock,
  )
}

export const silentLogger: Logger = createLogger({ level: 'silent', sink: nullSink })

export function isLogLevel(value: string): value is LogLevel {
  return value in LEVEL_ORDER
}
