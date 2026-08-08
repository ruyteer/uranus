# Uranus — Interfaces Públicas e Contratos entre Módulos

Estas são as **fronteiras estáveis** do framework. Tudo em `@uranus/core`.
Mudança aqui é breaking change e exige ADR.

Convenções:

- Nenhuma interface pública expõe tipo de biblioteca de terceiros.
- Toda operação falível retorna `Result<T, E>` ou lança `UranusError` tipado — nunca `any`.
- Todo I/O recebe `AbortSignal`.
- Todo objeto de domínio é `readonly` (imutável); mutação acontece via repositório.

---

## 0. Primitivos

```ts
export type Brand<T, B extends string> = T & { readonly __brand: B }

export type ProjectId = Brand<string, 'ProjectId'>
export type RunId = Brand<string, 'RunId'>
export type TaskId = Brand<string, 'TaskId'>
export type AttemptId = Brand<string, 'AttemptId'>
export type EventId = Brand<string, 'EventId'>
export type SessionId = Brand<string, 'SessionId'>
export type MemoryId = Brand<string, 'MemoryId'>
export type PlanId = Brand<string, 'PlanId'>

export type Result<T, E = UranusError> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E }

export abstract class UranusError extends Error {
  abstract readonly code: string
  abstract readonly retryable: boolean
  readonly context: Readonly<Record<string, unknown>> = {}
  readonly cause?: unknown
}

export interface Clock {
  now(): number
  monotonic(): number
}
export interface Logger {
  child(bindings: Record<string, unknown>): Logger
  trace(msg: string, data?: object): void
  debug(msg: string, data?: object): void
  info(msg: string, data?: object): void
  warn(msg: string, data?: object): void
  error(msg: string, data?: object): void
}
export type Unsubscribe = () => void
export type JsonSchema = Readonly<Record<string, unknown>>
export type Glob = string
export interface Money {
  readonly amount: number
  readonly currency: 'USD'
}
export interface TokenUsage {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly reasoning?: number
}
```

---

## 1. Domínio

```ts
export type TaskKind =
  | 'feature'
  | 'bugfix'
  | 'refactor'
  | 'test'
  | 'docs'
  | 'chore'
  | 'security'
  | 'perf'
  | 'deps'
  | 'infra'
  | 'review'
  | 'investigation'
  | 'migration'

export type TaskState =
  | 'draft'
  | 'ready'
  | 'claimed'
  | 'running'
  | 'verifying'
  | 'verified'
  | 'failed'
  | 'integrating'
  | 'blocked'
  | 'done'
  | 'abandoned'

export interface Task {
  readonly id: TaskId
  readonly projectId: ProjectId
  readonly planId?: PlanId
  readonly kind: TaskKind
  readonly title: string
  /** Intenção em linguagem natural. NÃO é um prompt — é a especificação. */
  readonly intent: string
  readonly state: TaskState
  readonly priority: number // 0..100, derivado pelo Scheduler
  readonly deps: readonly TaskId[]
  /** Globs que a task pode tocar. Base do file-ownership lease e do fs.write. */
  readonly touches: readonly Glob[]
  readonly acceptance: AcceptanceContract // obrigatório — INV-2
  readonly agentHint?: string
  readonly attempts: number
  readonly maxAttempts: number
  readonly blockReason?: BlockReason
  readonly labels: readonly string[]
  readonly createdAt: number
  readonly updatedAt: number
}

export interface BlockReason {
  readonly kind:
    'approval' | 'dependency' | 'budget' | 'lease' | 'permission' | 'human' | 'provider'
  readonly message: string
  readonly resolvableBy: 'human' | 'kernel' | 'time'
  readonly data?: Readonly<Record<string, unknown>>
}

export interface Plan {
  readonly id: PlanId
  readonly projectId: ProjectId
  readonly sourceItemId: string
  readonly summary: string
  readonly rationale: string
  readonly tasks: readonly TaskDraft[]
  readonly risks: readonly string[]
  readonly assumptions: readonly string[]
  readonly createdBy: string // agente
  readonly createdAt: number
}

export interface Attempt {
  readonly id: AttemptId
  readonly taskId: TaskId
  readonly n: number
  readonly agent: string
  readonly provider: string
  readonly contextDigest: string
  readonly workspaceId: string
  readonly startedAt: number
  readonly finishedAt?: number
  readonly outcome?: AttemptOutcome
  readonly usage: TokenUsage
  readonly cost: Money
}

export interface AttemptOutcome {
  readonly status: 'verified' | 'failed' | 'interrupted' | 'aborted'
  readonly verification?: Verification
  readonly diagnosis?: Diagnosis
  readonly diff?: DiffSummary
}

/** Diagnóstico estruturado de falha — alimenta retry/escalate/replan. NÃO é texto livre. */
export interface Diagnosis {
  readonly category:
    | 'compile-error'
    | 'test-failure'
    | 'lint-failure'
    | 'type-error'
    | 'no-changes'
    | 'out-of-scope'
    | 'timeout'
    | 'budget'
    | 'permission-denied'
    | 'provider-error'
    | 'conflict'
    | 'unknown'
  readonly summary: string
  readonly evidence: readonly Evidence[]
  readonly suggestedAction: 'retry' | 'retry-with-context' | 'escalate' | 'replan' | 'block'
  readonly suggestedAgent?: string
}

export interface Evidence {
  readonly kind: 'stdout' | 'stderr' | 'file' | 'diff' | 'event'
  readonly ref: string
  readonly excerpt: string
}
```

