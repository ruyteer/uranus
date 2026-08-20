import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NotFoundError, err, ok } from '@uranus/core'
import type { Result } from '@uranus/core'
import { withTempDir } from '@uranus/testkit'
import type { GitHubOverview, GitHubRepoControl, PullRequestSummary } from './git-control.js'
import { MultiRepoGitHubControl, discoverGitRepos } from './git-control.js'

describe('discoverGitRepos', () => {
  it('projeto que já é um repo git: devolve só ele mesmo', async () => {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, '.git'))
      const repos = await discoverGitRepos(dir)
      expect(repos.map((r) => r.dir)).toEqual([dir])
    })
  })

  it('projeto com duas pastas-repo dentro (ex.: orionbot/core + orionbot/bot-ui)', async () => {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, 'core', '.git'), { recursive: true })
      await mkdir(join(dir, 'bot-ui', '.git'), { recursive: true })
      await mkdir(join(dir, 'docs'), { recursive: true }) // pasta sem .git — não é repo

      const repos = await discoverGitRepos(dir)
      expect(repos.map((r) => r.id).sort()).toEqual(['bot-ui', 'core'])
    })
  })

  it('nenhuma pasta é repo git: devolve lista vazia', async () => {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, 'docs'), { recursive: true })
      const repos = await discoverGitRepos(dir)
      expect(repos).toEqual([])
    })
  })

  it('ignora pastas ocultas (.uranus, .claude) ao procurar repos irmãos', async () => {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, '.uranus', '.git'), { recursive: true })
      await mkdir(join(dir, 'core', '.git'), { recursive: true })
      const repos = await discoverGitRepos(dir)
      expect(repos.map((r) => r.id)).toEqual(['core'])
    })
  })
})

function fakePr(overrides: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    number: 1,
    title: 'x',
    author: 'a',
    url: 'https://x',
    branch: 'feat',
    baseBranch: 'main',
    isDraft: false,
    reviewDecision: '',
    mergeable: 'MERGEABLE',
    checksState: 'success',
    additions: 1,
    deletions: 0,
    updatedAt: 1000,
    repo: 'core',
    ...overrides,
  }
}

function fakeControl(overview: () => Promise<Result<GitHubOverview>>): GitHubRepoControl {
  return {
    overview,
    reviewPullRequest: () => Promise.resolve(ok()),
    mergePullRequest: () => Promise.resolve(ok()),
    closePullRequest: () => Promise.resolve(ok()),
  }
}

describe('MultiRepoGitHubControl', () => {
  it('funde pulls/branches/commits de vários repositórios, ordenados por recência', async () => {
    const core = fakeControl(() =>
      Promise.resolve(
        ok({
          pulls: [fakePr({ repo: 'core', number: 1, updatedAt: 1000 })],
          branches: [],
          commits: [],
          repoErrors: [],
        }),
      ),
    )
    const botUi = fakeControl(() =>
      Promise.resolve(
        ok({
          pulls: [fakePr({ repo: 'bot-ui', number: 5, updatedAt: 2000 })],
          branches: [],
          commits: [],
          repoErrors: [],
        }),
      ),
    )
    const multi = new MultiRepoGitHubControl([
      { id: 'core', control: core },
      { id: 'bot-ui', control: botUi },
    ])

    const result = await multi.overview()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.pulls.map((p) => p.repo)).toEqual(['bot-ui', 'core'])
  })

  it('repositório que falha não derruba os outros — entra em repoErrors', async () => {
    const core = fakeControl(() =>
      Promise.resolve(ok({ pulls: [fakePr({ repo: 'core' })], branches: [], commits: [], repoErrors: [] })),
    )
    const broken = fakeControl(() => Promise.resolve(err(new NotFoundError('sem remote'))))
    const multi = new MultiRepoGitHubControl([
      { id: 'core', control: core },
      { id: 'broken', control: broken },
    ])

    const result = await multi.overview()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.pulls).toHaveLength(1)
    expect(result.value.repoErrors).toEqual([{ repo: 'broken', message: 'sem remote' }])
  })

  it('todos os repositórios falham: overview() devolve erro', async () => {
    const broken = fakeControl(() => Promise.resolve(err(new NotFoundError('sem remote'))))
    const multi = new MultiRepoGitHubControl([{ id: 'broken', control: broken }])

    const result = await multi.overview()
    expect(result.ok).toBe(false)
  })

  it('reviewPullRequest roteia pro repo certo pelo id', async () => {
    let called: number | undefined
    const core = fakeControl(() => Promise.resolve(ok({ pulls: [], branches: [], commits: [], repoErrors: [] })))
    core.reviewPullRequest = (number) => {
      called = number
      return Promise.resolve(ok())
    }
    const multi = new MultiRepoGitHubControl([{ id: 'core', control: core }])

    const result = await multi.reviewPullRequest('core', 42, 'approve')
    expect(result.ok).toBe(true)
    expect(called).toBe(42)
  })

  it('repositório desconhecido: devolve NotFoundError em vez de estourar', async () => {
    const multi = new MultiRepoGitHubControl([])
    const result = await multi.closePullRequest('inexistente', 1)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBeInstanceOf(NotFoundError)
  })
})
