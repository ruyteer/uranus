import type { Semaphore } from '@uranus/core'
import { createSemaphore } from '@uranus/core'

/**
 * Um semáforo por `providerId`, criado sob demanda. Vive aqui — não no pool
 * de workers do kernel — porque `DefaultAgentRuntime.run()` é o único ponto
 * de chamada de `provider.createSession()` do sistema inteiro: Executor,
 * Planner e todos os gates de qualidade passam por ele. Limitar só no kernel
 * deixaria de contar as sessões que os gates abrem dentro da fase `integrate`
 * de uma única task — exatamente o caso que mais importa pra um provider
 * local de GPU única (`maxConcurrentSessions: 1`).
 */
export interface SessionLimiter {
  run<T>(
    providerId: string,
    maxConcurrent: number,
    fn: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T>
}

export function createSessionLimiter(): SessionLimiter {
  const semaphores = new Map<string, Semaphore>()

  function semaphoreFor(providerId: string, maxConcurrent: number): Semaphore {
    let existing = semaphores.get(providerId)
    if (existing === undefined) {
      existing = createSemaphore(maxConcurrent)
      semaphores.set(providerId, existing)
    }
    return existing
  }

  return {
    async run<T>(
      providerId: string,
      maxConcurrent: number,
      fn: () => Promise<T>,
      signal?: AbortSignal,
    ): Promise<T> {
      const release = await semaphoreFor(providerId, maxConcurrent).acquire(signal)
      try {
        return await fn()
      } finally {
        release()
      }
    },
  }
}
