/**
 * Aba Skills — marketplace.
 *
 * O Uranus é a armadura, não quem luta — e uma armadura boa tem encaixes
 * prontos. Skills são o encaixe: instalar aqui copia o `SKILL.md` oficial de
 * `anthropics/skills` para `.claude/skills/<id>/` deste projeto, no mesmo
 * formato que o Claude Code já lê sozinho em qualquer sessão.
 */
import { h } from '../lib/dom.js'
import { api, apiPath } from '../lib/api.js'
import { button, notice, page, pageHead, pill, readOnlyNotice, skeletonRows, toast, toastError } from '../lib/ui.js'
import { asArray } from '../lib/aggregate.js'

export const meta = {
  id: 'skills',
  label: 'Skills',
  group: 'Gerenciar',
  icon: 'spark',
  needs: ['skills'],
}

async function install(ctx, skillButton, skill) {
  skillButton.disabled = true
  skillButton.textContent = 'Instalando…'
  try {
    await api.post(apiPath('/api/skills', skill.id) + '/install', {})
    toast(`"${skill.title}" instalada em .claude/skills/${skill.id}.`, 'success')
    await ctx.reload(['skills'])
  } catch (error) {
    toastError(error)
    skillButton.disabled = false
    skillButton.textContent = 'Instalar'
  }
}

/**
 * Não usa `card()` de propósito: o botão de instalar precisa ficar fixo no
 * rodapé do cartão independente do tamanho da descrição, e isso exige uma
 * classe própria (`.skillcard`) para o flex column — mexer no `.card` global
 * afetaria toda tela que usa cartão (backlog, instruções, config...).
 */
function skillCard(ctx, skill, writable) {
  const installButton = skill.installed
    ? button({ label: 'Instalada', iconName: 'check', disabled: true })
    : button({
        label: 'Instalar',
        variant: 'primary',
        iconName: 'download',
        disabled: !writable,
        onClick: (event) => install(ctx, event.currentTarget, skill),
      })

  return h(
    'div',
    { class: 'card skillcard' },
    h(
      'div',
      { class: 'card__head' },
      h('h3', { class: 'card__title', text: skill.title }),
      h('span', {
        class: 'card__hint',
        text: skill.official ? `oficial · ${skill.sourceRepo}` : 'comunidade',
      }),
    ),
    h(
      'div',
      { class: 'card__body skillcard__body' },
      h('p', { class: 'prose skillcard__desc', text: skill.description }),
      h(
        'div',
        { class: 'btnrow skillcard__meta' },
        pill(skill.installed ? 'instalada' : 'disponível', skill.installed ? 'success' : 'neutral'),
        h('a', { href: skill.sourceUrl, target: '_blank', rel: 'noreferrer', text: 'ver no GitHub' }),
      ),
      h('div', { class: 'btnrow skillcard__actions' }, installButton),
    ),
  )
}

export function render(ctx) {
  const resource = ctx.res('skills')
  const writable = ctx.writable('skills')
  const skills = asArray(resource.data?.skills)

  if (resource.status === 'loading') {
    return page(pageHead({ title: 'Skills' }), skeletonRows(4))
  }

  return page(
    pageHead({
      title: 'Skills',
      description:
        'Skills prontas para adicionar ao Claude neste projeto. Cada uma vira um SKILL.md em ' +
        '.claude/skills — o Claude Code passa a reconhecer e usar sozinho quando fizer sentido.',
    }),
    resource.status === 'unavailable' ? readOnlyNotice('instalar skills') : null,
    resource.status === 'error'
      ? notice({ tone: 'danger', title: 'Falha ao ler o catálogo', text: resource.error?.message })
      : null,
    h('div', { class: 'cols' }, skills.map((skill) => skillCard(ctx, skill, writable))),
  )
}
