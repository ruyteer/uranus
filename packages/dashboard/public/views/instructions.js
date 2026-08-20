/**
 * Aba Instruções — o que substituiu a validação de código.
 *
 * O Uranus não roda mais lint/escopo/diff por regra (ver `docs/00-ARCHITECTURE`,
 * pivot "Uranus é armadura"). O que sobrou como rede de proteção é o Claude
 * usando julgamento — e o único jeito de melhorar esse julgamento é dar
 * contexto melhor. Uma instrução aqui vira texto em `CLAUDE.md`
 * (`claude-bridge.ts`), lido em toda sessão `uranus chat`, não uma regra que
 * aprova/reprova um diff.
 *
 * `scope` é também o mecanismo de "projeto com N subprojetos": sem escopo, a
 * instrução vale para o repo inteiro; com `scope: packages/api`, ela vira um
 * `CLAUDE.md` só daquela pasta — o Claude Code já lê o `CLAUDE.md` mais
 * próximo de onde está trabalhando.
 */
import { clear, h } from '../lib/dom.js'
import { api, apiPath } from '../lib/api.js'
import {
  button,
  card,
  confirmDialog,
  closeModal,
  empty,
  notice,
  openModal,
  page,
  pageHead,
  pill,
  readOnlyNotice,
  skeletonRows,
  textField,
  textareaField,
  toast,
  toastError,
} from '../lib/ui.js'
import { asArray } from '../lib/aggregate.js'
import { since } from '../lib/format.js'

export const meta = {
  id: 'instrucoes',
  label: 'Instruções',
  group: 'Gerenciar',
  icon: 'shield',
  needs: ['instructions'],
}

function notesOf(ctx) {
  return asArray(ctx.res('instructions').data?.notes)
}

async function createNote(ctx, payload) {
  await api.post('/api/instructions', payload)
  toast('Instrução criada.', 'success')
  await ctx.reload(['instructions'])
}

async function patchNote(ctx, id, patch) {
  await api.patch(apiPath('/api/instructions', id), patch)
  await ctx.reload(['instructions'])
}

async function removeNote(ctx, note) {
  const yes = await confirmDialog({
    title: 'Apagar esta instrução?',
    description: `"${note.title}" some do projeto — o CLAUDE.md é regravado sem ela na hora.`,
    confirmLabel: 'Apagar instrução',
  })
  if (!yes) return
  try {
    await api.del(apiPath('/api/instructions', note.id))
    toast('Instrução apagada.', 'success')
    await ctx.reload(['instructions'])
  } catch (error) {
    toastError(error)
  }
}

function scopeField(value) {
  return textField({
    label: 'Escopo (opcional)',
    help:
      'Uma pasta do projeto, ex.: `packages/api`. Em branco, vale para o repo inteiro. ' +
      'Com escopo, esta instrução vira um CLAUDE.md só dentro daquela pasta — é assim que um ' +
      'monorepo/multi-projeto tem instrução por área.',
    value: value ?? '',
    placeholder: 'packages/api',
  })
}

function openCreate(ctx) {
  const title = textField({
    label: 'Título',
    help: 'Curto — aparece como cabeçalho da seção no CLAUDE.md.',
    placeholder: 'Estilo de commit',
  })
  const body = textareaField({
    label: 'Instrução',
    help: 'Escreva como se estivesse explicando para alguém novo no time. Vai verbatim para o Claude.',
    rows: 8,
    placeholder: 'Mensagens de commit sempre em português, no imperativo, explicando o porquê...',
  })
  const scope = scopeField('')
  const errorBox = h('div', { class: 'field__error' })

  const submit = button({
    label: 'Criar instrução',
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
        await createNote(ctx, {
          title: title.get(),
          body: body.get(),
          ...(scope.get() === '' ? {} : { scope: scope.get() }),
        })
        closeModal()
      } catch (error) {
        errorBox.textContent = error instanceof Error ? error.message : String(error)
        submit.disabled = false
      }
    },
  })

  openModal({
    title: 'Nova instrução',
    subtitle: 'Vira uma seção no CLAUDE.md que o Claude lê em toda sessão.',
    wide: true,
    body: h('div', { class: 'form' }, title.el, body.el, scope.el, errorBox),
    footer: [button({ label: 'Cancelar', onClick: () => closeModal() }), submit],
  })
}

