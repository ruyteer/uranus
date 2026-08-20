import type { Result } from '../result.js'
import type {
  ChecksStatus,
  CommitMessage,
  DiffSummary,
  PullRequestRef,
  PullRequestRequest,
} from '../domain/vcs.js'

export interface DiffOptions {
  readonly staged?: boolean
  readonly base?: string
  readonly includeUntracked?: boolean
}

export interface PushOptions {
  readonly force?: boolean
  readonly setUpstream?: boolean
  readonly remote?: string
}

export interface VcsAdapter {
  isRepo(dir: string): Promise<boolean>
  isClean(dir: string): Promise<boolean>
  head(dir: string): Promise<Result<string>>
  defaultBranch(dir: string): Promise<Result<string>>
  currentBranch(dir: string): Promise<Result<string>>

  /** ADR-005: isolamento por worktree. Nunca escrever na working tree principal. */
  worktreeAdd(repoDir: string, path: string, branch: string, base: string): Promise<Result<void>>
  worktreeRemove(repoDir: string, path: string, force: boolean): Promise<Result<void>>
  worktreeList(repoDir: string): Promise<readonly { path: string; branch: string; head: string }[]>

  stage(dir: string, paths: readonly string[]): Promise<Result<void>>
  commit(dir: string, message: CommitMessage): Promise<Result<string>>
  diff(dir: string, options?: DiffOptions): Promise<Result<DiffSummary>>
  push(dir: string, branch: string, options?: PushOptions): Promise<Result<void>>

  /** Atualiza os refs remote-tracking (`<remote>/<branch>`) sem tocar na working tree. */
  fetch(dir: string, remote?: string): Promise<Result<void>>
  /**
   * Rebase da branch atual (HEAD) sobre `onto` — tipicamente `<remote>/<base>`
   * logo após `fetch`, pra sincronizar com o que outras tasks já mergearam
   * antes de empurrar/abrir PR. Em conflito, aborta o rebase (a working tree
   * volta pro estado de antes da chamada) e devolve erro — nunca deixa
   * marcadores `<<<<<<<` espalhados pro caller resolver.
   */
  rebase(dir: string, onto: string): Promise<Result<void>>

  /**
   * Um agente com `Bash` livre pode rodar `git stash` pra isolar um teste e
   * esquecer o `pop` — o diff fica vazio e o Verifier vê "nada mudou" mesmo
   * com edits reais na sessão. Estas duas entradas existem só pra devolver
   * esse estado antes da verificação decidir qualquer coisa (INV-2).
   */
  stashList(dir: string): Promise<readonly string[]>
  stashPop(dir: string): Promise<Result<void>>
}

export interface IssueRef {
  readonly id: string
  readonly number: number
  readonly title: string
  readonly body: string
  readonly labels: readonly string[]
  readonly url: string
}

export interface IssueQuery {
  readonly repo: string
  readonly labels?: readonly string[]
  readonly state?: 'open' | 'closed' | 'all'
  readonly limit?: number
}

export interface CodeHost {
  readonly id: string
  openPullRequest(request: PullRequestRequest): Promise<Result<PullRequestRef>>
  updatePullRequest(ref: PullRequestRef, patch: Partial<PullRequestRequest>): Promise<Result<void>>
  checksStatus(ref: PullRequestRef): Promise<Result<ChecksStatus>>
  listIssues(query: IssueQuery): Promise<Result<readonly IssueRef[]>>
  /**
   * PR aberto que já referencia esta task no corpo (convenção `Task: <id>`
   * usada em todo PR que o Uranus abre). Cada tentativa nasce numa branch
   * nova (o slug carrega o id do workspace) — procurar por branch nunca
   * encontraria uma tentativa irmã já integrada; procurar pelo texto do
   * corpo encontra, e é o que permite `integrate()` atualizar em vez de
   * abrir um segundo PR pra mesma task.
   */
  findOpenPullRequestForTask(
    repoDir: string,
    taskId: string,
  ): Promise<Result<PullRequestRef | undefined>>
}
