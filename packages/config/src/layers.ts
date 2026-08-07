/**
 * Composição em camadas: defaults → global → projeto → env → flags de CLI.
 * A camada mais específica vence.
 */

export type LayerName = 'defaults' | 'global' | 'project' | 'env' | 'flags'

export const LAYER_ORDER: readonly LayerName[] = ['defaults', 'global', 'project', 'env', 'flags']

export interface ConfigLayer {
  readonly name: LayerName
  readonly source: string
  readonly data: Readonly<Record<string, unknown>>
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Merge profundo.
 *
 * Arrays **substituem**, não concatenam. É deliberado: se `permissions.execAllow`
 * concatenasse, um projeto não conseguiria *restringir* o que o global permite —
 * e permissão que só cresce ao longo das camadas quebra a monotonicidade que a
 * arquitetura exige (§15.1).
 */
export function deepMerge<T extends Record<string, unknown>>(
  base: T,
  override: Record<string, unknown>,
): T {
  const result: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue
    const current = result[key]
    result[key] = isPlainObject(current) && isPlainObject(value) ? deepMerge(current, value) : value
  }
  return result as T
}

export function mergeLayers(layers: readonly ConfigLayer[]): Record<string, unknown> {
  const ordered = [...layers].sort(
    (a, b) => LAYER_ORDER.indexOf(a.name) - LAYER_ORDER.indexOf(b.name),
  )
  let merged: Record<string, unknown> = {}
  for (const layer of ordered) {
    merged = deepMerge(merged, layer.data)
  }
  return merged
}

/**
 * Rastreia de qual camada veio cada campo. `uranus doctor` usa isto para
 * responder "por que este valor?" sem o usuário ter que abrir quatro arquivos.
 */
export function traceOrigins(
  layers: readonly ConfigLayer[],
): ReadonlyMap<string, { layer: LayerName; source: string }> {
  const origins = new Map<string, { layer: LayerName; source: string }>()
  const ordered = [...layers].sort(
    (a, b) => LAYER_ORDER.indexOf(a.name) - LAYER_ORDER.indexOf(b.name),
  )
  for (const layer of ordered) {
    for (const path of flattenPaths(layer.data)) {
      origins.set(path, { layer: layer.name, source: layer.source })
    }
  }
  return origins
}

function flattenPaths(value: Record<string, unknown>, prefix = ''): string[] {
  const paths: string[] = []
  for (const [key, item] of Object.entries(value)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (isPlainObject(item)) {
      paths.push(...flattenPaths(item, path))
    } else {
      paths.push(path)
    }
  }
  return paths
}

/**
 * Lê variáveis `URANUS_*` como camada de configuração.
 * `URANUS_KERNEL__CONCURRENCY=4` → `{ kernel: { concurrency: 4 } }`
 */
export function envLayer(env: Readonly<Record<string, string | undefined>>): ConfigLayer {
  const data: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(env)) {
    if (!key.startsWith('URANUS_') || raw === undefined) continue
    const path = key
      .slice('URANUS_'.length)
      .toLowerCase()
      .split('__')
      .map(toCamelCase)
      .filter((segment) => segment.length > 0)
    if (path.length === 0) continue
    setAtPath(data, path, coerce(raw))
  }
  return { name: 'env', source: 'process.env', data }
}

function toCamelCase(segment: string): string {
  return segment.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
}

function setAtPath(target: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let node = target
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!
    const next = node[key]
    if (!isPlainObject(next)) node[key] = {}
    node = node[key] as Record<string, unknown>
  }
  node[path[path.length - 1]!] = value
}

function coerce(raw: string): unknown {
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (raw === 'null') return null
  if (/^-?\d+$/.test(raw)) return Number.parseInt(raw, 10)
  if (/^-?\d*\.\d+$/.test(raw)) return Number.parseFloat(raw)
  if (raw.startsWith('[') || raw.startsWith('{')) {
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }
  return raw
}
