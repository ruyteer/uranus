import type {
  CommitMessage,
  DiffFile,
  DiffOptions,
  DiffSummary,
  Logger,
  PushOptions,
  Result,
  ShellCommand,
  ShellResult,
  ShellRunner,
  VcsAdapter,
} from '@uranus/core'
import { IoError, err, ok, summarizeDiff, toPosix } from '@uranus/core'

const GIT_TIMEOUT = 60_000
const NEVER_ABORT = new AbortController().signal

export interface GitAdapterOptions {
  readonly shell: ShellRunner
  readonly logger: Logger
}

/**
 * Adaptador git sobre o `ShellRunner`.
 *
 * Sempre `spawn` com array de args — nunca shell string — para que nome de
 * branch, path com espaço ou mensagem de commit jamais passem por quoting de
 * shell (ADR-011). Mensagens de commit multilinhas entram por arquivo temporário
 * implícito via `-m` repetido.
 */
export class GitAdapter implements VcsAdapter {
  private readonly shell: ShellRunner
  private readonly logger: Logger

  constructor(options: GitAdapterOptions) {
    this.shell = options.shell
    this.logger = options.logger.child({ component: 'git' })
  }

  private git(dir: string, args: readonly string[]): Promise<ShellResult> {
    const command: ShellCommand = {
      command: 'git',
      args: [...args],
      cwd: dir,
      timeoutMs: GIT_TIMEOUT,
      env: {
        // Sem prompts interativos, nunca (o kernel roda sem humano no terminal).
        GIT_TERMINAL_PROMPT: '0',
        GIT_CONFIG_PARAMETERS: "'core.autocrlf=false'",
      },
    }
    return this.shell.run(command, NEVER_ABORT)
  }

  private async gitOk(dir: string, args: readonly string[]): Promise<Result<string>> {
    const result = await this.git(dir, args)
    if (result.exitCode !== 0) {
      return err(
        new IoError(`git ${args[0] ?? ''} falhou (exit ${result.exitCode})`, {
          context: { args: args.join(' '), stderr: result.stderr.slice(0, 2_000) },
        }),
      )
    }
    return ok(result.stdout.trim())
  }

  async isRepo(dir: string): Promise<boolean> {
    const result = await this.git(dir, ['rev-parse', '--is-inside-work-tree'])
    return result.exitCode === 0 && result.stdout.trim() === 'true'
  }

  async isClean(dir: string): Promise<boolean> {
    const result = await this.git(dir, ['status', '--porcelain'])
    return result.exitCode === 0 && result.stdout.trim().length === 0
  }

  head(dir: string): Promise<Result<string>> {
    return this.gitOk(dir, ['rev-parse', 'HEAD'])
  }