---

## 2. Contrato de aceite e verificação (INV-2)

```ts
export interface AcceptanceContract {
  readonly checks: readonly Check[]
  /** true = todos os checks bloqueantes precisam passar. */
  readonly requireAll: boolean
}

export type Check =
  CommandCheck | TestsCheck | CoverageCheck | DiffCheck | ArtifactCheck | SchemaCheck | PluginCheck

interface CheckBase {
  readonly id: string
  /** advisory = registra o resultado mas nunca bloqueia. */
  readonly advisory?: boolean
  readonly timeoutMs: number
}

export interface CommandCheck extends CheckBase {
  readonly kind: 'command'
  readonly run: string
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string>>
  readonly expectExit?: number // default 0
}

export interface TestsCheck extends CheckBase {
  readonly kind: 'tests'
  readonly runner: string // id resolvido por plugin
  readonly scope?: 'all' | 'related' | 'diff'
  /** exige ao menos um teste NOVO passando — impede "implementou sem testar". */
  readonly requireNewTests?: boolean
  readonly forbidSkipped?: boolean
}

export interface CoverageCheck extends CheckBase {
  readonly kind: 'coverage'
  readonly min: number // 0..1
  readonly scope: 'diff' | 'global'
}

export interface DiffCheck extends CheckBase {
  readonly kind: 'diff'
  readonly maxFiles?: number
  readonly maxLines?: number
  readonly requireNonEmpty?: boolean
  readonly forbidPaths?: readonly Glob[]
  readonly requirePathsWithin?: readonly Glob[] // default: task.touches
}

export interface ArtifactCheck extends CheckBase {
  readonly kind: 'artifact'
  readonly path: string
  readonly mustExist: boolean
  readonly matches?: string // regex
}

export interface SchemaCheck extends CheckBase {
  readonly kind: 'schema'
  readonly schema: JsonSchema // valida saída estruturada do agente
}

export interface PluginCheck extends CheckBase {
  readonly kind: 'plugin'
  readonly check: string // id registrado por plugin
  readonly config?: Readonly<Record<string, unknown>>
}

// ── Execução ────────────────────────────────────────────────────────────
export interface Verifier {
  verify(input: VerifyInput, signal: AbortSignal): Promise<Verification>
}

export interface VerifyInput {
  readonly contract: AcceptanceContract
  readonly workspace: Workspace
  readonly task: Task
  readonly structuredOutput?: unknown
}

export interface Verification {
  readonly passed: boolean
  readonly results: readonly CheckResult[]
  readonly durationMs: number
  readonly diagnosis?: Diagnosis // preenchido quando passed === false
}

export interface CheckResult {
  readonly checkId: string
  readonly kind: Check['kind']
  readonly passed: boolean
  readonly advisory: boolean
  readonly durationMs: number
  readonly exitCode?: number
  readonly stdout?: string // truncado + preservado em runs/
  readonly stderr?: string
  readonly detail?: Readonly<Record<string, unknown>>
}

/** Um CheckImpl é como plugins estendem a verificação. */
export interface CheckImpl<C extends Check = Check> {
  readonly kind: C['kind'] | string
  readonly id: string
  run(check: C, input: VerifyInput, signal: AbortSignal): Promise<CheckResult>
}
```

---

## 3. Eventos

