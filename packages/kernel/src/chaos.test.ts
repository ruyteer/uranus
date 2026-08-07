import { afterEach, describe, expect, it } from 'vitest'
import { unwrap } from '@uranus/core'
import { createGitRepo, gitIn, withTempDir } from '@uranus/testkit'
import { artifactAcceptance, makeTestStack } from './test-stack.js'

/**
 * Teste de caos — DoD da Fase 2, prova do INV-4.
 *
 * Para cada fase do tick: injeta a morte do kernel exatamente naquela fase
 * (sem NENHUMA limpeza — fiel ao kill -9), monta um stack totalmente novo
 * sobre os mesmos arquivos (simulando um processo novo), retoma com
 * `resumeRunId` e prova que:
 *
 *   1. a task termina em `done` — o trabalho não se perde;
 *   2. existe EXATAMENTE UM commit — o crash não duplica trabalho;
 *   3. nenhum worktree órfão sobrevive — a reconciliação limpa;
 *   4. nenhum lease fica preso — o TTL/recovery liberam.
 */

const PHASES = [
  'sense',
  'select',
  'admit',
  'prepare',
  'execute',
  'verify',
  'integrate',
  'learn',
  'checkpoint',
] as const

describe('caos: kill -9 em cada fase do tick (INV-4)', () => {
  afterEach(() => {
    delete process.env['URANUS_CRASH_AT_PHASE']
    delete process.env['URANUS_CRASH_MODE']
  })

  for (const phase of PHASES) {
    it(`crash na fase "${phase}" → resume conclui sem duplicar`, async () => {
      await withTempDir(async (dir) => {
        createGitRepo({ dir, files: { 'src/index.ts': 'export {}\n' } })

        // ── Processo 1: morre no meio ────────────────────────────────────
        const stack1 = await makeTestStack(dir, [
          { writes: { 'src/hello.ts': 'export const hello = "ola"\n' } },
        ])
        const task = await stack1.enqueue({
          title: 'Sobreviver ao caos',
          acceptance: artifactAcceptance('src/hello.ts', 'ola'),
        })

        process.env['URANUS_CRASH_AT_PHASE'] = phase
        process.env['URANUS_CRASH_MODE'] = 'throw'

        const runId = unwrap(await stack1.kernel.start({ projectId: stack1.project.id }))
        await stack1.kernel.wait() // o "processo" morreu; nada foi limpo
        await stack1.close()

        delete process.env['URANUS_CRASH_AT_PHASE']
        delete process.env['URANUS_CRASH_MODE']

        // ── Processo 2: novo do zero, mesmos arquivos ────────────────────
        const stack2 = await makeTestStack(dir, [
          { writes: { 'src/hello.ts': 'export const hello = "ola"\n' } },
        ])
        try {
          unwrap(
            await stack2.kernel.start({
              projectId: stack2.project.id,
              resumeRunId: runId,
            }),
          )
          await stack2.kernel.wait()

          // 1) A task terminou.
          const final = await stack2.state.tasks.find(task.id)
          expect(final?.state).toBe('done')

          // 2) Exatamente um commit — sem duplicação.
          const commits = gitIn(dir, 'log', '--all', '--oneline', '--grep', 'feature: Sobreviver')
          expect(commits.split('\n').filter((l) => l.trim() !== '')).toHaveLength(1)

          // 3) Nenhum worktree sobrevivente.
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
  }

  it('o event log sobrevive ao crash com seq contínuo', async () => {
    await withTempDir(async (dir) => {
      createGitRepo({ dir, files: { 'src/index.ts': 'export {}\n' } })

      const stack1 = await makeTestStack(dir, [{ writes: { 'src/a.ts': 'a' } }])
      await stack1.enqueue({ title: 'T', acceptance: artifactAcceptance('src/a.ts', 'a') })

      process.env['URANUS_CRASH_AT_PHASE'] = 'verify'
      process.env['URANUS_CRASH_MODE'] = 'throw'
      const runId = unwrap(await stack1.kernel.start({ projectId: stack1.project.id }))
      await stack1.kernel.wait()
      const headAtCrash = await stack1.eventStore.head()
      await stack1.close()
      delete process.env['URANUS_CRASH_AT_PHASE']
      delete process.env['URANUS_CRASH_MODE']

      const stack2 = await makeTestStack(dir, [{ writes: { 'src/a.ts': 'a' } }])
      try {
        // O log reabriu no seq certo — nada foi perdido nem regredido.
        expect(await stack2.eventStore.head()).toBe(headAtCrash)

        unwrap(await stack2.kernel.start({ projectId: stack2.project.id, resumeRunId: runId }))
        await stack2.kernel.wait()

        // Seq estritamente crescente do início ao fim, atravessando o crash.
        let last = 0
        for await (const event of stack2.eventStore.read(1)) {
          expect(event.seq).toBe(last + 1)
          last = event.seq
        }
        expect(last).toBeGreaterThan(headAtCrash)

        // O log registra a recuperação (INV-3: sem evento, não aconteceu).
        const names: string[] = []
        for await (const event of stack2.eventStore.read(1)) names.push(event.name)
        expect(names).toContain('RecoveryStarted')
        expect(names).toContain('RecoveryCompleted')
      } finally {
        await stack2.close()
      }
    })
  }, 90_000)
})
