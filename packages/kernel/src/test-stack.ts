import { join } from 'node:path'
import type { Check, GatePolicy, KernelDeps, ProjectRef, Task } from '@uranus/core'
import {
  DEFAULT_GATE_POLICY,
  createLogger,
  newProjectId,
  newTaskId,
  nullSink,
  systemClock,
  usd,
} from '@uranus/core'
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
} from '@uranus/executors'
import { GitAdapter } from '@uranus/vcs'
import { SqlTaskQueue } from '@uranus/queue'
import { DefaultPromptRegistry, registerBuiltinPrompts } from '@uranus/prompts'
import { DefaultProviderRegistry } from '@uranus/providers'
import { fileURLToPath } from 'node:url'
import {
  DefaultAgentRegistry,
  DefaultAgentRuntime,
  EXECUTOR_SPEC,
  PLANNER_SPEC,
  loadAgentSpecs,
} from '@uranus/agents'
import { ScriptedProvider, type ScriptedBehavior } from '@uranus/testkit'
import { DefaultContextPacker, codeSource, digestSource } from '@uranus/context'
import { DefaultMemoryManager, MarkdownMemoryStore } from '@uranus/memory'
import { buildScheduler } from '@uranus/scheduler'
import { FileBacklogStore } from '@uranus/backlog'
import { UranusKernel } from './kernel.js'
import { GatePipeline, findingsToTaskDrafts } from './quality/gate-pipeline.js'
import { PlanningService } from './planning/planning-service.js'
import { InMemoryTelemetry, StaticContextManager } from './support/stubs.js'
import { DefaultBudgetGuard } from './guards/budget-guard.js'
import { DefaultPermissionBroker } from './guards/permission-broker.js'
import { InMemoryHumanGate } from './guards/human-gate.js'
import { FileCheckpointManager } from './checkpoint/manager.js'
import { DefaultRecoveryManager } from './recovery/manager.js'

/**
 * Montagem completa do kernel para testes de integração e caos.
 *
 * Ã‰ deliberadamente o espelho do composition root da CLI, com duas trocas:
 * `ScriptedProvider` no lugar do Claude Code e integração `branch-only`
 * (sem push/PR â€” o teste valida commit local).
 */
export interface TestStack {
  readonly kernel: UranusKernel
  readonly deps: KernelDeps
  readonly project: ProjectRef
  readonly state: StateStore
  readonly eventStore: JsonlEventStore
  readonly provider: ScriptedProvider
  readonly telemetry: InMemoryTelemetry
  readonly memoryStore: MarkdownMemoryStore
  readonly backlog: FileBacklogStore
  readonly planning: PlanningService
  enqueue(task: Partial<Task> & { acceptance: Task['acceptance'] }): Promise<Task>
  close(): Promise<void>
}

export interface TestStackOptions {
  readonly budgetUsd?: number
  readonly maxAttempts?: number
  readonly maxPlanningAttempts?: number
  /** Liga o replanejamento automático de tasks em `draft` (Fase 4). */
  readonly withReplanner?: boolean
  /** Agentes da cadeia de qualidade, em ordem (Fase 5). */
  readonly gates?: readonly string[]
  readonly gatePolicy?: GatePolicy
  readonly escalationAgent?: string
}