```ts
export type Actor =
  | { readonly type: 'kernel' }
  | { readonly type: 'agent'; readonly name: string }
  | { readonly type: 'plugin'; readonly id: string }
  | { readonly type: 'human'; readonly id: string }

export interface UranusEvent<N extends EventName = EventName> {
  readonly id: EventId
  readonly seq: number // monotônico global, atribuído pelo store
  readonly name: N
  readonly at: number
  readonly actor: Actor
  readonly projectId: ProjectId
  readonly runId?: RunId
  readonly taskId?: TaskId
  readonly attemptId?: AttemptId
  readonly payload: EventPayloads[N]
  readonly causationId?: EventId // evento que causou este
  readonly correlationId?: string // agrupa uma cadeia lógica
}

export interface EventBus {
  emit<N extends EventName>(
    name: N,
    payload: EventPayloads[N],
    meta?: EventMeta,
  ): Promise<UranusEvent<N>>

  on<N extends EventName>(
    name: N | readonly N[],
    handler: EventHandler<N>,
    opts?: SubscribeOptions,
  ): Unsubscribe

  /** Interceptor pode vetar. Timeout duro. */
  intercept<N extends EventName>(
    name: N | readonly N[],
    handler: InterceptHandler<N>,
    opts?: InterceptOptions,
  ): Unsubscribe
}

export type EventHandler<N extends EventName> = (e: UranusEvent<N>) => void | Promise<void>

export type InterceptHandler<N extends EventName> = (
  e: UranusEvent<N>,
) => Promise<InterceptDecision> | InterceptDecision

export type InterceptDecision =
  | { readonly action: 'continue' }
  | { readonly action: 'veto'; readonly reason: string }
  | { readonly action: 'defer'; readonly reason: string; readonly retryAfterMs: number }

export interface InterceptOptions {
  readonly priority?: number // maior roda antes
  readonly timeoutMs?: number // default 5000; estouro = continue + warning
}

export interface EventStore {
  append(e: Omit<UranusEvent, 'seq'>): Promise<UranusEvent>
  read(from: number, limit?: number): AsyncIterable<UranusEvent>
  head(): Promise<number>
  query(q: EventQuery): AsyncIterable<UranusEvent>
  seal(beforeSeq: number): Promise<void> // sela segmento JSONL
}
```

---

## 4. Providers

```ts
export interface Provider {
  readonly id: string // 'claude-code', 'openai-gpt', ...
  readonly kind: 'cli' | 'api'
  readonly capabilities: ProviderCapabilities

  health(signal: AbortSignal): Promise<HealthReport>
  createSession(req: SessionRequest, signal: AbortSignal): Promise<ProviderSession>
  estimateCost(usage: TokenUsage, model: string): Money
  /** Estimativa a priori, usada pelo BudgetGuard na admissão. */
  estimateTokens(req: SessionRequest): number
}

export interface ProviderCapabilities {
  readonly streaming: boolean
  /** true = o provider edita arquivos por conta própria (CLIs agênticos). */
  readonly nativeFileEditing: boolean
  readonly toolUse: boolean
  readonly structuredOutput: boolean
  readonly resumableSessions: boolean
  readonly vision: boolean
  readonly maxContextTokens: number
  readonly models: readonly string[]
  readonly maxConcurrentSessions: number
}

export interface SessionRequest {
  readonly systemPrompt: string
  readonly instruction: string
  readonly context: ContextPack
  readonly tools: readonly ToolDescriptor[]
  readonly workdir: string
  readonly permissions: PermissionSet
  readonly outputSchema?: JsonSchema
  readonly model?: string
  readonly limits: RunLimits
  readonly resumeToken?: string
  readonly metadata: Readonly<Record<string, string>> // runId/taskId p/ correlação
}

export interface RunLimits {
  readonly maxTokens: number
  readonly maxWallclockMs: number
  readonly maxTurns: number
  readonly maxCost: Money
}

export interface ProviderSession {
  readonly id: SessionId
  stream(): AsyncIterable<ProviderEvent>
  result(): Promise<SessionResult>
  interrupt(reason: string): Promise<void>
}

export type ProviderEvent =
  | { readonly type: 'started'; readonly model: string }
  | { readonly type: 'text'; readonly delta: string }
  | { readonly type: 'thinking'; readonly delta: string }
  | { readonly type: 'tool_call'; readonly call: ToolCall }
  | {
      readonly type: 'tool_result'
      readonly callId: string
      readonly ok: boolean
      readonly summary: string
    }
  | {
      readonly type: 'file_changed'
      readonly path: string
      readonly change: 'create' | 'modify' | 'delete'
    }
  | { readonly type: 'usage'; readonly usage: TokenUsage }
  | { readonly type: 'warning'; readonly message: string }
  | { readonly type: 'error'; readonly error: ProviderError }
  | { readonly type: 'done'; readonly result: SessionResult }

export interface SessionResult {
  readonly status: 'completed' | 'interrupted' | 'error' | 'limit_reached'
  readonly text: string
  readonly structured?: unknown // validado contra outputSchema pelo kernel
  readonly usage: TokenUsage
  readonly cost: Money
  readonly turns: number
  readonly resumeToken?: string
  readonly filesTouched: readonly string[]
}

export interface ProviderRegistry {
  register(p: Provider): void
  get(id: string): Provider | undefined
  /** Seleciona provider que satisfaz os requisitos, respeitando fallback e circuit breaker. */
  resolve(req: ProviderRequirements): Result<Provider>
  list(): readonly Provider[]
}
```

