import { randomBytes } from 'node:crypto'
import { ValidationError } from './errors.js'

/**
 * Identificadores do Uranus: `<prefixo>_<ULID>`.
 *
 * ULID (não UUIDv4) porque a ordenação lexicográfica é ordenação temporal — o que
 * torna o event log, a fila e os checkpoints ordenáveis por chave primária sem
 * índice adicional. O prefixo existe para depuração: em um log de 8 horas,
 * `tsk_01J...` diz na hora o que é sem consultar nada.
 *
 * A tipagem é *branded*: `TaskId` não é atribuível a `RunId` mesmo ambos sendo
 * string. Trocar um pelo outro é o tipo de bug que só aparece em produção.
 */

declare const brand: unique symbol

export type Brand<T, B extends string> = T & { readonly [brand]: B }

export type ProjectId = Brand<string, 'ProjectId'>
export type RunId = Brand<string, 'RunId'>
export type TaskId = Brand<string, 'TaskId'>
export type AttemptId = Brand<string, 'AttemptId'>
export type EventId = Brand<string, 'EventId'>
export type SessionId = Brand<string, 'SessionId'>
export type MemoryId = Brand<string, 'MemoryId'>
export type PlanId = Brand<string, 'PlanId'>
export type CheckpointId = Brand<string, 'CheckpointId'>
export type WorkspaceId = Brand<string, 'WorkspaceId'>
export type ApprovalId = Brand<string, 'ApprovalId'>

export const ID_PREFIX = {
  Project: 'prj',
  Run: 'run',
  Task: 'tsk',
  Attempt: 'att',
  Event: 'evt',
  Session: 'ses',
  Memory: 'mem',
  Plan: 'pln',
  Checkpoint: 'ckp',
  Workspace: 'wsp',
  Approval: 'apv',
} as const

export type IdKind = keyof typeof ID_PREFIX

// ── ULID ────────────────────────────────────────────────────────────────────

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford base32
const ENCODING_LEN = 32
const TIME_LEN = 10
const RANDOM_LEN = 16
const MAX_TIME = 281_474_976_710_655 // 2^48 - 1

const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/
const ID_RE = /^([a-z]{3})_([0-7][0-9A-HJKMNP-TV-Z]{25})$/

function encodeTime(time: number): string {
  if (!Number.isInteger(time) || time < 0 || time > MAX_TIME) {
    throw new ValidationError(`Timestamp fora do intervalo válido para ULID: ${time}`)
  }
  let out = ''
  let rest = time
  for (let i = 0; i < TIME_LEN; i++) {
    const mod = rest % ENCODING_LEN
    out = ENCODING[mod]! + out
    rest = (rest - mod) / ENCODING_LEN
  }
  return out
}

/**
 * Gerador monotônico. Dentro do mesmo milissegundo o componente aleatório é
 * incrementado em vez de sorteado de novo — sem isso, dois eventos emitidos no
 * mesmo ms poderiam sair fora de ordem no replay do event store.
 */
export class UlidFactory {
  private lastTime = -1
  private lastRandom: number[] = []

  constructor(private readonly randomSource: (n: number) => Uint8Array = randomBytes) {}

  next(time: number): string {
    if (time === this.lastTime) {
      this.increment()
    } else {
      this.lastTime = time
      this.lastRandom = this.freshRandom()
    }
    let random = ''
    for (const index of this.lastRandom) random += ENCODING[index]!
    return encodeTime(time) + random
  }

  private freshRandom(): number[] {
    const bytes = this.randomSource(RANDOM_LEN)
    // 256 é múltiplo exato de 32, então `% 32` é uniforme (sem viés de módulo).
    return Array.from(bytes, (b) => b % ENCODING_LEN)
  }

