import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Diretório temporário com limpeza garantida.
 *
 * Usa um prefixo curto de propósito: no Windows, `%TEMP%` já consome boa parte
 * dos 260 caracteres de path, e um teste que cria um worktree dentro dele estoura
 * o limite com nome longo (R10).
 */
export interface TempDir {
  readonly path: string
  cleanup(): Promise<void>
}

export async function createTempDir(prefix = 'urn-'): Promise<TempDir> {
  const path = await mkdtemp(join(tmpdir(), prefix))
  return {
    path,
    async cleanup(): Promise<void> {
      // `maxRetries` cobre o antivírus do Windows segurando um handle (R10).
      await rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    },
  }
}

/** Executa `fn` com um diretório temporário e limpa mesmo em caso de falha. */
export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const temp = await createTempDir()
  try {
    return await fn(temp.path)
  } finally {
    await temp.cleanup()
  }
}
