import { describe, expect, it } from 'vitest'
import {
  BudgetExceededError,
  ConfigError,
  ProviderError,
  RateLimitedError,
  TimeoutError,
  UranusError,
  ValidationError,
  isRetryable,
  isUranusError,
  toUranusError,
} from './errors.js'

describe('UranusError', () => {
  it('carrega code e retryable estáveis', () => {
    const error = new ConfigError('faltou')
    expect(error.code).toBe('E_CONFIG')
    expect(error.retryable).toBe(false)
    expect(error).toBeInstanceOf(UranusError)
    expect(error).toBeInstanceOf(Error)
  })

  it('preserva o nome da classe concreta', () => {
    expect(new ValidationError('x').name).toBe('ValidationError')
    expect(ConfigError.name).toBe('ConfigError')
  })

  it('marca como retryable apenas o que pode ser repetido', () => {
    expect(isRetryable(new TimeoutError('t'))).toBe(true)
    expect(isRetryable(new ProviderError('p'))).toBe(true)
    expect(isRetryable(new RateLimitedError('r'))).toBe(true)
    // INV-7: estourar orçamento nunca é resolvido tentando de novo.
    expect(isRetryable(new BudgetExceededError('b'))).toBe(false)
    expect(isRetryable(new Error('comum'))).toBe(false)
  })

  it('congela o contexto para não vazar mutação', () => {
    const error = new ConfigError('x', { context: { path: '/a' } })
    expect(error.context).toEqual({ path: '/a' })
    expect(Object.isFrozen(error.context)).toBe(true)
  })

  it('serializa incluindo a causa aninhada', () => {
    const root = new ValidationError('raiz')
    const wrapped = new ConfigError('topo', { cause: root, context: { field: 'kernel' } })
    const json = wrapped.toJSON()

    expect(json.code).toBe('E_CONFIG')
    expect(json.message).toBe('topo')
    expect(json.context).toEqual({ field: 'kernel' })
    expect(typeof json.cause).toBe('object')
    expect((json.cause as { code: string }).code).toBe('E_VALIDATION')
  })

  it('serializa causa que é Error comum', () => {
    const json = new ConfigError('topo', { cause: new Error('nativo') }).toJSON()
    expect((json.cause as { message: string }).message).toBe('nativo')
  })

  it('serializa causa que não é Error', () => {
    const json = new ConfigError('topo', { cause: 'string solta' }).toJSON()
    expect(json.cause).toBe('string solta')
  })

  it('identifica erros do Uranus', () => {
    expect(isUranusError(new ConfigError('x'))).toBe(true)
    expect(isUranusError(new Error('x'))).toBe(false)
    expect(isUranusError('x')).toBe(false)
  })

  describe('toUranusError', () => {
    it('devolve o mesmo objeto quando já é UranusError', () => {
      const error = new ConfigError('x')
      expect(toUranusError(error)).toBe(error)
    })

    it('embrulha Error nativo preservando a mensagem', () => {
      const wrapped = toUranusError(new Error('nativo'))
      expect(wrapped.message).toBe('nativo')
      expect(wrapped.cause).toBeInstanceOf(Error)
    })

    it('normaliza valores soltos vindos de borda de subprocesso', () => {
      const wrapped = toUranusError({ weird: true }, 'fallback')
      expect(wrapped.message).toBe('fallback')
      expect(wrapped.context['raw']).toBe('{"weird":true}')
    })

    it('usa a mensagem padrão para Error sem mensagem', () => {
      expect(toUranusError(new Error(''), 'padrão').message).toBe('padrão')
    })
  })
})
