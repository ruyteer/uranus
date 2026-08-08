import type {
  AcceptanceContract,
  AgentOutput,
  AgentSpec,
  Attempt,
  DiffSummary,
  EventBus,
  Finding,
  GateOutcome,
  TaskDraft,
  Kernel,
  KernelDeps,
  KernelSnapshot,
  KernelStatus,
  Lease,
  ProjectDigest,
  ProjectRef,
  Provider,
  Result,
  RunId,
  StartOptions,
  Task,
  TaskId,
  TickPhase,
  TokenUsage,
  Verification,
  Workspace,
} from '@uranus/core'
import {
  EMPTY_USAGE,
  ZERO_USD,
  decideAfterFailure,
  digestOf,
  err,
  failureHistory,
  isRestrictedMode,
  isRetryableCategory,
  isTerminal,
  isUranusError,
  moneyFromMicros,
  newAttemptId,
  newRunId,
  newTaskId,
  ok,
  repeatedLastCategory,
  isOscillating,
  transition,
  unwrap,
} from '@uranus/core'

export interface KernelConfig {
  readonly tickIntervalMs: number
  readonly idleBackoffMs: number
  readonly leaseTtlMs: number
  readonly checkpointKeep: number
  readonly contextBudgetTokens: number
  readonly integration: {
    readonly strategy: 'pull-request' | 'branch-only' | 'direct'
    readonly draftPullRequests: boolean
    readonly pushRemote?: string
    readonly prBase: string
  }
  readonly providerId: string
  readonly commitTrailer?: string
  /** Agente para onde escalar após falhas repetidas (R3). Ex.: `bug-hunter`. */
  readonly escalationAgent?: string
}

/**
 * Replanejador injetado (Fase 4). Opcional: sem ele, uma task em `draft`
 * fica aguardando decisão humana em vez de ser decomposta automaticamente.
 */
export interface Replanner {
  replanTask(
    task: Task,
    digest: ProjectDigest | undefined,
    signal: AbortSignal,
  ): Promise<Result<{ created: readonly Task[] }>>
}

/** Cadeia de qualidade injetada (Fase 5). Sem ela, integra direto após o Verifier. */
export interface QualityGates {
  run(
    task: Task,
    workspace: Workspace,
    diff: DiffSummary,
    signal: AbortSignal,
  ): Promise<GateOutcome>
}

export interface UranusKernelOptions {
  readonly deps: KernelDeps
  readonly project: ProjectRef
  readonly config: KernelConfig
  readonly replanner?: Replanner
  readonly gates?: QualityGates
  /** Converte findings em tasks de correção. Injetado junto com os gates. */
  readonly findingsToTasks?: (
    findings: readonly Finding[],
    origin: Task,
    agent: string,
  ) => readonly TaskDraft[]
}

/**
 * Morte injetada pelo teste de caos. NUNCA capturada nem seguida de cleanup —
 * a fidelidade ao `kill -9` depende de deixar tudo exatamente como estava.
 */
export class CrashInjectedError extends Error {
  constructor(readonly phase: TickPhase) {
    super(`[chaos] crash injetado na fase "${phase}"`)
    this.name = 'CrashInjectedError'
  }
}

/**
 * Ponto de injeção do teste de caos. Em produção a env não está setada e isto
 * é um no-op. Dois modos:
 *  - `URANUS_CRASH_MODE=throw` — lança `CrashInjectedError`, que o kernel
 *    propaga sem qualquer limpeza (simulação em processo, usada na suíte).
 *  - default — `process.exit(137)`, o SIGKILL real (usado no teste com spawn).
 */
function crashPoint(phase: TickPhase): void {
  if (process.env['URANUS_CRASH_AT_PHASE'] !== phase) return
  if (process.env['URANUS_CRASH_MODE'] === 'throw') {
    throw new CrashInjectedError(phase)
  }
  // eslint-disable-next-line no-console
  console.error(`[chaos] crash injetado na fase "${phase}"`)
  process.exit(137)
}

interface RecentOutcome {
  taskId: TaskId
  status: string
  at: number
}

export class UranusKernel implements Kernel {
  readonly events: EventBus

  private readonly deps: KernelDeps
  private readonly project: ProjectRef
  private readonly config: KernelConfig
  private readonly replanner: Replanner | undefined
  private readonly gates: QualityGates | undefined
  private readonly findingsToTasks: UranusKernelOptions['findingsToTasks']

  private runId: RunId | undefined
  private state: KernelStatus['state'] = 'idle'
  private phase: TickPhase = 'idle'
  private tick = 0
  private startedAt: number | undefined
  private currentTask: TaskId | undefined
  private currentAgent: string | undefined
  private completedThisRun = 0
  private stopRequested: string | undefined
  private readonly recentOutcomes: RecentOutcome[] = []
  private readonly abort = new AbortController()
  private loopPromise: Promise<void> | undefined
  private queueStatsCache: KernelStatus['queue'] = {
    total: 0,
    byState: {} as KernelStatus['queue']['byState'],
    byKind: {} as KernelStatus['queue']['byKind'],
    deadLettered: 0,
  }

  constructor(options: UranusKernelOptions) {
    this.deps = options.deps
    this.project = options.project
    this.config = options.config
    this.replanner = options.replanner
    this.gates = options.gates
    this.findingsToTasks = options.findingsToTasks
    this.events = options.deps.events
  }

  // ── API pública ───────────────────────────────────────────────────────────

