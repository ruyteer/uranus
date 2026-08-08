/**
 * Redação de segredos — R12.
 *
 * Duas defesas independentes, porque cada uma sozinha falha:
 *  1. Por *nome* de campo (`apiKey`, `token`, `password`, ...) — pega o caso comum.
 *  2. Por *valor* registrado — pega o segredo que vazou para um campo com nome
 *     inocente, que é exatamente o caso que a defesa por nome não vê.
 */

export const REDACTED = '[REDACTED]'

/**
 * Nomes de campo que carregam segredo, casados por **segmento** do
 * identificador, não por substring solta.
 *
 * A versão por substring parecia mais segura e não era: `/token/` redigia
 * `maxTokens` e `usedTokens`, `/pass/` redigia `passed` e `passRate`, `/auth/`
 * redigia `author`, `/session/` redigia `sessionId`. O resultado é que metade
 * dos números do próprio sistema aparecia como `[REDACTED]` — e um log em que
 * tudo está redigido ensina a ignorar `[REDACTED]`, que é justamente como um
 * segredo de verdade passa despercebido.
 *
 * Regra de segmentação: `accessToken` → `access` + `token` (secreto);
 * `maxTokens` → `max` + `tokens` (plural = contagem, não secreto).
 */
const SENSITIVE_SEGMENTS: ReadonlySet<string> = new Set([
  'password',
  'passwd',
  'passphrase',
  'pwd',
  'secret',
  'secrets',
  'token', // singular; `tokens` é contagem
  'apikey',
  'accesskey',
  'privatekey',
  'credential',
  'credentials',
  'auth', // exato; `author` vira o segmento `author` e não casa
  'authorization',
  'cookie',
  'cookies',
  'bearer',
  'signature',
])

/** Pares adjacentes que só são segredo juntos: `api`+`key`, `private`+`key`. */
const SENSITIVE_PAIRS: readonly (readonly [string, string])[] = [
  ['api', 'key'],
  ['api', 'secret'],
  ['private', 'key'],
  ['access', 'key'],
  ['secret', 'key'],
  ['client', 'secret'],
]

/** `apiKey` / `api_key` / `API-KEY` / `apikey` → ['api','key'] */
function segments(key: string): readonly string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+|\s+/)
    .filter((part) => part !== '')
    .map((part) => part.toLowerCase())
}

/** Padrões de segredo reconhecíveis mesmo sem registro prévio. */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g, // OpenAI-style
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g, // Anthropic
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, // GitHub
  /\bglpat-[A-Za-z0-9_-]{16,}\b/g, // GitLab
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT
  /-{5}BEGIN[ A-Z]*PRIVATE KEY-{5}[\s\S]*?-{5}END[ A-Z]*PRIVATE KEY-{5}/g,
]

/**
 * Registro de valores literais a redigir. O `SecretProvider` alimenta isto no
 * momento em que resolve um segredo, de modo que qualquer log posterior — inclusive
 * stdout de subprocesso — já sai limpo.
 */
export class SecretRegistry {
  private readonly values = new Set<string>()

  register(value: string): void {
    // Valores curtos demais gerariam falso positivo em todo texto.
    if (value.length >= 8) this.values.add(value)
  }

  clear(): void {
    this.values.clear()
  }

  get size(): number {
    return this.values.size
  }

  scrub(text: string): string {
    let out = text
    for (const value of this.values) {
      if (out.includes(value)) out = out.split(value).join(REDACTED)
    }
    return out
  }
}

export const globalSecrets = new SecretRegistry()

/** Redige padrões conhecidos e valores registrados em texto livre. */
export function redactText(text: string, registry: SecretRegistry = globalSecrets): string {
  let out = registry.scrub(text)
  for (const pattern of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, REDACTED)
  }
  return out
}

export function isSensitiveKey(key: string): boolean {
  const parts = segments(key)
  // O identificador colado (`apikey`) não se separa em segmentos; testamos a
  // forma normalizada também.
  const flat = parts.join('')
  if (SENSITIVE_SEGMENTS.has(flat)) return true
  if (parts.some((part) => SENSITIVE_SEGMENTS.has(part))) return true
  for (const [first, second] of SENSITIVE_PAIRS) {
    for (let index = 0; index < parts.length - 1; index++) {
      if (parts[index] === first && parts[index + 1] === second) return true
    }
  }
  return false
}

/**
 * Redige recursivamente uma estrutura. Preserva o formato (chaves continuam lá)
 * porque um log com campo faltando é mais difícil de depurar que um com `[REDACTED]`.
 */
export function redact(value: unknown, registry: SecretRegistry = globalSecrets): unknown {
  return redactAt(value, registry, 0, new WeakSet())
}

const MAX_DEPTH = 12

function redactAt(
  value: unknown,
  registry: SecretRegistry,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (depth > MAX_DEPTH) return '[DEPTH_LIMIT]'
  if (typeof value === 'string') return redactText(value, registry)
  if (value === null || typeof value !== 'object') return value

  if (seen.has(value)) return '[CIRCULAR]'
  seen.add(value)

  if (Array.isArray(value)) {
    return value.map((item) => redactAt(item, registry, depth + 1, seen))
  }
  if (value instanceof Error) {
    return { name: value.name, message: redactText(value.message, registry) }
  }

  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redactAt(item, registry, depth + 1, seen)
  }
  return out
}
