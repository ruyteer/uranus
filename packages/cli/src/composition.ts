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
  ensureUranusIgnored,
  schemaCheckImpl,
  testsCheckImpl,
} from '@uranus/executors'
import { GitAdapter, GitHubHost } from '@uranus/vcs'
import { SqlTaskQueue } from '@uranus/queue'
import { DefaultPromptRegistry, registerBuiltinPrompts } from '@uranus/prompts'
import { ClaudeCodeProvider, DefaultProviderRegistry } from '@uranus/providers'
import { fileURLToPath } from 'node:url'
import {
  DefaultAgentRegistry,
  DefaultAgentRuntime,
  EXECUTOR_SPEC,
  PLANNER_SPEC,
  loadAgentSpecs,
} from '@uranus/agents'

/** Diretório `catalog/` do pacote `@uranus/agents`, resolvido em runtime. */
function builtinCatalogDir(): string {
  const agentsEntry = fileURLToPath(import.meta.resolve('@uranus/agents'))
  // `.../packages/agents/dist/index.js` → `.../packages/agents/catalog`
  return join(agentsEntry, '..', '..', 'catalog')
}
import {
  DefaultBudgetGuard,
  DefaultPermissionBroker,
  DefaultRecoveryManager,
  FileCheckpointManager,
  GatePipeline,
  InMemoryHumanGate,
  InMemoryTelemetry,
  PlanningService,
  UranusKernel,
  findingsToTaskDrafts,
  type KernelConfig,
} from '@uranus/kernel'
import { buildScheduler } from '@uranus/scheduler'
import { FileBacklogStore } from '@uranus/backlog'
import {
  DefaultContextManager,
  DefaultContextPacker,
  codeSource,
  digestSource,
  memorySource,
  readmeSource,
} from '@uranus/context'
import { DefaultMemoryManager, MarkdownMemoryStore } from '@uranus/memory'

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
  readonly contextManager: DefaultContextManager
  readonly memoryStore: MarkdownMemoryStore
  readonly backlog: FileBacklogStore
  readonly planning: PlanningService
  readonly config: UranusConfig
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

  await ensureUranusIgnored(uranusDir)
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

  // Verifier + checks builtin. O comando de teste por runner vem do digest do
  // projeto (Fase 3); este mapa é o fallback para runners conhecidos.
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

  // Scheduler completo (Fase 4): pesos vêm da config; ajustar prioridade é
  // editar YAML. Estado das tasks e última conclusão alimentam caminho crítico
  // e localidade de contexto.
  let lastCompletedTouches: readonly string[] = []
  let taskCache: readonly Awaited<ReturnType<typeof state.tasks.all>>[number][] = []
  const scheduler = buildScheduler({
    queue,
    logger,
    weights: options.config.scheduler.weights,
    failureCooldownMs: options.config.scheduler.failureCooldownMs,
    wipLimit: options.config.scheduler.wipLimit,
    taskState: () => taskCache,
    lastCompletedTouches: () => lastCompletedTouches,
  })
  events.on('TickStarted', () => {
    void state.tasks.all().then((tasks) => {
      taskCache = tasks
    })
  })
  events.on('TaskCompleted', (event) => {
    void state.tasks.find(event.payload.taskId).then((task) => {
      if (task !== undefined) lastCompletedTouches = task.touches
    })
  })

  const prompts = new DefaultPromptRegistry()
  registerBuiltinPrompts(prompts)

  const agents = new DefaultAgentRegistry()
  for (const spec of [EXECUTOR_SPEC, PLANNER_SPEC]) {
    const registered = agents.register(spec)
    if (!registered.ok) throw registered.error
  }
  // Catálogo em YAML (ADR-008): trocar a spec de um agente muda o
  // comportamento sem recompilar. Specs do projeto sobrescrevem as builtin.
  for (const dir of [builtinCatalogDir(), join(uranusDir, 'agents')]) {
    const loaded = await loadAgentSpecs(dir, logger)
    for (const spec of loaded.specs) {
      const registered = agents.register(spec)
      if (!registered.ok) {
        logger.warn('Spec de agente rejeitada', {
          agent: spec.name,
          error: registered.error.message,
        })
      }
    }
  }
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

  // Contexto real (Fase 3): digest automático com cache por FreshnessKey.
  const contextManager = new DefaultContextManager({ shell, clock, logger, events })
  await contextManager.ensureFresh(project, new AbortController().signal)

  // Memória real (Fase 3): Markdown + frontmatter em .uranus/memory/.
  const memoryStore = new MarkdownMemoryStore({
    dir: join(uranusDir, options.config.memory.dir),
    projectRootDir: rootDir,
    projectId: project.id,
    clock,
    logger,
    indexPath: join(uranusDir, 'cache', 'memory-index.db'),
  })
  const memoryManager = new DefaultMemoryManager({
    store: memoryStore,
    events,
    logger,
    maxRecordsPerScope: options.config.memory.maxRecordsPerScope,
    minConfidence: options.config.memory.minConfidence,
  })

  const packer = new DefaultContextPacker({ clock, logger })
  packer.addSource(digestSource(contextManager))
  packer.addSource(memorySource(memoryStore))
  packer.addSource(codeSource())
  packer.addSource(readmeSource())

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
    context: packer,
    contextManager,
    memory: memoryStore,
    memoryManager,
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
    escalationAgent: options.config.quality.escalationAgent,
  }

  const backlog = new FileBacklogStore({
    dir: join(uranusDir, 'backlog'),
    projectId: project.id,
    logger,
  })

  const planning = new PlanningService({
    project,
    agents,
    agentRuntime,
    providers,
    context: packer,
    queue,
    tasks: state.tasks,
    events,
    clock,
    logger,
    prompts,
    providerId: options.providerOverride?.id ?? options.config.providers.default,
    contextBudgetTokens: options.config.context.budgetTokens,
    allowedPaths: options.config.permissions.fsWrite,
    forbiddenPaths: options.config.permissions.fsDeny,
    allowedCommands: options.config.permissions.execAllow,
    maxTasksPerPlan: 12,
    maxAttemptsPerTask: options.config.kernel.maxAttemptsPerTask,
    maxPlanningAttempts: 2,
  })

  // Cadeia de qualidade (Fase 5): roda entre a verificação por código e o
  // commit. Os agentes relatam findings; `applyGatePolicy` decide o bloqueio.
  const gates = new GatePipeline({
    project,
    agents,
    agentRuntime,
    providers,
    context: packer,
    events,
    clock,
    logger,
    providerId: options.providerOverride?.id ?? options.config.providers.default,
    contextBudgetTokens: options.config.context.budgetTokens,
    gates: options.config.quality.gates.map((gate) => ({
      agent: gate.agent,
      enabled: gate.enabled,
    })),
    policy: {
      blockAt: options.config.quality.blockAt,
      followUpAt: options.config.quality.followUpAt,
      maxFindings: options.config.quality.maxFindings,
    },
  })

  const kernel = new UranusKernel({
    deps,
    project,
    config: kernelConfig,
    replanner: planning,
    ...(options.config.quality.enabled ? { gates, findingsToTasks: findingsToTaskDrafts } : {}),
  })

  return {
    kernel,
    backlog,
    planning,
    config: options.config,
    deps,
    project,
    state,
    eventStore,
    contextManager,
    memoryStore,
    async close(): Promise<void> {
      await memoryStore.close()
      await eventStore.close()
      state.close()
    },
  }
}

export function logEventLine(event: UranusEvent): string {
  return `${new Date(event.at).toISOString()} ${event.name} ${event.taskId ?? ''}`
}