  async start(options: StartOptions): Promise<Result<RunId>> {
    if (this.state !== 'idle') {
      return err(new Error('Kernel já está em execução') as never)
    }

    const clock = this.deps.clock
    const resuming = options.resumeRunId !== undefined
    this.runId = options.resumeRunId ?? newRunId(clock.now())
    this.startedAt = clock.now()
    this.tick = 0
    this.completedThisRun = 0

    // Fase 0 — recover (INV-4).
    if (resuming || (await this.deps.recovery.needsRecovery(this.runId))) {
      this.state = 'recovering'
      this.phase = 'recover'
      await this.events.emit('RecoveryStarted', { runId: this.runId })
      const recovered = await this.deps.recovery.recover(this.runId, this.abort.signal)
      if (!recovered.ok) return err(recovered.error)
      await this.events.emit('RecoveryCompleted', {
        runId: this.runId,
        eventsReplayed: recovered.value.eventsReplayed,
        tasksReset: recovered.value.tasksReset.length,
        orphansFound: recovered.value.orphanWorkspaces.length,
      })
    }

    await this.deps.runs.save({
      id: this.runId,
      projectId: options.projectId,
      startedAt: this.startedAt,
      status: 'running',
      tick: 0,
      ...(resuming ? { resumedFrom: options.resumeRunId } : {}),
    })

    this.state = 'running'
    await this.events.emit(
      'KernelStarted',
      {
        runId: this.runId,
        concurrency: 1,
        ...(resuming ? { resumedFrom: options.resumeRunId } : {}),
      },
      { runId: this.runId },
    )

    this.loopPromise = this.loop(options).catch(async (error: unknown) => {
      if (error instanceof CrashInjectedError) {
        // Fidelidade ao kill -9: nenhuma limpeza, nenhum registro. O estado em
        // disco fica exatamente como estava no instante da "morte".
        this.state = 'idle'
        return
      }
      this.deps.logger.error('Loop do kernel abortou', {
        error: error instanceof Error ? error.message : String(error),
      })
      await this.finishRun('failed', `erro fatal: ${String(error)}`)
    })

    return ok(this.runId)
  }

  async stop(reason: string): Promise<void> {
    this.stopRequested = reason
    this.abort.abort()
    await this.loopPromise
  }

  pause(): Promise<void> {
    if (this.state === 'running') this.state = 'paused'
    return Promise.resolve()
  }

  resume(): Promise<void> {
    if (this.state === 'paused') this.state = 'running'
    return Promise.resolve()
  }

  /** Aguarda o loop terminar sozinho (fila vazia / maxTasks / until). */
  async wait(): Promise<void> {
    await this.loopPromise
  }

  status(): KernelStatus {
    return {
      ...(this.runId === undefined ? {} : { runId: this.runId }),
      state: this.state,
      phase: this.phase,
      ...(this.currentTask === undefined ? {} : { currentTask: this.currentTask }),
      ...(this.currentAgent === undefined ? {} : { currentAgent: this.currentAgent }),
      tick: this.tick,
      ...(this.startedAt === undefined ? {} : { startedAt: this.startedAt }),
      budget: this.deps.budget.state(),
      queue: this.queueStatsCache,
    }
  }

  // ── Loop principal ────────────────────────────────────────────────────────

  private async loop(options: StartOptions): Promise<void> {
    const clock = this.deps.clock

    while (this.stopRequested === undefined) {
      if (options.until !== undefined && clock.now() >= options.until) {
        this.stopRequested = 'horário limite atingido'
        break
      }
      if (options.maxTasks !== undefined && this.completedThisRun >= options.maxTasks) {
        this.stopRequested = `maxTasks (${String(options.maxTasks)}) atingido`
        break
      }
      if (this.state === 'paused') {
        await clock.sleep(this.config.tickIntervalMs).catch(() => undefined)
        continue
      }

      this.tick += 1
      await this.events.emit(
        'TickStarted',
        { runId: this.runId!, tick: this.tick },
        { runId: this.runId! },
      )
      const tickStarted = clock.monotonic()

      const outcome = await this.runTick(options)

      await this.events.emit(
        'TickCompleted',
        {
          runId: this.runId!,
          tick: this.tick,
          phase: this.phase,
          durationMs: Math.round(clock.monotonic() - tickStarted),
        },
        { runId: this.runId! },
      )

      if (outcome === 'drained') {
        this.stopRequested = 'não há mais tasks executáveis'
        break
      }
      if (outcome === 'idle') {
        await clock.sleep(this.config.idleBackoffMs, this.abort.signal).catch(() => undefined)
      }
    }

    await this.finishRun('completed', this.stopRequested)
  }

