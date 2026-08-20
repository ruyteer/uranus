import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { unwrap, type SessionRequest } from '@uranus/core'
import { createGitRepo, gitIn, withTempDir, type ScriptedBehavior } from '@uranus/testkit'
import { __resetChaosCounter } from './kernel.js'
import { artifactAcceptance, makeTestStack } from './test-stack.js'

/**
 * Fase 9 — prova de que o paralelismo real (kernel.concurrency > 1) não
 * quebra nenhum dos invariantes que o chaos.test.ts já prova para 1 task:
 * recuperação exata, zero worktree órfão, zero lease presa. Também prova que
 * a concorrência é real (não só "não quebra nada") e que o lease por arquivo
 * ainda serializa tasks com `touches` sobrepostos mesmo com um pool disponível.
 *
 * Importante: com 2 tasks em voo, a ORDEM em que `createSession()` é chamada
 * para cada uma não é determinística — depende de qual `prepare()` (I/O real
 * de worktree) termina primeiro. Por isso os comportamentos abaixo escolhem o
 * que escrever pelo CONTEÚDO do request (via `touches`, presente na
 * instrução), nunca pela posição no array — um script indexado por posição
 * atribuiria o arquivo errado à task errada sempre que a ordem inverter.
 */

interface WriteRule {
  readonly match: string
  readonly path: string
  readonly content: string
  readonly delayMs?: number
}

function behaviorByTouch(rules: readonly WriteRule[]): ScriptedBehavior {
  const ruleFor = (request: SessionRequest): WriteRule | undefined =>
    rules.find((r) => request.instruction.includes(r.match))
  return {
    act: (workdir, request) => {
      const rule = ruleFor(request)
      if (rule === undefined) return
      const abs = join(workdir, rule.path)
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, rule.content)
    },
    delayMs: (request) => ruleFor(request)?.delayMs ?? 0,
  }
}

afterEach(() => {
  delete process.env['URANUS_CRASH_AT_PHASE']
  delete process.env['URANUS_CRASH_MODE']
  delete process.env['URANUS_CRASH_AT_COUNT']
  __resetChaosCounter()
})

