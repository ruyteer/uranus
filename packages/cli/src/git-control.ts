import { access, readdir } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { basename, join } from 'node:path'
import type { Logger, Result, ShellRunner } from '@uranus/core'
import { IoError, NotFoundError, err, ok, tryParseJson } from '@uranus/core'

const GH_TIMEOUT = 60_000
const GIT_TIMEOUT = 30_000
const NEVER_ABORT = new AbortController().signal

export interface PullRequestSummary {
  readonly number: number
  readonly title: string
  readonly author: string
  readonly url: string
  readonly branch: string
  readonly baseBranch: string
  readonly isDraft: boolean
  /** `APPROVED` | `CHANGES_REQUESTED` | `REVIEW_REQUIRED` | `''` (sem review ainda). */
  readonly reviewDecision: string
  /** `MERGEABLE` | `CONFLICTING` | `UNKNOWN`. */
  readonly mergeable: string
  readonly checksState: 'success' | 'failure' | 'pending' | 'unknown'
  readonly additions: number
  readonly deletions: number
  /** Epoch ms — mesma convenção do resto do painel, nunca ISO cru. */
  readonly updatedAt: number
  /** Id do repositório que produziu este PR — ver `discoverGitRepos`. */
  readonly repo: string
}

export interface BranchSummary {
  readonly name: string
  readonly current: boolean
  readonly lastCommitSha: string
  readonly lastCommitAt: number
  readonly lastCommitSubject: string
  readonly repo: string
}

export interface CommitSummary {
  readonly sha: string
  readonly shortSha: string
  readonly author: string
  readonly at: number
  readonly subject: string
  readonly repo: string
}

/** Um repositório que falhou (sem remote, `gh` não autenticado ali, etc.) — os outros continuam valendo. */
export interface RepoError {
  readonly repo: string
  readonly message: string
}

export interface GitHubOverview {
  readonly pulls: readonly PullRequestSummary[]
  readonly branches: readonly BranchSummary[]
  readonly commits: readonly CommitSummary[]
  readonly repoErrors: readonly RepoError[]
}

export interface GitHubControlOptions {
  readonly shell: ShellRunner
  /** Diretório do repositório (não um worktree isolado) — é onde o humano vive. */
  readonly repoDir: string
  /** Rótulo curto do repositório, carimbado em todo PR/branch/commit que produz. Default: nome da pasta. */
  readonly repoId?: string
  readonly logger: Logger
}

/**
 * Controle de Git/GitHub para a aba Git do painel — ler e agir de verdade
 * (aprovar, pedir mudança, mergear, fechar PR), não só listar o que o Uranus
 * mesmo produziu.
 *
 * Via `gh` CLI pelo mesmo motivo do `GitHubHost` (`packages/vcs`): a
 * autenticação já está resolvida na máquina (`gh auth login`), sem token
 * nenhum para o Uranus guardar. Branches e commits vêm de `git` local — são
 * dados do repositório, não da API do GitHub, e ler local é instantâneo e não
 * gasta rate limit.
 */
/** O que `MultiRepoGitHubControl` precisa de cada repositório — `GitHubControl` implementa. */
export interface GitHubRepoControl {
  overview(): Promise<Result<GitHubOverview>>
  reviewPullRequest(
    number: number,
    action: 'approve' | 'request-changes' | 'comment',
    body?: string,
  ): Promise<Result<void>>
  mergePullRequest(number: number, method: 'merge' | 'squash' | 'rebase'): Promise<Result<void>>
  closePullRequest(number: number): Promise<Result<void>>
}

export class GitHubControl implements GitHubRepoControl {
  private readonly shell: ShellRunner
  private readonly repoDir: string
  private readonly repoId: string
  private readonly logger: Logger

  constructor(options: GitHubControlOptions) {
    this.shell = options.shell
    this.repoDir = options.repoDir
    this.repoId = options.repoId ?? basename(options.repoDir)
    this.logger = options.logger.child({ component: 'github-control', repo: this.repoId })
  }

