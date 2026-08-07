import { join, resolve } from 'node:path'
import type { Clock, KernelDeps, Logger, ProjectRef, Provider, UranusEvent } from '@uranus/core'
import { newProjectId, systemClock, createLogger, usd } from '@uranus/core'
import type { UranusConfig } from '@uranus/config'
import { InProcessEventBus, JsonlEventStore } from '@uranus/events'
import { openState, type StateStore } from '@uranus/state'
import {
  DefaultCheckRegistry,
  DefaultShellRunner,
  DefaultVerifier,
  WorktreeSandbox,
  artifactCheckImpl,
  commandCheckImpl,
  diffCheckImpl,
  schemaCheckImpl,
  testsCheckImpl,
} from '@uranus/executors'
import { GitAdapter, GitHubHost } from '@uranus/vcs'
import { SqlTaskQueue } from '@uranus/queue'
import { DefaultPromptRegistry, registerBuiltinPrompts } from '@uranus/prompts'
import { ClaudeCodeProvider, DefaultProviderRegistry } from '@uranus/providers'
import { DefaultAgentRegistry, DefaultAgentRuntime, EXECUTOR_SPEC } from '@uranus/agents'
import {
  DefaultBudgetGuard,
  DefaultPermissionBroker,
  DefaultRecoveryManager,
  FileCheckpointManager,
  InMemoryHumanGate,
  MinimalContextPacker,
  NoopMemoryManager,
  NoopMemoryStore,
  SimpleScheduler,
  StaticContextManager,
  InMemoryTelemetry,
  UranusKernel,
  type KernelConfig,
} from '@uranus/kernel'

export interface CompositionOptions {
  readonly projectDir: string
  readonly config: UranusConfig
  readonly logger?: Logger
  readonly clock?: Clock
  /** Sobrescreve o provider (testes e `--dry-run`). */
  readonly providerOverride?: Provider
}

export interface Composition {
  readonly kernel: UranusKernel
  readonly deps: KernelDeps
  readonly project: ProjectRef
  readonly state: StateStore
  readonly eventStore: JsonlEventStore
  close(): Promise<void>
}

/**
 * Composition root — o ÚNICO lugar onde implementações concretas se encontram.
 * O kernel recebe tudo por injeção (zero singletons); trocar o provider, o
 * scheduler ou a memória é trocar uma linha aqui, não tocar no kernel.
 */
