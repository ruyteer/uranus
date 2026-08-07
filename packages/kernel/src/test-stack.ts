import { join } from 'node:path'
import type { Check, KernelDeps, ProjectRef, Task } from '@uranus/core'
import { createLogger, newProjectId, newTaskId, nullSink, systemClock, usd } from '@uranus/core'
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
} from '@uranus/executors'
import { GitAdapter } from '@uranus/vcs'
import { SqlTaskQueue } from '@uranus/queue'
import { DefaultPromptRegistry, registerBuiltinPrompts } from '@uranus/prompts'
import { DefaultProviderRegistry } from '@uranus/providers'
import { DefaultAgentRegistry, DefaultAgentRuntime, EXECUTOR_SPEC } from '@uranus/agents'
import { ScriptedProvider, type ScriptedBehavior } from '@uranus/testkit'
import { UranusKernel } from './kernel.js'
import { SimpleScheduler } from './scheduler.js'
import { MinimalContextPacker } from './support/minimal-context.js'
import {
  InMemoryTelemetry,
  NoopMemoryManager,
  NoopMemoryStore,
  StaticContextManager,
} from './support/stubs.js'
import { DefaultBudgetGuard } from './guards/budget-guard.js'
import { DefaultPermissionBroker } from './guards/permission-broker.js'
import { InMemoryHumanGate } from './guards/human-gate.js'
import { FileCheckpointManager } from './checkpoint/manager.js'
import { DefaultRecoveryManager } from './recovery/manager.js'

/**
 * Montagem completa do kernel para testes de integração e caos.
 *
 * É deliberadamente o espelho do composition root da CLI, com duas trocas:
 * `ScriptedProvider` no lugar do Claude Code e integração `branch-only`
 * (sem push/PR — o teste valida commit local).
 */
export interface TestStack {
  readonly kernel: UranusKernel
  readonly deps: KernelDeps
  readonly project: ProjectRef
  readonly state: StateStore
  readonly eventStore: JsonlEventStore
  readonly provider: ScriptedProvider
  readonly telemetry: InMemoryTelemetry
  enqueue(task: Partial<Task> & { acceptance: Task['acceptance'] }): Promise<Task>
  close(): Promise<void>
}

export async function makeTestStack(
  repoDir: string,
  behaviors: readonly ScriptedBehavior[],
  options: { budgetUsd?: number; maxAttempts?: number } = {},
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
  const scheduler = new SimpleScheduler(queue, 0) // sem cooldown em teste

  const prompts = new DefaultPromptRegistry()
  registerBuiltinPrompts(prompts)
  const agents = new DefaultAgentRegistry()
  const registered = agents.register(EXECUTOR_SPEC)
  if (!registered.ok) throw registered.error
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
    },
  })

  return {
    kernel,
    deps,
    project,
    state,
    eventStore,
    provider,
    telemetry,
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
