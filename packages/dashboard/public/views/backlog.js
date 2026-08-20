/**
 * Aba Backlog — kanban.
 *
 * O item de backlog é a conversa entre a pessoa e o Uranus: prosa que vira
 * plano que vira tasks. Por isso o cartão mostra o progresso das subtasks e o
 * detalhe mostra as RECUSAS do validador de plano — sem elas, "por que este
 * item nunca virou task?" só se responde lendo log.
 */
import { clear, h } from '../lib/dom.js'
import { api, apiPath } from '../lib/api.js'
import {
  button,
  card,
  confirmDialog,
  closeModal,
  empty,
  kpis,
  notice,
  openModal,
  page,
  pageHead,
  pill,
  progressMeter,
  readOnlyNotice,
  skeletonKpis,
  numberField,
  selectField,
  textField,
  textareaField,
  toast,
  toastError,
} from '../lib/ui.js'
import { BACKLOG_COLUMNS, asArray, backlogMetrics, label, progressText } from '../lib/aggregate.js'
import { pct } from '../lib/format.js'

export const meta = {
  id: 'backlog',
  label: 'Backlog',
  group: 'Gerenciar',
  icon: 'columns',
  needs: ['backlog', 'tasks'],
}

const STATE_OPTIONS = BACKLOG_COLUMNS.map((column) => ({
  value: column.state,
  label: column.label,
  hint: column.hint,
}))

function itemsOf(ctx) {
  return asArray(ctx.res('backlog').data?.items)
}

function subtasksOf(ctx, item) {
  return asArray(ctx.res('tasks').data?.tasks).filter((task) => task.backlogItemId === item.id)
}

// ── escrita ──────────────────────────────────────────────────────────────────

async function createItem(ctx, payload) {
  await api.post('/api/backlog', payload)
  toast('Item criado.', 'success')
  await ctx.reload(['backlog'])
}

async function patchItem(ctx, id, patch) {
  await api.patch(apiPath('/api/backlog', id), patch)
  await ctx.reload(['backlog'])
}

async function removeItem(ctx, item) {
  const yes = await confirmDialog({
    title: 'Apagar este item do backlog?',
    description:
      `"${item.title}" some do backlog e não volta. As tasks que já nasceram dele continuam ` +
      'na fila — apagar o item não cancela trabalho que já foi planejado.',
    confirmLabel: 'Apagar item',
  })
  if (!yes) return
  try {
    await api.del(apiPath('/api/backlog', item.id))
    toast('Item apagado.', 'success')
    await ctx.reload(['backlog'])
  } catch (error) {
    toastError(error)
  }
}

// ── formulários ──────────────────────────────────────────────────────────────

function openCreate(ctx) {
  const title = textField({
    label: 'O que precisa acontecer',
    help: 'Uma frase. É o que aparece no cartão e o que o planejador lê primeiro.',
    placeholder: 'Adicionar exportação de relatório em CSV',
  })
  const body = textareaField({
    label: 'Contexto',
    help:
      'Escreva em português mesmo: por que isto importa, o que já existe, o que não pode quebrar.\n' +
      'É daqui que o planejador tira as tasks — quanto mais concreto, menos recusa.',
    rows: 7,
    placeholder: 'Hoje o usuário copia da tela. Queremos um botão que baixe o mesmo dado em CSV…',
  })
  const priority = numberField({
    label: 'Prioridade',
    help: '0 a 100. Maior vem primeiro quando o planejamento automático escolhe o que fazer.',
    value: 50,
    min: 0,
    max: 100,
  })
  const labels = textField({
    label: 'Etiquetas',
    help: 'Separadas por vírgula. Servem para você filtrar depois; não mudam o comportamento.',
    placeholder: 'relatorios, ux',
  })
  const errorBox = h('div', { class: 'field__error' })

  const submit = button({
    label: 'Criar item',
    variant: 'primary',
    iconName: 'plus',
    onClick: async () => {
      clear(errorBox)
      if (title.get() === '') {
        errorBox.textContent = 'O título é obrigatório.'
        return
      }
      submit.disabled = true
      try {
        await createItem(ctx, {
          title: title.get(),
          body: body.get(),
          priority: priority.get() ?? 50,
          labels: labels
            .get()
            .split(',')
            .map((value) => value.trim())
            .filter((value) => value !== ''),
        })
        closeModal()
      } catch (error) {
        errorBox.textContent = error instanceof Error ? error.message : String(error)
        submit.disabled = false
      }
    },
  })

  openModal({
    title: 'Novo item de backlog',
    subtitle: 'Descreva o problema. O plano e as tasks o Uranus deriva daqui.',
    wide: true,
    body: h('div', { class: 'form' }, title.el, body.el, priority.el, labels.el, errorBox),
    footer: [button({ label: 'Cancelar', onClick: () => closeModal() }), submit],
  })
}

