import type { ConfigReader } from '@uranus/core'

/**
 * Leitor com caminho pontilhado. É o que plugins recebem via `PluginContext`
 * (ADR-010): somente leitura, sem referência ao objeto de config real.
 */
export function createConfigReader(data: Readonly<Record<string, unknown>>): ConfigReader {
  const read = (path: string): unknown => {
    let node: unknown = data
    for (const segment of path.split('.')) {
      if (node === null || typeof node !== 'object') return undefined
      node = (node as Record<string, unknown>)[segment]
    }
    return node
  }

  return {
    get<T>(path: string): T | undefined {
      return read(path) as T | undefined
    },
    getOr<T>(path: string, fallback: T): T {
      const value = read(path)
      return value === undefined ? fallback : (value as T)
    },
    has(path: string): boolean {
      return read(path) !== undefined
    },
  }
}

/** Escopo de um plugin: `plugins.<id>.*` vira a raiz do que ele enxerga. */
export function scopedReader(reader: ConfigReader, prefix: string): ConfigReader {
  const full = (path: string): string => (path === '' ? prefix : `${prefix}.${path}`)
  return {
    get: <T>(path: string) => reader.get<T>(full(path)),
    getOr: <T>(path: string, fallback: T) => reader.getOr<T>(full(path), fallback),
    has: (path: string) => reader.has(full(path)),
  }
}
