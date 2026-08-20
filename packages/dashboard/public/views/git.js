/**
 * Aba Git — controle de verdade sobre o GitHub, não só telemetria do que o
 * Uranus mesmo produziu.
 *
 * Pull requests vêm ao vivo do `gh` CLI (a mesma autenticação do `gh auth
 * login` da máquina — ver `packages/cli/src/git-control.ts`); aprovar, pedir
 * mudança, comentar, mergear e fechar agem direto no GitHub a partir daqui.
 * Branches e commits vêm de `git` local, porque são dados do repositório, não
 * da API remota — ler local é instantâneo e não gasta rate limit.
 */
import { clear, h } from '../lib/dom.js'
import { api } from '../lib/api.js'
import {
  button,
  card,
  cellTitle,
  confirmDialog,
  closeModal,
  empty,
  notice,
  openModal,
  page,
  pageHead,
  pill,
  skeletonRows,
  table,
  textareaField,
  toast,
  toastError,
} from '../lib/ui.js'
import { asArray } from '../lib/aggregate.js'
import { since, time } from '../lib/format.js'

export const meta = {
  id: 'git',
  label: 'Git',
  group: 'Acompanhar',
  icon: 'branch',
  needs: ['github'],
}

const CHECKS_TONE = { success: 'success', failure: 'danger', pending: 'warning', unknown: 'neutral' }
const CHECKS_LABEL = {
  success: 'checks ok',
  failure: 'checks falharam',
  pending: 'checks rodando',
  unknown: 'sem checks',
}

const REVIEW_TONE = { APPROVED: 'success', CHANGES_REQUESTED: 'danger', REVIEW_REQUIRED: 'neutral', '': 'neutral' }
const REVIEW_LABEL = {
  APPROVED: 'aprovado',
  CHANGES_REQUESTED: 'mudanças pedidas',
  REVIEW_REQUIRED: 'revisão pendente',
  '': 'sem review',
}

const MERGEABLE_TONE = { MERGEABLE: 'success', CONFLICTING: 'danger', UNKNOWN: 'neutral' }
const MERGEABLE_LABEL = { MERGEABLE: 'sem conflito', CONFLICTING: 'em conflito', UNKNOWN: 'checando…' }

function pullsOf(ctx) {
  return asArray(ctx.res('github').data?.pulls)
}
function branchesOf(ctx) {
  return asArray(ctx.res('github').data?.branches)
}
function commitsOf(ctx) {
  return asArray(ctx.res('github').data?.commits)
}
function repoErrorsOf(ctx) {
  return asArray(ctx.res('github').data?.repoErrors)
}

async function doReview(ctx, pr, action, body) {
  await api.post(
    `/api/github/pulls/${encodeURIComponent(pr.repo)}/${String(pr.number)}/review`,
    body ? { action, body } : { action },
  )
  toast(
    action === 'approve' ? 'PR aprovado.' : action === 'request-changes' ? 'Mudança solicitada.' : 'Comentário enviado.',
    'success',
  )
  await ctx.reload(['github'])
}

async function doMerge(ctx, pr, method) {
  await api.post(`/api/github/pulls/${encodeURIComponent(pr.repo)}/${String(pr.number)}/merge`, { method })
  toast('PR mergeado.', 'success')
  await ctx.reload(['github'])
}

async function doClose(ctx, pr) {
  await api.post(`/api/github/pulls/${encodeURIComponent(pr.repo)}/${String(pr.number)}/close`)
  toast('PR fechado.', 'success')
  await ctx.reload(['github'])
}

function openReviewModal(ctx, pr, action) {
  const isRequest = action === 'request-changes'
  const label = isRequest ? 'Pedir mudança' : 'Comentar'
  const field = textareaField({
    label: 'Mensagem',
    help: isRequest ? 'O que precisa mudar antes de aprovar.' : 'Seu comentário no PR.',
    rows: 5,
    placeholder: isRequest ? 'Falta tratar o caso de...' : 'Comentário...',
  })
  const errorBox = h('div', { class: 'field__error' })

  const submit = button({
    label,
    variant: isRequest ? 'danger' : 'primary',
    onClick: async () => {
      clear(errorBox)
      submit.disabled = true
      try {
        await doReview(ctx, pr, action, field.get())
        closeModal()
      } catch (error) {
        errorBox.textContent = error instanceof Error ? error.message : String(error)
        submit.disabled = false
      }
    },
  })

  openModal({
    title: `${label} — PR #${String(pr.number)}`,
    subtitle: pr.title,
    wide: true,
    body: h('div', { class: 'form' }, field.el, errorBox),
    footer: [button({ label: 'Cancelar', onClick: () => closeModal() }), submit],
  })
}

