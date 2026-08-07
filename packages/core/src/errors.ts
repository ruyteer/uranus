/**
 * Hierarquia de erros do Uranus.
 *
 * Dois campos obrigatórios em todo erro:
 *  - `code`      — estável, usado em eventos, métricas e no `Diagnosis`.
 *  - `retryable` — o kernel decide retry/escalate a partir disto, não de heurística
 *                  sobre a mensagem (que muda com a versão do provider — R5).
 */

export interface UranusErrorOptions {
  readonly cause?: unknown
  readonly context?: Readonly<Record<string, unknown>>
}

export interface SerializedError {
  readonly name: string
  readonly code: string
  readonly message: string
  readonly retryable: boolean
  readonly context: Readonly<Record<string, unknown>>
  readonly stack?: string
  readonly cause?: SerializedError | string
}

export abstract class UranusError extends Error {
  abstract readonly code: string
  abstract readonly retryable: boolean

  readonly context: Readonly<Record<string, unknown>>

  constructor(message: string, options: UranusErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = new.target.name
    this.context = Object.freeze({ ...options.context })
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, new.target)
    }
  }

  toJSON(): SerializedError {
    const base = {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      context: this.context,
    }
    const stack = this.stack
    const cause = this.cause
    return {
      ...base,
      ...(stack === undefined ? {} : { stack }),
      ...(cause === undefined ? {} : { cause: serializeCause(cause) }),
    }
  }
}

function serializeCause(cause: unknown): SerializedError | string {
  if (cause instanceof UranusError) return cause.toJSON()
  if (cause instanceof Error) {
    return {
      name: cause.name,
      code: 'E_UNKNOWN',
      message: cause.message,
      retryable: false,
      context: {},
      ...(cause.stack === undefined ? {} : { stack: cause.stack }),
    }
  }
  return String(cause)
}

type UranusErrorConstructor = new (message: string, options?: UranusErrorOptions) => UranusError

function defineError(name: string, code: string, retryable: boolean): UranusErrorConstructor {
  const cls = class extends UranusError {
    readonly code = code
    readonly retryable = retryable
  }
  Object.defineProperty(cls, 'name', { value: name })
  return cls
}

// ── Configuração e validação ────────────────────────────────────────────────
/** Configuração ausente, malformada ou que não passa no schema. Nunca retryable. */
export const ConfigError = defineError('ConfigError', 'E_CONFIG', false)
/** Entrada de domínio inválida (task sem contrato de aceite, plano com ciclo, ...). */
export const ValidationError = defineError('ValidationError', 'E_VALIDATION', false)
/** Uma invariante do sistema (INV-1..INV-8) foi violada. Isto é sempre um bug. */
export const InvariantViolation = defineError('InvariantViolation', 'E_INVARIANT', false)

// ── Estado e persistência ───────────────────────────────────────────────────
export const NotFoundError = defineError('NotFoundError', 'E_NOT_FOUND', false)
/** Transição de estado ilegal, lease já tomado, escrita concorrente. */
export const ConflictError = defineError('ConflictError', 'E_CONFLICT', false)
/** Checkpoint/segmento com digest divergente — R11. */
export const IntegrityError = defineError('IntegrityError', 'E_INTEGRITY', false)
export const StateError = defineError('StateError', 'E_STATE', false)

// ── Execução ────────────────────────────────────────────────────────────────
export const TimeoutError = defineError('TimeoutError', 'E_TIMEOUT', true)
export const AbortedError = defineError('AbortedError', 'E_ABORTED', false)
export const IoError = defineError('IoError', 'E_IO', true)

// ── Governança ──────────────────────────────────────────────────────────────
export const PermissionDeniedError = defineError('PermissionDeniedError', 'E_PERMISSION', false)
/** INV-7: orçamento é limite duro. */
export const BudgetExceededError = defineError('BudgetExceededError', 'E_BUDGET', false)

// ── Integrações ─────────────────────────────────────────────────────────────
export const ProviderError = defineError('ProviderError', 'E_PROVIDER', true)
export const RateLimitedError = defineError('RateLimitedError', 'E_RATE_LIMIT', true)
export const PluginError = defineError('PluginError', 'E_PLUGIN', false)

export function isUranusError(value: unknown): value is UranusError {
  return value instanceof UranusError
}

export function isRetryable(value: unknown): boolean {
  return isUranusError(value) && value.retryable
}

/**
 * Normaliza qualquer coisa lançada em um `UranusError`.
 * Usado nas bordas: subprocesso, plugin, provider — lugares onde o que vem
 * pode ser string, objeto solto, ou `undefined`.
 */
export function toUranusError(value: unknown, fallbackMessage = 'Erro desconhecido'): UranusError {
  if (isUranusError(value)) return value
  if (value instanceof Error) {
    return new StateError(value.message || fallbackMessage, { cause: value })
  }
  const raw =
    typeof value === 'object'
      ? JSON.stringify(value)
      : typeof value === 'string'
        ? value
        : typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint'
          ? String(value)
          : typeof value
  return new StateError(fallbackMessage, { context: { raw } })
}
