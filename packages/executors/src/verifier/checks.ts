import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Ajv } from 'ajv'
import type {
  ArtifactCheck,
  CheckImpl,
  CheckResult,
  CommandCheck,
  DiffCheck,
  DiffSummary,
  SchemaCheck,
  ShellRunner,
  TestsCheck,
  VcsAdapter,
  VerifyInput,
} from '@uranus/core'
import { matchesAny, pathsOutsideScope, truncateMiddle } from '@uranus/core'

const OUTPUT_EXCERPT = 8_000

function excerpt(text: string): string {
  return truncateMiddle(text, OUTPUT_EXCERPT)
}

// ── command ─────────────────────────────────────────────────────────────────

export function commandCheckImpl(shell: ShellRunner): CheckImpl<CommandCheck> {
  return {
    id: 'builtin',
    kind: 'command',
    async run(check, input, signal): Promise<CheckResult> {
      const result = await shell.run(
        {
          command: check.run,
          cwd: check.cwd ?? input.workspace.rootDir,
          env: check.env ?? {},
          timeoutMs: check.timeoutMs,
          shell: true,
        },
        signal,
      )
      const expected = check.expectExit ?? 0
      return {
        checkId: check.id,
        kind: 'command',
        passed: result.exitCode === expected && !result.timedOut,
        advisory: check.advisory === true,
        durationMs: result.durationMs,
        exitCode: result.exitCode,
        stdout: excerpt(result.stdout),
        stderr: excerpt(result.stderr),
        ...(result.timedOut ? { detail: { timedOut: true } } : {}),
      }
    },
  }
}

// ── tests ───────────────────────────────────────────────────────────────────

/** Resolve o id do runner para o comando concreto (vem da config do projeto). */
export type TestCommandResolver = (runner: string) => string | undefined

export function testsCheckImpl(
  shell: ShellRunner,
  vcs: VcsAdapter,
  resolve: TestCommandResolver,
  testGlobs: readonly string[] = ['**/*.test.*', '**/*.spec.*', '**/test/**', '**/tests/**'],
): CheckImpl<TestsCheck> {
  return {
    id: 'builtin',
    kind: 'tests',
    async run(check, input, signal): Promise<CheckResult> {
      const command = resolve(check.runner)
      if (command === undefined) {
        return {
          checkId: check.id,
          kind: 'tests',
          passed: false,
          advisory: check.advisory === true,
          durationMs: 0,
          detail: { reason: `Runner de testes desconhecido: ${check.runner}` },
        }
      }

      const result = await shell.run(
        {
          command,
          cwd: input.workspace.rootDir,
          timeoutMs: check.timeoutMs,
          shell: true,
          env: { CI: 'true' },
        },
        signal,
      )

      let passed = result.exitCode === 0 && !result.timedOut
      const detail: Record<string, unknown> = {}

      // "Implementou sem testar" — o segundo caminho mais comum para um falso
      // done. Exigimos que o diff contenha ao menos um arquivo de teste.
      if (passed && check.requireNewTests === true) {
        const diff = await vcs.diff(input.workspace.rootDir, {
          base: input.workspace.baseCommit,
          includeUntracked: true,
        })
        if (diff.ok) {
          const touchedTests = diff.value.files.some((f) => matchesAny(f.path, testGlobs))
          if (!touchedTests) {
            passed = false
            detail['reason'] = 'requireNewTests: o diff não contém nenhum arquivo de teste'
          }
        }
      }

      if (passed && check.forbidSkipped === true && /\bskipped|pending\b/i.test(result.stdout)) {
        passed = false
        detail['reason'] = 'forbidSkipped: a suíte contém testes pulados'
      }

      return {
        checkId: check.id,
        kind: 'tests',
        passed,
        advisory: check.advisory === true,
        durationMs: result.durationMs,
        exitCode: result.exitCode,
        stdout: excerpt(result.stdout),
        stderr: excerpt(result.stderr),
        ...(Object.keys(detail).length > 0 ? { detail } : {}),
      }
    },
  }
}

// ── diff ────────────────────────────────────────────────────────────────────

export function diffCheckImpl(vcs: VcsAdapter): CheckImpl<DiffCheck> {
  return {
    id: 'builtin',
    kind: 'diff',
    async run(check, input, _signal): Promise<CheckResult> {
      const started = Date.now()
      const diff = await vcs.diff(input.workspace.rootDir, {
        base: input.workspace.baseCommit,
        includeUntracked: true,
      })
      if (!diff.ok) {
        return {
          checkId: check.id,
          kind: 'diff',
          passed: false,
          advisory: check.advisory === true,
          durationMs: Date.now() - started,
          detail: { reason: `git diff falhou: ${diff.error.message}` },
        }
      }
      return evaluateDiff(check, input, diff.value, Date.now() - started)
    },
  }
}