  private increment(): void {
    for (let i = RANDOM_LEN - 1; i >= 0; i--) {
      const value = this.lastRandom[i]!
      if (value < ENCODING_LEN - 1) {
        this.lastRandom[i] = value + 1
        return
      }
      this.lastRandom[i] = 0
    }
    // Overflow de 80 bits no mesmo milissegundo é praticamente impossível, mas
    // silenciar seria gerar ids duplicados. Falha alto.
    throw new ValidationError('Overflow do componente aleatório do ULID no mesmo milissegundo')
  }
}

const defaultFactory = new UlidFactory()

export function ulid(time: number = Date.now()): string {
  return defaultFactory.next(time)
}

export function isUlid(value: string): boolean {
  return ULID_RE.test(value)
}

/** Extrai o timestamp (ms) de um ULID ou id prefixado. */
export function timestampOf(id: string): number {
  const raw = id.includes('_') ? id.slice(id.indexOf('_') + 1) : id
  if (!ULID_RE.test(raw)) throw new ValidationError(`Identificador inválido: ${id}`)
  let time = 0
  for (let i = 0; i < TIME_LEN; i++) {
    time = time * ENCODING_LEN + ENCODING.indexOf(raw[i]!)
  }
  return time
}

// ── Construtores e validadores ──────────────────────────────────────────────

function make<T extends string>(kind: IdKind, time?: number): T {
  return `${ID_PREFIX[kind]}_${ulid(time)}` as T
}

function parse<T extends string>(kind: IdKind, value: string): T {
  const match = ID_RE.exec(value)
  if (match?.[1] !== ID_PREFIX[kind]) {
    throw new ValidationError(
      `Esperado identificador de ${kind} (prefixo "${ID_PREFIX[kind]}_"), recebido: ${value}`,
      { context: { kind, value } },
    )
  }
  return value as T
}

export const newProjectId = (time?: number): ProjectId => make<ProjectId>('Project', time)
export const newRunId = (time?: number): RunId => make<RunId>('Run', time)
export const newTaskId = (time?: number): TaskId => make<TaskId>('Task', time)
export const newAttemptId = (time?: number): AttemptId => make<AttemptId>('Attempt', time)
export const newEventId = (time?: number): EventId => make<EventId>('Event', time)
export const newSessionId = (time?: number): SessionId => make<SessionId>('Session', time)
export const newMemoryId = (time?: number): MemoryId => make<MemoryId>('Memory', time)
export const newPlanId = (time?: number): PlanId => make<PlanId>('Plan', time)
export const newCheckpointId = (time?: number): CheckpointId =>
  make<CheckpointId>('Checkpoint', time)
export const newWorkspaceId = (time?: number): WorkspaceId => make<WorkspaceId>('Workspace', time)
export const newApprovalId = (time?: number): ApprovalId => make<ApprovalId>('Approval', time)

export const asProjectId = (v: string): ProjectId => parse<ProjectId>('Project', v)
export const asRunId = (v: string): RunId => parse<RunId>('Run', v)
export const asTaskId = (v: string): TaskId => parse<TaskId>('Task', v)
export const asAttemptId = (v: string): AttemptId => parse<AttemptId>('Attempt', v)
export const asEventId = (v: string): EventId => parse<EventId>('Event', v)
export const asSessionId = (v: string): SessionId => parse<SessionId>('Session', v)
export const asMemoryId = (v: string): MemoryId => parse<MemoryId>('Memory', v)
export const asPlanId = (v: string): PlanId => parse<PlanId>('Plan', v)
export const asCheckpointId = (v: string): CheckpointId => parse<CheckpointId>('Checkpoint', v)
export const asWorkspaceId = (v: string): WorkspaceId => parse<WorkspaceId>('Workspace', v)
export const asApprovalId = (v: string): ApprovalId => parse<ApprovalId>('Approval', v)

export function idKindOf(value: string): IdKind | undefined {
  const match = ID_RE.exec(value)
  if (!match) return undefined
  const prefix = match[1]
  for (const [kind, p] of Object.entries(ID_PREFIX)) {
    if (p === prefix) return kind as IdKind
  }
  return undefined
}