function openEdit(ctx, note) {
  const title = textField({ label: 'Título', value: note.title })
  const body = textareaField({ label: 'Instrução', value: note.body ?? '', rows: 8 })
  const scope = scopeField(note.scope)
  const errorBox = h('div', { class: 'field__error' })

  const submit = button({
    label: 'Salvar',
    variant: 'primary',
    onClick: async () => {
      clear(errorBox)
      submit.disabled = true
      try {
        await patchNote(ctx, note.id, {
          title: title.get(),
          body: body.get(),
          scope: scope.get() === '' ? null : scope.get(),
        })
        toast('Instrução atualizada.', 'success')
        closeModal()
      } catch (error) {
        errorBox.textContent = error instanceof Error ? error.message : String(error)
        submit.disabled = false
      }
    },
  })

  openModal({
    title: note.title,
    subtitle: note.scope ? `Escopo: ${note.scope}` : 'Vale para o projeto inteiro',
    wide: true,
    body: h('div', { class: 'form' }, title.el, body.el, scope.el, errorBox),
    footer: [
      button({
        label: 'Apagar',
        variant: 'danger',
        iconName: 'trash',
        onClick: async () => {
          closeModal()
          await removeNote(ctx, note)
        },
      }),
      button({ label: 'Cancelar', onClick: () => closeModal() }),
      submit,
    ],
  })
}

function noteCard(ctx, note, writable) {
  const preview = (note.body ?? '').split('\n').find((line) => line.trim() !== '') ?? ''
  return h(
    'article',
    {
      class: 'kcard',
      tabindex: '0',
      role: 'button',
      on: {
        click: () => (writable ? openEdit(ctx, note) : undefined),
        keydown: (event) => {
          if (writable && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault()
            openEdit(ctx, note)
          }
        },
      },
    },
    h('div', { class: 'kcard__title', text: note.title }),
    h(
      'div',
      { class: 'kcard__meta' },
      pill(note.scope ? note.scope : 'projeto inteiro', note.scope ? 'info' : 'neutral'),
      note.updatedAt ? h('span', { text: `atualizado ${since(note.updatedAt)}` }) : null,
    ),
    preview ? h('p', { class: 'kcard__body', text: preview }) : null,
  )
}

export function render(ctx) {
  const resource = ctx.res('instructions')
  const writable = ctx.writable('instructions')
  const notes = notesOf(ctx)

  if (resource.status === 'loading') {
    return page(pageHead({ title: 'Instruções' }), skeletonRows(4))
  }

  const head = pageHead({
    title: 'Instruções',
    description:
      'O que o Claude deve saber sobre este projeto além do código. Substitui a validação por ' +
      'regra: aqui não há "aprova/reprova", só contexto melhor para quem julga.',
    actions: writable
      ? [button({ label: 'Nova instrução', variant: 'primary', iconName: 'plus', onClick: () => openCreate(ctx) })]
      : [],
  })

  const body =
    notes.length === 0
      ? card({
          body: empty({
            iconName: 'shield',
            title: 'Nenhuma instrução ainda',
            description: writable
              ? 'Escreva convenções, decisões e coisas que o Claude deveria saber sem perguntar. ' +
                'Cada instrução vira uma seção no CLAUDE.md, lida em toda sessão de `uranus chat`.'
              : 'Nenhuma em `.uranus/instructions`. Crie uma pelo painel ou escreva um arquivo `.md` à mão.',
            action: writable
              ? button({ label: 'Criar a primeira', variant: 'primary', iconName: 'plus', onClick: () => openCreate(ctx) })
              : undefined,
          }),
        })
      : h('div', { class: 'stack' }, notes.map((note) => noteCard(ctx, note, writable)))

  return page(
    head,
    resource.status === 'unavailable' ? readOnlyNotice('criar e editar instruções') : null,
    resource.status === 'error'
      ? notice({ tone: 'danger', title: 'Falha ao ler as instruções', text: resource.error?.message })
      : null,
    body,
  )
}
