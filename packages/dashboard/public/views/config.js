/**
 * Aba Configuração — o wizard do CLI renderizado como formulário.
 *
 * Nenhuma pergunta está escrita aqui. `CONFIG_CATEGORIES` é declarado como
 * DADO no CLI justamente para isto: o painel pede `/api/config` e desenha o
 * que vier, com o mesmo `blurb`, o mesmo `label` e o mesmo `help`. Pergunta
 * nova no wizard aparece nesta tela sozinha.
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
  toast,
} from '../lib/ui.js'
import { asArray } from '../lib/aggregate.js'

export const meta = {
  id: 'config',
  label: 'Configuração',
  group: 'Gerenciar',
  icon: 'sliders',
  needs: ['config'],
}

/**
 * O contrato diz `values: {...}` sem fixar se é mapa plano por caminho ou o
 * objeto de config aninhado. Aceitar os dois é uma função de cinco linhas e
 * evita que a tela fique vazia por uma diferença de forma.
 */
function valueAt(bag, path) {
  if (bag === undefined || bag === null) return undefined
  if (Object.prototype.hasOwnProperty.call(bag, path)) return bag[path]
  let cursor = bag
  for (const segment of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined
    cursor = cursor[segment]
  }
  return cursor
}

function originOf(ctx, path) {
  const origin = valueAt(ctx.res('config').data?.origins, path)
  return typeof origin === 'string' ? origin : undefined
}

async function save(ctx, path, value, control) {
  control.disabled = true
  try {
    await api.patch('/api/config', { path, value })
    toast('Configuração salva.', 'success')
    await ctx.reload(['config', 'validations'])
  } catch (error) {
    // A mensagem do servidor é a única que sabe POR QUE o valor foi recusado
    // (fora de faixa, provider inexistente, YAML inválido). Mostramos ela.
    control.disabled = false
    control.textContent = 'Salvar'
    const box = control.closest('.field')?.querySelector('.field__error')
    if (box) box.textContent = error instanceof Error ? error.message : String(error)
  }
}

/** Um controle por `kind`, mais um `get()` que devolve o valor a gravar. */
function controlFor(question, value) {
  const options = asArray(question.options)

  if (question.kind === 'confirm') {
    const input = h('input', { type: 'checkbox', ...(value === true ? { checked: true } : {}) })
    return {
      node: h(
        'label',
        { class: 'check' },
        input,
        h(
          'span',
          { class: 'check__text' },
          h('span', { class: 'check__name', text: value === true ? 'Ligado' : 'Desligado' }),
        ),
      ),
      get: () => input.checked,
      onDirty: (fn) => input.addEventListener('change', fn),
    }
  }

  if (question.kind === 'select') {
    const input = h(
      'select',
      { class: 'select' },
      options.map((option) =>
        h('option', {
          value: String(option.value),
          text: option.hint ? `${option.label} — ${option.hint}` : option.label,
          ...(String(option.value) === String(value) ? { selected: true } : {}),
        }),
      ),
    )
    if (value !== undefined && value !== null) input.value = String(value)
    return { node: input, get: () => input.value, onDirty: (fn) => input.addEventListener('change', fn) }
  }

  if (question.kind === 'multiselect') {
    const chosen = new Set(asArray(value).map(String))
    const inputs = []
    const node = h(
      'div',
      { class: 'checkgrid' },
      options.map((option) => {
        const input = h('input', {
          type: 'checkbox',
          value: String(option.value),
          ...(chosen.has(String(option.value)) ? { checked: true } : {}),
        })
        inputs.push(input)
        return h(
          'label',
          { class: 'check' },
          input,
          h(
            'span',
            { class: 'check__text' },
            h('span', { class: 'check__name', text: option.label }),
            option.hint ? h('span', { class: 'check__hint', text: option.hint }) : null,
          ),
        )
      }),
    )
    return {
      node,
      get: () => inputs.filter((input) => input.checked).map((input) => input.value),
      onDirty: (fn) => {
        for (const input of inputs) input.addEventListener('change', fn)
      },
    }
  }

  const numeric = question.kind === 'number'
  const input = h('input', {
    class: 'input',
    type: numeric ? 'number' : 'text',
    value: value === undefined || value === null ? '' : String(value),
    ...(question.min === undefined ? {} : { min: String(question.min) }),
    ...(question.max === undefined ? {} : { max: String(question.max) }),
  })
  return {
    node: input,
    get: () => (numeric ? (input.value === '' ? undefined : Number(input.value)) : input.value),
    onDirty: (fn) => input.addEventListener('input', fn),
  }
}

