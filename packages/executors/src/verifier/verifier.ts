import type {
  Check,
  CheckImpl,
  CheckKind,
  CheckRegistry,
  CheckResult,
  Clock,
  Logger,
  Verification,
  Verifier,
  VerifyInput,
} from '@uranus/core'
import { isEnforceable } from '@uranus/core'
import { diagnose } from '../diagnosis/classifier.js'

export class DefaultCheckRegistry implements CheckRegistry {
  private readonly impls = new Map<string, CheckImpl>()

  register(impl: CheckImpl): void {
    // Plugins registram por (kind, id); o builtin é o fallback do kind.
    this.impls.set(`${impl.kind}:${impl.id}`, impl)
  }

  get(kind: CheckKind, id = 'builtin'): CheckImpl | undefined {
    return this.impls.get(`${kind}:${id}`) ?? this.impls.get(`${kind}:builtin`)
  }

  list(): readonly CheckImpl[] {
    return [...this.impls.values()]
  }
}

export interface DefaultVerifierOptions {
  readonly checks: CheckRegistry
  readonly clock: Clock
  readonly logger: Logger
}

/**
 * O árbitro do INV-2. Executa cada check do contrato; o veredito agregado é
 * "todos os bloqueantes passaram". Nenhuma outra parte do sistema tem opinião.
 *
 * Ordem de execução: sequencial, na ordem do contrato, com curto-circuito de
 * checks **caros** apenas quando um bloqueante barato já reprovou — mas todos os
 * resultados obtidos são preservados. Rodar `pnpm test` depois que o `diff`
 * reprovou por escopo seria gastar minutos para confirmar o que já se sabe.
 */
export class DefaultVerifier implements Verifier {
  private readonly checks: CheckRegistry
  private readonly clock: Clock
  private readonly logger: Logger

  constructor(options: DefaultVerifierOptions) {
    this.checks = options.checks
    this.clock = options.clock
    this.logger = options.logger.child({ component: 'verifier' })
  }

  async verify(input: VerifyInput, signal: AbortSignal): Promise<Verification> {
    const started = this.clock.monotonic()
    const results: CheckResult[] = []

    if (!isEnforceable(input.contract)) {
      // Contrato sem check bloqueante é ausência de verificação disfarçada.
      // Reprovar aqui é o que impede o falso done por contrato vazio.
      const verification: Verification = {
        passed: false,
        results: [
          {
            checkId: '<contract>',
            kind: 'command',
            passed: false,
            advisory: false,
            durationMs: 0,
            detail: { reason: 'contrato de aceite sem nenhum check bloqueante (INV-2)' },
          },
        ],
        durationMs: 0,
      }
      return { ...verification, diagnosis: diagnose(verification, input.task) }
    }

    // Baratos primeiro (diff/artifact/schema), caros depois (command/tests).
    const ordered = [...input.contract.checks].sort((a, b) => checkCost(a.kind) - checkCost(b.kind))

    let blockingFailed = false
    for (const check of ordered) {
      if (signal.aborted) break
      if (blockingFailed && checkCost(check.kind) >= 2 && check.advisory !== true) {
        results.push({
          checkId: check.id,
          kind: check.kind,
          passed: false,
          advisory: false,
          durationMs: 0,
          detail: { skipped: 'check bloqueante anterior já reprovou' },
        })
        continue
      }

      const impl = this.checks.get(check.kind, implIdOf(check))
      if (impl === undefined) {
        results.push({
          checkId: check.id,
          kind: check.kind,
          passed: false,
          advisory: check.advisory === true,
          durationMs: 0,
          detail: { reason: `nenhuma implementação registrada para o check "${check.kind}"` },
        })
        if (check.advisory !== true) blockingFailed = true
        continue
      }

      const result = await impl.run(check, input, signal)
      results.push(result)
      if (!result.passed && !result.advisory) blockingFailed = true

      this.logger.debug('Check executado', {
        checkId: check.id,
        kind: check.kind,
        passed: result.passed,
      })
    }

    const passed = results.every((r) => r.advisory || r.passed)
    const verification: Verification = {
      passed,
      results,
      durationMs: Math.round(this.clock.monotonic() - started),
    }
    return passed
      ? verification
      : { ...verification, diagnosis: diagnose(verification, input.task) }
  }
}

function implIdOf(check: Check): string {
  return check.kind === 'plugin' ? check.check : 'builtin'
}

function checkCost(kind: CheckKind): number {
  switch (kind) {
    case 'diff':
    case 'artifact':
    case 'schema':
      return 0
    case 'plugin':
      return 1
    case 'command':
    case 'coverage':
    case 'tests':
      return 2
  }
}
