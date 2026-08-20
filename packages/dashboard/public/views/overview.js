/** Aba Visão geral — o estado do run em uma tela. */
import { h } from '../lib/dom.js'
import { card, empty, kpis, meter, page, pageHead, section } from '../lib/ui.js'
import { asArray, taskMetrics } from '../lib/aggregate.js'
import { compact, money, pct, since, time } from '../lib/format.js'
import { approvalList, pendingOf } from './approvals.js'

export const meta = {
  id: 'visao',
  label: 'Visão geral',
  group: 'Gerenciar',
  icon: 'gauge',
  needs: ['state', 'tasks'],
}

export function timelineList(entries, emptyText) {
  if (entries.length === 0) {
    return h('div', { class: 'card__body' }, h('p', { class: 'muted', text: emptyText }))
  }
  return h(
    'ul',
    { class: 'timeline' },
    entries.map((entry) =>
      h(
        'li',
        {
          class:
            entry.severity === 'error'
              ? 'is-error'
              : entry.severity === 'warn'
                ? 'is-warn'
                : '',
        },
        h('time', { text: time(entry.at) }),
        h('span', { class: 'timeline__name', text: entry.name ?? '—' }),
        h('span', {
          class: 'timeline__summary',
          text: entry.summary ?? entry.taskId ?? '',
        }),
      ),
    ),
  )
}

export function render(ctx) {
  const snap = ctx.snap()
  const cost = snap.cost ?? {}
  const queue = snap.queue ?? {}
  const budget = snap.budget ?? {}
  const quality = snap.quality ?? {}
  const run = snap.run ?? {}
  const tasks = asArray(ctx.res('tasks').data?.tasks)
  const metrics = taskMetrics(tasks)
  const pending = pendingOf(ctx)
  const timeline = asArray(snap.timeline)

  // Sem a rota de tasks (painel em modo leitura), o snapshot ainda sabe quantas
  // faltam — a tela perde o detalhe por grupo, não o número.
  const hasTaskViews = tasks.length > 0 || ctx.res('tasks').status === 'ready'

  const tiles = [
    {
      label: 'Precisa de você',
      value: hasTaskViews ? metrics.attention : (pending.length || '—'),
      hint: hasTaskViews
        ? metrics.blocked > 0
          ? `${String(metrics.blocked)} bloqueada(s) por motivo declarado`
          : 'Nenhuma task travada.'
        : 'Aprovações pendentes.',
      tone: (hasTaskViews ? metrics.attention : pending.length) > 0 ? 'danger' : 'success',
      iconName: 'hand',
    },
    hasTaskViews
      ? {
          label: 'Em andamento',
          value: metrics.working,
          hint: 'Tasks com agente trabalhando agora.',
          tone: 'info',
          iconName: 'cpu',
        }
      : undefined,
    {
      label: 'Na fila',
      value: hasTaskViews ? metrics.queued : (queue.remaining ?? 0),
      hint: `de ${String(queue.total ?? metrics.total)} conhecidas`,
      tone: 'neutral',
      iconName: 'layers',
    },
    {
      label: 'Custo do run',
      value: cost.totalLabel ?? money(cost.totalUsd),
      hint:
        cost.projectedRemainingUsd === undefined
          ? 'Soma real das chamadas de modelo.'
          : `projeção +${money(cost.projectedRemainingUsd)} até esvaziar a fila`,
      tone: 'warning',
      iconName: 'coin',
    },
  ]

  if (budget.run) {
    tiles.push({
      label: 'Orçamento do run',
      value: `${money(budget.run.usedUsd)} / ${money(budget.run.limitUsd)}`,
      hint: meter(budget.run.usedUsd, budget.run.limitUsd),
      tone: 'warning',
      iconName: 'gauge',
    })
    tiles.push({
      label: 'Tokens',
      value: compact(budget.run.usedTokens ?? 0),
      hint: budget.run.limitTokens
        ? meter(budget.run.usedTokens, budget.run.limitTokens)
        : 'Sem teto declarado.',
      tone: 'info',
      iconName: 'spark',
    })
  }

  tiles.push({
    label: 'Tempo de execução',
    value: run.startedAt ? since(run.startedAt).replace('há ', '') : `${String(run.ticks ?? 0)} ticks`,
    hint: run.startedAt ? `${String(run.ticks ?? 0)} ticks desde o início` : 'Ciclos do kernel.',
    tone: 'neutral',
    iconName: 'clock',
  })

  tiles.push({
    label: 'Checks aprovados',
    value: quality.passRate === undefined || quality.passRate === null ? '—' : pct(quality.passRate),
    hint: quality.checks
      ? `${String(quality.checks.passed ?? 0)} ok · ${String(quality.checks.failed ?? 0)} falhas`
      : 'Nenhuma verificação executada ainda.',
    tone: quality.passRate !== undefined && quality.passRate < 0.8 ? 'danger' : 'success',
    iconName: 'badge',
  })

  return page(
    pageHead({
      title: 'Visão geral',
      description: 'O que está acontecendo agora, quanto custou e o que espera por você.',
    }),
    kpis(tiles),
    pending.length > 0
      ? section(
          'Esperando sua decisão',
          h('div', { class: 'stack' }, approvalList(ctx)),
        )
      : null,
    card({
      title: 'Atividade recente',
      hint: ctx.store.live ? 'ao vivo' : 'fluxo desconectado',
      flush: true,
      body:
        timeline.length === 0
          ? empty({
              iconName: 'activity',
              title: 'Nada aconteceu ainda',
              description:
                'Os eventos aparecem aqui assim que o kernel começar a trabalhar. ' +
                'Rode `uranus start` no projeto para o run começar.',
            })
          : h('div', { class: 'scroller' }, timelineList(timeline.slice(0, 30), '')),
    }),
  )
}
