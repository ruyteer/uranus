import { describe, expect, it } from 'vitest'
import type { FindingsOutput } from '@uranus/core'
import { unwrap } from '@uranus/core'
import { createGitRepo, gitIn, withTempDir } from '@uranus/testkit'
import { makeTestStack } from './test-stack.js'
import { renderDiff } from './quality/gate-pipeline.js'

/** Repo com suíte real, para a verificação por código passar de verdade. */
function repoComTestes(dir: string): void {
  createGitRepo({
    dir,
    files: {
      'package.json': JSON.stringify({ name: 'alvo', scripts: { test: 'node --test' } }),
      'src/db.mjs': 'export const consulta = () => []\n',
      'test/db.test.mjs': [
        "import { test } from 'node:test'",
        "import assert from 'node:assert/strict'",
        "test('ok', () => { assert.ok(true) })",
        '',
      ].join('\n'),
    },
  })
}

function findings(items: FindingsOutput['findings']): string {
  return JSON.stringify({ findings: items })
}

const VULNERABILIDADE: FindingsOutput['findings'] = [
  {
    severity: 'critical',
    category: 'sql-injection',
    title: 'Concatenação de entrada do usuário na consulta SQL',
    detail:
      'O parâmetro `nome` vem da requisição e é concatenado direto na string SQL em src/db.mjs, permitindo injeção.',
    file: 'src/db.mjs',
    line: 2,
    suggestion: 'Usar consulta parametrizada em vez de concatenação de string.',
  },
]

const SEM_ACHADOS = findings([])

