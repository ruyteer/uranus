/**
 * Aba Chat — espelha o que está acontecendo na sessão do `uranus chat`.
 *
 * A fonte é `.claude/settings.json` (hooks) → `uranus relay <evento>` →
 * `/api/claude-activity`. Não é o transcript completo: é "quem está
 * trabalhando em quê agora", o que já cobre o pedido de deixar a organização
 * dos agentes visível sem abrir um terceiro lugar.
 */
import { h } from '../lib/dom.js'
import { asArray } from '../lib/aggregate.js'
import { since, time } from '../lib/format.js'
import { card, empty, page, pageHead, pill } from '../lib/ui.js'

export const meta = {
  id: 'chat',
  label: 'Chat',
  group: 'Acompanhar',
  icon: 'spark',
  needs: ['chat'],
}

function toneFor(entry) {
  if (entry.role === 'user') return 'info'
  if (entry.event === 'SubagentStop') return 'success'
  return 'neutral'
}

function labelFor(entry) {
  if (entry.role === 'user') return 'você'
  if (entry.event === 'SubagentStop') return entry.agent ? `agente: ${entry.agent}` : 'subagente'
  if (entry.event === 'Stop') return 'orquestrador'
  return entry.event
}

function activityList(entries) {
  if (entries.length === 0) {
    return h('div', { class: 'card__body' }, h('p', { class: 'muted', text: '' }))
  }
  return h(
    'ul',
    { class: 'timeline' },
    entries
      .slice()
      .reverse()
      .map((entry) =>
        h(
          'li',
          {},
          h('time', { text: time(entry.at) }),
          pill(labelFor(entry), toneFor(entry)),
          h('span', { class: 'timeline__summary', text: entry.summary || '(sem prévia)' }),
        ),
      ),
  )
}

export function render(ctx) {
  const entries = asArray(ctx.res('chat').data?.entries)
  const last = entries[entries.length - 1]

  return page(
    pageHead({
      title: 'Chat',
      description:
        'O que a sessão orquestradora (`uranus chat`) está fazendo agora — prompts e agentes despachados.',
    }),
    card({
      title: 'Atividade',
      hint: last ? `última: ${since(last.at)}` : undefined,
      flush: true,
      body:
        entries.length === 0
          ? empty({
              iconName: 'spark',
              title: 'Nenhuma atividade ainda',
              description:
                'Abra uma sessão com `uranus chat` neste projeto. Os hooks em `.claude/settings.json` ' +
                '(gerados por `uranus init`) enviam a atividade para cá automaticamente.',
            })
          : activityList(entries),
    }),
  )
}
