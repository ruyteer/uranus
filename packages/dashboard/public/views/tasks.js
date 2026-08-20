/**
 * Aba Tasks — tabela agrupada, troca de estado, exclusão e criação.
 *
 * O formulário de criação é o ponto do pedido: "interface mais fácil de
 * escrever do que yaml". Tipo é um select, intenção é um textarea, escopo é
 * uma lista de globs com chips e os checks são caixas de seleção. Em nenhum
 * lugar desta tela alguém digita YAML.
 */
import { clear, h } from '../lib/dom.js'
import { api, apiPath } from '../lib/api.js'
import {
  button,
  card,
  checkboxGroup,
  closeModal,
  confirmDialog,
  empty,
  globListField,
  groupRow,
  kpis,
  notice,
  openModal,
  page,
  pageHead,
  pill,
  readOnlyNotice,
  selectField,
  skeletonKpis,
  table,
  textField,
  textareaField,
  toast,
  toastError,
  cellTitle,
} from '../lib/ui.js'
import { asArray, groupTasks, label, taskMetrics } from '../lib/aggregate.js'
import { money } from '../lib/format.js'

export const meta = {
  id: 'tasks',
  label: 'Tasks',
  group: 'Gerenciar',
  icon: 'checklist',
  needs: ['tasks', 'state'],
}

/**
 * Reserva do seletor "mudar estado", usada só enquanto `/api/tasks` não
 * respondeu — a lista boa é `states` na resposta, que sai de `taskStateLabel`
 * do core e é a mesma que o `uranus task list` imprime.
 *
 * Nada aqui é autoridade sobre transição: quem decide se o salto é legal é a
 * máquina de estados, e o 409 dela chega inteiro na tela.
 */
const FALLBACK_STATES = [
  { value: 'draft', label: 'Rascunho' },
  { value: 'ready', label: 'Na fila' },
  { value: 'claimed', label: 'Reservada' },
  { value: 'running', label: 'Executando' },
  { value: 'verifying', label: 'Verificando' },
  { value: 'verified', label: 'Verificada' },
  { value: 'failed', label: 'Falhou' },
  { value: 'integrating', label: 'Integrando' },
  { value: 'blocked', label: 'Bloqueada' },
  { value: 'done', label: 'Concluída' },
  { value: 'abandoned', label: 'Abandonada' },
]

/**
 * A LISTA de tipos vem do servidor (`kinds`, que é `TASK_KINDS` do core). Aqui
 * só mora a frase que explica cada um para quem nunca leu o código — o valor
 * gravado continua sendo o identificador cru, que é o que o CLI mostra.
 */
const KIND_HINTS = {
  feature: 'funcionalidade nova',
  bugfix: 'corrigir comportamento errado',
  refactor: 'mudar a forma sem mudar o efeito',
  test: 'cobrir com teste',
  docs: 'documentação',
  chore: 'manutenção que ninguém vê',
  security: 'fechar brecha',
  perf: 'deixar mais rápido',
  deps: 'atualizar dependência',
  infra: 'build, CI, ambiente',
  review: 'revisar código existente',
  investigation: 'descobrir a causa antes de mexer',
  migration: 'migrar dado ou esquema',
}

/**
 * Texto das caixas de seleção de check. As CHAVES são os `CheckKind` do core,
 * e a lista oferecida vem de `checkKinds` na resposta do servidor — se um kind
 * novo nascer lá, ele aparece aqui com o nome cru em vez de sumir.
 *
 * É o INV-2 numa caixa de seleção: sem nenhum check bloqueante, "pronto"
 * seria a opinião do modelo.
 */
const CHECK_COPY = {
  tests: { label: 'Rodar os testes', hint: 'A suíte do projeto precisa passar depois da mudança.' },
  diff: {
    label: 'Conferir o diff',
    hint: 'A mudança não pode ser vazia nem sair dos arquivos declarados acima.',
  },
  command: {
    label: 'Rodar os comandos do projeto',
    hint: 'Lint, build e checagem de tipos, como configurados no projeto.',
  },
  coverage: { label: 'Exigir cobertura', hint: 'A cobertura de teste não pode cair.' },
  artifact: { label: 'Exigir um arquivo', hint: 'Um arquivo específico precisa existir ao final.' },
  schema: { label: 'Validar o formato', hint: 'A resposta do modelo precisa vir no contrato combinado.' },
  plugin: { label: 'Check de plugin', hint: 'Verificação fornecida por um plugin instalado.' },
}

const DEFAULT_CHECKS = ['tests', 'diff']

function stateOptions(ctx) {
  const published = asArray(ctx.res('tasks').data?.states)
  return published.length > 0 ? published : FALLBACK_STATES
}

