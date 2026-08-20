/** Aba Timeline — o log de eventos do run, mais recente primeiro. */
import { card, empty, kpis, page, pageHead } from '../lib/ui.js'
import { asArray } from '../lib/aggregate.js'
import { since } from '../lib/format.js'
import { timelineList } from './overview.js'

export const meta = {
  id: 'timeline',
  label: 'Timeline',
  group: 'Acompanhar',
  icon: 'activity',
  needs: ['state'],
}

export function render(ctx) {
  const entries = asArray(ctx.snap().timeline)
  const errors = entries.filter((entry) => entry.severity === 'error').length
  const warnings = entries.filter((entry) => entry.severity === 'warn').length
  const last = entries[0]

  return page(
    pageHead({
      title: 'Timeline',
      description: 'Tudo que o kernel emitiu, na ordem em que aconteceu.',
    }),
    kpis([
      {
        label: 'Eventos',
        value: entries.length,
        hint: 'No buffer do painel.',
        tone: 'neutral',
        iconName: 'activity',
      },
      {
        label: 'Erros',
        value: errors,
        hint: errors === 0 ? 'Nenhum evento de erro.' : 'Marcados em vermelho na lista.',
        tone: errors > 0 ? 'danger' : 'success',
        iconName: 'alert',
      },
      {
        label: 'Avisos',
        value: warnings,
        hint: 'Não pararam o run, mas alguém escreveu por um motivo.',
        tone: warnings > 0 ? 'warning' : 'neutral',
        iconName: 'eye',
      },
      {
        label: 'Último evento',
        value: last ? since(last.at) : '—',
        hint: last?.name ?? 'Nada recebido ainda.',
        tone: 'info',
        iconName: 'clock',
      },
    ]),
    card({
      title: 'Log de eventos',
      hint: ctx.store.live ? 'ao vivo' : 'fluxo desconectado',
      flush: true,
      body:
        entries.length === 0
          ? empty({
              iconName: 'activity',
              title: 'Sem eventos',
              description:
                'O painel recebe cada evento do kernel por SSE. Nada aqui significa que ' +
                'nenhum run começou — rode `uranus start` no projeto.',
            })
          : timelineList(entries, ''),
    }),
  )
}
