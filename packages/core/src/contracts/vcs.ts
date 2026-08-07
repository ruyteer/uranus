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
}
