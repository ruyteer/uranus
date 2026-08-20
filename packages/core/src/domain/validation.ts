/**
 * Política de validação — quais regras de verificação valem, e com que peso.
 *
 * A verificação (INV-2) sempre existiu como binário: o check reprovou, a task
 * falhou, gastou tentativa. O problema é que nem todo check reprovado é um
 * defeito no código. "O diff tocou um arquivo fora de `task.touches`" é uma
 * violação de POLÍTICA nossa — o código pode estar correto — e tratá-la como
 * defeito produziu o pior comportamento observado do harness: a task falha,
 * repete a mesma categoria, vira `stuck`, replaneja, e o replanejamento gera
 * mais tasks que falham do mesmo jeito. A fila cresce e nada é corrigido.
 *
 * A separação aqui é entre o que a regra DETECTA (dado) e o que ela CUSTA
 * (controle, do dono do projeto):
 *
 *  - `off`      — nem roda. O problema não é verificado.
 *  - `advisory` — roda, registra em `detail.warnings`, não reprova.
 *  - `blocking` — roda e reprova. É o comportamento histórico.
 *
 * O default é tudo `blocking` de propósito: um projeto que já existe não pode
 * ficar mais permissivo porque alguém atualizou o Uranus. Afrouxar é opt-in.
 */

export type ValidationSeverity = 'off' | 'advisory' | 'blocking'

export type ValidationRule =
  /** Diff tocou caminho fora de `task.touches` (INV-5). */
  | 'scope'
  /** `DiffCheck.maxFiles` / `maxLines`. */
  | 'diffSize'
  /** `DiffCheck.forbidPaths`. */
  | 'forbiddenPaths'
  /** `DiffCheck.requireNonEmpty` — "declarou sucesso sem mudar nada". */
  | 'emptyDiff'
  | 'tests'
  | 'requireNewTests'
  | 'forbidSkipped'
  | 'lint'
  | 'types'
  | 'schema'

export const VALIDATION_RULES: readonly ValidationRule[] = Object.freeze([
  'scope',
  'diffSize',
  'forbiddenPaths',
  'emptyDiff',
  'tests',
  'requireNewTests',
  'forbidSkipped',
  'lint',
  'types',
  'schema',
])

export interface ValidationPolicy {
  /** `false` equivale a todas as regras em `off`. */
  readonly enabled: boolean
  readonly rules: Readonly<Record<ValidationRule, ValidationSeverity>>
  /**
   * Falha de validação consome tentativa de execução?
   *
   * `false` (default) é o que quebra o ciclo descrito no topo: o reparo tem
   * contador próprio (`Task.repairAttempts`) e não empurra a task para
   * `blocked` nem para replanejamento.
   */
  readonly countTowardAttempts: boolean
  /** Teto de reparos dirigidos antes de a falha virar tentativa de verdade. */
  readonly maxRepairAttempts: number
}

/**
 * Reproduz exatamente o comportamento anterior à existência desta política.
 * Escrito por extenso — e não gerado a partir de `VALIDATION_RULES` — porque
 * assim o compilador cobra a decisão explícita para cada regra nova.
 */
export const DEFAULT_VALIDATION_RULES: Readonly<Record<ValidationRule, ValidationSeverity>> =
  Object.freeze({
    scope: 'blocking',
    diffSize: 'blocking',
    forbiddenPaths: 'blocking',
    emptyDiff: 'blocking',
    tests: 'blocking',
    requireNewTests: 'blocking',
    forbidSkipped: 'blocking',
    lint: 'blocking',
    types: 'blocking',
    schema: 'blocking',
  })

export const DEFAULT_VALIDATION_POLICY: ValidationPolicy = Object.freeze({
  enabled: true,
  rules: DEFAULT_VALIDATION_RULES,
  countTowardAttempts: false,
  maxRepairAttempts: 3,
})

export function severityOf(policy: ValidationPolicy, rule: ValidationRule): ValidationSeverity {
  if (!policy.enabled) return 'off'
  return policy.rules[rule]
}

/**
 * `true` quando a regra deve REPROVAR a verificação, não só avisar.
 *
 * O nome carrega o sufixo porque `isBlocking(check: Check)` — outra pergunta,
 * sobre outro assunto — já ocupa o nome curto na superfície de `@uranus/core`.
 */
export function isBlockingRule(policy: ValidationPolicy, rule: ValidationRule): boolean {
  return severityOf(policy, rule) === 'blocking'
}

/** `off` é a única severidade em que a regra sequer é avaliada. */
export function isRuleEnabled(policy: ValidationPolicy, rule: ValidationRule): boolean {
  return severityOf(policy, rule) !== 'off'
}

export function isValidationRule(value: string): value is ValidationRule {
  return (VALIDATION_RULES as readonly string[]).includes(value)
}

/** A forma parcial que vem da config: o que não vier usa o default. */
export interface ValidationPolicyInput {
  readonly enabled?: boolean
  readonly rules?: Readonly<Partial<Record<ValidationRule, ValidationSeverity>>>
  readonly countTowardAttempts?: boolean
  readonly maxRepairAttempts?: number
}

/**
 * Completa uma política parcial com os defaults, regra a regra.
 *
 * Mora aqui, e não no schema de config, porque a fusão é regra de domínio: o
 * `@uranus/config` continua zod-only (mesmo motivo de `linkedMemoryScopeSchema`
 * espelhar `MemoryScope` em vez de importá-lo).
 */
export function resolveValidationPolicy(input?: ValidationPolicyInput): ValidationPolicy {
  if (input === undefined) return DEFAULT_VALIDATION_POLICY

  const rules: Record<ValidationRule, ValidationSeverity> = { ...DEFAULT_VALIDATION_RULES }
  for (const rule of VALIDATION_RULES) {
    const severity = input.rules?.[rule]
    if (severity !== undefined) rules[rule] = severity
  }

  return {
    enabled: input.enabled ?? DEFAULT_VALIDATION_POLICY.enabled,
    rules: Object.freeze(rules),
    countTowardAttempts: input.countTowardAttempts ?? DEFAULT_VALIDATION_POLICY.countTowardAttempts,
    maxRepairAttempts: input.maxRepairAttempts ?? DEFAULT_VALIDATION_POLICY.maxRepairAttempts,
  }
}
