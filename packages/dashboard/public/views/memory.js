/**
 * Aba Memória — o que o Claude aprende sobre este projeto e carrega de sessão
 * em sessão (ver `packages/core/src/domain/memory.ts`).
 *
 * Antes esta aba só mostrava contadores agregados do run (quantas memórias
 * foram gravadas, quantos conflitos...). Isso continua útil e fica na seção
 * "Nesta sessão", mas o que faltava era o registro em si: ler o que já foi
 * aprendido, e criar uma memória nova pelo painel — o mesmo que `uranus
 * memory add` faz pela linha de comando, para quem prefere o navegador. A
 * relação entre memórias, backlog e instruções (via `[[wikilink]]`) vive na
 * aba Vault, não aqui — esta lista é só o inventário plano.
 */
import { clear, h } from '../lib/dom.js'
import { api } from '../lib/api.js'
import {
  button,
  card,
  empty,
  notice,
  openDrawer,
  openModal,
  closeModal,
  page,
  pageHead,
  pill,
  readOnlyNotice,
  selectField,
  skeletonRows,
  textField,
  textareaField,
  toast,
} from '../lib/ui.js'
import { asArray } from '../lib/aggregate.js'
import { since } from '../lib/format.js'

export const meta = {
  id: 'memoria',
  label: 'Memória',
  group: 'Acompanhar',
  icon: 'database',
  needs: ['memory'],
}

const SCOPE_LABEL = {
  architecture: 'arquitetura',
  decision: 'decisão',
  bug: 'bug',
  preference: 'preferência',
  stack: 'stack',
  pattern: 'padrão',
  convention: 'convenção',
  roadmap: 'roadmap',
  history: 'histórico',
  context: 'contexto',
}

const FALLBACK_SCOPES = Object.keys(SCOPE_LABEL)

function recordsOf(ctx) {
  return asArray(ctx.res('memory').data?.records)
}

function scopesOf(ctx) {
  const scopes = asArray(ctx.res('memory').data?.scopes)
  return scopes.length > 0 ? scopes : FALLBACK_SCOPES
}

async function createRecord(ctx, payload) {
  await api.post('/api/memory', payload)
  toast('Memória gravada.', 'success')
  await ctx.reload(['memory'])
}

function parseTags(raw) {
  return raw
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '')
}

function openCreate(ctx) {
  const title = textField({
    label: 'Título',
    help: 'Curto e específico — é o que aparece na lista e no grafo do Vault.',
    placeholder: 'Preferência: PRs pequenos, um por subtask',
  })
  const scope = selectField({
    label: 'Escopo',
    help: 'Que tipo de coisa é isto — decide onde entra na curadoria e na compactação.',
    value: 'context',
    options: scopesOf(ctx).map((value) => ({ value, label: SCOPE_LABEL[value] ?? value })),
  })
  const body = textareaField({
    label: 'Corpo',
    help:
      'O fato ou decisão por extenso, com o porquê. Use [[título de outra nota]] para linkar ' +
      'memória, backlog e instruções entre si — a aba Vault desenha o resultado.',
    rows: 8,
    placeholder: 'O usuário pediu PRs pequenos porque revisa incrementalmente, um por subtask...',
  })
  const tags = textField({
    label: 'Tags (opcional)',
    help: 'Separadas por vírgula.',
    placeholder: 'backlog, revisão',
  })
  const errorBox = h('div', { class: 'field__error' })

  const submit = button({
    label: 'Gravar memória',
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
        await createRecord(ctx, {
          title: title.get(),
          scope: scope.get(),
          body: body.get(),
          tags: parseTags(tags.get()),
        })
        closeModal()
      } catch (error) {
        errorBox.textContent = error instanceof Error ? error.message : String(error)
        submit.disabled = false
      }
    },
  })

  openModal({
    title: 'Nova memória',
    subtitle: 'O que o Claude deveria saber sem precisar redescobrir na próxima sessão.',
    wide: true,
    body: h('div', { class: 'form' }, title.el, scope.el, body.el, tags.el, errorBox),
    footer: [button({ label: 'Cancelar', onClick: () => closeModal() }), submit],
  })
}

