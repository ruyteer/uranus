/**
 * Kit de componentes do painel — tudo em DOM, nada de template string.
 *
 * As medidas e a fórmula de cor de cada peça estão em `app.css`; aqui mora só
 * a montagem. Nenhuma função deste arquivo interpreta vocabulário de domínio:
 * `pill()` recebe o `tone` que o servidor mandou, `kpi()` recebe o texto já
 * pronto. É o que impede o painel de discordar do CLI.
 */
import { h, frag, svg, clear } from './dom.js'
import { icon } from './icons.js'
import { ratio } from './format.js'

const TONES = new Set(['success', 'warning', 'danger', 'info', 'neutral'])

function toneClass(prefix, tone) {
  return TONES.has(tone) && tone !== 'neutral' ? `${prefix}--${tone}` : ''
}

// ── página ───────────────────────────────────────────────────────────────────

export function page(...children) {
  return h('div', { class: 'view__inner' }, children)
}

export function pageHead({ title, description, actions }) {
  return h(
    'div',
    { class: 'pagehead' },
    h(
      'div',
      { class: 'pagehead__text' },
      h('h1', { text: title }),
      description ? h('p', { text: description }) : null,
    ),
    actions && actions.length > 0 ? h('div', { class: 'pagehead__actions' }, actions) : null,
  )
}

export function section(title, ...children) {
  return h(
    'section',
    { class: 'section' },
    title ? h('h2', { class: 'section__title', text: title }) : null,
    children,
  )
}

export function card({ title, hint, actions, body, flush }) {
  return h(
    'div',
    { class: 'card' },
    title
      ? h(
          'div',
          { class: 'card__head' },
          h('h3', { class: 'card__title', text: title }),
          hint ? h('span', { class: 'card__hint', text: hint }) : null,
          actions ?? null,
        )
      : null,
    h('div', { class: `card__body${flush === true ? ' card__body--flush' : ''}` }, body),
  )
}

// ── métricas ─────────────────────────────────────────────────────────────────

/**
 * Tile de KPI. `hint` aceita texto ou nó (para caber uma barra de proporção).
 * O `--i` alimenta o stagger de entrada — 60 ms por índice.
 */
export function kpi({ label, value, hint, tone, iconName }, index = 0) {
  return h(
    'div',
    { class: 'kpi', style: { '--i': String(index) } },
    h(
      'div',
      { class: 'kpi__body' },
      h('div', { class: 'kpi__label', text: label }),
      h('div', { class: 'kpi__value', text: value === undefined || value === null ? '—' : String(value) }),
      hint === undefined || hint === null || hint === ''
        ? null
        : hint instanceof Node
          ? h('div', { class: 'kpi__hint' }, hint)
          : h('div', { class: 'kpi__hint', text: hint }),
    ),
    iconName
      ? h(
          'div',
          { class: `kpi__icon ${toneClass('kpi__icon', tone)}`.trim() },
          svg(icon(iconName)),
        )
      : null,
  )
}

export function kpis(items) {
  return h(
    'div',
    { class: 'kpis' },
    items.filter(Boolean).map((item, index) => kpi(item, index)),
  )
}

export function meter(used, limit) {
  const r = ratio(used, limit)
  const modifier = r > 0.9 ? ' meter--hot' : r > 0.7 ? ' meter--warm' : ''
  return h(
    'div',
    { class: `meter${modifier}` },
    h('i', { style: { width: `${(r * 100).toFixed(1)}%` } }),
  )
}

/** Barra de progresso positiva (concluído/total) — verde em vez de vermelho. */
export function progressMeter(done, total) {
  const r = ratio(done, total)
  return h(
    'div',
    { class: 'meter meter--ok' },
    h('i', { style: { width: `${(r * 100).toFixed(1)}%` } }),
  )
}

export function pill(text, tone) {
  return h('span', { class: `pill ${toneClass('pill', tone)}`.trim(), text: String(text ?? '—') })
}

// ── botões ───────────────────────────────────────────────────────────────────

export function button({ label, iconName, variant, onClick, dataset, title, disabled, type }) {
  const classes = ['btn']
  if (variant) classes.push(`btn--${variant}`)
  if (label === undefined && iconName) classes.push('btn--icon')
  return h(
    'button',
    {
      class: classes.join(' '),
      type: type ?? 'button',
      ...(dataset ? { dataset } : {}),
      ...(title ? { title, 'aria-label': title } : {}),
      ...(disabled === true ? { disabled: true } : {}),
      ...(onClick ? { on: { click: onClick } } : {}),
    },
    iconName ? svg(icon(iconName)) : null,
    label ? h('span', { text: label }) : null,
  )
}

// ── tabela ───────────────────────────────────────────────────────────────────