  private async runTick(options: StartOptions): Promise<'worked' | 'idle' | 'drained'> {
    const { clock, queue, scheduler } = this.deps
    const now = clock.now()

    // 1 — sense
    this.phase = 'sense'
    crashPoint('sense')
    await queue.reapExpired(now)
    const stats = await queue.stats()
    this.queueStatsCache = stats

    const digest = await this.deps.contextManager.digest(this.project)

    // 1.5 — replanejamento: tasks em `draft` são decompostas antes de tudo.
    // Sem isto, um replan deixaria a task parada para sempre (comportamento da
    // Fase 2, agora fechado).
    if (stats.byState.draft > 0) {
      const replanned = await this.drainDraftTasks(digest)
      if (replanned) {
        await this.checkpointNow()
        return 'worked'
      }
    }

    // Fila drenada? (nada ready/ativo — só terminais e bloqueados)
    const workable =
      stats.byState.ready +
      stats.byState.claimed +
      stats.byState.running +
      stats.byState.verifying +
      stats.byState.verified +
      stats.byState.integrating +
      stats.byState.failed
    if (workable === 0) {
      await this.checkpointNow()
      return 'drained'
    }

    // 2 — select
    this.phase = 'select'
    crashPoint('select')
    const context = {
      now,
      stats,
      budget: this.deps.budget.state(),
      activeLeases: await queue.activeLeases(now),
      recentOutcomes: this.recentOutcomes.slice(-50),
      mix: {},
      observedMix: {},
      providerHealth: {},
      restrictedMode: digest !== undefined && isRestrictedMode(digest),
    }
    const task = await scheduler.next(context, this.abort.signal)
    if (task === null) {
      await this.checkpointNow()
      return 'idle'
    }
    this.currentTask = task.id

    // 3 — admit
    this.phase = 'admit'
    crashPoint('admit')
    const admitted = await this.admit(task)
    if (!admitted.ok) {
      await this.blockTask(task, 'budget', admitted.error.message)
      await this.checkpointNow()
      return 'worked'
    }
    const { agent, provider } = admitted.value

    const lease = await queue.claim(
      task.id,
      `kernel:${this.runId ?? ''}`,
      this.config.leaseTtlMs,
      now,
    )
    if (!lease.ok) {
      // Outro caminho pegou a task entre select e claim; tick seguinte resolve.
      await this.checkpointNow()
      return 'idle'
    }

    // 4..8 — prepare/execute/verify/integrate/learn (com lease seguro)
    try {
      await this.executeTask(task, agent, provider, lease.value, options)
    } finally {
      this.currentTask = undefined
      this.currentAgent = undefined
    }

    // 9 — checkpoint (INV-4: todo tick termina aqui)
    await this.checkpointNow()
    return 'worked'
  }

  /**
   * Decompõe tasks em `draft` via replanejador. Sem replanejador injetado,
   * bloqueia com motivo acionável — nunca deixa a task em limbo silencioso.
   */
  private async drainDraftTasks(digest: ProjectDigest | undefined): Promise<boolean> {
    const drafts = await this.deps.tasks.byState('draft')
    if (drafts.length === 0) return false

    let progressed = false

    for (const task of drafts) {
      if (this.abort.signal.aborted) break

      if (this.replanner === undefined) {
        await this.blockTask(
          task,
          'human',
          'Task devolvida para replanejamento, mas nenhum Planner está configurado.',
        )
      } else {
        this.deps.logger.info('Replanejando task', { taskId: task.id, title: task.title })
        const result = await this.replanner.replanTask(task, digest, this.abort.signal)
        if (result.ok) {
          await this.events.emit(
            'TaskReplanned',
            {
              taskId: task.id,
              reason: `decomposta em ${String(result.value.created.length)} tasks`,
            },
            { runId: this.runId!, taskId: task.id },
          )
        } else {
          await this.blockTask(
            task,
            'human',
            `Replanejamento falhou: ${result.error.message.slice(0, 300)}`,
          )
        }
      }

      // Só conta como progresso se a task REALMENTE saiu de `draft`. Sem esta
      // verificação, uma transição recusada faria o tick reportar trabalho e o
      // loop giraria para sempre sobre a mesma task.
      const after = await this.deps.tasks.find(task.id)
      if (after?.state !== 'draft') progressed = true
      else {
        this.deps.logger.error('Task presa em draft após replanejamento; abandonando', {
          taskId: task.id,
        })
        const abandoned = transition(task, 'abandoned', { at: this.deps.clock.now() })
        if (abandoned.ok) {
          await this.deps.queue.update(abandoned.value)
          await this.events.emit(
            'TaskAbandoned',
            { taskId: task.id, reason: 'não foi possível replanejar nem bloquear' },
            { runId: this.runId!, taskId: task.id },
          )
          progressed = true
        }
      }
    }
    return progressed
  }

  private async admit(task: Task): Promise<Result<{ agent: AgentSpec; provider: Provider }>> {
    // Duas passadas de propósito. Escolher o agente exige conhecer as
    // capacidades de algum provider; rotear por agente exige conhecer o agente.
    // A primeira passada usa o provider padrão só para resolver o agente; a
    // segunda roteia de verdade, agora sabendo o papel e o tier.
    const base = this.deps.providers.resolve({ preferred: this.config.providerId })
    if (!base.ok) return base

    const agent = this.deps.agents.resolve(task, base.value.capabilities)
    if (!agent.ok) return agent

    // Sem `preferred` aqui de propósito: `config.providerId` é o PADRÃO, não
    // uma escolha explícita para esta chamada. Passá-lo como preferido faria
    // ele vencer o roteamento por papel e anularia o `byAgent` por completo.
    const routed = this.deps.providers.resolve({
      agent: agent.value.name,
      ...(agent.value.model?.tier === undefined ? {} : { tier: agent.value.model.tier }),
      ...(agent.value.requires === undefined ? {} : { capabilities: agent.value.requires }),
    })
    if (!routed.ok) return routed
    if (routed.value.id !== base.value.id) {
      this.deps.logger.debug('Provider roteado por papel/tier', {
        agent: agent.value.name,
        provider: routed.value.id,
      })
    }

    // INV-7: admissão a priori, com estimativa pessimista.
    this.deps.budget.resetTask()
    const estimatedTokens = this.config.contextBudgetTokens + agent.value.limits.maxTurns * 2_000
    const verdict = this.deps.budget.admit({
      cost: agent.value.limits.maxCost,
      tokens: estimatedTokens,
      wallclockMs: agent.value.limits.maxWallclockMs,
    })
    for (const warning of verdict.warnings) {
      await this.events.emit('BudgetThresholdReached', {
        window: warning.window,
        dimension: warning.dimension,
        ratio: 0.8,
      })
    }
    if (!verdict.admitted) {
      await this.events.emit('BudgetExhausted', {
        window: verdict.exceeded?.window ?? 'run',
        dimension: verdict.exceeded?.dimension ?? 'cost',
        policy: 'block-task',
      })
      return err(
        new Error(
          `orçamento insuficiente (${verdict.exceeded?.window ?? '?'}/${verdict.exceeded?.dimension ?? '?'})`,
        ) as never,
      )
    }

    return ok({ agent: agent.value, provider: routed.value })
  }