export async function makeTestStack(
  repoDir: string,
  behaviors: readonly ScriptedBehavior[],
  options: TestStackOptions = {},
): Promise<TestStack> {
  const clock = systemClock
  const logger = createLogger({ level: 'silent', sink: nullSink })
  const uranusDir = join(repoDir, '.uranus')
  const project: ProjectRef = {
    id: newProjectId(clock.now()),
    name: 'stack-teste',
    rootDir: repoDir,
    uranusDir,
  }

  await ensureUranusIgnored(uranusDir)
  const state = openState({ path: join(uranusDir, 'state.db'), now: clock.now() })
  const eventStore = await JsonlEventStore.open({ dir: join(uranusDir, 'events') })
  const events = new InProcessEventBus({ store: eventStore, clock, logger, projectId: project.id })

  const shell = new DefaultShellRunner({ clock, logger })
  const vcs = new GitAdapter({ shell, logger })
  const sandbox = new WorktreeSandbox({ project, vcs, clock, logger, branchPrefix: 'uranus/' })

  const checks = new DefaultCheckRegistry()
  checks.register(commandCheckImpl(shell))
  checks.register(diffCheckImpl(vcs))
  checks.register(artifactCheckImpl())
  checks.register(schemaCheckImpl())
  const verifier = new DefaultVerifier({ checks, clock, logger })

  const queue = new SqlTaskQueue(state)
  let taskCache: readonly Task[] = []
  const scheduler = buildScheduler({
    queue,
    logger,
    failureCooldownMs: 0, // sem cooldown em teste
    taskState: () => taskCache,
    lastCompletedTouches: () => [],
  })

  const prompts = new DefaultPromptRegistry()
  registerBuiltinPrompts(prompts)
  const agents = new DefaultAgentRegistry()
  for (const spec of [EXECUTOR_SPEC, PLANNER_SPEC]) {
    const registered = agents.register(spec)
    if (!registered.ok) throw registered.error
  }
  // Catálogo YAML real — os testes exercitam as specs que rodam em produção.
  const catalog = await loadAgentSpecs(
    join(fileURLToPath(import.meta.url), '..', '..', '..', 'agents', 'catalog'),
    logger,
  )
  for (const spec of catalog.specs) {
    const registered = agents.register(spec)
    if (!registered.ok) throw registered.error
  }
  const agentRuntime = new DefaultAgentRuntime({ prompts, registry: agents, logger })

  const provider = new ScriptedProvider(behaviors)
  const providers = new DefaultProviderRegistry({ now: () => clock.now() })
  providers.register(provider)

  const budget = new DefaultBudgetGuard({
    run: {
      limits: {
        cost: usd(options.budgetUsd ?? 10),
        tokens: 10_000_000,
        wallclockMs: 3_600_000,
      },
      usedCost: usd(0),
      usedTokens: 0,
      usedWallclockMs: 0,
    },
    task: {
      limits: { cost: usd(5), tokens: 5_000_000, wallclockMs: 1_800_000 },
      usedCost: usd(0),
      usedTokens: 0,
      usedWallclockMs: 0,
    },
    onExhausted: 'pause',
  })

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
  const contextManager = new StaticContextManager({ testsRunner: 'node', testsCommand: 'node -v' })
  await contextManager.bootstrap(project, new AbortController().signal)
  const telemetry = new InMemoryTelemetry()

  // Packer e memória REAIS (Fase 3): o kernel de teste usa a mesma pilha que a
  // CLI â€” o que o teste de integração exercita é o que roda em produção.
  const packer = new DefaultContextPacker({ clock, logger })
  packer.addSource(digestSource(contextManager))
  packer.addSource(codeSource())
  const memoryStore = new MarkdownMemoryStore({
    dir: join(uranusDir, 'memory'),
    projectRootDir: repoDir,
    projectId: project.id,
    clock,
    logger,
  })
  const memoryManager = new DefaultMemoryManager({
    store: memoryStore,
    events,
    logger,
    maxRecordsPerScope: 50,
    minConfidence: 0.3,
  })

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
    permissions: new DefaultPermissionBroker(() => clock.now()),
    budget,
    humanGate: new InMemoryHumanGate(clock, logger, 0),
    tasks: state.tasks,
    attempts: state.attempts,
    runs: state.runs,
    checkpoints,
    recovery,
    telemetry,
    plugins: {
      discover: () => Promise.resolve([]),
      load: () => Promise.reject(new Error('n/a')),
      activate: () => Promise.reject(new Error('n/a')),
      deactivateAll: () => Promise.resolve(),
      active: () => [],
    },
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
    providerId: provider.id,
    contextBudgetTokens: 20_000,
    allowedPaths: ['src/**', 'test/**', 'tests/**', 'docs/**'],
    forbiddenPaths: ['.github/**', '.env'],
    allowedCommands: [],
    maxTasksPerPlan: 8,
    maxAttemptsPerTask: options.maxAttempts ?? 3,
    maxPlanningAttempts: options.maxPlanningAttempts ?? 2,
  })

  const kernel = new UranusKernel({
    deps,
    project,
    config: {
      tickIntervalMs: 20,
      idleBackoffMs: 30,
      leaseTtlMs: 60_000,
      checkpointKeep: 10,
      contextBudgetTokens: 20_000,
      integration: { strategy: 'branch-only', draftPullRequests: true, prBase: 'main' },
      providerId: provider.id,
      ...(options.escalationAgent === undefined
        ? {}
        : { escalationAgent: options.escalationAgent }),
    },
    ...(options.withReplanner === true ? { replanner: planning } : {}),
    ...(options.gates === undefined
      ? {}
      : {
          gates: new GatePipeline({
            project,
            agents,
            agentRuntime,
            providers,
            context: packer,
            events,
            clock,
            logger,
            providerId: provider.id,
            contextBudgetTokens: 20_000,
            gates: options.gates.map((agent) => ({ agent, enabled: true })),
            policy: options.gatePolicy ?? DEFAULT_GATE_POLICY,
          }),
          findingsToTasks: findingsToTaskDrafts,
        }),
  })

  events.on('TickStarted', () => {
    void state.tasks.all().then((tasks) => {
      taskCache = tasks
    })
  })

  return {
    kernel,
    deps,
    project,
    state,
    eventStore,
    provider,
    telemetry,
    memoryStore,
    backlog,
    planning,
    async enqueue(partial): Promise<Task> {
      const now = clock.now()
      const task: Task = {
        id: newTaskId(now),
        projectId: project.id,
        kind: 'feature',
        title: 'Task de teste',
        intent: 'Implementar a mudança de teste.',
        state: 'ready',
        priority: 50,
        deps: [],
        touches: ['src/**'],
        attempts: 0,
        maxAttempts: options.maxAttempts ?? 3,
        labels: [],
        createdAt: now,
        updatedAt: now,
        ...partial,
      }
      const queued = await queue.enqueue(task)
      if (!queued.ok) throw queued.error
      return task
    },
    async close(): Promise<void> {
      await memoryStore.close()
      await eventStore.close()
      state.close()
    },
  }
}

export function artifactAcceptance(
  path: string,
  matches: string,
): { checks: Check[]; requireAll: true } {
  return {
    checks: [
      { kind: 'artifact', id: 'artefato', path, mustExist: true, matches, timeoutMs: 5_000 },
    ],
    requireAll: true,
  }
}
