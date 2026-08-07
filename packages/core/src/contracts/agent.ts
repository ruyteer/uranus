import type { Logger } from '../logger.js'
import type { Result } from '../result.js'
import type { AcceptanceContract, JsonSchema } from '../domain/acceptance.js'
import type { Attempt } from '../domain/attempt.js'
import type { ContextPack } from '../domain/context.js'
import type { EventName, EventPayloads } from '../domain/events.js'
import type { MemoryDraft, MemoryScope } from '../domain/memory.js'
import type { PermissionSet } from '../domain/permission.js'
import type { Task, TaskDraft, TaskKind } from '../domain/task.js'
import type { Money, TokenUsage } from '../domain/usage.js'
import type { Workspace } from '../domain/vcs.js'
import type { Diagnosis } from '../domain/verification.js'
import type { Provider, ProviderCapabilities, RunLimits, SessionResult } from './provider.js'

export interface ToolDescriptor {
  readonly name: string
  readonly description: string
  readonly inputSchema: JsonSchema
  readonly sideEffects: 'none' | 'read' | 'write' | 'exec' | 'network'
  readonly requiresApproval: boolean
}

export interface ToolContext {
  readonly workspace: Workspace
  readonly task: Task
  readonly permissions: PermissionSet
  readonly logger: Logger
  emit<N extends EventName>(name: N, payload: EventPayloads[N]): Promise<unknown>
}

export interface Tool<I = unknown, O = unknown> extends ToolDescriptor {
  execute(input: I, context: ToolContext, signal: AbortSignal): Promise<Result<O>>
}

export interface MemoryAccessSpec {
  readonly read: readonly MemoryScope[]
  readonly write: readonly MemoryScope[]
}

export interface ToolPolicy {
  readonly allow: readonly string[]
  /** `deny` sempre vence. */
  readonly deny: readonly string[]
}

/** Preferência provider-agnóstica. Um agente nunca nomeia um modelo específico. */
export interface ModelPreference {
  readonly tier: 'fast' | 'balanced' | 'deep'
  readonly minContextTokens?: number
}

/**
 * Especificação declarativa de um agente (ADR-008).
 *
 * Os sete campos exigidos pela arquitetura — missão, responsabilidades, entradas,
 * saídas, memória, ferramentas, critérios de sucesso — são obrigatórios aqui, e a
 * spec é validada no carregamento. Um agente sem critério de sucesso não é
 * registrado, porque seria um agente cujo trabalho não pode ser verificado.
 */
export interface AgentSpec {
  readonly name: string
  readonly version: string
  readonly mission: string
  readonly responsibilities: readonly string[]
  readonly inputs: { readonly schema: JsonSchema }
  readonly outputs: { readonly schema?: JsonSchema }
  readonly memory: MemoryAccessSpec
  readonly tools: ToolPolicy
  readonly permissions: PermissionSet
  readonly successCriteria: AcceptanceContract
  /** Ids no `PromptRegistry`, não texto inline (proíbe o "prompt gigante"). */
  readonly prompts: { readonly system: string; readonly instruction: string }
  readonly model?: ModelPreference
  readonly limits: RunLimits
  readonly handles: readonly TaskKind[]
  /** Desempate no roteamento. Agentes de plugin usam > 0 para sobrescrever genéricos. */
  readonly specificity: number
  readonly requires?: Partial<ProviderCapabilities>
}

export interface AgentRunContext {
  readonly task: Task
  readonly attempt: Attempt
  readonly workspace: Workspace
  readonly context: ContextPack
  readonly provider: Provider
  readonly logger: Logger
}

export interface AgentOutput {
  readonly structured?: unknown
  readonly summary: string
  /** Fatos candidatos a memória. O `MemoryManager` decide o que persiste. */
  readonly memoryDrafts: readonly MemoryDraft[]
  /** Sub-tasks propostas. Validadas pelo kernel antes de entrarem na fila (INV-1). */
  readonly followUps: readonly TaskDraft[]
  readonly usage: TokenUsage
  readonly cost: Money
}

/**
 * Código opcional do agente. Determinístico, roda no processo do kernel.
 * Existe para pré/pós-processamento — nunca para decidir fluxo.
 */
export interface AgentHooks {
  beforeRun?(context: AgentRunContext): Promise<AgentRunContext>
  afterRun?(context: AgentRunContext, result: SessionResult): Promise<AgentOutput>
  onFailure?(context: AgentRunContext, diagnosis: Diagnosis): Promise<Diagnosis>
}

export interface AgentRuntime {
  run(spec: AgentSpec, context: AgentRunContext, signal: AbortSignal): Promise<AgentOutput>
}

export interface AgentRegistry {
  register(spec: AgentSpec, hooks?: AgentHooks): Result<void>
  get(name: string): AgentSpec | undefined
  hooks(name: string): AgentHooks | undefined
  /** Roteamento: `handles ∩ kind`, maior `specificity`, `requires ⊆ capabilities`. */
  resolve(task: Task, capabilities: ProviderCapabilities): Result<AgentSpec>
  list(): readonly AgentSpec[]
}

export interface PromptTemplate {
  readonly id: string
  readonly version: string
  readonly body: string
  readonly variables: readonly string[]
}

export interface PromptRegistry {
  register(template: PromptTemplate): void
  get(id: string): PromptTemplate | undefined
  render(id: string, variables: Readonly<Record<string, string>>): Result<string>
}
