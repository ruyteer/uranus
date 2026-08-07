import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  HealthReport,
  Money,
  Provider,
  ProviderCapabilities,
  ProviderEvent,
  ProviderSession,
  SessionRequest,
  SessionResult,
  TokenUsage,
} from '@uranus/core'
import { EMPTY_USAGE, newSessionId, usd } from '@uranus/core'

export interface ScriptedBehavior {
  /** Arquivos a escrever no workdir (path relativo → conteúdo). */
  readonly writes?: Readonly<Record<string, string>>
  /** Texto final "do modelo". */
  readonly text?: string
  readonly status?: SessionResult['status']
  readonly usage?: TokenUsage
  readonly costUsd?: number
  /** Hook livre executado no workdir antes do resultado. */
  readonly act?: (workdir: string, request: SessionRequest) => void
}

const FAKE_CAPS: ProviderCapabilities = Object.freeze({
  streaming: true,
  nativeFileEditing: true,
  toolUse: true,
  structuredOutput: false,
  resumableSessions: false,
  vision: false,
  maxContextTokens: 200_000,
  models: ['fake-model'],
  maxConcurrentSessions: 4,
})

/**
 * Provider roteirizado para testes do kernel.
 *
 * Cada sessão consome o próximo `ScriptedBehavior` da lista — o que permite
 * roteirizar "primeira tentativa quebra os testes, segunda conserta" e provar a
 * política de retry sem gastar um token real. O comportamento default (lista
 * vazia) é o pior caso do R1: declara sucesso sem tocar em nada.
 */
export class ScriptedProvider implements Provider {
  readonly id: string
  readonly kind = 'cli' as const
  readonly capabilities = FAKE_CAPS

  readonly sessions: SessionRequest[] = []
  private cursor = 0

  constructor(
    private readonly behaviors: readonly ScriptedBehavior[],
    id = 'scripted',
  ) {
    this.id = id
  }

  health(_signal: AbortSignal): Promise<HealthReport> {
    return Promise.resolve({ healthy: true, detail: 'scripted', checkedAt: 0 })
  }

  createSession(request: SessionRequest, _signal: AbortSignal): Promise<ProviderSession> {
    this.sessions.push(request)
    const behavior = this.behaviors[this.cursor] ?? {}
    this.cursor += 1
    return Promise.resolve(new ScriptedSession(request, behavior))
  }

  estimateCost(usage: TokenUsage, _model: string): Money {
    return usd((usage.input + usage.output) / 1e6)
  }

  estimateTokens(request: SessionRequest): number {
    return Math.ceil((request.systemPrompt.length + request.instruction.length) / 4) + 1_000
  }
}

class ScriptedSession implements ProviderSession {
  readonly id = newSessionId()
  private readonly result_: SessionResult

  constructor(request: SessionRequest, behavior: ScriptedBehavior) {
    const touched: string[] = []
    for (const [rel, content] of Object.entries(behavior.writes ?? {})) {
      const abs = join(request.workdir, rel)
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, content)
      touched.push(rel)
    }
    behavior.act?.(request.workdir, request)

    this.result_ = {
      status: behavior.status ?? 'completed',
      text: behavior.text ?? 'Tarefa implementada.',
      usage: behavior.usage ?? { ...EMPTY_USAGE, input: 1_000, output: 500 },
      cost: usd(behavior.costUsd ?? 0.01),
      turns: 1,
      filesTouched: touched,
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async *stream(): AsyncIterable<ProviderEvent> {
    yield { type: 'started', model: 'fake-model' }
    for (const path of this.result_.filesTouched) {
      yield { type: 'file_changed', path, change: 'create' }
    }
    yield { type: 'done', result: this.result_ }
  }

  result(): Promise<SessionResult> {
    return Promise.resolve(this.result_)
  }

  interrupt(_reason: string): Promise<void> {
    return Promise.resolve()
  }
}
