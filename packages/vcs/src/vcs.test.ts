import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

  it('stage normaliza CRLF pra LF mesmo com o commit global core.autocrlf=false (evita "conflito gigante" em merges futuros)', async () => {
    await withTempDir(async (dir) => {
      createGitRepo({ dir, files: { 'src/a.ts': 'export const a = 1\n' } })
      const git = makeGit()

      // Simula o bug real: o passo de escrita do executor grava CRLF num
      // arquivo modificado, apesar do resto do repo ser LF.
      writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 2\r\nexport const b = 3\r\n')

      unwrap(await git.stage(dir, []))
      unwrap(await git.commit(dir, { subject: 'feat: crlf sneak-in' }))

      const blob = gitIn(dir, 'show', 'HEAD:src/a.ts')
      expect(blob).not.toContain('\r')

      const raw = readFileSync(join(dir, 'src', 'a.ts'))
      expect(Buffer.compare(raw, Buffer.from('export const a = 2\r\nexport const b = 3\r\n'))).toBe(
        0,
      )
    })
  })

  it('fetch + rebase sincronizam com o que uma task irmã já mergeou, sem conflito', async () => {
    await withTempDir(async (base) => {
      const bareDir = join(base, 'origin.git')
      mkdirSync(bareDir, { recursive: true })
      gitIn(bareDir, 'init', '--bare', '-b', 'main')

      const dir = join(base, 'work')
      createGitRepo({
        dir,
        files: { 'a.ts': 'export const a = 1\n', 'b.ts': 'export const b = 1\n' },
      })
      gitIn(dir, 'remote', 'add', 'origin', bareDir)
      gitIn(dir, 'push', 'origin', 'main')

      // Task irmã: outro checkout do mesmo remoto, edita um arquivo
      // diferente e já mergeou (push direto em main) antes desta terminar.
      const sibling = join(base, 'sibling')
      gitIn(base, 'clone', bareDir, sibling)
      writeFileSync(join(sibling, 'b.ts'), 'export const b = 2\n')
      gitIn(sibling, 'add', '--all')
      gitIn(sibling, 'commit', '-m', 'task irmã: edita b.ts')
      gitIn(sibling, 'push', 'origin', 'main')

      // Esta task: base antiga (ainda não viu o commit da irmã), edita outro
      // arquivo.
      const git = makeGit()
      writeFileSync(join(dir, 'a.ts'), 'export const a = 2\n')
      unwrap(await git.stage(dir, []))
      unwrap(await git.commit(dir, { subject: 'esta task: edita a.ts' }))

      unwrap(await git.fetch(dir, 'origin'))
      unwrap(await git.rebase(dir, 'origin/main'))

      // As duas mudanças convivem: a da irmã (já mergeada) e a desta task,
      // reaplicada em cima.
      expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe('export const a = 2\n')
      expect(readFileSync(join(dir, 'b.ts'), 'utf8')).toBe('export const b = 2\n')
      expect(gitIn(dir, 'log', '--oneline', 'origin/main..HEAD')).toContain('esta task: edita a.ts')
    })
  })

  it('rebase em conflito aborta e devolve a working tree limpa', async () => {
    await withTempDir(async (base) => {
      const bareDir = join(base, 'origin.git')
      mkdirSync(bareDir, { recursive: true })
      gitIn(bareDir, 'init', '--bare', '-b', 'main')

      const dir = join(base, 'work')
      createGitRepo({ dir, files: { 'a.ts': 'export const a = 1\n' } })
      gitIn(dir, 'remote', 'add', 'origin', bareDir)
      gitIn(dir, 'push', 'origin', 'main')

      // Task irmã edita a MESMA linha e já mergeou.
      const sibling = join(base, 'sibling')
      gitIn(base, 'clone', bareDir, sibling)
      writeFileSync(join(sibling, 'a.ts'), 'export const a = 2\n')
      gitIn(sibling, 'add', '--all')
      gitIn(sibling, 'commit', '-m', 'task irmã: muda a linha')
      gitIn(sibling, 'push', 'origin', 'main')

      // Esta task edita a mesma linha de um jeito diferente, sem saber.
      const git = makeGit()
      const ownCommit = (() => {
        writeFileSync(join(dir, 'a.ts'), 'export const a = 99\n')
        return dir
      })()
      unwrap(await git.stage(ownCommit, []))
      const sha = unwrap(
        await git.commit(ownCommit, { subject: 'esta task: muda a linha diferente' }),
      )

      unwrap(await git.fetch(dir, 'origin'))
      const rebased = await git.rebase(dir, 'origin/main')
      expect(rebased.ok).toBe(false)

      // Nunca deixa a working tree no meio de um rebase — nem marcador de
      // conflito, nem HEAD deslocada do commit local original.
      expect(await git.isClean(dir)).toBe(true)
      expect(unwrap(await git.head(dir))).toBe(sha)
    })
  })

  it('stashList/stashPop devolvem um stash sobrando (agente que roda "git stash" e esquece o pop)', async () => {
    await withTempDir(async (dir) => {
      createGitRepo({ dir, files: { 'src/a.ts': 'export const a = 1\n' } })
      const git = makeGit()
      const base = unwrap(await git.head(dir))

      expect(await git.stashList(dir)).toHaveLength(0)

      writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 2\n')
      gitIn(dir, 'stash')

      // Sem restaurar, o diff não vê a edição — exatamente o "produziu-mudanca"
      // falhando em silêncio mesmo com trabalho real feito na sessão.
      expect((await git.stashList(dir)).length).toBeGreaterThan(0)
      const diffWhileStashed = unwrap(await git.diff(dir, { base, includeUntracked: true }))
      expect(diffWhileStashed.isEmpty).toBe(true)

      unwrap(await git.stashPop(dir))
      expect(await git.stashList(dir)).toHaveLength(0)
      const diffAfterPop = unwrap(await git.diff(dir, { base, includeUntracked: true }))
      expect(diffAfterPop.isEmpty).toBe(false)
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

  it('linka node_modules do repo principal no worktree novo, e discard nunca apaga o original', async () => {
    await withTempDir(async (dir) => {
      createGitRepo({ dir })
      mkdirSync(join(dir, 'node_modules', 'alguma-lib'), { recursive: true })
      writeFileSync(join(dir, 'node_modules', 'alguma-lib', 'index.js'), 'module.exports = 42\n')

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

      const task = makeTask({ title: 'Task com dependencias' })
      const workspace = unwrap(await sandbox.acquire(task, NEVER))

      // O worktree novo enxerga a dependência sem reinstalar nada.
      const linked = readFileSync(
        join(workspace.rootDir, 'node_modules', 'alguma-lib', 'index.js'),
        'utf8',
      )
      expect(linked).toBe('module.exports = 42\n')

      // `discard` apaga o worktree inteiro (recursivo) — não pode seguir o
      // link e apagar o node_modules de verdade do repo principal.
      await sandbox.release(workspace, 'discard')
      expect(
        readFileSync(join(dir, 'node_modules', 'alguma-lib', 'index.js'), 'utf8'),
      ).toBe('module.exports = 42\n')
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

  it('marker do workspace nunca é staged por `git add --all` (info/exclude é do common dir, não do admin dir por-worktree)', async () => {
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

      const task = makeTask({ title: 'Task qualquer' })
      const workspace = unwrap(await sandbox.acquire(task, NEVER))

      // O agente edita algo real e roda `git add --all` (o que o harness faz
      // em `integrate()`). O marker `.uranus-workspace.json` está sentado ao
      // lado, mas não é obra do agente e não pode virar parte do commit — do
      // contrário, cada workspace commita um arquivo com o mesmo path e
      // conteúdo diferente (workspaceId/taskId/branch), e a próxima PR
      // colide em "add/add" com a anterior já mergeada.
      writeFileSync(join(workspace.rootDir, 'gerado.txt'), 'conteudo real')
      unwrap(await git.stage(workspace.rootDir, []))

      const staged = gitIn(workspace.rootDir, 'diff', '--cached', '--name-only')
      expect(staged.split('\n')).toContain('gerado.txt')
      expect(staged).not.toContain('.uranus-workspace.json')

      const status = gitIn(workspace.rootDir, 'status', '--porcelain', '-uall')
      expect(status).not.toContain('.uranus-workspace.json')
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
