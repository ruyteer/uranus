import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CodeHost, PullRequestRef, PullRequestRequest } from '@uranus/core'
import { newRunId, ok, unwrap } from '@uranus/core'
import { createGitRepo, gitIn, withTempDir } from '@uranus/testkit'
import { artifactAcceptance, makeTestStack } from './test-stack.js'

/** CodeHost fake: registra chamadas em vez de bater no GitHub de verdade. */
function makeFakeCodeHost(options: { existingPr?: PullRequestRef } = {}): CodeHost & {
  readonly opened: PullRequestRequest[]
  readonly updated: { ref: PullRequestRef; patch: Partial<PullRequestRequest> }[]
} {
  const opened: PullRequestRequest[] = []
  const updated: { ref: PullRequestRef; patch: Partial<PullRequestRequest> }[] = []
  return {
    id: 'fake-github',
    opened,
    updated,
    openPullRequest: (request) => {
      opened.push(request)
      return Promise.resolve(
        ok({ host: 'github', repo: 'acme/repo', number: 1, url: 'https://github.com/acme/repo/pull/1' }),
      )
    },
    updatePullRequest: (ref, patch) => {
      updated.push({ ref, patch })
      return Promise.resolve(ok())
    },
    checksStatus: () => Promise.resolve(ok({ state: 'unknown', checks: [] })),
    listIssues: () => Promise.resolve(ok([])),
    findOpenPullRequestForTask: () => Promise.resolve(ok(options.existingPr)),
  }
}

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

  it('stash órfão de uma task anterior (outro worktree, já descartado) não é tocado — só o stash desta sessão é devolvido', async () => {
    await withTempDir(async (dir) => {
      createGitRepo({
        dir,
        files: { 'src/index.ts': 'export {}\n', 'src/outro.ts': 'export const x = 1\n' },
      })

      // Simula o órfão: uma task ANTERIOR (outro worktree, hoje descartado)
      // deixou um stash pra trás. `git stash` é um ref do repositório
      // inteiro — sobrevive mesmo depois do worktree que o criou sumir, e
      // aparece igual em qualquer worktree novo.
      execFileSync('git', ['-C', dir, 'checkout', '-b', 'branch-de-outra-task'])
      writeFileSync(join(dir, 'src', 'outro.ts'), 'export const x = 999\n')
      execFileSync('git', ['-C', dir, 'stash'])
      execFileSync('git', ['-C', dir, 'checkout', 'main'])

      const stack = await makeTestStack(dir, [
        {
          writes: { 'src/hello.ts': 'export const hello = "ola mundo"\n' },
          act: (workdir) => {
            execFileSync('git', ['stash'], { cwd: workdir })
          },
        },
      ])
      try {
        const task = await stack.enqueue({
          title: 'Adicionar hello',
          acceptance: artifactAcceptance('src/hello.ts', 'ola mundo'),
        })

        unwrap(await stack.kernel.start({ projectId: stack.project.id }))
        await stack.kernel.wait()

        // A task da sessão atual recuperou o próprio stash e terminou bem.
        const final = await stack.state.tasks.find(task.id)
        expect(final?.state).toBe('done')

        // O órfão da "outra task" continua exatamente onde estava — nunca
        // foi tocado, nunca virou conflito, nunca sumiu.
        const remaining = execFileSync('git', ['-C', dir, 'stash', 'list']).toString().trim()
        expect(remaining.split('\n').filter((l) => l.trim() !== '')).toHaveLength(1)
        expect(remaining).toContain('branch-de-outra-task')
      } finally {
        await stack.close()
      }
    })
  }, 60_000)

  it('git stash sobrando (agente que isola um teste e esquece o pop) não derruba a task — o kernel devolve antes de verificar', async () => {
    await withTempDir(async (dir) => {
      createGitRepo({ dir, files: { 'src/index.ts': 'export {}\n' } })
      const stack = await makeTestStack(dir, [
        {
          writes: { 'src/hello.ts': 'export const hello = "ola mundo"\n' },
          act: (workdir) => {
            // Reproduz o que se via ao vivo: o agente edita, roda `git stash`
            // pra testar outra coisa numa working tree limpa, e esquece o pop.
            execFileSync('git', ['stash'], { cwd: workdir })
          },
        },
      ])
      try {
        const task = await stack.enqueue({
          title: 'Adicionar hello',
          acceptance: artifactAcceptance('src/hello.ts', 'ola mundo'),
        })

        unwrap(await stack.kernel.start({ projectId: stack.project.id }))
        await stack.kernel.wait()

        const final = await stack.state.tasks.find(task.id)
        expect(final?.state).toBe('done')
        expect(final?.attempts).toBe(1)
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
        // `no-changes` duas vezes ⇒ replan. Sem Planner configurado neste
        // stack, o kernel bloqueia com motivo em vez de deixar em limbo
        // (comportamento da Fase 4; a Fase 2 deixava preso em `draft`).
        expect(final?.state).toBe('blocked')
        expect(final?.blockReason?.message).toContain('Planner')

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

  it('provider falhando repetidamente bloqueia com a causa visível, não replaneja', async () => {
    await withTempDir(async (dir) => {
      createGitRepo({ dir, files: { 'src/index.ts': 'export {}\n' } })
      // Duas sessões consecutivas morrem com erro de auth (o caso real do teste
      // de campo: CLI do Claude Code sem login).
      const authError = {
        status: 'error' as const,
        text: 'Not logged in · Please run /login',
      }
      const stack = await makeTestStack(dir, [authError, authError])
      try {
        const task = await stack.enqueue({
          title: 'Vitima do auth',
          acceptance: artifactAcceptance('src/a.ts', '.'),
        })

        unwrap(await stack.kernel.start({ projectId: stack.project.id }))
        await stack.kernel.wait()

        const final = await stack.state.tasks.find(task.id)
        // Bloqueada — não em draft: replanejar não conserta infra quebrada.
        expect(final?.state).toBe('blocked')
        expect(final?.blockReason?.kind).toBe('provider')
        // A mensagem do provider está no blockReason, visível no `task list`.
        expect(final?.blockReason?.message).toContain('Not logged in')

        const attempts = await stack.state.attempts.byTask(task.id)
        expect(attempts.every((a) => a.outcome?.diagnosis?.category === 'provider-error')).toBe(
          true,
        )
      } finally {
        await stack.close()
      }
    })
  }, 60_000)

  it('orçamento insuficiente bloqueia a task ANTES de gastar (INV-7)', async () => {
    await withTempDir(async (dir) => {
      createGitRepo({ dir, files: { 'src/index.ts': 'export {}\n' } })
      // A estimativa de admissão é o PIOR CASO REAL: o menor entre o teto de
      // dinheiro do agente (US$2) e o que este provider cobraria pelo teto de
      // tokens dele (US$0,30 com o preço do provider de teste). Usar só o teto
      // do agente recusaria tasks num provider gratuito — foi assim que a
      // escalada morria rodando em modelo local.
      //
      // Com US$0,10 de orçamento, o pior caso de US$0,30 não cabe e a admissão
      // recusa a priori: nenhuma sessão de provider é aberta.
      const stack = await makeTestStack(dir, [{ writes: { 'src/a.ts': 'a' } }], {
        budgetUsd: 0.1,
      })
      try {
        const task = await stack.enqueue({
          title: 'Cara demais',
          acceptance: artifactAcceptance('src/a.ts', 'a'),
        })

        unwrap(await stack.kernel.start({ projectId: stack.project.id }))
        await stack.kernel.wait()

        const final = await stack.state.tasks.find(task.id)
        expect(final?.state).toBe('blocked')
        expect(final?.blockReason?.kind).toBe('budget')

        // A recusa foi ANTES de gastar: o provider nunca foi chamado.
        expect(stack.provider.sessions).toHaveLength(0)
        expect(stack.kernel.status().budget.run.usedCost.micros).toBe(0)

        const names: string[] = []
        for await (const event of stack.eventStore.read(1)) names.push(event.name)
        expect(names).toContain('BudgetExhausted')
        expect(names).toContain('TaskBlocked')
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

  it('dependência já concluída é vista de cara, sem precisar de um tick antes (regressão)', async () => {
    // Reproduz exatamente o bug real: `taskState()` do scheduler dependia de
    // um cache atualizado por evento `TickStarted` — um comando "de leitura"
    // como `uranus task why`, ou a primeira avaliação antes de qualquer tick
    // rodar, via um scheduler recém-construído, sempre via esse cache vazio e
    // vetava por `dependency-ready` mesmo com a dependência já `done` no
    // banco. Aqui não rodamos o kernel nem uma vez — só gravamos as tasks
    // direto e chamamos `explain()` num scheduler novo.
    await withTempDir(async (dir) => {
      createGitRepo({ dir, files: { 'src/index.ts': 'export {}\n' } })
      const stack = await makeTestStack(dir, [])
      try {
        const done = await stack.enqueue({
          title: 'Dependência já concluída',
          touches: ['src/a.ts'],
          acceptance: artifactAcceptance('src/a.ts', 'a'),
        })
        unwrap(await stack.state.tasks.save({ ...done, state: 'done' }))

        const dependent = await stack.enqueue({
          title: 'Depende da anterior',
          touches: ['src/b.ts'],
          deps: [done.id],
          acceptance: artifactAcceptance('src/b.ts', 'b'),
        })

        const now = Date.now()
        const explanation = stack.deps.scheduler.explain(dependent, {
          now,
          stats: await stack.deps.queue.stats(),
          budget: stack.deps.budget.state(),
          activeLeases: await stack.deps.queue.activeLeases(now),
          recentOutcomes: [],
          mix: {},
          observedMix: {},
          providerHealth: {},
          restrictedMode: false,
        })
        expect(explanation.eligible).toBe(true)
        expect(explanation.vetoedBy).not.toContain('dependency-ready')
      } finally {
        await stack.close()
      }
    })
  })

  it('orçamento do run esgotado pausa o kernel e avisa uma vez só, nunca em silêncio', async () => {
    await withTempDir(async (dir) => {
      createGitRepo({ dir, files: { 'src/index.ts': 'export {}\n' } })
      const stack = await makeTestStack(
        dir,
        [{ writes: { 'src/hello.ts': 'export const hello = "ola mundo"\n' } }],
        { budgetUsd: 0 },
      )
      try {
        await stack.enqueue({
          title: 'Task qualquer',
          acceptance: artifactAcceptance('src/hello.ts', 'ola mundo'),
        })

        unwrap(await stack.kernel.start({ projectId: stack.project.id }))

        // tickIntervalMs=20 no test-stack — o kernel deve perceber o
        // orçamento esgotado e pausar rápido, sem precisar de mais que isso.
        const deadline = Date.now() + 2_000
        while (stack.kernel.status().state !== 'paused' && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
        expect(stack.kernel.status().state).toBe('paused')

        // Fica pausado mais um pouco — não pode reemitir o aviso a cada tick.
        await new Promise((resolve) => setTimeout(resolve, 150))

        const names: string[] = []
        for await (const event of stack.eventStore.read(1)) names.push(event.name)
        expect(names.filter((n) => n === 'BudgetExhausted')).toHaveLength(1)
        expect(names).toContain('KernelPaused')
        // A task nunca chegou a rodar: orçamento vetou antes do admit.
        expect(names).not.toContain('AgentRunStarted')

        await stack.kernel.stop('fim do teste')
      } finally {
        await stack.close()
      }
    })
  }, 15_000)

  describe('integração pull-request: sincronização com o remoto e dedupe de PR', () => {
    it('PR já aberto por uma tentativa irmã (mesma task) é atualizado, nunca duplicado', async () => {
      await withTempDir(async (base) => {
        const bareDir = join(base, 'origin.git')
        mkdirSync(bareDir, { recursive: true })
        gitIn(bareDir, 'init', '--bare', '-b', 'main')

        const dir = join(base, 'work')
        createGitRepo({ dir, files: { 'src/index.ts': 'export {}\n' } })
        gitIn(dir, 'remote', 'add', 'origin', bareDir)
        gitIn(dir, 'push', 'origin', 'main')

        const existingPr: PullRequestRef = {
          host: 'github',
          repo: 'acme/repo',
          number: 7,
          url: 'https://github.com/acme/repo/pull/7',
        }
        const codeHost = makeFakeCodeHost({ existingPr })

        const stack = await makeTestStack(
          dir,
          [{ writes: { 'src/hello.ts': 'export const hello = "ola mundo"\n' } }],
          {
            integration: { strategy: 'pull-request', pushRemote: 'origin', prBase: 'main' },
            codeHost,
          },
        )
        try {
          const task = await stack.enqueue({
            title: 'Adicionar hello',
            acceptance: artifactAcceptance('src/hello.ts', 'ola mundo'),
          })

          unwrap(await stack.kernel.start({ projectId: stack.project.id }))
          await stack.kernel.wait()

          const final = await stack.state.tasks.find(task.id)
          expect(final?.state).toBe('done')
          // O caminho de dedupe (findOpenPullRequestForTask encontrou o PR da
          // "tentativa irmã") atualiza o PR existente em vez de abrir outro.
          expect(codeHost.opened).toHaveLength(0)
          expect(codeHost.updated).toHaveLength(1)
          expect(codeHost.updated[0]!.ref).toEqual(existingPr)
        } finally {
          await stack.close()
        }
      })
    }, 60_000)

    it('rebase em conflito contra o remoto nunca abre PR — task bloqueia com a causa visível', async () => {
      await withTempDir(async (base) => {
        const bareDir = join(base, 'origin.git')
        mkdirSync(bareDir, { recursive: true })
        gitIn(bareDir, 'init', '--bare', '-b', 'main')

        const dir = join(base, 'work')
        createGitRepo({
          dir,
          files: { 'src/index.ts': 'export {}\n', 'src/shared.ts': 'export const shared = 1\n' },
        })
        gitIn(dir, 'remote', 'add', 'origin', bareDir)
        gitIn(dir, 'push', 'origin', 'main')

        // Tarefa irmã já mergeou uma mudança na mesma linha — sem que o
        // checkout local de onde os workspaces nascem tenha visto isso
        // (Uranus nunca dá fetch/pull na main local sozinho).
        const sibling = join(base, 'sibling')
        gitIn(base, 'clone', bareDir, sibling)
        writeFileSync(join(sibling, 'src', 'shared.ts'), 'export const shared = 2\n')
        gitIn(sibling, 'add', '--all')
        gitIn(sibling, 'commit', '-m', 'task irmã: muda shared.ts')
        gitIn(sibling, 'push', 'origin', 'main')

        const codeHost = makeFakeCodeHost()
        const stack = await makeTestStack(
          dir,
          [{ writes: { 'src/shared.ts': 'export const shared = 99\n' } }],
          {
            integration: { strategy: 'pull-request', pushRemote: 'origin', prBase: 'main' },
            codeHost,
            maxAttempts: 1,
          },
        )
        try {
          const task = await stack.enqueue({
            title: 'Muda shared de outro jeito',
            acceptance: artifactAcceptance('src/shared.ts', 'shared = 99'),
          })

          unwrap(await stack.kernel.start({ projectId: stack.project.id }))
          await stack.kernel.wait()

          const final = await stack.state.tasks.find(task.id)
          expect(final?.state).toBe('blocked')
          expect(final?.blockReason?.kind).toBe('human')
          expect(final?.blockReason?.message).toContain('colidiu')
          expect(codeHost.opened).toHaveLength(0)
          expect(codeHost.updated).toHaveLength(0)
        } finally {
          await stack.close()
        }
      })
    }, 60_000)
  })

  describe('recuperação (INV-4): task presa em "failed"', () => {
    it('recover() devolve para "ready" uma task presa em failed por crash entre marcar a falha e decidir o retry', async () => {
      await withTempDir(async (dir) => {
        createGitRepo({ dir, files: { 'src/index.ts': 'export {}\n' } })
        const stack = await makeTestStack(dir, [
          { writes: { 'src/hello.ts': 'export const hello = "ola mundo"\n' } },
        ])
        try {
          const task = await stack.enqueue({
            title: 'Tarefa qualquer',
            acceptance: artifactAcceptance('src/hello.ts', 'ola mundo'),
          })

          // `failed` é um estado de trânsito de um instante só dentro de
          // `handleFailure` (kernel.ts): marca a falha, depois decide
          // blocked/ready/draft. Um crash bem nesse meio deixa a task presa
          // aqui — e `failed` não é `isActive`, então a reconciliação de
          // recovery a ignorava antes desta correção.
          unwrap(await stack.state.tasks.save({ ...task, state: 'failed' }))

          const report = unwrap(
            await stack.deps.recovery.recover(newRunId(), new AbortController().signal),
          )
          expect(report.tasksReset).toContain(task.id)

          const after = await stack.state.tasks.find(task.id)
          expect(after?.state).toBe('ready')
        } finally {
          await stack.close()
        }
      })
    })
  })
})
