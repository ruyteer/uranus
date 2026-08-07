import type { PlanId, ProjectId, TaskId } from '../ids.js'
import type { Glob } from '../util/glob.js'
import type { AcceptanceContract } from './acceptance.js'

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

export const TASK_KINDS: readonly TaskKind[] = [
  'feature',
  'bugfix',
  'refactor',
  'test',
  'docs',
  'chore',
  'security',
  'perf',
  'deps',
  'infra',
  'review',
  'investigation',
  'migration',
]

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

export type BlockReasonKind =
  'approval' | 'dependency' | 'budget' | 'lease' | 'permission' | 'human' | 'provider' | 'exhausted'

export interface BlockReason {
  readonly kind: BlockReasonKind
  readonly message: string
  /** Quem consegue destravar. Define se isto vai para a fila de aprovação humana. */
  readonly resolvableBy: 'human' | 'kernel' | 'time'
  readonly data?: Readonly<Record<string, unknown>>
}

export interface Task {
  readonly id: TaskId
  readonly projectId: ProjectId
  readonly planId?: PlanId
  readonly kind: TaskKind
  readonly title: string
  /**
   * A especificação em linguagem natural. **Não é um prompt** — o prompt é montado
   * pelo `PromptRegistry` a partir disto. Concentrar instrução de execução aqui
   * seria recriar o "prompt gigante" que a arquitetura proíbe.
   */
  readonly intent: string
  readonly state: TaskState
  /** 0..100. Calculado pelo Scheduler; não é entrada do usuário. */
  readonly priority: number
  readonly deps: readonly TaskId[]
  /**
   * Globs que a task pode tocar. Origem de três garantias:
   *  - lease de propriedade de arquivo entre worktrees paralelos (R6)
   *  - `fs.write` efetivo do agente (INV-5)
   *  - `DiffCheck.requirePathsWithin` na verificação
   */
  readonly touches: readonly Glob[]
  /** Obrigatório — INV-2. */
  readonly acceptance: AcceptanceContract
  readonly agentHint?: string
  readonly attempts: number
  readonly maxAttempts: number
  readonly blockReason?: BlockReason
  readonly labels: readonly string[]
  readonly createdAt: number
  readonly updatedAt: number
}

/** Task antes de entrar na fila: sem id, sem estado, sem contadores. */
export interface TaskDraft {
  readonly kind: TaskKind
  readonly title: string
  readonly intent: string
  readonly touches: readonly Glob[]
  readonly acceptance: AcceptanceContract
  readonly deps?: readonly TaskId[]
  readonly agentHint?: string
  readonly maxAttempts?: number
  readonly labels?: readonly string[]
  readonly planId?: PlanId
}

export const TERMINAL_STATES: ReadonlySet<TaskState> = new Set<TaskState>(['done', 'abandoned'])

/** Estados em que a task ocupa um slot de execução e detém um lease. */
export const ACTIVE_STATES: ReadonlySet<TaskState> = new Set<TaskState>([
  'claimed',
  'running',
  'verifying',
  'verified',
  'integrating',
])

export function isTerminal(state: TaskState): boolean {
  return TERMINAL_STATES.has(state)
}

export function isActive(state: TaskState): boolean {
  return ACTIVE_STATES.has(state)
}

export function hasAttemptsLeft(task: Task): boolean {
  return task.attempts < task.maxAttempts
}

/** Tasks cujas dependências ainda não terminaram não são elegíveis. */
export function dependenciesSatisfied(
  task: Task,
  stateOf: (id: TaskId) => TaskState | undefined,
): boolean {
  return task.deps.every((id) => stateOf(id) === 'done')
}
