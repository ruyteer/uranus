import type { LogRecord, Logger } from '@uranus/core'
import { createLogger } from '@uranus/core'

/** Logger que acumula registros em memória, para asserção em teste. */
export class RecordingLogger {
  readonly records: LogRecord[] = []
  readonly logger: Logger

  constructor(level: 'trace' | 'debug' | 'info' | 'warn' | 'error' = 'trace') {
    this.logger = createLogger({
      level,
      sink: (record) => this.records.push(record),
    })
  }

  messages(level?: LogRecord['level']): readonly string[] {
    return this.records
      .filter((r) => level === undefined || r.level === level)
      .map((r) => r.message)
  }

  has(level: LogRecord['level'], substring: string): boolean {
    return this.records.some((r) => r.level === level && r.message.includes(substring))
  }

  clear(): void {
    this.records.length = 0
  }
}