describe('caos concorrente: 2 tasks em voo (Fase 9)', () => {
  it('crash quando AMBAS já chegaram em "learn" → resume conclui as duas sem duplicar', async () => {
    await withTempDir(async (dir) => {
      createGitRepo({ dir, files: { 'src/index.ts': 'export {}\n' } })

      const rules: WriteRule[] = [
        { match: 'src/a.ts', path: 'src/a.ts', content: 'export const a = 1\n' },
        { match: 'src/b.ts', path: 'src/b.ts', content: 'export const b = 2\n' },
      ]

      // ── Processo 1: 2 tasks concorrentes, touches disjuntos ──────────────
      const stack1 = await makeTestStack(dir, [behaviorByTouch(rules), behaviorByTouch(rules)], {
        concurrency: 2,
      })
      const taskA = await stack1.enqueue({
        title: 'Tarefa concorrente A',
        touches: ['src/a.ts'],
        acceptance: artifactAcceptance('src/a.ts', 'a = 1'),
      })
      const taskB = await stack1.enqueue({
        title: 'Tarefa concorrente B',
        touches: ['src/b.ts'],
        acceptance: artifactAcceptance('src/b.ts', 'b = 2'),
      })

      // count=2: crasha só quando a 2ª task a chegar em "learn" chega lá — ou
      // seja, a 1ª já COMMITOU de verdade antes do crash (mesma garantia que
      // o crash em "learn" já prova para 1 task só). Isso evita o cenário de
      // "processo morreu mas uma promise de fundo continua rodando": as duas
      // já terminaram o trabalho real, só falta o bookkeeping/checkpoint.
      process.env['URANUS_CRASH_AT_PHASE'] = 'learn'
      process.env['URANUS_CRASH_AT_COUNT'] = '2'
      process.env['URANUS_CRASH_MODE'] = 'throw'

      const runId = unwrap(await stack1.kernel.start({ projectId: stack1.project.id }))
      await stack1.kernel.wait()
      await stack1.close()

      delete process.env['URANUS_CRASH_AT_PHASE']
      delete process.env['URANUS_CRASH_AT_COUNT']
      delete process.env['URANUS_CRASH_MODE']

      // ── Processo 2: novo do zero, mesmos arquivos ────────────────────────
      const stack2 = await makeTestStack(dir, [behaviorByTouch(rules), behaviorByTouch(rules)], {
        concurrency: 2,
      })
      try {
        unwrap(await stack2.kernel.start({ projectId: stack2.project.id, resumeRunId: runId }))
        await stack2.kernel.wait()

        // 1) As duas terminaram.
        const finalA = await stack2.state.tasks.find(taskA.id)
        const finalB = await stack2.state.tasks.find(taskB.id)
        expect(finalA?.state).toBe('done')
        expect(finalB?.state).toBe('done')

        // 2) Um commit por task — sem duplicação em nenhuma delas.
        const commitsA = gitIn(
          dir,
          'log',
          '--all',
          '--oneline',
          '--grep',
          'feature: Tarefa concorrente A',
        )
        const commitsB = gitIn(
          dir,
          'log',
          '--all',
          '--oneline',
          '--grep',
          'feature: Tarefa concorrente B',
        )
        expect(commitsA.split('\n').filter((l) => l.trim() !== '')).toHaveLength(1)
        expect(commitsB.split('\n').filter((l) => l.trim() !== '')).toHaveLength(1)

        // 3) Nenhum worktree sobrevivente — primeira vez que isto é provado
        //    com mais de uma task/lease ativa ao mesmo tempo.
        expect(await stack2.deps.sandbox.list()).toHaveLength(0)

        // 4) Nenhum lease preso.
        expect(stack2.state.leases.active(Date.now())).toHaveLength(0)

        // A working tree principal permaneceu intocada o tempo todo (INV-5).
        expect(gitIn(dir, 'status', '--porcelain')).toBe('')
      } finally {
        await stack2.close()
      }
    })
  }, 90_000)

  it('touches sobrepostos: o lease serializa mesmo com pool disponível (R6)', async () => {
    await withTempDir(async (dir) => {
      createGitRepo({ dir, files: { 'src/shared.ts': 'export const shared = 0\n' } })

      const shared = behaviorByTouch([
        { match: 'src/shared.ts', path: 'src/shared.ts', content: 'export const shared = 1\n' },
      ])
      const stack = await makeTestStack(dir, [shared, shared], { concurrency: 2 })
      try {
        const taskA = await stack.enqueue({
          title: 'Escreve compartilhado A',
          touches: ['src/shared.ts'],
          acceptance: artifactAcceptance('src/shared.ts', 'shared ='),
        })
        const taskB = await stack.enqueue({
          title: 'Escreve compartilhado B',
          touches: ['src/shared.ts'],
          acceptance: artifactAcceptance('src/shared.ts', 'shared ='),
        })

        unwrap(await stack.kernel.start({ projectId: stack.project.id }))
        await stack.kernel.wait()

        const finalA = await stack.state.tasks.find(taskA.id)
        const finalB = await stack.state.tasks.find(taskB.id)
        expect(finalA?.state).toBe('done')
        expect(finalB?.state).toBe('done')

        // Nunca correram ao mesmo tempo: uma terminou (TaskCompleted) antes
        // da outra sequer começar (TaskStarted) — prova que o pool de
        // workers, mesmo com 2 slots livres, respeitou o lease do arquivo.
        const started = new Map<string, number>()
        const completed = new Map<string, number>()
        for await (const event of stack.eventStore.read(1)) {
          if (event.name === 'TaskStarted' && event.taskId !== undefined) {
            started.set(event.taskId, event.seq)
          }
          if (event.name === 'TaskCompleted' && event.taskId !== undefined) {
            completed.set(event.taskId, event.seq)
          }
        }
        const [firstId, secondId] =
          (started.get(taskA.id) ?? Number.POSITIVE_INFINITY) <
          (started.get(taskB.id) ?? Number.POSITIVE_INFINITY)
            ? [taskA.id, taskB.id]
            : [taskB.id, taskA.id]
        expect(completed.get(firstId)).toBeLessThan(started.get(secondId)!)
      } finally {
        await stack.close()
      }
    })
  }, 90_000)

  it('a concorrência é real: a 2ª task começa antes da 1ª terminar', async () => {
    await withTempDir(async (dir) => {
      createGitRepo({ dir, files: { 'src/index.ts': 'export {}\n' } })

      // A é deliberadamente lenta — se B só começasse depois de A terminar
      // (sequencial), este teste falharia. O atraso é atribuído por
      // conteúdo (qual task é essa sessão), não por posição.
      // Margem generosa de propósito: sob carga pesada do sistema (ex. suíte
      // inteira rodando com coverage instrumentado em paralelo), um atraso
      // pequeno pode não bastar pra garantir a superposição real.
      const rules: WriteRule[] = [
        { match: 'src/a.ts', path: 'src/a.ts', content: 'export const a = 1\n', delayMs: 1_000 },
        { match: 'src/b.ts', path: 'src/b.ts', content: 'export const b = 2\n' },
      ]
      const behavior = behaviorByTouch(rules)
      const stack = await makeTestStack(dir, [behavior, behavior], { concurrency: 2 })
      try {
        const taskA = await stack.enqueue({
          title: 'Lenta A',
          touches: ['src/a.ts'],
          acceptance: artifactAcceptance('src/a.ts', 'a = 1'),
        })
        const taskB = await stack.enqueue({
          title: 'Rápida B',
          touches: ['src/b.ts'],
          acceptance: artifactAcceptance('src/b.ts', 'b = 2'),
        })

        unwrap(await stack.kernel.start({ projectId: stack.project.id }))
        await stack.kernel.wait()

        const finalA = await stack.state.tasks.find(taskA.id)
        const finalB = await stack.state.tasks.find(taskB.id)
        expect(finalA?.state).toBe('done')
        expect(finalB?.state).toBe('done')

        let startedB: number | undefined
        let completedA: number | undefined
        for await (const event of stack.eventStore.read(1)) {
          if (event.name === 'TaskStarted' && event.taskId === taskB.id) {
            startedB = event.seq
          }
          if (event.name === 'TaskCompleted' && event.taskId === taskA.id) {
            completedA = event.seq
          }
        }
        expect(startedB).toBeDefined()
        expect(completedA).toBeDefined()
        expect(startedB!).toBeLessThan(completedA!)
      } finally {
        await stack.close()
      }
    })
  }, 90_000)
})
