import { describe, expect, it } from 'vitest'
import { unwrap } from '@uranus/core'
import { createGitRepo, gitIn, withTempDir } from '@uranus/testkit'
import { artifactAcceptance, makeTestStack } from './test-stack.js'

describe('UranusKernel — o ciclo completo (DoD Fase 2)', () => {
  it('caminho feliz: task → worktree → executor → verificação → commit → done', async () => {
    await withTempDir(async (dir) => {
      createGitRepo({ dir, files: { 'src/index.ts': 'export {}\n' } })
      const stack = await makeTestStack(dir, [
        { writes: { 'src/hello.ts': 'export const hello = "ola mundo"\n' } },
      ])
      try {
        const task = await stack.enqueue({
          title: 'Adicionar hello',
          acceptance: artifactAcceptance('src/hello.ts', 'ola mundo'),
        })

        unwrap(await stack.kernel.start({ projectId: stack.project.id }))
        await stack.kernel.wait()

        // Task terminou em done com 1 tentativa.
        const final = await stack.state.tasks.find(task.id)
        expect(final?.state).toBe('done')
        expect(final?.attempts).toBe(1)

        // O commit existe na branch do worktree — e a main não foi tocada.
        const commits = gitIn(
          dir,
          'log',
          '--all',
          '--oneline',
          '--grep',
          'feature: Adicionar hello',
        )
        expect(commits.split('\n').filter((l) => l.trim() !== '')).toHaveLength(1)
        expect(gitIn(dir, 'status', '--porcelain')).toBe('')

        // Worktree limpo; nenhum lease vivo.
        expect(await stack.deps.sandbox.list()).toHaveLength(0)
        expect(stack.state.leases.active(Date.now())).toHaveLength(0)

        // Orçamento contabilizado (INV-7) e eventos essenciais no log (INV-3).
        expect(stack.kernel.status().budget.run.usedTokens).toBeGreaterThan(0)
        const names: string[] = []
        for await (const event of stack.eventStore.read(1)) names.push(event.name)
        for (const expected of [
          'KernelStarted',
          'WorkspaceCreated',
          'TaskStarted',
          'VerificationStarted',
          'VerificationCompleted',
          'CommitCreated',
          'TaskCompleted',
          'CheckpointCreated',
          'KernelStopped',
        ]) {
          expect(names).toContain(expected)
        }

        // Attempt registrado com o diff.
        const attempts = await stack.state.attempts.byTask(task.id)
        expect(attempts).toHaveLength(1)
        expect(attempts[0]!.outcome?.status).toBe('verified')
        expect(attempts[0]!.outcome?.diff?.isEmpty).toBe(false)
      } finally {
        await stack.close()
      }
    })
  }, 60_000)

  it('falha → retry com diagnóstico → sucesso na 2ª tentativa (R3)', async () => {
    await withTempDir(async (dir) => {
      createGitRepo({ dir, files: { 'src/index.ts': 'export {}\n' } })
      const stack = await makeTestStack(dir, [
        { writes: { 'src/valor.ts': 'export const valor = "errado"\n' } },
        { writes: { 'src/valor.ts': 'export const valor = "correto"\n' } },
      ])
      try {
        const task = await stack.enqueue({
          title: 'Escrever valor correto',
          acceptance: artifactAcceptance('src/valor.ts', 'correto'),
        })

        unwrap(await stack.kernel.start({ projectId: stack.project.id }))
        await stack.kernel.wait()

        const final = await stack.state.tasks.find(task.id)
        expect(final?.state).toBe('done')
        expect(final?.attempts).toBe(2)

        // A 1ª tentativa está registrada como falha com diagnóstico estruturado.
        const attempts = await stack.state.attempts.byTask(task.id)
        expect(attempts).toHaveLength(2)
        expect(attempts[0]!.outcome?.status).toBe('failed')
        expect(attempts[0]!.outcome?.diagnosis).toBeDefined()

        // A 2ª sessão recebeu o diagnóstico no prompt (retry-with-context).
        expect(stack.provider.sessions).toHaveLength(2)
        expect(stack.provider.sessions[1]!.instruction).toContain('FALHOU na verificação')

        // Só o commit da tentativa boa existe.
        const commits = gitIn(dir, 'log', '--all', '--oneline', '--grep', 'feature: Escrever')
        expect(commits.split('\n').filter((l) => l.trim() !== '')).toHaveLength(1)
      } finally {
        await stack.close()
      }
    })
  }, 60_000)

  it('modelo que declara sucesso sem alterar nada é reprovado (R1) e replaneja na repetição', async () => {
    await withTempDir(async (dir) => {
      createGitRepo({ dir, files: { 'src/index.ts': 'export {}\n' } })
      // Dois comportamentos vazios: nada é escrito em nenhuma tentativa.
      const stack = await makeTestStack(dir, [
        { text: 'Implementei com sucesso!' },
        { text: 'Agora sim, tudo pronto!' },
      ])
      try {
        const task = await stack.enqueue({
          title: 'Task que o modelo finge fazer',
          acceptance: artifactAcceptance('src/novo.ts', '.'),
        })

        unwrap(await stack.kernel.start({ projectId: stack.project.id }))
        await stack.kernel.wait()

        const final = await stack.state.tasks.find(task.id)
        // NUNCA done — esse é o teste inteiro do INV-2.
        expect(final?.state).not.toBe('done')
        // no-changes duas vezes ⇒ replan (draft aguardando o Planner da F4).
        expect(final?.state).toBe('draft')

        const attempts = await stack.state.attempts.byTask(task.id)
        expect(attempts.length).toBeGreaterThanOrEqual(2)
        expect(attempts[0]!.outcome?.diagnosis?.category).toBe('no-changes')

        // Nenhum commit aconteceu.
        const commits = gitIn(dir, 'log', '--all', '--oneline')
        expect(commits.split('\n')).toHaveLength(1) // só o commit inicial da fixture
      } finally {
        await stack.close()
      }
    })
  }, 60_000)

  it('tentativas esgotadas terminam em blocked(exhausted), nunca em done', async () => {
    await withTempDir(async (dir) => {
      createGitRepo({ dir, files: { 'src/index.ts': 'export {}\n' } })
      // Escreve sempre conteúdo errado — categorias alternam? Não: sempre
      // artifact-mismatch ('unknown'). 2ª igual → replan iria para draft; por
      // isso o teste usa maxAttempts=1: primeira falha já esgota.
      const stack = await makeTestStack(dir, [{ writes: { 'src/x.ts': 'errado' } }], {
        maxAttempts: 1,
      })
      try {
        const task = await stack.enqueue({
          title: 'Impossível',
          acceptance: artifactAcceptance('src/x.ts', 'conteudo-que-nunca-vem'),
        })

        unwrap(await stack.kernel.start({ projectId: stack.project.id }))
        await stack.kernel.wait()

        const final = await stack.state.tasks.find(task.id)
        expect(final?.state).toBe('blocked')
        expect(final?.blockReason?.kind).toBe('exhausted')
        expect(final?.blockReason?.resolvableBy).toBe('human')
      } finally {
        await stack.close()
      }
    })
  }, 60_000)

  it('diff fora do escopo declarado é reprovado (INV-5)', async () => {
    await withTempDir(async (dir) => {
      createGitRepo({ dir, files: { 'src/index.ts': 'export {}\n' } })
      const stack = await makeTestStack(
        dir,
        [
          {
            writes: {
              'src/ok.ts': 'export {}\n',
              '.github/workflows/deploy.yml': 'on: push\n', // fora de touches!
            },
          },
        ],
        { maxAttempts: 1 },
      )
      try {
        const task = await stack.enqueue({
          title: 'Tenta escapar do escopo',
          touches: ['src/**'],
          acceptance: artifactAcceptance('src/ok.ts', '.'),
        })

        unwrap(await stack.kernel.start({ projectId: stack.project.id }))
        await stack.kernel.wait()

        const final = await stack.state.tasks.find(task.id)
        expect(final?.state).not.toBe('done')
        const attempts = await stack.state.attempts.byTask(task.id)
        expect(attempts[0]!.outcome?.diagnosis?.category).toBe('out-of-scope')
      } finally {
        await stack.close()
      }
    })
  }, 60_000)

  it('duas tasks em sequência; fila drena e o kernel para sozinho', async () => {
    await withTempDir(async (dir) => {
      createGitRepo({ dir, files: { 'src/index.ts': 'export {}\n' } })
      const stack = await makeTestStack(dir, [
        { writes: { 'src/a.ts': 'a' } },
        { writes: { 'docs/b.md': 'b' } },
      ])
      try {
        await stack.enqueue({
          title: 'Primeira',
          acceptance: artifactAcceptance('src/a.ts', 'a'),
        })
        await stack.enqueue({
          title: 'Segunda',
          kind: 'docs',
          touches: ['docs/**'],
          acceptance: artifactAcceptance('docs/b.md', 'b'),
        })

        unwrap(await stack.kernel.start({ projectId: stack.project.id }))
        await stack.kernel.wait()

        const all = await stack.state.tasks.all()
        expect(all.every((t) => t.state === 'done')).toBe(true)

        const run = await stack.state.runs.latest()
        expect(run?.status).toBe('completed')
        expect(run?.stopReason).toContain('não há mais tasks')
      } finally {
        await stack.close()
      }
    })
  }, 60_000)
})
