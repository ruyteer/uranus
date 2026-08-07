import { describe, expect, it } from 'vitest'
import { silentLogger, systemClock, unwrap } from '@uranus/core'
import type { DiffCheck, Task, VerifyInput, Workspace } from '@uranus/core'
import { makeTask, withTempDir } from '@uranus/testkit'
import { OutputCollector } from './shell/output.js'
import { DefaultShellRunner } from './shell/runner.js'
import { DefaultCheckRegistry, DefaultVerifier } from './verifier/verifier.js'
import {
  artifactCheckImpl,
  commandCheckImpl,
  evaluateDiff,
  schemaCheckImpl,
} from './verifier/checks.js'
import { categorizeCheck, diagnose } from './diagnosis/classifier.js'

const NEVER = new AbortController().signal

function runner(): DefaultShellRunner {
  return new DefaultShellRunner({ clock: systemClock, logger: silentLogger })
}

function fakeWorkspace(rootDir: string, task: Task): Workspace {
  return {
    id: 'wsp_x' as Workspace['id'],
    taskId: task.id,
    rootDir,
    branch: 'test',
    baseCommit: 'abc',
    ownedPaths: task.touches,
    createdAt: 0,
  }
}

describe('OutputCollector', () => {
  it('não trunca abaixo do teto', () => {
    const collector = new OutputCollector(1_000)
    collector.push(Buffer.from('abc'))
    collector.push(Buffer.from('def'))
    expect(collector.toString()).toBe('abcdef')
    expect(collector.truncated).toBe(false)
  })

  it('preserva início e fim ao estourar', () => {
    const collector = new OutputCollector(100)
    collector.push(Buffer.from('INICIO-'))
    collector.push(Buffer.from('x'.repeat(500)))
    collector.push(Buffer.from('-FIM'))
    const text = collector.toString()
    expect(collector.truncated).toBe(true)
    expect(text.startsWith('INICIO-')).toBe(true)
    expect(text.endsWith('-FIM')).toBe(true)
    expect(text).toContain('truncada')
  })
})

