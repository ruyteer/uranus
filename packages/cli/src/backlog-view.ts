import type { BacklogProgress, BacklogItemState, StoredBacklogItem } from '@uranus/backlog'
import { backlogProgress } from '@uranus/backlog'
import type { Task } from '@uranus/core'
import { taskStateLabel } from '@uranus/core'

/**
 * Apresentação do backlog — funções puras, testáveis por igualdade de string.
 *
 * Mesma divisão de `task-view.ts`: aqui mora a decisão do que o humano vê de um
 * item (progresso das subtasks, desistência de planejamento, recusas), e o
 * comando em `main.ts` só faz o I/O em volta.
 */

export const BACKLOG_STATE_LABEL: Readonly<Record<BacklogItemState, string>> = {
  open: 'Aberto',
  planned: 'Planejado',
  done: 'Concluído',
  dropped: 'Descartado',
}

/** O item que o item de backlog precisa expor para achar as tasks dele. */
export interface BacklogItemRef {
  readonly id: string
  readonly planId?: string
}

/**
 * As subtasks de um item.
 *
 * O vínculo canônico é `task.backlogItemId`. O casamento por `planId` é o
 * fallback para tasks materializadas ANTES desse campo existir: sem ele, todo
 * item planejado por uma versão anterior apareceria eternamente com "0/0
 * subtasks", que é indistinguível de "o plano não gerou nada".
 */
export function tasksOfItem(tasks: readonly Task[], item: BacklogItemRef): readonly Task[] {
  return tasks.filter(
    (task) =>
      task.backlogItemId === item.id ||
      (task.backlogItemId === undefined && item.planId !== undefined && task.planId === item.planId),
  )
}

export function itemProgress(tasks: readonly Task[], item: BacklogItemRef): BacklogProgress {
  return backlogProgress(tasksOfItem(tasks, item))
}

/**
 * O item saiu do planejamento automático por ter esgotado as tentativas.
 *
 * Só vale enquanto o item continua `open`: um item que acabou sendo planejado
 * (na mão, ou numa tentativa que passou) carrega o contador como histórico, e
 * avisar sobre ele seria alarme falso.
 */
export function gaveUpPlanning(item: StoredBacklogItem, maxPlanningFailures: number): boolean {
  return item.state === 'open' && (item.planningFailures ?? 0) >= maxPlanningFailures
}

/**
 * `3/5 subtasks`, `3/5 · 1 bloqueada · 1 rodando`. Vazio vira `—`, não `0/0`.
 *
 * A palavra "subtasks" some quando há detalhe a mostrar: ela é o que dá sentido
 * ao `3/5` isolado, e com os contadores ao lado o número já se explica — o que
 * importa então é a linha caber na coluna do `uranus backlog list`.
 */
export function formatBacklogProgress(progress: BacklogProgress): string {
  if (progress.total === 0) return '—'
  const fracao = `${String(progress.done)}/${String(progress.total)}`
  const detalhes: string[] = []
  if (progress.blocked > 0) {
    detalhes.push(`${String(progress.blocked)} bloqueada${progress.blocked === 1 ? '' : 's'}`)
  }
  if (progress.active > 0) detalhes.push(`${String(progress.active)} rodando`)
  if (progress.complete) detalhes.push('tudo pronto')
  return detalhes.length === 0 ? `${fracao} subtasks` : [fracao, ...detalhes].join(' · ')
}

const ID_WIDTH = 34
const PROGRESS_WIDTH = 30

export function formatBacklogLine(item: StoredBacklogItem, progress: BacklogProgress): string {
  return (
    `${item.id.padEnd(ID_WIDTH)} ${BACKLOG_STATE_LABEL[item.state].padEnd(10)} ` +
    `p${String(item.priority).padStart(3)}  ${formatBacklogProgress(progress).padEnd(PROGRESS_WIDTH)} ${item.title}`
  )
}

/**
 * Aviso de desistência de uma versão anterior do Uranus (planejamento
 * automático via kernel) — `planningFailures` só existe em item importado de
 * antes deste campo virar histórico morto. Mantido só para não esconder o
 * dado se ele aparecer; nada volta a incrementá-lo.
 */
export function formatGiveUpWarning(item: StoredBacklogItem): string {
  const failures = item.planningFailures ?? 0
  return (
    `  ⚠ ${String(failures)} recusa${failures === 1 ? '' : 's'} de plano registrada${failures === 1 ? '' : 's'} ` +
    `de uma versão anterior.\n` +
    `    Veja o que o validador recusou: uranus backlog show ${item.id}`
  )
}