---

## 5. Ferramentas

```ts
export interface ToolDescriptor {
  readonly name: string
  readonly description: string
  readonly inputSchema: JsonSchema
  readonly sideEffects: 'none' | 'read' | 'write' | 'exec' | 'network'
  readonly requiresApproval: boolean
}

export interface Tool<I = unknown, O = unknown> extends ToolDescriptor {
  execute(input: I, ctx: ToolContext, signal: AbortSignal): Promise<Result<O>>
}

export interface ToolContext {
  readonly workspace: Workspace
  readonly task: Task
  readonly permissions: PermissionSet
  readonly logger: Logger
  readonly emit: EventBus['emit']
}
```

---

## 6. Agentes

```ts
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
  readonly prompts: { readonly system: string; readonly instruction: string } // ids no PromptRegistry
  readonly model?: ModelPreference
  readonly limits: RunLimits
  readonly handles: readonly TaskKind[]
  readonly specificity: number // desempate no roteamento; plugins usam > 0
  readonly requires?: Partial<ProviderCapabilities>
  readonly hooks?: AgentHooks
}

export interface MemoryAccessSpec {
  readonly read: readonly MemoryScope[]
  readonly write: readonly MemoryScope[]
}

export interface ToolPolicy {
  readonly allow: readonly string[] // globs de nome de ferramenta
  readonly deny: readonly string[] // deny vence
}

export interface ModelPreference {
  readonly tier: 'fast' | 'balanced' | 'deep' // provider-agnóstico
  readonly minContextTokens?: number
}

/** Código opcional. Determinístico. Roda no processo do kernel, não no modelo. */
export interface AgentHooks {
  beforeRun?(ctx: AgentRunContext): Promise<AgentRunContext>
  afterRun?(ctx: AgentRunContext, result: SessionResult): Promise<AgentOutput>
  onFailure?(ctx: AgentRunContext, d: Diagnosis): Promise<Diagnosis>
}

export interface AgentRuntime {
  run(spec: AgentSpec, ctx: AgentRunContext, signal: AbortSignal): Promise<AgentOutput>
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
  readonly memoryDrafts: readonly MemoryDraft[]
  readonly followUps: readonly TaskDraft[] // sub-tasks propostas (validadas pelo kernel)
  readonly usage: TokenUsage
  readonly cost: Money
}

export interface AgentRegistry {
  register(spec: AgentSpec): Result<void>
  get(name: string): AgentSpec | undefined
  /** Roteamento: handles ∩ kind, maior specificity, requires ⊆ capabilities. */
  resolve(task: Task, caps: ProviderCapabilities): Result<AgentSpec>
  list(): readonly AgentSpec[]
}
```

---

## 7. Memória