function questionField(ctx, question, writable) {
  const value = valueAt(ctx.res('config').data?.values, question.path)
  const origin = originOf(ctx, question.path)
  const control = controlFor(question, value)
  const errorBox = h('div', { class: 'field__error' })

  const saveButton = button({
    label: 'Salvar',
    variant: 'primary',
    disabled: true,
    onClick: () => save(ctx, question.path, control.get(), saveButton),
  })

  // O botão só acorda quando algo muda: um "Salvar" sempre clicável convida a
  // regravar o mesmo valor e a poluir o YAML com escritas que não mudam nada.
  control.onDirty(() => {
    errorBox.textContent = ''
    saveButton.disabled = false
  })

  if (!writable) saveButton.disabled = true

  return h(
    'div',
    { class: 'field' },
    h('label', { class: 'field__label', text: question.label }),
    question.help ? h('div', { class: 'field__help', text: question.help }) : null,
    h(
      'div',
      { class: 'inline' },
      h('div', { style: { flex: '1', minWidth: '0' } }, control.node),
      writable ? saveButton : null,
    ),
    h('div', {
      class: 'card__hint',
      text: origin === undefined ? question.path : `${question.path} · vem de ${origin}`,
    }),
    errorBox,
  )
}

export function render(ctx) {
  const resource = ctx.res('config')
  const categories = asArray(resource.data?.categories)
  const writable = ctx.writable('config')

  if (resource.status === 'loading') {
    return page(pageHead({ title: 'Configuração' }), skeletonRows(8))
  }

  const questionCount = categories.reduce(
    (total, category) => total + asArray(category.questions).length,
    0,
  )
  const origins = resource.data?.origins ?? {}
  const customized = Object.values(origins).filter(
    (origin) => typeof origin === 'string' && origin !== 'default',
  ).length

  return page(
    pageHead({
      title: 'Configuração',
      description: 'As mesmas perguntas do `uranus config`, com a resposta gravada no ato.',
    }),
    resource.status === 'unavailable' ? readOnlyNotice('mudar a configuração') : null,
    resource.status === 'error'
      ? notice({ tone: 'danger', title: 'Falha ao ler a configuração', text: resource.error?.message })
      : null,
    kpis([
      {
        label: 'Categorias',
        value: categories.length,
        hint: 'Blocos independentes de perguntas.',
        tone: 'neutral',
        iconName: 'layers',
      },
      {
        label: 'Opções configuráveis',
        value: questionCount,
        hint: 'Tudo que o wizard do CLI pergunta.',
        tone: 'info',
        iconName: 'sliders',
      },
      {
        label: 'Definidas por você',
        value: customized,
        hint: 'O resto usa o padrão do Uranus.',
        tone: 'success',
        iconName: 'edit',
      },
    ]),
    categories.length === 0
      ? card({
          body: notice({
            tone: 'info',
            title: 'Nenhuma categoria publicada',
            text:
              'O servidor não devolveu `categories`. Rode `uranus config` no terminal do ' +
              'projeto enquanto isso — as perguntas são exatamente as mesmas.',
          }),
        })
      : categories.map((category) =>
          card({
            title: category.title,
            hint: category.id,
            body: h(
              'div',
              { class: 'form' },
              h('p', { class: 'field__help', text: category.blurb }),
              ...asArray(category.questions).map((question) =>
                questionField(ctx, question, writable),
              ),
            ),
          }),
        ),
  )
}