function mergeControl(ctx, pr) {
  const select = h(
    'select',
    { class: 'select' },
    h('option', { value: 'squash', text: 'Squash and merge' }),
    h('option', { value: 'merge', text: 'Merge commit' }),
    h('option', { value: 'rebase', text: 'Rebase and merge' }),
  )
  const merge = button({
    label: 'Mergear',
    iconName: 'check',
    onClick: async () => {
      const method = select.value
      const yes = await confirmDialog({
        title: `Mergear PR #${String(pr.number)}?`,
        description: `"${pr.title}" — método: ${method}. Não tem desfazer pelo painel.`,
        confirmLabel: 'Mergear',
      })
      if (!yes) return
      try {
        await doMerge(ctx, pr, method)
      } catch (error) {
        toastError(error)
      }
    },
  })
  return h('div', { class: 'btnrow' }, select, merge)
}

function pullCard(ctx, pr, showRepo) {
  return h(
    'article',
    { class: 'kcard' },
    h(
      'div',
      { class: 'kcard__title' },
      h('a', { href: pr.url, target: '_blank', rel: 'noreferrer noopener', text: `#${String(pr.number)} ${pr.title}` }),
    ),
    h(
      'div',
      { class: 'kcard__meta' },
      showRepo ? pill(pr.repo, 'info') : null,
      pill(`${pr.branch} → ${pr.baseBranch}`, 'neutral'),
      pr.isDraft ? pill('draft', 'neutral') : null,
      pill(CHECKS_LABEL[pr.checksState] ?? pr.checksState, CHECKS_TONE[pr.checksState] ?? 'neutral'),
      pill(REVIEW_LABEL[pr.reviewDecision] ?? pr.reviewDecision, REVIEW_TONE[pr.reviewDecision] ?? 'neutral'),
      pill(MERGEABLE_LABEL[pr.mergeable] ?? pr.mergeable, MERGEABLE_TONE[pr.mergeable] ?? 'neutral'),
      h('span', { class: 'dim', text: `por ${pr.author} · ${since(pr.updatedAt)}` }),
    ),
    h(
      'p',
      { class: 'kcard__body' },
      h('span', { style: { color: 'rgb(var(--success))' }, text: `+${String(pr.additions)}` }),
      ' ',
      h('span', { style: { color: 'rgb(var(--danger))' }, text: `−${String(pr.deletions)}` }),
    ),
    h(
      'div',
      { class: 'btnrow' },
      button({
        label: 'Aprovar',
        iconName: 'check',
        variant: 'primary',
        onClick: async () => {
          const yes = await confirmDialog({
            title: `Aprovar PR #${String(pr.number)}?`,
            description: pr.title,
            confirmLabel: 'Aprovar',
            danger: false,
          })
          if (!yes) return
          try {
            await doReview(ctx, pr, 'approve')
          } catch (error) {
            toastError(error)
          }
        },
      }),
      button({
        label: 'Pedir mudança',
        iconName: 'alert',
        onClick: () => openReviewModal(ctx, pr, 'request-changes'),
      }),
      button({ label: 'Comentar', onClick: () => openReviewModal(ctx, pr, 'comment') }),
      mergeControl(ctx, pr),
      button({
        label: 'Fechar',
        iconName: 'x',
        variant: 'danger',
        onClick: async () => {
          const yes = await confirmDialog({
            title: `Fechar PR #${String(pr.number)} sem mergear?`,
            description: pr.title,
            confirmLabel: 'Fechar PR',
          })
          if (!yes) return
          try {
            await doClose(ctx, pr)
          } catch (error) {
            toastError(error)
          }
        },
      }),
    ),
  )
}

