import { describe, expect, it } from 'vitest'
import { newTaskId } from '../ids.js'
import {
  blockingChecks,
  contractTimeoutMs,
  isBlocking,
  isEnforceable,
  type Check,
} from './acceptance.js'
import {
  admitBudget,
  consumeBudget,
  emptyWindow,
  isBudgetExhausted,
  remainingBudget,
  resetTaskWindow,
  type BudgetState,
} from './budget.js'
import { failureHistory, isOscillating, repeatedLastCategory, type Attempt } from './attempt.js'
import { isRestrictedMode, verificationSignalStrength, type ProjectDigest } from './context.js'
import { compareForRetention, isActiveMemory, type MemoryRecord } from './memory.js'
import { DENY_ALL, intersectAll, intersectPermissions, type PermissionSet } from './permission.js'
import {
  dependenciesSatisfied,
  hasAttemptsLeft,
  taskGroup,
  taskGroupLabel,
  taskStateGroup,
  taskStateLabel,
  type Task,
  type TaskGroup,
  type TaskState,
} from './task.js'
import {
  DEFAULT_VALIDATION_POLICY,
  VALIDATION_RULES,
  isBlockingRule,
  isRuleEnabled,
  isValidationRule,
  resolveValidationPolicy,
  severityOf,
} from './validation.js'
import {
  EMPTY_USAGE,
  ZERO_USD,
  addMoney,
  addUsage,
  compareMoney,
  formatMoney,
  moneyFromMicros,
  moneyToNumber,
  multiplyMoney,
  priceUsage,
  subtractMoney,
  sumMoney,
  sumUsage,
  totalTokens,
  usd,
} from './usage.js'
import { failedChecks, isRetryableCategory, passedBlocking } from './verification.js'
import { EMPTY_DIFF, pathsOutsideScope, summarizeDiff } from './vcs.js'
import { matchesAny } from '../util/glob.js'

describe('dinheiro em micro-unidades', () => {
  it('soma sem erro de ponto flutuante', () => {
    // 0.1 + 0.2 !== 0.3 em float. Em micros, é exato — e o BudgetGuard soma
    // milhares de vezes ao longo de um run de 8 horas.
    const total = addMoney(usd(0.1), usd(0.2))
    expect(total.micros).toBe(300_000)
    expect(moneyToNumber(total)).toBe(0.3)
  })

  it('opera subtração, multiplicação e comparação', () => {
    expect(subtractMoney(usd(1), usd(0.25)).micros).toBe(750_000)
    expect(multiplyMoney(usd(2), 1.5).micros).toBe(3_000_000)
    expect(compareMoney(usd(1), usd(2))).toBeLessThan(0)
    expect(compareMoney(usd(2), usd(2))).toBe(0)
  })

  it('soma listas a partir de zero', () => {
    expect(sumMoney([]).micros).toBe(0)
    expect(sumMoney([usd(1), usd(2)]).micros).toBe(3_000_000)
    expect(ZERO_USD.micros).toBe(0)
  })

  it('formata para exibição', () => {
    expect(formatMoney(usd(1.5), 2)).toBe('$1.50')
    expect(moneyFromMicros(1_500_000).micros).toBe(1_500_000)
  })

  it('precifica uso real por categoria de token', () => {
    const cost = priceUsage(
      { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
      {
        model: 'm',
        inputPerMillion: 3,
        outputPerMillion: 15,
        cacheReadPerMillion: 0.3,
        cacheWritePerMillion: 3.75,
        effectiveFrom: 0,
      },
    )
    expect(moneyToNumber(cost)).toBeCloseTo(3, 6)
  })
})

describe('uso de tokens', () => {
  it('soma e totaliza todas as categorias', () => {
    const a = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, reasoning: 5 }
    expect(addUsage(EMPTY_USAGE, a)).toEqual(a)
    expect(totalTokens(a)).toBe(15)
    expect(sumUsage([a, a]).input).toBe(2)
    expect(sumUsage([])).toEqual(EMPTY_USAGE)
  })
})

