import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ProjectId } from '@uranus/core'
import { silentLogger, unwrap } from '@uranus/core'
import { withTempDir } from '@uranus/testkit'
import { parseMarkdownBacklog } from './markdown-source.js'
import { validatePlan, topologicalSort, type PlanValidationOptions } from './plan-validator.js'
import type { PlannerOutput, PlannerTask } from './plan-schema.js'
import { FileBacklogStore } from './store.js'

const PROJECT_ID = 'prj_01HZZZZZZZZZZZZZZZZZZZZZZZ' as ProjectId

const OPTIONS: PlanValidationOptions = {
  allowedPaths: ['src/**', 'test/**', 'docs/**'],
  forbiddenPaths: ['.github/**', '.env', 'infra/**'],
  knownTestRunners: ['vitest'],
  allowedCommands: [],
  maxTasks: 8,
  restrictedMode: false,
}

function task(overrides: Partial<PlannerTask> = {}): PlannerTask {
  return {
    ref: 't1',
    kind: 'feature',
    title: 'Adicionar endpoint de saúde',
    intent: 'Criar GET /health que retorna 200 com o status do serviço.',
    touches: ['src/**'],
    acceptance: {
      checks: [{ kind: 'tests', id: 'suite', runner: 'vitest', requireNewTests: true }],
    },
    ...overrides,
  }
}

function plan(tasks: readonly PlannerTask[]): PlannerOutput {
  return {
    summary: 'Plano de teste com tarefas verificáveis.',
    rationale: 'Decomposto assim porque cada parte é entregável e testável isoladamente.',
    tasks,
  }
}