export function render(ctx) {
  const resource = ctx.res('github')

  if (resource.status === 'loading') {
    return page(pageHead({ title: 'Git' }), skeletonRows(6))
  }

  const head = pageHead({
    title: 'Git',
    description:
      'Pull requests, branches e commits ao vivo do GitHub e do repositório local. Aprovar, pedir ' +
      'mudança, comentar, mergear e fechar agem direto no GitHub — via `gh` CLI, com a autenticação ' +
      'que já está na sua máquina.',
  })

  if (resource.status === 'unavailable') {
    return page(
      head,
      notice({
        tone: 'neutral',
        title: 'GitHub não disponível pelo painel',
        text: 'Este painel subiu sem porta de dados — o painel está somente-leitura.',
      }),
    )
  }
  if (resource.status === 'error') {
    return page(
      head,
      notice({
        tone: 'danger',
        title: 'Falha ao falar com o GitHub/git',
        text:
          resource.error?.message ??
          'Confira `gh auth status` e se este diretório é um repositório com remote no GitHub.',
      }),
    )
  }

  const pulls = pullsOf(ctx)
  const branches = branchesOf(ctx)
  const commits = commitsOf(ctx)
  const repoErrors = repoErrorsOf(ctx)

  // Mais de um repositório (ex.: `orionbot/` com `core/` e `bot-ui/`, cada um
  // seu próprio `.git`) — mostra de qual repo é cada PR/branch/commit. Num
  // projeto com um repo só, a tag seria ruído puro, então some.
  const repoIds = new Set(
    [...pulls, ...branches, ...commits].map((item) => item.repo).concat(repoErrors.map((e) => e.repo)),
  )
  const showRepo = repoIds.size > 1

  return page(
    head,
    repoErrors.length > 0
      ? notice({
          tone: 'warning',
          title: `${String(repoErrors.length)} repositório(s) não responderam`,
          text: repoErrors.map((e) => `${e.repo}: ${e.message}`).join(' · '),
        })
      : null,
    card({
      title: `Pull requests abertos (${String(pulls.length)})`,
      body:
        pulls.length === 0
          ? empty({ iconName: 'branch', title: 'Nenhum PR aberto', description: 'Tudo mergeado ou nada em andamento.' })
          : h('div', { class: 'stack' }, pulls.map((pr) => pullCard(ctx, pr, showRepo))),
    }),
    card({
      title: `Branches (${String(branches.length)})`,
      flush: branches.length > 0,
      body:
        branches.length === 0
          ? empty({ iconName: 'branch', title: 'Nenhuma branch local' })
          : table(
              [
                showRepo ? { label: 'Repo' } : null,
                { label: 'Branch' },
                { label: 'Último commit' },
                { label: 'SHA' },
                { label: 'Quando' },
              ].filter((col) => col !== null),
              branches.map((branch) =>
                h(
                  'tr',
                  null,
                  showRepo ? h('td', { class: 'dim' }, branch.repo) : null,
                  h(
                    'td',
                    null,
                    branch.current ? pill(branch.name, 'info') : h('span', { class: 'mono', text: branch.name }),
                  ),
                  h('td', null, cellTitle(branch.lastCommitSubject || '—')),
                  h('td', { class: 'mono dim' }, branch.lastCommitSha || '—'),
                  h('td', { class: 'mono dim nowrap' }, time(branch.lastCommitAt)),
                ),
              ),
            ),
    }),
    card({
      title: `Commits recentes (${String(commits.length)})`,
      flush: commits.length > 0,
      body:
        commits.length === 0
          ? empty({ iconName: 'branch', title: 'Nenhum commit' })
          : table(
              [
                showRepo ? { label: 'Repo' } : null,
                { label: 'Quando' },
                { label: 'SHA' },
                { label: 'Autor' },
                { label: 'Assunto' },
              ].filter((col) => col !== null),
              commits.map((commit) =>
                h(
                  'tr',
                  null,
                  showRepo ? h('td', { class: 'dim' }, commit.repo) : null,
                  h('td', { class: 'mono dim nowrap' }, time(commit.at)),
                  h('td', { class: 'mono' }, commit.shortSha || '—'),
                  h('td', { class: 'dim' }, commit.author || '—'),
                  h('td', null, cellTitle(commit.subject || '—')),
                ),
              ),
            ),
    }),
  )
}