describe('DefaultShellRunner', () => {
  it('executa comando e captura stdout', async () => {
    const result = await runner().run(
      {
        command: 'node',
        args: ['-e', 'console.log("ola"); process.exit(0)'],
        cwd: process.cwd(),
        timeoutMs: 15_000,
      },
      NEVER,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('ola')
    expect(result.timedOut).toBe(false)
  })

  it('propaga exit code e stderr', async () => {
    const result = await runner().run(
      {
        command: 'node',
        args: ['-e', 'console.error("quebrou"); process.exit(3)'],
        cwd: process.cwd(),
        timeoutMs: 15_000,
      },
      NEVER,
    )
    expect(result.exitCode).toBe(3)
    expect(result.stderr).toContain('quebrou')
  })

  it('comando inexistente vira exit 127, não exceção', async () => {
    const result = await runner().run(
      {
        command: 'comando-que-nao-existe-xyz',
        args: [],
        cwd: process.cwd(),
        timeoutMs: 15_000,
      },
      NEVER,
    )
    expect(result.exitCode).toBe(127)
  })

  it('mata a árvore ao estourar o timeout', async () => {
    const started = Date.now()
    const result = await runner().run(
      {
        command: 'node',
        args: ['-e', 'setTimeout(() => {}, 60000)'],
        cwd: process.cwd(),
        timeoutMs: 1_500,
      },
      NEVER,
    )
    expect(result.timedOut).toBe(true)
    expect(Date.now() - started).toBeLessThan(15_000)
  }, 20_000)

  it('shell: true interpreta a linha via shell da plataforma', async () => {
    const result = await runner().run(
      { command: 'node -e "console.log(1+1)"', cwd: process.cwd(), timeoutMs: 15_000, shell: true },
      NEVER,
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('2')
  })

  it('redige segredos conhecidos no stdout (R12)', async () => {
    const result = await runner().run(
      {
        command: 'node',
        args: ['-e', 'console.log("token: ghp_abcdefghijklmnopqrstuvwx")'],
        cwd: process.cwd(),
        timeoutMs: 15_000,
      },
      NEVER,
    )
    expect(result.stdout).not.toContain('ghp_abcdefghijklmnopqrstuvwx')
    expect(result.stdout).toContain('[REDACTED]')
  })
})

describe('checks', () => {
  it('command check compara exit code', async () => {
    await withTempDir(async (dir) => {
      const task = makeTask()
      const input: VerifyInput = {
        contract: task.acceptance,
        workspace: fakeWorkspace(dir, task),
        task,
      }
      const impl = commandCheckImpl(runner())
      const passing = await impl.run(
        { kind: 'command', id: 'ok', run: 'node -e "process.exit(0)"', timeoutMs: 15_000 },
        input,
        NEVER,
      )
      expect(passing.passed).toBe(true)

      const failing = await impl.run(
        { kind: 'command', id: 'bad', run: 'node -e "process.exit(1)"', timeoutMs: 15_000 },
        input,
        NEVER,
      )
      expect(failing.passed).toBe(false)
      expect(failing.exitCode).toBe(1)

      const custom = await impl.run(
        {
          kind: 'command',
          id: 'x',
          run: 'node -e "process.exit(7)"',
          timeoutMs: 15_000,
          expectExit: 7,
        },
        input,
        NEVER,
      )
      expect(custom.passed).toBe(true)
    })
  })

  it('artifact check valida existência e conteúdo', async () => {
    await withTempDir(async (dir) => {
      const fs = await import('node:fs/promises')
      const path = await import('node:path')
      const join = (...parts: string[]): string => path.join(...parts)
      await fs.writeFile(join(dir, 'saida.txt'), 'resultado: 42\n')

      const task = makeTask()
      const input: VerifyInput = {
        contract: task.acceptance,
        workspace: fakeWorkspace(dir, task),
        task,
      }
      const impl = artifactCheckImpl()

      expect(
        (
          await impl.run(
            { kind: 'artifact', id: 'a', path: 'saida.txt', mustExist: true, timeoutMs: 1_000 },
            input,
            NEVER,
          )
        ).passed,
      ).toBe(true)
      expect(
        (
          await impl.run(
            {
              kind: 'artifact',
              id: 'b',
              path: 'saida.txt',
              mustExist: true,
              matches: 'resultado: \\d+',
              timeoutMs: 1_000,
            },
            input,
            NEVER,
          )
        ).passed,
      ).toBe(true)
      expect(
        (
          await impl.run(
            {
              kind: 'artifact',
              id: 'c',
              path: 'nao-existe.txt',
              mustExist: true,
              timeoutMs: 1_000,
            },
            input,
            NEVER,
          )
        ).passed,
      ).toBe(false)
      expect(
        (
          await impl.run(
            { kind: 'artifact', id: 'd', path: 'saida.txt', mustExist: false, timeoutMs: 1_000 },
            input,
            NEVER,
          )
        ).passed,
      ).toBe(false)
    })
  })

  it('schema check valida a saída estruturada', async () => {
    const task = makeTask()
    const base: Omit<VerifyInput, 'structuredOutput'> = {
      contract: task.acceptance,
      workspace: fakeWorkspace('/tmp', task),
      task,
    }
    const impl = schemaCheckImpl()
    const schema = {
      type: 'object',
      properties: { verdict: { type: 'string' } },
      required: ['verdict'],
    }

    const valid = await impl.run(
      { kind: 'schema', id: 's', schema, timeoutMs: 1_000 },
      { ...base, structuredOutput: { verdict: 'ok' } },
      NEVER,
    )
    expect(valid.passed).toBe(true)

    const invalid = await impl.run(
      { kind: 'schema', id: 's', schema, timeoutMs: 1_000 },
      { ...base, structuredOutput: { other: 1 } },
      NEVER,
    )
    expect(invalid.passed).toBe(false)

    const absent = await impl.run(
      { kind: 'schema', id: 's', schema, timeoutMs: 1_000 },
      base,
      NEVER,
    )
    expect(absent.passed).toBe(false)
  })

  describe('evaluateDiff (INV-5 / R1)', () => {
    const task = makeTask({ touches: ['src/**'] })
    const input: VerifyInput = {
      contract: task.acceptance,
      workspace: fakeWorkspace('/x', task),
      task,
    }
    const check: DiffCheck = { kind: 'diff', id: 'd', requireNonEmpty: true, timeoutMs: 1_000 }

    it('reprova diff vazio — o falso done clássico', () => {
      const result = evaluateDiff(
        check,
        input,
        { files: [], totalAdded: 0, totalRemoved: 0, isEmpty: true },
        0,
      )
      expect(result.passed).toBe(false)
      expect(categorizeCheck(result)).toBe('no-changes')
    })

    it('aprova diff dentro do escopo', () => {
      const result = evaluateDiff(
        check,
        input,
        {
          files: [{ path: 'src/a.ts', added: 5, removed: 1, status: 'modified' }],
          totalAdded: 5,
          totalRemoved: 1,
          isEmpty: false,
        },
        0,
      )
      expect(result.passed).toBe(true)
    })

    it('reprova arquivo fora do escopo declarado', () => {
      const result = evaluateDiff(
        check,
        input,
        {
          files: [
            { path: 'src/a.ts', added: 1, removed: 0, status: 'modified' },
            { path: '.github/workflows/ci.yml', added: 1, removed: 0, status: 'modified' },
          ],
          totalAdded: 2,
          totalRemoved: 0,
          isEmpty: false,
        },
        0,
      )
      expect(result.passed).toBe(false)
      expect(categorizeCheck(result)).toBe('out-of-scope')
    })

    it('ignora o marker do sandbox', () => {
      const result = evaluateDiff(
        check,
        input,
        {
          files: [{ path: '.uranus-workspace.json', added: 5, removed: 0, status: 'untracked' }],
          totalAdded: 5,
          totalRemoved: 0,
          isEmpty: false,
        },
        0,
      )
      // Só o marker = diff efetivamente vazio.
      expect(result.passed).toBe(false)
    })

    it('aplica limites de tamanho', () => {
      const big = evaluateDiff(
        { ...check, maxFiles: 1, requireNonEmpty: false },
        input,
        {
          files: [
            { path: 'src/a.ts', added: 1, removed: 0, status: 'modified' },
            { path: 'src/b.ts', added: 1, removed: 0, status: 'modified' },
          ],
          totalAdded: 2,
          totalRemoved: 0,
          isEmpty: false,
        },
        0,
      )
      expect(big.passed).toBe(false)
    })
  })
})

describe('DefaultVerifier', () => {
  it('reprova contrato sem check bloqueante (INV-2)', async () => {
    const registry = new DefaultCheckRegistry()
    const verifier = new DefaultVerifier({
      checks: registry,
      clock: systemClock,
      logger: silentLogger,
    })
    const task = makeTask({ acceptance: { checks: [], requireAll: true } })

    const verification = await verifier.verify(
      { contract: task.acceptance, workspace: fakeWorkspace('/x', task), task },
      NEVER,
    )
    expect(verification.passed).toBe(false)
    expect(verification.diagnosis).toBeDefined()
  })

  it('executa checks e agrega o veredito', async () => {
    await withTempDir(async (dir) => {
      const registry = new DefaultCheckRegistry()
      registry.register(commandCheckImpl(runner()))
      registry.register(artifactCheckImpl())
      const verifier = new DefaultVerifier({
        checks: registry,
        clock: systemClock,
        logger: silentLogger,
      })

      const task = makeTask()
      const contract = {
        checks: [
          {
            kind: 'command' as const,
            id: 'ok',
            run: 'node -e "process.exit(0)"',
            timeoutMs: 15_000,
          },
          {
            kind: 'artifact' as const,
            id: 'missing',
            path: 'x.txt',
            mustExist: true,
            timeoutMs: 1_000,
          },
        ],
        requireAll: true,
      }
      const verification = await verifier.verify(
        { contract, workspace: fakeWorkspace(dir, task), task },
        NEVER,
      )
      expect(verification.passed).toBe(false)
      expect(verification.results).toHaveLength(2)
      // artifact (barato) roda antes de command (caro).
      expect(verification.results[0]!.kind).toBe('artifact')
    })
  })

  it('pula checks caros quando um bloqueante barato já reprovou', async () => {
    await withTempDir(async (dir) => {
      const registry = new DefaultCheckRegistry()
      registry.register(commandCheckImpl(runner()))
      registry.register(artifactCheckImpl())
      const verifier = new DefaultVerifier({
        checks: registry,
        clock: systemClock,
        logger: silentLogger,
      })

      const task = makeTask()
      const contract = {
        checks: [
          {
            kind: 'artifact' as const,
            id: 'gate',
            path: 'nao-existe',
            mustExist: true,
            timeoutMs: 1_000,
          },
          {
            kind: 'command' as const,
            id: 'caro',
            run: 'node -e "process.exit(0)"',
            timeoutMs: 15_000,
          },
        ],
        requireAll: true,
      }
      const verification = await verifier.verify(
        { contract, workspace: fakeWorkspace(dir, task), task },
        NEVER,
      )
      const skipped = verification.results.find((r) => r.checkId === 'caro')
      expect(skipped?.passed).toBe(false)
      expect(skipped?.detail?.['skipped']).toBeDefined()
    })
  })

  it('check advisory não bloqueia', async () => {
    await withTempDir(async (dir) => {
      const registry = new DefaultCheckRegistry()
      registry.register(commandCheckImpl(runner()))
      const verifier = new DefaultVerifier({
        checks: registry,
        clock: systemClock,
        logger: silentLogger,
      })

      const task = makeTask()
      const contract = {
        checks: [
          {
            kind: 'command' as const,
            id: 'ok',
            run: 'node -e "process.exit(0)"',
            timeoutMs: 15_000,
          },
          {
            kind: 'command' as const,
            id: 'opiniao',
            run: 'node -e "process.exit(1)"',
            timeoutMs: 15_000,
            advisory: true,
          },
        ],
        requireAll: true,
      }
      const verification = await verifier.verify(
        { contract, workspace: fakeWorkspace(dir, task), task },
        NEVER,
      )
      expect(verification.passed).toBe(true)
    })
  })
})

describe('classifier (R3)', () => {
  it('categoriza por padrão de stderr', () => {
    expect(
      categorizeCheck({
        checkId: 'x',
        kind: 'command',
        passed: false,
        advisory: false,
        durationMs: 0,
        stderr: "error TS2322: Type 'string' is not assignable",
      }),
    ).toBe('type-error')
    expect(
      categorizeCheck({
        checkId: 'x',
        kind: 'command',
        passed: false,
        advisory: false,
        durationMs: 0,
        stderr: 'SyntaxError: Unexpected token',
      }),
    ).toBe('compile-error')
    expect(
      categorizeCheck({
        checkId: 'x',
        kind: 'command',
        passed: false,
        advisory: false,
        durationMs: 0,
        stdout: '3 failed | 10 passed',
      }),
    ).toBe('test-failure')
  })

  it('timeout e exit 127 têm categorias próprias', () => {
    expect(
      categorizeCheck({
        checkId: 'x',
        kind: 'command',
        passed: false,
        advisory: false,
        durationMs: 0,
        detail: { timedOut: true },
      }),
    ).toBe('timeout')
    expect(
      categorizeCheck({
        checkId: 'x',
        kind: 'command',
        passed: false,
        advisory: false,
        durationMs: 0,
        exitCode: 127,
      }),
    ).toBe('compile-error')
  })

  it('diagnose agrega evidência e sugere ação', () => {
    const task = makeTask()
    const diagnosis = diagnose(
      {
        passed: false,
        durationMs: 10,
        results: [
          {
            checkId: 'tests',
            kind: 'tests',
            passed: false,
            advisory: false,
            durationMs: 10,
            stderr: 'AssertionError: expected 1 to be 2',
          },
        ],
      },
      task,
    )
    expect(diagnosis.category).toBe('test-failure')
    expect(diagnosis.suggestedAction).toBe('retry-with-context')
    expect(diagnosis.evidence.length).toBeGreaterThan(0)
    expect(unwrap({ ok: true, value: diagnosis.summary })).toContain('tests')
  })

  it('no-changes sugere retry com contexto; segunda vez fora de escopo sugere replan', () => {
    const task = makeTask({ attempts: 1 })
    const diagnosis = diagnose(
      {
        passed: false,
        durationMs: 0,
        results: [
          {
            checkId: 'd',
            kind: 'diff',
            passed: false,
            advisory: false,
            durationMs: 0,
            detail: { problems: ['diff fora do escopo declarado: ci.yml'] },
          },
        ],
      },
      task,
    )
    expect(diagnosis.category).toBe('out-of-scope')
    expect(diagnosis.suggestedAction).toBe('replan')
  })
})
