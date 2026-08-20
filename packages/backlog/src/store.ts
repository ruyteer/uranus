import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { BacklogItem, Logger, ProjectId, Result } from '@uranus/core'
import { ValidationError, err, ok } from '@uranus/core'

export interface BacklogStoreOptions {
  /** `.uranus/backlog` — commitável e editável à mão, como a memória. */
  readonly dir: string
  readonly projectId: ProjectId
  readonly logger: Logger
}

export type BacklogItemState = 'open' | 'planned' | 'done' | 'dropped'

export interface StoredBacklogItem extends BacklogItem {
  readonly state: BacklogItemState
  /** `planId` gerado quando o item foi planejado. */
  readonly planId?: string
  /** Rejeições da última tentativa de planejamento, para o humano ler. */
  readonly lastRejections?: readonly string[]
  /**
   * Quantas vezes o plano deste item já foi recusado pelo validador.
   *
   * É o que exclui o item do planejamento automático ao bater
   * `backlog.maxPlanningFailures` — sem estado novo, porque `state` continua
   * `open` e o humano continua podendo rodar `uranus plan` na mão.
   */
  readonly planningFailures?: number
  /** Quando o item virou `planned`. Base da duração em `BacklogItemCompleted`. */
  readonly startedAt?: number
}

/**
 * Backlog em arquivos YAML, um item por arquivo.
 *
 * Mesma escolha da memória (ADR-004): o backlog é conversa entre humano e
 * máquina, e precisa ser legível, editável e versionável. Um item escrito à
 * mão em prosa é entrada válida — é literalmente o ponto de partida do ciclo.
 */
export class FileBacklogStore {
  private readonly dir: string
  private readonly projectId: ProjectId
  private readonly logger: Logger

  constructor(options: BacklogStoreOptions) {
    this.dir = options.dir
    this.projectId = options.projectId
    this.logger = options.logger.child({ component: 'backlog' })
  }

  async add(input: {
    title: string
    body: string
    labels?: readonly string[]
    priority?: number
    source?: BacklogItem['source']
    externalRef?: string
    createdAt: number
  }): Promise<Result<StoredBacklogItem>> {
    if (input.title.trim() === '') {
      return err(new ValidationError('Item de backlog precisa de título.'))
    }
    const id = slugify(input.title, input.createdAt)
    const item: StoredBacklogItem = {
      id,
      projectId: this.projectId,
      title: input.title.trim(),
      body: input.body.trim(),
      labels: input.labels ?? [],
      priority: input.priority ?? 50,
      source: input.source ?? 'manual',
      ...(input.externalRef === undefined ? {} : { externalRef: input.externalRef }),
      createdAt: input.createdAt,
      state: 'open',
    }
    const written = await this.write(item)
    return written.ok ? ok(item) : written
  }

