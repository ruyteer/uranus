import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { unwrap } from '@uranus/core'
import { createGitRepo, createTempDir } from '@uranus/testkit'
import { artifactAcceptance, makeTestStack } from './test-stack.js'

/**
 * Fase 9 — "multi-projeto simultâneo" validado como multi-processo/multi-
 * instância, não como reescrita multi-tenant. A arquitetura já isola cada
 * projeto por composição: um `.uranus/state.db`, um event store e um
 * sandbox de worktree próprios, sem estado global compartilhado. Este teste
 * prova isso da forma mais forte possível — duas pilhas completas (kernel +
 * state + fila + event store), cada uma sobre seu próprio repositório git,
 * rodando CONCORRENTEMENTE no MESMO processo. Isso expõe qualquer estado
 * compartilhado acidental (singleton, cache de módulo, contador estático)
 * que dois processos de SO separados jamais revelariam.
 */
describe('dois projetos simultâneos não interferem entre si (Fase 9)', () => {
  it('cada projeto tem seu próprio .uranus isolado, mesmo rodando ao mesmo tempo', async () => {
    const tempA = await createTempDir('urn-multiproj-a-')
    const tempB = await createTempDir('urn-multiproj-b-')
    try {
      createGitRepo({ dir: tempA.path, files: { 'src/index.ts': 'export {}\n' } })
      createGitRepo({ dir: tempB.path, files: { 'src/index.ts': 'export {}\n' } })

      const stackA = await makeTestStack(tempA.path, [
        { writes: { 'src/a.ts': 'export const a = 1\n' } },
      ])
      const stackB = await makeTestStack(tempB.path, [
        { writes: { 'src/b.ts': 'export const b = 2\n' } },
      ])

      try {
        // Cada `.uranus` é um diretório físico distinto — a base da isolação.
        expect(stackA.project.uranusDir).not.toBe(stackB.project.uranusDir)
        expect(existsSync(join(tempA.path, '.uranus', 'state.db'))).toBe(true)
        expect(existsSync(join(tempB.path, '.uranus', 'state.db'))).toBe(true)

        const taskA = await stackA.enqueue({
          title: 'Tarefa do projeto A',
          touches: ['src/a.ts'],
          acceptance: artifactAcceptance('src/a.ts', 'a = 1'),
        })
        const taskB = await stackB.enqueue({
          title: 'Tarefa do projeto B',
          touches: ['src/b.ts'],
          acceptance: artifactAcceptance('src/b.ts', 'b = 2'),
        })

        // As duas pilhas rodam CONCORRENTEMENTE no mesmo processo — se
        // houvesse qualquer estado global compartilhado, seria aqui que
        // colidiria (ex.: os dois `runId` sendo o mesmo, ou um kernel vendo
        // as tasks do outro).
        const [runA, runB] = await Promise.all([
          stackA.kernel.start({ projectId: stackA.project.id }),
          stackB.kernel.start({ projectId: stackB.project.id }),
        ])
        unwrap(runA)
        unwrap(runB)
        expect(unwrap(runA)).not.toBe(unwrap(runB))
        await Promise.all([stackA.kernel.wait(), stackB.kernel.wait()])

        const finalA = await stackA.state.tasks.find(taskA.id)
        const finalB = await stackB.state.tasks.find(taskB.id)
        expect(finalA?.state).toBe('done')
        expect(finalB?.state).toBe('done')

        // Isolação de dados: o state store do projeto A nunca viu a task de
        // B, e vice-versa — não são só arquivos separados, são bancos
        // separados de verdade.
        expect(await stackA.state.tasks.find(taskB.id)).toBeUndefined()
        expect(await stackB.state.tasks.find(taskA.id)).toBeUndefined()

        // Efeito colateral no disco também ficou isolado por worktree/projeto.
        expect(existsSync(join(tempA.path, 'src', 'b.ts'))).toBe(false)
        expect(existsSync(join(tempB.path, 'src', 'a.ts'))).toBe(false)

        // Nenhum worktree ou lease vazou entre as duas pilhas.
        expect(await stackA.deps.sandbox.list()).toHaveLength(0)
        expect(await stackB.deps.sandbox.list()).toHaveLength(0)
      } finally {
        await stackA.close()
        await stackB.close()
      }
    } finally {
      await tempA.cleanup()
      await tempB.cleanup()
    }
  }, 60_000)
})