```ts
export type MemoryScope =
  | 'architecture'
  | 'decision'
  | 'bug'
  | 'preference'
  | 'stack'
  | 'pattern'
  | 'convention'
  | 'roadmap'
  | 'history'
  | 'context'

export interface MemoryRecord {
  readonly id: MemoryId
  readonly projectId: ProjectId
  readonly scope: MemoryScope
  readonly key: string // slug estável
  readonly title: string
  readonly body: string // markdown
  readonly tags: readonly string[]
  readonly confidence: number // 0..1
  readonly source: MemorySource
  readonly refs: readonly CodeRef[] // invalidação por checksum
  readonly supersedes?: MemoryId
  readonly supersededBy?: MemoryId
  readonly validFrom: number
  readonly validUntil?: number
  readonly checksum: string
}

export interface MemorySource {
  readonly kind: 'agent' | 'human' | 'derived' | 'imported'
  readonly ref: string // runId, commit, arquivo
}

export interface CodeRef {
  readonly path: string
  readonly checksum: string
  readonly range?: readonly [number, number]
}

export type MemoryDraft = Omit<MemoryRecord, 'id' | 'checksum' | 'validFrom' | 'supersededBy'>

export interface MemoryStore {
  put(draft: MemoryDraft): Promise<Result<MemoryRecord>>
  get(id: MemoryId): Promise<MemoryRecord | undefined>
  query(q: MemoryQuery): Promise<readonly MemoryRecord[]>
  supersede(id: MemoryId, by: MemoryId, reason: string): Promise<Result<void>>
  /** Invalida registros cujos refs mudaram de checksum. */
  revalidate(signal: AbortSignal): Promise<RevalidationReport>
  compact(scope: MemoryScope, policy: CompactionPolicy): Promise<CompactionReport>
  export(): AsyncIterable<MemoryRecord>
}

export interface MemoryQuery {
  readonly scopes?: readonly MemoryScope[]
  readonly tags?: readonly string[]
  readonly text?: string // FTS5
  readonly semantic?: string // vetorial (se habilitado)
  readonly minConfidence?: number
  readonly includeSuperseded?: boolean
  readonly limit?: number
}
```

---

## 8. Contexto

```ts
export interface ContextSource {
  readonly id: string
  readonly cost: 'cheap' | 'moderate' | 'expensive'
  collect(input: CollectInput, signal: AbortSignal): Promise<readonly ContextFragment[]>
  /** Chave de frescor: se mudou, o cache desta source é invalidado. */
  freshness(input: CollectInput): Promise<string>
}

export interface CollectInput {
  readonly project: ProjectRef
  readonly task?: Task
  readonly hints: readonly string[]
}

export interface ContextFragment {
  readonly id: string
  readonly sourceId: string
  readonly kind: 'digest' | 'code' | 'memory' | 'task' | 'diff' | 'doc' | 'error' | 'external'
  readonly title: string
  readonly body: string
  readonly tokens: number
  readonly priority: number // 0..100
  readonly pinned: boolean // nunca descartado
  /** true = conteúdo não-confiável (INV-6). O packer marca explicitamente no prompt. */
  readonly untrusted: boolean
  readonly refs: readonly CodeRef[]
}

export interface ContextPacker {
  pack(req: ContextRequest, signal: AbortSignal): Promise<ContextPack>
}

export interface ContextRequest {
  readonly budgetTokens: number
  readonly sectionBudgets: Readonly<Record<ContextFragment['kind'], number>> // frações
  readonly agent: AgentSpec
  readonly task?: Task
  readonly mustInclude: readonly string[]
  readonly hints: readonly string[]
}

export interface ContextPack {
  readonly fragments: readonly ContextFragment[]
  readonly tokens: number
  readonly budgetTokens: number
  readonly dropped: readonly { id: string; tokens: number; reason: string }[]
  /** Hash determinístico do conteúdo. Mesmo digest ⇒ mesmo contexto. */
  readonly digest: string
  readonly builtAt: number
}

export interface ProjectDigest {
  readonly languages: readonly { name: string; loc: number; share: number }[]
  readonly frameworks: readonly string[]
  readonly architecture: {
    readonly style: string
    readonly layers: readonly string[]
    readonly entrypoints: readonly string[]
  }
  readonly dependencies: {
    readonly direct: number
    readonly outdated: number
    readonly vulnerable: number
  }
  readonly tests: {
    readonly runner?: string
    readonly command?: string
    readonly count?: number
    readonly coverage?: number
  }
  readonly ci: { readonly provider?: string; readonly requiredChecks: readonly string[] }
  readonly database: {
    readonly engine?: string
    readonly orm?: string
    readonly migrations?: string
  }
  readonly docs: readonly string[]
  readonly conventions: readonly string[]
  readonly vcs: { readonly defaultBranch: string; readonly commitStyle?: string }
  readonly summary: string // resumo em linguagem natural
  readonly freshness: string
  readonly generatedAt: number
}
```

---

## 9. Fila e Scheduler

