import type { ProjectId, RunId, TaskId } from '../ids.js'
import type { BudgetState } from './budget.js'
import type { TaskKind, TaskState } from './task.js'

export interface ProjectRef {
  readonly id: ProjectId
  readonly name: string
  /** Raiz do repositório, caminho absoluto nativo. */
  readonly rootDir: string
  /** `<rootDir>/.uranus` por padrão. */
  readonly uranusDir: string
}

export interface Project extends ProjectRef {
  readonly defaultBranch: string
  readonly branchPrefix: string
  readonly attachedAt: number
  readonly plugins: readonly string[]
}

export type RunStatus = 'running' | 'paused' | 'stopping' | 'completed' | 'failed' | 'interrupted'

export interface Run {
  readonly id: RunId
  readonly projectId: ProjectId
  readonly startedAt: number
  readonly finishedAt?: number
  readonly status: RunStatus
  readonly tick: number
  readonly stopReason?: string
  /** Run retomado a partir de um checkpoint anterior. */
  readonly resumedFrom?: RunId
}

/** As dez fases do ciclo do kernel, na ordem. */
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

export const TICK_PHASES: readonly TickPhase[] = [
  'recover',
  'sense',
  'select',
  'admit',
  'prepare',
  'execute',
  'verify',
  'integrate',
  'learn',
  'checkpoint',
]

export interface QueueStats {
  readonly total: number
  readonly byState: Readonly<Record<TaskState, number>>
  readonly byKind: Readonly<Record<TaskKind, number>>
  readonly oldestReadyAt?: number
  readonly deadLettered: number
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