export async function compose(options: CompositionOptions): Promise<Composition> {
  const clock = options.clock ?? systemClock
  const logger = options.logger ?? createLogger({ level: options.config.telemetry.logLevel })

  const rootDir = resolve(options.projectDir)
  const uranusDir = join(rootDir, '.uranus')
  const project: ProjectRef = {
    id: newProjectId(clock.now()),
    name: options.config.project.name,
    rootDir,
    uranusDir,
  }

  const state = openState({ path: join(uranusDir, 'state.db'), now: clock.now() })
  const eventStore = await JsonlEventStore.open({ dir: join(uranusDir, 'events') })
  const events = new InProcessEventBus({
    store: eventStore,
    clock,
    logger,
    projectId: project.id,
  })

  const shell = new DefaultShellRunner({ clock, logger })
  const vcs = new GitAdapter({ shell, logger })
  const sandbox = new WorktreeSandbox({
    project,
    vcs,
    clock,
    logger,
    branchPrefix: options.config.project.vcs.branchPrefix,
  })

  // Verifier + checks builtin. O resolver de runner de testes vem da config:
  // `providers.entries` não — é `context`? Runner do MVP: config simples.
  const checks = new DefaultCheckRegistry()
  checks.register(commandCheckImpl(shell))
  checks.register(diffCheckImpl(vcs))
  checks.register(artifactCheckImpl())
  checks.register(schemaCheckImpl())
  const testCommands = new Map<string, string>([
    ['npm', 'npm test'],
    ['pnpm', 'pnpm test'],
    ['vitest', 'pnpm vitest run'],
    ['node', 'node --test'],
  ])
  checks.register(testsCheckImpl(shell, vcs, (runner) => testCommands.get(runner)))
  const verifier = new DefaultVerifier({ checks, clock, logger })

  const queue = new SqlTaskQueue(state)
  const scheduler = new SimpleScheduler(queue, options.config.scheduler.failureCooldownMs)

  const prompts = new DefaultPromptRegistry()
  registerBuiltinPrompts(prompts)

  const agents = new DefaultAgentRegistry()
  const registered = agents.register(EXECUTOR_SPEC)
  if (!registered.ok) throw registered.error
  const agentRuntime = new DefaultAgentRuntime({ prompts, registry: agents, logger })

  const providers = new DefaultProviderRegistry({
    fallbackOrder: options.config.providers.fallback,
    now: () => clock.now(),
  })
  if (options.providerOverride !== undefined) {
    providers.register(options.providerOverride)
  } else {
    const providerConfig = options.config.providers.entries['claude-code']
    providers.register(
      new ClaudeCodeProvider({
        shell,
        logger,
        ...(providerConfig?.binary === undefined ? {} : { binary: providerConfig.binary }),
        ...(providerConfig?.model === undefined ? {} : { defaultModel: providerConfig.model }),
        extraArgs: providerConfig?.extraArgs ?? [],
      }),
    )
  }

  const budgetConfig = options.config.budget
  const budget = new DefaultBudgetGuard(
    {
      run: {
        limits: {
          cost: usd(budgetConfig.perRun.usd),
          tokens: budgetConfig.perRun.tokens,
          wallclockMs: budgetConfig.perRun.wallclockMs,
        },
        usedCost: usd(0),
        usedTokens: 0,
        usedWallclockMs: 0,
      },
      task: {
        limits: {
          cost: usd(budgetConfig.perTask.usd),
          tokens: budgetConfig.perTask.tokens,
          wallclockMs: budgetConfig.perTask.wallclockMs,
        },
        usedCost: usd(0),
        usedTokens: 0,
        usedWallclockMs: 0,
      },
      onExhausted: budgetConfig.onExhausted,
    },
    budgetConfig.warnAtRatio,
  )

  const checkpoints = new FileCheckpointManager({
    dir: join(uranusDir, 'checkpoints'),
    state,
    clock,
  })
  const recovery = new DefaultRecoveryManager({
    state,
    checkpoints,
    eventStore,
    sandbox,
    budget,
    clock,
    logger,
  })

  const contextManager = new StaticContextManager({
    testsRunner: 'pnpm',
    testsCommand: 'pnpm test',
  })
  await contextManager.bootstrap(project, new AbortController().signal)

  const deps: KernelDeps = {
    clock,
    logger,
    events,
    eventStore,
    queue,
    scheduler,
    agents,
    agentRuntime,
    prompts,
    providers,
    context: new MinimalContextPacker(clock),
    contextManager,
    memory: new NoopMemoryStore(),
    memoryManager: new NoopMemoryManager(),
    shell,
    sandbox,
    verifier,
    checks,
    vcs,
    codeHost: new GitHubHost({ shell, logger }),
    permissions: new DefaultPermissionBroker(() => clock.now()),
    budget,
    humanGate: new InMemoryHumanGate(clock, logger, options.config.integration.approvalTimeoutMs),
    tasks: state.tasks,
    attempts: state.attempts,
    runs: state.runs,
    checkpoints,
    recovery,
    telemetry: new InMemoryTelemetry(),
    plugins: {
      discover: () => Promise.resolve([]),
      load: () => Promise.reject(new Error('plugins chegam na Fase 6')),
      activate: () => Promise.reject(new Error('plugins chegam na Fase 6')),
      deactivateAll: () => Promise.resolve(),
      active: () => [],
    },
  }

  const kernelConfig: KernelConfig = {
    tickIntervalMs: options.config.kernel.tickIntervalMs,
    idleBackoffMs: options.config.kernel.idleBackoffMs,
    leaseTtlMs: options.config.kernel.leaseTtlMs,
    checkpointKeep: 20,
    contextBudgetTokens: options.config.context.budgetTokens,
    integration: {
      strategy: options.config.integration.strategy,
      draftPullRequests: options.config.integration.draftPullRequests,
      prBase: options.config.project.vcs.defaultBranch,
    },
    providerId: options.providerOverride?.id ?? options.config.providers.default,
    commitTrailer: options.config.project.vcs.commitTrailer,
  }

  const kernel = new UranusKernel({ deps, project, config: kernelConfig })

  return {
    kernel,
    deps,
    project,
    state,
    eventStore,
    async close(): Promise<void> {
      await eventStore.close()
      state.close()
    },
  }
}

export function logEventLine(event: UranusEvent): string {
  return `${new Date(event.at).toISOString()} ${event.name} ${event.taskId ?? ''}`
}
