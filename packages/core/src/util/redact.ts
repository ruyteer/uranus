/**
 * Redação de segredos — R12.
 *
 * Duas defesas independentes, porque cada uma sozinha falha:
 *  1. Por *nome* de campo (`apiKey`, `token`, `password`, ...) — pega o caso comum.
 *  2. Por *valor* registrado — pega o segredo que vazou para um campo com nome
 *     inocente, que é exatamente o caso que a defesa por nome não vê.
 */

export const REDACTED = '[REDACTED]'

const SENSITIVE_KEY_RE =
  /(pass(word|wd)?|secret|token|api[-_]?key|apikey|auth|credential|private[-_]?key|session|cookie|bearer)/i

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
  return SENSITIVE_KEY_RE.test(key)
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
