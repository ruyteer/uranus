/**
 * Formatação de NÚMERO e de TEMPO — nada de vocabulário de domínio.
 *
 * A tradução de estado (`done` → "Concluída"), de grupo e de severidade é do
 * servidor, que tem `@uranus/core` e é a mesma fonte que o CLI usa. Se o
 * cliente também traduzisse, as duas telas divergiriam no primeiro estado novo
 * — e o painel diria uma coisa enquanto o `uranus task list` diz outra.
 * Quando o rótulo tratado não vem, mostramos o valor cru: é honesto, e o
 * campo faltando fica visível em vez de ser mascarado por um palpite.
 */

const NUMBER = new Intl.NumberFormat('pt-BR')
const TIME = new Intl.DateTimeFormat('pt-BR', { hour12: false, timeStyle: 'medium' })
const DATETIME = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

export function money(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—'
  const n = Number(value)
  // Centavos importam num painel de custo por token: abaixo de 1 centavo o
  // arredondamento em 2 casas mostraria "$0.00" para todo run curto.
  return n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`
}

export function int(value) {
  return value === null || value === undefined ? '—' : NUMBER.format(Number(value))
}

export function compact(value) {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return NUMBER.format(n)
}

export function pct(value, digits = 0) {
  return value === null || value === undefined ? '—' : `${(Number(value) * 100).toFixed(digits)}%`
}

export function time(at) {
  return at ? TIME.format(new Date(Number(at))) : '—'
}

export function datetime(at) {
  return at ? DATETIME.format(new Date(Number(at))) : '—'
}

export function dur(ms) {
  if (ms === null || ms === undefined) return '—'
  const n = Number(ms)
  if (n < 1000) return `${Math.round(n)}ms`
  if (n < 60_000) return `${(n / 1000).toFixed(1)}s`
  if (n < 3_600_000) return `${Math.round(n / 60_000)}min`
  return `${(n / 3_600_000).toFixed(1)}h`
}

/**
 * "há 4 min" só como reserva: o servidor manda `updatedLabel` pronto e é ele
 * que deve aparecer. Isto cobre a timeline do snapshot, que só tem timestamp.
 */
export function since(at, now = Date.now()) {
  if (!at) return '—'
  const diff = Math.max(0, now - Number(at))
  if (diff < 45_000) return 'agora'
  if (diff < 3_600_000) return `há ${Math.round(diff / 60_000)} min`
  if (diff < 86_400_000) return `há ${Math.round(diff / 3_600_000)} h`
  return `há ${Math.round(diff / 86_400_000)} d`
}

export function ratio(used, limit) {
  const u = Number(used ?? 0)
  const l = Number(limit ?? 0)
  return l > 0 ? Math.min(1, u / l) : 0
}
