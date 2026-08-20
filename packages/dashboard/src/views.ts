import type { Task, TaskState } from '@uranus/core'
import { isActive, isTerminal, taskGroupLabel, taskStateGroup, taskStateLabel } from '@uranus/core'
import type { StoredBacklogItemLike } from './data.js'

/**
 * Tradução de dado cru para dado de tela.
 *
 * Quem traduz é o servidor, não o cliente. O pedido do usuário é literal —
 * *"se o status tá salvo como 'done, blocked, ready', na dashboard vc traduz"* —
 * e o lugar certo é aqui porque este processo já tem `@uranus/core`: os rótulos
 * saem de `taskStateLabel`/`taskGroupLabel`, exatamente os mesmos que o CLI
 * imprime. Uma tradução paralela no navegador significaria duas telas dizendo
 * coisas diferentes sobre o mesmo estado, e a que erra é sempre a que ninguém
 * lembrou de atualizar.
 */

/** Qual token de cor a UI usa. Nome semântico, não a cor em si. */
export type ViewTone = 'success' | 'danger' | 'info' | 'neutral' | 'warning'

export interface TaskBlockReasonView {
  readonly kind: string
  readonly message: string
  readonly resolvableBy: string
}

export interface TaskView {
  readonly id: string
  readonly title: string
  readonly kind: string
  /** Cru, para a lógica do cliente (comparar, filtrar, mandar de volta). */
  readonly state: string
  /** `taskStateLabel` — "Concluída". */
  readonly stateLabel: string
  readonly group: string
  /** `taskGroupLabel` — "Precisa de você". */
  readonly groupLabel: string
  readonly tone: ViewTone
  readonly attempts: number
  readonly maxAttempts: number
  readonly repairAttempts: number
  readonly priority: number
  readonly labels: readonly string[]
  readonly intent: string
  readonly touches: readonly string[]
  readonly backlogItemId?: string
  readonly blockReason?: TaskBlockReasonView
  readonly createdAt: number
  readonly updatedAt: number
  /** "há 4 min". */
  readonly updatedLabel: string
}

/**
 * Estado → tom. Escrito por extenso, e não derivado do grupo, porque `blocked`
 * e `failed` caem no mesmo grupo ("Precisa de você") e não pedem a mesma cor:
 * uma falhou, a outra está esperando alguém. `Record` completo para o
 * compilador cobrar a decisão quando um estado novo nascer.
 */
const STATE_TONES: Readonly<Record<TaskState, ViewTone>> = Object.freeze({
  draft: 'neutral',
  ready: 'neutral',
  claimed: 'info',
  running: 'info',
  verifying: 'info',
  verified: 'info',
  integrating: 'info',
  failed: 'danger',
  blocked: 'warning',
  done: 'success',
  abandoned: 'neutral',
})

export function taskTone(state: TaskState): ViewTone {
  return STATE_TONES[state]
}

/**
 * Os onze estados, na ordem do ciclo de vida.
 *
 * Derivada de `STATE_TONES` e não escrita de novo: aquele `Record` é exaustivo
 * sobre `TaskState`, então o compilador já cobra a entrada quando um estado
 * novo nasce, e esta lista acompanha sozinha.
 */
export const TASK_STATES: readonly TaskState[] = Object.freeze(
  Object.keys(STATE_TONES) as TaskState[],
)

export interface TaskStateOption {
  readonly value: string
  readonly label: string
  readonly group: string
  readonly groupLabel: string
  readonly tone: ViewTone
}

/**
 * O vocabulário de estados para o seletor de "mudar estado".
 *
 * A tela precisa oferecer estados que ainda não existem em task nenhuma — e é
 * por isso que a lista não pode sair das tasks carregadas. Sai daqui para que
 * o painel não tenha uma segunda tabela de rótulos: os que ele mostra são
 * sempre os de `taskStateLabel`. Não é autoridade sobre transição: quem decide
 * se o salto é legal continua sendo a máquina de estados, do outro lado da
 * porta de dados.
 */
export function taskStateOptions(): readonly TaskStateOption[] {
  return TASK_STATES.map((state) => {
    const group = taskStateGroup(state)
    return {
      value: state,
      label: taskStateLabel(state),
      group,
      groupLabel: taskGroupLabel(group),
      tone: STATE_TONES[state],
    }
  })
}

export function taskView(task: Task, now: number): TaskView {
  const group = taskStateGroup(task.state)
  return {
    id: task.id,
    title: task.title,
    kind: task.kind,
    state: task.state,
    stateLabel: taskStateLabel(task.state),
    group,
    groupLabel: taskGroupLabel(group),
    tone: STATE_TONES[task.state],
    attempts: task.attempts,
    maxAttempts: task.maxAttempts,
    repairAttempts: task.repairAttempts,
    priority: task.priority,
    labels: task.labels,
    intent: task.intent,
    touches: task.touches,
    ...(task.backlogItemId === undefined ? {} : { backlogItemId: task.backlogItemId }),
    ...(task.blockReason === undefined
      ? {}
      : {
          blockReason: {
            kind: task.blockReason.kind,
            message: task.blockReason.message,
            resolvableBy: task.blockReason.resolvableBy,
          },
        }),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    updatedLabel: relativeLabel(task.updatedAt, now),
  }
}

// ── backlog ─────────────────────────────────────────────────────────────────

