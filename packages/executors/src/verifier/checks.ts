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
  ValidationPolicy,
  ValidationRule,
  VcsAdapter,
  VerifyInput,
} from '@uranus/core'
import {
  DEFAULT_VALIDATION_POLICY,
  isRuleEnabled,
  matchesAny,
  pathsOutsideScope,
  severityOf,
  truncateMiddle,
} from '@uranus/core'

const OUTPUT_EXCERPT = 8_000

function excerpt(text: string): string {
  return truncateMiddle(text, OUTPUT_EXCERPT)
}

/**
 * Balde de achados de um check, separados pelo que a política mandou fazer com
 * eles: `problems` reprova, `warnings` só informa.
 */
interface Findings {
  readonly problems: string[]
  readonly warnings: string[]
}

/**
 * Encaminha um achado conforme a severidade configurada para a regra.
 *
 * Trata `off` aqui também, e não só no ponto de detecção, porque cada detecção
 * é guardada por `isRuleEnabled` para não pagar o custo de varrer o diff — mas
 * uma guarda esquecida vira permissividade silenciosa, e este é o lugar barato
 * de fechar essa porta.
 */
function record(
  findings: Findings,
  policy: ValidationPolicy,
  rule: ValidationRule,
  message: string,
): void {
  const severity = severityOf(policy, rule)
  if (severity === 'off') return
  if (severity === 'blocking') findings.problems.push(message)
  else findings.warnings.push(message)
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

/**
 * Detecta testes pulados/pendentes de verdade a partir da SAÍDA do runner —
 * exige um número positivo adjacente à palavra, nunca só a palavra sozinha.
 * `/\bskipped|pending\b/i` (a versão anterior) casava a linha de resumo que o
 * `node --test` sempre imprime (`ℹ skipped 0`), reprovando toda suíte 100%
 * verde que usa esse runner — falso positivo, não falso negativo.
 */
function hasSkippedTests(output: string): boolean {
  // `[ \t]`, nunca `\s` — `\s` inclui quebra de linha, e isso casaria um
  // número de uma linha totalmente diferente com "skipped"/"pending" da
  // linha seguinte (ex.: "pass 1\nskipped 0" "casaria" o "1" de "pass 1").
  const patterns = [
    /\b(\d+)[ \t]+(?:skipped|pending)\b/i, // "3 skipped", "2 pending" (mocha, jest)
    /\b(?:skipped|pending)[ \t:]+(\d+)/i, // "skipped: 3", "skipped 3" (node --test)
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(output)
    if (match !== null && Number(match[1]) > 0) return true
  }
  return false
}

/** Resolve o id do runner para o comando concreto (vem da config do projeto). */
export type TestCommandResolver = (runner: string) => string | undefined

export function testsCheckImpl(
  shell: ShellRunner,
  vcs: VcsAdapter,
  resolve: TestCommandResolver,
  testGlobs: readonly string[] = ['**/*.test.*', '**/*.spec.*', '**/test/**', '**/tests/**'],
  policy: ValidationPolicy = DEFAULT_VALIDATION_POLICY,
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
      const findings: Findings = { problems: [], warnings: [] }

      // "Implementou sem testar" — o segundo caminho mais comum para um falso
      // done. Exigimos que o diff contenha ao menos um arquivo de teste.
      if (passed && check.requireNewTests === true && isRuleEnabled(policy, 'requireNewTests')) {
        const diff = await vcs.diff(input.workspace.rootDir, {
          base: input.workspace.baseCommit,
          includeUntracked: true,
        })
        if (diff.ok) {
          const touchedTests = diff.value.files.some((f) => matchesAny(f.path, testGlobs))
          if (!touchedTests) {
            record(
              findings,
              policy,
              'requireNewTests',
              'requireNewTests: o diff não contém nenhum arquivo de teste',
            )
            passed = findings.problems.length === 0
          }
        }
      }

      if (
        passed &&
        check.forbidSkipped === true &&
        isRuleEnabled(policy, 'forbidSkipped') &&
        hasSkippedTests(result.stdout)
      ) {
        record(findings, policy, 'forbidSkipped', 'forbidSkipped: a suíte contém testes pulados')
        passed = findings.problems.length === 0
      }

      // `reason` é singular por compatibilidade com quem já lê esse campo; fica
      // com o primeiro bloqueio, que é também o único capaz de derrubar o check.
      const [reason] = findings.problems
      if (reason !== undefined) detail['reason'] = reason
      if (findings.warnings.length > 0) detail['warnings'] = findings.warnings

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

export function diffCheckImpl(
  vcs: VcsAdapter,
  policy: ValidationPolicy = DEFAULT_VALIDATION_POLICY,
): CheckImpl<DiffCheck> {
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
      return evaluateDiff(check, input, diff.value, Date.now() - started, policy)
    },
  }
}

