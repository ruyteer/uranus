import picomatch from 'picomatch'
import { toPosix } from './path.js'

/**
 * Correspondência por glob. Base de três mecanismos de segurança:
 *  - `PermissionSet.fs.write` — o que um agente pode escrever
 *  - `Task.touches`           — o lease de propriedade de arquivo (R6)
 *  - `DiffCheck.forbidPaths`  — o que um diff não pode conter
 *
 * Todos os caminhos são normalizados para forma POSIX antes da comparação (R10).
 */

export type Glob = string

export interface Matcher {
  (path: string): boolean
  readonly patterns: readonly Glob[]
}

const PICOMATCH_OPTIONS: picomatch.PicomatchOptions = {
  dot: true,
  posixSlashes: true,
  nocase: process.platform === 'win32' || process.platform === 'darwin',
}

export function createMatcher(patterns: readonly Glob[]): Matcher {
  if (patterns.length === 0) {
    const never = (): boolean => false
    return Object.assign(never, { patterns: [] as readonly Glob[] })
  }
  const isMatch = picomatch([...patterns], PICOMATCH_OPTIONS)
  const fn = (path: string): boolean => isMatch(toPosix(path))
  return Object.assign(fn, { patterns })
}

export function matchesAny(path: string, patterns: readonly Glob[]): boolean {
  return createMatcher(patterns)(path)
}

/**
 * Decisão allow/deny com `deny` sempre vencendo.
 *
 * A ordem não é negociável: em `PermissionBroker`, a interseção de camadas só
 * restringe (nunca amplia), e isso depende de `deny` ter precedência absoluta.
 */
export function isAllowed(
  path: string,
  allow: readonly Glob[],
  deny: readonly Glob[] = [],
): boolean {
  if (deny.length > 0 && matchesAny(path, deny)) return false
  return matchesAny(path, allow)
}

/**
 * Prefixo literal de um glob: a parte antes do primeiro metacaractere.
 * `src/api/**\/*.ts` → `src/api`
 */
export function literalPrefix(pattern: Glob): string {
  const normalized = toPosix(pattern)
  const meta = /[*?[\]{}!+@()]/.exec(normalized)
  const cut = meta === null ? normalized.length : meta.index
  const upToMeta = normalized.slice(0, cut)
  const lastSlash = upToMeta.lastIndexOf('/')
  return lastSlash === -1 ? '' : upToMeta.slice(0, lastSlash)
}

/**
 * Dois conjuntos de globs podem casar com o mesmo arquivo?
 *
 * Interseção exata de globs é indecidível na prática, então esta função é
 * deliberadamente **conservadora**: na dúvida, responde `true`. No uso real
 * (lease de arquivo entre worktrees paralelos), um falso positivo custa uma
 * task esperando; um falso negativo custa um conflito de merge. A assimetria
 * justifica o viés.
 */
export function globsIntersect(a: readonly Glob[], b: readonly Glob[]): boolean {
  if (a.length === 0 || b.length === 0) return false

  for (const pa of a) {
    for (const pb of b) {
      if (pa === pb) return true

      const prefixA = literalPrefix(pa)
      const prefixB = literalPrefix(pb)

      // Um prefixo contém o outro ⇒ podem alcançar os mesmos arquivos.
      const nested =
        prefixA === '' ||
        prefixB === '' ||
        prefixA === prefixB ||
        prefixA.startsWith(`${prefixB}/`) ||
        prefixB.startsWith(`${prefixA}/`)
      if (!nested) continue

      // Prefixos compatíveis: só declaramos disjunto quando ambos são literais
      // puros e diferentes — o único caso em que temos certeza.
      const literalA = !hasMeta(pa)
      const literalB = !hasMeta(pb)
      if (literalA && literalB) {
        if (toPosix(pa) === toPosix(pb)) return true
        continue
      }
      return true
    }
  }
  return false
}

function hasMeta(pattern: string): boolean {
  return /[*?[\]{}!+@()]/.test(pattern)
}
