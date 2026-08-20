import { describe, expect, it } from 'vitest'
import type { EventPayloads, UranusEvent, Verification } from '@uranus/core'
import { DEFAULT_VALIDATION_POLICY, resolveValidationPolicy, unwrap } from '@uranus/core'
import { renderContextPack } from '@uranus/providers'
import { createGitRepo, gitIn, makeTask, withTempDir } from '@uranus/testkit'
import { buildRepairBrief } from './repair.js'
import { artifactAcceptance, makeTestStack } from './test-stack.js'

/**
 * Reparo dirigido (§6 e §7): a queixa que originou tudo isto é literal — "cai
 * numa validação errada, o erro se repete 3 vezes, a task é bloqueada, e o
 * replanejamento cria mais tasks e mais tasks e nunca é corrigido de fato".
 *
 * O que estes testes cobram, nesta ordem: a validação repetida não bloqueia nem
 * gera task nova; o teto de reparos existe e devolve a falha ao fluxo normal
 * gastando tentativa de verdade; o agente recebe os ARQUIVOS, não a categoria;
 * e nada disso vale para falha que não é de política.
 */

/** Um behavior que escapa do escopo declarado — a validação que mais dói. */
const FORA_DO_ESCOPO = {
  writes: {
    'src/ok.ts': 'export const ok = 1\n',
    '.github/workflows/deploy.yml': 'on: push\n',
  },
} as const

const DENTRO_DO_ESCOPO = { writes: { 'src/ok.ts': 'export const ok = 1\n' } } as const

async function readEvents(
  stack: Awaited<ReturnType<typeof makeTestStack>>,
): Promise<readonly UranusEvent[]> {
  const events: UranusEvent[] = []
  for await (const event of stack.eventStore.read(1)) events.push(event)
  return events
}

function repairsIn(events: readonly UranusEvent[]): readonly EventPayloads['TaskRepairScheduled'][] {
  return events
    .filter((event) => event.name === 'TaskRepairScheduled')
    .map((event) => event.payload as EventPayloads['TaskRepairScheduled'])
}

describe('reparo dirigido — classificação (funções puras)', () => {
  const task = makeTask({ touches: ['src/**'] })

  function verification(results: Verification['results'], category: 'out-of-scope' | 'test-failure'): Verification {
    return {
      passed: false,
      results,
      durationMs: 0,
      diagnosis: { category, summary: '', evidence: [], suggestedAction: 'retry-with-context' },
    }
  }

  it('diff fora do escopo vira brief com a regra, o check e os caminhos concretos', () => {
    const brief = buildRepairBrief(
      verification(
        [
          {
            checkId: 'produced-changes',
            kind: 'diff',
            passed: false,
            advisory: false,
            durationMs: 1,
            detail: {
              problems: ['diff fora do escopo declarado: .github/workflows/deploy.yml, infra/x.tf'],
            },
          },
        ],
        'out-of-scope',
      ),
      task,
      DEFAULT_VALIDATION_POLICY,
    )

    expect(brief?.rules).toEqual(['scope'])
    expect(brief?.items[0]?.checkId).toBe('produced-changes')
    expect(brief?.paths).toEqual(['.github/workflows/deploy.yml', 'infra/x.tf'])
    expect(brief?.allowedScope).toEqual(['src/**'])
  })

  it('um único check reprovado que não é de política tira a falha inteira do reparo', () => {
    const brief = buildRepairBrief(
      verification(
        [
          {
            checkId: 'produced-changes',
            kind: 'diff',
            passed: false,
            advisory: false,
            durationMs: 1,
            detail: { problems: ['diff fora do escopo declarado: infra/x.tf'] },
          },
          {
            checkId: 'suite',
            kind: 'command',
            passed: false,
            advisory: false,
            durationMs: 1,
            stderr: '3 failing',
          },
        ],
        'test-failure',
      ),
      task,
      DEFAULT_VALIDATION_POLICY,
    )

    expect(brief).toBeUndefined()
  })

  it('regra desligada na política não produz reparo — a inconsistência fica visível', () => {
    const brief = buildRepairBrief(
      verification(
        [
          {
            checkId: 'produced-changes',
            kind: 'diff',
            passed: false,
            advisory: false,
            durationMs: 1,
            detail: { problems: ['diff fora do escopo declarado: infra/x.tf'] },
          },
        ],
        'out-of-scope',
      ),
      task,
      resolveValidationPolicy({ rules: { scope: 'off' } }),
    )

    expect(brief).toBeUndefined()
  })
})

