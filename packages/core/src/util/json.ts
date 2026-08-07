/**
 * Serialização determinística.
 *
 * O `digest` de um `ContextPack` (ADR-007) só tem valor se dois packs com o mesmo
 * conteúdo produzirem a mesma string — e `JSON.stringify` não garante isso, porque
 * a ordem das chaves segue a ordem de inserção. Sem ordenação estável, "mesmo
 * contexto ⇒ mesmo digest" seria falso e toda comparação de qualidade de prompt
 * viraria ruído.
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue }

export function stableStringify(value: unknown): string {
  return serialize(value, new WeakSet())
}

function serialize(value: unknown, seen: WeakSet<object>): string {
  if (value === null) return 'null'
  if (value === undefined) return 'null'

  const type = typeof value
  if (type === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null'
  if (type === 'boolean' || type === 'string') return JSON.stringify(value)
  if (type === 'bigint') return JSON.stringify((value as bigint).toString())
  if (type === 'function' || type === 'symbol') return 'null'

  const obj = value
  if (seen.has(obj)) throw new TypeError('stableStringify: referência circular')
  seen.add(obj)
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => serialize(item, seen)).join(',')}]`
    }
    if (value instanceof Date) return JSON.stringify(value.toISOString())
    if (value instanceof Map) {
      const entries = [...value.entries()].map(([k, v]) => [String(k), v] as const)
      entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${serialize(v, seen)}`).join(',')}}`
    }
    if (value instanceof Set) {
      const items = [...value].map((item) => serialize(item, seen)).sort()
      return `[${items.join(',')}]`
    }

    const record = value as Record<string, unknown>
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${serialize(record[key], seen)}`).join(',')}}`
  } finally {
    seen.delete(obj)
  }
}

/** Parse com `Result`-like: `undefined` em vez de exceção. Usado ao ler JSONL. */
export function tryParseJson<T = unknown>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T
  } catch {
    return undefined
  }
}