/**
 * Separado e puro para ser testável sem git.
 *
 * Cada achado consulta a `ValidationPolicy` pela regra que o descreve. Em `off`
 * a detecção nem roda: `pathsOutsideScope` e o casamento de globs varrem o diff
 * inteiro, e desligar a regra tem que significar não pagar por ela.
 */
export function evaluateDiff(
  check: DiffCheck,
  input: VerifyInput,
  diff: DiffSummary,
  durationMs: number,
  policy: ValidationPolicy = DEFAULT_VALIDATION_POLICY,
): CheckResult {
  const findings: Findings = { problems: [], warnings: [] }
  // O marker do sandbox não é obra do agente.
  const files = diff.files.filter((f) => f.path !== '.uranus-workspace.json')
  const effective: DiffSummary = { ...diff, files, isEmpty: files.length === 0 }

  if (check.requireNonEmpty === true && isRuleEnabled(policy, 'emptyDiff') && effective.isEmpty) {
    // R1: o modelo declarou sucesso sem alterar arquivo nenhum.
    record(findings, policy, 'emptyDiff', 'diff vazio — nenhum arquivo foi alterado')
  }
  if (isRuleEnabled(policy, 'diffSize')) {
    if (check.maxFiles !== undefined && files.length > check.maxFiles) {
      record(
        findings,
        policy,
        'diffSize',
        `diff toca ${files.length} arquivos (máximo ${check.maxFiles})`,
      )
    }
    const totalLines = effective.totalAdded + effective.totalRemoved
    if (check.maxLines !== undefined && totalLines > check.maxLines) {
      record(
        findings,
        policy,
        'diffSize',
        `diff altera ${totalLines} linhas (máximo ${check.maxLines})`,
      )
    }
  }
  const forbidPaths = check.forbidPaths
  if (
    forbidPaths !== undefined &&
    forbidPaths.length > 0 &&
    isRuleEnabled(policy, 'forbiddenPaths')
  ) {
    const forbidden = files.filter((f) => matchesAny(f.path, forbidPaths))
    if (forbidden.length > 0) {
      record(
        findings,
        policy,
        'forbiddenPaths',
        `diff toca caminhos proibidos: ${forbidden.map((f) => f.path).join(', ')}`,
      )
    }
  }
  if (isRuleEnabled(policy, 'scope')) {
    // Default: o escopo declarado da task (INV-5).
    const scope = check.requirePathsWithin ?? input.task.touches
    const outside = pathsOutsideScope(effective, scope, matchesAny)
    if (outside.length > 0) {
      record(findings, policy, 'scope', `diff fora do escopo declarado: ${outside.join(', ')}`)
    }
  }

  return {
    checkId: check.id,
    kind: 'diff',
    passed: findings.problems.length === 0,
    advisory: check.advisory === true,
    durationMs,
    detail: {
      files: files.length,
      added: effective.totalAdded,
      removed: effective.totalRemoved,
      ...(findings.problems.length > 0 ? { problems: findings.problems } : {}),
      ...(findings.warnings.length > 0 ? { warnings: findings.warnings } : {}),
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
