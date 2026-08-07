import type { Clock } from '../clock.js'
import type { Logger } from '../logger.js'
import type { ProjectId, RunId } from '../ids.js'
import type { Result } from '../result.js'
import type { BudgetState } from '../domain/budget.js'
import type { KernelStatus } from '../domain/project.js'
import type { AgentRegistry, AgentRuntime, PromptRegistry } from './agent.js'
import type { ContextManager, ContextPacker } from './context.js'
import type { EventBus, EventStore } from './events.js'
import type { CheckRegistry, Sandbox, ShellRunner, Verifier } from './execution.js'
import type { BudgetGuard, HumanGate, PermissionBroker } from './governance.js'
import type { MemoryManager, MemoryStore } from './memory.js'
import type { PluginLoader } from './plugin.js'
import type { ProviderRegistry } from './provider.js'
import type { Scheduler, TaskQueue } from './queue.js'
import type {
  AttemptRepository,
  CheckpointManager,
  RecoveryManager,
  RunRepository,
  TaskRepository,
} from './state.js'
import type { Telemetry } from './telemetry.js'
import type { CodeHost, VcsAdapter } from './vcs.js'

export interface StartOptions {
  readonly projectId: ProjectId
  readonly maxTasks?: number
  /** Epoch ms. O kernel para graciosamente ao atingir. */
  readonly until?: number
  readonly budget?: Partial<BudgetState>
  readonly resumeRunId?: RunId
  readonly dryRun?: boolean
}

export interface Kernel {
  start(options: StartOptions): Promise<Result<RunId>>
  stop(reason: string): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  status(): KernelStatus
  readonly events: EventBus
}

/**
 * Composition root. **Zero singletons** — tudo é injetado.
 *
 * Isto não é purismo: o teste de caos precisa montar um kernel com relógio falso,
 * provider gravado e filesystem temporário. Qualquer dependência resolvida por
 * import global tornaria esse teste impossível, e sem ele o INV-4 não é
 * verificável.
 */
export interface KernelDeps {
  readonly clock: Clock
  readonly logger: Logger

  readonly events: EventBus
  readonly eventStore: EventStore

  readonly queue: TaskQueue
  readonly scheduler: Scheduler

  readonly agents: AgentRegistry
  readonly agentRuntime: AgentRuntime
  readonly prompts: PromptRegistry
  readonly providers: ProviderRegistry

  readonly context: ContextPacker
  readonly contextManager: ContextManager
  readonly memory: MemoryStore
  readonly memoryManager: MemoryManager

  readonly shell: ShellRunner
  readonly sandbox: Sandbox
  readonly verifier: Verifier
  readonly checks: CheckRegistry
  readonly vcs: VcsAdapter
  readonly codeHost?: CodeHost

  readonly permissions: PermissionBroker
  readonly budget: BudgetGuard
  readonly humanGate: HumanGate

  readonly tasks: TaskRepository
  readonly attempts: AttemptRepository
  readonly runs: RunRepository
  readonly checkpoints: CheckpointManager
  readonly recovery: RecoveryManager

  readonly telemetry: Telemetry
  readonly plugins: PluginLoader
}
