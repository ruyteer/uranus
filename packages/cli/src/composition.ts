import { basename, join, resolve } from 'node:path'
import { stat } from 'node:fs/promises'
import type {
  Clock,
  DeferralReason,
  FindingSeverity,
  GatePolicy,
  KernelDeps,
  Logger,
  ProjectRef,
  Provider,
  UranusEvent,
  ValidationPolicy,
} from '@uranus/core'
import {
  DEFAULT_FOLLOW_UP_DENY_CATEGORIES,
  ValidationError,
  err,
  newProjectId,
  resolveValidationPolicy,
  systemClock,
  createLogger,
  usd,
} from '@uranus/core'
import type { UranusConfig } from '@uranus/config'
import { createConfigReader, scopedReader } from '@uranus/config'
import {
  BUILTIN_PLUGINS,
  DefaultPluginLoader,
  PluginRegistry,
  type ActivationReport,
} from '@uranus/plugins'
import { InProcessEventBus, JsonlEventStore } from '@uranus/events'
import { openState, selectAllTasksSync, type StateStore } from '@uranus/state'
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
import { DefaultProviderRegistry, ProviderRouter } from '@uranus/providers'
import { registerConfiguredProviders } from './providers-setup.js'
import { fileURLToPath } from 'node:url'
import {
  DefaultAgentRegistry,
  DefaultAgentRuntime,
  EXECUTOR_SPEC,
  PLANNER_SPEC,
  createSessionLimiter,
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
  PlanningService,
  UranusKernel,
  findingsToTaskDrafts,
  type CrossProjectBacklog,
  type KernelConfig,
} from '@uranus/kernel'
import { buildScheduler } from '@uranus/scheduler'
import { FileBacklogStore, createCrossProjectItem, crossProjectBacklogDir } from '@uranus/backlog'
import { createBacklogPort } from './backlog-port.js'
import { createDashboardData } from './dashboard-data.js'
import { GitHubControl, MultiRepoGitHubControl, discoverGitRepos } from './git-control.js'
import { FileInstructionsStore } from './instructions.js'
import type { DashboardData } from '@uranus/dashboard'
import {
  DefaultContextManager,
  DefaultContextPacker,
  codeSource,
  digestSource,
  linkedMemorySource,
  memorySource,
  readmeSource,
  type LinkedProjectMemory,
} from '@uranus/context'
import { DefaultMemoryManager, MarkdownMemoryStore } from '@uranus/memory'
import {
  DefaultCostAccountant,
  DefaultTelemetry,
  TelemetryAggregator,
  attachCostAccounting,
  attachOperationalMetrics,
  createPricingTable,
} from '@uranus/telemetry'

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
  /**
   * Política de validação já resolvida contra os defaults do core.
   *
   * Exposta porque `config.validations.rules` chega PARCIAL: ler a config crua
   * em outro ponto do sistema devolve `undefined` para toda regra não declarada.
   * Quem precisa de severidade lê daqui, e recebe por parâmetro — não há
   * singleton global.
   */
  readonly validations: ValidationPolicy
  /**
   * Porta de escrita do painel. Sem ela o dashboard sobe somente-leitura —
   * as rotas de CRUD devolvem 503 e a UI esconde os controles.
   */
  readonly dashboardData: DashboardData
  readonly plugins: {
    readonly loader: DefaultPluginLoader
    readonly registry: PluginRegistry
    readonly report: ActivationReport
  }
  readonly observability: {
    readonly telemetry: DefaultTelemetry
    readonly cost: DefaultCostAccountant
    readonly aggregator: TelemetryAggregator
  }
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
  const gitRepos = await discoverGitRepos(rootDir)
  const githubControl = new MultiRepoGitHubControl(
    gitRepos.map((repo) => ({
      id: repo.id,
      control: new GitHubControl({ shell, repoDir: repo.dir, repoId: repo.id, logger }),
    })),
  )
  const vcs = new GitAdapter({ shell, logger })
  const sandbox = new WorktreeSandbox({
    project,
    vcs,
    clock,
    logger,
    branchPrefix: options.config.project.vcs.branchPrefix,
  })

  // Plugins (Fase 6) entram aqui, antes de tudo o que eles estendem: checks,
  // agentes, prompts, context sources e políticas de scheduler. Ativar depois
  // significaria registrar capacidades num sistema já montado.
  const configReader = createConfigReader(options.config)
  const pluginRegistry = new PluginRegistry(logger)
  const pluginLoader = new DefaultPluginLoader({
    project,
    logger,
    config: configReader,
    shell,
    events,
    registry: pluginRegistry,
    builtins: BUILTIN_PLUGINS,
    enabled: options.config.plugins.enabled,
    disabled: options.config.plugins.disabled,
    // Cada plugin enxerga apenas `plugins.settings.<id>.*` como raiz.
    configFor: (id) => scopedReader(configReader, `plugins.settings.${id}`),
  })
  const pluginReport = await pluginLoader.loadAll(new AbortController().signal)
  const pluginRegistrations = pluginRegistry.snapshot()

  // Resolvida uma vez, aqui, e passada adiante por parâmetro: a config traz só
  // o que o projeto declarou, então `rules[regra]` na config crua é `undefined`
  // para tudo o mais — e `undefined` não é "off" nem "blocking", é um bug.
  const validations = resolveValidationPolicy(options.config.validations)

  // Verifier + checks builtin.
  const checks = new DefaultCheckRegistry()
  checks.register(commandCheckImpl(shell))
  checks.register(diffCheckImpl(vcs, validations))
  checks.register(artifactCheckImpl())
  checks.register(schemaCheckImpl())
  // Fallback mínimo de runners. O conhecimento real de stack vem do plugin
  // `node` (INV-8); este mapa só cobre um projeto sem plugin algum ativo.
  const fallbackTestCommands = new Map<string, string>([
    ['npm', 'npm test'],
    ['pnpm', 'pnpm test'],
    ['node', 'node --test'],
  ])
  checks.register(
    testsCheckImpl(
      shell,
      vcs,
      (runner) => pluginRegistry.resolveTestCommand(runner) ?? fallbackTestCommands.get(runner),
      // Sem opinião sobre onde ficam os testes — o default do próprio check.
      undefined,
      validations,
    ),
  )
  for (const entry of pluginRegistrations.checks) checks.register(entry.value)
  const verifier = new DefaultVerifier({ checks, clock, logger })

  const queue = new SqlTaskQueue(state)

  // Scheduler completo (Fase 4): pesos vêm da config; ajustar prioridade é
  // editar YAML. Estado das tasks e última conclusão alimentam caminho crítico
  // e localidade de contexto.
  let lastCompletedTouches: readonly string[] = []
  const scheduler = buildScheduler({
    queue,
    logger,
    weights: options.config.scheduler.weights,
    failureCooldownMs: options.config.scheduler.failureCooldownMs,
    wipLimit: options.config.scheduler.wipLimit,
    // Leitura síncrona direta (não um cache atualizado por evento): dependência
    // é veto incompensável (`dependencyReadyPolicy`) — uma leitura desatualizada
    // aqui trava a task pra sempre, silenciosamente, exatamente o tipo de bug
    // que uma leitura sempre fresca elimina de raiz.
    taskState: () => selectAllTasksSync(state.db),
    lastCompletedTouches: () => lastCompletedTouches,
  })
  for (const entry of pluginRegistrations.schedulerPolicies) {
    scheduler.addPolicy(entry.value.policy, entry.value.weight)
  }
  events.on('TaskCompleted', (event) => {
    void state.tasks.find(event.payload.taskId).then((task) => {
      if (task !== undefined) lastCompletedTouches = task.touches
    })
  })

  const prompts = new DefaultPromptRegistry()
  registerBuiltinPrompts(prompts)
  for (const entry of pluginRegistrations.prompts) prompts.register(entry.value)

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
  // Agentes de plugin por último: `specificity` maior que 0 os faz vencer o
  // Executor genérico no roteamento por task.
  for (const entry of pluginRegistrations.agents) {
    const registered = agents.register(entry.value)
    if (!registered.ok) {
      logger.warn('Spec de agente de plugin rejeitada', {
        plugin: entry.pluginId,
        agent: entry.value.name,
        error: registered.error.message,
      })
    }
  }
  // `events` aqui é o que torna o custo por agente observável: este runtime é o
  // único caminho por onde passam Executor, Planner e todos os gates.
  const sessions = createSessionLimiter()
  const agentRuntime = new DefaultAgentRuntime({
    prompts,
    registry: agents,
    logger,
    events,
    sessions,
  })

  const providers = new DefaultProviderRegistry({
    fallbackOrder: options.config.providers.fallback,
    now: () => clock.now(),
  })
  if (options.providerOverride !== undefined) {
    providers.register(options.providerOverride)
  } else {
    await registerConfiguredProviders({
      config: options.config,
      registry: providers,
      shell,
      clock,
      logger,
    })
  }

  // Roteamento por papel e por tier (Fase 8): permite modelo forte no Executor
  // e modelo local nos gates, com a mesma interface de Provider.
  const router = new ProviderRouter(
    providers,
    {
      byAgent: options.config.providers.byAgent,
      byTier: options.config.providers.byTier,
      default: options.providerOverride?.id ?? options.config.providers.default,
      fallback: options.config.providers.fallback,
    },
    logger,
  )

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

  // Observabilidade (Fase 7). Nasce depois do orçamento porque o agregador o
  // lê, e antes do kernel porque `KernelDeps.telemetry` é esta instância — a
  // do painel e a do kernel precisam ser a mesma, ou o relatório e a tela
  // contam histórias diferentes.
  const telemetry = new DefaultTelemetry({ clock, logger })
  const costAccountant = new DefaultCostAccountant({
    pricing: createPricingTable(options.config.telemetry.pricing),
  })
  const aggregator = new TelemetryAggregator({
    clock,
    events,
    cost: costAccountant,
    telemetry,
    budget,
    providers: () => router.list().map((entry) => ({ id: entry.id, kind: entry.kind })),
  })
  // Tasks que já existiam antes deste processo. O agregador deriva de eventos,
  // e eventos de runs anteriores não são reproduzidos — sem isto o painel
  // contradiz o `uranus task list`.
  aggregator.hydrate(await state.tasks.all())
  const detachCost = attachCostAccounting({ events, cost: costAccountant, telemetry, logger })
  const detachMetrics = attachOperationalMetrics({ events, telemetry })
  aggregator.start()

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
    pruneSupersededOlderThanMs:
      options.config.memory.pruneSupersededAfterDays * 24 * 60 * 60 * 1000,
  })

  // Projetos vinculados (ex.: backend/frontend em repos separados): memória
  // do vizinho entra como contexto somente-leitura, nunca escrita — a store
  // aberta aqui nunca recebe `put`/`supersede`/`compact`, só `query`, e usa
  // um índice de busca em memória pra não deixar rastro no `.uranus` alheio.
  const linkedMemories: LinkedProjectMemory[] = []
  const linkedStores: MarkdownMemoryStore[] = []
  /** Vizinhos onde o Planner pode CRIAR item de backlog (`backlogWrite: true`). */
  const writableNeighbors = new Map<string, { root: string; description?: string }>()
  for (const link of options.config.linkedProjects) {
    const linkedRoot = resolve(rootDir, link.path)
    const alias = link.alias ?? basename(linkedRoot)

    // A permissão de escrita é independente da memória: um vizinho pode ter
    // backlog e não ter `.uranus/memory` (projeto novo, nunca rodado). Coletar
    // antes do `continue` abaixo evita que "sem memória" silenciosamente
    // signifique "sem escrita" — dois recursos que o dono liga em separado.
    if (link.backlogWrite) {
      writableNeighbors.set(alias, {
        root: linkedRoot,
        ...(link.description === undefined ? {} : { description: link.description }),
      })
    }

    const linkedMemoryDir = join(linkedRoot, '.uranus', 'memory')
    try {
      await stat(linkedMemoryDir)
    } catch {
      logger.warn('Projeto vinculado sem .uranus/memory; ignorado', { path: link.path })
      continue
    }
    const linkedStore = new MarkdownMemoryStore({
      dir: linkedMemoryDir,
      projectRootDir: linkedRoot,
      projectId: project.id,
      clock,
      logger,
      indexPath: ':memory:',
    })
    linkedStores.push(linkedStore)
    linkedMemories.push({
      alias,
      store: linkedStore,
      scopes: link.scopes,
      limit: link.limit,
    })
  }

  /**
   * Escrita de backlog no vizinho — a única exceção ao "vizinho é
   * somente-leitura" logo acima, e ela é estreita de propósito: backlog sim,
   * memória não. O item criado é uma pergunta endereçada ao outro time, não
   * uma alteração no trabalho dele.
   *
   * `undefined` quando ninguém tem `backlogWrite`, e é isso que faz o Planner
   * nem tomar conhecimento do recurso — um projeto sem vizinho gravável não
   * deve nem ser tentado a declarar dependência externa.
   */
  const crossProject: CrossProjectBacklog | undefined =
    writableNeighbors.size === 0
      ? undefined
      : {
          writableProjects: () =>
            [...writableNeighbors].map(([alias, neighbor]) => ({
              alias,
              ...(neighbor.description === undefined ? {} : { description: neighbor.description }),
            })),
          async create(input) {
            const neighbor = writableNeighbors.get(input.project)
            if (neighbor === undefined) {
              // O validador já recusa alias desconhecido; chegar aqui significa
              // que as duas listas divergiram, e escrever no lugar errado é
              // pior que falhar.
              return err(
                new ValidationError(`Projeto vinculado "${input.project}" não é gravável.`, {
                  context: { alias: input.project },
                }),
              )
            }
            const dir = crossProjectBacklogDir(neighbor.root)
            if (!dir.ok) return err(dir.error)

            const store = new FileBacklogStore({
              dir: dir.value,
              projectId: project.id,
              logger,
            })
            return createCrossProjectItem(store, input, clock.now())
          },
        }

  const packer = new DefaultContextPacker({ clock, logger })
  packer.addSource(digestSource(contextManager))
  packer.addSource(memorySource(memoryStore))
  if (linkedMemories.length > 0) packer.addSource(linkedMemorySource(linkedMemories))
  packer.addSource(codeSource())
  packer.addSource(readmeSource())
  for (const entry of pluginRegistrations.contextSources) packer.addSource(entry.value)

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
    providers: router,
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
    telemetry,
    plugins: pluginLoader,
  }

  const kernelConfig: KernelConfig = {
    tickIntervalMs: options.config.kernel.tickIntervalMs,
    idleBackoffMs: options.config.kernel.idleBackoffMs,
    leaseTtlMs: options.config.kernel.leaseTtlMs,
    checkpointKeep: 20,
    runRetentionKeep: 20,
    eventRetentionKeepSegments: options.config.telemetry.eventRetention.keepSegments,
    concurrency: options.config.kernel.concurrency,
    contextBudgetTokens: options.config.context.budgetTokens,
    integration: {
      strategy: options.config.integration.strategy,
      draftPullRequests: options.config.integration.draftPullRequests,
      prBase: options.config.project.vcs.defaultBranch,
    },
    providerId: options.providerOverride?.id ?? options.config.providers.default,
    commitTrailer: options.config.project.vcs.commitTrailer,
    escalationAgent: options.config.quality.escalationAgent,
    backlog: { autoPlan: options.config.backlog.autoPlan },
  }

  const backlog = new FileBacklogStore({
    dir: join(uranusDir, 'backlog'),
    projectId: project.id,
    logger,
  })

  const instructions = new FileInstructionsStore({
    dir: join(uranusDir, 'instructions'),
    logger,
  })

  const planning = new PlanningService({
    project,
    agents,
    agentRuntime,
    providers: router,
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
    ...(crossProject === undefined ? {} : { crossProject }),
    extraTestRunners: () => pluginRegistry.knownTestRunners(),
    // O Planner gasta como qualquer agente; sem isto ele ficava fora do INV-7.
    budget,
  })

  // Uma política, dois consumidores: o `GatePipeline` a usa para decidir o
  // bloqueio, o kernel para decidir o que vira task. Divergir entre os dois é
  // como se cria um achado que bloqueia mas não gera correção — ou o inverso.
  const gatePolicy: GatePolicy = {
    blockAt: options.config.quality.blockAt,
    followUpAt: options.config.quality.followUpAt,
    maxFindings: options.config.quality.maxFindings,
    maxGeneration: options.config.quality.followUp.maxGeneration,
    maxFollowUpsPerRun: options.config.quality.followUp.maxPerRun,
    followUpDenyCategories:
      options.config.quality.followUp.denyCategories.length > 0
        ? options.config.quality.followUp.denyCategories
        : DEFAULT_FOLLOW_UP_DENY_CATEGORIES,
  }

  // Cadeia de qualidade (Fase 5): roda entre a verificação por código e o
  // commit. Os agentes relatam findings; `applyGatePolicy` decide o bloqueio.
  const gates = new GatePipeline({
    project,
    agents,
    agentRuntime,
    providers: router,
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
    policy: gatePolicy,
    // Cada gate é uma sessão de modelo. Antes da Fase 7 esse gasto não entrava
    // no orçamento — e a cadeia de qualidade é justamente o que multiplica o
    // custo por task.
    budget,
  })

  // O kernel drena o backlog sozinho por esta porta (categoria ②): ele conhece
  // só a forma, e é aqui que ela encontra o `FileBacklogStore` e o
  // `PlanningService` — o pacote `kernel` não depende de `@uranus/backlog`.
  const backlogPort = createBacklogPort({
    backlog,
    planning,
    events,
    clock,
    digest: () => contextManager.digest(project),
    autoPlan: options.config.backlog.autoPlan,
    maxPlanningFailures: options.config.backlog.maxPlanningFailures,
  })

  const kernel = new UranusKernel({
    deps,
    project,
    config: kernelConfig,
    replanner: planning,
    backlog: backlogPort,
    ...(options.config.quality.enabled
      ? {
          gates,
          findingsToTasks: findingsToTaskDrafts,
          followUpPolicy: gatePolicy,
          // Achado recusado como task vai para o backlog em arquivo: o humano
          // lê, e promove o que quiser com `uranus plan`. Conter a cadeia sem
          // este destino seria trocar excesso de trabalho por perda de sinal.
          deferFinding: async ({ deferred, origin, agent }): Promise<void> => {
            const { finding, reason } = deferred
            await backlog.add({
              title: `${finding.category}: ${finding.title}`.slice(0, 120),
              body: [
                finding.detail,
                finding.suggestion === undefined
                  ? ''
                  : `\nCorreção sugerida: ${finding.suggestion}`,
                finding.file === undefined
                  ? ''
                  : `\nArquivo: ${finding.file}${finding.line === undefined ? '' : `:${String(finding.line)}`}`,
                `\nAchado por "${agent}" ao revisar a task ${origin.id} ("${origin.title}").`,
                `Não virou task automática: ${DEFERRAL_EXPLANATION[reason]}`,
              ]
                .filter((line) => line !== '')
                .join('\n'),
              labels: [`achado:${agent}`, `severidade:${finding.severity}`, `adiado:${reason}`],
              // Severidade vira prioridade para o humano triar por cima.
              priority: DEFERRED_PRIORITY[finding.severity],
              source: 'review',
              externalRef: origin.id,
              createdAt: clock.now(),
            })
          },
        }
      : {}),
  })

  return {
    kernel,
    backlog,
    planning,
    config: options.config,
    validations,
    dashboardData: createDashboardData({
      state,
      queue,
      backlog,
      instructions,
      memory: memoryStore,
      memoryManager,
      memoryDir: join(uranusDir, options.config.memory.dir),
      github: githubControl,
      projectId: project.id,
      projectDir: rootDir,
      projectName: options.config.project.name,
      maxAttemptsPerTask: options.config.kernel.maxAttemptsPerTask,
      now: () => clock.now(),
      logger,
    }),
    deps,
    project,
    state,
    eventStore,
    contextManager,
    memoryStore,
    plugins: { loader: pluginLoader, registry: pluginRegistry, report: pluginReport },
    observability: { telemetry, cost: costAccountant, aggregator },
    async close(): Promise<void> {
      detachCost()
      detachMetrics()
      aggregator.stop()
      await pluginLoader.deactivateAll()
      await memoryStore.close()
      for (const linkedStore of linkedStores) await linkedStore.close()
      await eventStore.close()
      state.close()
    },
  }
}

/** Texto que o humano lê no backlog explicando por que aquilo não virou task. */
const DEFERRAL_EXPLANATION: Record<DeferralReason, string> = {
  generation:
    'a task de origem já era uma correção, e correção de correção não gera trabalho novo (quality.followUp.maxGeneration).',
  category: 'a categoria informa mas não emprega (quality.followUp.denyCategories).',
  duplicate: 'este mesmo achado já virou task antes.',
  'run-budget': 'o run já atingiu o teto de correções derivadas (quality.followUp.maxPerRun).',
  severity: 'a severidade ficou abaixo do limiar de acompanhamento (quality.followUpAt).',
}

const DEFERRED_PRIORITY: Record<FindingSeverity, number> = {
  critical: 95,
  high: 80,
  medium: 55,
  low: 35,
  info: 20,
}

export function logEventLine(event: UranusEvent): string {
  return `${new Date(event.at).toISOString()} ${event.name} ${event.taskId ?? ''}`
}
