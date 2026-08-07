import type {
  ApprovalId,
  AttemptId,
  CheckpointId,
  EventId,
  MemoryId,
  PlanId,
  ProjectId,
  RunId,
  SessionId,
  TaskId,
  WorkspaceId,
} from '../ids.js'
import type { BudgetDimension } from './budget.js'
import type { ApprovalDecision, ApprovalKind } from './permission.js'
import type { CheckResult, Diagnosis, Verification } from './verification.js'
import type { DiffSummary, PullRequestRef } from './vcs.js'
import type { MemoryScope } from './memory.js'
import type { PlanRejection } from './plan.js'
import type { TaskKind, TaskState } from './task.js'
import type { TickPhase } from './project.js'
import type { Money, TokenUsage } from './usage.js'

/**
 * Catálogo de eventos — INV-3: "todo efeito colateral é um evento; sem evento,
 * não aconteceu".
 *
 * O catálogo vive em `core` (e não em `@uranus/events`) porque é tipo puro, e
 * porque `EventBus` é um contrato que precisa referenciá-lo sem criar ciclo entre
 * contrato e implementação.
 *
 * Eventos de *streaming* (delta de texto do modelo) deliberadamente NÃO estão
 * aqui: um run de 8 horas geraria centenas de milhares deles e o event store
 * deixaria de ser auditável (R15). Delta vai para o log de run e o WebSocket.
 */
export interface EventPayloads {
  // ── Ciclo de vida do kernel ───────────────────────────────────────────────
  KernelStarted: { runId: RunId; resumedFrom?: RunId; concurrency: number }
  KernelStopped: { runId: RunId; reason: string; ticks: number }
  KernelPaused: { runId: RunId; reason: string }
  KernelResumed: { runId: RunId }
  TickStarted: { runId: RunId; tick: number }
  TickCompleted: { runId: RunId; tick: number; phase: TickPhase; durationMs: number }
  TickFailed: { runId: RunId; tick: number; phase: TickPhase; error: string }

  // ── Projeto e contexto ────────────────────────────────────────────────────
  ProjectAttached: { projectId: ProjectId; rootDir: string; plugins: readonly string[] }
  ProjectDigestUpdated: { freshness: string; signalStrength: number; restricted: boolean }
  ContextUpdated: { sourceId: string; fragments: number; freshness: string }
  ContextPackBuilt: {
    digest: string
    tokens: number
    budgetTokens: number
    dropped: number
    agent: string
  }

  // ── Backlog e planejamento ────────────────────────────────────────────────
  BacklogIngested: { source: string; items: number }
  BacklogItemCreated: { itemId: string; title: string }
  PlanCreated: { planId: PlanId; sourceItemId: string; tasks: number }
  PlanRejected: { sourceItemId: string; rejections: readonly PlanRejection[] }

  // ── Tarefas ───────────────────────────────────────────────────────────────
  TaskCreated: { taskId: TaskId; kind: TaskKind; title: string; planId?: PlanId }
  TaskQueued: { taskId: TaskId; priority: number }
  TaskClaimed: { taskId: TaskId; owner: string; leaseExpiresAt: number }
  TaskStarted: { taskId: TaskId; attemptId: AttemptId; agent: string; provider: string }
  TaskStateChanged: { taskId: TaskId; from: TaskState; to: TaskState; reason: string }
  TaskBlocked: { taskId: TaskId; kind: string; message: string; resolvableBy: string }
  TaskUnblocked: { taskId: TaskId; by: string }
  TaskCompleted: { taskId: TaskId; attempts: number; totalCost: Money }
  TaskFailed: { taskId: TaskId; attemptId: AttemptId; diagnosis: Diagnosis }
  TaskRetried: { taskId: TaskId; attempt: number; reason: string }
  TaskReplanned: { taskId: TaskId; reason: string }
  TaskAbandoned: { taskId: TaskId; reason: string }

  // ── Execução do agente ────────────────────────────────────────────────────
  AgentRunStarted: {
    sessionId: SessionId
    attemptId: AttemptId
    agent: string
    provider: string
    model: string
    contextDigest: string
  }
  AgentRunFinished: {
    sessionId: SessionId
    status: string
    turns: number
    usage: TokenUsage
    cost: Money
  }
  ToolCalled: { sessionId: SessionId; tool: string; callId: string }
  ToolResultReceived: { sessionId: SessionId; callId: string; ok: boolean; summary: string }
  ToolDenied: { sessionId: SessionId; tool: string; reason: string }