  private async executeTask(
    task: Task,
    agent: AgentSpec,
    provider: Provider,
    lease: Lease,
    _options: StartOptions,
  ): Promise<void> {
    const { clock, queue } = this.deps
    this.currentAgent = agent.name

    // 5 — prepare
    this.phase = 'prepare'
    crashPoint('prepare')
    const prepared = await this.prepare(task, agent, provider)
    if (!prepared.ok) {
      await queue.release(lease, 'ready', clock.now())
      this.deps.logger.error('Prepare falhou', { taskId: task.id, error: prepared.error.message })
      return
    }
    const { workspace, attempt, running } = prepared.value

    let verification: Verification | undefined
    let agentOutput: AgentOutput | undefined
    let failureCategory: string | undefined
    let crashed = false

    try {
      // 6 — execute
      this.phase = 'execute'
      crashPoint('execute')
      await this.events.emit(
        'TaskStarted',
        { taskId: task.id, attemptId: attempt.id, agent: agent.name, provider: provider.id },
        { runId: this.runId!, taskId: task.id, attemptId: attempt.id },
      )

      const execController = new AbortController()
      const onKernelAbort = (): void => {
        execController.abort()
      }
      this.abort.signal.addEventListener('abort', onKernelAbort, { once: true })
      const watchdog = setTimeout(() => {
        execController.abort()
      }, agent.limits.maxWallclockMs)

      try {
        agentOutput = await this.deps.agentRuntime.run(
          agent,
          {
            task: running,
            attempt,
            workspace,
            context: prepared.value.contextPack,
            provider,
            logger: this.deps.logger.child({ taskId: task.id, agent: agent.name }),
          },
          execController.signal,
        )
      } finally {
        clearTimeout(watchdog)
        this.abort.signal.removeEventListener('abort', onKernelAbort)
      }

      // 7 — verify (INV-2: o único árbitro)
      this.phase = 'verify'
      crashPoint('verify')
      const verifying = unwrap(transition(running, 'verifying', { at: clock.now() }))
      await queue.update(verifying)

      const contract: AcceptanceContract = {
        checks: [...agent.successCriteria.checks, ...task.acceptance.checks],
        requireAll: true,
      }
      await this.events.emit(
        'VerificationStarted',
        { taskId: task.id, attemptId: attempt.id, checks: contract.checks.length },
        { runId: this.runId!, taskId: task.id, attemptId: attempt.id },
      )

      verification = await this.deps.verifier.verify(
        {
          contract,
          workspace,
          task: verifying,
          ...(agentOutput.structured === undefined
            ? {}
            : { structuredOutput: agentOutput.structured }),
        },
        this.abort.signal,
      )

      for (const result of verification.results) {
        await this.events.emit(
          result.passed ? 'CheckPassed' : 'CheckFailed',
          { taskId: task.id, result },
          { runId: this.runId!, taskId: task.id, attemptId: attempt.id },
        )
      }
      await this.events.emit(
        'VerificationCompleted',
        { taskId: task.id, attemptId: attempt.id, verification },
        { runId: this.runId!, taskId: task.id, attemptId: attempt.id },
      )

      if (verification.passed) {
        // 8 — integrate (com a cadeia de qualidade antes do commit)
        this.phase = 'integrate'
        crashPoint('integrate')
        const verified = unwrap(transition(verifying, 'verified', { at: clock.now() }))
        await queue.update(verified)

        const gateOutcome = await this.runQualityGates(verified, workspace)
        if (gateOutcome?.blocked === true) {
          // Findings bloqueantes: a task volta a falhar com o diagnóstico dos
          // gates, e as correções entram na fila como trabalho novo.
          failureCategory = 'review-blocked'
          await this.spawnFindingTasks(gateOutcome, verified)
          await this.handleFailure(
            verified,
            workspace,
            attempt,
            gateVerification(gateOutcome, verification),
            lease,
          )
        } else {
          if (gateOutcome !== undefined) await this.spawnFindingTasks(gateOutcome, verified)
          await this.integrate(verified, workspace, attempt, lease)
        }
      } else {
        failureCategory = verification.diagnosis?.category
        await this.handleFailure(verifying, workspace, attempt, verification, lease)
      }
    } catch (error: unknown) {
      if (error instanceof CrashInjectedError) {
        crashed = true // kill -9: sem tratamento nem contabilidade
        throw error
      }
      // Falha de infraestrutura (provider caiu, auth, abort, etc.)
      const message = error instanceof Error ? error.message : String(error)
      this.deps.logger.error('Execução falhou fora da verificação', {
        taskId: task.id,
        error: message,
      })
      failureCategory = 'provider-error'
      // INV-7: uma sessão que morreu no meio pode ter consumido tokens reais.
      // O ProviderError carrega o usage/custo apurado até a morte.
      if (isUranusError(error)) {
        const usage = error.context['usage'] as TokenUsage | undefined
        const costMicros = error.context['costMicros'] as number | undefined
        if (usage !== undefined || costMicros !== undefined) {
          agentOutput = {
            summary: message,
            memoryDrafts: [],
            followUps: [],
            usage: usage ?? EMPTY_USAGE,
            cost: moneyFromMicros(costMicros ?? 0),
          }
        }
      }
      const current = (await queue.get(task.id)) ?? running
      await this.handleFailure(
        current,
        workspace,
        attempt,
        {
          passed: false,
          results: [],
          durationMs: 0,
          diagnosis: {
            category: 'provider-error',
            summary: message,
            evidence: [{ kind: 'event', ref: 'provider', excerpt: message.slice(0, 1_000) }],
            suggestedAction: 'retry',
          },
        },
        lease,
      )
    } finally {
      // 8.5 — learn: contabilidade sempre acontece, mesmo em falha (INV-7).
      // Exceção única: morte injetada — kill -9 não executa finally de verdade.
      if (crashed) {
        // eslint-disable-next-line no-unsafe-finally
        throw new CrashInjectedError(this.phase)
      }
      this.phase = 'learn'
      crashPoint('learn')
      const usage = agentOutput?.usage ?? EMPTY_USAGE
      const cost = agentOutput?.cost ?? ZERO_USD
      this.deps.budget.consume({
        usage,
        cost,
        wallclockMs: Math.max(0, clock.now() - attempt.startedAt),
      })
      await this.events.emit(
        'TokensConsumed',
        { taskId: task.id, usage, cost, provider: provider.id },
        { runId: this.runId!, taskId: task.id },
      )
      this.recentOutcomes.push({
        taskId: task.id,
        status: verification?.passed === true ? 'done' : 'failed',
        at: clock.now(),
      })
      if (failureCategory !== undefined) {
        this.deps.telemetry.counter('task.failures', 1, { category: failureCategory })
      }

      // Memória: fatos propostos pelo agente passam pela curadoria do
      // MemoryManager (dedupe, piso de confiança, contradição → evento).
      // Após um sucesso, a manutenção revalida refs e compacta escopos cheios.
      if (agentOutput !== undefined && agentOutput.memoryDrafts.length > 0) {
        await this.deps.memoryManager.remember(agentOutput.memoryDrafts).catch((error: unknown) => {
          this.deps.logger.warn('Falha ao gravar memória do agente', {
            error: error instanceof Error ? error.message : String(error),
          })
          return []
        })
      }
      if (verification?.passed === true) {
        await this.deps.memoryManager.maintain(this.abort.signal).catch(() => [])
      }
    }
  }

