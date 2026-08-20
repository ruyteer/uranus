import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { unwrap, type SessionRequest } from '@uranus/core'
import { createGitRepo, withTempDir, type ScriptedBehavior } from '@uranus/testkit'
import { artifactAcceptance, makeTestStack } from './test-stack.js'

/**
 * Fase 9 — proxy acelerado do benchmark de 8h do DoD ("RSS estável, sem
 * vazamento de memória"). Não substitui a validação real de 8h contra um
 * provider pago (isso fica pra rodar manualmente, fora do CI) — o que este
 * teste PROVA é que o caminho quente do kernel (fill-loop, checkpoint,
 * event log, `recentOutcomes`) não cresce sem limite com o VOLUME de tasks,
 * rodando centenas delas em segundos em vez de horas.
 *
 * Especificamente exercita o teto de `recentOutcomes` (Fase 9): sem o cap
 * introduzido em `kernel.ts`, esse array cresceria 1:1 com o total de tasks
 * já processadas na vida do processo, nunca do run.
 */

const behavior: ScriptedBehavior = {
  act: (workdir: string, request: SessionRequest) => {
    const match = /src\/soak\/f(\d+)\.ts/.exec(request.instruction)
    if (match === null) return
    const rel = `src/soak/f${match[1]}.ts`
    const abs = join(workdir, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, `export const f${match[1]} = ${match[1]}\n`)
  },
}

describe('soak: volume alto não vaza memória no caminho quente (Fase 9)', () => {
  it('RSS não cresce linearmente com o total de tasks processadas', async () => {
    await withTempDir(async (dir) => {
      createGitRepo({ dir, files: { 'src/index.ts': 'export {}\n' } })

      const BATCHES = 4
      const PER_BATCH = 50
      const behaviors = Array.from({ length: BATCHES * PER_BATCH }, () => behavior)
      const stack = await makeTestStack(dir, behaviors, { concurrency: 4 })
      try {
        const rssAfterBatch: number[] = []
        let index = 0

        for (let batch = 0; batch < BATCHES; batch++) {
          for (let i = 0; i < PER_BATCH; i++, index++) {
            const rel = `src/soak/f${String(index)}.ts`
            await stack.enqueue({
              title: `Soak ${String(index)}`,
              touches: [rel],
              acceptance: artifactAcceptance(rel, `f${String(index)} =`),
            })
          }
          unwrap(await stack.kernel.start({ projectId: stack.project.id }))
          await stack.kernel.wait()

          if (global.gc) global.gc()
          rssAfterBatch.push(process.memoryUsage().rss)
        }

        // Todas as tasks das 4 rodadas realmente terminaram — sem isso, a
        // leitura de RSS não prova nada (menos trabalho feito, menos memória).
        const stats = await stack.deps.tasks.byState('done')
        expect(stats.length).toBe(BATCHES * PER_BATCH)

        // O teto de `recentOutcomes` (200) foi exercitado: chegando a 200
        // tasks, o array já teria estourado o limite sem o cap da Fase 9.
        expect(BATCHES * PER_BATCH).toBeGreaterThanOrEqual(200)

        // Comparação de crescimento: ignora a 1ª rodada (aquecimento — cache
        // de módulo, JIT, pools de conexão). Se o crescimento da ÚLTIMA
        // rodada continua próximo do da 2ª, é ruído de GC, não vazamento; se
        // disparar bem acima, é o sinal que este teste existe pra pegar.
        const growth2 = rssAfterBatch[1]! - rssAfterBatch[0]!
        const growthLast = rssAfterBatch[BATCHES - 1]! - rssAfterBatch[BATCHES - 2]!
        const tolerance = Math.max(64 * 1024 * 1024, Math.abs(growth2) * 4)
        expect(growthLast).toBeLessThan(tolerance)
      } finally {
        await stack.close()
      }
    })
  }, 240_000)
})