  async defaultBranch(dir: string): Promise<Result<string>> {
    const remote = await this.git(dir, ['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'])
    if (remote.exitCode === 0) {
      return ok(remote.stdout.trim().replace(/^origin\//, ''))
    }
    // Sem remote: usa a branch atual.
    return this.currentBranch(dir)
  }

  currentBranch(dir: string): Promise<Result<string>> {
    return this.gitOk(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])
  }

  async worktreeAdd(
    repoDir: string,
    path: string,
    branch: string,
    base: string,
  ): Promise<Result<void>> {
    const result = await this.gitOk(repoDir, ['worktree', 'add', '-b', branch, path, base])
    if (!result.ok) return result
    this.logger.debug('Worktree criado', { path, branch })
    return ok()
  }

  async worktreeRemove(repoDir: string, path: string, force: boolean): Promise<Result<void>> {
    const args = ['worktree', 'remove', path]
    if (force) args.push('--force')
    const result = await this.gitOk(repoDir, args)
    if (!result.ok) {
      // Diretório já apagado à mão: prune limpa o registro.
      await this.git(repoDir, ['worktree', 'prune'])
      return result
    }
    return ok()
  }

  async worktreeList(
    repoDir: string,
  ): Promise<readonly { path: string; branch: string; head: string }[]> {
    const result = await this.git(repoDir, ['worktree', 'list', '--porcelain'])
    if (result.exitCode !== 0) return []
    const entries: { path: string; branch: string; head: string }[] = []
    let current: { path?: string; branch?: string; head?: string } = {}
    for (const line of result.stdout.split('\n')) {
      if (line.startsWith('worktree ')) current.path = line.slice(9).trim()
      else if (line.startsWith('HEAD ')) current.head = line.slice(5).trim()
      else if (line.startsWith('branch ')) {
        current.branch = line.slice(7).trim().replace('refs/heads/', '')
      } else if (line.trim() === '' && current.path !== undefined) {
        entries.push({
          path: current.path,
          branch: current.branch ?? '(detached)',
          head: current.head ?? '',
        })
        current = {}
      }
    }
    if (current.path !== undefined) {
      entries.push({
        path: current.path,
        branch: current.branch ?? '(detached)',
        head: current.head ?? '',
      })
    }
    return entries
  }

  async stage(dir: string, paths: readonly string[]): Promise<Result<void>> {
    const args = paths.length === 0 ? ['add', '--all'] : ['add', '--', ...paths]
    const result = await this.gitOk(dir, args)
    return result.ok ? ok() : result
  }

  async commit(dir: string, message: CommitMessage): Promise<Result<string>> {
    const args = ['commit', '-m', message.subject]
    if (message.body !== undefined && message.body.length > 0) {
      args.push('-m', message.body)
    }
    const trailers = Object.entries(message.trailers ?? {})
    if (trailers.length > 0) {
      args.push('-m', trailers.map(([key, value]) => `${key}: ${value}`).join('\n'))
    }
    const committed = await this.gitOk(dir, args)
    if (!committed.ok) return committed
    return this.head(dir)
  }

  async diff(dir: string, options: DiffOptions = {}): Promise<Result<DiffSummary>> {
    const base = options.base
    const files = new Map<string, DiffFile>()

    // numstat cobre tracked (modificados/renomeados/deletados)...
    const numstatArgs =
      base !== undefined
        ? ['diff', '--numstat', '--find-renames', base]
        : options.staged === true
          ? ['diff', '--numstat', '--cached']
          : ['diff', '--numstat', 'HEAD']
    const numstat = await this.git(dir, numstatArgs)
    if (numstat.exitCode !== 0) {
      return err(
        new IoError('git diff --numstat falhou', {
          context: { stderr: numstat.stderr.slice(0, 1_000) },
        }),
      )
    }
    for (const line of numstat.stdout.split('\n')) {
      if (line.trim() === '') continue
      const [added, removed, ...rest] = line.split('\t')
      const rawPath = rest.join('\t')
      if (rawPath === '') continue
      const { path, previousPath } = parseRenamePath(rawPath)
      files.set(path, {
        path: toPosix(path),
        added: added === '-' ? 0 : Number.parseInt(added ?? '0', 10),
        removed: removed === '-' ? 0 : Number.parseInt(removed ?? '0', 10),
        status: previousPath === undefined ? 'modified' : 'renamed',
        ...(previousPath === undefined ? {} : { previousPath: toPosix(previousPath) }),
      })
    }

    // ...e o status distingue added/deleted/untracked. `-uall` lista arquivos
    // individuais dentro de diretórios novos — sem isso, `src/novo/` apareceria
    // como uma entrada de diretório e o lease de escopo não teria o path real.
    const status = await this.git(dir, ['status', '--porcelain', '-uall'])
    if (status.exitCode === 0) {
      for (const line of status.stdout.split('\n')) {
        if (line.length < 4) continue
        const flags = line.slice(0, 2)
        const path = line.slice(3).trim().replace(/^"|"$/g, '')
        if (flags === '??') {
          if (options.includeUntracked === true && !files.has(path)) {
            const lines = await this.countLines(dir, path)
            files.set(path, {
              path: toPosix(path),
              added: lines,
              removed: 0,
              status: 'untracked',
            })
          }
        } else if (flags.includes('A') && files.has(path)) {
          files.set(path, { ...files.get(path)!, status: 'added' })
        } else if (flags.includes('D') && files.has(path)) {
          files.set(path, { ...files.get(path)!, status: 'deleted' })
        }
      }
    }

    return ok(summarizeDiff([...files.values()]))
  }

  private async countLines(dir: string, path: string): Promise<number> {
    const result = await this.git(dir, ['diff', '--numstat', '--no-index', '/dev/null', path])
    if (result.exitCode !== 0 && result.stdout.trim() === '') {
      // Windows não tem /dev/null para o git em alguns setups; estimativa 0 é aceitável.
      return 0
    }
    const first = result.stdout.split('\n')[0] ?? ''
    const added = first.split('\t')[0] ?? '0'
    return added === '-' ? 0 : Number.parseInt(added, 10) || 0
  }

  async push(dir: string, branch: string, options: PushOptions = {}): Promise<Result<void>> {
    const args = ['push']
    if (options.setUpstream === true) args.push('--set-upstream')
    if (options.force === true) args.push('--force-with-lease')
    args.push(options.remote ?? 'origin', branch)
    const result = await this.gitOk(dir, args)
    return result.ok ? ok() : result
  }
}

function parseRenamePath(raw: string): { path: string; previousPath?: string } {
  // Formatos: "old => new" ou "prefix{old => new}suffix"
  const braced = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(raw)
  if (braced !== null) {
    return {
      path: `${braced[1]!}${braced[3]!}${braced[4]!}`,
      previousPath: `${braced[1]!}${braced[2]!}${braced[4]!}`,
    }
  }
  const simple = /^(.*) => (.*)$/.exec(raw)
  if (simple !== null) {
    return { path: simple[2]!, previousPath: simple[1]! }
  }
  return { path: raw }
}