  private async prepare(
    task: Task,
    agent: AgentSpec,
    provider: Provider,
  ): Promise<
    Result<{
      workspace: Workspace
      attempt: Attempt
      running: Task
      contextPack: Awaited<ReturnType<KernelDeps['context']['pack']>>
    }>
  > {
    const { clock, sandbox, queue } = this.deps

    const acquired = await sandbox.acquire(task, this.abort.signal)
    if (!acquired.ok) return acquired
    const workspace = acquired.value

    await this.events.emit(
      'WorkspaceCreated',
      {
        workspaceId: workspace.id,
        taskId: task.id,
        branch: workspace.branch,
        rootDir: workspace.rootDir,
      },
      { runId: this.runId!, taskId: task.id },
    )

    const previousAttempts = await this.deps.attempts.byTask(task.id)
    const lastDiagnosis = previousAttempts.at(-1)?.outcome?.diagnosis

    const contextPack = await this.deps.context.pack(
      {
        budgetTokens: this.config.contextBudgetTokens,
        sectionBudgets: {},
        agent,
        task,
        project: this.project,
        mustInclude: [],
        hints: [],
      },
      this.abort.signal,
    )
    await this.events.emit('ContextPackBuilt', {
      digest: contextPack.digest,
      tokens: contextPack.tokens,
      budgetTokens: contextPack.budgetTokens,
      dropped: contextPack.dropped.length,
      agent: agent.name,
    })

    const attempt: Attempt = {
      id: newAttemptId(clock.now()),
      taskId: task.id,
      n: task.attempts + 1,
      agent: agent.name,
      provider: provider.id,
      model: 'default',
      contextDigest: contextPack.digest,
      workspaceId: workspace.id,
      startedAt: clock.now(),
      usage: EMPTY_USAGE,
      cost: ZERO_USD,
      // O diagnóstico anterior viaja no attempt para o prompt de retry (R3).
      ...(lastDiagnosis === undefined
        ? {}
        : { outcome: { status: 'failed' as const, diagnosis: lastDiagnosis } }),
    }
    const savedAttempt = await this.deps.attempts.save(attempt)
    if (!savedAttempt.ok) return savedAttempt

    const claimed = (await queue.get(task.id)) ?? task
    const running = unwrap(transition(claimed, 'running', { at: clock.now(), countAttempt: true }))
    await queue.update(running)

    return ok({ workspace, attempt, running, contextPack })
  }

