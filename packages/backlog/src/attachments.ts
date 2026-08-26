import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { Logger } from '@uranus/core'

/**
 * Guarda os arquivos de imagem que o humano anexa a um item de backlog pelo
 * painel (aba Backlog, arrastar-ou-escolher).
 *
 * O navegador não expõe o caminho absoluto de um arquivo escolhido em
 * `<input type=file>` nem em drag-and-drop — é uma restrição de sandbox do
 * próprio navegador, não algo contornável em código. Por isso o "caminho"
 * que `BacklogItem.images` guarda (ver `packages/core/src/domain/plan.ts`)
 * não é mais digitado pelo humano: é ESTE store que recebe os bytes, grava
 * um arquivo de verdade em `.uranus/backlog/attachments/` e devolve o
 * caminho — que passa a ser tão real quanto qualquer outro arquivo do
 * projeto, e o Claude lê com a própria ferramenta de leitura.
 *
 * Escopo deliberadamente estreito: só imagem (`IMAGE_CONTENT_TYPES`), nome
 * sempre gerado por este store (nunca o nome cru que veio do cliente), e
 * `read()` só aceita o formato de nome que `save()` produz — não há
 * caminho vindo de fora que este store resolva contra o disco.
 */

const IMAGE_CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
}

/** `nome-original.png` → `.png`, minúsculo. `''` quando não há extensão. */
function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot < 0 ? '' : filename.slice(dot).toLowerCase()
}

/**
 * Nome gerado por este store: `<prefixo-aleatório>-<base saneada>.<ext>`. O
 * prefixo evita colisão entre uploads concorrentes com o mesmo nome; a base
 * saneada existe só pra manter o nome legível — a extensão é o que decide o
 * `content-type`, então ela sozinha já era o suficiente pra `read()` ser
 * seguro contra qualquer coisa que não seja este padrão.
 */
const STORED_NAME = /^[a-z0-9]{8}-[a-zA-Z0-9._-]{1,80}$/

export interface BacklogAttachmentStoreOptions {
  /** `.uranus/backlog/attachments` */
  readonly dir: string
  readonly logger: Logger
}

export interface SavedAttachment {
  /** Caminho absoluto no disco — é o que vai em `BacklogItem.images`. */
  readonly path: string
  /** Nome gravado (não o nome original) — é o que o painel usa pra buscar de volta. */
  readonly filename: string
}

export class BacklogAttachmentStore {
  private readonly dir: string
  private readonly logger: Logger

  constructor(options: BacklogAttachmentStoreOptions) {
    this.dir = options.dir
    this.logger = options.logger.child({ component: 'backlog-attachments' })
  }

  /** `undefined` quando a extensão não é de imagem conhecida. */
  async save(originalName: string, data: Buffer): Promise<SavedAttachment | undefined> {
    const ext = extensionOf(originalName)
    if (!Object.hasOwn(IMAGE_CONTENT_TYPES, ext)) return undefined

    const base = originalName
      .slice(0, originalName.length - ext.length)
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .slice(0, 60)
    const filename = `${randomUUID().replace(/-/g, '').slice(0, 8)}-${base === '' ? 'imagem' : base}${ext}`

    await mkdir(this.dir, { recursive: true })
    const path = join(this.dir, filename)
    await writeFile(path, data)
    this.logger.info('Imagem anexada ao backlog', { filename, bytes: data.length })
    return { path, filename }
  }

  /** `undefined` quando o nome não é um nome que este store gerou, ou o arquivo não existe. */
  async read(filename: string): Promise<{ contentType: string; body: Buffer } | undefined> {
    if (!STORED_NAME.test(filename)) return undefined
    const ext = extensionOf(filename)
    const contentType = IMAGE_CONTENT_TYPES[ext]
    if (contentType === undefined) return undefined
    try {
      return { contentType, body: await readFile(join(this.dir, filename)) }
    } catch {
      return undefined
    }
  }
}