function kindOptions(ctx) {
  const kinds = asArray(ctx.res('tasks').data?.kinds)
  const list = kinds.length > 0 ? kinds : Object.keys(KIND_HINTS)
  return list.map((kind) => ({
    value: kind,
    label: kind,
    ...(KIND_HINTS[kind] === undefined ? {} : { hint: KIND_HINTS[kind] }),
  }))
}

function checkOptions(ctx) {
  const kinds = asArray(ctx.res('tasks').data?.checkKinds)
  const list = kinds.length > 0 ? kinds : Object.keys(CHECK_COPY)
  return list.map((kind) => ({
    value: kind,
    label: CHECK_COPY[kind]?.label ?? kind,
    ...(CHECK_COPY[kind]?.hint === undefined ? {} : { hint: CHECK_COPY[kind].hint }),
  }))
}

function tasksOf(ctx) {
  return asArray(ctx.res('tasks').data?.tasks)
}

/**
 * Custo e agente por task vivem no snapshot de telemetria, não no `TaskView`.
 * Cruzar por id preserva as colunas que a aba "Fila" do painel antigo tinha.
 */
function telemetryIndex(ctx) {
  const index = new Map()
  for (const task of asArray(ctx.snap().tasks)) index.set(task.id, task)
  return index
}

// ── escrita ──────────────────────────────────────────────────────────────────

function openCreate(ctx) {
  const title = textField({
    label: 'O que esta task faz',
    help: 'Uma frase no imperativo. Aparece na fila, no commit e no PR.',
    placeholder: 'Validar o CPF no cadastro',
  })
  const kind = selectField({
    label: 'Tipo',
    help: 'Muda o prompt do agente e as regras de qualidade aplicadas.',
    value: 'feature',
    options: kindOptions(ctx),
  })
  const intent = textareaField({
    label: 'Intenção',
    help:
      'Descreva o resultado esperado, não os passos. Isto NÃO é um prompt: o Uranus monta o\n' +
      'prompt a partir daqui, junto com o contexto do repositório.',
    rows: 7,
    placeholder:
      'O formulário aceita CPF inválido hoje. Deve recusar antes de enviar, com mensagem clara…',
  })
  const touches = globListField({
    label: 'Arquivos que a task pode tocar',
    help:
      'Padrões de caminho. É o que impede uma correção pequena de virar reforma no projeto\n' +
      'inteiro: o agente só escreve dentro deles, e a verificação reprova o que sair daí.',
  })
  const checks = checkboxGroup({
    label: 'Como saber que ficou pronto',
    help: 'Sucesso é provado por código, nunca por opinião do agente. Marque ao menos um.',
    options: checkOptions(ctx),
    selected: DEFAULT_CHECKS,
  })
  const errorBox = h('div', { class: 'field__error' })

  const submit = button({
    label: 'Criar task',
    variant: 'primary',
    iconName: 'plus',
    onClick: async () => {
      clear(errorBox)
      if (title.get() === '') {
        errorBox.textContent = 'O título é obrigatório.'
        return
      }
      if (intent.get() === '') {
        errorBox.textContent = 'Sem intenção, o agente não tem o que fazer. Escreva ao menos uma frase.'
        return
      }
      if (checks.get().length === 0) {
        errorBox.textContent =
          'Marque ao menos uma verificação: uma task sem check aprova qualquer coisa.'
        return
      }
      submit.disabled = true
      try {
        await api.post('/api/tasks', {
          kind: kind.get(),
          title: title.get(),
          intent: intent.get(),
          touches: touches.get(),
          checks: checks.get(),
        })
        toast('Task criada e enfileirada.', 'success')
        closeModal()
        await ctx.reload(['tasks', 'state'])
      } catch (error) {
        errorBox.textContent = error instanceof Error ? error.message : String(error)
        submit.disabled = false
      }
    },
  })

  openModal({
    title: 'Nova task',
    subtitle: 'Os mesmos campos do YAML, sem o YAML.',
    wide: true,
    body: h('div', { class: 'form' }, title.el, kind.el, intent.el, touches.el, checks.el, errorBox),
    footer: [button({ label: 'Cancelar', onClick: () => closeModal() }), submit],
  })
}