  /**
   * Escolhe o agente da próxima tentativa quando a política pede escalada.
   *
   * Só escala se o agente-alvo estiver registrado — a config decide quais
   * agentes existem, e o kernel não inventa nenhum.
   */
  /** Há um agente especializado registrado e ainda não usado nesta task? */
  private canEscalate(task: Task): boolean {
    const target = this.config.escalationAgent
    if (target === undefined || task.agentHint === target) return false
    // Basta estar registrado: o `agentHint` ignora o roteamento por `handles`,
    // que é justamente o que permite escalar uma task de qualquer tipo para o
    // especialista sem que ele vire a escolha padrão daquele tipo.
    return this.deps.agents.get(target) !== undefined
  }

  private escalateAgent(task: Task, action: string, attemptCount: number): Task {
    if (task.state !== 'ready' || !this.canEscalate(task)) return task
    if (action !== 'escalate' && attemptCount < 2) return task

    const target = this.config.escalationAgent!
    this.deps.logger.info('Escalando para agente especializado', {
      taskId: task.id,
      from: task.agentHint ?? '(padrão)',
      to: target,
      attempts: attemptCount,
    })
    return { ...task, agentHint: target }
  }

  /** Cadeia de qualidade. Sem gates injetados, integra direto após o Verifier. */
  private async runQualityGates(
    task: Task,
    workspace: Workspace,
  ): Promise<GateOutcome | undefined> {
    if (this.gates === undefined) return undefined

    const diff = await this.deps.vcs.diff(workspace.rootDir, {
      base: workspace.baseCommit,
      includeUntracked: true,
    })
    if (!diff.ok) return undefined

    const outcome = await this.gates.run(task, workspace, diff.value, this.abort.signal)
    this.deps.logger.info('Cadeia de qualidade concluída', {
      taskId: task.id,
      gates: outcome.reports.length,
      blocked: outcome.blocked,
      findings: outcome.reports.reduce((total, report) => total + report.findings.length, 0),
    })
    return outcome
  }

  /** Findings não-bloqueantes viram trabalho na fila em vez de virarem nada. */
  private async spawnFindingTasks(outcome: GateOutcome, origin: Task): Promise<void> {
    if (this.findingsToTasks === undefined) return

    for (const report of outcome.reports) {
      // Bloqueantes viram tasks também: a correção precisa existir como
      // trabalho rastreável, não só como motivo de falha.
      const findings = report.blocked ? report.blockingFindings : []
      const followUps = outcome.followUps.filter((finding) => report.findings.includes(finding))
      const drafts = this.findingsToTasks([...findings, ...followUps], origin, report.agent)

      for (const draft of drafts) {
        const now = this.deps.clock.now()
        const task: Task = {
          id: newTaskId(now),
          projectId: origin.projectId,
          kind: draft.kind,
          title: draft.title,
          intent: draft.intent,
          state: 'ready',
          priority: draft.kind === 'security' ? 90 : 70,
          deps: [],
          touches: draft.touches,
          acceptance: draft.acceptance,
          attempts: 0,
          maxAttempts: draft.maxAttempts ?? origin.maxAttempts,
          labels: [...(draft.labels ?? [])],
          createdAt: now,
          updatedAt: now,
        }
        const queued = await this.deps.queue.enqueue(task)
        if (queued.ok) {
          await this.events.emit(
            'TaskCreated',
            { taskId: task.id, kind: task.kind, title: task.title },
            { runId: this.runId!, taskId: task.id },
          )
        } else {
          this.deps.logger.warn('Task de correção rejeitada na admissão', {
            title: task.title,
            error: queued.error.message,
          })
        }
      }
    }
  }

