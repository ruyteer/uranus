/** Aba Saúde — providers, plugins e spans lentos. */
import { h } from '../lib/dom.js'
import { card, empty, kpis, page, pageHead, pill, table } from '../lib/ui.js'
import { asArray } from '../lib/aggregate.js'
import { dur, time } from '../lib/format.js'

export const meta = {
  id: 'saude',
  label: 'Saúde',
  group: 'Acompanhar',
  icon: 'pulse',
  needs: ['state'],
}

/**
 * Rate limit não é degradação, mas também não é "ok": um painel que diz ok
 * enquanto o provider está em espera esconde o motivo real de o run ter
 * parado de andar. Este é o mesmo julgamento do painel antigo, preservado.
 */
function providerStatus(entry, now) {
  const limited = entry.rateLimitedUntil !== undefined && Number(entry.rateLimitedUntil) > now
  if (entry.degraded === true) return { text: 'degradado', tone: 'danger' }
  if (limited) return { text: 'em espera', tone: 'warning' }
  return { text: 'ok', tone: 'success' }
}

function providerHint(entry, now) {
  const parts = []
  if (entry.reason) parts.push(String(entry.reason))
  if (entry.consecutiveFailures) parts.push(`${String(entry.consecutiveFailures)} falhas seguidas`)
  if (entry.rateLimitedUntil !== undefined && Number(entry.rateLimitedUntil) > now) {
    parts.push(`rate limit até ${time(entry.rateLimitedUntil)}`)
  }
  return parts.length === 0 ? 'Sem incidentes.' : parts.join(' · ')
}

export function render(ctx) {
  const health = ctx.snap().health ?? {}
  const providers = health.providers ?? {}
  const failures = asArray(health.pluginFailures)
  const spans = asArray(health.spans)
  const now = Date.now()
  const ids = Object.keys(providers)

  const tiles = ids.map((id) => {
    const entry = providers[id] ?? {}
    const status = providerStatus(entry, now)
    return {
      label: `Provider ${id}`,
      value: status.text,
      hint: providerHint(entry, now),
      tone: status.tone,
      iconName: 'cpu',
    }
  })

  if (tiles.length === 0) {
    tiles.push({
      label: 'Providers',
      value: 'sem incidentes',
      hint: 'Nenhum provider reportou falha nem espera.',
      tone: 'success',
      iconName: 'cpu',
    })
  }

  tiles.push({
    label: 'Falhas de plugin',
    value: failures.length,
    hint:
      failures.length === 0
        ? 'Todos os plugins carregaram.'
        : failures.map((failure) => String(failure.pluginId ?? '?')).join(', '),
    tone: failures.length > 0 ? 'danger' : 'neutral',
    iconName: 'layers',
  })

  const slow = spans.filter((span) => span.error).length
  tiles.push({
    label: 'Spans com erro',
    value: slow,
    hint: `${String(spans.length)} spans no buffer`,
    tone: slow > 0 ? 'danger' : 'neutral',
    iconName: 'pulse',
  })

  return page(
    pageHead({
      title: 'Saúde',
      description: 'Por que o run pode estar parado mesmo sem nada aparecer como erro.',
    }),
    kpis(tiles),
    card({
      title: 'Spans recentes',
      flush: spans.length > 0,
      body:
        spans.length === 0
          ? empty({
              iconName: 'pulse',
              title: 'Nenhum span registrado',
              description:
                'Os spans aparecem conforme o kernel executa fases. Se o run está rodando e ' +
                'nada aparece, verifique se a telemetria está ligada em Configuração.',
            })
          : table(
              [
                { label: 'Span' },
                { label: 'Duração', align: 'right' },
                { label: 'Quando' },
                { label: 'Erro' },
              ],
              spans.map((span) =>
                h(
                  'tr',
                  null,
                  h('td', { class: 'mono' }, span.name ?? '—'),
                  h('td', { class: 'right num' }, dur(span.durationMs)),
                  h('td', { class: 'mono dim' }, time(span.startedAt)),
                  h('td', null, span.error ? pill(String(span.error), 'danger') : h('span', { class: 'dim', text: '—' })),
                ),
              ),
            ),
    }),
  )
}