describe('contrato de aceite (INV-2)', () => {
  const blocking: Check = { kind: 'command', id: 'b', run: 'x', timeoutMs: 1_000 }
  const advisory: Check = { kind: 'command', id: 'a', run: 'x', timeoutMs: 2_000, advisory: true }

  it('separa checks bloqueantes de consultivos', () => {
    expect(isBlocking(blocking)).toBe(true)
    expect(isBlocking(advisory)).toBe(false)
    expect(blockingChecks({ checks: [blocking, advisory], requireAll: true })).toEqual([blocking])
  })

  it('contrato só com checks consultivos não é executável', () => {
    // Um contrato assim aprovaria qualquer coisa — é a ausência de verificação
    // disfarçada de verificação.
    expect(isEnforceable({ checks: [advisory], requireAll: true })).toBe(false)
    expect(isEnforceable({ checks: [], requireAll: true })).toBe(false)
    expect(isEnforceable({ checks: [blocking], requireAll: true })).toBe(true)
  })

  it('soma os timeouts para dar o teto da fase de verificação', () => {
    expect(contractTimeoutMs({ checks: [blocking, advisory], requireAll: true })).toBe(3_000)
  })
})

describe('verificação', () => {
  it('checks consultivos não reprovam a verificação', () => {
    const verification = {
      passed: false,
      durationMs: 1,
      results: [
        { checkId: 'a', kind: 'command' as const, passed: false, advisory: true, durationMs: 1 },
        { checkId: 'b', kind: 'command' as const, passed: true, advisory: false, durationMs: 1 },
      ],
    }
    expect(passedBlocking(verification)).toBe(true)
    expect(failedChecks(verification)).toHaveLength(0)
  })

  it('um check bloqueante reprovado reprova tudo', () => {
    const verification = {
      passed: false,
      durationMs: 1,
      results: [
        { checkId: 'b', kind: 'tests' as const, passed: false, advisory: false, durationMs: 1 },
      ],
    }
    expect(passedBlocking(verification)).toBe(false)
    expect(failedChecks(verification)).toHaveLength(1)
  })

  it('categorias não resolvíveis por retry são identificadas', () => {
    expect(isRetryableCategory('test-failure')).toBe(true)
    expect(isRetryableCategory('budget')).toBe(false)
    expect(isRetryableCategory('permission-denied')).toBe(false)
    expect(isRetryableCategory('conflict')).toBe(false)
  })
})

describe('orçamento (INV-7)', () => {
  function state(): BudgetState {
    return {
      run: emptyWindow({ cost: usd(10), tokens: 100_000, wallclockMs: 60_000 }),
      task: emptyWindow({ cost: usd(2), tokens: 20_000, wallclockMs: 10_000 }),
      onExhausted: 'pause',
    }
  }

  it('admite estimativa que cabe', () => {
    const verdict = admitBudget(state(), { cost: usd(1), tokens: 1_000, wallclockMs: 1_000 })
    expect(verdict.admitted).toBe(true)
    expect(verdict.exceeded).toBeUndefined()
  })

  it('recusa antes de gastar quando a estimativa não cabe', () => {
    const verdict = admitBudget(state(), { cost: usd(5), tokens: 1_000, wallclockMs: 1_000 })
    expect(verdict.admitted).toBe(false)
    expect(verdict.exceeded).toEqual({ window: 'task', dimension: 'cost' })
  })

  it('recusa por token e por tempo, não só por dinheiro', () => {
    expect(
      admitBudget(state(), { cost: usd(0.1), tokens: 50_000, wallclockMs: 1 }).exceeded,
    ).toEqual({ window: 'task', dimension: 'tokens' })
    // 20s cabe na janela do run (60s) mas não na da task (10s).
    expect(
      admitBudget(state(), { cost: usd(0.1), tokens: 1, wallclockMs: 20_000 }).exceeded,
    ).toEqual({ window: 'task', dimension: 'wallclock' })
    // 999s não cabe nem no run — que é verificado primeiro.
    expect(
      admitBudget(state(), { cost: usd(0.1), tokens: 1, wallclockMs: 999_999 }).exceeded,
    ).toEqual({ window: 'run', dimension: 'wallclock' })
  })

  it('emite aviso ao cruzar o limiar antes do limite', () => {
    const verdict = admitBudget(state(), { cost: usd(1.9), tokens: 1, wallclockMs: 1 })
    expect(verdict.admitted).toBe(true)
    expect(verdict.warnings.some((w) => w.window === 'task' && w.dimension === 'cost')).toBe(true)
  })

  it('contabiliza o consumo real', () => {
    const consumed = consumeBudget(state().task, {
      usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
      cost: usd(0.5),
      wallclockMs: 1_000,
    })
    expect(consumed.usedTokens).toBe(150)
    expect(consumed.usedCost.micros).toBe(500_000)
    expect(remainingBudget(consumed).tokens).toBe(19_850)
  })

  it('detecta esgotamento por qualquer dimensão', () => {
    const base = state().task
    expect(isBudgetExhausted(base)).toBeUndefined()
    expect(isBudgetExhausted({ ...base, usedCost: usd(2) })).toBe('cost')
    expect(isBudgetExhausted({ ...base, usedTokens: 20_000 })).toBe('tokens')
    expect(isBudgetExhausted({ ...base, usedWallclockMs: 10_000 })).toBe('wallclock')
  })

  it('reinicia a janela por task sem tocar na do run', () => {
    const consumed: BudgetState = {
      ...state(),
      task: consumeBudget(state().task, {
        usage: EMPTY_USAGE,
        cost: usd(1),
        wallclockMs: 100,
      }),
    }
    const reset = resetTaskWindow(consumed)
    expect(reset.task.usedCost.micros).toBe(0)
    expect(reset.run.limits.cost.micros).toBe(consumed.run.limits.cost.micros)
  })
})

