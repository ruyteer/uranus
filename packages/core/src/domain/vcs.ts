import type { TaskId, WorkspaceId } from '../ids.js'
import type { Glob } from '../util/glob.js'

export interface DiffFile {
  readonly path: string
  readonly added: number
  readonly removed: number
  readonly status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'untracked'
  readonly previousPath?: string
}

export interface DiffSummary {
  readonly files: readonly DiffFile[]
  readonly totalAdded: number
  readonly totalRemoved: number
  readonly isEmpty: boolean
}

export const EMPTY_DIFF: DiffSummary = Object.freeze({
  files: Object.freeze([]),
  totalAdded: 0,
  totalRemoved: 0,
  isEmpty: true,
})

export function summarizeDiff(files: readonly DiffFile[]): DiffSummary {
  let added = 0
  let removed = 0
  for (const file of files) {
    added += file.added
    removed += file.removed
  }
  return { files, totalAdded: added, totalRemoved: removed, isEmpty: files.length === 0 }
}

/** Arquivos do diff que caem fora do escopo declarado — INV-5 / `DiffCheck`. */
export function pathsOutsideScope(
  diff: DiffSummary,
  scope: readonly Glob[],
  matches: (path: string, patterns: readonly Glob[]) => boolean,
): readonly string[] {
  if (scope.length === 0) return []
  return diff.files.map((f) => f.path).filter((path) => !matches(path, scope))
}

export interface CommitMessage {
  readonly subject: string
  readonly body?: string
  readonly trailers?: Readonly<Record<string, string>>
}

export interface WorkspaceRef {
  readonly id: WorkspaceId
  readonly taskId?: TaskId
  readonly rootDir: string
  readonly branch: string
  readonly baseCommit: string
  readonly createdAt: number
}

export interface Workspace extends WorkspaceRef {
  readonly ownedPaths: readonly Glob[]
}

export interface PullRequestRef {
  readonly host: string
  readonly repo: string
  readonly number: number
  readonly url: string
}

export interface PullRequestRequest {
  readonly repoDir: string
  readonly head: string
  readonly base: string
  readonly title: string
  readonly body: string
  readonly draft: boolean
  readonly labels: readonly string[]
}

export interface ChecksStatus {
  readonly state: 'pending' | 'success' | 'failure' | 'unknown'
  readonly checks: readonly { name: string; state: string; url?: string }[]
}
