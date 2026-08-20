/**
 * Aba Validações — as regras que decidem se uma entrega passa.
 *
 * Os textos de ajuda e os três rótulos de severidade NÃO estão escritos aqui:
 * eles vêm de `/api/config`, onde o wizard do CLI já os declara como dado
 * (`validations.rules.<regra>`). É a mesma fonte que o terminal usa, então as
 * duas telas não têm como divergir — e quando o help de uma regra melhorar no
 * CLI, ele melhora aqui sem ninguém tocar no painel.
 */
import { h } from '../lib/dom.js'
import { api } from '../lib/api.js'
import {
  button,
  card,
  kpis,
  notice,
  page,
  pageHead,
  readOnlyNotice,
  skeletonRows,
  table,
  toast,
  toastError,
} from '../lib/ui.js'
import { asArray, validationMetrics } from '../lib/aggregate.js'

export const meta = {
  id: 'validacoes',
  label: 'Validações',
  group: 'Gerenciar',
  icon: 'shield',
  needs: ['validations', 'config'],
}

/** Reserva mínima, usada só enquanto `/api/validations` não respondeu. */
const FALLBACK_SEVERITIES = [
  { value: 'off', label: 'não verifica' },
  { value: 'advisory', label: 'avisa, não reprova' },
  { value: 'blocking', label: 'reprova a verificação' },
]

/** Encontra a pergunta do wizard que corresponde a um caminho de config. */
function question(ctx, path) {
  for (const category of asArray(ctx.res('config').data?.categories)) {
    for (const item of asArray(category.questions)) {
      if (item.path === path) return item
    }
  }
  return undefined
}

/**
 * As três severidades com os rótulos do servidor (`severities` em
 * `/api/validations`), que são os mesmos de `VALIDATION_SEVERITY_LABEL` no
 * CLI. Só se a resposta ainda não chegou é que a reserva local entra.
 */
function severityOptions(ctx) {
  const published = asArray(ctx.res('validations').data?.severities)
  if (published.length > 0) return published
  const sample = question(ctx, 'validations.rules.scope')
  const options = asArray(sample?.options)
  return options.length === 3 ? options : FALLBACK_SEVERITIES
}

/**
 * "avisa, não reprova" → "avisa". O botão tem largura de coluna; o rótulo
 * inteiro vai no `title`, que é onde ele cabe sem espremer a linha da regra.
 */
function shortSeverity(option) {
  const full = option.label ?? option.hint ?? option.value
  return String(full).split(',')[0].split(' a ')[0]
}

async function setSeverity(ctx, rule, severity) {
  try {
    await api.patch('/api/validations', { rule, severity })
    toast(`Regra "${rule}" atualizada.`, 'success')
    await ctx.reload(['validations', 'config'])
  } catch (error) {
    toastError(error)
  }
}

function tristate(ctx, rule, writable) {
  const options = severityOptions(ctx)
  return h(
    'div',
    { class: 'tristate', role: 'group', 'aria-label': `Severidade de ${rule.rule}` },
    options.map((option) =>
      h('button', {
        type: 'button',
        text: shortSeverity(option),
        title: option.label ?? option.hint ?? option.value,
        dataset: { severity: option.value },
        'aria-pressed': String(rule.severity === option.value),
        ...(writable ? {} : { disabled: true }),
        on: {
          click: () => {
            if (rule.severity === option.value) return
            void setSeverity(ctx, rule.rule, option.value)
          },
        },
      }),
    ),
  )
}

const COLUMNS = [{ label: 'Regra' }, { label: 'O que ela pega' }, { label: 'Origem' }, { label: 'Severidade', align: 'right' }]

function ruleRow(ctx, rule, writable) {
  const declared = question(ctx, `validations.rules.${String(rule.rule)}`)
  return h(
    'tr',
    null,
    h('td', { class: 'mono nowrap' }, rule.rule),
    h(
      'td',
      { class: 'muted', style: { maxWidth: '34rem', whiteSpace: 'pre-line' } },
      declared?.help ?? 'Sem descrição publicada pelo servidor.',
    ),
    h('td', { class: 'dim mono' }, rule.originLabel ?? rule.origin ?? '—'),
    h('td', { class: 'right' }, h('div', { class: 'rowactions' }, tristate(ctx, rule, writable))),
  )
}

