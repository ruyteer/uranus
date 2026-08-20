/** Aba Custo — quanto o run gastou, por agente, por modelo e por task. */
import { h } from '../lib/dom.js'
import { card, empty, kpis, meter, page, pageHead, table } from '../lib/ui.js'
import { asArray } from '../lib/aggregate.js'
import { compact, money } from '../lib/format.js'

export const meta = {
  id: 'custo',
  label: 'Custo',
  group: 'Acompanhar',
  icon: 'coin',
  needs: ['state'],
}

function sparkline(daily) {
  const max = Math.max(0.0001, ...daily.map((day) => Number(day.usd ?? 0)))
  return h(
    'div',
    { class: 'spark' },
    daily.map((day) =>
      h('i', {
        style: { height: `${String(Math.max(4, (Number(day.usd ?? 0) / max) * 100))}%` },
        title: `${String(day.day ?? '')} ${money(day.usd)}`,
      }),
    ),
  )
}

function breakdown(title, rows, keyLabel) {
  const list = asArray(rows)
  return card({
    title,
    flush: list.length > 0,
    body:
      list.length === 0
        ? h('p', { class: 'muted', text: 'Nenhuma chamada registrada ainda.' })
        : table(
            [{ label: keyLabel }, { label: 'Custo', align: 'right' }, { label: 'Chamadas', align: 'right' }],
            list.map((row) =>
              h(
                'tr',
                null,
                h('td', { class: 'mono' }, row.key ?? '—'),
                h('td', { class: 'right num' }, money(row.usd)),
                h('td', { class: 'right num dim' }, String(row.calls ?? 0)),
              ),
            ),
          ),
  })
}

export function render(ctx) {
  const snap = ctx.snap()
  const cost = snap.cost ?? {}
  const budget = snap.budget ?? {}
  const daily = asArray(cost.daily)
  const last14 = daily.reduce((sum, day) => sum + Number(day.usd ?? 0), 0)
  const hasData = (cost.totalUsd ?? 0) > 0 || daily.length > 0

  return page(
    pageHead({
      title: 'Custo',
      description: 'Valor real das chamadas de modelo, não estimativa de token.',
    }),
    kpis([
      {
        // `totalLabel` já vem formatado pelo agregador, que é quem conhece a
        // moeda. Só caímos no formatador local se o campo faltar.
        label: 'Total do run',
        value: cost.totalLabel ?? money(cost.totalUsd),
        hint: cost.stats ? `${String(cost.stats.calls ?? 0)} sessões de agente` : 'Soma de tudo.',
        tone: 'warning',
        iconName: 'coin',
      },
      {
        label: 'Projeção restante',
        value: money(cost.projectedRemainingUsd),
        hint: 'Ritmo atual × tasks ainda na fila.',
        tone: 'info',
        iconName: 'gauge',
      },
      {
        label: 'Últimos 14 dias',
        value: money(last14),
        hint: daily.length > 0 ? sparkline(daily) : 'Sem histórico diário.',
        tone: 'neutral',
        iconName: 'activity',
      },
      budget.run
        ? {
            label: 'Teto do run',
            value: money(budget.run.limitUsd),
            hint: meter(budget.run.usedUsd, budget.run.limitUsd),
            tone: 'danger',
            iconName: 'shield',
          }
        : undefined,
      budget.run?.limitTokens
        ? {
            label: 'Tokens',
            value: compact(budget.run.usedTokens ?? 0),
            hint: meter(budget.run.usedTokens, budget.run.limitTokens),
            tone: 'info',
            iconName: 'spark',
          }
        : undefined,
    ]),
    hasData
      ? h(
          'div',
          { class: 'cols' },
          breakdown('Por agente', cost.byAgent, 'Agente'),
          breakdown('Por modelo', cost.byModel, 'Modelo'),
          breakdown('Por task (top 20)', cost.byTask, 'Task'),
        )
      : card({
          body: empty({
            iconName: 'coin',
            title: 'Nada foi gasto ainda',
            description:
              'O custo aparece assim que o primeiro agente rodar. Se você usa só modelos ' +
              'locais, esta tela fica zerada de propósito — não há cobrança por token.',
          }),
        }),
  )
}