describe('permissões', () => {
  const wide: PermissionSet = {
    tools: { allow: ['*'], deny: [] },
    fs: { read: ['**'], write: ['**'], deny: [] },
    network: { allow: ['*'] },
    exec: { allow: ['*'] },
    secrets: { allow: ['*'] },
  }
  const narrow: PermissionSet = {
    tools: { allow: ['read_file', 'grep'], deny: ['write_file'] },
    fs: { read: ['src/**'], write: ['src/**'], deny: ['.env'] },
    network: false,
    exec: false,
    secrets: { allow: [] },
  }

  it('a interseção sempre restringe, nunca amplia', () => {
    const merged = intersectPermissions(wide, narrow)
    expect(merged.tools.allow).toEqual(['read_file', 'grep'])
    expect(merged.tools.deny).toContain('write_file')
    expect(merged.network).toBe(false)
    expect(merged.exec).toBe(false)
    expect(merged.fs.deny).toContain('.env')
  })

  it('é comutativa quanto ao resultado restritivo', () => {
    const ab = intersectPermissions(wide, narrow)
    const ba = intersectPermissions(narrow, wide)
    expect(ab.tools.allow.slice().sort()).toEqual(ba.tools.allow.slice().sort())
    expect(ab.network).toEqual(ba.network)
  })

  it('camada sem rede desliga a rede de todas', () => {
    const merged = intersectAll([wide, wide, narrow])
    expect(merged.network).toBe(false)
  })

  it('sem camadas, nada é permitido', () => {
    expect(intersectAll([])).toEqual(DENY_ALL)
  })

  it('interseção de duas redes permitidas mantém apenas o comum', () => {
    const a: PermissionSet = { ...wide, network: { allow: ['api.a.com', 'api.b.com'] } }
    const b: PermissionSet = { ...wide, network: { allow: ['api.b.com'] } }
    expect(intersectPermissions(a, b).network).toEqual({ allow: ['api.b.com'] })
  })
})

describe('task', () => {
  const base: Task = {
    id: newTaskId(),
    projectId: 'prj_x' as Task['projectId'],
    kind: 'feature',
    title: 't',
    intent: 'i',
    state: 'ready',
    priority: 1,
    deps: [],
    touches: [],
    acceptance: { checks: [], requireAll: true },
    attempts: 0,
    maxAttempts: 3,
    repairAttempts: 0,
    labels: [],
    createdAt: 0,
    updatedAt: 0,
  }

  it('conta tentativas restantes', () => {
    expect(hasAttemptsLeft(base)).toBe(true)
    expect(hasAttemptsLeft({ ...base, attempts: 3 })).toBe(false)
  })

  it('só considera dependências satisfeitas quando estão done', () => {
    const dep = newTaskId()
    const withDep = { ...base, deps: [dep] }
    const states = new Map<string, TaskState>([[dep, 'verified']])
    expect(dependenciesSatisfied(withDep, (id) => states.get(id))).toBe(false)
    states.set(dep, 'done')
    expect(dependenciesSatisfied(withDep, (id) => states.get(id))).toBe(true)
    expect(dependenciesSatisfied(base, () => undefined)).toBe(true)
  })

  it('agrupa os onze estados em quatro grupos de apresentação', () => {
    const byGroup = new Map<TaskGroup, TaskState[]>()
    const states: readonly TaskState[] = [
      'draft',
      'ready',
      'claimed',
      'running',
      'verifying',
      'verified',
      'failed',
      'integrating',
      'blocked',
      'done',
      'abandoned',
    ]
    for (const state of states) {
      const group = taskStateGroup(state)
      byGroup.set(group, [...(byGroup.get(group) ?? []), state])
    }
    expect(byGroup.get('queued')).toEqual(['draft', 'ready'])
    expect(byGroup.get('working')).toEqual([
      'claimed',
      'running',
      'verifying',
      'verified',
      'integrating',
    ])
    expect(byGroup.get('attention')).toEqual(['failed', 'blocked'])
    expect(byGroup.get('finished')).toEqual(['done', 'abandoned'])
    expect(taskGroup({ ...base, state: 'running' })).toBe('working')
  })

  it('rotula estado e grupo em pt-BR', () => {
    expect(taskStateLabel('verifying')).toBe('Verificando')
    expect(taskStateLabel('abandoned')).toBe('Abandonada')
    expect(taskGroupLabel('attention')).toBe('Precisa de você')
    expect(taskGroupLabel(taskGroup(base))).toBe('Na fila')
  })
})

