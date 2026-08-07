import { createHash } from 'node:crypto'
import { stableStringify } from './json.js'

/**
 * Checksums do sistema. Usados em quatro lugares onde a integridade é o requisito:
 *  - `Checkpoint.digest`  — detecta checkpoint corrompido antes de restaurar (R11)
 *  - `ContextPack.digest` — prova que dois runs receberam o mesmo contexto (ADR-007)
 *  - `CodeRef.checksum`   — invalida memória quando o código referenciado muda (R9)
 *  - `MemoryRecord.checksum` — detecta edição manual do arquivo de memória
 */

export type HashAlgorithm = 'sha256' | 'sha1'

export function hashText(text: string, algorithm: HashAlgorithm = 'sha256'): string {
  return createHash(algorithm).update(text, 'utf8').digest('hex')
}

export function hashBytes(bytes: Uint8Array, algorithm: HashAlgorithm = 'sha256'): string {
  return createHash(algorithm).update(bytes).digest('hex')
}

/** Digest determinístico de uma estrutura, independente da ordem das chaves. */
export function digestOf(value: unknown, algorithm: HashAlgorithm = 'sha256'): string {
  return hashText(stableStringify(value), algorithm)
}

/** Forma curta para exibição em log e CLI. Nunca use para comparar integridade. */
export function shortDigest(digest: string, length = 12): string {
  return digest.slice(0, length)
}

/**
 * Comparação em tempo constante. Não é sobre criptografia aqui — é sobre não criar
 * o hábito de comparar digests com `===` em código que depois é copiado para onde
 * o tempo importa.
 */
export function digestEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}