```ts
export interface TaskQueue {
  enqueue(t: Task): Promise<Result<void>>
  /** Lease exclusivo com TTL — expira sozinho se o kernel morrer. */
  claim(id: TaskId, owner: string, ttlMs: number): Promise<Result<Lease>>
  release(lease: Lease, next: TaskState): Promise<Result<void>>
  renew(lease: Lease, ttlMs: number): Promise<Result<void>>
  eligible(ctx: SchedulingContext): Promise<readonly Task[]>
  stats(): Promise<QueueStats>
  deadLetter(): Promise<readonly Task[]>
}

export interface Lease {
  readonly taskId: TaskId
  readonly owner: string
  readonly expiresAt: number
  readonly paths: readonly Glob[] // file-ownership
}

export interface SchedulerPolicy {
  readonly id: string
  /** null ⇒ inelegível (veto). number ⇒ contribuição para o score. */
  score(task: Task, ctx: SchedulingContext): number | null
}

export interface Scheduler {
  next(ctx: SchedulingContext, signal: AbortSignal): Promise<Task | null>
  addPolicy(p: SchedulerPolicy, weight: number): void
  explain(task: Task, ctx: SchedulingContext): SchedulingExplanation // auditabilidade
}

export interface SchedulingContext {
  readonly now: number
  readonly stats: QueueStats
  readonly budget: BudgetState
  readonly activeLeases: readonly Lease[]
  readonly recentOutcomes: readonly { taskId: TaskId; status: string; at: number }[]
  readonly mix: Readonly<Record<TaskKind, number>> // cotas alvo
  readonly observedMix: Readonly<Record<TaskKind, number>>
  readonly providerHealth: Readonly<Record<string, 'up' | 'degraded' | 'down'>>
}
```

---

## 10. Execução e sandbox

```ts
export interface Sandbox {
  acquire(task: Task, signal: AbortSignal): Promise<Result<Workspace>>
  release(ws: Workspace, disposition: 'keep' | 'discard' | 'archive'): Promise<void>
  list(): Promise<readonly WorkspaceRef[]>
  /** Reconciliação pós-crash: workspaces sem task ativa. */
  orphans(): Promise<readonly WorkspaceRef[]>
}

export interface Workspace {
  readonly id: string
  readonly rootDir: string
  readonly branch: string
  readonly baseCommit: string
  readonly ownedPaths: readonly Glob[]
  readonly createdAt: number
}

/** Abstração cross-platform (ADR-011). Nenhum `sh -c` fora daqui. */
export interface ShellRunner {
  run(cmd: ShellCommand, signal: AbortSignal): Promise<ShellResult>
  spawn(cmd: ShellCommand, signal: AbortSignal): ShellProcess
}

export interface ShellCommand {
  readonly command: string
  readonly args?: readonly string[]
  readonly cwd: string
  readonly env?: Readonly<Record<string, string>>
  readonly timeoutMs: number
  readonly shell?: boolean
  readonly maxOutputBytes?: number
}

export interface ShellResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly durationMs: number
  readonly timedOut: boolean
  readonly truncated: boolean
}

export interface VcsAdapter {
  isRepo(dir: string): Promise<boolean>
  isClean(dir: string): Promise<boolean>
  head(dir: string): Promise<string>
  defaultBranch(dir: string): Promise<string>
  worktreeAdd(dir: string, path: string, branch: string, base: string): Promise<Result<void>>
  worktreeRemove(dir: string, path: string, force: boolean): Promise<Result<void>>
  stage(dir: string, paths: readonly string[]): Promise<Result<void>>
  commit(dir: string, msg: CommitMessage): Promise<Result<string>>
  diff(dir: string, opts?: DiffOptions): Promise<DiffSummary>
  push(dir: string, branch: string, opts?: PushOptions): Promise<Result<void>>
}

export interface CodeHost {
  readonly id: 'github' | 'gitlab' | string
  openPullRequest(req: PullRequestRequest): Promise<Result<PullRequestRef>>
  updatePullRequest(ref: PullRequestRef, patch: Partial<PullRequestRequest>): Promise<Result<void>>
  checksStatus(ref: PullRequestRef): Promise<ChecksStatus>
  listIssues(q: IssueQuery): Promise<readonly IssueRef[]>
}

export interface DiffSummary {
  readonly files: readonly { path: string; added: number; removed: number; status: string }[]
  readonly totalAdded: number
  readonly totalRemoved: number
  readonly isEmpty: boolean
}
```

---

## 11. Permissões, orçamento e gates humanos

