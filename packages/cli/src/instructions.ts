import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, posix } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { Logger, Result } from '@uranus/core'
import { NotFoundError, ValidationError, err, ok } from '@uranus/core'

/**
 * Instruções extras para o Claude — o substituto das validações de código.
 *
 * O Uranus parou de conferir código sozinho (lint/escopo/diff/testes por
 * regra — ver `docs/00-ARCHITECTURE`, pivot "Uranus é armadura"). O que
 * sobrou como "rede de proteção" é o Claude usando julgamento, e o único jeito
 * de melhorar esse julgamento é dar contexto melhor: uma instrução aqui vira
 * texto em `CLAUDE.md` (`claude-bridge.ts` monta o corpo a partir de
 * `list()`), não uma regra que aprova/reprova.
 *
 * `scope` é o mesmo mecanismo que resolve "projeto com N subprojetos": uma
 * instrução sem `scope` vale para o repo inteiro (raiz do `CLAUDE.md`); uma
 * instrução com `scope: packages/api` vira um `CLAUDE.md` só daquela pasta —
 * o Claude Code já lê `CLAUDE.md` de diretório mais próximo ao arquivo em que
 * está trabalhando, então não precisa de mecanismo novo, só de onde escrever.
 */
export interface InstructionNote {
  readonly id: string
  readonly title: string
  /** Pasta relativa à raiz do projeto. Ausente = vale para o projeto inteiro. */
  readonly scope?: string
  readonly body: string
  readonly createdAt: number
  readonly updatedAt: number
}

export interface InstructionsStoreOptions {
  /** `.uranus/instructions` — commitável e editável à mão, como memória e backlog. */
  readonly dir: string
  readonly logger: Logger
}

export interface NewInstructionInput {
  readonly title: string
  readonly body: string
  readonly scope?: string
}

export interface InstructionPatch {
  readonly title?: string
  readonly body?: string
  /** `null` explícito remove o escopo (volta a valer para o projeto inteiro). */
  readonly scope?: string | null
}

/**
 * Instruções em arquivos Markdown + frontmatter, uma por arquivo. Mesma forma
 * de `FileBacklogStore`: precisa ser legível, editável no editor de texto e
 * revisável em `git diff` — é conteúdo que o dono do projeto escreve tanto
 * quanto o painel.
 */
export class FileInstructionsStore {
  private readonly dir: string
  private readonly logger: Logger

  constructor(options: InstructionsStoreOptions) {
    this.dir = options.dir
    this.logger = options.logger.child({ component: 'instructions' })
  }

  async list(): Promise<readonly InstructionNote[]> {
    let files: string[]
    try {
      files = await readdir(this.dir)
    } catch {
      return []
    }
    const notes: InstructionNote[] = []
    for (const file of files.sort()) {
      if (!file.endsWith('.md')) continue
      const note = await this.readNote(join(this.dir, file))
      if (note !== undefined) notes.push(note)
    }
    return notes.sort((a, b) => a.title.localeCompare(b.title))
  }

  async get(id: string): Promise<InstructionNote | undefined> {
    return this.readNote(join(this.dir, `${id}.md`))
  }

  async add(input: NewInstructionInput, now: number): Promise<Result<InstructionNote>> {
    if (input.title.trim() === '') {
      return err(new ValidationError('Instrução precisa de título.'))
    }
    const note: InstructionNote = {
      id: slugify(input.title, now),
      title: input.title.trim(),
      ...(input.scope === undefined || input.scope.trim() === ''
        ? {}
        : { scope: normalizeScope(input.scope) }),
      body: input.body.trim(),
      createdAt: now,
      updatedAt: now,
    }
    return this.write(note)
  }

