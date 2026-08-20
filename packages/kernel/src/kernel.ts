import type {
  AcceptanceContract,
  AgentOutput,
  AgentSpec,
  Attempt,
  BudgetState,
  BudgetVerdict,
  ContextFragment,
  ContextPack,
  CostEstimate,
  DeferredFinding,
  DiffSummary,
  EventBus,
  GatePolicy,
  GateOutcome,
  SpawnableFinding,
  TaskDraft,
  Kernel,
  KernelDeps,
  KernelSnapshot,
  KernelStatus,
  Lease,
  Money,
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
  ValidationPolicy,
  ValidationPolicyInput,
  Verification,
  Workspace,
} from '@uranus/core'
import {
  DEFAULT_GATE_POLICY,
  EMPTY_USAGE,
  effectiveContextBudget,
  estimateTokens,
  explainContextClamp,
  ZERO_USD,
  compareMoney,
  decideAfterFailure,
  digestOf,
  err,
  failureHistory,
  formatMoney,
  isBudgetExhausted,
  isRestrictedMode,
  isRetryableCategory,
  isTerminal,
  isUranusError,
  moneyFromMicros,
  newAttemptId,
  newRunId,
  newTaskId,
  ok,
  planFollowUps,
  resolveValidationPolicy,
  taskGeneration,
  taskRoot,
  repeatedLastCategory,
  isOscillating,
  transition,
  unwrap,
} from '@uranus/core'
import type { RepairBrief } from './repair.js'
import { buildRepairBrief, formatRepairItems } from './repair.js'