/** Relatório do `uranus backlog list`, linha a linha. */
export function renderBacklogList(
  items: readonly StoredBacklogItem[],
  tasks: readonly Task[],
  maxPlanningFailures: number,
): readonly string[] {
  const linhas: string[] = [
    `${'id'.padEnd(ID_WIDTH)} ${'estado'.padEnd(10)} prio  ${'progresso'.padEnd(PROGRESS_WIDTH)} título`,
  ]
  let desistidos = 0
  for (const item of items) {
    linhas.push(formatBacklogLine(item, itemProgress(tasks, item)))
    if (gaveUpPlanning(item, maxPlanningFailures)) {
      desistidos += 1
      linhas.push(formatGiveUpWarning(item))
    }
  }
  if (desistidos > 0) {
    linhas.push('')
    linhas.push(
      `${String(desistidos)} item(ns) carregam recusas de planejamento de uma versão anterior. ` +
        'Edite o item e peça pro Claude trabalhar nele: uranus chat.',
    )
  }
  return linhas
}

/** Relatório do `uranus backlog show <id>`, linha a linha. */
export function renderBacklogShow(
  item: StoredBacklogItem,
  tasks: readonly Task[],
  maxPlanningFailures: number,
): readonly string[] {
  const subtasks = tasksOfItem(tasks, item)
  const progress = backlogProgress(subtasks)
  const linhas: string[] = [
    `# ${item.title}`,
    '',
    `id         : ${item.id}`,
    `estado     : ${BACKLOG_STATE_LABEL[item.state]}`,
    `prioridade : ${String(item.priority)}`,
    `origem     : ${item.source}${item.externalRef === undefined ? '' : ` (${item.externalRef})`}`,
    `labels     : ${item.labels.length === 0 ? '—' : item.labels.join(', ')}`,
    `criado em  : ${formatInstant(item.createdAt)}`,
  ]
  if (item.planId !== undefined) {
    linhas.push(
      `plano      : ${item.planId}${item.startedAt === undefined ? '' : ` (planejado em ${formatInstant(item.startedAt)})`}`,
    )
  }

  if (item.body !== '') {
    linhas.push('')
    linhas.push(item.body)
  }

  linhas.push('')
  linhas.push(`Subtasks: ${formatBacklogProgress(progress)}`)
  if (subtasks.length === 0) {
    linhas.push(
      item.state === 'open'
        ? '  (nenhuma — o item ainda não foi planejado)'
        : '  (nenhuma task casa com este item — o plano não materializou nada)',
    )
  }
  for (const task of subtasks) {
    linhas.push(
      `  ${task.id}  ${taskStateLabel(task.state).padEnd(12)} ${task.kind.padEnd(9)} ${task.title}`,
    )
  }

  if (item.lastRejections !== undefined && item.lastRejections.length > 0) {
    linhas.push('')
    linhas.push('O validador recusou o último plano por:')
    for (const rejection of item.lastRejections) linhas.push(`  • ${rejection}`)
  }
  if (gaveUpPlanning(item, maxPlanningFailures)) {
    linhas.push('')
    linhas.push(
      `Este item já teve ${String(item.planningFailures ?? 0)} plano(s) recusado(s) e saiu do ` +
        `planejamento automático (backlog.maxPlanningFailures: ${String(maxPlanningFailures)}).`,
    )
    linhas.push(
      'Reescreva o item para responder às recusas acima — quase sempre o problema é escopo ' +
        'amplo demais ou critério de aceite que nenhum check consegue verificar.',
    )
  }
  return linhas
}

function formatInstant(at: number): string {
  return new Date(at).toISOString().replace('T', ' ').slice(0, 16)
}

// ── entrada guiada ──────────────────────────────────────────────────────────

/**
 * Prioridade digitada no modo guiado.
 *
 * Recusar a entrada e recomeçar o diálogo por causa de um "abc" custaria ao
 * humano tudo o que ele já digitou; o default é o mesmo da flag `--priority`.
 */
export function parsePriority(raw: string, fallback: number): number {
  const texto = raw.trim()
  if (texto === '') return fallback
  const valor = Number.parseInt(texto, 10)
  if (!Number.isFinite(valor)) return fallback
  return Math.min(100, Math.max(0, valor))
}

/** Labels separadas por vírgula; espaço em volta e entrada vazia somem. */
export function parseLabels(raw: string): readonly string[] {
  return raw
    .split(',')
    .map((label) => label.trim())
    .filter((label) => label !== '')
}