describe('cadeia de qualidade (DoD Fase 5)', () => {
  it('vulnerabilidade plantada é bloqueada pelo Security ANTES do commit', async () => {
    await withTempDir(async (dir) => {
      repoComTestes(dir)
      const stack = await makeTestStack(
        dir,
        [
          // Executor: escreve código vulnerável, mas a suíte passa.
          {
            writes: {
              'src/db.mjs':
                'export const consulta = (nome) => `SELECT * FROM users WHERE nome = ${nome}`\n',
            },
          },
          // Reviewer: nada a apontar.
          { text: SEM_ACHADOS },
          // Security: acha a injeção.
          { text: findings(VULNERABILIDADE) },
        ],
        { gates: ['reviewer', 'security'], maxAttempts: 1 },
      )
      try {
        const task = await stack.enqueue({
          title: 'Adicionar consulta por nome',
          touches: ['src/**'],
          acceptance: {
            checks: [{ kind: 'command', id: 'suite', run: 'node --test', timeoutMs: 120_000 }],
            requireAll: true,
          },
        })

        unwrap(await stack.kernel.start({ projectId: stack.project.id }))
        await stack.kernel.wait()

        // A task NÃO foi integrada, mesmo com os testes passando.
        const final = await stack.state.tasks.find(task.id)
        expect(final?.state).not.toBe('done')

        // Nenhum commit: o bloqueio acontece ANTES da integração.
        const commits = gitIn(dir, 'log', '--all', '--oneline')
        expect(commits.split('\n').filter((l) => l.trim() !== '')).toHaveLength(1)

        // O achado está no log de eventos, com severidade e arquivo.
        const names: string[] = []
        let securityFinding: Record<string, unknown> | undefined
        for await (const event of stack.eventStore.read(1)) {
          names.push(event.name)
          if (event.name === 'SecurityFindingRaised') {
            securityFinding = event.payload
          }
        }
        expect(names).toContain('SecurityFindingRaised')
        expect(names).toContain('ReviewCompleted')
        expect(securityFinding?.['severity']).toBe('critical')
        expect(securityFinding?.['path']).toBe('src/db.mjs')

        // E virou trabalho rastreável: existe uma task de correção na fila.
        const todas = await stack.state.tasks.all()
        const correcao = todas.find((t) => t.labels.includes('achado:security'))
        expect(correcao).toBeDefined()
        expect(correcao!.kind).toBe('security')
        expect(correcao!.title).toContain('sql-injection')
        expect(correcao!.touches).toEqual(['src/db.mjs'])
      } finally {
        await stack.close()
      }
    })
  }, 90_000)

  it('achado de severidade baixa NÃO bloqueia, mas vira acompanhamento', async () => {
    await withTempDir(async (dir) => {
      repoComTestes(dir)
      const stack = await makeTestStack(
        dir,
        [
          { writes: { 'src/db.mjs': 'export const consulta = () => []\nexport const n = 1\n' } },
          {
            text: findings([
              {
                severity: 'medium',
                category: 'naming-convention',
                title: 'Nome de variável pouco descritivo',
                detail:
                  'A constante `n` não comunica o que representa; o projeto usa nomes completos.',
                file: 'src/db.mjs',
                suggestion: 'Renomear para algo descritivo.',
              },
            ]),
          },
          { text: SEM_ACHADOS },
        ],
        { gates: ['reviewer', 'security'] },
      )
      try {
        const task = await stack.enqueue({
          title: 'Mudança pequena',
          touches: ['src/**'],
          acceptance: {
            checks: [{ kind: 'command', id: 'suite', run: 'node --test', timeoutMs: 120_000 }],
            requireAll: true,
          },
        })

        unwrap(await stack.kernel.start({ projectId: stack.project.id }))
        await stack.kernel.wait()

        // Integrou: `medium` está abaixo do limiar de bloqueio (`high`).
        const final = await stack.state.tasks.find(task.id)
        expect(final?.state).toBe('done')
        expect(gitIn(dir, 'log', '--all', '--oneline').split('\n').length).toBeGreaterThan(1)

        // Mas o achado não se perdeu: virou task de acompanhamento.
        const todas = await stack.state.tasks.all()
        const followUp = todas.find((t) => t.labels.includes('achado:reviewer'))
        expect(followUp).toBeDefined()
        expect(followUp!.title).toContain('naming-convention')
      } finally {
        await stack.close()
      }
    })
  }, 90_000)

  it('o pipeline curto-circuita: gate posterior não roda após bloqueio', async () => {
    await withTempDir(async (dir) => {
      repoComTestes(dir)
      const stack = await makeTestStack(
        dir,
        [
          { writes: { 'src/db.mjs': 'export const x = 1\n' } },
          // Reviewer bloqueia já no primeiro gate.
          {
            text: findings([
              {
                severity: 'critical',
                category: 'regressao',
                title: 'Remove função usada em produção',
                detail: 'A função `consulta` foi removida mas ainda é importada em outros módulos.',
                file: 'src/db.mjs',
              },
            ]),
          },
          // Este comportamento seria do Security — não deve ser consumido.
          { text: SEM_ACHADOS },
        ],
        { gates: ['reviewer', 'security'], maxAttempts: 1 },
      )
      try {
        await stack.enqueue({
          title: 'Mudança arriscada',
          touches: ['src/**'],
          acceptance: {
            checks: [{ kind: 'command', id: 'suite', run: 'node --test', timeoutMs: 120_000 }],
            requireAll: true,
          },
        })

        unwrap(await stack.kernel.start({ projectId: stack.project.id }))
        await stack.kernel.wait()

        // 2 sessões: Executor + Reviewer. O Security foi pulado — rodar custaria
        // dinheiro para descobrir algo que não muda a decisão.
        expect(stack.provider.sessions).toHaveLength(2)
      } finally {
        await stack.close()
      }
    })
  }, 90_000)

  it('gate quebrado não impede a integração, mas fica registrado', async () => {
    await withTempDir(async (dir) => {
      repoComTestes(dir)
      const stack = await makeTestStack(
        dir,
        [
          { writes: { 'src/db.mjs': 'export const x = 1\n' } },
          // Gate morre por erro de infraestrutura.
          { status: 'error', text: 'Not logged in' },
        ],
        { gates: ['reviewer'] },
      )
      try {
        const task = await stack.enqueue({
          title: 'Segue mesmo com gate quebrado',
          touches: ['src/**'],
          acceptance: {
            checks: [{ kind: 'command', id: 'suite', run: 'node --test', timeoutMs: 120_000 }],
            requireAll: true,
          },
        })

        unwrap(await stack.kernel.start({ projectId: stack.project.id }))
        await stack.kernel.wait()

        // O sinal de correção (Verifier) passou; o de qualidade é opcional.
        const final = await stack.state.tasks.find(task.id)
        expect(final?.state).toBe('done')
      } finally {
        await stack.close()
      }
    })
  }, 90_000)

  it('sem gates configurados, o comportamento é o da Fase 2', async () => {
    await withTempDir(async (dir) => {
      repoComTestes(dir)
      const stack = await makeTestStack(dir, [{ writes: { 'src/db.mjs': 'export const x = 1\n' } }])
      try {
        const task = await stack.enqueue({
          title: 'Sem cadeia de qualidade',
          touches: ['src/**'],
          acceptance: {
            checks: [{ kind: 'command', id: 'suite', run: 'node --test', timeoutMs: 120_000 }],
            requireAll: true,
          },
        })

        unwrap(await stack.kernel.start({ projectId: stack.project.id }))
        await stack.kernel.wait()

        expect((await stack.state.tasks.find(task.id))?.state).toBe('done')
        // Só o Executor rodou.
        expect(stack.provider.sessions).toHaveLength(1)
      } finally {
        await stack.close()
      }
    })
  }, 90_000)
})