  async overview(): Promise<Result<GitHubOverview>> {
    const [pulls, branches, commits] = await Promise.all([
      this.pullRequests(),
      this.branches(),
      this.commits(30),
    ])
    if (!branches.ok) return branches
    if (!commits.ok) return commits
    // `gh pr list` falhando (sem remote no GitHub, `gh` sem auth ali, repo que
    // não usa PR) é uma falha bem mais comum e bem menos grave que `git`
    // quebrado — branches/commits são dado local, não dependem do GitHub.
    // Preferível mostrar os dois com pulls vazio a derrubar a aba inteira.
    if (!pulls.ok) {
      this.logger.debug('gh pr list falhou; mostrando só branches/commits locais', {
        error: pulls.error.message,
      })
    }
    return ok({
      pulls: pulls.ok ? pulls.value : [],
      branches: branches.value,
      commits: commits.value,
      repoErrors: [],
    })
  }

  async pullRequests(): Promise<Result<readonly PullRequestSummary[]>> {
    const result = await this.gh([
      'pr',
      'list',
      '--state',
      'open',
      '--limit',
      '50',
      '--json',
      'number,title,author,headRefName,baseRefName,isDraft,url,updatedAt,reviewDecision,mergeable,statusCheckRollup,additions,deletions',
    ])
    if (!result.ok) return result
    const rows = tryParseJson<readonly RawPullRequest[]>(result.value) ?? []
    return ok(rows.map((row) => toPullRequestSummary(row, this.repoId)))
  }

  /**
   * `--request-changes` e `--comment` exigem `--body` no `gh`; `--approve`
   * não. Um corpo padrão evita que o painel falhe silenciosamente por causa
   * de um requisito do CLI que a pessoa clicando o botão não tem por que saber.
   */
  async reviewPullRequest(
    number: number,
    action: 'approve' | 'request-changes' | 'comment',
    body?: string,
  ): Promise<Result<void>> {
    const flag =
      action === 'approve' ? '--approve' : action === 'request-changes' ? '--request-changes' : '--comment'
    const texto = body?.trim()
    const args = ['pr', 'review', String(number), flag]
    if (texto !== undefined && texto !== '') {
      args.push('--body', texto)
    } else if (action !== 'approve') {
      args.push(
        '--body',
        action === 'request-changes'
          ? 'Mudanças solicitadas pelo painel do Uranus.'
          : 'Comentário do painel do Uranus.',
      )
    }
    const result = await this.gh(args)
    return result.ok ? ok() : result
  }

  async mergePullRequest(number: number, method: 'merge' | 'squash' | 'rebase'): Promise<Result<void>> {
    const flag = method === 'squash' ? '--squash' : method === 'rebase' ? '--rebase' : '--merge'
    const result = await this.gh(['pr', 'merge', String(number), flag])
    return result.ok ? ok() : result
  }

  async closePullRequest(number: number): Promise<Result<void>> {
    const result = await this.gh(['pr', 'close', String(number)])
    return result.ok ? ok() : result
  }

