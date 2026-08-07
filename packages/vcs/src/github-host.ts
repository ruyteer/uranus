import type {
  ChecksStatus,
  CodeHost,
  IssueQuery,
  IssueRef,
  Logger,
  PullRequestRef,
  PullRequestRequest,
  Result,
  ShellRunner,
} from '@uranus/core'
import { IoError, err, ok, tryParseJson } from '@uranus/core'

const GH_TIMEOUT = 60_000
const NEVER_ABORT = new AbortController().signal

export interface GitHubHostOptions {
  readonly shell: ShellRunner
  readonly logger: Logger
}

/**
 * Host GitHub via `gh` CLI.
 *
 * A escolha pelo `gh` (e não pela REST API) é deliberada para o MVP: a
 * autenticação já está resolvida na máquina do usuário (`gh auth login`), o que
 * elimina gestão de token pelo Uranus — um segredo a menos para vazar (R12).
 * Um `RestGitHubHost` pode coexistir depois; o contrato é o mesmo.
 */
export class GitHubHost implements CodeHost {
  readonly id = 'github'
  private readonly shell: ShellRunner
  private readonly logger: Logger

  constructor(options: GitHubHostOptions) {
    this.shell = options.shell
    this.logger = options.logger.child({ component: 'github' })
  }

  private async gh(cwd: string, args: readonly string[]): Promise<Result<string>> {
    const result = await this.shell.run(
      {
        command: 'gh',
        args: [...args],
        cwd,
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
      return err(
        new IoError(`gh ${args[0] ?? ''} falhou (exit ${result.exitCode})`, {
          context: { stderr: result.stderr.slice(0, 2_000) },
        }),
      )
    }
    return ok(result.stdout.trim())
  }

  async openPullRequest(request: PullRequestRequest): Promise<Result<PullRequestRef>> {
    const args = [
      'pr',
      'create',
      '--head',
      request.head,
      '--base',
      request.base,
      '--title',
      request.title,
      '--body',
      request.body,
    ]
    if (request.draft) args.push('--draft')
    for (const label of request.labels) args.push('--label', label)

    const created = await this.gh(request.repoDir, args)
    if (!created.ok) return created

    // `gh pr create` imprime a URL do PR.
    const url = created.value.split('\n').findLast((line) => line.startsWith('https://')) ?? ''
    const ref = parsePrUrl(url)
    if (ref === undefined) {
      return err(new IoError('Não foi possível interpretar a URL do PR', { context: { url } }))
    }
    this.logger.info('Pull request aberto', { url })
    return ok(ref)
  }

  async updatePullRequest(
    ref: PullRequestRef,
    patch: Partial<PullRequestRequest>,
  ): Promise<Result<void>> {
    const args = ['pr', 'edit', String(ref.number), '--repo', ref.repo]
    if (patch.title !== undefined) args.push('--title', patch.title)
    if (patch.body !== undefined) args.push('--body', patch.body)
    const result = await this.gh(process.cwd(), args)
    return result.ok ? ok() : result
  }

  async checksStatus(ref: PullRequestRef): Promise<Result<ChecksStatus>> {
    const result = await this.gh(process.cwd(), [
      'pr',
      'checks',
      String(ref.number),
      '--repo',
      ref.repo,
      '--json',
      'name,state,link',
    ])
    if (!result.ok) {
      // `gh pr checks` retorna exit != 0 quando há check falhando — não é erro do gh.
      return ok({ state: 'unknown', checks: [] })
    }
    const rows = tryParseJson<{ name: string; state: string; link?: string }[]>(result.value) ?? []
    const states = rows.map((r) => r.state.toLowerCase())
    const state: ChecksStatus['state'] = states.some((s) => s.includes('fail'))
      ? 'failure'
      : states.some((s) => s.includes('pending') || s.includes('progress'))
        ? 'pending'
        : rows.length > 0
          ? 'success'
          : 'unknown'
    return ok({
      state,
      checks: rows.map((r) => ({
        name: r.name,
        state: r.state,
        ...(r.link === undefined ? {} : { url: r.link }),
      })),
    })
  }

  async listIssues(query: IssueQuery): Promise<Result<readonly IssueRef[]>> {
    const args = [
      'issue',
      'list',
      '--repo',
      query.repo,
      '--state',
      query.state ?? 'open',
      '--limit',
      String(query.limit ?? 50),
      '--json',
      'number,title,body,labels,url',
    ]
    for (const label of query.labels ?? []) args.push('--label', label)
    const result = await this.gh(process.cwd(), args)
    if (!result.ok) return result
    const rows =
      tryParseJson<
        { number: number; title: string; body: string; labels: { name: string }[]; url: string }[]
      >(result.value) ?? []
    return ok(
      rows.map((r) => ({
        id: String(r.number),
        number: r.number,
        title: r.title,
        body: r.body,
        labels: r.labels.map((l) => l.name),
        url: r.url,
      })),
    )
  }
}

export function parsePrUrl(url: string): PullRequestRef | undefined {
  const match = /https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(url)
  if (match === null) return undefined
  return {
    host: 'github',
    repo: match[1]!,
    number: Number.parseInt(match[2]!, 10),
    url,
  }
}
