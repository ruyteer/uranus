import type { Clock } from '@uranus/core'
import { AbortedError } from '@uranus/core'

/**
 * Relógio controlável.
 *
 * Existe para tornar viáveis dois testes que a arquitetura exige e que seriam
 * impossíveis com o relógio real: expiração de lease com TTL de 10 minutos e
 * backoff exponencial de retry. Com `Date.now()` embutido no domínio, esses
 * testes levariam minutos cada — e por isso não existiriam.
 */
export class FakeClock implements Clock {
  private current: number
  private mono = 0
  private readonly pending: { at: number; resolve: () => void; reject: (e: Error) => void }[] = []

  constructor(start = 1_700_000_000_000) {
    this.current = start
  }

  now(): number {
    return this.current
  }

  monotonic(): number {
    return this.mono
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted === true) return Promise.reject(new AbortedError('sleep abortado'))
    return new Promise<void>((resolve, reject) => {
      const entry = { at: this.current + ms, resolve, reject }
      this.pending.push(entry)
      signal?.addEventListener(
        'abort',
        () => {
          const index = this.pending.indexOf(entry)
          if (index >= 0) this.pending.splice(index, 1)
          reject(new AbortedError('sleep abortado'))
        },
        { once: true },
      )
    })
  }

  /** Avança o tempo e resolve os `sleep` cujo prazo venceu. */
  advance(ms: number): void {
    this.current += ms
    this.mono += ms
    const due = this.pending.filter((entry) => entry.at <= this.current)
    for (const entry of due) {
      this.pending.splice(this.pending.indexOf(entry), 1)
      entry.resolve()
    }
  }

  /** Avança e cede o event loop, para que continuações de `await` rodem. */
  async advanceAsync(ms: number): Promise<void> {
    this.advance(ms)
    await Promise.resolve()
    await new Promise((resolve) => setImmediate(resolve))
  }

  set(epochMs: number): void {
    this.current = epochMs
  }

  get pendingSleeps(): number {
    return this.pending.length
  }
}