/** Separado e puro para ser testável sem git. */
export function evaluateDiff(
  check: DiffCheck,
  input: VerifyInput,
  diff: DiffSummary,
  durationMs: number,
): CheckResult {
  const problems: string[] = []
  // O marker do sandbox não é obra do agente.
  const files = diff.files.filter((f) => f.path !== '.uranus-workspace.json')
  const effective: DiffSummary = { ...diff, files, isEmpty: files.length === 0 }

  if (check.requireNonEmpty === true && effective.isEmpty) {
    // R1: o modelo declarou sucesso sem alterar arquivo nenhum.
    problems.push('diff vazio — nenhum arquivo foi alterado')
  }
  if (check.maxFiles !== undefined && files.length > check.maxFiles) {
    problems.push(`diff toca ${files.length} arquivos (máximo ${check.maxFiles})`)
  }
  const totalLines = effective.totalAdded + effective.totalRemoved
  if (check.maxLines !== undefined && totalLines > check.maxLines) {
    problems.push(`diff altera ${totalLines} linhas (máximo ${check.maxLines})`)
  }
  if (check.forbidPaths !== undefined && check.forbidPaths.length > 0) {
    const forbidden = files.filter((f) => matchesAny(f.path, check.forbidPaths!))
    if (forbidden.length > 0) {
      problems.push(`diff toca caminhos proibidos: ${forbidden.map((f) => f.path).join(', ')}`)
    }
  }
  // Default: o escopo declarado da task (INV-5).
  const scope = check.requirePathsWithin ?? input.task.touches
  const outside = pathsOutsideScope(effective, scope, matchesAny)
  if (outside.length > 0) {
    problems.push(`diff fora do escopo declarado: ${outside.join(', ')}`)
  }

  return {
    checkId: check.id,
    kind: 'diff',
    passed: problems.length === 0,
    advisory: check.advisory === true,
    durationMs,
    detail: {
      files: files.length,
      added: effective.totalAdded,
      removed: effective.totalRemoved,
      ...(problems.length > 0 ? { problems } : {}),
    },
  }
}

// ── artifact ────────────────────────────────────────────────────────────────

export function artifactCheckImpl(): CheckImpl<ArtifactCheck> {
  return {
    id: 'builtin',
    kind: 'artifact',
    async run(check, input, _signal): Promise<CheckResult> {
      const started = Date.now()
      const path = join(input.workspace.rootDir, check.path)
      let content: string | undefined
      try {
        content = await readFile(path, 'utf8')
      } catch {
        content = undefined
      }

      let passed: boolean
      let reason: string | undefined
      if (check.mustExist) {
        passed = content !== undefined
        if (!passed) reason = `artefato ausente: ${check.path}`
        if (passed && check.matches !== undefined) {
          passed = new RegExp(check.matches, 'm').test(content!)
          if (!passed) reason = `artefato não casa com /${check.matches}/`
        }
      } else {
        passed = content === undefined
        if (!passed) reason = `artefato não deveria existir: ${check.path}`
      }

      return {
        checkId: check.id,
        kind: 'artifact',
        passed,
        advisory: check.advisory === true,
        durationMs: Date.now() - started,
        ...(reason === undefined ? {} : { detail: { reason } }),
      }
    },
  }
}

// ── schema ──────────────────────────────────────────────────────────────────

export function schemaCheckImpl(): CheckImpl<SchemaCheck> {
  const ajv = new Ajv({ allErrors: true, strict: false })
  return {
    id: 'builtin',
    kind: 'schema',
    run(check, input, _signal): Promise<CheckResult> {
      const started = Date.now()
      if (input.structuredOutput === undefined) {
        return Promise.resolve({
          checkId: check.id,
          kind: 'schema',
          passed: false,
          advisory: check.advisory === true,
          durationMs: Date.now() - started,
          detail: { reason: 'agente não produziu saída estruturada' },
        })
      }
      const validate = ajv.compile(check.schema)
      const passed = validate(input.structuredOutput)
      return Promise.resolve({
        checkId: check.id,
        kind: 'schema',
        passed,
        advisory: check.advisory === true,
        durationMs: Date.now() - started,
        ...(passed
          ? {}
          : {
              detail: {
                errors: (validate.errors ?? []).map(
                  (e) => `${e.instancePath || '<raiz>'} ${e.message ?? ''}`,
                ),
              },
            }),
      })
    },
  }
}