  // ── Verificação (INV-2) ───────────────────────────────────────────────────
  VerificationStarted: { taskId: TaskId; attemptId: AttemptId; checks: number }
  CheckPassed: { taskId: TaskId; result: CheckResult }
  CheckFailed: { taskId: TaskId; result: CheckResult }
  VerificationCompleted: { taskId: TaskId; attemptId: AttemptId; verification: Verification }
  TestsPassed: { taskId: TaskId; runner: string; total: number; durationMs: number }
  TestsFailed: { taskId: TaskId; runner: string; failed: number; total: number }
  BugDetected: { taskId?: TaskId; title: string; severity: string; evidence: string }
  SecurityFindingRaised: { taskId?: TaskId; title: string; severity: string; path?: string }
  ReviewCompleted: { taskId: TaskId; verdict: string; findings: number; blocking: number }

  // ── Sandbox e VCS ─────────────────────────────────────────────────────────
  WorkspaceCreated: { workspaceId: WorkspaceId; taskId: TaskId; branch: string; rootDir: string }
  WorkspaceReleased: { workspaceId: WorkspaceId; disposition: string }
  WorkspaceOrphaned: { workspaceId: WorkspaceId; rootDir: string; archivedTo?: string }
  BranchCreated: { branch: string; base: string }
  CommitCreated: { taskId: TaskId; sha: string; subject: string; diff: DiffSummary }
  PRCreated: { taskId: TaskId; pr: PullRequestRef }
  PRUpdated: { taskId: TaskId; pr: PullRequestRef }
  MergeBlocked: { taskId: TaskId; reason: string }

  // ── Memória ───────────────────────────────────────────────────────────────
  MemoryUpdated: { memoryId: MemoryId; scope: MemoryScope; key: string; confidence: number }
  MemoryConflictDetected: {
    scope: MemoryScope
    key: string
    existingId: MemoryId
    reason: string
  }
  MemoryCompacted: { scope: MemoryScope; before: number; after: number }
  MemoryInvalidated: { memoryId: MemoryId; reason: string }

  // ── Estado e recuperação (INV-4) ──────────────────────────────────────────
  CheckpointCreated: { checkpointId: CheckpointId; eventOffset: number; digest: string }
  CheckpointRestored: { checkpointId: CheckpointId; eventOffset: number }
  CheckpointCorrupted: { checkpointId: CheckpointId; expected: string; actual: string }
  RecoveryStarted: { runId: RunId; fromCheckpoint?: CheckpointId }
  RecoveryCompleted: {
    runId: RunId
    eventsReplayed: number
    tasksReset: number
    orphansFound: number
  }

  // ── Recursos (INV-7) ──────────────────────────────────────────────────────
  TokensConsumed: { taskId?: TaskId; usage: TokenUsage; cost: Money; provider: string }
  BudgetThresholdReached: { window: string; dimension: BudgetDimension; ratio: number }
  BudgetExhausted: { window: string; dimension: BudgetDimension; policy: string }
  RateLimited: { provider: string; retryAfterMs: number }
  ProviderDegraded: { provider: string; reason: string; consecutiveFailures: number }

  // ── Supervisão humana ─────────────────────────────────────────────────────
  ApprovalRequested: { approvalId: ApprovalId; kind: ApprovalKind; title: string; risk: string }
  ApprovalGranted: { approvalId: ApprovalId; decision: ApprovalDecision }
  ApprovalDenied: { approvalId: ApprovalId; decision: ApprovalDecision }
  HumanInterventionRequested: { taskId?: TaskId; reason: string }

  // ── Plugins ───────────────────────────────────────────────────────────────
  PluginLoaded: { pluginId: string; version: string; provides: readonly string[] }
  PluginFailed: { pluginId: string; phase: string; error: string }
  PluginVetoed: { pluginId: string; event: string; reason: string }
}

export type EventName = keyof EventPayloads

export type Actor =
  | { readonly type: 'kernel' }
  | { readonly type: 'agent'; readonly name: string }
  | { readonly type: 'plugin'; readonly id: string }
  | { readonly type: 'human'; readonly id: string }

export const KERNEL_ACTOR: Actor = Object.freeze({ type: 'kernel' })

export interface UranusEvent<N extends EventName = EventName> {
  readonly id: EventId
  /** Monotônico global. Atribuído pelo `EventStore`, nunca pelo emissor. */
  readonly seq: number
  readonly name: N
  readonly at: number
  readonly actor: Actor
  readonly projectId: ProjectId
  readonly runId?: RunId
  readonly taskId?: TaskId
  readonly attemptId?: AttemptId
  readonly payload: EventPayloads[N]
  /** Evento que causou este. Reconstrói a cadeia causal no debug temporal. */
  readonly causationId?: EventId
  readonly correlationId?: string
}

export interface EventMeta {
  readonly actor?: Actor
  readonly runId?: RunId
  readonly taskId?: TaskId
  readonly attemptId?: AttemptId
  readonly causationId?: EventId
  readonly correlationId?: string
}

export interface EventQuery {
  readonly names?: readonly EventName[]
  readonly runId?: RunId
  readonly taskId?: TaskId
  readonly fromSeq?: number
  readonly toSeq?: number
  readonly fromAt?: number
  readonly toAt?: number
  readonly limit?: number
}
