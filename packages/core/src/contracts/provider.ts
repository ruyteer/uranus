import type { SessionId } from '../ids.js'
import type { Result } from '../result.js'
import type { JsonSchema } from '../domain/acceptance.js'
import type { ContextPack } from '../domain/context.js'
import type { PermissionSet } from '../domain/permission.js'
import type { Money, TokenUsage } from '../domain/usage.js'
import type { HealthReport } from './common.js'
import type { ToolDescriptor } from './agent.js'

export interface RunLimits {
  readonly maxTokens: number
  readonly maxWallclockMs: number
  readonly maxTurns: number
  readonly maxCost: Money
}

export interface ProviderCapabilities {
  readonly streaming: boolean
  /**
   * `true` = o provider edita arquivos por conta própria (CLIs agênticos).
   *
   * Muda a garantia disponível: com edição nativa, o Uranus observa o resultado
   * via `git diff` em vez de controlar cada escrita. É por isso que `DiffCheck`
   * é obrigatório nesse modo — é a única fonte de verdade sobre o que mudou.
   */
  readonly nativeFileEditing: boolean
  readonly toolUse: boolean
  readonly structuredOutput: boolean
  readonly resumableSessions: boolean
  readonly vision: boolean
  readonly maxContextTokens: number
  readonly models: readonly string[]
  readonly maxConcurrentSessions: number
}

export interface SessionRequest {
  readonly systemPrompt: string
  readonly instruction: string
  readonly context: ContextPack
  readonly tools: readonly ToolDescriptor[]
  readonly workdir: string
  readonly permissions: PermissionSet
  readonly outputSchema?: JsonSchema
  readonly model?: string
  readonly limits: RunLimits
  readonly resumeToken?: string
  /** `runId`/`taskId`/`attemptId` para correlação em log e telemetria. */
  readonly metadata: Readonly<Record<string, string>>
}

export interface ToolCall {
  readonly id: string
  readonly name: string
  readonly input: unknown
}

export interface ProviderErrorInfo {
  readonly code: string
  readonly message: string
  readonly retryable: boolean
  readonly retryAfterMs?: number
}

/**
 * Stream normalizado. Todo provider emite exatamente estes eventos — o kernel
 * nunca vê formato nativo, o que é o que permite trocar de provider sem tocar
 * em nenhuma outra camada (R5, R9 de vendor lock-in).
 */
export type ProviderEvent =
  | { readonly type: 'started'; readonly model: string }
  | { readonly type: 'text'; readonly delta: string }
  | { readonly type: 'thinking'; readonly delta: string }
  | { readonly type: 'tool_call'; readonly call: ToolCall }
  | {
      readonly type: 'tool_result'
      readonly callId: string
      readonly ok: boolean
      readonly summary: string
    }
  | {
      readonly type: 'file_changed'
      readonly path: string
      readonly change: 'create' | 'modify' | 'delete'
    }
  | { readonly type: 'usage'; readonly usage: TokenUsage }
  | { readonly type: 'warning'; readonly message: string }
  | { readonly type: 'error'; readonly error: ProviderErrorInfo }
  | { readonly type: 'done'; readonly result: SessionResult }

export interface SessionResult {
  readonly status: 'completed' | 'interrupted' | 'error' | 'limit_reached'
  readonly text: string
  /** Validado contra `outputSchema` pelo kernel — nunca pelo provider. */
  readonly structured?: unknown
  readonly usage: TokenUsage
  readonly cost: Money
  readonly turns: number
  readonly resumeToken?: string
  readonly filesTouched: readonly string[]
}

export interface ProviderSession {
  readonly id: SessionId
  stream(): AsyncIterable<ProviderEvent>
  result(): Promise<SessionResult>
  interrupt(reason: string): Promise<void>
}

export interface Provider {
  readonly id: string
  readonly kind: 'cli' | 'api'
  readonly capabilities: ProviderCapabilities

  health(signal: AbortSignal): Promise<HealthReport>
  createSession(request: SessionRequest, signal: AbortSignal): Promise<ProviderSession>

  /** Custo a partir do `usage` real. Nunca estimado (R18). */
  estimateCost(usage: TokenUsage, model: string): Money
  /** Estimativa a priori, usada apenas na admissão pelo `BudgetGuard`. */
  estimateTokens(request: SessionRequest): number
}

export interface ProviderRequirements {
  readonly capabilities?: Partial<ProviderCapabilities>
  readonly preferred?: string
  readonly tier?: 'fast' | 'balanced' | 'deep'
  /**
   * Papel que vai usar o provider (`executor`, `reviewer`, …).
   *
   * Permite rotear por agente: modelo forte no Executor, onde a edição
   * multi-turno com ferramentas é difícil; modelo local nos gates, onde uma
   * passada com saída estruturada basta.
   */
  readonly agent?: string
}

export interface ProviderRegistry {
  register(provider: Provider): void
  get(id: string): Provider | undefined
  /** Aplica fallback e circuit breaker; falha se nenhum satisfaz os requisitos. */
  resolve(requirements: ProviderRequirements): Result<Provider>
  list(): readonly Provider[]
}
