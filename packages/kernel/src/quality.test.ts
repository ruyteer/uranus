import { describe, expect, it } from 'vitest'
import type { FindingsOutput, GatePolicy } from '@uranus/core'
import { DEFAULT_GATE_POLICY, unwrap } from '@uranus/core'
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

  it('achado de severidade baixa NÃO bloqueia e NÃO vira task: vira registro', async () => {
    // O caso que motivou a contenção. Este teste já afirmou o contrário —
    // `medium`/`naming-convention` virava task, com worktree, sessão de modelo
    // e PR próprios, para renomear uma variável. E a task derivada era
    // revisada de novo, gerando mais achados. Hoje o achado é registrado, e
    // quem decide se vale trabalho é o humano lendo o backlog.
    const adiados: { reason: string; title: string }[] = []
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
        {
          gates: ['reviewer', 'security'],
          onDeferredFinding: ({ deferred }): Promise<void> => {
            adiados.push({ reason: deferred.reason, title: deferred.finding.title })
            return Promise.resolve()
          },
        },
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

        // Nenhuma task derivada: a fila tem só a task que o humano pediu.
        const todas = await stack.state.tasks.all()
        expect(todas.filter((t) => t.lineage !== undefined)).toEqual([])
        expect(todas.find((t) => t.labels.includes('achado:reviewer'))).toBeUndefined()

        // Mas o achado não se perdeu — foi registrado, com o motivo.
        expect(adiados).toEqual([
          { reason: 'severity', title: 'Nome de variável pouco descritivo' },
        ])
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

        // O Security foi pulado no gate pipeline — rodar custaria dinheiro
        // para descobrir algo que não muda a decisão (já bloqueada pelo
        // Reviewer). Verifica por agente, não pela contagem total de sessões:
        // o achado crítico corretamente vira uma task de acompanhamento, que
        // por sua vez tem sua própria sessão de Executor — 3 sessões no
        // total (Executor + Reviewer + Executor da task de acompanhamento),
        // nenhuma delas do Security.
        const agents = stack.provider.sessions.map((s) => s.metadata['agent'])
        expect(agents).not.toContain('security')
        expect(agents.filter((a) => a === 'reviewer')).toHaveLength(1)
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

describe('contenção da cadeia de correções', () => {
  /** Política permissiva de propósito: é a que fazia a fila crescer sozinha. */
  const ACOMPANHA_MEDIUM: GatePolicy = {
    ...DEFAULT_GATE_POLICY,
    followUpAt: 'medium',
    followUpDenyCategories: [],
  }

  function achadoMedio(file: string, titulo: string): string {
    return findings([
      {
        severity: 'medium',
        category: 'perf',
        title: titulo,
        detail: `Trabalho redundante em ${file}, refeito a cada chamada sem necessidade.`,
        file,
        suggestion: 'Memoizar o cálculo.',
      },
    ])
  }

  it('correção de correção não gera correção: a árvore tem profundidade máxima', async () => {
    const adiados: { reason: string; title: string }[] = []
    await withTempDir(async (dir) => {
      repoComTestes(dir)
      const stack = await makeTestStack(
        dir,
        [
          // ── Task do humano ────────────────────────────────────────────────
          { writes: { 'src/db.mjs': 'export const consulta = (id) => [id]\n' } },
          { text: achadoMedio('src/db.mjs', 'Consulta refeita a cada chamada') },
          { text: SEM_ACHADOS },
          // ── Correção derivada (geração 1) ─────────────────────────────────
          { writes: { 'src/db.mjs': 'const cache = []\nexport const consulta = () => cache\n' } },
          // O reviewer acha algo NOVO na correção. Antes, isto virava geração
          // 2 — e a geração 2 viraria a 3, sem fim.
          { text: achadoMedio('src/cache.mjs', 'Cache sem limite de tamanho') },
          { text: SEM_ACHADOS },
        ],
        {
          gates: ['reviewer', 'security'],
          gatePolicy: ACOMPANHA_MEDIUM,
          onDeferredFinding: ({ deferred }): Promise<void> => {
            adiados.push({ reason: deferred.reason, title: deferred.finding.title })
            return Promise.resolve()
          },
        },
      )
      try {
        await stack.enqueue({
          title: 'Adicionar consulta',
          touches: ['src/**'],
          acceptance: {
            checks: [{ kind: 'command', id: 'suite', run: 'node --test', timeoutMs: 120_000 }],
            requireAll: true,
          },
        })

        unwrap(await stack.kernel.start({ projectId: stack.project.id }))
        await stack.kernel.wait()

        const todas = await stack.state.tasks.all()
        // Duas tasks, não uma cascata: a do humano e UMA correção.
        expect(todas).toHaveLength(2)

        const derivadas = todas.filter((t) => t.lineage !== undefined)
        expect(derivadas).toHaveLength(1)
        expect(derivadas[0]!.lineage!.generation).toBe(1)
        expect(derivadas[0]!.lineage!.raisedBy).toBe('reviewer')
        // A raiz aponta para a task que o humano pediu, não para a intermediária.
        expect(derivadas[0]!.lineage!.rootTaskId).toBe(
          todas.find((t) => t.lineage === undefined)!.id,
        )

        // O achado da geração 2 não sumiu: virou registro, com o motivo.
        expect(adiados).toEqual([{ reason: 'generation', title: 'Cache sem limite de tamanho' }])
      } finally {
        await stack.close()
      }
    })
  }, 120_000)

  it('o mesmo achado, apontado de novo, não vira uma segunda task', async () => {
    const adiados: string[] = []
    await withTempDir(async (dir) => {
      repoComTestes(dir)
      // O reviewer repete a MESMA queixa na revisão da correção. Sem
      // fingerprint isso seria uma task nova a cada rodada — o loop clássico
      // de "ele fica achando o mesmo problema pra sempre".
      const mesmoAchado = achadoMedio('src/db.mjs', 'Consulta refeita a cada chamada')
      const stack = await makeTestStack(
        dir,
        [
          { writes: { 'src/db.mjs': 'export const consulta = (id) => [id]\n' } },
          { text: mesmoAchado },
          { text: SEM_ACHADOS },
          { writes: { 'src/db.mjs': 'const c = []\nexport const consulta = () => c\n' } },
          { text: mesmoAchado },
          { text: SEM_ACHADOS },
        ],
        {
          gates: ['reviewer', 'security'],
          gatePolicy: { ...ACOMPANHA_MEDIUM, maxGeneration: 3 },
          onDeferredFinding: ({ deferred }): Promise<void> => {
            adiados.push(deferred.reason)
            return Promise.resolve()
          },
        },
      )
      try {
        await stack.enqueue({
          title: 'Adicionar consulta',
          touches: ['src/**'],
          acceptance: {
            checks: [{ kind: 'command', id: 'suite', run: 'node --test', timeoutMs: 120_000 }],
            requireAll: true,
          },
        })

        unwrap(await stack.kernel.start({ projectId: stack.project.id }))
        await stack.kernel.wait()

        const todas = await stack.state.tasks.all()
        expect(todas.filter((t) => t.lineage !== undefined)).toHaveLength(1)
        expect(adiados).toEqual(['duplicate'])
      } finally {
        await stack.close()
      }
    })
  }, 120_000)

  it('o teto por run corta a derivação mesmo com achados legítimos', async () => {
    const adiados: string[] = []
    await withTempDir(async (dir) => {
      repoComTestes(dir)
      const stack = await makeTestStack(
        dir,
        [
          { writes: { 'src/db.mjs': 'export const consulta = (id) => [id]\n' } },
          {
            text: findings(
              ['a', 'b', 'c', 'd'].map((letra) => ({
                severity: 'medium' as const,
                category: 'perf',
                title: `Trabalho redundante em ${letra}`,
                detail: `A função em src/${letra}.mjs recalcula o mesmo valor a cada chamada.`,
                file: `src/${letra}.mjs`,
              })),
            ),
          },
          { text: SEM_ACHADOS },
        ],
        {
          gates: ['reviewer', 'security'],
          gatePolicy: { ...ACOMPANHA_MEDIUM, maxFollowUpsPerRun: 2 },
          onDeferredFinding: ({ deferred }): Promise<void> => {
            adiados.push(deferred.reason)
            return Promise.resolve()
          },
        },
      )
      try {
        await stack.enqueue({
          title: 'Adicionar consulta',
          touches: ['src/**'],
          acceptance: {
            checks: [{ kind: 'command', id: 'suite', run: 'node --test', timeoutMs: 120_000 }],
            requireAll: true,
          },
        })

        unwrap(await stack.kernel.start({ projectId: stack.project.id }))
        await stack.kernel.wait()

        const todas = await stack.state.tasks.all()
        expect(todas.filter((t) => t.lineage !== undefined)).toHaveLength(2)
        expect(adiados).toEqual(['run-budget', 'run-budget'])
      } finally {
        await stack.close()
      }
    })
  }, 120_000)
})