describe('política de validação', () => {
  it('o default reproduz o comportamento histórico: tudo bloqueia', () => {
    // Deliberado. Projeto que já existe não pode ficar mais permissivo porque
    // alguém atualizou o Uranus — afrouxar é opt-in.
    for (const rule of VALIDATION_RULES) {
      expect(severityOf(DEFAULT_VALIDATION_POLICY, rule)).toBe('blocking')
      expect(isBlockingRule(DEFAULT_VALIDATION_POLICY, rule)).toBe(true)
    }
    expect(DEFAULT_VALIDATION_POLICY.countTowardAttempts).toBe(false)
    expect(DEFAULT_VALIDATION_POLICY.maxRepairAttempts).toBe(3)
  })

  it('advisory avisa sem reprovar; off nem avalia', () => {
    const policy = resolveValidationPolicy({ rules: { scope: 'advisory', diffSize: 'off' } })
    expect(severityOf(policy, 'scope')).toBe('advisory')
    expect(isBlockingRule(policy, 'scope')).toBe(false)
    expect(isRuleEnabled(policy, 'scope')).toBe(true)
    expect(isRuleEnabled(policy, 'diffSize')).toBe(false)
    // O que não foi declarado continua como estava.
    expect(severityOf(policy, 'tests')).toBe('blocking')
  })

  it('enabled: false equivale a todas as regras em off', () => {
    const policy = resolveValidationPolicy({ enabled: false })
    for (const rule of VALIDATION_RULES) {
      expect(severityOf(policy, rule)).toBe('off')
      expect(isBlockingRule(policy, rule)).toBe(false)
    }
  })

  it('resolve política parcial preservando os demais campos', () => {
    expect(resolveValidationPolicy()).toEqual(DEFAULT_VALIDATION_POLICY)
    const policy = resolveValidationPolicy({ countTowardAttempts: true, maxRepairAttempts: 0 })
    expect(policy.countTowardAttempts).toBe(true)
    expect(policy.maxRepairAttempts).toBe(0)
    expect(policy.enabled).toBe(true)
    expect(policy.rules).toEqual(DEFAULT_VALIDATION_POLICY.rules)
  })

  it('reconhece nome de regra', () => {
    expect(isValidationRule('scope')).toBe(true)
    expect(isValidationRule('nao-existe')).toBe(false)
  })
})

describe('histórico de tentativas (R3)', () => {
  function attempt(category?: string, diffDigest?: string): Attempt {
    return {
      id: 'att_x' as Attempt['id'],
      taskId: 'tsk_x' as Attempt['taskId'],
      n: 1,
      agent: 'executor',
      provider: 'fake',
      model: 'm',
      contextDigest: 'd',
      workspaceId: 'wsp_x' as Attempt['workspaceId'],
      startedAt: 0,
      usage: EMPTY_USAGE,
      cost: ZERO_USD,
      ...(category === undefined
        ? {}
        : {
            outcome: {
              status: 'failed' as const,
              diagnosis: {
                category: category as 'test-failure',
                summary: '',
                evidence: [],
                suggestedAction: 'retry' as const,
              },
              ...(diffDigest === undefined ? {} : { diffDigest }),
            },
          }),
    }
  }

  it('extrai a sequência de categorias de falha', () => {
    expect(failureHistory([attempt('test-failure'), attempt(), attempt('type-error')])).toEqual([
      'test-failure',
      'type-error',
    ])
  })

  it('detecta repetição da última categoria', () => {
    expect(repeatedLastCategory([attempt('test-failure')])).toBe(false)
    expect(repeatedLastCategory([attempt('test-failure'), attempt('test-failure')])).toBe(true)
    expect(repeatedLastCategory([attempt('test-failure'), attempt('type-error')])).toBe(false)
  })

  it('detecta oscilação pelo digest do diff', () => {
    expect(isOscillating([attempt('a', 'd1'), attempt('a', 'd2')])).toBe(false)
    expect(isOscillating([attempt('a', 'd1'), attempt('a', 'd1')])).toBe(true)
    expect(isOscillating([attempt('a', 'd1')])).toBe(false)
  })
})

