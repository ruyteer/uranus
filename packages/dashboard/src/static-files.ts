import { readFile } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { safeDecode } from './http.js'

/**
 * Servidor de arquivos estáticos de `public/`.
 *
 * Existe porque a UI deixou de ser um HTML monolítico: agora são folha de
 * estilo, módulos ES e (opcionalmente) fontes self-hospedadas, servidos pelo
 * mesmo `node:http`, sem bundler e sem CDN.
 *
 * **É a única parte do servidor que transforma texto vindo da URL em caminho
 * de arquivo**, e por isso carrega três travas independentes, nesta ordem:
 *
 *  1. o caminho é decodificado UMA vez e resolvido contra `public/`; o
 *     resultado precisa ficar dentro de `public/` — `..%2f..%2fetc%2fpasswd`
 *     vira `../../etc/passwd` na decodificação e é justamente o que a
 *     comparação de prefixo pega. Vale para `\` também, que no Windows é
 *     separador;
 *  2. a extensão precisa estar na lista conhecida. Sem isso, um `.env` ou um
 *     `.yaml` que alguém deixasse em `public/` viraria download;
 *  3. nada de listagem de diretório: o que não é arquivo legível é 404.
 */

/**
 * Extensão → content-type. É lista de permissão, não de bloqueio: extensão que
 * não está aqui não é servida, e acrescentar uma é uma decisão consciente.
 */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
}

export interface StaticAsset {
  readonly contentType: string
  readonly body: Buffer
}

/** `dist/static-files.js` → `../public`, e o mesmo a partir de `src/`. */
export function publicDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public')
}

/** `public/index.html` — o único arquivo que o servidor conhece pelo nome. */
export function uiPath(): string {
  return join(publicDir(), 'index.html')
}

/**
 * Resolve o caminho de URL para um arquivo dentro de `public/`, ou `undefined`
 * se ele escapar da pasta, tiver extensão desconhecida ou não existir.
 *
 * Exportada separada da leitura para ser testável sem tocar no disco.
 */
export function resolvePublicPath(urlPath: string): string | undefined {
  const decoded = safeDecode(urlPath)
  // NUL trunca caminho em algumas syscalls: `/app.css\0.png` passaria pela
  // checagem de extensão e abriria outro arquivo.
  if (decoded === undefined || decoded.includes('\0')) return undefined

  const relative = decoded.replace(/^[/\\]+/, '')
  const file = relative === '' ? 'index.html' : relative

  const root = publicDir()
  const target = resolve(root, file)
  // `resolve` já colapsou `..`; se o resultado não está sob `public/`, o
  // caminho pedido saía da pasta — inclusive o caso `/C:/Windows/...`, que no
  // Windows `resolve` trata como absoluto e ignora a raiz.
  if (target !== root && !target.startsWith(root + sep)) return undefined
  if (!Object.hasOwn(CONTENT_TYPES, extname(target).toLowerCase())) return undefined
  return target
}

export function contentTypeFor(file: string): string | undefined {
  return CONTENT_TYPES[extname(file).toLowerCase()]
}

export async function readPublicAsset(urlPath: string): Promise<StaticAsset | undefined> {
  const target = resolvePublicPath(urlPath)
  if (target === undefined) return undefined
  const contentType = contentTypeFor(target)
  if (contentType === undefined) return undefined
  try {
    // Sem cache em memória: o painel serve um humano numa máquina local, e um
    // cache aqui só produziria "editei o CSS e o navegador continua mostrando
    // o antigo" durante o desenvolvimento da própria UI.
    return { contentType, body: await readFile(target) }
  } catch {
    // Diretório, arquivo inexistente ou sem permissão: para quem está do outro
    // lado é tudo a mesma coisa — 404. Distinguir seria confirmar a existência
    // de caminhos que o pedinte não deveria conseguir sondar.
    return undefined
  }
}