function repairCard(ctx, payload, writable) {
  const declared = question(ctx, 'validations.maxRepairAttempts')
  const input = h('input', {
    class: 'input',
    type: 'number',
    min: '0',
    max: '10',
    value: String(payload.maxRepairAttempts ?? 0),
    style: { maxWidth: '7rem' },
    ...(writable ? {} : { disabled: true }),
  })
  const save = button({
    label: 'Salvar',
    variant: 'primary',
    ...(writable ? {} : { disabled: true }),
    onClick: async () => {
      save.disabled = true
      try {
        await api.patch('/api/validations', { maxRepairAttempts: Number(input.value) })
        toast('Limite de reparos atualizado.', 'success')
        await ctx.reload(['validations'])
      } catch (error) {
        toastError(error)
        save.disabled = false
      }
    },
  })

  return card({
    title: 'Reparos dirigidos',
    body: h(
      'div',
      { class: 'form' },
      h('p', {
        class: 'field__help',
        text:
          declared?.help ??
          'Quantas vezes o Uranus tenta corrigir sozinho uma violação de validação antes de\n' +
            'desistir da task. Reparo não gasta tentativa: "saiu do escopo" e "não compila" são\n' +
            'problemas diferentes e não deveriam matar a task pelo mesmo contador.',
      }),
      h('div', { class: 'inline' }, input, save),
      h('p', {
        class: 'field__help',
        text:
          payload.countTowardAttempts === true
            ? 'Hoje os reparos CONTAM como tentativa (validations.countTowardAttempts: true).'
            : 'Hoje os reparos não contam como tentativa.',
      }),
    ),
  })
}

export function render(ctx) {
  const resource = ctx.res('validations')
  const payload = resource.data ?? {}
  const rules = asArray(payload.rules)
  const metrics = validationMetrics(payload)
  const writable = ctx.writable('validations')

  if (resource.status === 'loading') {
    return page(pageHead({ title: 'Validações' }), skeletonRows(6))
  }

  return page(
    pageHead({
      title: 'Validações',
      description: 'O que é conferido em cada entrega, e o que disso reprova a task.',
    }),
    resource.status === 'unavailable' ? readOnlyNotice('mudar as regras') : null,
    resource.status === 'error'
      ? notice({ tone: 'danger', title: 'Falha ao ler as validações', text: resource.error?.message })
      : null,
    payload.enabled === false
      ? notice({
          tone: 'warning',
          title: 'A validação está desligada por completo',
          text:
            'Com `validations.enabled: false` nenhuma regra abaixo roda, independente da ' +
            'severidade que aparece aqui. Ligue de volta na aba Configuração.',
        })
      : null,
    kpis([
      {
        label: 'Regras ligadas',
        value: `${String(metrics.on)}/${String(metrics.total)}`,
        hint: 'Contam as que avisam e as que reprovam.',
        tone: metrics.on === 0 ? 'danger' : 'success',
        iconName: 'shield',
      },
      {
        label: 'Reprovam a entrega',
        value: metrics.blocking,
        hint: 'Falhou aqui, a task não integra.',
        tone: 'danger',
        iconName: 'alert',
      },
      {
        label: 'Só avisam',
        value: metrics.advisory,
        hint: 'Registram o achado e deixam passar.',
        tone: 'warning',
        iconName: 'eye',
      },
      {
        label: 'Fora do padrão',
        value: metrics.overridden,
        hint: 'Regras que este projeto mudou em relação ao default do Uranus.',
        tone: 'neutral',
        iconName: 'sliders',
      },
    ]),
    card({
      title: 'Regras',
      hint: `${String(rules.length)} regras`,
      flush: true,
      body: table(COLUMNS, rules.map((rule) => ruleRow(ctx, rule, writable))),
    }),
    repairCard(ctx, payload, writable),
  )
}
