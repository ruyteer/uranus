import { isAbsolute, normalize, relative, resolve, sep } from 'node:path'

/**
 * Normalização de caminhos — ADR-011 / R10.
 *
 * Todo caminho que atravessa uma fronteira do sistema (evento, memória, glob,
 * lease de arquivo, contexto) está em forma POSIX. Caminhos nativos existem
 * apenas na borda que fala com o sistema de arquivos.
 *
 * Sem esta regra, `src/app.ts` e `src\app.ts` seriam dois arquivos diferentes para
 * o lease de propriedade e para a invalidação de memória — e as duas coisas
 * falhariam silenciosamente no Windows.
 */

/** Converte separadores nativos para `/`. Forma canônica do projeto. */
export function toPosix(path: string): string {
  return path
    .split(sep)
    .join('/')
    .replace(/\/{2,}/g, '/')
}

/** Converte forma canônica de volta para o separador nativo da plataforma. */
export function toNative(path: string): string {
  return sep === '/' ? path : path.split('/').join(sep)
}

/**
 * Caminho relativo canônico de `child` em relação a `root`.
 * Retorna `undefined` se `child` estiver fora de `root` — o que, no `Sandbox`,
 * significa tentativa de escrita fora do worktree (INV-5).
 */
export function relativeWithin(root: string, child: string): string | undefined {
  const rel = relative(resolve(root), resolve(child))
  if (rel === '') return '.'
  if (rel.startsWith('..') || isAbsolute(rel)) return undefined
  return toPosix(rel)
}

/** `true` se `child` estiver dentro de `root` (ou for o próprio `root`). */
export function isWithin(root: string, child: string): boolean {
  return relativeWithin(root, child) !== undefined
}

/**
 * Comparação de caminhos ciente da plataforma.
 * Windows e macOS são case-insensitive; Linux não. Comparar sempre em minúsculas
 * causaria colisão falsa no Linux, comparar sempre exato causaria escape do
 * sandbox no Windows via `SRC\App.ts`.
 */
const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin'

export function pathEquals(a: string, b: string): boolean {
  const na = toPosix(normalize(a))
  const nb = toPosix(normalize(b))
  return CASE_INSENSITIVE ? na.toLowerCase() === nb.toLowerCase() : na === nb
}

/** Forma usada como chave de mapa/Set de caminhos. */
export function pathKey(path: string): string {
  const canonical = toPosix(normalize(path))
  return CASE_INSENSITIVE ? canonical.toLowerCase() : canonical
}

/**
 * Windows limita caminhos a 260 caracteres por padrão (R10). Um monorepo pnpm
 * dentro de um git worktree passa desse limite com facilidade, e o erro que o
 * Node retorna (`ENOENT`) não diz nada sobre a causa real.
 */
export const WINDOWS_MAX_PATH = 260

export function exceedsWindowsMaxPath(path: string, marginChars = 60): boolean {
  return process.platform === 'win32' && path.length + marginChars > WINDOWS_MAX_PATH
}

/**
 * Diretório de worktree deliberadamente curto: `<root>/.uranus/w/<8 chars>`.
 * Usar o id completo da task aqui custaria ~35 caracteres de margem que o
 * Windows não tem para dar.
 */
export function workspaceDirName(workspaceId: string): string {
  const raw = workspaceId.includes('_')
    ? workspaceId.slice(workspaceId.indexOf('_') + 1)
    : workspaceId
  return raw.slice(-8).toLowerCase()
}