function openEdit(ctx, item) {
  const title = textField({ label: 'Título', value: item.title })
  const body = textareaField({ label: 'Contexto', value: item.body ?? '', rows: 7 })
  const priority = numberField({
    label: 'Prioridade',
    help: '0 a 100.',
    value: item.priority ?? 50,
    min: 0,
    max: 100,
  })
  const state = selectField({
    label: 'Estado',
    help: 'Mover para "Concluído" à mão não fecha as tasks derivadas.',
    value: item.state,
    options: STATE_OPTIONS,
  })
  const errorBox = h('div', { class: 'field__error' })

  const submit = button({
    label: 'Salvar',
    variant: 'primary',
    onClick: async () => {
      clear(errorBox)
      submit.disabled = true
      try {
        await patchItem(ctx, item.id, {
          title: title.get(),
          body: body.get(),
          priority: priority.get() ?? item.priority ?? 50,
          state: state.get(),
        })
        toast('Item atualizado.', 'success')
        closeModal()
      } catch (error) {
        errorBox.textContent = error instanceof Error ? error.message : String(error)
        submit.disabled = false
      }
    },
  })

  openModal({
    title: 'Editar item',
    subtitle: item.id,
    wide: true,
    body: h('div', { class: 'form' }, title.el, body.el, priority.el, state.el, errorBox),
    footer: [button({ label: 'Cancelar', onClick: () => closeModal() }), submit],
  })
}

function openDetail(ctx, item) {
  const subtasks = subtasksOf(ctx, item)
  const rejections = asArray(item.lastRejections ?? item.rejections)
  const writable = ctx.writable('backlog')

  const body = h(
    'div',
    { class: 'stack' },
    h(
      'div',
      { class: 'btnrow' },
      pill(label(item, 'stateLabel', 'state'), item.tone),
      pill(`prioridade ${String(item.priority ?? '—')}`, 'neutral'),
      ...asArray(item.labels).map((tag) => pill(tag, 'neutral')),
    ),
    item.body ? h('p', { class: 'prose', text: item.body }) : null,
    h(
      'dl',
      { class: 'deflist' },
      h('dt', { text: 'id' }),
      h('dd', { class: 'mono', text: item.id }),
      h('dt', { text: 'origem' }),
      h('dd', { text: label(item, 'sourceLabel', 'source') }),
      item.planId ? h('dt', { text: 'plano' }) : null,
      item.planId ? h('dd', { class: 'mono', text: item.planId }) : null,
      h('dt', { text: 'subtasks' }),
      h('dd', { text: progressText(item) }),
      h('dt', { text: 'criado' }),
      h('dd', { text: item.createdLabel ?? '—' }),
    ),
    Number(item.planningFailures ?? 0) > 0
      ? notice({
          tone: 'warning',
          title: `O planejamento deste item já falhou ${String(item.planningFailures)}×`,
          text:
            'Depois do limite de `backlog.maxPlanningFailures` o item sai do planejamento ' +
            'automático. Deixar o contexto mais concreto costuma resolver.',
        })
      : null,
    subtasks.length > 0
      ? h(
          'div',
          { class: 'stack' },
          h('h3', { class: 'section__title', text: 'Tasks derivadas' }),
          ...subtasks.map((task) =>
            h(
              'div',
              { class: 'kcard' },
              h('div', { class: 'kcard__title', text: task.title }),
              h(
                'div',
                { class: 'kcard__meta' },
                pill(label(task, 'stateLabel', 'state'), task.tone),
                h('span', { class: 'mono', text: task.id }),
              ),
            ),
          ),
        )
      : null,
    rejections.length > 0
      ? notice({
          tone: 'warning',
          title: 'O plano deste item foi recusado',
          text: rejections.map((r) => (typeof r === 'string' ? r : (r.message ?? ''))).join('\n'),
        })
      : null,
  )

  openModal({
    title: item.title,
    subtitle: `Item de backlog · ${label(item, 'stateLabel', 'state')}`,
    wide: true,
    body,
    footer: writable
      ? [
          button({
            label: 'Apagar',
            variant: 'danger',
            iconName: 'trash',
            onClick: async () => {
              closeModal()
              await removeItem(ctx, item)
            },
          }),
          button({
            label: 'Editar',
            variant: 'primary',
            iconName: 'edit',
            onClick: () => openEdit(ctx, item),
          }),
        ]
      : [button({ label: 'Fechar', onClick: () => closeModal() })],
  })
}

// ── kanban ───────────────────────────────────────────────────────────────────