  async list(state?: BacklogItemState): Promise<readonly StoredBacklogItem[]> {
    let files: string[]
    try {
      files = await readdir(this.dir)
    } catch {
      return []
    }
    const items: StoredBacklogItem[] = []
    for (const file of files.sort()) {
      if (!/\.(ya?ml)$/.test(file)) continue
      const item = await this.readItem(join(this.dir, file))
      if (item === undefined) continue
      if (state === undefined || item.state === state) items.push(item)
    }
    // Prioridade desc, depois ordem de criação — determinístico.
    return items.sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt)
  }

  async get(id: string): Promise<StoredBacklogItem | undefined> {
    return this.readItem(join(this.dir, `${id}.yaml`))
  }

  async update(item: StoredBacklogItem): Promise<Result<void>> {
    const written = await this.write(item)
    return written.ok ? ok() : err(written.error)
  }

  /**
   * Apaga o item do disco.
   *
   * Item inexistente é sucesso, não erro: a operação é idempotente porque o
   * chamador quer o estado final ("não existe mais"), e um segundo `remove`
   * vindo de dois cliques no painel não é falha. O histórico do que aconteceu
   * com o item vive no log de eventos, não neste arquivo.
   */
  async remove(id: string): Promise<Result<void>> {
    try {
      await rm(join(this.dir, `${id}.yaml`), { force: true })
      return ok()
    } catch (error: unknown) {
      return err(
        new ValidationError('Falha ao apagar item de backlog', {
          cause: error,
          context: { id },
        }),
      )
    }
  }

  /** Importa itens externos, pulando os que já existem (idempotente). */
  async importItems(
    items: readonly {
      title: string
      body: string
      labels: readonly string[]
      externalRef: string
      source: BacklogItem['source']
    }[],
    now: number,
  ): Promise<{ imported: number; skipped: number }> {
    const existing = await this.list()
    const knownRefs = new Set(
      existing.map((item) => item.externalRef).filter((ref): ref is string => ref !== undefined),
    )

    let imported = 0
    let skipped = 0
    for (const item of items) {
      if (knownRefs.has(item.externalRef)) {
        skipped++
        continue
      }
      const added = await this.add({ ...item, createdAt: now })
      if (added.ok) imported++
      else skipped++
    }
    this.logger.info('Backlog importado', { imported, skipped })
    return { imported, skipped }
  }

  private async write(item: StoredBacklogItem): Promise<Result<StoredBacklogItem>> {
    try {
      await mkdir(this.dir, { recursive: true })
      const { id: _id, projectId: _projectId, planningFailures, ...rest } = item
      // Zero é o valor neutro: gravá-lo encheria de ruído os itens que nunca
      // falharam — e o YAML aqui é feito para o humano ler e editar à mão.
      const payload = {
        ...rest,
        ...(planningFailures === undefined || planningFailures === 0 ? {} : { planningFailures }),
      }
      await writeFile(join(this.dir, `${item.id}.yaml`), stringifyYaml(payload))
      return ok(item)
    } catch (error: unknown) {
      return err(
        new ValidationError('Falha ao gravar item de backlog', {
          cause: error,
          context: { id: item.id },
        }),
      )
    }
  }

  private async readItem(path: string): Promise<StoredBacklogItem | undefined> {
    let raw: string
    try {
      raw = await readFile(path, 'utf8')
    } catch {
      return undefined
    }
    let parsed: unknown
    try {
      parsed = parseYaml(raw)
    } catch {
      this.logger.warn('Item de backlog ilegível; ignorado', { path })
      return undefined
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined

    const data = parsed as Record<string, unknown>
    const id = (path.split(/[\\/]/).pop() ?? '').replace(/\.ya?ml$/, '')
    const title = typeof data['title'] === 'string' ? data['title'] : ''
    if (title === '') return undefined

    return {
      id,
      projectId: this.projectId,
      title,
      body: typeof data['body'] === 'string' ? data['body'] : '',
      labels: Array.isArray(data['labels']) ? (data['labels'] as string[]).map(String) : [],
      priority: typeof data['priority'] === 'number' ? data['priority'] : 50,
      source: (typeof data['source'] === 'string'
        ? data['source']
        : 'manual') as BacklogItem['source'],
      ...(typeof data['externalRef'] === 'string' ? { externalRef: data['externalRef'] } : {}),
      createdAt: typeof data['createdAt'] === 'number' ? data['createdAt'] : 0,
      state: (typeof data['state'] === 'string' ? data['state'] : 'open') as BacklogItemState,
      ...(typeof data['planId'] === 'string' ? { planId: data['planId'] } : {}),
      ...(Array.isArray(data['lastRejections'])
        ? { lastRejections: (data['lastRejections'] as string[]).map(String) }
        : {}),
      ...(typeof data['planningFailures'] === 'number'
        ? { planningFailures: data['planningFailures'] }
        : {}),
      ...(typeof data['startedAt'] === 'number' ? { startedAt: data['startedAt'] } : {}),
    }
  }
}

function slugify(title: string, now: number): string {
  const slug = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  // Sufixo temporal evita colisão entre itens de título parecido.
  return `${slug === '' ? 'item' : slug}-${now.toString(36).slice(-6)}`
}