/**
 * `columns`: `[{ label, align }]`. `rows`: array de `<tr>` já montados, ou de
 * `{ group, label, tone }` para uma linha de cabeçalho de grupo.
 */
export function table(columns, rows) {
  const head = h(
    'thead',
    null,
    h(
      'tr',
      null,
      columns.map((column) =>
        h('th', { class: column.align === 'right' ? 'right' : '', text: column.label }),
      ),
    ),
  )
  return h('div', { class: 'tablewrap' }, h('table', { class: 'tbl' }, head, h('tbody', null, rows)))
}

export function groupRow(columns, label, count) {
  return h(
    'tr',
    { class: 'grouprow' },
    h(
      'td',
      { colspan: String(columns) },
      h(
        'div',
        { class: 'grouprow__label' },
        h('span', { text: label }),
        h('span', { class: 'dim', text: `· ${String(count)}` }),
      ),
    ),
  )
}

export function cellTitle(title, sub) {
  return h(
    'div',
    { class: 'rowtitle' },
    h('span', { text: title }),
    sub ? h('span', { class: 'rowtitle__sub', text: sub }) : null,
  )
}

// ── vazio, carregando, aviso ─────────────────────────────────────────────────

/**
 * Estado vazio. `description` e `action` não são opcionais por convenção:
 * uma tela que diz "nada aqui" e para por aí devolve o problema ao usuário.
 */
export function empty({ iconName, title, description, action }) {
  return h(
    'div',
    { class: 'empty' },
    h('div', { class: 'empty__icon' }, svg(icon(iconName ?? 'inbox'), 'icon icon-xl')),
    h('div', { class: 'empty__title', text: title }),
    h('div', { class: 'empty__desc', text: description }),
    action ?? null,
  )
}

/** Skeleton que copia o layout real — vale mais que um spinner genérico. */
export function skeletonKpis(count = 4) {
  return h(
    'div',
    { class: 'kpis' },
    Array.from({ length: count }, () => h('div', { class: 'skeleton', style: { height: '96px' } })),
  )
}

export function skeletonRows(count = 5) {
  return h(
    'div',
    { class: 'stack' },
    Array.from({ length: count }, () => h('div', { class: 'skeleton', style: { height: '44px' } })),
  )
}

export function notice({ tone, title, text, action, iconName }) {
  return h(
    'div',
    { class: `notice ${toneClass('notice', tone)}`.trim() },
    svg(icon(iconName ?? 'alert')),
    h(
      'div',
      { class: 'notice__body' },
      title ? h('div', { class: 'notice__title', text: title }) : null,
      text ? h('div', { text }) : null,
    ),
    action ?? null,
  )
}

/** O aviso padrão de painel sem porta de dados. Uma frase, um motivo, um jeito. */
export function readOnlyNotice(what) {
  return notice({
    tone: 'info',
    iconName: 'eye',
    title: 'Painel em modo leitura',
    text:
      `Esta instância do painel subiu sem a porta de dados, então ${what} só dá para ` +
      'fazer pelo CLI. Suba o painel pelo `uranus start` (ou pelo `uranus dashboard` do ' +
      'projeto) para liberar a edição aqui.',
  })
}

// ── campos de formulário ─────────────────────────────────────────────────────

let fieldSeq = 0

function fieldId(prefix) {
  fieldSeq += 1
  return `${prefix}-${String(fieldSeq)}`
}

export function field({ label, help, control, id }) {
  return h(
    'div',
    { class: 'field' },
    label ? h('label', { class: 'field__label', for: id, text: label }) : null,
    control,
    help ? h('div', { class: 'field__help', text: help }) : null,
  )
}

export function textField({ label, help, value, placeholder, name }) {
  const id = fieldId('t')
  const input = h('input', {
    class: 'input',
    id,
    type: 'text',
    name: name ?? id,
    value: value ?? '',
    ...(placeholder ? { placeholder } : {}),
  })
  return { el: field({ label, help, control: input, id }), input, get: () => input.value.trim() }
}

export function numberField({ label, help, value, min, max, step }) {
  const id = fieldId('n')
  const input = h('input', {
    class: 'input',
    id,
    type: 'number',
    value: value ?? '',
    ...(min === undefined ? {} : { min: String(min) }),
    ...(max === undefined ? {} : { max: String(max) }),
    ...(step === undefined ? {} : { step: String(step) }),
  })
  return {
    el: field({ label, help, control: input, id }),
    input,
    get: () => (input.value === '' ? undefined : Number(input.value)),
  }
}

export function textareaField({ label, help, value, placeholder, rows }) {
  const id = fieldId('a')
  const input = h('textarea', {
    class: 'textarea',
    id,
    rows: String(rows ?? 5),
    ...(placeholder ? { placeholder } : {}),
  })
  input.value = value ?? ''
  return { el: field({ label, help, control: input, id }), input, get: () => input.value.trim() }
}

