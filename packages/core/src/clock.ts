import { AbortedError } from './errors.js'

/**
 * O tempo é injetado, nunca lido direto de `Date.now()` dentro do domínio.
 *
 * Motivo prático: o teste de caos e os testes de lease com TTL precisam avançar
 * o relógio sem esperar de verdade. Um `Date.now()` escondido em qualquer módulo
 * transforma um teste determinístico de 5ms em um `setTimeout` de 30 segundos.
 */
export interface Clock {
  /** Epoch em milissegundos. Sujeito a ajuste de relógio do sistema. */
  now(): number
  /** Monotônico em milissegundos. Use para medir duração, nunca `now()`. */
  monotonic(): number
  sleep(ms: number, signal?: AbortSignal): Promise<void>
}

export const systemClock: Clock = {
  now: () => Date.now(),
  monotonic: () => performance.now(),
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(new AbortedError('sleep abortado antes de iniciar'))
        return
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }, ms)
      const onAbort = (): void => {
        clearTimeout(timer)
        reject(new AbortedError('sleep abortado'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
    }),
}

/** Mede a duração de uma operação usando o relógio monotônico. */
export async function timed<T>(
  clock: Clock,
  fn: () => Promise<T>,
): Promise<{ value: T; durationMs: number }> {
  const started = clock.monotonic()
  const value = await fn()
  return { value, durationMs: clock.monotonic() - started }
}

/** Backoff exponencial com jitter completo. Usado em retry de provider (R14). */
export function backoffDelay(
  attempt: number,
  options: { baseMs?: number; maxMs?: number; jitter?: () => number } = {},
): number {
  const base = options.baseMs ?? 500
  const max = options.maxMs ?? 60_000
  const jitter = options.jitter ?? Math.random
  const exponential = Math.min(max, base * 2 ** Math.max(0, attempt - 1))
  return Math.round(exponential * jitter())
}