describe('reparo dirigido — o ciclo completo', () => {
  it('validação reprovada três vezes NÃO bloqueia a task e NÃO gera task nova', async () => {
    await withTempDir(async (dir) => {
      createGitRepo({ dir, files: { 'src/index.ts': 'export {}\n' } })
      // Três violações de escopo seguidas e, na quarta, o agente acerta.
      // Antes de §6 isto morria na terceira: blocked + replan + tasks novas.
      const stack = await makeTestStack(dir, [
        FORA_DO_ESCOPO,
        FORA_DO_ESCOPO,
        FORA_DO_ESCOPO,
        DENTRO_DO_ESCOPO,
      ])
      try {
        const task = await stack.enqueue({
          title: 'Escapa do escopo três vezes',
          touches: ['src/**'],
          acceptance: artifactAcceptance('src/ok.ts', 'ok'),
        })

        unwrap(await stack.kernel.start({ projectId: stack.project.id }))
        await stack.kernel.wait()

        const final = await stack.state.tasks.find(task.id)
        expect(final?.state).toBe('done')
        // Três reparos, UMA tentativa real: é a diferença entre os dois
        // contadores, e é o item inteiro desta categoria.
        expect(final?.attempts).toBe(1)
        // Zerado ao passar na verificação: reparo é dívida de um ciclo.
        expect(final?.repairAttempts).toBe(0)

        // Nenhuma task nova entrou na fila — a correção foi na mesma task.
        expect(await stack.state.tasks.all()).toHaveLength(1)

        const events = await readEvents(stack)
        const names = events.map((event) => event.name)
        expect(names).not.toContain('TaskReplanned')
        expect(names).not.toContain('TaskBlocked')

        // O contador de reparo é auditável, e progride 1 → 2 → 3.
        const repairs = repairsIn(events)
        expect(repairs.map((repair) => repair.repairAttempt)).toEqual([1, 2, 3])
        expect(repairs.every((repair) => repair.rules.includes('scope'))).toBe(true)
      } finally {
        await stack.close()
      }
    })
  }, 90_000)

  it('estourado o teto de reparos, a falha volta a contar como tentativa real', async () => {
    await withTempDir(async (dir) => {
      createGitRepo({ dir, files: { 'src/index.ts': 'export {}\n' } })
      const stack = await makeTestStack(dir, [FORA_DO_ESCOPO, FORA_DO_ESCOPO, FORA_DO_ESCOPO], {
        maxAttempts: 1,
        validations: { maxRepairAttempts: 1 },
      })
      try {
        const task = await stack.enqueue({
          title: 'Nunca aprende',
          touches: ['src/**'],
          acceptance: artifactAcceptance('src/ok.ts', 'ok'),
        })

        unwrap(await stack.kernel.start({ projectId: stack.project.id }))
        await stack.kernel.wait()

        const final = await stack.state.tasks.find(task.id)
        // Um reparo (o teto), depois uma tentativa REAL que esgota `maxAttempts`.
        expect(final?.attempts).toBe(1)
        expect(final?.state).toBe('blocked')
        expect(final?.blockReason?.kind).toBe('exhausted')

        const repairs = repairsIn(await readEvents(stack))
        expect(repairs).toHaveLength(1)
      } finally {
        await stack.close()
      }
    })
  }, 90_000)

  it('o brief chega ao prompt com os caminhos concretos, não só a categoria', async () => {
    await withTempDir(async (dir) => {
      createGitRepo({ dir, files: { 'src/index.ts': 'export {}\n' } })
      const stack = await makeTestStack(dir, [FORA_DO_ESCOPO, DENTRO_DO_ESCOPO])
      try {
        await stack.enqueue({
          title: 'Escapa uma vez',
          touches: ['src/**'],
          acceptance: artifactAcceptance('src/ok.ts', 'ok'),
        })

        unwrap(await stack.kernel.start({ projectId: stack.project.id }))
        await stack.kernel.wait()

        expect(stack.provider.sessions).toHaveLength(2)
        const segunda = stack.provider.sessions[1]!

        const fragment = segunda.context.fragments.find((f) => f.id === 'repair:brief')
        expect(fragment?.pinned).toBe(true)
        expect(fragment?.priority).toBe(100)
        // Instrução do harness, não dado do repositório: envelopá-la como
        // conteúdo não-confiável (INV-6) anularia o que ela manda fazer.
        expect(fragment?.untrusted).toBe(false)

        // O que o modelo de fato lê: o pack renderizado pelo provider.
        const prompt = renderContextPack(segunda.context)
        expect(prompt).toContain('.github/workflows/deploy.yml') // o arquivo, não "out-of-scope"
        expect(prompt).toContain('produced-changes') // qual check reprovou
        expect(prompt).toContain('corrija SOMENTE')
        expect(prompt).toContain('src/**') // o escopo em que ele pode trabalhar

        // O contexto genérico de retry foi SUBSTITUÍDO, não somado: ele manda
        // "não repita a mesma abordagem", o oposto do que reparo quer.
        expect(segunda.instruction).not.toContain('FALHOU na verificação')
      } finally {
        await stack.close()
      }
    })
  }, 90_000)

  it('falha que não é de validação segue o caminho antigo, sem reparo', async () => {
    await withTempDir(async (dir) => {
      createGitRepo({ dir, files: { 'src/index.ts': 'export {}\n' } })
      const stack = await makeTestStack(dir, [DENTRO_DO_ESCOPO, DENTRO_DO_ESCOPO], {
        maxAttempts: 1,
      })
      try {
        const task = await stack.enqueue({
          title: 'Suíte vermelha',
          touches: ['src/**'],
          acceptance: {
            checks: [
              {
                kind: 'command',
                id: 'suite',
                // Saída que o classificador lê como `test-failure` — defeito,
                // não violação de política.
                run: 'node -e "console.error(\'3 failing\');process.exit(1)"',
                timeoutMs: 30_000,
              },
            ],
            requireAll: true,
          },
        })

        unwrap(await stack.kernel.start({ projectId: stack.project.id }))
        await stack.kernel.wait()

        const attempts = await stack.state.attempts.byTask(task.id)
        expect(attempts[0]?.outcome?.diagnosis?.category).toBe('test-failure')

        const final = await stack.state.tasks.find(task.id)
        // Caminho antigo intacto: tentativa contada, esgotou, bloqueou.
        expect(final?.attempts).toBe(1)
        expect(final?.repairAttempts).toBe(0)
        expect(final?.state).toBe('blocked')

        expect(repairsIn(await readEvents(stack))).toHaveLength(0)
      } finally {
        await stack.close()
      }
    })
  }, 90_000)

  it('o commit do reparo bem-sucedido existe uma vez só — reparo não duplica trabalho', async () => {
    await withTempDir(async (dir) => {
      createGitRepo({ dir, files: { 'src/index.ts': 'export {}\n' } })
      const stack = await makeTestStack(dir, [FORA_DO_ESCOPO, DENTRO_DO_ESCOPO])
      try {
        await stack.enqueue({
          title: 'Reparado',
          touches: ['src/**'],
          acceptance: artifactAcceptance('src/ok.ts', 'ok'),
        })

        unwrap(await stack.kernel.start({ projectId: stack.project.id }))
        await stack.kernel.wait()

        const commits = gitIn(dir, 'log', '--all', '--oneline', '--grep', 'feature: Reparado')
        expect(commits.split('\n').filter((line) => line.trim() !== '')).toHaveLength(1)
        // O arquivo fora do escopo nunca chegou ao repositório.
        expect(gitIn(dir, 'log', '--all', '--name-only', '--pretty=format:')).not.toContain(
          '.github/workflows/deploy.yml',
        )
      } finally {
        await stack.close()
      }
    })
  }, 90_000)
})