  private async integrate(
    task: Task,
    workspace: Workspace,
    attempt: Attempt,
    lease: Lease,
  ): Promise<void> {
    const { clock, vcs, queue } = this.deps
    const now = clock.now()

    const integrating = unwrap(transition(task, 'integrating', { at: now }))
    await queue.update(integrating)

    const diff = await vcs.diff(workspace.rootDir, {
      base: workspace.baseCommit,
      includeUntracked: true,
    })
    const diffSummary = diff.ok
      ? diff.value
      : { files: [], totalAdded: 0, totalRemoved: 0, isEmpty: true }

    await vcs.stage(workspace.rootDir, [])
    const subject = `${task.kind}: ${task.title}`
    const body = `${task.intent.slice(0, 1_000)}\n\nTask: ${task.id}\nAttempt: ${String(attempt.n)}`

    // Commit é efeito irreversível: passa por propose (interceptors podem vetar).
    const proposal = await this.events.propose(
      'CommitCreated',
      { taskId: task.id, sha: 'pending', subject, diff: diffSummary },
      { runId: this.runId!, taskId: task.id },
    )
    if (!proposal.accepted) {
      await this.blockTask(
        integrating,
        'permission',
        `commit vetado: ${'reason' in proposal ? proposal.reason : 'defer'}`,
      )
      await queue.release(lease, 'blocked', now).catch(() => undefined)
      await this.deps.sandbox.release(workspace, 'keep')
      return
    }

    const committed = await vcs.commit(workspace.rootDir, {
      subject,
      body,
      ...(this.config.commitTrailer === undefined
        ? {}
        : { trailers: parseTrailer(this.config.commitTrailer) }),
    })
    if (!committed.ok) {
      await this.blockTask(integrating, 'provider', `commit falhou: ${committed.error.message}`)
      await queue.release(lease, 'blocked', now).catch(() => undefined)
      await this.deps.sandbox.release(workspace, 'keep')
      return
    }

    // Push + PR conforme a estratégia. Falha aqui NÃO desfaz o trabalho:
    // o commit existe na branch local; a task fica done com aviso.
    if (this.config.integration.strategy === 'pull-request') {
      const pushed = await vcs.push(workspace.rootDir, workspace.branch, { setUpstream: true })
      if (pushed.ok && this.deps.codeHost !== undefined) {
        const pr = await this.deps.codeHost.openPullRequest({
          repoDir: workspace.rootDir,
          head: workspace.branch,
          base: this.config.integration.prBase,
          title: subject,
          body: `${task.intent}\n\n---\nGerado pelo Uranus. Task \`${task.id}\`, tentativa ${String(attempt.n)}.`,
          draft: this.config.integration.draftPullRequests,
          labels: [],
        })
        if (pr.ok) {
          await this.events.emit(
            'PRCreated',
            { taskId: task.id, pr: pr.value },
            { runId: this.runId!, taskId: task.id },
          )
        } else {
          this.deps.logger.warn('PR não pôde ser aberto; branch permanece', {
            taskId: task.id,
            error: pr.error.message,
          })
        }
      } else if (!pushed.ok) {
        this.deps.logger.warn('Push falhou; commit permanece local', {
          taskId: task.id,
          branch: workspace.branch,
        })
      }
    }

    const done = unwrap(transition(integrating, 'done', { at: clock.now() }))
    await queue.release(lease, 'done', clock.now()).catch(() => undefined)
    await queue.update(done)

    const finalAttempt: Attempt = {
      ...attempt,
      finishedAt: clock.now(),
      outcome: {
        status: 'verified',
        diff: diffSummary,
        diffDigest: digestOf(diffSummary.files.map((f) => f.path)),
      },
    }
    await this.deps.attempts.save(finalAttempt)
    await this.deps.sandbox.release(workspace, 'discard') // branch fica; worktree sai
    await this.events.emit('WorkspaceReleased', {
      workspaceId: workspace.id,
      disposition: 'discard',
    })

    this.completedThisRun += 1
    await this.events.emit(
      'TaskCompleted',
      { taskId: task.id, attempts: done.attempts, totalCost: finalAttempt.cost },
      { runId: this.runId!, taskId: task.id },
    )
  }

  private async handleFailure(
    task: Task,
    workspace: Workspace,
    attempt: Attempt,
    verification: Verification,
    lease: Lease,
  ): Promise<void> {
    const { clock, queue } = this.deps
    const now = clock.now()
    const diagnosis = verification.diagnosis ?? {
      category: 'unknown' as const,
      summary: 'falha sem diagnóstico',
      evidence: [],
      suggestedAction: 'retry' as const,
    }

    const failed = task.state === 'failed' ? task : unwrap(transition(task, 'failed', { at: now }))
    await queue.update(failed)

    // Grava o attempt com o outcome ANTES de decidir — o histórico é a base do R3.
    const finished: Attempt = {
      ...attempt,
      finishedAt: now,
      outcome: { status: 'failed', verification, diagnosis },
    }
    await this.deps.attempts.save(finished)

    await this.events.emit(
      'TaskFailed',
      { taskId: task.id, attemptId: attempt.id, diagnosis },
      { runId: this.runId!, taskId: task.id, attemptId: attempt.id },
    )

    const history = await this.deps.attempts.byTask(task.id)
    const categories = failureHistory(history)
    const providerFailedRepeatedly =
      diagnosis.category === 'provider-error' &&
      categories.length >= 2 &&
      categories.at(-2) === 'provider-error'

    // Erro de infra repetido (auth quebrada, provider fora do ar) não é problema
    // de plano: replanejar não conserta nada e "draft" esconderia a causa.
    // Bloqueia com a mensagem do provider visível para o humano.
    const decision = providerFailedRepeatedly
      ? {
          next: 'blocked' as const,
          reason: 'provider falhou repetidamente',
          blockReason: {
            kind: 'provider' as const,
            message: diagnosis.summary.slice(0, 500),
            resolvableBy: 'human' as const,
          },
        }
      : decideAfterFailure(failed, {
          retryableCategory: isRetryableCategory(diagnosis.category),
          repeatedCategory: repeatedLastCategory(history) || isOscillating(history),
          suggestedAction: diagnosis.suggestedAction,
          escalationAvailable: this.canEscalate(failed),
        })

    const moved = transition(failed, decision.next, {
      at: now,
      ...(decision.blockReason === undefined ? {} : { blockReason: decision.blockReason }),
    })
    if (moved.ok) {
      // Escalada (R3): a próxima tentativa vai para um agente com método
      // diferente. Repetir o mesmo agente que já falhou duas vezes com o mesmo
      // contexto é a definição do loop que a política existe para quebrar.
      const escalated = this.escalateAgent(moved.value, diagnosis.suggestedAction, history.length)
      await queue.update(escalated)
    }

    await queue.release(lease, moved.ok ? moved.value.state : 'blocked', now).catch(() => undefined)

    if (decision.next === 'ready' || decision.next === 'draft') {
      await this.events.emit(
        decision.next === 'ready' ? 'TaskRetried' : 'TaskReplanned',
        decision.next === 'ready'
          ? { taskId: task.id, attempt: failed.attempts, reason: decision.reason }
          : { taskId: task.id, reason: decision.reason },
        { runId: this.runId!, taskId: task.id },
      )
    } else {
      await this.events.emit(
        'TaskBlocked',
        {
          taskId: task.id,
          kind: decision.blockReason?.kind ?? 'human',
          message: decision.blockReason?.message ?? decision.reason,
          resolvableBy: decision.blockReason?.resolvableBy ?? 'human',
        },
        { runId: this.runId!, taskId: task.id },
      )
    }

    // Workspace da falha: descartado no retry (a próxima tentativa parte limpa),
    // arquivado no bloqueio (o humano vai querer olhar).
    await this.deps.sandbox.release(workspace, decision.next === 'blocked' ? 'archive' : 'discard')
  }