export interface KernelConfig {
  readonly tickIntervalMs: number
  readonly idleBackoffMs: number
  readonly leaseTtlMs: number
  readonly checkpointKeep: number
  /** Quantos runs terminados mantêm checkpoint; runs mais antigos são podados a zero (Fase 9). */
  readonly runRetentionKeep: number
  /** Segmentos de evento JSONL a manter antes de podar os mais antigos (Fase 9). */
  readonly eventRetentionKeepSegments: number
  readonly contextBudgetTokens: number
  /** Quantas tasks o kernel executa em paralelo (R6: leases por arquivo já suportam isto). */
  readonly concurrency: number
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
  /**
   * Backlog autônomo (`config.backlog`).
   *
   * Ausente ⇒ `autoPlan` ligado. Quem monta o kernel sem esta seção mas COM a
   * `BacklogPort` já declarou a intenção no ato de injetar a porta; herdar
   * "desligado" por omissão faria a porta existir sem nunca ser usada.
   */
  readonly backlog?: { readonly autoPlan: boolean }
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

/**
 * Backlog do projeto, visto pelo kernel (categoria ②, §5 e §6).
 *
 * Porta, e não dependência de `@uranus/backlog`: o kernel não conhece
 * `FileBacklogStore` nem o formato em disco dos itens — só o ciclo
 * "há algo a planejar? / planeje / uma task terminou". Mesmo padrão do
 * `deferFinding`: a composição liga, o kernel orquestra.
 *
 * Ausente ⇒ o backlog não é tocado, exatamente como antes desta categoria:
 * só planeja quem chamar `uranus plan`.
 */
export interface BacklogPort {
  /**
   * Próximo item elegível para planejamento automático, ou `undefined`.
   * A IMPLEMENTAÇÃO aplica o filtro (`state === 'open'` e teto de recusas).
   */
  nextPlannable(signal: AbortSignal): Promise<{ id: string; title: string } | undefined>
  /**
   * Planeja o item. A IMPLEMENTAÇÃO atualiza o item no store (estado, planId,
   * startedAt, planningFailures, lastRejections) e emite `BacklogItemPlanned`
   * ou `BacklogItemPlanningFailed`. Devolve o número de tasks enfileiradas,
   * ou `undefined` se o plano foi recusado.
   */
  plan(itemId: string, signal: AbortSignal): Promise<number | undefined>
  /**
   * Chamado quando uma task com `backlogItemId` chega a `done`. Recebe as
   * tasks irmãs (mesmo `backlogItemId`). A IMPLEMENTAÇÃO decide se o item
   * fechou e emite `BacklogItemCompleted`.
   */
  taskFinished(itemId: string, siblings: readonly Task[]): Promise<void>
}

export interface UranusKernelOptions {
  readonly deps: KernelDeps
  readonly project: ProjectRef
  readonly config: KernelConfig
  readonly replanner?: Replanner
  readonly gates?: QualityGates
  /** Converte findings já aprovados pela política em tasks. Injetado com os gates. */
  readonly findingsToTasks?: (
    spawnable: readonly SpawnableFinding[],
    origin: Task,
    agent: string,
  ) => readonly TaskDraft[]
  /**
   * Política de derivação. Sem ela vale `DEFAULT_GATE_POLICY` — nunca "sem
   * limite": um kernel montado por um chamador desatualizado precisa herdar a
   * contenção, não a ausência dela.
   */
  readonly followUpPolicy?: GatePolicy
  /**
   * Política de validação do projeto (forma parcial, como vem da config).
   *
   * Ausente ⇒ `DEFAULT_VALIDATION_POLICY`, e não "sem reparo": um kernel
   * montado por um chamador que ainda não conhece esta opção precisa herdar o
   * comportamento novo, que é o que resolve o ciclo de replanejamento — não
   * continuar no antigo em silêncio.
   */
  readonly validations?: ValidationPolicyInput
  /**
   * Destino dos achados que a política recusou como trabalho automático.
   *
   * Sem este destino, conter a cadeia seria perder informação — e perder
   * informação é o motivo pelo qual "derive tudo" parecia a escolha segura.
   * A composição liga isto ao backlog em arquivo: custo zero, o humano lê e
   * promove o que importa.
   */
  readonly deferFinding?: (input: {
    readonly deferred: DeferredFinding
    readonly origin: Task
    readonly agent: string
  }) => Promise<void>
  /**
   * Backlog autônomo. Ausente ⇒ o kernel nunca planeja sozinho nem fecha item
   * nenhum — o comportamento anterior a esta categoria, intacto.
   */
  readonly backlog?: BacklogPort
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

let chaosPhaseHitCount = 0

/** Só pra suíte de chaos concorrente resetar a contagem entre casos. */
export function __resetChaosCounter(): void {
  chaosPhaseHitCount = 0
}

/**
 * Ponto de injeção do teste de caos. Em produção a env não está setada e isto
 * é um no-op. Dois modos:
 *  - `URANUS_CRASH_MODE=throw` — lança `CrashInjectedError`, que o kernel
 *    propaga sem qualquer limpeza (simulação em processo, usada na suíte).
 *  - default — `process.exit(137)`, o SIGKILL real (usado no teste com spawn).
 *
 * `URANUS_CRASH_AT_COUNT` (opcional, Fase 9): crasha só na N-ésima vez que a
 * fase é atingida, em vez da primeira. Sem ele, comportamento idêntico ao de
 * sempre — permite forçar uma interleaving real entre 2+ workers em voo sem
 * precisar identificar qual task é qual.
 */
function crashPoint(phase: TickPhase): void {
  if (process.env['URANUS_CRASH_AT_PHASE'] !== phase) return
  const atCount = process.env['URANUS_CRASH_AT_COUNT']
  if (atCount !== undefined) {
    chaosPhaseHitCount += 1
    if (chaosPhaseHitCount !== Number(atCount)) return
  }
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

/** Estado por task em voo. Substitui os escalares únicos (`phase`/`currentAgent`)
 * que só faziam sentido com uma task de cada vez. */
interface WorkerState {
  readonly slot: number
  readonly taskId: TaskId
  readonly agent: string
  phase: TickPhase
}

const MAX_RECENT_OUTCOMES = 200

export class UranusKernel implements Kernel {
  readonly events: EventBus

  private readonly deps: KernelDeps
  private readonly project: ProjectRef
  private readonly config: KernelConfig
  private readonly replanner: Replanner | undefined
  private readonly gates: QualityGates | undefined
  private readonly findingsToTasks: UranusKernelOptions['findingsToTasks']
  private readonly followUpPolicy: GatePolicy
  private readonly validations: ValidationPolicy
  private readonly deferFinding: UranusKernelOptions['deferFinding']
  private readonly backlog: BacklogPort | undefined

  private runId: RunId | undefined
  private state: KernelStatus['state'] = 'idle'
  private phase: TickPhase = 'idle'
  private tick = 0
  private startedAt: number | undefined
  private currentTask: TaskId | undefined
  private currentAgent: string | undefined
  private completedThisRun = 0
  private stopRequested: string | undefined
  /**
   * Um por run: sem isto, `BudgetExhausted` sairia a cada tick ocioso (5s em
   * 5s) enquanto o orçamento continuasse estourado — o mesmo ruído que o
   * evento existe pra evitar.
   */
  private budgetExhaustedNotified = false
  /** Tasks derivadas de achado neste run — contra `maxFollowUpsPerRun`. */
  private followUpsThisRun = 0
  /**
   * Fingerprints que já viraram task. Semeado do banco no `start` (portanto
   * cobre runs anteriores) e atualizado a cada derivação.
   */
  private readonly knownFingerprints = new Set<string>()
  private readonly recentOutcomes: RecentOutcome[] = []
  private readonly inFlight = new Map<TaskId, Promise<void>>()
  private readonly inFlightState = new Map<TaskId, WorkerState>()
  private nextSlot = 0
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
    this.followUpPolicy = options.followUpPolicy ?? DEFAULT_GATE_POLICY
    this.validations = resolveValidationPolicy(options.validations)
    this.deferFinding = options.deferFinding
    this.backlog = options.backlog
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
    this.budgetExhaustedNotified = false
    this.followUpsThisRun = 0
    await this.seedKnownFingerprints()
    // Sem isto, reiniciar o mesmo kernel depois de um drain nunca funciona:
    // `loop()` checa `stopRequested === undefined` e o valor do drain
    // anterior ficava preso pra sempre, fazendo todo `start()` seguinte
    // terminar no tick 0 sem processar nada (achado pelo soak test da Fase 9).
    this.stopRequested = undefined

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
        concurrency: this.config.concurrency,
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
    const workers = [...this.inFlightState.values()].map((w) => ({
      taskId: w.taskId,
      agent: w.agent,
      phase: w.phase,
    }))
    // Compat: com exatamente 1 worker em voo, os campos singulares continuam
    // preenchidos como antes. Com 0 ou 2+, ficam `undefined` — honesto, em vez
    // de escolher arbitrariamente "a" task atual.
    const sole = workers.length === 1 ? workers[0] : undefined
    return {
      ...(this.runId === undefined ? {} : { runId: this.runId }),
      state: this.state,
      phase: this.phase,
      ...(sole === undefined ? {} : { currentTask: sole.taskId, currentAgent: sole.agent }),
      tick: this.tick,
      ...(this.startedAt === undefined ? {} : { startedAt: this.startedAt }),
      budget: this.deps.budget.state(),
      queue: this.queueStatsCache,
      workers,
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
      // Fila sem nada executável não é mais sinônimo de fim do run: o backlog
      // pode ter item esperando plano. Só drena quando não há nem trabalho
      // pronto nem item planejável (categoria ②, §5).
      if (await this.planFromBacklog()) return 'worked'
      await this.checkpointNow()
      return 'drained'
    }

    // Orçamento do run esgotado (INV-7): sem isto, `budgetAwarePolicy` vetava
    // toda task em silêncio dentro do scheduler — `BudgetExhausted` só era
    // emitido de dentro de `admit()`, que nunca é alcançado porque
    // `scheduler.next()` já devolve `null` antes disso. O resultado era um
    // loop mudo de `idleBackoffMs` em `idleBackoffMs`, pra sempre, sem
    // nenhum sinal de que o motivo era orçamento e não falta de trabalho.
    const budgetState = this.deps.budget.state()
    const exhaustedDimension = isBudgetExhausted(budgetState.run)
    if (exhaustedDimension !== undefined) {
      if (!this.budgetExhaustedNotified) {
        this.budgetExhaustedNotified = true
        await this.events.emit('BudgetExhausted', {
          window: 'run',
          dimension: exhaustedDimension,
          policy: budgetState.onExhausted,
        })
      }
      if (budgetState.onExhausted === 'stop') {
        this.stopRequested = `orçamento do run esgotado (${exhaustedDimension})`
        await this.checkpointNow()
        return 'drained'
      }
      // 'pause' e 'ask' têm o mesmo efeito prático (para de gastar até um
      // humano decidir) — a diferença é só o evento extra que 'ask' registra.
      if (this.state === 'running') {
        this.state = 'paused'
        await this.events.emit('KernelPaused', {
          runId: this.runId!,
          reason: `orçamento do run esgotado (${exhaustedDimension})`,
        })
        if (budgetState.onExhausted === 'ask') {
          await this.events.emit('HumanInterventionRequested', {
            reason: `Orçamento do run esgotado (${exhaustedDimension}) — aumente o limite ou encerre o run.`,
          })
        }
      }
      await this.checkpointNow()
      return 'idle'
    }

    // 2..4 — select/admit/claim: preenche slots livres. Um único "claimer"
    // sequencial por construção — não existe corrida de scheduler.next()/claim
    // entre workers, porque nunca há mais de um select+admit+claim em voo ao
    // mesmo tempo (cada iteração deste while só avança depois da anterior
    // resolver, mesmo que a EXECUÇÃO da task claimada não seja esperada aqui).
    let admittedAny = false
    while (this.inFlight.size < this.config.concurrency) {
      this.phase = 'select'
      crashPoint('select')
      const context = {
        now: clock.now(),
        stats,
        budget: this.deps.budget.state(),
        activeLeases: await queue.activeLeases(clock.now()),
        recentOutcomes: this.recentOutcomes.slice(-50),
        mix: {},
        observedMix: {},
        providerHealth: {},
        restrictedMode: digest !== undefined && isRestrictedMode(digest),
      }
      const task = await scheduler.next(context, this.abort.signal)
      if (task === null) break

      if (this.inFlight.has(task.id)) {
        // `reapExpired()` no topo deste tick pode ter devolvido esta task pra
        // `ready` (lease expirado) enquanto a execução anterior DELA, neste
        // mesmo processo, ainda está em `this.inFlight` — sem esta checagem,
        // o claim abaixo teria sucesso (o estado no banco já voltou a
        // `ready`) e a MESMA task rodaria duas vezes em paralelo, cada uma
        // podendo chegar a `integrate()` e abrir seu próprio PR.
        this.deps.logger.warn(
          'Task selecionada já está em execução neste processo; adiando pro próximo tick',
          { taskId: task.id },
        )
        break
      }

      this.phase = 'admit'
      crashPoint('admit')
      const admitted = await this.admit(task)
      if (!admitted.ok) {
        await this.blockTask(task, 'budget', admitted.error.message)
        admittedAny = true
        break
      }
      const { agent, provider } = admitted.value

      const slot = this.nextSlot
      this.nextSlot = (this.nextSlot + 1) % Math.max(1, this.config.concurrency)
      const lease = await queue.claim(
        task.id,
        `kernel:${this.runId ?? ''}:worker:${String(slot)}`,
        this.config.leaseTtlMs,
        clock.now(),
      )
      if (!lease.ok) {
        // Outro caminho pegou a task entre select e claim; tick seguinte resolve.
        break
      }

      const worker: WorkerState = { slot, taskId: task.id, agent: agent.name, phase: 'prepare' }
      this.inFlightState.set(task.id, worker)
      const running = this.executeTask(task, agent, provider, lease.value, options, worker).finally(
        () => {
          this.inFlight.delete(task.id)
          this.inFlightState.delete(task.id)
        },
      )
      this.inFlight.set(task.id, running)
      admittedAny = true
    }

    // 5..9 — prepare/execute/verify/integrate/learn rodam nas tasks já em
    // voo. Espera pelo menos uma liquidar antes de fechar o tick — mantém o
    // mesmo invariante de hoje (checkpoint nunca fica muito atrás do
    // trabalho real), só generalizado de 1 para N tasks simultâneas.
    if (this.inFlight.size > 0) {
      await Promise.race(this.inFlight.values())
      await this.checkpointNow()
      return 'worked'
    }

    await this.checkpointNow()
    return admittedAny ? 'worked' : 'idle'
  }

  /**
   * Nada executável na fila: antes de encerrar o run, transforma UM item do
   * backlog em tasks. Devolve `true` quando houve planejamento (o tick conta
   * como trabalho e o loop segue), `false` quando não há nada a planejar.
   *
   * **"Um item de cada vez" sai daqui de graça**, sem trava nem campo de "item
   * corrente": enquanto sobrar uma task executável do item anterior, este
   * ponto do tick nem é alcançado.
   */
  private async planFromBacklog(): Promise<boolean> {
    const backlog = this.backlog
    if (backlog === undefined) return false
    if (this.config.backlog?.autoPlan === false) return false
    if (this.abort.signal.aborted) return false

    // Planejar é uma sessão de modelo: custa tokens e dinheiro como qualquer
    // outra. A checagem de orçamento do tick vem DEPOIS deste ponto de
    // propósito (ela pausa o kernel, e pausar só faz sentido quando existe
    // trabalho a retomar) — sem o veto aqui, um run com o orçamento estourado
    // drenaria o backlog inteiro planejando item atrás de item sem nunca
    // executar nada. É o R2 em pessoa: gastar sem produzir.
    const budgetState = this.deps.budget.state()
    const exhaustedDimension = isBudgetExhausted(budgetState.run)
    if (exhaustedDimension !== undefined) {
      if (!this.budgetExhaustedNotified) {
        this.budgetExhaustedNotified = true
        await this.events.emit('BudgetExhausted', {
          window: 'run',
          dimension: exhaustedDimension,
          policy: budgetState.onExhausted,
        })
      }
      this.deps.logger.warn('Orçamento do run esgotado; o backlog não será planejado', {
        dimensao: exhaustedDimension,
      })
      return false
    }

    try {
      const item = await backlog.nextPlannable(this.abort.signal)
      if (item === undefined) return false

      this.deps.logger.info('Planejando item do backlog', { item: item.id, titulo: item.title })
      const tasks = await backlog.plan(item.id, this.abort.signal)
      if (tasks === undefined) {
        // Plano recusado. O tick ainda conta como trabalho: a porta registrou a
        // recusa, e é o contador dela que faz o próximo tick tentar OUTRO item
        // em vez de reincidir neste para sempre.
        this.deps.logger.warn('Plano do item do backlog foi recusado', { item: item.id })
      } else {
        this.deps.logger.info('Item do backlog virou trabalho', { item: item.id, tasks })
      }
      await this.checkpointNow()
      return true
    } catch (error: unknown) {
      // Exceção não é recusa: a porta pode não ter contabilizado nada, e
      // devolver `true` aqui giraria o loop para sempre sobre o mesmo item.
      // Drenar deixa o erro visível e para de gastar.
      this.deps.logger.error('Planejamento automático do backlog falhou; encerrando o run', {
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    }
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
    const estimate = this.estimateFor(agent.value, routed.value)
    const verdict = this.deps.budget.admit(estimate)
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
          explainBudgetRefusal(verdict, agent.value, estimate, this.deps.budget.state()),
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
    worker: WorkerState,
  ): Promise<void> {
    const { clock, queue } = this.deps

    // 5 — prepare
    worker.phase = 'prepare'
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
      worker.phase = 'execute'
      crashPoint('execute')
      await this.events.emit(
        'TaskStarted',
        { taskId: task.id, attemptId: attempt.id, agent: agent.name, provider: provider.id },
        { runId: this.runId!, taskId: task.id, attemptId: attempt.id },
      )

      // `git stash` é um ref do repositório inteiro (`.git/refs/stash`),
      // compartilhado por TODOS os worktrees — não é local ao workspace desta
      // task. Se uma task anterior (outro worktree, já descartado) deixou
      // stash pra trás, ele continua na pilha pra sempre, na frente de
      // qualquer stash novo. Sem este baseline, "devolver o stash sobrando"
      // depois do agente rodaria `pop` num stash de OUTRA task/branch —
      // aplicar um diff estranho na working tree errada, que só pode dar
      // conflito (é exatamente o "git stash falhou (exit 1)" visto em
      // produção). Só o que a PRÓPRIA sessão empilhou aqui é seguro de
      // devolver; o resto fica intocado — dar `pop`/`drop` num stash alheio
      // seria arriscar destruir o trabalho de outra tentativa.
      const stashBaseline = (await this.deps.vcs.stashList(workspace.rootDir)).length

      const execController = new AbortController()
      const onKernelAbort = (): void => {
        execController.abort()
      }
      this.abort.signal.addEventListener('abort', onKernelAbort, { once: true })
      const watchdog = setTimeout(() => {
        execController.abort()
      }, agent.limits.maxWallclockMs)

      // Vários agentes do catálogo têm `maxWallclockMs` maior que o
      // `leaseTtlMs` padrão, e sem renovação o lease deste worker expira
      // enquanto ele ainda está trabalhando de verdade: `reapExpired()` no
      // próximo tick devolveria a task pra `ready`, e o guard de
      // `this.inFlight` no loop de seleção só protege contra reclaim dentro
      // do MESMO processo — outro processo do kernel (ou uma restart) ainda
      // poderia reclamar a mesma task e acabar abrindo um segundo PR. Renovar
      // periodicamente aqui mantém o lease vivo só enquanto a sessão está
      // genuinamente em andamento.
      const heartbeat = setInterval(() => {
        queue.renew(lease, this.config.leaseTtlMs, clock.now()).catch(() => undefined)
      }, Math.max(1_000, Math.floor(this.config.leaseTtlMs / 3)))

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
        clearInterval(heartbeat)
        this.abort.signal.removeEventListener('abort', onKernelAbort)
      }

      // O agente roda `git` livre dentro do workspace (Bash sem sandbox de VCS)
      // e às vezes usa `stash` pra isolar um teste — se esquecer o `pop`, o
      // diff fica vazio e o Verifier veria "nada mudou" mesmo com edits reais
      // na sessão. Devolve só o que ESTA sessão empilhou (o baseline acima)
      // ANTES da verificação, pra ela sempre julgar o estado real da working
      // tree (INV-2), sem mexer em stash de outra task.
      await this.restoreStrayStashes(task.id, workspace.rootDir, stashBaseline)

      // 7 — verify (INV-2: o único árbitro)
      worker.phase = 'verify'
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
        worker.phase = 'integrate'
        crashPoint('integrate')
        // `resetRepair`: a verificação passou, logo os reparos desta volta
        // foram quitados. Sem zerar, uma task que se conserta em cada ciclo
        // acumularia reparos até o teto e cairia no caminho de tentativa real
        // por dívida que ela já pagou.
        const verified = unwrap(
          transition(verifying, 'verified', { at: clock.now(), resetRepair: true }),
        )
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
        throw new CrashInjectedError(worker.phase)
      }
      worker.phase = 'learn'
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
      if (this.recentOutcomes.length > MAX_RECENT_OUTCOMES) {
        this.recentOutcomes.splice(0, this.recentOutcomes.length - MAX_RECENT_OUTCOMES)
      }
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
    const lastOutcome = previousAttempts.at(-1)?.outcome
    const lastDiagnosis = lastOutcome?.diagnosis
    // §7: quando a falha anterior foi de validação, o agente precisa dos
    // problemas concretos — não do rótulo da categoria. `undefined` aqui é a
    // resposta para tudo que não é violação de política.
    const repairBrief =
      lastOutcome?.verification === undefined
        ? undefined
        : buildRepairBrief(lastOutcome.verification, task, this.validations)

    // O orçamento de contexto é do PROVIDER, não da config: um pack de 120k
    // entregue a um servidor local de 4k é descartado em silêncio pelo
    // servidor, e o agente responde sobre um contexto que nunca recebeu.
    const budget = effectiveContextBudget(
      this.config.contextBudgetTokens,
      provider.capabilities.maxContextTokens,
    )
    if (budget.clamped) {
      this.deps.logger.warn(explainContextClamp(budget, provider.id), {
        taskId: task.id,
        agent: agent.name,
      })
    }

    const packed = await this.deps.context.pack(
      {
        budgetTokens: budget.tokens,
        sectionBudgets: {},
        agent,
        task,
        project: this.project,
        mustInclude: [],
        hints: [],
      },
      this.abort.signal,
    )
    const contextPack =
      repairBrief === undefined ? packed : this.withRepairBrief(packed, repairBrief)
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
      // Ordinal do histórico, não `task.attempts + 1`. Os dois coincidiam
      // enquanto toda execução consumia uma tentativa; com o reparo dirigido
      // `attempts` é compensado (ver `scheduleRepair`) e voltaria a produzir o
      // mesmo `n` — que a tabela recusa por `UNIQUE (task_id, n)`, fazendo o
      // `prepare` falhar em silêncio e a task girar para sempre. O histórico é
      // o que de fato conta quantas execuções houve.
      n: previousAttempts.length + 1,
      agent: agent.name,
      provider: provider.id,
      model: 'default',
      contextDigest: contextPack.digest,
      workspaceId: workspace.id,
      startedAt: clock.now(),
      usage: EMPTY_USAGE,
      cost: ZERO_USD,
      // O diagnóstico anterior viaja no attempt para o prompt de retry (R3).
      //
      // Suprimido quando há brief de reparo, e não somado a ele: o texto de
      // retry manda "não repita a mesma abordagem", e em reparo a abordagem
      // anterior é justamente a que deve ser repetida — sem a violação. Duas
      // instruções opostas no mesmo prompt é como se perde a precisão que o
      // brief existe para dar.
      ...(lastDiagnosis === undefined || repairBrief !== undefined
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
   * Injeta o brief de reparo no pack já montado, `pinned` e no topo da
   * prioridade.
   *
   * Depois do `pack()`, e não como `ContextSource`: uma source é consultada
   * para toda montagem (Planner e gates inclusive) e teria de descobrir sozinha
   * qual é a última tentativa da task. O reparo é conhecimento do kernel — ele
   * é quem viu a verificação reprovar — e é o único fragmento cuja ausência
   * transforma a próxima tentativa em adivinhação, então não pode depender de
   * caber num orçamento de seção.
   *
   * O `digest` é recalculado com a mesma fórmula do packer: ADR-007 exige que
   * dois runs com o mesmo contexto tenham o mesmo digest, e um pack alterado
   * carregando o digest antigo quebraria exatamente essa comparação.
   */
  private withRepairBrief(pack: ContextPack, brief: RepairBrief): ContextPack {
    const body = this.renderRepairBrief(brief)
    const fragment: ContextFragment = {
      id: 'repair:brief',
      sourceId: 'kernel',
      kind: 'error',
      title: 'Reparo dirigido — o que a verificação reprovou',
      body,
      tokens: estimateTokens(body),
      priority: 100,
      pinned: true,
      // Confiável porque é o harness quem escreve: o conteúdo é a saída dos
      // nossos próprios checks, não texto do repositório (INV-6). Envelopá-lo
      // como dado anularia a instrução que ele carrega.
      untrusted: false,
      refs: [],
    }
    // No fim, como o packer faria com `kind: 'error'` — e é onde o modelo lê
    // por último, imediatamente antes da instrução.
    const fragments = [...pack.fragments, fragment]
    return {
      ...pack,
      fragments,
      tokens: pack.tokens + fragment.tokens,
      digest: digestOf(fragments.map((f) => ({ id: f.id, body: f.body }))),
    }
  }

  private renderRepairBrief(brief: RepairBrief): string {
    const items = formatRepairItems(brief)
    const allowedScope =
      brief.allowedScope.length === 0
        ? '(a tarefa não declarou escopo)'
        : brief.allowedScope.map((glob) => `- \`${glob}\``).join('\n')

    const rendered = this.deps.prompts.render('executor/repair-brief@1', {
      category: brief.category,
      itemCount: String(brief.items.length),
      items,
      allowedScope,
    })
    if (rendered.ok) return rendered.value

    // Sem o template registrado, os itens crus ainda valem mais que a categoria
    // sozinha — que é precisamente o que este caminho existe para superar.
    this.deps.logger.warn('Template de reparo dirigido indisponível; usando forma crua', {
      error: rendered.error.message,
    })
    return `## Reparo dirigido — corrija SOMENTE os itens abaixo\n\n${items}\n\nEscopo permitido:\n${allowedScope}`
  }

  /**
   * Escolhe o agente da próxima tentativa quando a política pede escalada.
   *
   * Só escala se o agente-alvo estiver registrado — a config decide quais
   * agentes existem, e o kernel não inventa nenhum.
   */
  /** Há um agente especializado registrado, ainda não usado e que cabe no orçamento? */
  private canEscalate(task: Task): boolean {
    const target = this.config.escalationAgent
    if (target === undefined || task.agentHint === target) return false
    // Basta estar registrado: o `agentHint` ignora o roteamento por `handles`,
    // que é justamente o que permite escalar uma task de qualquer tipo para o
    // especialista sem que ele vire a escolha padrão daquele tipo.
    const spec = this.deps.agents.get(target)
    if (spec === undefined) return false

    // Escalar para um agente que a admissão vai recusar troca "falhou 3 vezes"
    // por "orçamento insuficiente" e perde o diagnóstico real. O especialista
    // costuma ter tetos maiores que o genérico — dinheiro, tempo e tokens — e
    // basta um deles não caber no limite por task para a escalada virar um beco
    // sem saída. Verificamos as três dimensões, não só o custo.
    const provider = this.deps.providers.resolve({
      agent: spec.name,
      ...(spec.model?.tier === undefined ? {} : { tier: spec.model.tier }),
      ...(spec.requires === undefined ? {} : { capabilities: spec.requires }),
    })
    if (!provider.ok) return false

    const limits = this.deps.budget.state().task.limits
    const estimate = this.estimateFor(spec, provider.value)
    const excede =
      compareMoney(estimate.cost, limits.cost) > 0
        ? `custo até ${formatMoney(estimate.cost)} > ${formatMoney(limits.cost)}`
        : estimate.tokens > limits.tokens
          ? `${String(estimate.tokens)} tokens > ${String(limits.tokens)}`
          : estimate.wallclockMs > limits.wallclockMs
            ? `${String(Math.round(estimate.wallclockMs / 1000))}s > ${String(Math.round(limits.wallclockMs / 1000))}s`
            : undefined
    if (excede !== undefined) {
      this.deps.logger.warn('Escalada indisponível: o agente não cabe no orçamento por task', {
        agente: target,
        excede,
        dica: `aumente budget.perTask ou reduza os limits de "${target}"`,
      })
      return false
    }
    return true
  }

  /**
   * Pior caso desta combinação agente + provider, nas três dimensões.
   *
   * Um só lugar produz a estimativa, e é o mesmo usado para admitir e para
   * decidir se vale escalar — divergir entre os dois é como se cria um agente
   * que o kernel escolhe e em seguida recusa.
   */
  private estimateFor(spec: AgentSpec, provider: Provider): CostEstimate {
    return {
      cost: worstCaseCost(spec, provider),
      tokens: this.config.contextBudgetTokens + spec.limits.maxTurns * 2_000,
      wallclockMs: spec.limits.maxWallclockMs,
    }
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

  /**
   * Semeia a memória de duplicatas com o que runs anteriores já derivaram.
   *
   * Sem isto a deduplicação valeria só dentro do run — e o caso que mais dói é
   * justamente o outro: o humano interrompe, reinicia, e a mesma queixa vira
   * uma segunda task idêntica com uma segunda PR.
   */
  private async seedKnownFingerprints(): Promise<void> {
    this.knownFingerprints.clear()
    try {
      for (const task of await this.deps.tasks.all()) {
        const fingerprint = task.lineage?.fingerprint
        if (fingerprint !== undefined) this.knownFingerprints.add(fingerprint)
      }
    } catch (error: unknown) {
      // Falhar aqui degrada a deduplicação, não o run. Registrar e seguir é
      // melhor que recusar a iniciar por causa de uma otimização de ruído.
      this.deps.logger.warn('Não foi possível carregar fingerprints de achados anteriores', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * Findings viram trabalho — mas só os que a política deixa passar.
   *
   * Este método já foi "todo achado vira task". O efeito era uma recorrência
   * sem caso base: task → gates → achados → tasks → gates → achados. Com
   * `followUpAt: medium` (o default antigo) e um agente que classifica
   * preferência de estilo como medium, a fila crescia mais rápido do que
   * drenava e o humano recebia dezenas de correções que nunca pediu.
   *
   * `planFollowUps` é quem decide agora, em código puro. O que ele recusa não
   * some: vai para o backlog, com o motivo, para o humano triar de graça.
   */
  private async spawnFindingTasks(outcome: GateOutcome, origin: Task): Promise<void> {
    if (this.findingsToTasks === undefined) return

    const policy = this.followUpPolicy
    const generation = taskGeneration(origin) + 1

    for (const report of outcome.reports) {
      // Bloqueantes viram tasks também: a correção precisa existir como
      // trabalho rastreável, não só como motivo de falha. `planFollowUps`
      // classifica o relatório inteiro — o que não vira task vira registro.
      const plan = planFollowUps({
        report,
        generation,
        policy,
        known: this.knownFingerprints,
        remaining: Math.max(0, policy.maxFollowUpsPerRun - this.followUpsThisRun),
      })

      for (const deferred of plan.deferred) {
        await this.deferFindingTask(deferred, origin, report.agent)
      }

      const drafts = this.findingsToTasks(plan.spawn, origin, report.agent)

      for (const draft of drafts) {
        const now = this.deps.clock.now()
        const task: Task = {
          id: newTaskId(now),
          projectId: origin.projectId,
          // A correção nascida de uma task de um item pertence ao mesmo item
          // (§1). Sem herdar o vínculo, a filha ficaria pendurada fora da
          // contagem de irmãs e o item nunca fecharia.
          ...(origin.backlogItemId === undefined ? {} : { backlogItemId: origin.backlogItemId }),
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
          repairAttempts: 0,
          labels: [...(draft.labels ?? [])],
          ...(draft.lineage === undefined ? {} : { lineage: draft.lineage }),
          createdAt: now,
          updatedAt: now,
        }
        const queued = await this.deps.queue.enqueue(task)
        if (queued.ok) {
          // Só conta contra o teto do run o que de fato entrou na fila; uma
          // task recusada na admissão não consome orçamento de derivação.
          this.followUpsThisRun += 1
          if (task.lineage?.fingerprint !== undefined) {
            this.knownFingerprints.add(task.lineage.fingerprint)
          }
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

  /** Achado recusado como trabalho automático: vira registro, não vira PR. */
  private async deferFindingTask(
    deferred: DeferredFinding,
    origin: Task,
    agent: string,
  ): Promise<void> {
    this.deps.logger.info('Achado não virou task', {
      motivo: deferred.reason,
      gate: agent,
      severidade: deferred.finding.severity,
      categoria: deferred.finding.category,
      titulo: deferred.finding.title,
      taskOrigem: origin.id,
      geracao: taskGeneration(origin) + 1,
      raiz: taskRoot(origin),
    })
    await this.events.emit(
      'FindingDeferred',
      {
        taskId: origin.id,
        agent,
        reason: deferred.reason,
        severity: deferred.finding.severity,
        category: deferred.finding.category,
        title: deferred.finding.title,
        fingerprint: deferred.fingerprint,
      },
      { runId: this.runId!, taskId: origin.id },
    )
    if (this.deferFinding === undefined) return
    try {
      await this.deferFinding({ deferred, origin, agent })
    } catch (error: unknown) {
      this.deps.logger.warn('Falha ao registrar achado adiado no backlog', {
        error: error instanceof Error ? error.message : String(error),
      })
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
      const remote = this.config.integration.pushRemote ?? 'origin'

      // Sincroniza com o remoto antes de abrir PR. Com N tasks em paralelo
      // (R6), cada workspace nasceu do mesmo HEAD local capturado em
      // `sandbox.acquire()`; se uma task irmã já foi mergeada nesse meio
      // tempo, esta branch abriria um PR já desatualizado — e sem re-checar,
      // ele só descobre isso quando o humano (ou o CI) olhar depois.
      const fetched = await vcs.fetch(workspace.rootDir, remote)
      if (fetched.ok) {
        const onto = `${remote}/${this.config.integration.prBase}`
        const rebased = await vcs.rebase(workspace.rootDir, onto)
        if (!rebased.ok) {
          this.deps.logger.warn('Rebase contra a base falhou; branch colide com trabalho já mergeado', {
            taskId: task.id,
            onto,
            error: rebased.error.message,
          })
          await this.requeueAfterSyncConflict(integrating, workspace, lease, rebased.error.message)
          return
        }
      } else {
        this.deps.logger.warn('git fetch falhou antes do push; seguindo com a base capturada na criação do workspace', {
          taskId: task.id,
          error: fetched.error.message,
        })
      }

      const pushed = await vcs.push(workspace.rootDir, workspace.branch, {
        setUpstream: true,
        remote,
      })
      if (pushed.ok && this.deps.codeHost !== undefined) {
        const codeHost = this.deps.codeHost
        // `Task: <id>` na última linha do corpo — mesma convenção do commit
        // (linha 1160). Cada tentativa nasce numa branch nova (o slug carrega
        // o id do workspace, não o da task), então é o único jeito confiável
        // de achar um PR já aberto por uma tentativa irmã da MESMA task
        // (lease reapeado enquanto ainda executava, replanejamento, etc.) —
        // sem isto, cada tentativa abre seu próprio PR pra mesma mudança.
        const body = `${task.intent}\n\n---\nGerado pelo Uranus. Tentativa ${String(attempt.n)}.\n\nTask: ${task.id}`
        const existing = await codeHost.findOpenPullRequestForTask(workspace.rootDir, task.id)
        if (existing.ok && existing.value !== undefined) {
          const updated = await codeHost.updatePullRequest(existing.value, { title: subject, body })
          if (updated.ok) {
            this.deps.logger.info('PR já existia pra esta task; atualizado em vez de duplicado', {
              taskId: task.id,
              pr: existing.value.url,
            })
            await this.events.emit(
              'PRCreated',
              { taskId: task.id, pr: existing.value },
              { runId: this.runId!, taskId: task.id },
            )
          } else {
            this.deps.logger.warn('PR existente não pôde ser atualizado; branch permanece', {
              taskId: task.id,
              error: updated.error.message,
            })
          }
        } else {
          const pr = await codeHost.openPullRequest({
            repoDir: workspace.rootDir,
            head: workspace.branch,
            base: this.config.integration.prBase,
            title: subject,
            body,
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

    await this.notifyBacklogOfCompletion(done)
  }

  /**
   * Uma task de um item de backlog terminou (§6).
   *
   * O kernel não decide se o item fechou — ele só entrega as irmãs (mesmo
   * `backlogItemId`) para a porta, que conhece o formato do item e a regra de
   * conclusão. Falhar aqui não pode desfazer um commit que já existe: o pior
   * caso é o item ficar `planned` até a próxima task irmã terminar.
   */
  private async notifyBacklogOfCompletion(task: Task): Promise<void> {
    const itemId = task.backlogItemId
    const backlog = this.backlog
    if (itemId === undefined || backlog === undefined) return

    try {
      // Lido do repositório, e não da fila: o snapshot precisa incluir as
      // irmãs em qualquer estado (bloqueada, abandonada, ainda por rodar) —
      // "o item acabou" é uma afirmação sobre todas elas, não só as vivas.
      const siblings = (await this.deps.tasks.all()).filter((t) => t.backlogItemId === itemId)
      await backlog.taskFinished(itemId, siblings)
    } catch (error: unknown) {
      this.deps.logger.warn('Falha ao atualizar o item do backlog após concluir a task', {
        taskId: task.id,
        item: itemId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * O commit da task existe e passou na verificação — só a sincronização com
   * o que outras tasks já mergearam falhou. Isso não é o mesmo problema que
   * `decideAfterFailure` classifica (agente deixando marcadores de conflito
   * na própria sessão, `'conflict'` ali é propositalmente não-retryable): um
   * workspace novo, criado a partir do HEAD atualizado, tem uma chance real
   * de nem colidir — então este caminho tenta de novo em vez de bloquear na
   * primeira vez, e só bloqueia quando as tentativas realmente se esgotam.
   */
  private async requeueAfterSyncConflict(
    task: Task,
    workspace: Workspace,
    lease: Lease,
    detail: string,
  ): Promise<void> {
    const { clock, queue } = this.deps
    const now = clock.now()
    const exhausted = task.attempts >= task.maxAttempts

    const next = exhausted
      ? transition(task, 'blocked', {
          at: now,
          blockReason: {
            kind: 'human',
            message: `Rebase contra ${this.config.integration.prBase} colidiu repetidamente (${String(task.attempts)}/${String(task.maxAttempts)} tentativas): ${detail.slice(0, 500)}`,
            resolvableBy: 'human',
          },
        })
      : transition(task, 'ready', { at: now })

    if (next.ok) {
      await queue.update(next.value)
      await this.events.emit(
        exhausted ? 'TaskBlocked' : 'TaskRetried',
        exhausted
          ? {
              taskId: task.id,
              kind: 'human',
              message: 'rebase contra a base colidiu repetidamente',
              resolvableBy: 'human',
            }
          : {
              taskId: task.id,
              attempt: task.attempts,
              reason: 'rebase contra a base colidiu; nova tentativa parte de um workspace atualizado',
            },
        { runId: this.runId!, taskId: task.id },
      )
    }
    await queue.release(lease, next.ok ? next.value.state : 'blocked', now).catch(() => undefined)
    await this.deps.sandbox.release(workspace, exhausted ? 'archive' : 'discard')
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

    // §6 — caminho de reparo. Antes de `decideAfterFailure`, de propósito:
    // violação de política nunca deve chegar à decisão que bloqueia e
    // replaneja, porque replanejar uma task cujo código está certo produz mais
    // tasks com o mesmo defeito de escopo — o ciclo que motivou tudo isto.
    const brief = buildRepairBrief(verification, failed, this.validations)
    if (
      brief !== undefined &&
      !this.validations.countTowardAttempts &&
      failed.repairAttempts < this.validations.maxRepairAttempts
    ) {
      await this.scheduleRepair(failed, workspace, lease, brief)
      return
    }

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

  /**
   * Devolve a task para a fila como reparo dirigido: mesma task, mesmo id,
   * mesma tentativa — só o problema concreto a mais.
   *
   * **Sobre o contador de tentativas.** O attempt já foi contado na entrada em
   * `running` (`countAttempt: true`), muito antes de existir verificação que
   * dissesse se a falha é defeito ou política. Das duas saídas possíveis,
   * escolhemos COMPENSAR aqui em vez de marcar o attempt como "de reparo" e
   * ensinar `decideAfterFailure` a ignorá-lo:
   *
   *  - `Task.attempts` é um escalar persistido, não uma contagem derivada da
   *    lista de attempts. Fazer a decisão ignorar attempts de reparo exigiria
   *    que ela lesse o histórico — trocando uma função pura sobre a task por
   *    uma que depende do repositório, justo a função que o teste de caos
   *    cobre exaustivamente por ser pura.
   *  - A compensação é local e balanceada por construção: cada entrada em
   *    `running` incrementa exatamente uma vez e passa por exatamente um
   *    `handleFailure`, então nunca há mais de um decremento por incremento.
   *
   * O preço é que `attempts` deixa de ser monotônico dentro de uma task, e é
   * por isso que o número de reparos é auditável à parte, em `repairAttempts`
   * e no evento `TaskRepairScheduled`.
   */
  private async scheduleRepair(
    failed: Task,
    workspace: Workspace,
    lease: Lease,
    brief: RepairBrief,
  ): Promise<void> {
    const { clock, queue } = this.deps
    const now = clock.now()

    const moved = unwrap(transition(failed, 'ready', { at: now, countRepair: true }))
    const requeued: Task = { ...moved, attempts: Math.max(0, failed.attempts - 1) }
    await queue.update(requeued)

    this.deps.logger.info('Falha de validação encaminhada para reparo dirigido', {
      taskId: failed.id,
      regras: brief.rules,
      arquivos: brief.paths,
      reparo: `${String(requeued.repairAttempts)}/${String(this.validations.maxRepairAttempts)}`,
    })
    await this.events.emit(
      'TaskRepairScheduled',
      { taskId: failed.id, rules: brief.rules, repairAttempt: requeued.repairAttempts },
      { runId: this.runId!, taskId: failed.id },
    )
    this.deps.telemetry.counter('task.repairs', 1, { category: brief.category })

    await queue.release(lease, 'ready', now).catch(() => undefined)
    // Descartado, como em qualquer retry: a próxima tentativa parte limpa e
    // reimplementa — o brief é o que garante que ela não reincida.
    await this.deps.sandbox.release(workspace, 'discard')
  }

  /**
   * Devolve só o `git stash` que a PRÓPRIA sessão empilhou — nunca o que já
   * existia antes dela começar (`baseline`). `git stash` é um ref do
   * repositório inteiro, compartilhado por todos os worktrees; um stash que
   * já estava lá pertence a alguma task/branch diferente (possivelmente já
   * descartada) e aplicar o diff dele nesta working tree é, na melhor das
   * hipóteses, ruído, e na pior, um conflito genuíno — não algo pra "devolver
   * antes da verificação". `pop` sempre pega o topo da pilha (o mais novo),
   * então esvaziar exatamente `depois - baseline` vezes recupera só o que é
   * desta sessão e deixa o resto intocado.
   */
  private async restoreStrayStashes(
    taskId: Task['id'],
    workdir: string,
    baseline: number,
  ): Promise<void> {
    const current = (await this.deps.vcs.stashList(workdir)).length
    const own = current - baseline
    if (own <= 0) return

    for (let popped = 0; popped < own; popped += 1) {
      const result = await this.deps.vcs.stashPop(workdir)
      if (!result.ok) {
        this.deps.logger.warn('git stash desta sessão não pôde ser restaurado', {
          taskId,
          error: result.error.message,
          pendentes: own - popped,
        })
        return
      }
    }
    this.deps.logger.warn('git stash desta sessão foi restaurado antes da verificação', {
      taskId,
      quantidade: own,
    })
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

    // RSS por checkpoint (Fase 9: instrumentação pra detectar vazamento num
    // run de longa duração). Barato — process.memoryUsage() é uma leitura
    // do próprio processo, sem I/O — e o checkpoint já é o ponto periódico
    // natural do ciclo, sem precisar de um timer à parte.
    this.deps.telemetry.gauge('process.memory_rss_bytes', process.memoryUsage().rss)

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
      // Poda cross-run: checkpoints de runs já terminados além dos últimos N
      // não servem mais recovery nenhum (só o run corrente pode ser retomado).
      // As linhas de `runs` continuam intactas — é histórico barato.
      const staleRuns = await this.deps.runs.oldFinished(this.config.runRetentionKeep)
      for (const staleRunId of staleRuns) {
        await this.deps.checkpoints.prune(staleRunId, 0)
      }
      await this.deps.eventStore.prune?.(this.config.eventRetentionKeepSegments).catch(() => 0)
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

/**
 * Pior custo possível de uma sessão deste agente neste provider.
 *
 * O teto do agente (`limits.maxCost`) sozinho não serve como estimativa: ele é
 * uma política em dólares que ignora quem vai executar. Com um modelo local o
 * custo real é zero, e admitir pelo teto do agente recusava tasks por "falta de
 * orçamento" num provider que não cobra nada — foi exatamente assim que a
 * escalada para o `bug-hunter` (teto de US$3) morria num limite de US$2 por
 * task rodando em Ollama.
 *
 * A sessão para no primeiro dos dois limites que bater — o de tokens ou o de
 * dinheiro. O pior caso é, portanto, o **menor** entre eles: continua sendo
 * pessimista (INV-7), mas pessimista sobre o que pode mesmo acontecer.
 */
export function worstCaseCost(agent: AgentSpec, provider: Provider): Money {
  // Repartição pessimista dos tokens do teto: 80% entrada, 20% saída. Saída
  // custa mais caro; assumir mais que isso seria pessimismo sem lastro, já que
  // nenhuma sessão real gera 100% de saída.
  const ceiling = agent.limits.maxTokens
  const byTokens = provider.estimateCost(
    {
      input: Math.round(ceiling * 0.8),
      output: Math.round(ceiling * 0.2),
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
    },
    agent.model?.tier ?? 'balanced',
  )
  return compareMoney(byTokens, agent.limits.maxCost) < 0 ? byTokens : agent.limits.maxCost
}

/**
 * Mensagem de recusa que diz o que fazer.
 *
 * Distingue os dois casos que "orçamento insuficiente" confundia: o limite
 * acabou de tanto gastar, ou o limite **nunca** coube neste agente. O segundo é
 * erro de configuração e some sozinho quando o número certo é ajustado — mas só
 * se a mensagem disser qual número é esse.
 */
function explainBudgetRefusal(
  verdict: BudgetVerdict,
  agent: AgentSpec,
  estimate: CostEstimate,
  state: BudgetState,
): string {
  const estimatedCost = estimate.cost
  const estimatedTokens = estimate.tokens
  const window = verdict.exceeded?.window ?? 'run'
  const dimension = verdict.exceeded?.dimension ?? 'cost'
  const limits = window === 'task' ? state.task.limits : state.run.limits
  const chave = window === 'task' ? 'budget.perTask' : 'budget.perRun'

  if (dimension === 'cost') {
    const cabe = compareMoney(estimatedCost, limits.cost) <= 0
    return cabe
      ? `orçamento de ${window} esgotado: restam menos de ${formatMoney(estimatedCost)} para o agente "${agent.name}" (limite ${formatMoney(limits.cost)} em ${chave}.usd)`
      : `o agente "${agent.name}" pode custar até ${formatMoney(estimatedCost)}, acima do limite de ${formatMoney(limits.cost)} por ${window} — aumente ${chave}.usd ou reduza limits.maxCost do agente`
  }
  if (dimension === 'tokens') {
    return estimatedTokens <= limits.tokens
      ? `orçamento de tokens de ${window} esgotado: o agente "${agent.name}" precisa de ~${String(estimatedTokens)} e restam menos que isso (limite ${String(limits.tokens)} em ${chave}.tokens)`
      : `o agente "${agent.name}" precisa de ~${String(estimatedTokens)} tokens, acima do limite de ${String(limits.tokens)} por ${window} — aumente ${chave}.tokens ou reduza context.budgetTokens`
  }
  return `tempo de ${window} esgotado: o agente "${agent.name}" pode levar até ${String(Math.round(agent.limits.maxWallclockMs / 1000))}s (limite ${chave}.wallclockMs)`
}
