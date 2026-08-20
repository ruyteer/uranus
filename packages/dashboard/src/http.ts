import type { IncomingMessage, ServerResponse } from 'node:http'
import { isUranusError, redact } from '@uranus/core'

/**
 * Utilitários HTTP compartilhados entre o roteador principal e as rotas de
 * dados.
 *
 * Estão fora de `server.ts` por um motivo prático: `redact` na saída (R12) e o
 * cabeçalho de segurança precisam valer para TODA resposta, inclusive as das
 * rotas novas. Com uma função só, "esqueci de redigir nesta rota" deixa de ser
 * possível — a alternativa era repetir o `JSON.stringify(redact(...))` em cada
 * handler e torcer.
 */

/**
 * O painel não carrega nada de fora e não fala com nada de fora. Se um título
 * de task com HTML malicioso chegar à página, ele não tem para onde vazar.
 *
 * `'self'` em `script-src`/`style-src`/`font-src`/`img-src` é o que permite o
 * painel deixar de ser um HTML monolítico: os assets são servidos por ESTE
 * servidor, da mesma origem, e continuam proibidos de vir de qualquer outra.
 * `'unsafe-inline'` sobrevive porque a página ainda tem estilo e script
 * embutidos; endurecer isso é um passo separado, e é por isso que a UI não usa
 * `onclick=`.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy':
    "default-src 'none'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "connect-src 'self'; " +
    "img-src 'self' data:; " +
    "font-src 'self'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
}

export function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): void {
  // Redação na saída, sempre. É a última barreira antes de um segredo virar
  // pixel na tela de alguém (R12).
  const payload = JSON.stringify(redact(body))
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...SECURITY_HEADERS,
    ...headers,
  })
  response.end(payload)
}

/**
 * 405 com `Allow`, e não 404.
 *
 * A diferença importa para quem está integrando: 404 diz "esta rota não
 * existe" e manda a pessoa procurar o nome certo; 405 diz "existe, o verbo é
 * outro" e o cabeçalho `Allow` diz qual.
 */
export function methodNotAllowed(response: ServerResponse, allowed: readonly string[]): void {
  sendJson(
    response,
    405,
    { error: `método não permitido nesta rota; use ${allowed.join(', ')}` },
    { allow: allowed.join(', ') },
  )
}

/**
 * Falha de domínio → status HTTP.
 *
 * Sai do `code` do erro, nunca da mensagem: a mensagem muda com a versão e o
 * cliente não pode depender dela para distinguir "você digitou errado" de
 * "alguém mudou isto em outra aba". O default é 500 de propósito — um erro que
 * este mapa não conhece é uma falha nossa, e devolvê-lo como 400 culparia o
 * usuário por um defeito do servidor.
 */
const STATUS_BY_CODE: Readonly<Record<string, number>> = {
  E_VALIDATION: 400,
  E_CONFIG: 400,
  E_NOT_FOUND: 404,
  E_CONFLICT: 409,
  E_BUDGET: 409,
  E_PERMISSION: 403,
}

export function statusForError(error: unknown): number {
  if (!isUranusError(error)) return 500
  return STATUS_BY_CODE[error.code] ?? 500
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Teto de corpo aceito. Um painel local não recebe upload; 64 KiB é folga. */
const MAX_BODY = 64 * 1024

export async function readJson(
  request: IncomingMessage,
): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_BODY) return undefined
    chunks.push(buffer)
  }
  if (chunks.length === 0) return undefined
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

/** `%` solto na URL faz `decodeURIComponent` lançar. Aqui isso vira "não é id". */
export function safeDecode(value: string): string | undefined {
  try {
    return decodeURIComponent(value)
  } catch {
    return undefined
  }
}