function openDetail(record) {
  const scopeLabel = SCOPE_LABEL[record.scope] ?? record.scope
  openDrawer({
    title: record.title,
    subtitle: `${scopeLabel} · confiança ${Math.round((record.confidence ?? 0) * 100)}%`,
    body: h(
      'div',
      { class: 'stack' },
      h(
        'div',
        { class: 'btnrow' },
        pill(scopeLabel, 'info'),
        ...asArray(record.tags).map((tag) => pill(tag, 'neutral')),
      ),
      h('p', { class: 'prose', text: record.body || '(sem conteúdo)' }),
      h(
        'dl',
        { class: 'deflist' },
        h('dt', { text: 'chave' }),
        h('dd', { class: 'mono', text: record.key }),
        h('dt', { text: 'fonte' }),
        h('dd', { text: `${record.source?.kind ?? '—'} (${record.source?.ref ?? '—'})` }),
        record.validFrom
          ? h('dt', { text: 'desde' })
          : null,
        record.validFrom ? h('dd', { text: since(record.validFrom) }) : null,
      ),
      h('p', {
        class: 'muted',
        text:
          'Editar: grave de novo com a mesma chave (`uranus memory add ... --key ' +
          `${record.key}\`) — atualiza este registro em vez de duplicar. Arquivo em .uranus/memory/.`,
      }),
    ),
  })
}

function recordCard(record) {
  const scopeLabel = SCOPE_LABEL[record.scope] ?? record.scope
  const preview = (record.body ?? '').split('\n').find((line) => line.trim() !== '') ?? ''
  return h(
    'article',
    {
      class: 'kcard',
      tabindex: '0',
      role: 'button',
      on: {
        click: () => openDetail(record),
        keydown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            openDetail(record)
          }
        },
      },
    },
    h('div', { class: 'kcard__title', text: record.title }),
    h(
      'div',
      { class: 'kcard__meta' },
      pill(scopeLabel, 'info'),
      ...asArray(record.tags)
        .slice(0, 3)
        .map((tag) => pill(tag, 'neutral')),
      record.validFrom ? h('span', { text: `gravada ${since(record.validFrom)}` }) : null,
    ),
    preview ? h('p', { class: 'kcard__body', text: preview }) : null,
  )
}

export function render(ctx) {
  const resource = ctx.res('memory')
  const writable = ctx.writable('memory')
  const records = recordsOf(ctx)

  const head = pageHead({
    title: 'Memória',
    description:
      'O que o Claude aprende sobre este projeto — decisões, preferências, convenções, bugs ' +
      'recorrentes — e carrega de uma sessão de `uranus chat` para a outra, em vez de redescobrir ' +
      'tudo do zero. Como as memórias se ligam entre si e ao backlog fica na aba Vault.',
    actions: writable
      ? [button({ label: 'Nova memória', variant: 'primary', iconName: 'plus', onClick: () => openCreate(ctx) })]
      : [],
  })

  const list =
    resource.status === 'loading'
      ? skeletonRows(4)
      : records.length === 0
        ? card({
            body: empty({
              iconName: 'database',
              title: 'Nenhuma memória ainda',
              description: writable
                ? 'O Claude grava aqui com `uranus memory add` durante `uranus chat`, ou registre ' +
                  'você mesmo o que ele deveria saber sem perguntar de novo.'
                : 'Nenhuma em `.uranus/memory`. Crie uma pelo painel ou escreva um arquivo `.md` à mão.',
              action: writable
                ? button({ label: 'Criar a primeira', variant: 'primary', iconName: 'plus', onClick: () => openCreate(ctx) })
                : undefined,
            }),
          })
        : h('div', { class: 'stack' }, records.map(recordCard))

  return page(
    head,
    resource.status === 'unavailable' ? readOnlyNotice('ver e gravar memórias') : null,
    resource.status === 'error'
      ? notice({ tone: 'danger', title: 'Falha ao ler a memória', text: resource.error?.message })
      : null,
    records.length > 0 ? h('p', { class: 'muted', text: `${String(records.length)} memórias` }) : null,
    list,
  )
}