  async branches(): Promise<Result<readonly BranchSummary[]>> {
    const [currentResult, listResult] = await Promise.all([
      this.git(['rev-parse', '--abbrev-ref', 'HEAD']),
      this.git([
        'for-each-ref',
        'refs/heads',
        '--sort=-committerdate',
        '--format=%(refname:short)%09%(objectname:short)%09%(committerdate:iso-strict)%09%(subject)',
      ]),
    ])
    if (!listResult.ok) return listResult
    const current = currentResult.ok ? currentResult.value.trim() : undefined
    const branches = listResult.value
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line): BranchSummary => {
        const [name, sha, at, ...subjectParts] = line.split('\t')
        return {
          name: name ?? '',
          current: name !== undefined && name === current,
          lastCommitSha: sha ?? '',
          lastCommitAt: parseDateMs(at),
          lastCommitSubject: subjectParts.join('\t'),
          repo: this.repoId,
        }
      })
    return ok(branches)
  }

  async commits(limit: number): Promise<Result<readonly CommitSummary[]>> {
    const result = await this.git([
      'log',
      `-n${String(limit)}`,
      '--pretty=format:%H%x09%h%x09%an%x09%ad%x09%s',
      '--date=iso-strict',
    ])
    if (!result.ok) return result
    const commits = result.value
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line): CommitSummary => {
        const [sha, shortSha, author, at, ...subjectParts] = line.split('\t')
        return {
          sha: sha ?? '',
          shortSha: shortSha ?? '',
          author: author ?? '',
          at: parseDateMs(at),
          subject: subjectParts.join('\t'),
          repo: this.repoId,
        }
      })
    return ok(commits)
  }

  private async gh(args: readonly string[]): Promise<Result<string>> {
    const result = await this.shell.run(
      {
        command: 'gh',
        args: [...args],
        cwd: this.repoDir,
        timeoutMs: GH_TIMEOUT,
        env: { GH_PROMPT_DISABLED: '1', NO_COLOR: '1' },
      },
      NEVER_ABORT,
    )
    if (result.exitCode === 127) {
      return err(
        new IoError('gh CLI não encontrado. Instale-o e rode "gh auth login".', {
          context: { hint: 'https://cli.github.com' },
        }),
      )
    }
    if (result.exitCode !== 0) {
      this.logger.debug('gh falhou', { args, stderr: result.stderr.slice(0, 500) })
      return err(
        new IoError(`gh ${args[0] ?? ''} falhou (exit ${result.exitCode})`, {
          context: { stderr: result.stderr.slice(0, 2_000) },
        }),
      )
    }
    return ok(result.stdout.trim())
  }

  private async git(args: readonly string[]): Promise<Result<string>> {
    const result = await this.shell.run(
      {
        command: 'git',
        args: [...args],
        cwd: this.repoDir,
        timeoutMs: GIT_TIMEOUT,
        env: { GIT_TERMINAL_PROMPT: '0' },
      },
      NEVER_ABORT,
    )
    if (result.exitCode !== 0) {
      return err(
        new IoError(`git ${args[0] ?? ''} falhou (exit ${result.exitCode})`, {
          context: { stderr: result.stderr.slice(0, 1_000) },
        }),
      )
    }
    return ok(result.stdout)
  }
}

export interface DiscoveredRepo {
  readonly id: string
  readonly dir: string
}

/**
 * Acha o(s) repositório(s) git dentro do projeto.
 *
 * A maioria dos projetos tem exatamente um, e é a própria raiz (`.uranus/` e
 * `.git/` no mesmo lugar — `uranus init` roda dentro do repo). Mas nada
 * impede a pasta em que `uranus init` rodou de ser um "monorepo de
 * repositórios": várias pastas irmãs, cada uma com seu próprio `.git`, com o
 * Uranus orquestrando por cima (ex.: `orionbot/` contendo `core/` e
 * `bot-ui/`, dois repos separados). Sem essa detecção, a aba Git assume raiz
 * == repo e falha (`git`/`gh` num diretório sem `.git`) exatamente nesse
 * layout — detectar na hora, em vez de exigir configuração manual, é o que
 * faz funcionar dos dois jeitos.
 */
export async function discoverGitRepos(projectDir: string): Promise<readonly DiscoveredRepo[]> {
  if (await hasGitDir(projectDir)) {
    return [{ id: basename(projectDir), dir: projectDir }]
  }
  let entries: readonly Dirent[]
  try {
    entries = await readdir(projectDir, { withFileTypes: true })
  } catch {
    return []
  }
  const repos: DiscoveredRepo[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const dir = join(projectDir, entry.name)
    if (await hasGitDir(dir)) repos.push({ id: entry.name, dir })
  }
  return repos.sort((a, b) => a.id.localeCompare(b.id))
}

/** `.git` pode ser pasta (repo normal) ou arquivo (`gitdir: ...`, worktree/submódulo) — só a existência importa. */
async function hasGitDir(dir: string): Promise<boolean> {
  try {
    await access(join(dir, '.git'))
    return true
  } catch {
    return false
  }
}

/**
 * Coordena vários `GitHubControl` (um por repositório descoberto) atrás da
 * mesma interface de um só — a aba Git do painel nunca precisa saber se o
 * projeto tem um repo ou dez. `overview()` funde os três repositórios;
 * repositório que falha (sem remote, `gh` não autenticado ali, etc.) não
 * derruba os outros — entra em `repoErrors` e os demais continuam valendo.
 */
export class MultiRepoGitHubControl {
  private readonly byId: Map<string, GitHubRepoControl>