describe('escalada para agente especializado (R3)', () => {
  it('após falhas repetidas, a próxima tentativa vai para o BugHunter', async () => {
    await withTempDir(async (dir) => {
      repoComTestes(dir)
      const stack = await makeTestStack(
        dir,
        [
          // Executor falha duas vezes escrevendo conteúdo errado.
          { writes: { 'src/alvo.mjs': 'errado 1\n' } },
          { writes: { 'src/alvo.mjs': 'errado 2\n' } },
          // BugHunter acerta.
          { writes: { 'src/alvo.mjs': 'export const correto = true\n' } },
        ],
        { escalationAgent: 'bug-hunter', maxAttempts: 3 },
      )
      try {
        const task = await stack.enqueue({
          kind: 'bugfix',
          title: 'Corrigir alvo',
          touches: ['src/**'],
          acceptance: {
            checks: [
              {
                kind: 'artifact',
                id: 'conteudo',
                path: 'src/alvo.mjs',
                mustExist: true,
                matches: 'correto',
                timeoutMs: 5_000,
              },
            ],
            requireAll: true,
          },
        })

        unwrap(await stack.kernel.start({ projectId: stack.project.id }))
        await stack.kernel.wait()

        const final = await stack.state.tasks.find(task.id)
        expect(final?.state).toBe('done')

        // A escalada aconteceu: a 3ª tentativa usou o BugHunter.
        const attempts = await stack.state.attempts.byTask(task.id)
        expect(attempts.length).toBeGreaterThanOrEqual(3)
        expect(attempts.at(-1)!.agent).toBe('bug-hunter')
        // E as primeiras usaram o Executor genérico.
        expect(attempts[0]!.agent).toBe('executor')
      } finally {
        await stack.close()
      }
    })
  }, 120_000)
})

describe('renderDiff', () => {
  it('resume o diff para o prompt de revisão', () => {
    const text = renderDiff({
      files: [
        { path: 'src/a.ts', added: 10, removed: 2, status: 'modified' },
        { path: 'src/b.ts', added: 5, removed: 0, status: 'added' },
      ],
      totalAdded: 15,
      totalRemoved: 2,
      isEmpty: false,
    })
    expect(text).toContain('2 arquivo(s)')
    expect(text).toContain('src/a.ts')
    expect(text).toContain('+15')
  })

  it('diff vazio é explícito', () => {
    expect(renderDiff({ files: [], totalAdded: 0, totalRemoved: 0, isEmpty: true })).toBe(
      '(diff vazio)',
    )
  })

  it('trunca listas longas informando quantos ficaram de fora', () => {
    const files = Array.from({ length: 60 }, (_, index) => ({
      path: `src/f${String(index)}.ts`,
      added: 1,
      removed: 0,
      status: 'modified' as const,
    }))
    const text = renderDiff({ files, totalAdded: 60, totalRemoved: 0, isEmpty: false }, 40)
    expect(text).toContain('e mais 20 arquivo(s)')
  })
})
