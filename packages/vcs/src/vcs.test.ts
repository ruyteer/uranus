import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { silentLogger, systemClock, unwrap } from '@uranus/core'
import { DefaultShellRunner, WorktreeSandbox } from '@uranus/executors'
import { createGitRepo, gitIn, makeTask, withTempDir } from '@uranus/testkit'
import { GitAdapter } from './git-adapter.js'
import { parsePrUrl } from './github-host.js'

const NEVER = new AbortController().signal

function makeGit(): GitAdapter {
  return new GitAdapter({
    shell: new DefaultShellRunner({ clock: systemClock, logger: silentLogger }),
    logger: silentLogger,
  })
}

describe('GitAdapter', () => {
  it('reconhece repositório e estado limpo', async () => {
    await withTempDir(async (dir) => {
      const git = makeGit()
      expect(await git.isRepo(dir)).toBe(false)
      createGitRepo({ dir })
      expect(await git.isRepo(dir)).toBe(true)
      expect(await git.isClean(dir)).toBe(true)

      writeFileSync(join(dir, 'novo.txt'), 'x')
      expect(await git.isClean(dir)).toBe(false)
    })
  })

  it('head e branch atual', async () => {
    await withTempDir(async (dir) => {
      createGitRepo({ dir })
      const git = makeGit()
      expect(unwrap(await git.head(dir))).toMatch(/^[0-9a-f]{40}$/)
      expect(unwrap(await git.currentBranch(dir))).toBe('main')
      expect(unwrap(await git.defaultBranch(dir))).toBe('main')
    })
  })

  it('worktree add/list/remove', async () => {
    await withTempDir(async (dir) => {
      createGitRepo({ dir })
      const git = makeGit()
      const head = unwrap(await git.head(dir))
      const wtPath = join(dir, '.uranus', 'w', 'abc12345')

      unwrap(await git.worktreeAdd(dir, wtPath, 'uranus/test-abc12345', head))
      const list = await git.worktreeList(dir)
      expect(list.some((w) => w.branch === 'uranus/test-abc12345')).toBe(true)

      unwrap(await git.worktreeRemove(dir, wtPath, true))
      const after = await git.worktreeList(dir)
      expect(after.some((w) => w.branch === 'uranus/test-abc12345')).toBe(false)
    })
  })

  it('stage + commit + diff contra base', async () => {
    await withTempDir(async (dir) => {
      createGitRepo({ dir, files: { 'src/a.ts': 'export const a = 1\n' } })
      const git = makeGit()
      const base = unwrap(await git.head(dir))

      writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 2\nexport const b = 3\n')
      mkdirSync(join(dir, 'src', 'novo'), { recursive: true })
      writeFileSync(join(dir, 'src', 'novo', 'b.ts'), 'export const c = 1\n')

      const diff = unwrap(await git.diff(dir, { base, includeUntracked: true }))
      expect(diff.isEmpty).toBe(false)
      expect(diff.files.map((f) => f.path).sort()).toEqual(['src/a.ts', 'src/novo/b.ts'])
      const untracked = diff.files.find((f) => f.path === 'src/novo/b.ts')
      expect(untracked?.status).toBe('untracked')

      unwrap(await git.stage(dir, []))
      const sha = unwrap(
        await git.commit(dir, {
          subject: 'feat: altera a',
          body: 'corpo',
          trailers: { 'Co-Authored-By': 'Uranus <u@local>' },
        }),
      )
      expect(sha).toMatch(/^[0-9a-f]{40}$/)
      expect(await git.isClean(dir)).toBe(true)

      const message = gitIn(dir, 'log', '-1', '--format=%B')
      expect(message).toContain('feat: altera a')
      expect(message).toContain('Co-Authored-By: Uranus <u@local>')
    })
  })

  it('diff vazio quando nada mudou', async () => {
    await withTempDir(async (dir) => {
      createGitRepo({ dir })
      const git = makeGit()
      const base = unwrap(await git.head(dir))
      const diff = unwrap(await git.diff(dir, { base, includeUntracked: true }))
      expect(diff.isEmpty).toBe(true)
    })
  })
})

describe('WorktreeSandbox', () => {
  it('acquire cria worktree isolado; release discard remove', async () => {
    await withTempDir(async (dir) => {
      createGitRepo({ dir })
      const git = makeGit()
      const sandbox = new WorktreeSandbox({
        project: {
          id: 'prj_x' as never,
          name: 'fixture',
          rootDir: dir,
          uranusDir: join(dir, '.uranus'),
        },
        vcs: git,
        clock: systemClock,
        logger: silentLogger,
        branchPrefix: 'uranus/',
      })

      const task = makeTask({ title: 'Nova Feature Importante' })
      const workspace = unwrap(await sandbox.acquire(task, NEVER))
      expect(workspace.branch).toMatch(/^uranus\/nova-feature-importante-/)
      expect(workspace.rootDir).toContain(join('.uranus', 'w'))

      // Isolamento (INV-5): escrever no worktree não suja a árvore principal.
      writeFileSync(join(workspace.rootDir, 'gerado.txt'), 'conteudo')
      expect(await git.isClean(dir)).toBe(true)

      const listed = await sandbox.list()
      expect(listed).toHaveLength(1)
      expect(listed[0]!.taskId).toBe(task.id)

      await sandbox.release(workspace, 'discard')
      expect(await sandbox.list()).toHaveLength(0)
    })
  })

  it('orphans identifica worktree de task não-ativa após crash', async () => {
    await withTempDir(async (dir) => {
      createGitRepo({ dir })
      const git = makeGit()
      const sandbox = new WorktreeSandbox({
        project: {
          id: 'prj_x' as never,
          name: 'fixture',
          rootDir: dir,
          uranusDir: join(dir, '.uranus'),
        },
        vcs: git,
        clock: systemClock,
        logger: silentLogger,
        branchPrefix: 'uranus/',
      })
      const task = makeTask()
      const workspace = unwrap(await sandbox.acquire(task, NEVER))

      // "Crash": ninguém liberou. Um novo processo pergunta pelos órfãos.
      const fresh = new WorktreeSandbox({
        project: {
          id: 'prj_x' as never,
          name: 'fixture',
          rootDir: dir,
          uranusDir: join(dir, '.uranus'),
        },
        vcs: git,
        clock: systemClock,
        logger: silentLogger,
        branchPrefix: 'uranus/',
      })
      const orphansWhenActive = await fresh.orphans(new Set([task.id]))
      expect(orphansWhenActive).toHaveLength(0)

      const orphansWhenInactive = await fresh.orphans(new Set())
      expect(orphansWhenInactive).toHaveLength(1)
      expect(orphansWhenInactive[0]!.id).toBe(workspace.id)

      await fresh.release(orphansWhenInactive[0]!, 'archive')
      expect(await fresh.list()).toHaveLength(0)
    })
  })
})

describe('GitHubHost', () => {
  it('interpreta URL de PR', () => {
    const ref = parsePrUrl('https://github.com/ruyteer/uranus/pull/42')
    expect(ref).toEqual({
      host: 'github',
      repo: 'ruyteer/uranus',
      number: 42,
      url: 'https://github.com/ruyteer/uranus/pull/42',
    })
    expect(parsePrUrl('https://exemplo.com/x')).toBeUndefined()
  })
})