  constructor(private readonly controls: readonly { readonly id: string; readonly control: GitHubRepoControl }[]) {
    this.byId = new Map(controls.map((c) => [c.id, c.control]))
  }

  async overview(): Promise<Result<GitHubOverview>> {
    const results = await Promise.all(
      this.controls.map(async ({ id, control }) => ({ id, result: await control.overview() })),
    )
    const pulls: PullRequestSummary[] = []
    const branches: BranchSummary[] = []
    const commits: CommitSummary[] = []
    const repoErrors: RepoError[] = []
    for (const { id, result } of results) {
      if (result.ok) {
        pulls.push(...result.value.pulls)
        branches.push(...result.value.branches)
        commits.push(...result.value.commits)
      } else {
        repoErrors.push({ repo: id, message: result.error.message })
      }
    }
    // Só propaga erro de verdade se NENHUM repositório rendeu nada — com
    // pelo menos um funcionando, a aba mostra o que deu certo e avisa do
    // resto via `repoErrors`, em vez de derrubar a tela inteira.
    if (results.length > 0 && repoErrors.length === results.length) {
      return err(new IoError(repoErrors.map((e) => `${e.repo}: ${e.message}`).join(' · ')))
    }
    return ok({
      pulls: pulls.sort((a, b) => b.updatedAt - a.updatedAt),
      branches: branches.sort((a, b) => b.lastCommitAt - a.lastCommitAt),
      commits: commits.sort((a, b) => b.at - a.at),
      repoErrors,
    })
  }

  async reviewPullRequest(
    repo: string,
    number: number,
    action: 'approve' | 'request-changes' | 'comment',
    body?: string,
  ): Promise<Result<void>> {
    const control = this.controlFor(repo)
    return control.ok ? control.value.reviewPullRequest(number, action, body) : control
  }

  async mergePullRequest(repo: string, number: number, method: 'merge' | 'squash' | 'rebase'): Promise<Result<void>> {
    const control = this.controlFor(repo)
    return control.ok ? control.value.mergePullRequest(number, method) : control
  }

  async closePullRequest(repo: string, number: number): Promise<Result<void>> {
    const control = this.controlFor(repo)
    return control.ok ? control.value.closePullRequest(number) : control
  }

  private controlFor(repo: string): Result<GitHubRepoControl> {
    const control = this.byId.get(repo)
    if (control === undefined) {
      return err(new NotFoundError(`Repositório "${repo}" não é conhecido pelo painel.`))
    }
    return ok(control)
  }
}

interface RawCheck {
  readonly __typename?: string
  readonly status?: string
  readonly conclusion?: string
  readonly state?: string
}

interface RawPullRequest {
  readonly number: number
  readonly title: string
  readonly author: { readonly login: string } | null
  readonly headRefName: string
  readonly baseRefName: string
  readonly isDraft: boolean
  readonly url: string
  readonly updatedAt: string
  readonly reviewDecision: string | null
  readonly mergeable: string
  readonly statusCheckRollup: readonly RawCheck[] | null
  readonly additions: number
  readonly deletions: number
}

function toPullRequestSummary(raw: RawPullRequest, repo: string): PullRequestSummary {
  return {
    number: raw.number,
    title: raw.title,
    author: raw.author?.login ?? '—',
    url: raw.url,
    branch: raw.headRefName,
    baseBranch: raw.baseRefName,
    isDraft: raw.isDraft,
    reviewDecision: raw.reviewDecision ?? '',
    mergeable: raw.mergeable,
    checksState: checksStateOf(raw.statusCheckRollup ?? []),
    additions: raw.additions,
    repo,
    deletions: raw.deletions,
    updatedAt: parseDateMs(raw.updatedAt),
  }
}

function parseDateMs(iso: string | undefined): number {
  if (iso === undefined) return 0
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : 0
}

function checksStateOf(checks: readonly RawCheck[]): PullRequestSummary['checksState'] {
  if (checks.length === 0) return 'unknown'
  const states = checks.map((check) => (check.conclusion ?? check.state ?? check.status ?? '').toLowerCase())
  if (states.some((state) => /fail|error|timed_out|cancelled/.test(state))) return 'failure'
  if (states.some((state) => state === '' || /pending|progress|queued/.test(state))) return 'pending'
  return 'success'
}