  async update(id: string, patch: InstructionPatch, now: number): Promise<Result<InstructionNote>> {
    const current = await this.get(id)
    if (current === undefined) {
      return err(new NotFoundError(`Instrução "${id}" não existe.`))
    }
    const title = patch.title === undefined ? current.title : patch.title.trim()
    if (title === '') {
      return err(new ValidationError('Instrução precisa de título.'))
    }
    const scope =
      patch.scope === undefined
        ? current.scope
        : patch.scope === null || patch.scope.trim() === ''
          ? undefined
          : normalizeScope(patch.scope)
    const note: InstructionNote = {
      ...current,
      title,
      ...(scope === undefined ? {} : { scope }),
      body: patch.body === undefined ? current.body : patch.body.trim(),
      updatedAt: now,
    }
    // `scope` precisa sumir do objeto de verdade quando o patch limpou — o
    // spread acima só cobre o caso "manter", não o caso "remover".
    if (scope === undefined) delete (note as { scope?: string }).scope
    return this.write(note)
  }

  /** Item inexistente é sucesso: a operação é idempotente. */
  async remove(id: string): Promise<Result<void>> {
    try {
      await rm(join(this.dir, `${id}.md`), { force: true })
      return ok()
    } catch (error: unknown) {
      return err(
        new ValidationError('Falha ao apagar instrução', { cause: error, context: { id } }),
      )
    }
  }

  private async write(note: InstructionNote): Promise<Result<InstructionNote>> {
    try {
      await mkdir(this.dir, { recursive: true })
      await writeFile(join(this.dir, `${note.id}.md`), serialize(note))
      return ok(note)
    } catch (error: unknown) {
      return err(
        new ValidationError('Falha ao gravar instrução', {
          cause: error,
          context: { id: note.id },
        }),
      )
    }
  }

  private async readNote(path: string): Promise<InstructionNote | undefined> {
    let raw: string
    try {
      raw = await readFile(path, 'utf8')
    } catch {
      return undefined
    }
    const id = (path.split(/[\\/]/).pop() ?? '').replace(/\.md$/, '')
    const parsed = deserialize(raw)
    if (parsed === undefined) {
      this.logger.warn('Instrução ilegível; ignorada', { path })
      return undefined
    }
    if (parsed.title === '') return undefined
    return { id, ...parsed }
  }
}

const DELIMITER = '---'

function serialize(note: InstructionNote): string {
  const frontmatter: Record<string, unknown> = {
    title: note.title,
    ...(note.scope === undefined ? {} : { scope: note.scope }),
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  }
  return `${DELIMITER}\n${stringifyYaml(frontmatter)}${DELIMITER}\n\n${note.body}\n`
}

function deserialize(raw: string): Omit<InstructionNote, 'id'> | undefined {
  if (!raw.startsWith(DELIMITER)) return undefined
  const end = raw.indexOf(`\n${DELIMITER}`, DELIMITER.length)
  if (end < 0) return undefined

  let meta: Record<string, unknown>
  try {
    const parsed: unknown = parseYaml(raw.slice(DELIMITER.length + 1, end))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    meta = parsed as Record<string, unknown>
  } catch {
    return undefined
  }
  const body = raw.slice(end + DELIMITER.length + 1).trim()

  return {
    title: typeof meta['title'] === 'string' ? meta['title'] : '',
    ...(typeof meta['scope'] === 'string' && meta['scope'] !== '' ? { scope: meta['scope'] } : {}),
    body,
    createdAt: typeof meta['createdAt'] === 'number' ? meta['createdAt'] : 0,
    updatedAt: typeof meta['updatedAt'] === 'number' ? meta['updatedAt'] : 0,
  }
}

/** Sem `..`, sem barra inicial: escopo é sempre para dentro do projeto. */
function normalizeScope(scope: string): string {
  const normalized = posix.normalize(scope.trim().replace(/\\/g, '/'))
  return normalized
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..')
    .join('/')
}

function slugify(title: string, now: number): string {
  const slug = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `${slug === '' ? 'instrucao' : slug}-${now.toString(36).slice(-6)}`
}
