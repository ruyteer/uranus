import { describe, expect, it } from 'vitest'
import { ValidationError } from './errors.js'
import {
  UlidFactory,
  asRunId,
  asTaskId,
  idKindOf,
  isUlid,
  newAttemptId,
  newEventId,
  newTaskId,
  timestampOf,
  ulid,
} from './ids.js'

describe('ULID', () => {
  it('gera 26 caracteres em Crockford base32', () => {
    const value = ulid(1_700_000_000_000)
    expect(value).toHaveLength(26)
    expect(isUlid(value)).toBe(true)
    expect(value).not.toMatch(/[ILOU]/)
  })

  it('ordena lexicograficamente na ordem temporal', () => {
    const early = ulid(1_700_000_000_000)
    const late = ulid(1_700_000_001_000)
    expect(early < late).toBe(true)
  })

  it('é monotônico dentro do mesmo milissegundo', () => {
    const factory = new UlidFactory()
    const values = Array.from({ length: 200 }, () => factory.next(1_700_000_000_000))
    const sorted = [...values].sort()
    expect(values).toEqual(sorted)
    expect(new Set(values).size).toBe(values.length)
  })

  it('propaga o carry ao incrementar o componente aleatório', () => {
    // Última posição no máximo (31): o incremento precisa zerá-la e carregar
    // para a posição anterior.
    const bytes = new Uint8Array(16) // índices 0 → caractere '0'
    bytes[15] = 31
    const factory = new UlidFactory(() => bytes)
    const first = factory.next(1_000)
    const second = factory.next(1_000)
    expect(first.endsWith('Z')).toBe(true) // 31 → 'Z'
    expect(second.endsWith('10')).toBe(true) // carry: ...0Z + 1 = ...10
    expect(second > first).toBe(true)
  })

  it('falha alto em overflow total em vez de gerar id duplicado', () => {
    const factory = new UlidFactory(() => new Uint8Array(16).fill(0xff))
    factory.next(1_000) // todos os índices em 31
    expect(() => factory.next(1_000)).toThrow(ValidationError)
  })

  it('recupera o timestamp codificado', () => {
    const time = 1_700_123_456_789
    expect(timestampOf(ulid(time))).toBe(time)
    expect(timestampOf(newTaskId(time))).toBe(time)
  })

  it('rejeita timestamp fora do intervalo de 48 bits', () => {
    expect(() => ulid(-1)).toThrow(ValidationError)
    expect(() => ulid(2 ** 49)).toThrow(ValidationError)
  })

  it('rejeita identificador malformado ao extrair timestamp', () => {
    expect(() => timestampOf('nao-e-ulid')).toThrow(ValidationError)
  })
})

describe('Identificadores prefixados', () => {
  it('usa um prefixo por tipo', () => {
    expect(newTaskId()).toMatch(/^tsk_/)
    expect(newEventId()).toMatch(/^evt_/)
    expect(newAttemptId()).toMatch(/^att_/)
  })

  it('valida o prefixo na conversão', () => {
    const id = newTaskId()
    expect(asTaskId(id)).toBe(id)
    // O brand impede isto em tempo de compilação; aqui provamos o guarda em runtime.
    expect(() => asRunId(id)).toThrow(ValidationError)
    expect(() => asTaskId('tsk_invalido')).toThrow(ValidationError)
    expect(() => asTaskId('')).toThrow(ValidationError)
  })

  it('todos os construtores e validadores fazem round-trip', async () => {
    const ids = await import('./ids.js')
    const pairs = [
      [ids.newProjectId, ids.asProjectId],
      [ids.newRunId, ids.asRunId],
      [ids.newTaskId, ids.asTaskId],
      [ids.newAttemptId, ids.asAttemptId],
      [ids.newEventId, ids.asEventId],
      [ids.newSessionId, ids.asSessionId],
      [ids.newMemoryId, ids.asMemoryId],
      [ids.newPlanId, ids.asPlanId],
      [ids.newCheckpointId, ids.asCheckpointId],
      [ids.newWorkspaceId, ids.asWorkspaceId],
      [ids.newApprovalId, ids.asApprovalId],
    ] as const
    for (const [make, parse] of pairs) {
      const id = make(1_700_000_000_000)
      expect(parse(id)).toBe(id)
      expect(ids.idKindOf(id)).toBeDefined()
    }
  })

  it('identifica o tipo a partir do valor', () => {
    expect(idKindOf(newTaskId())).toBe('Task')
    expect(idKindOf(newEventId())).toBe('Event')
    expect(idKindOf('lixo')).toBeUndefined()
    expect(idKindOf('xyz_01HZZZZZZZZZZZZZZZZZZZZZZZ')).toBeUndefined()
  })
})