function openStateChange(ctx, task) {
  // O grupo entra como dica: "Abandonada" e "Concluída" caem as duas em
  // "Encerrada", e saber disso na hora de escolher evita a surpresa de a task
  // sumir da seção onde a pessoa estava olhando.
  const options = stateOptions(ctx)
    .filter((option) => option.value !== task.state)
    .map((option) => ({ ...option, hint: option.groupLabel }))
  const state = selectField({
    label: 'Novo estado',
    help:
      'Nem toda transição é permitida: a máquina de estados recusa saltos, e o servidor\n' +
      'responde com os destinos válidos a partir do estado atual.',
    options,
  })
  const reason = textField({
    label: 'Motivo (opcional)',
    help: 'Fica registrado no evento. Vale a pena quando você bloqueia ou abandona algo.',
    placeholder: 'Depende de decisão do time',
  })
  const errorBox = h('div', { class: 'field__error' })

  const submit = button({
    label: 'Mudar estado',
    variant: 'primary',
    onClick: async () => {
      clear(errorBox)
      submit.disabled = true
      try {
        const payload = { state: state.get() }
        if (reason.get() !== '') payload.reason = reason.get()
        await api.patch(apiPath('/api/tasks', task.id), payload)
        toast('Estado alterado.', 'success')
        closeModal()
        await ctx.reload(['tasks', 'state'])
      } catch (error) {
        errorBox.textContent = error instanceof Error ? error.message : String(error)
        submit.disabled = false
      }
    },
  })

  openModal({
    title: 'Mudar o estado da task',
    subtitle: `${task.title} · agora em ${label(task, 'stateLabel', 'state')}`,
    body: h('div', { class: 'form' }, state.el, reason.el, errorBox),
    footer: [button({ label: 'Cancelar', onClick: () => closeModal() }), submit],
  })
}

async function removeTask(ctx, task) {
  const yes = await confirmDialog({
    title: 'Apagar esta task?',
    description:
      `"${task.title}" sai da fila e não volta. Se ela já produziu commit, o commit continua ` +
      'no repositório — apagar a task não desfaz trabalho.',
    confirmLabel: 'Apagar task',
  })
  if (!yes) return
  try {
    await api.del(apiPath('/api/tasks', task.id))
    toast('Task apagada.', 'success')
    await ctx.reload(['tasks', 'state'])
  } catch (error) {
    toastError(error)
  }
}

function openDetail(ctx, task, extra) {
  const writable = ctx.writable('tasks')
  const body = h(
    'div',
    { class: 'stack' },
    h(
      'div',
      { class: 'btnrow' },
      pill(label(task, 'stateLabel', 'state'), task.tone),
      pill(task.kind ?? '—', 'neutral'),
      task.groupLabel ? pill(task.groupLabel, 'neutral') : null,
    ),
    task.intent ? h('p', { class: 'prose', text: task.intent }) : null,
    task.blockReason
      ? notice({
          tone: 'danger',
          title: `Bloqueada (${String(task.blockReason.kind ?? '—')})`,
          text:
            `${String(task.blockReason.message ?? '')}\n` +
            `Quem destrava: ${String(task.blockReason.resolvableBy ?? '—')}`,
        })
      : null,
    h(
      'dl',
      { class: 'deflist' },
      h('dt', { text: 'id' }),
      h('dd', { class: 'mono', text: task.id }),
      h('dt', { text: 'tentativas' }),
      h('dd', {
        text:
          `${String(task.attempts ?? 0)}/${String(task.maxAttempts ?? '—')}` +
          (task.repairAttempts ? ` · ${String(task.repairAttempts)} reparo(s) de validação` : ''),
      }),
      task.backlogItemId ? h('dt', { text: 'veio do item' }) : null,
      task.backlogItemId ? h('dd', { class: 'mono', text: task.backlogItemId }) : null,
      asArray(task.touches).length > 0 ? h('dt', { text: 'escopo' }) : null,
      asArray(task.touches).length > 0
        ? h('dd', { class: 'mono', text: asArray(task.touches).join('  ') })
        : null,
      extra?.agent ? h('dt', { text: 'agente' }) : null,
      extra?.agent ? h('dd', { text: extra.agent }) : null,
      extra?.costMicros ? h('dt', { text: 'custo' }) : null,
      extra?.costMicros ? h('dd', { text: money(extra.costMicros / 1e6) }) : null,
      h('dt', { text: 'atualizada' }),
      h('dd', { text: label(task, 'updatedLabel', 'updatedAt') }),
    ),
  )

  openModal({
    title: task.title,
    subtitle: `Task · ${label(task, 'stateLabel', 'state')}`,
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
              await removeTask(ctx, task)
            },
          }),
          button({
            label: 'Mudar estado',
            variant: 'primary',
            iconName: 'refresh',
            onClick: () => openStateChange(ctx, task),
          }),
        ]
      : [button({ label: 'Fechar', onClick: () => closeModal() })],
  })
}

// ── render ───────────────────────────────────────────────────────────────────

const COLUMNS = [
  { label: 'Task' },
  { label: 'Estado' },
  { label: 'Tipo' },
  { label: 'Tentativas', align: 'right' },
  { label: 'Custo', align: 'right' },
  { label: 'Atualizada' },
  { label: '', align: 'right' },
]