describe('validatePlan — o modelo propõe, o validador dispõe (ADR-002)', () => {
  it('aceita um plano bem formado e devolve drafts em ordem topológica', () => {
    const result = validatePlan(
      plan([
        task({ ref: 'api', touches: ['src/api/**'] }),
        task({
          ref: 'docs',
          kind: 'docs',
          touches: ['docs/**'],
          dependsOn: ['api'],
          acceptance: {
            checks: [{ kind: 'artifact', id: 'doc', path: 'docs/health.md', mustExist: true }],
          },
        }),
      ]),
      OPTIONS,
    )

    const validated = unwrap(result)
    expect(validated.refOrder).toEqual(['api', 'docs'])
    expect(validated.drafts).toHaveLength(2)
    expect(validated.dependencies['docs']).toEqual(['api'])
  })

  it('acrescenta o DiffCheck de escopo mesmo quando o Planner esquece (INV-5)', () => {
    const validated = unwrap(validatePlan(plan([task()]), OPTIONS))
    const kinds = validated.drafts[0]!.acceptance.checks.map((check) => check.kind)
    expect(kinds).toContain('diff')
    const diffCheck = validated.drafts[0]!.acceptance.checks.find((c) => c.kind === 'diff')
    expect(diffCheck).toMatchObject({ requireNonEmpty: true })
  })

  it('rejeita plano vazio', () => {
    const result = validatePlan(plan([]), OPTIONS)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error[0]!.code).toBe('empty')
  })

  it('rejeita plano grande demais', () => {
    const many = Array.from({ length: 9 }, (_, index) =>
      task({ ref: `t${String(index)}`, touches: [`src/m${String(index)}/**`] }),
    )
    const result = validatePlan(plan(many), OPTIONS)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.some((r) => r.code === 'too-large')).toBe(true)
  })

  it('rejeita ciclo de dependências', () => {
    const result = validatePlan(
      plan([
        task({ ref: 'a', touches: ['src/a/**'], dependsOn: ['b'] }),
        task({ ref: 'b', touches: ['src/b/**'], dependsOn: ['a'] }),
      ]),
      OPTIONS,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.some((r) => r.code === 'cyclic-dependency')).toBe(true)
  })

  it('rejeita autodependência', () => {
    const result = validatePlan(plan([task({ ref: 'a', dependsOn: ['a'] })]), OPTIONS)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.some((r) => r.code === 'cyclic-dependency')).toBe(true)
  })

  it('rejeita dependência inexistente', () => {
    const result = validatePlan(plan([task({ dependsOn: ['fantasma'] })]), OPTIONS)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.some((r) => r.code === 'unknown-dependency')).toBe(true)
  })

  describe('escopo (INV-5)', () => {
    it('rejeita escape de diretório', () => {
      for (const bad of ['../fora/**', '/etc/passwd', 'C:/Windows/**']) {
        const result = validatePlan(plan([task({ touches: [bad] })]), OPTIONS)
        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.error.some((r) => r.code === 'paths-out-of-scope')).toBe(true)
        }
      }
    })

    it('rejeita escopo amplo demais', () => {
      for (const wide of ['**', '*', '.']) {
        const result = validatePlan(plan([task({ touches: [wide] })]), OPTIONS)
        expect(result.ok).toBe(false)
      }
    })

    it('rejeita caminho proibido pela configuração', () => {
      const result = validatePlan(plan([task({ touches: ['.github/workflows/**'] })]), OPTIONS)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.some((r) => r.message.includes('proibido'))).toBe(true)
      }
    })

    it('rejeita caminho fora dos permitidos', () => {
      const result = validatePlan(plan([task({ touches: ['scripts/**'] })]), OPTIONS)
      expect(result.ok).toBe(false)
    })

    it('rejeita duas tasks independentes que tocam os mesmos arquivos (R6)', () => {
      const result = validatePlan(
        plan([
          task({ ref: 'a', touches: ['src/api/**'] }),
          task({ ref: 'b', touches: ['src/**'] }),
        ]),
        OPTIONS,
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.some((r) => r.message.includes('mesmos arquivos'))).toBe(true)
      }
    })

    it('aceita sobreposição quando há dependência declarada', () => {
      const result = validatePlan(
        plan([
          task({ ref: 'a', touches: ['src/api/**'] }),
          task({ ref: 'b', touches: ['src/**'], dependsOn: ['a'] }),
        ]),
        OPTIONS,
      )
      expect(result.ok).toBe(true)
    })
  })

  describe('contrato de aceite (INV-2)', () => {
    it('rejeita contrato que só verifica o formato do diff', () => {
      const result = validatePlan(
        plan([
          task({
            acceptance: { checks: [{ kind: 'diff', id: 'd', requireNonEmpty: true }] },
          }),
        ]),
        OPTIONS,
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.some((r) => r.code === 'unenforceable-acceptance')).toBe(true)
      }
    })

    it('rejeita runner de teste que o projeto não possui', () => {
      const result = validatePlan(
        plan([task({ acceptance: { checks: [{ kind: 'tests', id: 't', runner: 'jest' }] } })]),
        OPTIONS,
      )
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error[0]!.message).toContain('jest')
    })

    it('rejeita comando que altera estado ou acessa rede', () => {
      for (const dangerous of [
        'rm -rf dist',
        'curl https://exemplo.com',
        'git push origin main',
        'npm test && rm x',
        'cat x > y',
      ]) {
        const result = validatePlan(
          plan([task({ acceptance: { checks: [{ kind: 'command', id: 'c', run: dangerous }] } })]),
          OPTIONS,
        )
        expect(result.ok, `deveria rejeitar: ${dangerous}`).toBe(false)
      }
    })

    it('aceita comando de verificação legítimo', () => {
      const result = validatePlan(
        plan([
          task({
            acceptance: { checks: [{ kind: 'command', id: 'c', run: 'npm run typecheck' }] },
          }),
        ]),
        OPTIONS,
      )
      expect(result.ok).toBe(true)
    })

    it('respeita a allowlist de comandos quando configurada', () => {
      const restricted = { ...OPTIONS, allowedCommands: ['npm test'] }
      expect(
        validatePlan(
          plan([task({ acceptance: { checks: [{ kind: 'command', id: 'c', run: 'npm test' }] } })]),
          restricted,
        ).ok,
      ).toBe(true)
      expect(
        validatePlan(
          plan([
            task({ acceptance: { checks: [{ kind: 'command', id: 'c', run: 'npm run build' }] } }),
          ]),
          restricted,
        ).ok,
      ).toBe(false)
    })

    it('rejeita regex inválida em artifact', () => {
      const result = validatePlan(
        plan([
          task({
            acceptance: {
              checks: [{ kind: 'artifact', id: 'a', path: 'x.ts', mustExist: true, matches: '[' }],
            },
          }),
        ]),
        OPTIONS,
      )
      expect(result.ok).toBe(false)
    })

    it('rejeita ids de check duplicados', () => {
      const result = validatePlan(
        plan([
          task({
            acceptance: {
              checks: [
                { kind: 'tests', id: 'x', runner: 'vitest' },
                { kind: 'command', id: 'x', run: 'npm run lint' },
              ],
            },
          }),
        ]),
        OPTIONS,
      )
      expect(result.ok).toBe(false)
    })
  })

  it('modo restrito só aceita tasks de teste (R4)', () => {
    const restricted = { ...OPTIONS, restrictedMode: true, knownTestRunners: ['vitest'] }
    expect(validatePlan(plan([task({ kind: 'feature' })]), restricted).ok).toBe(false)

    const testOnly = validatePlan(plan([task({ kind: 'test', touches: ['test/**'] })]), restricted)
    expect(testOnly.ok).toBe(true)
    if (testOnly.ok) expect(testOnly.value.drafts[0]!.labels).toContain('modo-restrito')
  })

  it('rejeita tipo de task desconhecido', () => {
    const result = validatePlan(plan([task({ kind: 'teleportar' })]), OPTIONS)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error[0]!.code).toBe('invalid-task-kind')
  })

  it('acumula TODOS os problemas de uma vez', () => {
    const result = validatePlan(
      plan([
        task({ ref: 'a', kind: 'inventado', touches: ['../fuga/**'] }),
        task({ ref: 'b', touches: ['scripts/**'], dependsOn: ['fantasma'] }),
      ]),
      OPTIONS,
    )
    expect(result.ok).toBe(false)
    // Um Planner que recebe um erro por vez gasta uma sessão por correção.
    if (!result.ok) expect(result.error.length).toBeGreaterThanOrEqual(3)
  })
})

