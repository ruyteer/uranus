import { describe, expect, it } from 'vitest'
import {
  andThen,
  attempt,
  attemptAsync,
  collect,
  collectAll,
  err,
  isErr,
  isOk,
  map,
  mapErr,
  ok,
  unwrap,
  unwrapOr,
  unwrapOrElse,
} from './result.js'

describe('Result', () => {
  it('constrói ok e err distinguíveis', () => {
    expect(isOk(ok(1))).toBe(true)
    expect(isErr(ok(1))).toBe(false)
    expect(isErr(err('x'))).toBe(true)
    expect(isOk(err('x'))).toBe(false)
  })

  it('ok() sem argumento produz valor undefined', () => {
    expect(ok().value).toBeUndefined()
  })

  it('unwrap devolve o valor e lança em erro', () => {
    expect(unwrap(ok(42))).toBe(42)
    expect(() => unwrap(err(new Error('boom')))).toThrow('boom')
  })

  it('unwrap embrulha erro não-Error em Error', () => {
    expect(() => unwrap(err('texto'))).toThrow(/texto/)
  })

  it('unwrapOr e unwrapOrElse usam o fallback só no erro', () => {
    expect(unwrapOr(ok(1), 9)).toBe(1)
    expect(unwrapOr(err('e'), 9)).toBe(9)
    expect(unwrapOrElse(ok(1), () => 9)).toBe(1)
    expect(unwrapOrElse(err('e'), (e) => e.length)).toBe(1)
  })

  it('map transforma apenas o sucesso', () => {
    expect(map(ok(2), (n) => n * 2)).toEqual(ok(4))
    expect(map(err('e'), (n: number) => n * 2)).toEqual(err('e'))
  })

  it('mapErr transforma apenas o erro', () => {
    expect(mapErr(ok(2), () => 'z')).toEqual(ok(2))
    expect(mapErr(err('e'), (e) => `${e}!`)).toEqual(err('e!'))
  })

  it('andThen encadeia sem aninhar', () => {
    expect(andThen(ok(2), (n) => ok(n + 1))).toEqual(ok(3))
    expect(andThen(ok(2), () => err('falhou'))).toEqual(err('falhou'))
    expect(andThen(err('e'), (n: number) => ok(n))).toEqual(err('e'))
  })

  it('collect curto-circuita no primeiro erro', () => {
    expect(collect([ok(1), ok(2)])).toEqual(ok([1, 2]))
    expect(collect([ok(1), err('a'), err('b')])).toEqual(err('a'))
  })

  it('collectAll acumula todos os erros', () => {
    expect(collectAll([ok(1), err('a'), err('b')])).toEqual(err(['a', 'b']))
    expect(collectAll([ok(1), ok(2)])).toEqual(ok([1, 2]))
  })

  it('attempt converte exceção em Result', () => {
    expect(attempt(() => 1)).toEqual(ok(1))
    const failed = attempt(() => {
      throw new Error('x')
    })
    expect(isErr(failed)).toBe(true)
  })

  it('attemptAsync converte rejeição em Result', async () => {
    await expect(attemptAsync(async () => Promise.resolve(1))).resolves.toEqual(ok(1))
    const failed = await attemptAsync(async () => Promise.reject(new Error('x')))
    expect(isErr(failed)).toBe(true)
  })
})
