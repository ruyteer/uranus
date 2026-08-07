import { InvariantViolation } from '../errors.js'

/**
 * Invariantes do sistema (INV-1..INV-8, docs/00-ARCHITECTURE.md).
 *
 * `invariant` não é validação de entrada — é a afirmação de que algo que o
 * código garante continua verdadeiro. Uma violação é sempre bug do Uranus,
 * nunca erro do usuário, e por isso lança em vez de retornar `Result`.
 */
export function invariant(
  condition: unknown,
  message: string,
  context?: Readonly<Record<string, unknown>>,
): asserts condition {
  if (condition) return
  throw new InvariantViolation(message, context === undefined ? undefined : { context })
}

/** Exaustividade de `switch`. Erro de compilação se um caso novo não for tratado. */
export function assertNever(value: never, message = 'Caso não tratado'): never {
  throw new InvariantViolation(`${message}: ${JSON.stringify(value)}`)
}

export function assertDefined<T>(
  value: T | null | undefined,
  message: string,
  context?: Readonly<Record<string, unknown>>,
): T {
  invariant(value !== null && value !== undefined, message, context)
  return value
}
