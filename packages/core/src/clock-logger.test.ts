import { describe, expect, it, vi } from 'vitest'
import { AbortedError } from './errors.js'
import { backoffDelay, systemClock, timed } from './clock.js'
import type { LogRecord } from './logger.js'
import { createLogger, isLogLevel, jsonSink, nullSink, silentLogger } from './logger.js'
import { KERNEL_ACTOR } from './domain/events.js'
import { TICK_PHASES } from './domain/project.js'
import { TASK_KINDS } from './domain/task.js'
import { MEMORY_SCOPES } from './domain/memory.js'
import { FRAGMENT_KINDS, DEFAULT_SECTION_BUDGETS } from './domain/context.js'
import { DEFAULT_APPROVAL_REQUIRED } from './domain/permission.js'
import { EMPTY_CONTRACT } from './domain/acceptance.js'
import { PASSED_VERIFICATION } from './domain/verification.js'

describe('systemClock', () => {
  it('now e monotonic avançam', async () => {
    const before = systemClock.now()
    const monoBefore = systemClock.monotonic()
    await systemClock.sleep(5)
    expect(systemClock.now()).toBeGreaterThanOrEqual(before)
    expect(systemClock.monotonic()).toBeGreaterThan(monoBefore)
  })

  it('sleep resolve após o prazo', async () => {
    await expect(systemClock.sleep(1)).resolves.toBeUndefined()
  })

  it('sleep rejeita imediatamente com signal já abortado', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(systemClock.sleep(10_000, controller.signal)).rejects.toThrow(AbortedError)
  })

  it('sleep rejeita quando abortado no meio', async () => {
    const controller = new AbortController()
    const pending = systemClock.sleep(60_000, controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow(AbortedError)
  })

  it('timed mede a duração com o relógio monotônico', async () => {
    const { value, durationMs } = await timed(systemClock, async () => {
      await systemClock.sleep(5)
      return 'resultado'
    })
    expect(value).toBe('resultado')
    expect(durationMs).toBeGreaterThan(0)
  })
})

describe('backoffDelay', () => {
  it('cresce exponencialmente com jitter determinístico', () => {
    const jitter = (): number => 1 // sem aleatoriedade no teste
    expect(backoffDelay(1, { baseMs: 100, jitter })).toBe(100)
    expect(backoffDelay(2, { baseMs: 100, jitter })).toBe(200)
    expect(backoffDelay(3, { baseMs: 100, jitter })).toBe(400)
  })

  it('respeita o teto', () => {
    const jitter = (): number => 1
    expect(backoffDelay(30, { baseMs: 100, maxMs: 5_000, jitter })).toBe(5_000)
  })

  it('jitter completo pode reduzir a zero', () => {
    expect(backoffDelay(3, { baseMs: 100, jitter: () => 0 })).toBe(0)
  })

  it('attempt zero ou negativo usa a base', () => {
    const jitter = (): number => 1
    expect(backoffDelay(0, { baseMs: 100, jitter })).toBe(100)
  })
})

describe('logger', () => {
  function capture(): { records: LogRecord[]; sink: (r: LogRecord) => void } {
    const records: LogRecord[] = []
    return { records, sink: (r) => records.push(r) }
  }

  it('respeita o nível mínimo', () => {
    const { records, sink } = capture()
    const logger = createLogger({ level: 'warn', sink })
    logger.trace('t')
    logger.debug('d')
    logger.info('i')
    logger.warn('w')
    logger.error('e')
    expect(records.map((r) => r.level)).toEqual(['warn', 'error'])
  })

  it('nível silent descarta tudo', () => {
    const { records, sink } = capture()
    const logger = createLogger({ level: 'silent', sink })
    logger.error('mesmo erro não sai')
    expect(records).toHaveLength(0)
  })

  it('child acumula bindings sem alterar o pai', () => {
    const { records, sink } = capture()
    const parent = createLogger({ level: 'info', sink, bindings: { component: 'kernel' } })
    const child = parent.child({ taskId: 'tsk_1' })

    parent.info('do pai')
    child.info('do filho')

    expect(records[0]!.bindings).toEqual({ component: 'kernel' })
    expect(records[1]!.bindings).toEqual({ component: 'kernel', taskId: 'tsk_1' })
  })

  it('redige segredos na borda de saída (R12)', () => {
    const { records, sink } = capture()
    const logger = createLogger({ level: 'info', sink })
    logger.info('token ghp_abcdefghijklmnopqrstuvwx vazando', {
      apiKey: 'nao-pode-aparecer',
    })
    expect(records[0]!.message).not.toContain('ghp_abcdefghijklmnopqrstuvwx')
    expect(records[0]!.data!['apiKey']).toBe('[REDACTED]')
  })

  it('inclui data apenas quando fornecido', () => {
    const { records, sink } = capture()
    const logger = createLogger({ level: 'info', sink })
    logger.info('sem data')
    logger.info('com data', { extra: 1 })
    expect('data' in records[0]!).toBe(false)
    expect(records[1]!.data).toEqual({ extra: 1 })
  })

  it('todos os métodos de nível emitem', () => {
    const { records, sink } = capture()
    const logger = createLogger({ level: 'trace', sink })
    logger.trace('1')
    logger.debug('2')
    logger.info('3')
    logger.warn('4')
    logger.error('5')
    expect(records).toHaveLength(5)
  })

  it('jsonSink escreve uma linha JSON em stdout', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    try {
      jsonSink({ at: 1, level: 'info', message: 'm', bindings: {} })
      expect(spy).toHaveBeenCalledOnce()
      const line = spy.mock.calls[0]![0] as string
      expect(JSON.parse(line.trim())).toMatchObject({ level: 'info', message: 'm' })
    } finally {
      spy.mockRestore()
    }
  })

  it('nullSink e silentLogger não produzem nada', () => {
    expect(() => {
      nullSink({ at: 1, level: 'info', message: 'm', bindings: {} })
      silentLogger.error('nada')
    }).not.toThrow()
  })

  it('isLogLevel valida nomes', () => {
    expect(isLogLevel('info')).toBe(true)
    expect(isLogLevel('verboso')).toBe(false)
  })
})

describe('constantes de domínio', () => {
  it('exporta catálogos completos e imutáveis', () => {
    expect(KERNEL_ACTOR).toEqual({ type: 'kernel' })
    expect(TICK_PHASES).toHaveLength(10)
    expect(TASK_KINDS).toContain('feature')
    expect(MEMORY_SCOPES).toHaveLength(10)
    expect(FRAGMENT_KINDS).toContain('code')
    expect(Object.values(DEFAULT_SECTION_BUDGETS).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1)
    expect(DEFAULT_APPROVAL_REQUIRED).toContain('merge')
    expect(EMPTY_CONTRACT.checks).toHaveLength(0)
    expect(PASSED_VERIFICATION.passed).toBe(true)
  })
})
