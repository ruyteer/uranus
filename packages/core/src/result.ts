/**
 * `Result` explícito em vez de exceções para falhas *esperadas*.
 *
 * Regra do projeto: exceções sinalizam bugs e violações de invariante; `Result`
 * sinaliza falhas de domínio que o chamador precisa tratar. O kernel roda por
 * horas — uma falha esperada que vaza como exceção derruba o ciclo inteiro.
 */

export interface Ok<T> {
  readonly ok: true
  readonly value: T
}

export interface Err<E> {
  readonly ok: false
  readonly error: E
}

export type Result<T, E = Error> = Ok<T> | Err<E>

export function ok(): Ok<void>
export function ok<T>(value: T): Ok<T>
export function ok<T>(value?: T): Ok<T | undefined> {
  return { ok: true, value }
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error }
}

export function isOk<T, E>(r: Result<T, E>): r is Ok<T> {
  return r.ok
}

export function isErr<T, E>(r: Result<T, E>): r is Err<E> {
  return !r.ok
}

/** Extrai o valor ou lança. Use apenas onde a falha for realmente um bug. */
export function unwrap<T, E>(r: Result<T, E>): T {
  if (r.ok) return r.value
  throw r.error instanceof Error
    ? r.error
    : new Error(`unwrap() em Result de erro: ${String(r.error)}`)
}

export function unwrapOr<T, E>(r: Result<T, E>, fallback: T): T {
  return r.ok ? r.value : fallback
}

export function unwrapOrElse<T, E>(r: Result<T, E>, fn: (error: E) => T): T {
  return r.ok ? r.value : fn(r.error)
}

export function map<T, U, E>(r: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return r.ok ? ok(fn(r.value)) : r
}

export function mapErr<T, E, F>(r: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return r.ok ? r : err(fn(r.error))
}

export function andThen<T, U, E>(r: Result<T, E>, fn: (value: T) => Result<U, E>): Result<U, E> {
  return r.ok ? fn(r.value) : r
}

/**
 * Combina resultados preservando a ordem. Curto-circuita no primeiro erro —
 * o que importa em admissão de tarefa: um único check inválido invalida o lote.
 */
export function collect<T, E>(results: readonly Result<T, E>[]): Result<T[], E> {
  const values: T[] = []
  for (const r of results) {
    if (!r.ok) return r
    values.push(r.value)
  }
  return ok(values)
}

/** Acumula todos os erros em vez de curto-circuitar. Usado em validação de config. */
export function collectAll<T, E>(results: readonly Result<T, E>[]): Result<T[], E[]> {
  const values: T[] = []
  const errors: E[] = []
  for (const r of results) {
    if (r.ok) values.push(r.value)
    else errors.push(r.error)
  }
  return errors.length > 0 ? err(errors) : ok(values)
}

/** Converte código que lança em `Result`. */
export function attempt<T>(fn: () => T): Result<T, unknown> {
  try {
    return ok(fn())
  } catch (error: unknown) {
    return err(error)
  }
}

export async function attemptAsync<T>(fn: () => Promise<T>): Promise<Result<T, unknown>> {
  try {
    return ok(await fn())
  } catch (error: unknown) {
    return err(error)
  }
}