describe('topologicalSort', () => {
  it('ordena dependências antes dos dependentes', () => {
    const sorted = topologicalSort([
      task({ ref: 'c', dependsOn: ['b'] }),
      task({ ref: 'a' }),
      task({ ref: 'b', dependsOn: ['a'] }),
    ])
    expect(sorted?.map((t) => t.ref)).toEqual(['a', 'b', 'c'])
  })

  it('mantém ordem do plano entre tasks independentes (determinismo)', () => {
    const sorted = topologicalSort([task({ ref: 'x' }), task({ ref: 'y' }), task({ ref: 'z' })])
    expect(sorted?.map((t) => t.ref)).toEqual(['x', 'y', 'z'])
  })

  it('devolve undefined em ciclo', () => {
    expect(
      topologicalSort([task({ ref: 'a', dependsOn: ['b'] }), task({ ref: 'b', dependsOn: ['a'] })]),
    ).toBeUndefined()
  })
})

describe('parseMarkdownBacklog', () => {
  it('reconhece checkboxes abertos e ignora concluídos', () => {
    const items = parseMarkdownBacklog(
      ['- [ ] Adicionar cache de sessão', '- [x] Já feito', '* [ ] Corrigir timeout [bug]'].join(
        '\n',
      ),
      'BACKLOG.md',
    )
    expect(items).toHaveLength(2)
    expect(items[0]!.title).toBe('Adicionar cache de sessão')
    expect(items[1]!.labels).toContain('bug')
  })

  it('reconhece seções com corpo e ignora cabeçalho sem conteúdo', () => {
    const items = parseMarkdownBacklog(
      [
        '## Migrar para Postgres',
        '',
        'Trocar SQLite por Postgres em produção.',
        '',
        '## Vazia',
      ].join('\n'),
      'BACKLOG.md',
    )
    expect(items).toHaveLength(1)
    expect(items[0]!.title).toBe('Migrar para Postgres')
    expect(items[0]!.body).toContain('Postgres em produção')
  })

  it('extrai labels de #tag e [tag]', () => {
    const items = parseMarkdownBacklog('- [ ] Ajustar login #auth [p1]', 'B.md')
    expect([...items[0]!.labels].sort()).toEqual(['auth', 'p1'])
    expect(items[0]!.title).toBe('Ajustar login')
  })
})

describe('FileBacklogStore', () => {
  function makeStore(dir: string): FileBacklogStore {
    return new FileBacklogStore({
      dir: join(dir, '.uranus', 'backlog'),
      projectId: PROJECT_ID,
      logger: silentLogger,
    })
  }

  it('grava YAML legível e sobrevive a restart', async () => {
    await withTempDir(async (dir) => {
      const store = makeStore(dir)
      const item = unwrap(
        await store.add({
          title: 'Melhorar busca',
          body: 'detalhes',
          createdAt: 1_700_000_000_000,
        }),
      )

      const fresh = makeStore(dir)
      const found = await fresh.get(item.id)
      expect(found?.title).toBe('Melhorar busca')
      expect(found?.state).toBe('open')
    })
  })

  it('lista ordenado por prioridade e depois por criação', async () => {
    await withTempDir(async (dir) => {
      const store = makeStore(dir)
      unwrap(await store.add({ title: 'Baixa', priority: 10, body: '', createdAt: 1 }))
      unwrap(await store.add({ title: 'Alta', priority: 90, body: '', createdAt: 2 }))
      unwrap(await store.add({ title: 'Média', priority: 50, body: '', createdAt: 3 }))

      const items = await store.list()
      expect(items.map((item) => item.title)).toEqual(['Alta', 'Média', 'Baixa'])
    })
  })

  it('importItems é idempotente por externalRef', async () => {
    await withTempDir(async (dir) => {
      const store = makeStore(dir)
      const batch = [
        { title: 'A', body: 'a', labels: [], externalRef: 'B.md:1', source: 'file' as const },
        { title: 'B', body: 'b', labels: [], externalRef: 'B.md:2', source: 'file' as const },
      ]
      const first = await store.importItems(batch, 1_000)
      expect(first).toEqual({ imported: 2, skipped: 0 })

      const second = await store.importItems(batch, 2_000)
      expect(second).toEqual({ imported: 0, skipped: 2 })
      expect(await store.list()).toHaveLength(2)
    })
  })

  it('ignora arquivo ilegível sem derrubar a listagem', async () => {
    await withTempDir(async (dir) => {
      const store = makeStore(dir)
      unwrap(await store.add({ title: 'Válido', body: '', createdAt: 1 }))

      const { writeFile, mkdir } = await import('node:fs/promises')
      await mkdir(join(dir, '.uranus', 'backlog'), { recursive: true })
      await writeFile(join(dir, '.uranus', 'backlog', 'quebrado.yaml'), '{{{ inválido')

      const items = await store.list()
      expect(items).toHaveLength(1)
    })
  })
})