```ts
export interface PermissionSet {
  readonly tools: { readonly allow: readonly string[]; readonly deny: readonly string[] }
  readonly fs: {
    readonly read: readonly Glob[]
    readonly write: readonly Glob[]
    readonly deny: readonly Glob[]
  }
  readonly network: { readonly allow: readonly string[] } | false
  readonly exec: { readonly allow: readonly string[] } | false
  readonly secrets: { readonly allow: readonly string[] }
}

export interface PermissionBroker {
  /** Interseção agent ∩ plugin ∩ project ∩ global. Sempre restringe. */
  resolve(layers: readonly PermissionSet[]): PermissionSet
  evaluate(req: PermissionRequest): Promise<PermissionDecision>
}

export type PermissionDecision =
  | { readonly effect: 'allow' }
  | { readonly effect: 'deny'; readonly reason: string }
  | { readonly effect: 'ask'; readonly approval: ApprovalRequest }

export interface BudgetGuard {
  admit(estimate: CostEstimate): Result<void, BudgetError>
  consume(actual: { usage: TokenUsage; cost: Money; wallclockMs: number }): void
  state(): BudgetState
}

export interface BudgetState {
  readonly run: BudgetWindow
  readonly task: BudgetWindow
  readonly onExhausted: 'pause' | 'stop' | 'ask'
}

export interface BudgetWindow {
  readonly usd: { readonly limit: number; readonly used: number }
  readonly tokens: { readonly limit: number; readonly used: number }
  readonly wallclockMs: { readonly limit: number; readonly used: number }
}

export interface HumanGate {
  request(r: ApprovalRequest, signal: AbortSignal): Promise<ApprovalDecision>
  pending(): Promise<readonly ApprovalRequest[]>
  resolve(id: string, d: ApprovalDecision): Promise<Result<void>>
}

export interface ApprovalRequest {
  readonly id: string
  readonly kind:
    'merge' | 'command' | 'dependency' | 'migration' | 'ci-change' | 'budget' | 'custom'
  readonly title: string
  readonly detail: string
  readonly diff?: DiffSummary
  readonly risk: 'low' | 'medium' | 'high'
  readonly taskId?: TaskId
  readonly requestedAt: number
  readonly expiresAt?: number
  readonly defaultOnTimeout: 'deny' | 'defer' // NUNCA 'allow'
}

export type ApprovalDecision =
  | { readonly effect: 'granted'; readonly by: string; readonly note?: string }
  | { readonly effect: 'denied'; readonly by: string; readonly reason: string }
```

---

## 12. Estado e checkpoints

```ts
export interface CheckpointManager {
  create(snapshot: KernelSnapshot, eventOffset: number): Promise<Result<Checkpoint>>
  latest(runId: RunId): Promise<Checkpoint | undefined>
  load(id: string): Promise<Result<Checkpoint>>
  list(runId: RunId): Promise<readonly CheckpointRef[]>
  prune(keep: number): Promise<void>
}

export interface Checkpoint {
  readonly id: string
  readonly runId: RunId
  readonly seq: number
  readonly at: number
  readonly eventOffset: number
  readonly snapshot: KernelSnapshot
  readonly workspaces: readonly WorkspaceRef[]
  readonly digest: string // integridade
}

export interface KernelSnapshot {
  readonly phase: TickPhase
  readonly tasks: readonly Task[]
  readonly leases: readonly Lease[]
  readonly budget: BudgetState
  readonly activeAttempt?: Attempt
  readonly contextDigests: Readonly<Record<string, string>>
  readonly pendingApprovals: readonly string[]
}

export type TickPhase =
  | 'recover'
  | 'sense'
  | 'select'
  | 'admit'
  | 'prepare'
  | 'execute'
  | 'verify'
  | 'integrate'
  | 'learn'
  | 'checkpoint'
  | 'idle'

export interface RecoveryManager {
  needsRecovery(runId: RunId): Promise<boolean>
  recover(runId: RunId, signal: AbortSignal): Promise<Result<RecoveryReport>>
}
```

---

## 13. Plugins