function taskRow(ctx, task, extra, writable) {
  return h(
    'tr',
    null,
    h(
      'td',
      null,
      cellTitle(
        task.title,
        task.blockReason?.message ?? (task.backlogItemId ? `item ${task.backlogItemId}` : task.id),
      ),
    ),
    h('td', null, pill(label(task, 'stateLabel', 'state'), task.tone)),
    h('td', { class: 'mono' }, task.kind ?? '—'),
    h('td', { class: 'right num' }, [
      `${String(task.attempts ?? 0)}/${String(task.maxAttempts ?? '—')}`,
      task.repairAttempts ? h('span', { class: 'dim', text: ` ↻${String(task.repairAttempts)}` }) : null,
    ]),
    h('td', { class: 'right num' }, extra?.costMicros ? money(extra.costMicros / 1e6) : '—'),
    h('td', { class: 'muted' }, label(task, 'updatedLabel', 'updatedAt')),
    h(
      'td',
      null,
      h(
        'div',
        { class: 'rowactions' },
        button({
          iconName: 'eye',
          variant: 'ghost',
          title: 'Ver detalhes',
          onClick: () => openDetail(ctx, task, extra),
        }),
        writable
          ? button({
              iconName: 'refresh',
              variant: 'ghost',
              title: 'Mudar estado',
              onClick: () => openStateChange(ctx, task),
            })
          : null,
        writable
          ? button({
              iconName: 'trash',
              variant: 'ghost',
              title: 'Apagar',
              onClick: () => removeTask(ctx, task),
            })
          : null,
      ),
    ),
  )
}

export function render(ctx) {
  const resource = ctx.res('tasks')
  const writable = ctx.writable('tasks')
  const tasks = tasksOf(ctx)
  const metrics = taskMetrics(tasks)
  const extras = telemetryIndex(ctx)

  if (resource.status === 'loading') {
    return page(
      pageHead({ title: 'Tasks' }),
      skeletonKpis(4),
      h('div', { class: 'skeleton', style: { height: '18rem' } }),
    )
  }

  const rows = []
  for (const bucket of groupTasks(tasks)) {
    rows.push(groupRow(COLUMNS.length, bucket.label, bucket.tasks.length))
    for (const task of bucket.tasks) {
      rows.push(taskRow(ctx, task, extras.get(task.id), writable))
    }
  }

  const body =
    tasks.length === 0
      ? empty({
          iconName: 'checklist',
          title: 'Nenhuma task na fila',
          description: writable
            ? 'Crie uma task direto aqui, ou descreva o problema no Backlog e deixe o Uranus ' +
              'planejar as tasks para você.'
            : 'A fila está vazia. Adicione um item no backlog e rode `uranus plan`.',
          action: writable
            ? button({ label: 'Nova task', variant: 'primary', iconName: 'plus', onClick: () => openCreate(ctx) })
            : undefined,
        })
      : table(COLUMNS, rows)

  return page(
    pageHead({
      title: 'Tasks',
      description: 'A fila de trabalho, agrupada pelo que ela pede de você.',
      actions: writable
        ? [button({ label: 'Nova task', variant: 'primary', iconName: 'plus', onClick: () => openCreate(ctx) })]
        : [],
    }),
    resource.status === 'unavailable' ? readOnlyNotice('criar, mover e apagar tasks') : null,
    resource.status === 'error'
      ? notice({ tone: 'danger', title: 'Falha ao ler as tasks', text: resource.error?.message })
      : null,
    kpis([
      {
        label: 'Precisam de você',
        value: metrics.attention,
        hint:
          metrics.blocked > 0
            ? `${String(metrics.blocked)} com motivo de bloqueio declarado`
            : 'Bloqueadas, falhadas ou esperando decisão.',
        tone: metrics.attention > 0 ? 'danger' : 'success',
        iconName: 'hand',
      },
      {
        label: 'Em andamento',
        value: metrics.working,
        hint: `${String(metrics.queued)} na fila atrás delas`,
        tone: 'info',
        iconName: 'cpu',
      },
      {
        label: 'Tentativas por task',
        value: metrics.total === 0 ? '—' : metrics.avgAttempts.toFixed(1),
        hint: 'Média. Acima de 2 costuma ser escopo mal declarado.',
        tone: metrics.avgAttempts > 2 ? 'warning' : 'neutral',
        iconName: 'refresh',
      },
      {
        label: 'Reparos de validação',
        value: metrics.repairs,
        hint: 'Correções dirigidas que não gastam tentativa.',
        tone: 'neutral',
        iconName: 'shield',
      },
    ]),
    card({ flush: tasks.length > 0, body }),
  )
}
