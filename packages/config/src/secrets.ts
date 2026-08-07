import { readFile } from 'node:fs/promises'
import { globalSecrets, type SecretProvider } from '@uranus/core'

/**
 * Resolução de segredos — R12.
 *
 * Duas garantias, ambas no mesmo lugar:
 *  1. O segredo é resolvido **no momento do uso**, nunca carregado antecipadamente
 *     para dentro de um objeto de config que depois vai parar em um log.
 *  2. Todo valor resolvido é registrado em `globalSecrets`, de modo que qualquer
 *     saída posterior — inclusive stdout de subprocesso — já sai redigida.
 */

/** `env:ANTHROPIC_API_KEY` */
export function envSecretProvider(
  env: Readonly<Record<string, string | undefined>> = process.env,
): SecretProvider {
  return {
    async resolve(ref: string): Promise<string | undefined> {
      if (!ref.startsWith('env:')) return undefined
      const value = env[ref.slice(4)]
      if (value !== undefined) globalSecrets.register(value)
      return Promise.resolve(value)
    },
    async has(ref: string): Promise<boolean> {
      return Promise.resolve(ref.startsWith('env:') && env[ref.slice(4)] !== undefined)
    },
  }
}

/** `file:/caminho/para/segredo` */
export function fileSecretProvider(): SecretProvider {
  return {
    async resolve(ref: string): Promise<string | undefined> {
      if (!ref.startsWith('file:')) return undefined
      try {
        const value = (await readFile(ref.slice(5), 'utf8')).trim()
        globalSecrets.register(value)
        return value
      } catch {
        return undefined
      }
    },
    async has(ref: string): Promise<boolean> {
      if (!ref.startsWith('file:')) return false
      try {
        await readFile(ref.slice(5), 'utf8')
        return true
      } catch {
        return false
      }
    },
  }
}

/** Encadeia provedores; o primeiro que resolve vence. */
export function chainSecretProviders(...providers: readonly SecretProvider[]): SecretProvider {
  return {
    async resolve(ref: string): Promise<string | undefined> {
      for (const provider of providers) {
        const value = await provider.resolve(ref)
        if (value !== undefined) return value
      }
      return undefined
    },
    async has(ref: string): Promise<boolean> {
      for (const provider of providers) {
        if (await provider.has(ref)) return true
      }
      return false
    },
  }
}

export function defaultSecretProvider(): SecretProvider {
  return chainSecretProviders(envSecretProvider(), fileSecretProvider())
}
