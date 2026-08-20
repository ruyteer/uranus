/** Aba Aprovações — a fila de decisão humana (`HumanGate`). */
import { h } from '../lib/dom.js'
import { api, apiPath } from '../lib/api.js'
import {
  button,
  card,
  empty,
  kpis,
  page,
  pageHead,
  pill,
  toast,
  toastError,
} from '../lib/ui.js'
import { asArray } from '../lib/aggregate.js'
import { datetime, since } from '../lib/format.js'

export const meta = {
  id: 'aprovacoes',
  label: 'Aprovações',
  group: 'Acompanhar',
  icon: 'hand',
  needs: ['state'],
  badge: (ctx) => pendingOf(ctx).length,
}

export function pendingOf(ctx) {
  return asArray(ctx.snap().approvals?.pending)
}

/** O risco vem cru do gate; sem rótulo tratado, mostramos o valor como está. */
function riskTone(risk) {
  return risk === 'high' || risk === 'critical' ? 'danger' : risk === 'low' ? 'neutral' : 'warning'
}

async function decide(ctx, id, effect, node) {
  for (const control of node.querySelectorAll('button')) control.disabled = true
  try {
    await api.post(apiPath('/api/approvals', id), { effect, note: 'via dashboard' })
    toast(effect === 'granted' ? 'Aprovado.' : 'Negado.', 'success')
    await ctx.reload(['state'])
  } catch (error) {
    // 409 quase sempre é "já foi decidido no CLI ou na outra aba". A mensagem
    // do servidor diz isso; engoli-la deixaria o botão parecendo quebrado.
    toastError(error)
    for (const control of node.querySelectorAll('button')) control.disabled = false
  }
}

export function approvalCard(ctx, approval) {
  const node = h(
    'article',
    { class: 'approval' },
    h(
      'div',
      { class: 'approval__head' },
      h('h3', { class: 'approval__title', text: approval.title ?? approval.id }),
      pill(approval.kind ?? 'aprovação', 'warning'),
      pill(`risco ${String(approval.risk ?? '—')}`, riskTone(approval.risk)),
    ),
    h(
      'div',
      { class: 'mono dim' },
      h('span', { text: approval.id }),
      approval.taskId ? h('span', { text: ` · ${approval.taskId}` }) : null,
      h('span', { text: ` · pedida ${since(approval.requestedAt)}` }),
      approval.expiresAt
        ? h('span', { text: ` · expira ${datetime(approval.expiresAt)}` })
        : null,
    ),
    approval.detail
      ? h('pre', { class: 'approval__detail', text: String(approval.detail) })
      : null,
    h(
      'div',
      { class: 'btnrow' },
      button({
        label: 'Aprovar',
        iconName: 'check',
        variant: 'success',
        onClick: () => decide(ctx, approval.id, 'granted', node),
      }),
      button({
        label: 'Negar',
        iconName: 'x',
        variant: 'danger',
        onClick: () => decide(ctx, approval.id, 'denied', node),
      }),
    ),
  )
  return node
}

export function approvalList(ctx) {
  const pending = pendingOf(ctx)
  if (pending.length === 0) {
    return empty({
      iconName: 'check',
      title: 'Nenhuma decisão esperando por você',
      description:
        'Quando o kernel precisar de autorização — abrir PR, tocar caminho protegido, ' +
        'estourar orçamento — o pedido aparece aqui e o run fica parado até você responder.',
    })
  }
  return h('div', { class: 'stack' }, pending.map((approval) => approvalCard(ctx, approval)))
}

export function render(ctx) {
  const pending = pendingOf(ctx)
  const oldest = pending.reduce(
    (min, item) => (item.requestedAt && item.requestedAt < min ? item.requestedAt : min),
    Number.POSITIVE_INFINITY,
  )
  const byRisk = pending.filter((item) => item.risk === 'high' || item.risk === 'critical').length

  return page(
    pageHead({
      title: 'Aprovações',
      description: 'O que o kernel não faz sem uma pessoa dizer que pode.',
    }),
    kpis([
      {
        label: 'Esperando você',
        value: pending.length,
        hint: pending.length === 0 ? 'Nada bloqueado.' : 'O run fica parado até responder.',
        tone: pending.length > 0 ? 'warning' : 'success',
        iconName: 'hand',
      },
      {
        label: 'Risco alto',
        value: byRisk,
        hint: 'Pedidos marcados como high/critical pelo gate.',
        tone: byRisk > 0 ? 'danger' : 'neutral',
        iconName: 'alert',
      },
      {
        label: 'Mais antiga',
        value: Number.isFinite(oldest) ? since(oldest) : '—',
        hint: 'Tempo que o run está esperando.',
        tone: 'info',
        iconName: 'clock',
      },
    ]),
    card({ title: 'Fila de decisão', body: approvalList(ctx) }),
  )
}
