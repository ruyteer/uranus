/**
 * Contagens por aba.
 *
 * Isto é aritmética sobre dados JÁ TRATADOS pelo servidor — somar quantas
 * tasks estão no grupo `attention` não é traduzir estado, é contar. A decisão
 * de que `blocked` pertence a "Precisa de você" continua sendo do servidor,
 * que a toma com `taskGroup()` de `@uranus/core`, o mesmo que o CLI usa.
 */

/**
 * Ordem de exibição dos grupos: o que precisa de decisão humana primeiro.
 * Espelha `TASK_GROUP_ORDER` do CLI — é ordem de tela, não vocabulário.
 */
export const GROUP_ORDER = ['attention', 'working', 'queued', 'finished']

/** Colunas do kanban. O rótulo de cada CARTÃO vem do servidor; isto é layout. */
export const BACKLOG_COLUMNS = [
  { state: 'open', label: 'Aberto', hint: 'Ainda não virou plano.' },
  { state: 'planned', label: 'Planejado', hint: 'Já tem tasks derivadas.' },
  { state: 'done', label: 'Concluído', hint: 'Todas as tasks terminaram.' },
  { state: 'dropped', label: 'Descartado', hint: 'Saiu do caminho.' },
]

export function asArray(value) {
  return Array.isArray(value) ? value : []
}

/**
 * Agrupa `TaskView[]` na ordem de tela, usando o `groupLabel` do servidor.
 * Grupo vazio some — uma seção "Encerrada (0)" só ocupa altura.
 */
export function groupTasks(items) {
  const buckets = new Map()
  for (const item of items) {
    const key = typeof item.group === 'string' ? item.group : 'queued'
    const bucket = buckets.get(key)
    if (bucket) bucket.tasks.push(item)
    else buckets.set(key, { group: key, label: item.groupLabel ?? key, tasks: [item] })
  }
  const known = GROUP_ORDER.map((group) => buckets.get(group)).filter(Boolean)
  const unknown = [...buckets.values()].filter((bucket) => !GROUP_ORDER.includes(bucket.group))
  return [...known, ...unknown]
}

export function countByGroup(items) {
  const counts = { attention: 0, working: 0, queued: 0, finished: 0 }
  for (const item of items) {
    if (item.group in counts) counts[item.group] += 1
  }
  return counts
}

export function taskMetrics(items) {
  const counts = countByGroup(items)
  let attempts = 0
  let repairs = 0
  let blocked = 0
  for (const item of items) {
    attempts += Number(item.attempts ?? 0)
    repairs += Number(item.repairAttempts ?? 0)
    if (item.blockReason) blocked += 1
  }
  return {
    ...counts,
    total: items.length,
    blocked,
    repairs,
    avgAttempts: items.length === 0 ? 0 : attempts / items.length,
  }
}

export function backlogMetrics(items) {
  const counts = { open: 0, planned: 0, done: 0, dropped: 0 }
  let subtasksDone = 0
  let subtasksTotal = 0
  for (const item of items) {
    if (item.state in counts) counts[item.state] += 1
    const progress = item.progress
    if (progress && typeof progress === 'object') {
      subtasksDone += Number(progress.done ?? 0)
      subtasksTotal += Number(progress.total ?? 0)
    }
  }
  // Item descartado sai do denominador: ele não é trabalho pendente nem
  // trabalho entregue, e mantê-lo derrubaria a taxa por uma decisão de não
  // fazer — que é o oposto de um problema.
  const considered = counts.open + counts.planned + counts.done
  return {
    ...counts,
    total: items.length,
    considered,
    completion: considered === 0 ? undefined : counts.done / considered,
    subtasksDone,
    subtasksTotal,
  }
}

export function validationMetrics(payload) {
  const rules = asArray(payload?.rules)
  let off = 0
  let advisory = 0
  let blocking = 0
  let overridden = 0
  for (const rule of rules) {
    if (rule.severity === 'blocking') blocking += 1
    else if (rule.severity === 'advisory') advisory += 1
    else off += 1
    if (rule.origin !== undefined && rule.origin !== 'default') overridden += 1
  }
  return { total: rules.length, off, advisory, blocking, overridden, on: advisory + blocking }
}

/**
 * `3/5 subtasks`, `3/5 · 1 bloqueada`.
 *
 * O texto canônico vem pronto em `progress.label` — o servidor o monta com o
 * mesmo formato do `uranus backlog list`. As duas últimas linhas são reserva
 * para o caso de o campo faltar: melhor uma fração crua do que um buraco.
 */
export function progressText(item) {
  const progress = item.progress
  if (!progress || typeof progress !== 'object') return '—'
  if (typeof progress.label === 'string' && progress.label !== '') return progress.label
  const total = Number(progress.total ?? 0)
  if (total === 0) return '—'
  return `${String(Number(progress.done ?? 0))}/${String(total)} subtasks`
}

/** Rótulo tratado do servidor, com o valor cru como reserva visível. */
export function label(item, field, raw) {
  const value = item?.[field]
  return typeof value === 'string' && value !== '' ? value : (item?.[raw] ?? '—')
}