```ts
export interface PluginManifest {
  readonly id: string
  readonly name: string
  readonly version: string
  readonly uranus: string // range semver do framework
  readonly description: string
  readonly provides: {
    readonly agents?: readonly string[]
    readonly tools?: readonly string[]
    readonly checks?: readonly string[]
    readonly contextSources?: readonly string[]
    readonly rules?: readonly string[]
    readonly prompts?: readonly string[]
    readonly schedulerPolicies?: readonly string[]
  }
  readonly permissions: PluginPermissions
  readonly detect?: readonly DetectRule[]
}

export type DetectRule =
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'dependency'; readonly manifest: string; readonly name: string }
  | { readonly kind: 'glob'; readonly pattern: Glob }
  | { readonly kind: 'command'; readonly run: string; readonly expectExit: number }

export interface PluginPermissions {
  readonly fs: 'none' | 'read' | 'write'
  readonly net: boolean
  readonly exec: boolean
  readonly secrets: readonly string[]
}

export interface Plugin {
  readonly manifest: PluginManifest
  activate(ctx: PluginContext): void | Promise<void>
  deactivate?(): void | Promise<void>
}

/** ÚNICA superfície exposta a plugins. Sem acesso a kernel/state/eventstore. */
export interface PluginContext {
  readonly project: ProjectRef
  readonly logger: Logger
  readonly config: ConfigReader
  readonly shell: ShellRunner // sujeito às permissões do manifesto

  registerAgent(spec: AgentSpec): void
  registerTool(tool: Tool): void
  registerCheck(check: CheckImpl): void
  registerContextSource(src: ContextSource): void
  registerPrompt(tpl: PromptTemplate): void
  registerRule(rule: Rule): void
  registerSchedulerPolicy(p: SchedulerPolicy, weight: number): void
  /** INV-8: `TestsCheck.runner` é abstrato; o comando concreto é do plugin. */
  registerTestRunner(runner: string, command: string): void

  on<N extends EventName>(name: N | readonly N[], h: EventHandler<N>): Unsubscribe
  intercept<N extends EventName>(
    name: N | readonly N[],
    h: InterceptHandler<N>,
    o?: InterceptOptions,
  ): Unsubscribe
}

export interface PluginLoader {
  discover(project: ProjectRef): Promise<readonly PluginManifest[]>
  load(id: string): Promise<Result<Plugin>>
  activate(p: Plugin, project: ProjectRef): Promise<Result<void>>
  deactivateAll(): Promise<void>
}
```

---

## 14. Kernel

```ts
export interface Kernel {
  start(opts: StartOptions): Promise<Result<RunId>>
  stop(reason: string): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  status(): KernelStatus
  readonly events: EventBus
}

export interface StartOptions {
  readonly projectId: ProjectId
  readonly maxTasks?: number
  readonly until?: number // epoch ms
  readonly budget?: Partial<BudgetState>
  readonly resumeRunId?: RunId
  readonly dryRun?: boolean
}

export interface KernelStatus {
  readonly runId?: RunId
  readonly state: 'idle' | 'running' | 'paused' | 'stopping' | 'recovering'
  readonly phase: TickPhase
  readonly currentTask?: TaskId
  readonly currentAgent?: string
  readonly tick: number
  readonly startedAt?: number
  readonly budget: BudgetState
  readonly queue: QueueStats
}

/** Composition root. Todas as dependências são injetadas — zero singletons. */
export interface KernelDeps {
  readonly clock: Clock
  readonly logger: Logger
  readonly events: EventBus
  readonly eventStore: EventStore
  readonly queue: TaskQueue
  readonly scheduler: Scheduler
  readonly agents: AgentRegistry
  readonly agentRuntime: AgentRuntime
  readonly providers: ProviderRegistry
  readonly context: ContextPacker
  readonly memory: MemoryStore
  readonly sandbox: Sandbox
  readonly verifier: Verifier
  readonly vcs: VcsAdapter
  readonly codeHost?: CodeHost
  readonly permissions: PermissionBroker
  readonly budget: BudgetGuard
  readonly humanGate: HumanGate
  readonly checkpoints: CheckpointManager
  readonly recovery: RecoveryManager
  readonly telemetry: Telemetry
  readonly plugins: PluginLoader
}
```

---

## 15. Regras de compatibilidade

1. **Adição** de campo opcional a uma interface: _minor_.
2. **Adição** de campo obrigatório, remoção, ou mudança de tipo: _major_ + ADR.
3. Interfaces implementadas por terceiros (`Provider`, `Plugin`, `CheckImpl`, `SchedulerPolicy`,
   `ContextSource`, `Tool`) têm a barra mais alta: qualquer mudança exige _deprecation_ por um
   minor antes da remoção.
4. Todo tipo de evento novo é aditivo; renomear evento é _major_.
5. O schema do SQLite tem migrations versionadas e reversíveis.
