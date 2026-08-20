/**
 * Semáforo simples com limite fixo. Usado pra respeitar
 * `ProviderCapabilities.maxConcurrentSessions` sob execução concorrente
 * (Fase 9) — sem isto, um provider local de GPU única pode receber N sessões
 * simultâneas assim que o kernel deixa de ser sequencial.
 */
export interface Semaphore {
  /**
   * Resolve quando um slot fica livre. Quem chama DEVE invocar o `release()`
   * retornado exatamente uma vez. Rejeita se `signal` abortar antes de um
   * slot ficar disponível.
   */
  acquire(signal?: AbortSignal): Promise<() => void>
}

export function createSemaphore(maxConcurrent: number): Semaphore {
  let inUse = 0
  const waiters: { resolve: (release: () => void) => void; reject: (err: Error) => void }[] = []

  function release(): void {
    inUse -= 1
    const next = waiters.shift()
    if (next !== undefined) {
      inUse += 1
      next.resolve(release)
    }
  }

  return {
    acquire(signal?: AbortSignal): Promise<() => void> {
      if (signal?.aborted === true) {
        return Promise.reject(new Error('acquire abortado antes de obter um slot'))
      }
      if (inUse < maxConcurrent) {
        inUse += 1
        return Promise.resolve(release)
      }
      return new Promise<() => void>((resolve, reject) => {
        const waiter = { resolve, reject }
        waiters.push(waiter)
        const onAbort = (): void => {
          const index = waiters.indexOf(waiter)
          if (index !== -1) {
            waiters.splice(index, 1)
            reject(new Error('acquire abortado enquanto esperava um slot'))
          }
        }
        signal?.addEventListener('abort', onAbort, { once: true })
      })
    },
  }
}