  private async blockTask(
    task: Task,
    kind: 'budget' | 'permission' | 'provider' | 'human',
    message: string,
  ): Promise<void> {
    const now = this.deps.clock.now()
    const current = (await this.deps.queue.get(task.id)) ?? task
    if (isTerminal(current.state) || current.state === 'blocked') return
    const blocked = transition(current, 'blocked', {
      at: now,
      blockReason: { kind, message, resolvableBy: 'human' },
    })
    if (blocked.ok) {
      await this.deps.queue.update(blocked.value)
      await this.events.emit(
        'TaskBlocked',
        { taskId: task.id, kind, message, resolvableBy: 'human' },
        { runId: this.runId!, taskId: task.id },
      )
    }
  }

  private async checkpointNow(): Promise<void> {
    this.phase = 'checkpoint'
    crashPoint('checkpoint')
    const { queue, clock } = this.deps

    const tasks = await this.allTasks()
    const snapshot: KernelSnapshot = {
      phase: this.phase,
      tick: this.tick,
      tasks,
      leases: await queue.activeLeases(clock.now()),
      budget: this.deps.budget.state(),
      contextDigests: {},
      pendingApprovals: [],
    }

    const eventOffset = await this.deps.eventStore.head()
    const workspaces = await this.deps.sandbox.list()
    const created = await this.deps.checkpoints.create(
      this.runId!,
      snapshot,
      eventOffset,
      workspaces,
    )
    if (created.ok) {
      await this.events.emit(
        'CheckpointCreated',
        { checkpointId: created.value.id, eventOffset, digest: created.value.digest },
        { runId: this.runId! },
      )
      await this.deps.checkpoints.prune(this.runId!, this.config.checkpointKeep)
    } else {
      // INV-4: sem checkpoint não há garantia de recuperação — aborta o run.
      this.stopRequested = `checkpoint falhou: ${created.error.message}`
    }

    const run = await this.deps.runs.find(this.runId!)
    if (run !== undefined) {
      await this.deps.runs.save({ ...run, tick: this.tick })
    }
  }

  private async allTasks(): Promise<readonly Task[]> {
    const stats = await this.deps.queue.stats()
    void stats
    // O repositório é a fonte; a fila é acesso. Snapshot completo:
    const all: Task[] = []
    for (const state of [
      'draft',
      'ready',
      'claimed',
      'running',
      'verifying',
      'verified',
      'failed',
      'integrating',
      'blocked',
    ] as const) {
      for (const task of await this.deps.tasks.byState(state)) all.push(task)
    }
    return all
  }

  private async finishRun(
    status: 'completed' | 'failed',
    reason: string | undefined,
  ): Promise<void> {
    reason ??= 'parado'
    if (this.runId === undefined) return
    const run = await this.deps.runs.find(this.runId)
    if (run !== undefined && run.status !== 'completed' && run.status !== 'failed') {
      await this.deps.runs.save({
        ...run,
        status,
        finishedAt: this.deps.clock.now(),
        tick: this.tick,
        stopReason: reason,
      })
    }
    await this.events.emit(
      'KernelStopped',
      { runId: this.runId, reason, ticks: this.tick },
      { runId: this.runId },
    )
    this.state = 'idle'
    this.phase = 'idle'
  }
}

/**
 * Traduz um bloqueio de gate em `Verification` para reusar o caminho de falha.
 *
 * A categoria `out-of-scope` faria o replan; aqui a ação certa é `escalate`:
 * o código passou nos testes mas foi reprovado no julgamento, então repetir o
 * mesmo agente com o mesmo contexto tende a produzir o mesmo diff.
 */
function gateVerification(outcome: GateOutcome, base: Verification): Verification {
  const blocking = outcome.reports.flatMap((report) => report.blockingFindings)
  const byAgent = outcome.reports
    .filter((report) => report.blocked)
    .map((report) => report.agent)
    .join(', ')

  return {
    ...base,
    passed: false,
    diagnosis: {
      category: 'unknown',
      summary: `Bloqueado por ${byAgent}: ${String(blocking.length)} achado(s) de severidade alta ou crítica`,
      evidence: blocking.slice(0, 3).map((finding) => ({
        kind: 'event' as const,
        ref: finding.file ?? finding.category,
        excerpt: `[${finding.severity}] ${finding.title}\n${finding.detail}`.slice(0, 1_000),
      })),
      suggestedAction: 'escalate',
    },
  }
}

function parseTrailer(trailer: string): Record<string, string> {
  const index = trailer.indexOf(':')
  if (index < 0) return {}
  return { [trailer.slice(0, index).trim()]: trailer.slice(index + 1).trim() }
}