function kanbanCard(ctx, item, writable) {
  const progress = item.progress
  const node = h(
    'article',
    {
      class: 'kcard',
      tabindex: '0',
      role: 'button',
      ...(writable ? { draggable: 'true' } : {}),
      dataset: { itemId: item.id },
      on: {
        click: () => openDetail(ctx, item),
        keydown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            openDetail(ctx, item)
          }
        },
        dragstart: (event) => {
          event.dataTransfer.setData('text/plain', item.id)
          event.dataTransfer.effectAllowed = 'move'
          node.classList.add('is-dragging')
        },
        dragend: () => node.classList.remove('is-dragging'),
      },
    },
    h('div', { class: 'kcard__title', text: item.title }),
    h(
      'div',
      { class: 'kcard__meta' },
      pill(`p${String(item.priority ?? 0)}`, 'neutral'),
      ...asArray(item.labels).slice(0, 2).map((tag) => pill(tag, 'neutral')),
      item.createdLabel ? h('span', { text: `criado ${item.createdLabel}` }) : null,
    ),
    progress && Number(progress.total ?? 0) > 0
      ? h(
          'div',
          null,
          h('div', { class: 'kcard__progress', text: progressText(item) }),
          progressMeter(progress.done ?? 0, progress.total ?? 0),
        )
      : null,
  )
  return node
}

function column(ctx, definition, items, writable) {
  const body = h('div', { class: 'column__body' })
  if (items.length === 0) {
    body.append(
      h('div', {
        class: 'column__empty',
        text: writable
          ? `Nada em "${definition.label}". ${definition.hint}`
          : `Nada em "${definition.label}".`,
      }),
    )
  } else {
    for (const item of items) body.append(kanbanCard(ctx, item, writable))
  }

  const node = h(
    'div',
    {
      class: 'column',
      dataset: { state: definition.state },
      on: writable
        ? {
            dragover: (event) => {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              node.classList.add('is-over')
            },
            dragleave: () => node.classList.remove('is-over'),
            drop: async (event) => {
              event.preventDefault()
              node.classList.remove('is-over')
              const id = event.dataTransfer.getData('text/plain')
              if (id === '') return
              const moved = itemsOf(ctx).find((candidate) => candidate.id === id)
              if (!moved || moved.state === definition.state) return
              try {
                await patchItem(ctx, id, { state: definition.state })
                toast(`Movido para ${definition.label}.`, 'success')
              } catch (error) {
                toastError(error)
              }
            },
          }
        : {},
    },
    h(
      'div',
      { class: 'column__head' },
      h('span', { class: 'column__name', text: definition.label }),
      h('span', { class: 'column__count', text: String(items.length) }),
    ),
    body,
  )
  return node
}

// ── render ───────────────────────────────────────────────────────────────────

export function render(ctx) {
  const resource = ctx.res('backlog')
  const writable = ctx.writable('backlog')
  const items = itemsOf(ctx)
  const metrics = backlogMetrics(items)

  if (resource.status === 'loading') {
    return page(pageHead({ title: 'Backlog' }), skeletonKpis(4), h('div', { class: 'skeleton', style: { height: '20rem' } }))
  }

  const head = pageHead({
    title: 'Backlog',
    description: 'O que ainda não virou task. Arraste um cartão para mudar o estado.',
    actions: writable
      ? [button({ label: 'Novo item', variant: 'primary', iconName: 'plus', onClick: () => openCreate(ctx) })]
      : [],
  })

  const body =
    items.length === 0
      ? card({
          body: empty({
            iconName: 'columns',
            title: 'O backlog está vazio',
            description: writable
              ? 'Comece descrevendo um problema em português. O Uranus transforma o item em ' +
                'plano e o plano em tasks — você não precisa escrever task nenhuma à mão.'
              : 'Nenhum item em `.uranus/backlog`. Crie um com `uranus backlog add`.',
            action: writable
              ? button({ label: 'Criar o primeiro item', variant: 'primary', iconName: 'plus', onClick: () => openCreate(ctx) })
              : undefined,
          }),
        })
      : h(
          'div',
          { class: 'kanban' },
          BACKLOG_COLUMNS.map((definition) =>
            column(
              ctx,
              definition,
              items.filter((item) => item.state === definition.state),
              writable,
            ),
          ),
        )

  return page(
    head,
    resource.status === 'unavailable' ? readOnlyNotice('criar e mover itens') : null,
    resource.status === 'error'
      ? notice({ tone: 'danger', title: 'Falha ao ler o backlog', text: resource.error?.message })
      : null,
    kpis([
      {
        label: 'Abertos',
        value: metrics.open,
        hint: 'Ainda sem plano. É daqui que o planejamento automático puxa.',
        tone: 'info',
        iconName: 'inbox',
      },
      {
        label: 'Em andamento',
        value: metrics.planned,
        hint:
          metrics.subtasksTotal > 0
            ? `${String(metrics.subtasksDone)}/${String(metrics.subtasksTotal)} subtasks concluídas`
            : 'Itens já planejados.',
        tone: 'warning',
        iconName: 'cpu',
      },
      {
        label: 'Concluídos',
        value: metrics.done,
        hint: 'Todas as tasks do item terminaram.',
        tone: 'success',
        iconName: 'check',
      },
      {
        label: 'Taxa de conclusão',
        value: metrics.completion === undefined ? '—' : pct(metrics.completion),
        hint:
          metrics.dropped > 0
            ? `${String(metrics.dropped)} descartado(s) fora da conta`
            : 'Concluídos sobre o que não foi descartado.',
        tone: 'neutral',
        iconName: 'gauge',
      },
    ]),
    body,
  )
}
