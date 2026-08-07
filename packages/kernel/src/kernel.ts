import type {
  AcceptanceContract,
  AgentOutput,
  AgentSpec,
  Attempt,
  EventBus,
  Kernel,
  KernelDeps,
  KernelSnapshot,
  KernelStatus,
  Lease,
  ProjectRef,
  Provider,
  Result,
  RunId,
  StartOptions,
  Task,
  TaskId,
  TickPhase,
  Verification,
  Workspace,
} from '@uranus/core'
import {
  EMPTY_USAGE,
  ZERO_USD,
  decideAfterFailure,
  digestOf,
  err,
  isRestrictedMode,
  isRetryableCategory,
  isTerminal,
  newAttemptId,
  newRunId,
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
}

export interface UranusKernelOptions {
  readonly deps: KernelDeps
  readonly project: ProjectRef
  readonly config: KernelConfig
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

    // Fila drenada? (nada ready/draft/ativo — só terminais e bloqueados)
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
    const digest = await this.deps.contextManager.digest(this.project)
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

  private async admit(task: Task): Promise<Result<{ agent: AgentSpec; provider: Provider }>> {
    const provider = this.deps.providers.resolve({ preferred: this.config.providerId })
    if (!provider.ok) return provider

    const agent = this.deps.agents.resolve(task, provider.value.capabilities)
    if (!agent.ok) return agent

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

    return ok({ agent: agent.value, provider: provider.value })
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
        // 8 — integrate
        this.phase = 'integrate'
        crashPoint('integrate')
        const verified = unwrap(transition(verifying, 'verified', { at: clock.now() }))
        await queue.update(verified)
        await this.integrate(verified, workspace, attempt, lease)
      } else {
        failureCategory = verification.diagnosis?.category
        await this.handleFailure(verifying, workspace, attempt, verification, lease)
      }
    } catch (error: unknown) {
      if (error instanceof CrashInjectedError) {
        crashed = true // kill -9: sem tratamento nem contabilidade
        throw error
      }
      // Falha de infraestrutura (provider caiu, abort, etc.)
      const message = error instanceof Error ? error.message : String(error)
      this.deps.logger.error('Execução falhou fora da verificação', {
        taskId: task.id,
        error: message,
      })
      failureCategory = 'provider-error'
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
            evidence: [],
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
    const decision = decideAfterFailure(failed, {
      retryableCategory: isRetryableCategory(diagnosis.category),
      repeatedCategory: repeatedLastCategory(history) || isOscillating(history),
      suggestedAction: diagnosis.suggestedAction,
    })

    const moved = transition(failed, decision.next, {
      at: now,
      ...(decision.blockReason === undefined ? {} : { blockReason: decision.blockReason }),
    })
    if (moved.ok) await queue.update(moved.value)

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
    kind: 'budget' | 'permission' | 'provider',
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

function parseTrailer(trailer: string): Record<string, string> {
  const index = trailer.indexOf(':')
  if (index < 0) return {}
  return { [trailer.slice(0, index).trim()]: trailer.slice(index + 1).trim() }
}
