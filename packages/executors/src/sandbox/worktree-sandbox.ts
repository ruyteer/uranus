import { mkdir, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type {
  Clock,
  Logger,
  ProjectRef,
  Result,
  Sandbox,
  Task,
  VcsAdapter,
  Workspace,
  WorkspaceId,
  WorkspaceRef,
} from '@uranus/core'
import { IoError, err, newWorkspaceId, ok, tryParseJson, workspaceDirName } from '@uranus/core'

export interface WorktreeSandboxOptions {
  readonly project: ProjectRef
  readonly vcs: VcsAdapter
  readonly clock: Clock
  readonly logger: Logger
  readonly branchPrefix: string
}

/** Gravado dentro de cada worktree. É o que torna a reconciliação pós-crash possível. */
interface WorkspaceMarker {
  readonly workspaceId: WorkspaceId
  readonly taskId: string
  readonly branch: string
  readonly baseCommit: string
  readonly createdAt: number
}

const MARKER_FILE = '.uranus-workspace.json'

/**
 * Garante que `.uranus/` é invisível para o git do projeto.
 *
 * Precisa rodar no `init` e na composição — não apenas ao criar o primeiro
 * worktree. Caso contrário, qualquer `git status` entre o init e a primeira
 * task mostra `.uranus/` como não-rastreado, e uma task que rode `git status`
 * na verificação vê o repositório sujo por causa do próprio harness.
 */
export async function ensureUranusIgnored(uranusDir: string): Promise<void> {
  const path = join(uranusDir, '.gitignore')
  try {
    await readFile(path, 'utf8')
  } catch {
    await mkdir(uranusDir, { recursive: true })
    // `*` puro: o diretório inteiro fica fora do git do projeto, sem exigir
    // nada do usuário. Commitar config/memory exige `git add -f` (Fase 3 troca
    // por negações explícitas quando houver fluxo de commit de memória).
    await writeFile(path, '*\n')
  }
}

/**
 * Symlinka `node_modules` do checkout principal pro worktree novo, quando
 * existir. Best-effort: falhar aqui nunca derruba a criação do workspace —
 * pior caso é o comportamento de hoje (agente instala sozinho, ou o Verifier
 * reprova por dependência ausente).
 */
async function linkNodeModules(repoDir: string, worktreeDir: string, logger: Logger): Promise<void> {
  const source = join(repoDir, 'node_modules')
  try {
    await stat(source)
  } catch {
    return // projeto sem `node_modules` instalado (ou nem é Node) — nada a linkar.
  }
  try {
    await symlink(
      source,
      join(worktreeDir, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
  } catch (error: unknown) {
    logger.warn('Falha ao linkar node_modules no worktree; agente vai precisar instalar', {
      worktreeDir,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Sandbox por git worktree (ADR-005, INV-5).
 *
 * Diretórios curtos (`.uranus/w/<8 chars>`) por causa do limite de 260 chars do
 * Windows (R10): worktree + node_modules + pnpm já consomem a margem toda.
 *
 * Cada worktree carrega um marker file com o taskId dono. Depois de um `kill -9`,
 * `orphans()` compara os markers com as tasks ativas — sem depender de nenhum
 * estado em memória que morreu junto com o processo.
 */
export class WorktreeSandbox implements Sandbox {
  private readonly project: ProjectRef
  private readonly vcs: VcsAdapter
  private readonly clock: Clock
  private readonly logger: Logger
  private readonly branchPrefix: string

  constructor(options: WorktreeSandboxOptions) {
    this.project = options.project
    this.vcs = options.vcs
    this.clock = options.clock
    this.logger = options.logger.child({ component: 'sandbox' })
    this.branchPrefix = options.branchPrefix
  }

  private get worktreesDir(): string {
    return join(this.project.uranusDir, 'w')
  }

  async acquire(task: Task, _signal: AbortSignal): Promise<Result<Workspace>> {
    await ensureUranusIgnored(this.project.uranusDir)

    const head = await this.vcs.head(this.project.rootDir)
    if (!head.ok) return err(head.error)

    const id = newWorkspaceId(this.clock.now())
    const dirName = workspaceDirName(id)
    const rootDir = join(this.worktreesDir, dirName)
    const slug = task.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40)
    const branch = `${this.branchPrefix}${slug}-${dirName}`

    await mkdir(this.worktreesDir, { recursive: true })
    const added = await this.vcs.worktreeAdd(this.project.rootDir, rootDir, branch, head.value)
    if (!added.ok) return err(added.error)

    // `git worktree` nunca traz `node_modules` (é gitignored) — sem isto, toda
    // task nasce sem dependência instalada, e só descobre isso quando o
    // Verifier já reprovou por "comando não encontrado", ou o agente perde o
    // orçamento de turnos reinstalando (e no Windows, se o store do pnpm fica
    // em outro drive do worktree, `pnpm install` pode nem funcionar sem
    // `--store-dir` manual — hardlink não atravessa drive). Linkar em vez de
    // reinstalar sidesteps o problema inteiro.
    await linkNodeModules(this.project.rootDir, rootDir, this.logger)

    const workspace: Workspace = {
      id,
      taskId: task.id,
      rootDir,
      branch,
      baseCommit: head.value,
      ownedPaths: task.touches,
      createdAt: this.clock.now(),
    }

    const marker: WorkspaceMarker = {
      workspaceId: id,
      taskId: task.id,
      branch,
      baseCommit: head.value,
      createdAt: workspace.createdAt,
    }
    try {
      await writeFile(join(rootDir, MARKER_FILE), JSON.stringify(marker, null, 2))
      // O marker é infraestrutura do harness, não obra do agente: precisa ficar
      // invisível para `git status` do worktree, senão `stage --all` o comitaria.
      await this.excludeMarkerInWorktree(rootDir)
    } catch (error: unknown) {
      await this.vcs.worktreeRemove(this.project.rootDir, rootDir, true)
      return err(new IoError('Falha ao gravar marker do workspace', { cause: error }))
    }

    this.logger.info('Workspace criado', { workspaceId: id, branch, rootDir })
    return ok(workspace)
  }

  async release(
    workspace: WorkspaceRef,
    disposition: 'keep' | 'discard' | 'archive',
  ): Promise<void> {
    if (disposition === 'keep') return

    if (disposition === 'archive') {
      const archiveDir = join(this.project.uranusDir, 'runs', 'orphaned')
      await mkdir(archiveDir, { recursive: true })
      const target = join(archiveDir, workspaceDirName(workspace.id))
      try {
        await rename(workspace.rootDir, target)
      } catch {
        // Cross-device ou lock do antivírus: cai para discard com log.
        this.logger.warn('Falha ao arquivar workspace; descartando', {
          workspaceId: workspace.id,
        })
      }
      // O registro no git precisa sair de qualquer forma.
      await this.vcs.worktreeRemove(this.project.rootDir, workspace.rootDir, true)
      return
    }

    const removed = await this.vcs.worktreeRemove(this.project.rootDir, workspace.rootDir, true)
    if (!removed.ok) {
      this.logger.warn('git worktree remove falhou; removendo diretório à força', {
        workspaceId: workspace.id,
      })
      await rm(workspace.rootDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  }

  async list(): Promise<readonly WorkspaceRef[]> {
    let entries: string[]
    try {
      entries = await readdir(this.worktreesDir)
    } catch {
      return []
    }

    const refs: WorkspaceRef[] = []
    for (const entry of entries) {
      const dir = join(this.worktreesDir, entry)
      const marker = await readMarker(dir)
      if (marker === undefined) continue
      refs.push({
        id: marker.workspaceId,
        taskId: marker.taskId as NonNullable<WorkspaceRef['taskId']>,
        rootDir: dir,
        branch: marker.branch,
        baseCommit: marker.baseCommit,
        createdAt: marker.createdAt,
      })
    }
    return refs
  }

  async orphans(activeTaskIds: ReadonlySet<string>): Promise<readonly WorkspaceRef[]> {
    const all = await this.list()
    return all.filter((ref) => ref.taskId === undefined || !activeTaskIds.has(ref.taskId))
  }

  private async excludeMarkerInWorktree(worktreeDir: string): Promise<void> {
    // Em um worktree, `.git` é um ARQUIVO com "gitdir: <caminho-admin>". Mas
    // `info/exclude` NÃO é privado por-worktree — git só lê `info/exclude` do
    // *common dir* (o `.git` do checkout principal). Escrever no admin dir
    // por-worktree (`<gitdir>/info/exclude`) é um arquivo que o git nunca
    // consulta: silenciosamente inerte, e o marker acaba `??` em todo `git
    // status`/`git add --all`, poluindo cada diff e colidindo entre branches.
    // O admin dir tem um `commondir` (path relativo ao dir raiz do repo
    // principal) que resolve isso sem depender da estrutura `.git/worktrees/*`.
    const gitFile = await readFile(join(worktreeDir, '.git'), 'utf8')
    const match = /^gitdir:\s*(.+)$/m.exec(gitFile)
    if (match === null) return
    const gitDir = match[1]!.trim()

    let commonDir = gitDir
    try {
      const commondirRaw = await readFile(join(gitDir, 'commondir'), 'utf8')
      commonDir = resolve(gitDir, commondirRaw.trim())
    } catch {
      // Sem `commondir`: já é o common dir (não deveria acontecer aqui, mas
      // não há razão para falhar a criação do workspace por causa disso).
    }

    const excludePath = join(commonDir, 'info', 'exclude')
    await mkdir(join(commonDir, 'info'), { recursive: true })
    let existing = ''
    try {
      existing = await readFile(excludePath, 'utf8')
    } catch {
      // primeiro workspace do projeto: ainda não existe.
    }
    // Idempotente e não-destrutivo: o exclude é compartilhado por todos os
    // worktrees, então precisa preservar o que já estava lá (inclusive de
    // outro workspace concorrente) em vez de sobrescrever.
    if (!existing.split('\n').some((line) => line.trim() === MARKER_FILE)) {
      const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : ''
      await writeFile(excludePath, `${existing}${separator}${MARKER_FILE}\n`)
    }
  }
}

async function readMarker(dir: string): Promise<WorkspaceMarker | undefined> {
  try {
    const raw = await readFile(join(dir, MARKER_FILE), 'utf8')
    const parsed = tryParseJson<WorkspaceMarker>(raw)
    return parsed?.workspaceId === undefined ? undefined : parsed
  } catch {
    return undefined
  }
}