/**
 * Rótulos dos quatro estados de item, iguais aos de `BACKLOG_STATE_LABEL` do
 * CLI. Duplicados aqui só porque `@uranus/dashboard` não pode importar de
 * `@uranus/cli` (a seta do grafo aponta ao contrário); os dois precisam mudar
 * juntos, e é para isso que serve este comentário.
 */
const BACKLOG_STATE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  open: 'Aberto',
  planned: 'Planejado',
  done: 'Concluído',
  dropped: 'Descartado',
})

export const BACKLOG_STATES: readonly string[] = Object.freeze([
  'open',
  'planned',
  'done',
  'dropped',
])

const BACKLOG_TONES: Readonly<Record<string, ViewTone>> = Object.freeze({
  open: 'neutral',
  planned: 'info',
  done: 'success',
  dropped: 'warning',
})

export interface BacklogProgressView {
  readonly total: number
  readonly done: number
  readonly blocked: number
  readonly active: number
  readonly queued: number
  readonly complete: boolean
  /** "3/5 subtasks", "3/5 · 1 bloqueada", "—" quando não há task nenhuma. */
  readonly label: string
}

export interface BacklogItemView {
  readonly id: string
  readonly title: string
  readonly body: string
  readonly state: string
  readonly stateLabel: string
  readonly tone: ViewTone
  readonly priority: number
  readonly labels: readonly string[]
  readonly source: string
  readonly planId?: string
  readonly lastRejections?: readonly string[]
  readonly planningFailures: number
  readonly progress: BacklogProgressView
  readonly createdAt: number
  readonly createdLabel: string
  readonly startedAt?: number
}

/**
 * As tasks de um item. O vínculo canônico é `task.backlogItemId`; o casamento
 * por `planId` é o fallback para tasks materializadas antes desse campo
 * existir — sem ele, todo item planejado por uma versão anterior apareceria
 * com "0/0 subtasks", que é indistinguível de "o plano não gerou nada".
 *
 * Espelha `tasksOfItem`/`backlogProgress` de `@uranus/backlog`, que este pacote
 * não pode importar sem inventar uma dependência nova só para contar tasks.
 */
export function backlogProgressView(
  tasks: readonly Task[],
  item: { readonly id: string; readonly planId?: string },
): BacklogProgressView {
  let done = 0
  let blocked = 0
  let active = 0
  let queued = 0
  let terminal = 0
  let total = 0

  for (const task of tasks) {
    const meu =
      task.backlogItemId === item.id ||
      (task.backlogItemId === undefined && item.planId !== undefined && task.planId === item.planId)
    if (!meu) continue
    total++
    if (isTerminal(task.state)) {
      terminal++
      if (task.state === 'done') done++
      continue
    }
    if (task.state === 'blocked') blocked++
    else if (isActive(task.state)) active++
    else queued++
  }

  const complete = total > 0 && done > 0 && terminal === total
  return {
    total,
    done,
    blocked,
    active,
    queued,
    complete,
    label: progressLabel({ total, done, blocked, active, complete }),
  }
}

function progressLabel(p: {
  total: number
  done: number
  blocked: number
  active: number
  complete: boolean
}): string {
  if (p.total === 0) return '—'
  const fracao = `${p.done}/${p.total}`
  const detalhes: string[] = []
  if (p.blocked > 0) detalhes.push(`${p.blocked} bloqueada${p.blocked === 1 ? '' : 's'}`)
  if (p.active > 0) detalhes.push(`${p.active} rodando`)
  if (p.complete) detalhes.push('tudo pronto')
  return detalhes.length === 0 ? `${fracao} subtasks` : [fracao, ...detalhes].join(' · ')
}

export function backlogItemView(
  item: StoredBacklogItemLike,
  progress: BacklogProgressView,
  now: number,
): BacklogItemView {
  return {
    id: item.id,
    title: item.title,
    body: item.body,
    state: item.state,
    // Estado desconhecido não vira tela em branco: mostra o valor cru, que é o
    // que permite alguém descobrir que o arquivo YAML tem um estado inválido.
    stateLabel: BACKLOG_STATE_LABELS[item.state] ?? item.state,
    tone: BACKLOG_TONES[item.state] ?? 'neutral',
    priority: item.priority,
    labels: item.labels,
    source: item.source,
    ...(item.planId === undefined ? {} : { planId: item.planId }),
    ...(item.lastRejections === undefined ? {} : { lastRejections: item.lastRejections }),
    planningFailures: item.planningFailures ?? 0,
    progress,
    createdAt: item.createdAt,
    createdLabel: relativeLabel(item.createdAt, now),
    ...(item.startedAt === undefined ? {} : { startedAt: item.startedAt }),
  }
}

// ── tempo ───────────────────────────────────────────────────────────────────

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * "há 4 min". Relativo e não absoluto porque a pergunta que o painel responde
 * é "isto ainda está andando?", e `14:32` só responde isso depois de o leitor
 * fazer a subtração de cabeça.
 *
 * Timestamp no futuro vira "agora" em vez de "há -3 min": relógio fora de
 * ordem entre processos existe, e a saída não pode virar ruído por causa dele.
 */
export function relativeLabel(at: number, now: number): string {
  if (!Number.isFinite(at) || !Number.isFinite(now)) return '—'
  const diff = now - at
  if (diff < 45_000) return 'agora'
  if (diff < HOUR) return `há ${Math.max(1, Math.round(diff / MINUTE))} min`
  if (diff < DAY) return `há ${Math.max(1, Math.round(diff / HOUR))} h`
  return `há ${Math.max(1, Math.floor(diff / DAY))} d`
}