/** `options`: `[{ value, label, hint }]`. */
export function selectField({ label, help, value, options }) {
  const id = fieldId('s')
  const input = h(
    'select',
    { class: 'select', id },
    options.map((option) =>
      h('option', {
        value: option.value,
        text: option.hint ? `${option.label} — ${option.hint}` : option.label,
        ...(String(option.value) === String(value) ? { selected: true } : {}),
      }),
    ),
  )
  if (value !== undefined && value !== null) input.value = String(value)
  return { el: field({ label, help, control: input, id }), input, get: () => input.value }
}

export function booleanField({ label, help, value }) {
  const input = h('input', { type: 'checkbox', ...(value === true ? { checked: true } : {}) })
  const el = h(
    'label',
    { class: 'check' },
    input,
    h(
      'span',
      { class: 'check__text' },
      h('span', { class: 'check__name', text: label }),
      help ? h('span', { class: 'check__hint', text: help }) : null,
    ),
  )
  return { el, input, get: () => input.checked }
}

/**
 * Caixas de seleção de checks. É metade do "mais fácil que YAML": o usuário
 * marca "roda os testes" em vez de escrever um objeto `acceptance.checks`.
 */
export function checkboxGroup({ label, help, options, selected }) {
  const chosen = new Set(selected ?? [])
  const inputs = []
  const grid = h(
    'div',
    { class: 'checkgrid' },
    options.map((option) => {
      const input = h('input', {
        type: 'checkbox',
        value: option.value,
        ...(chosen.has(option.value) ? { checked: true } : {}),
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
    el: field({ label, help, control: grid }),
    get: () => inputs.filter((input) => input.checked).map((input) => input.value),
  }
}

/**
 * Lista de globs: um campo, um botão, e chips removíveis. A outra metade do
 * "mais fácil que YAML" — o escopo da task é a garantia de lease e de
 * `requirePathsWithin`, e digitá-lo dentro de um YAML era onde errava.
 */
export function globListField({ label, help, values, placeholder }) {
  const list = [...(values ?? [])]
  const chips = h('div', { class: 'chips' })
  const input = h('input', {
    class: 'input',
    type: 'text',
    placeholder: placeholder ?? 'src/**/*.ts',
  })

  function add() {
    const raw = input.value.trim()
    if (raw === '') return
    // Vírgula e espaço separam: colar "src/**, docs/**" de um YAML antigo é o
    // gesto mais provável de quem está migrando.
    for (const part of raw.split(/[,\s]+/)) {
      if (part !== '' && !list.includes(part)) list.push(part)
    }
    input.value = ''
    paint()
    input.focus()
  }

  function paint() {
    clear(chips)
    if (list.length === 0) {
      chips.append(
        h('span', { class: 'field__help', text: 'Sem escopo: a task pode tocar qualquer arquivo.' }),
      )
      return
    }
    for (const [index, glob] of list.entries()) {
      chips.append(
        h(
          'span',
          { class: 'chip' },
          h('span', { text: glob }),
          h(
            'button',
            {
              class: 'chip__x',
              type: 'button',
              title: `Remover ${glob}`,
              on: {
                click: () => {
                  list.splice(index, 1)
                  paint()
                },
              },
            },
            svg(icon('x'), 'icon'),
          ),
        ),
      )
    }
  }

  paint()
  const control = h(
    'div',
    { class: 'stack' },
    h(
      'div',
      { class: 'inline' },
      input,
      button({ label: 'Adicionar', iconName: 'plus', onClick: add }),
    ),
    chips,
  )
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      add()
    }
  })
  return { el: field({ label, help, control }), get: () => [...list] }
}

// ── modal ────────────────────────────────────────────────────────────────────

const overlayHost = () => document.getElementById('overlay')

let closeCurrent = null

/**
 * Abre um modal. Fecha com `Esc` e com clique fora — as duas saídas que todo
 * mundo tenta antes de procurar o X.
 */
export function openModal({ title, subtitle, body, footer, wide }) {
  closeModal()
  const host = overlayHost()
  const panel = h(
    'div',
    { class: `modal${wide === true ? ' modal--wide' : ''}`, role: 'dialog', 'aria-modal': 'true' },
    h(
      'div',
      { class: 'modal__head' },
      h(
        'div',
        { class: 'modal__titles' },
        h('h2', { class: 'modal__title', text: title }),
        subtitle ? h('div', { class: 'modal__sub', text: subtitle }) : null,
      ),
      button({ iconName: 'x', variant: 'ghost', title: 'Fechar', onClick: () => closeModal() }),
    ),
    body,
    footer ? h('div', { class: 'modal__foot' }, footer) : null,
  )

  clear(host)
  host.append(panel)
  host.hidden = false

  const onOverlayClick = (event) => {
    if (event.target === host) closeModal()
  }
  const onKey = (event) => {
    if (event.key === 'Escape') closeModal()
  }
  host.addEventListener('click', onOverlayClick)
  document.addEventListener('keydown', onKey)

  closeCurrent = () => {
    host.removeEventListener('click', onOverlayClick)
    document.removeEventListener('keydown', onKey)
    clear(host)
    host.hidden = true
    closeCurrent = null
  }

  const focusable = panel.querySelector('input, select, textarea, button')
  if (focusable) focusable.focus()
  return { panel, close: closeModal }
}

export function closeModal() {
  if (closeCurrent) closeCurrent()
}

/**
 * Painel deslizante pela direita — para "espiar" conteúdo (o corpo de uma
 * nota do vault, por exemplo) sem esconder o que está atrás, ao contrário do
 * modal centrado. Mesmo mecanismo de fechar (`Esc`, clique fora, X); mesmo
 * slot único de `closeCurrent` — só um painel do tipo modal/drawer por vez.
 */
export function openDrawer({ title, subtitle, body, footer }) {
  closeModal()
  const host = overlayHost()
  host.classList.add('overlay--drawer')
  const panel = h(
    'div',
    { class: 'drawer', role: 'dialog', 'aria-modal': 'true' },
    h(
      'div',
      { class: 'modal__head' },
      h(
        'div',
        { class: 'modal__titles' },
        h('h2', { class: 'modal__title', text: title }),
        subtitle ? h('div', { class: 'modal__sub', text: subtitle }) : null,
      ),
      button({ iconName: 'x', variant: 'ghost', title: 'Fechar', onClick: () => closeModal() }),
    ),
    h('div', { class: 'drawer__body' }, body),
    footer ? h('div', { class: 'modal__foot' }, footer) : null,
  )

  clear(host)
  host.append(panel)
  host.hidden = false

  const onOverlayClick = (event) => {
    if (event.target === host) closeModal()
  }
  const onKey = (event) => {
    if (event.key === 'Escape') closeModal()
  }
  host.addEventListener('click', onOverlayClick)
  document.addEventListener('keydown', onKey)

  closeCurrent = () => {
    host.removeEventListener('click', onOverlayClick)
    document.removeEventListener('keydown', onKey)
    clear(host)
    host.hidden = true
    host.classList.remove('overlay--drawer')
    closeCurrent = null
  }
  return { panel, close: closeModal }
}

/**
 * Confirmação explícita para o que destrói. O CLI recusa apagar sem TTY; esta
 * é a versão em tela do mesmo pedido — e o nome do alvo aparece no texto para
 * que "apagar" nunca seja um clique cego.
 */
export function confirmDialog({ title, description, confirmLabel, danger }) {
  return new Promise((resolve) => {
    let decided = false
    const settle = (value) => {
      if (decided) return
      decided = true
      closeModal()
      resolve(value)
    }
    const { panel } = openModal({
      title,
      body: h('p', { class: 'prose', text: description }),
      footer: [
        button({ label: 'Cancelar', onClick: () => settle(false) }),
        button({
          label: confirmLabel ?? 'Confirmar',
          variant: danger === false ? 'primary' : 'danger',
          onClick: () => settle(true),
        }),
      ],
    })
    // Fechar pelo X, pelo Esc ou pelo clique fora conta como "não".
    const observer = new MutationObserver(() => {
      if (!panel.isConnected) {
        observer.disconnect()
        settle(false)
      }
    })
    observer.observe(overlayHost(), { childList: true })
    const confirmButton = panel.querySelectorAll('.modal__foot .btn')[1]
    if (confirmButton) confirmButton.focus()
  })
}

// ── avisos efêmeros ──────────────────────────────────────────────────────────

/**
 * A mensagem do servidor aparece aqui, literal. Erro de escrita nunca é
 * engolido: sem isto, um 409 de transição ilegal seria indistinguível de um
 * clique que não pegou.
 */
export function toast(message, kind = 'info') {
  const host = document.getElementById('toasts')
  if (!host) return
  const node = h(
    'div',
    { class: `toast${kind === 'info' ? '' : ` toast--${kind}`}`, role: 'status' },
    svg(icon(kind === 'error' ? 'alert' : kind === 'success' ? 'check' : 'spark')),
    h('div', { class: 'toast__body', text: message }),
    button({ iconName: 'x', variant: 'ghost', title: 'Dispensar', onClick: () => node.remove() }),
  )
  host.append(node)
  // Erro fica mais tempo: o usuário precisa conseguir ler a causa antes de sumir.
  setTimeout(() => node.remove(), kind === 'error' ? 9000 : 4000)
}

export function toastError(error) {
  toast(error instanceof Error ? error.message : String(error), 'error')
}

export { frag }