describe('sinal de verificação do projeto (R4)', () => {
  function digest(overrides: Partial<ProjectDigest> = {}): ProjectDigest {
    return {
      languages: [],
      frameworks: [],
      architecture: { style: 'unknown', layers: [], entrypoints: [] },
      dependencies: { direct: 0, outdated: 0, vulnerable: 0 },
      tests: {},
      ci: { requiredChecks: [] },
      database: {},
      docs: [],
      conventions: [],
      vcs: { defaultBranch: 'main' },
      summary: '',
      freshness: 'x',
      generatedAt: 0,
      ...overrides,
    }
  }

  it('repositório sem testes entra em modo restrito', () => {
    expect(verificationSignalStrength(digest())).toBe(0)
    expect(isRestrictedMode(digest())).toBe(true)
  })

  it('runner e comando de teste já saem do modo restrito', () => {
    const strong = digest({ tests: { runner: 'vitest', command: 'pnpm test', count: 10 } })
    expect(verificationSignalStrength(strong)).toBeGreaterThanOrEqual(60)
    expect(isRestrictedMode(strong)).toBe(false)
  })

  it('CI e cobertura somam ao sinal', () => {
    const full = digest({
      tests: { runner: 'vitest', command: 'pnpm test', count: 10, coverage: 0.8 },
      ci: { provider: 'github', requiredChecks: ['test'] },
    })
    expect(verificationSignalStrength(full)).toBe(100)
  })
})

describe('memória', () => {
  function record(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
    return {
      id: 'mem_x' as MemoryRecord['id'],
      projectId: 'prj_x' as MemoryRecord['projectId'],
      scope: 'decision',
      key: 'k',
      title: 't',
      body: 'b',
      tags: [],
      confidence: 0.5,
      source: { kind: 'agent', ref: 'run_1' },
      refs: [],
      validFrom: 100,
      checksum: 'c',
      ...overrides,
    }
  }

  it('registro superseded deixa de estar ativo', () => {
    expect(isActiveMemory(record(), 200)).toBe(true)
    expect(isActiveMemory(record({ supersededBy: 'mem_y' as MemoryRecord['id'] }), 200)).toBe(false)
    expect(isActiveMemory(record({ validUntil: 150 }), 200)).toBe(false)
    expect(isActiveMemory(record({ validFrom: 300 }), 200)).toBe(false)
  })

  it('ordena por confiança e depois recência', () => {
    const high = record({ confidence: 0.9 })
    const low = record({ confidence: 0.1 })
    expect(compareForRetention(high, low)).toBeLessThan(0)

    const older = record({ confidence: 0.5, validFrom: 50 })
    const newer = record({ confidence: 0.5, validFrom: 150 })
    expect(compareForRetention(newer, older)).toBeLessThan(0)
  })
})

describe('diff', () => {
  it('resume totais e vazio', () => {
    expect(summarizeDiff([])).toEqual(EMPTY_DIFF)
    const summary = summarizeDiff([
      { path: 'src/a.ts', added: 10, removed: 2, status: 'modified' },
      { path: 'src/b.ts', added: 5, removed: 0, status: 'added' },
    ])
    expect(summary.totalAdded).toBe(15)
    expect(summary.totalRemoved).toBe(2)
    expect(summary.isEmpty).toBe(false)
  })

  it('detecta arquivos fora do escopo declarado (INV-5)', () => {
    const summary = summarizeDiff([
      { path: 'src/a.ts', added: 1, removed: 0, status: 'modified' },
      { path: 'ci/deploy.yml', added: 1, removed: 0, status: 'modified' },
    ])
    expect(pathsOutsideScope(summary, ['src/**'], matchesAny)).toEqual(['ci/deploy.yml'])
    expect(pathsOutsideScope(summary, [], matchesAny)).toEqual([])
  })
})
