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

/**
 * Ascendência de uma task que nasceu de um achado de revisão.
 *
 * Existe por um motivo só: dar à cadeia de qualidade um ponto fixo. Toda task
 * concluída passa pelos gates, e todo achado dos gates virava task — que ao
 * concluir passa pelos gates de novo. A recorrência não tem caso base, e o
 * resultado observado é o que se espera de uma recorrência sem caso base: a
 * fila cresce mais rápido do que drena, indefinidamente, e o humano vê
 * dezenas de correções que ele nunca pediu.
 *
 * `generation` é o contador que uma política EM CÓDIGO corta (INV-1: quem
 * decide o fluxo é o harness, não o modelo). `fingerprint` é a identidade do
 * achado: a mesma queixa, sobre o mesmo arquivo, nunca vira duas tasks — nem
 * dentro do run, nem entre runs, porque isto é persistido.
 */
export interface TaskLineage {
  /** A task que o humano de fato pediu — raiz da árvore de correções. */
  readonly rootTaskId: TaskId
  readonly parentTaskId: TaskId
  /** 1 = filha direta de um achado sobre uma task de origem humana. */
  readonly generation: number
  /** Identidade estável do achado que gerou esta task. */
  readonly fingerprint?: string
  /** Gate que levantou o achado (`reviewer`, `security`, `qa`). */
  readonly raisedBy?: string
}

export interface Task {
  readonly id: TaskId
  readonly projectId: ProjectId
  readonly planId?: PlanId
  /**
   * Item de backlog que originou esta task. Ausente em task criada à mão.
   *
   * Link direto, e não derivado de `planId`, por dois motivos: descobrir "de
   * que item veio isto" varrendo o backlog inteiro custa uma leitura de todos
   * os arquivos a cada consulta, e um replanejamento troca o `planId` da task
   * — o vínculo com o item sobreviveria só por acidente. O id do item é o
   * identificador estável, e é o que permite fechar o item sozinho quando
   * todas as suas tasks terminam.
   */
  readonly backlogItemId?: string
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
  /**
   * Falhas de validação já corrigidas em reparo dirigido — contador separado,
   * que NÃO conta para `maxAttempts`.
   *
   * Existe porque "o diff saiu do escopo declarado" e "o código não compila"
   * têm o mesmo efeito hoje (gasta tentativa, encaminha para replanejamento) e
   * não deveriam: a primeira é violação de política, corrigível na própria task
   * com o problema concreto em mãos. Misturar as duas no mesmo contador é o que
   * fazia uma task morrer em três violações de escopo e virar plano novo.
   */
  readonly repairAttempts: number
  readonly blockReason?: BlockReason
  readonly labels: readonly string[]
  /** Presente só em tasks derivadas de achado. Ausência = origem humana (geração 0). */
  readonly lineage?: TaskLineage
  readonly createdAt: number
  readonly updatedAt: number
}

/** Geração desta task na árvore de correções. Origem humana = 0. */
export function taskGeneration(task: Task): number {
  return task.lineage?.generation ?? 0
}

/** Raiz da árvore de correções — a task que o humano pediu. */
export function taskRoot(task: Task): TaskId {
  return task.lineage?.rootTaskId ?? task.id
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
  readonly lineage?: TaskLineage
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

// ── Apresentação ────────────────────────────────────────────────────────────

/**
 * Agrupamento derivado dos onze estados, para CLI e dashboard.
 *
 * Derivado, e não um `TaskState` novo: a máquina de estados é verificada
 * exaustivamente pelo teste de caos sobre o produto cartesiano de estados, e
 * estado novo custa esse risco. Quem só precisa mostrar "onde isto está" não
 * precisa pagar por ele.
 */
export type TaskGroup = 'queued' | 'working' | 'attention' | 'finished'

const TASK_GROUPS: Readonly<Record<TaskState, TaskGroup>> = Object.freeze({
  draft: 'queued',
  ready: 'queued',
  claimed: 'working',
  running: 'working',
  verifying: 'working',
  verified: 'working',
  integrating: 'working',
  failed: 'attention',
  blocked: 'attention',
  done: 'finished',
  abandoned: 'finished',
})

export function taskGroup(task: Task): TaskGroup {
  return TASK_GROUPS[task.state]
}

export function taskStateGroup(state: TaskState): TaskGroup {
  return TASK_GROUPS[state]
}

const TASK_STATE_LABELS: Readonly<Record<TaskState, string>> = Object.freeze({
  draft: 'Rascunho',
  ready: 'Na fila',
  claimed: 'Reservada',
  running: 'Executando',
  verifying: 'Verificando',
  verified: 'Verificada',
  failed: 'Falhou',
  integrating: 'Integrando',
  blocked: 'Bloqueada',
  done: 'Concluída',
  abandoned: 'Abandonada',
})

const TASK_GROUP_LABELS: Readonly<Record<TaskGroup, string>> = Object.freeze({
  queued: 'Na fila',
  working: 'Em andamento',
  attention: 'Precisa de você',
  finished: 'Encerrada',
})

/** Rótulo humano em pt-BR. Usado pelo CLI e pela dashboard. */
export function taskStateLabel(state: TaskState): string {
  return TASK_STATE_LABELS[state]
}

export function taskGroupLabel(group: TaskGroup): string {
  return TASK_GROUP_LABELS[group]
}

/** Tasks cujas dependências ainda não terminaram não são elegíveis. */
export function dependenciesSatisfied(
  task: Task,
  stateOf: (id: TaskId) => TaskState | undefined,
): boolean {
  return task.deps.every((id) => stateOf(id) === 'done')
}
