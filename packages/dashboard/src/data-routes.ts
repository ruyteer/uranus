import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Task, ValidationPolicyInput, ValidationRule, ValidationSeverity } from '@uranus/core'
import {
  MEMORY_SCOPES,
  TASK_KINDS,
  VALIDATION_RULES,
  isValidationRule,
  resolveValidationPolicy,
} from '@uranus/core'
import type { ConfigCategoryLike, DashboardData, StoredBacklogItemLike } from './data.js'
import { CHECK_KINDS } from './data.js'
import {
  errorMessage,
  methodNotAllowed,
  readJson,
  safeDecode,
  sendJson,
  statusForError,
} from './http.js'
import type { BacklogItemView } from './views.js'
import {
  BACKLOG_STATES,
  backlogItemView,
  backlogProgressView,
  taskStateOptions,
  taskView,
} from './views.js'

/**
 * As rotas de escrita e de CRUD do painel.
 *
 * Separadas do roteador principal porque são a metade do servidor que MUDA o
 * projeto — criar task, apagar item, gravar config. Ler o log de eventos e
 * escrever no backlog do usuário são responsabilidades de peso muito diferente,
 * e misturá-las no mesmo arquivo faz a revisão da segunda se perder no meio da
 * primeira.
 *
 * Toda rota aqui já passou pelo `authorize` do `DashboardServer` — o roteador
 * autentica antes de despachar, e não existe caminho que chegue nestes métodos
 * sem passar por lá.
 */
export class DataRoutes {
  constructor(
    private readonly data: DashboardData | undefined,
    private readonly now: () => number,
  ) {}

  /** `true` quando a rota pertence a esta família e já foi respondida. */
  async handle(
    method: string,
    path: string,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<boolean> {
    const family = FAMILIES.find((prefix) => path === prefix || path.startsWith(`${prefix}/`))
    if (family === undefined) return false

    const data = this.data
    if (data === undefined) {
      // 503 e não 404: a rota existe, o painel é que subiu sem a porta de
      // dados. A UI usa exatamente isto para esconder os controles de escrita
      // em vez de mostrar botões que não fazem nada.
      sendJson(response, 503, {
        error: 'este painel subiu somente-leitura: nenhuma fonte de dados conectada',
      })
      return true
    }

    switch (family) {
      case '/api/tasks':
        await this.tasks(data, method, path, request, response)
        return true
      case '/api/backlog':
        await this.backlog(data, method, path, request, response)
        return true
      case '/api/config':
        await this.config(data, method, path, request, response)
        return true
      case '/api/validations':
        await this.validations(data, method, path, request, response)
        return true
      case '/api/instructions':
        await this.instructions(data, method, path, request, response)
        return true
      case '/api/skills':
        await this.skills(data, method, path, response)
        return true
      case '/api/vault':
        await this.vault(data, method, response)
        return true
      case '/api/graphify':
        await this.graphify(data, method, response)
        return true
      case '/api/memory':
        await this.memory(data, method, path, request, response)
        return true
      case '/api/github':
        await this.github(data, method, path, request, response)
        return true
      default:
        return false
    }
  }

  // ── tasks ─────────────────────────────────────────────────────────────────

  private async tasks(
    data: DashboardData,
    method: string,
    path: string,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (path === '/api/tasks') {
      if (method === 'GET') {
        const tasks = await data.tasks.list()
        const now = this.now()
        sendJson(response, 200, {
          tasks: tasks.map((task) => taskView(task, now)),
          // Vocabulário junto com a lista: sem isto a tela precisaria repetir
          // os 13 `TaskKind` e os 11 rótulos de estado à mão, e ficaria para
          // trás na primeira vez que o core mudasse um deles.
          states: taskStateOptions(),
          kinds: TASK_KINDS,
          checkKinds: CHECK_KINDS,
        })
        return
      }
      if (method === 'POST') {
        await this.createTask(data, request, response)
        return
      }
      methodNotAllowed(response, ['GET', 'POST'])
      return
    }

    const id = resourceId(path, '/api/tasks/')
    if (id === undefined) {
      sendJson(response, 404, { error: 'id de task ausente ou inválido' })
      return
    }
    if (method === 'PATCH') {
      await this.patchTask(data, id, request, response)
      return
    }
    if (method === 'DELETE') {
      const removed = await data.tasks.remove(id)
      if (!removed.ok) {
        sendJson(response, statusForError(removed.error), { error: errorMessage(removed.error) })
        return
      }
      sendJson(response, 200, { ok: true })
      return
    }
    methodNotAllowed(response, ['PATCH', 'DELETE'])
  }

  private async createTask(
    data: DashboardData,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const body = await readJson(request)
    if (body === undefined) {
      sendJson(response, 400, { error: 'corpo JSON ausente, inválido ou grande demais' })
      return
    }
    const title = trimmedString(body['title'])
    const intent = trimmedString(body['intent'])
    const kind = trimmedString(body['kind'])
    const touches = stringList(body['touches'])
    const checks = stringList(body['checks'])

    if (title === undefined) {
      sendJson(response, 400, { error: 'título é obrigatório' })
      return
    }
    if (intent === undefined) {
      sendJson(response, 400, { error: 'intenção é obrigatória: descreva o que a task deve fazer' })
      return
    }
    if (kind === undefined || !(TASK_KINDS as readonly string[]).includes(kind)) {
      sendJson(response, 400, { error: `tipo inválido; use um de: ${TASK_KINDS.join(', ')}` })
      return
    }
    if (touches === undefined || checks === undefined) {
      sendJson(response, 400, { error: 'touches e checks devem ser listas de texto' })
      return
    }
    const desconhecido = checks.find((check) => !CHECK_KINDS.includes(check))
    if (desconhecido !== undefined) {
      sendJson(response, 400, {
        error: `check desconhecido "${desconhecido}"; use um de: ${CHECK_KINDS.join(', ')}`,
      })
      return
    }

    const created = await data.tasks.create({ kind, title, intent, touches, checks })
    if (!created.ok) {
      sendJson(response, statusForError(created.error), { error: errorMessage(created.error) })
      return
    }
    sendJson(response, 201, { task: taskView(created.value, this.now()) })
  }

  private async patchTask(
    data: DashboardData,
    id: string,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const body = await readJson(request)
    const state = body === undefined ? undefined : trimmedString(body['state'])
    if (state === undefined) {
      sendJson(response, 400, { error: 'state é obrigatório' })
      return
    }
    const reason = body === undefined ? undefined : trimmedString(body['reason'])
    // A legalidade da transição é decidida do outro lado da porta, pela máquina
    // de estados: erro de conflito vira 409 e a mensagem dela — que já lista os
    // destinos válidos — chega inteira na tela.
    const moved = await data.tasks.setState(id, state, reason)
    if (!moved.ok) {
      sendJson(response, statusForError(moved.error), { error: errorMessage(moved.error) })
      return
    }
    sendJson(response, 200, { task: taskView(moved.value, this.now()) })
  }

  // ── backlog ───────────────────────────────────────────────────────────────

  private async backlog(
    data: DashboardData,
    method: string,
    path: string,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (path === '/api/backlog') {
      if (method === 'GET') {
        await this.listBacklog(data, response)
        return
      }
      if (method === 'POST') {
        await this.createBacklogItem(data, request, response)
        return
      }
      methodNotAllowed(response, ['GET', 'POST'])
      return
    }

    const id = resourceId(path, '/api/backlog/')
    if (id === undefined) {
      sendJson(response, 404, { error: 'id de item ausente ou inválido' })
      return
    }
    if (method === 'PATCH') {
      await this.patchBacklogItem(data, id, request, response)
      return
    }
    if (method === 'DELETE') {
      const removed = await data.backlog.remove(id)
      if (!removed.ok) {
        sendJson(response, statusForError(removed.error), { error: errorMessage(removed.error) })
        return
      }
      sendJson(response, 200, { ok: true })
      return
    }
    methodNotAllowed(response, ['PATCH', 'DELETE'])
  }

  private async listBacklog(data: DashboardData, response: ServerResponse): Promise<void> {
    const [items, tasks] = await Promise.all([data.backlog.list(), data.tasks.list()])
    sendJson(response, 200, { items: this.itemViews(items, tasks) })
  }

  private itemViews(
    items: readonly StoredBacklogItemLike[],
    tasks: readonly Task[],
  ): readonly BacklogItemView[] {
    const now = this.now()
    return items.map((item) => backlogItemView(item, backlogProgressView(tasks, item), now))
  }

  private async createBacklogItem(
    data: DashboardData,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const body = await readJson(request)
    if (body === undefined) {
      sendJson(response, 400, { error: 'corpo JSON ausente, inválido ou grande demais' })
      return
    }
    const title = trimmedString(body['title'])
    if (title === undefined) {
      sendJson(response, 400, { error: 'título é obrigatório' })
      return
    }
    const priority = body['priority']
    if (priority !== undefined && !isPriority(priority)) {
      sendJson(response, 400, { error: 'priority deve ser um inteiro entre 0 e 100' })
      return
    }
    const labels = body['labels'] === undefined ? undefined : stringList(body['labels'])
    if (body['labels'] !== undefined && labels === undefined) {
      sendJson(response, 400, { error: 'labels deve ser uma lista de texto' })
      return
    }

    const created = await data.backlog.create({
      title,
      body: typeof body['body'] === 'string' ? body['body'] : '',
      ...(isPriority(priority) ? { priority } : {}),
      ...(labels === undefined ? {} : { labels: [...labels] }),
    })
    if (!created.ok) {
      sendJson(response, statusForError(created.error), { error: errorMessage(created.error) })
      return
    }
    const tasks = await data.tasks.list()
    sendJson(response, 201, {
      item: backlogItemView(created.value, backlogProgressView(tasks, created.value), this.now()),
    })
  }

  private async patchBacklogItem(
    data: DashboardData,
    id: string,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const body = await readJson(request)
    if (body === undefined) {
      sendJson(response, 400, { error: 'corpo JSON ausente, inválido ou grande demais' })
      return
    }
    const patch: Record<string, unknown> = {}
    const invalido = collectBacklogPatch(body, patch)
    if (invalido !== undefined) {
      sendJson(response, 400, { error: invalido })
      return
    }
    if (Object.keys(patch).length === 0) {
      sendJson(response, 400, {
        error: 'nada para atualizar; informe title, body, priority, labels ou state',
      })
      return
    }

    const updated = await data.backlog.update(id, patch)
    if (!updated.ok) {
      sendJson(response, statusForError(updated.error), { error: errorMessage(updated.error) })
      return
    }
    const tasks = await data.tasks.list()
    sendJson(response, 200, {
      item: backlogItemView(updated.value, backlogProgressView(tasks, updated.value), this.now()),
    })
  }

  // ── config ────────────────────────────────────────────────────────────────

  private async config(
    data: DashboardData,
    method: string,
    path: string,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (path !== '/api/config') {
      sendJson(response, 404, { error: 'rota desconhecida' })
      return
    }
    if (method === 'GET') {
      const effective = await data.config.effective()
      sendJson(response, 200, {
        categories: data.config.categories().map(categoryView),
        values: effective.values,
        origins: effective.origins,
      })
      return
    }
    if (method !== 'PATCH') {
      methodNotAllowed(response, ['GET', 'PATCH'])
      return
    }

    const body = await readJson(request)
    if (body === undefined) {
      sendJson(response, 400, { error: 'corpo JSON ausente, inválido ou grande demais' })
      return
    }
    const configPath = trimmedString(body['path'])
    if (configPath === undefined || !isSafeConfigPath(configPath)) {
      sendJson(response, 400, { error: 'path inválido; use algo como budget.perRun.usd' })
      return
    }
    if (!Object.hasOwn(body, 'value')) {
      sendJson(response, 400, { error: 'value é obrigatório' })
      return
    }
    await this.writeConfig(data, configPath, body['value'], response)
  }

  private async writeConfig(
    data: DashboardData,
    path: string,
    value: unknown,
    response: ServerResponse,
  ): Promise<void> {
    const written = await data.config.set(path, value)
    if (!written.ok) {
      sendJson(response, statusForError(written.error), { error: errorMessage(written.error) })
      return
    }
    sendJson(response, 200, { ok: true, value })
  }

  // ── validações ────────────────────────────────────────────────────────────

  private async validations(
    data: DashboardData,
    method: string,
    path: string,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (path !== '/api/validations') {
      sendJson(response, 404, { error: 'rota desconhecida' })
      return
    }
    if (method === 'GET') {
      const effective = await data.config.effective()
      sendJson(response, 200, validationsView(effective.values))
      return
    }
    if (method !== 'PATCH') {
      methodNotAllowed(response, ['GET', 'PATCH'])
      return
    }

    const body = await readJson(request)
    if (body === undefined) {
      sendJson(response, 400, { error: 'corpo JSON ausente, inválido ou grande demais' })
      return
    }
    const write = validationWrite(body)
    if (typeof write === 'string') {
      sendJson(response, 400, { error: write })
      return
    }
    await this.writeConfig(data, write.path, write.value, response)
  }

  // ── instruções ────────────────────────────────────────────────────────────

  private async instructions(
    data: DashboardData,
    method: string,
    path: string,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const port = data.instructions
    if (port === undefined) {
      sendJson(response, 503, { error: 'este projeto ainda não suporta instruções pelo painel' })
      return
    }

    if (path === '/api/instructions') {
      if (method === 'GET') {
        sendJson(response, 200, { notes: await port.list() })
        return
      }
      if (method === 'POST') {
        await this.createInstruction(port, request, response)
        return
      }
      methodNotAllowed(response, ['GET', 'POST'])
      return
    }

    const id = resourceId(path, '/api/instructions/')
    if (id === undefined) {
      sendJson(response, 404, { error: 'id de instrução ausente ou inválido' })
      return
    }
    if (method === 'PATCH') {
      await this.patchInstruction(port, id, request, response)
      return
    }
    if (method === 'DELETE') {
      const removed = await port.remove(id)
      if (!removed.ok) {
        sendJson(response, statusForError(removed.error), { error: errorMessage(removed.error) })
        return
      }
      sendJson(response, 200, { ok: true })
      return
    }
    methodNotAllowed(response, ['PATCH', 'DELETE'])
  }

  private async createInstruction(
    port: NonNullable<DashboardData['instructions']>,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const body = await readJson(request)
    if (body === undefined) {
      sendJson(response, 400, { error: 'corpo JSON ausente, inválido ou grande demais' })
      return
    }
    const title = trimmedString(body['title'])
    if (title === undefined) {
      sendJson(response, 400, { error: 'título é obrigatório' })
      return
    }
    const scope = trimmedString(body['scope'])
    const created = await port.create({
      title,
      body: typeof body['body'] === 'string' ? body['body'] : '',
      ...(scope === undefined ? {} : { scope }),
    })
    if (!created.ok) {
      sendJson(response, statusForError(created.error), { error: errorMessage(created.error) })
      return
    }
    sendJson(response, 201, { note: created.value })
  }

  private async patchInstruction(
    port: NonNullable<DashboardData['instructions']>,
    id: string,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const body = await readJson(request)
    if (body === undefined) {
      sendJson(response, 400, { error: 'corpo JSON ausente, inválido ou grande demais' })
      return
    }
    const patch: { title?: string; body?: string; scope?: string | null } = {}
    if (Object.hasOwn(body, 'title')) {
      const title = trimmedString(body['title'])
      if (title === undefined) {
        sendJson(response, 400, { error: 'title não pode ficar vazio' })
        return
      }
      patch.title = title
    }
    if (Object.hasOwn(body, 'body')) {
      if (typeof body['body'] !== 'string') {
        sendJson(response, 400, { error: 'body deve ser texto' })
        return
      }
      patch.body = body['body']
    }
    if (Object.hasOwn(body, 'scope')) {
      // String vazia e `null` significam a mesma coisa aqui: limpar o escopo.
      patch.scope = trimmedString(body['scope']) ?? null
    }
    if (Object.keys(patch).length === 0) {
      sendJson(response, 400, { error: 'nada para atualizar; informe title, body ou scope' })
      return
    }
    const updated = await port.update(id, patch)
    if (!updated.ok) {
      sendJson(response, statusForError(updated.error), { error: errorMessage(updated.error) })
      return
    }
    sendJson(response, 200, { note: updated.value })
  }

  // ── skills ────────────────────────────────────────────────────────────────

  private async skills(
    data: DashboardData,
    method: string,
    path: string,
    response: ServerResponse,
  ): Promise<void> {
    const port = data.skills
    if (port === undefined) {
      sendJson(response, 503, { error: 'este projeto ainda não suporta o marketplace de skills' })
      return
    }

    if (path === '/api/skills') {
      if (method !== 'GET') {
        methodNotAllowed(response, ['GET'])
        return
      }
      sendJson(response, 200, { skills: await port.list() })
      return
    }

    const match = /^\/api\/skills\/([^/]+)\/install$/.exec(path)
    if (match === null) {
      sendJson(response, 404, { error: 'rota desconhecida' })
      return
    }
    if (method !== 'POST') {
      methodNotAllowed(response, ['POST'])
      return
    }
    const id = safeDecode(match[1] ?? '')
    if (id === undefined) {
      sendJson(response, 400, { error: 'id de skill inválido' })
      return
    }
    const installed = await port.install(id)
    if (!installed.ok) {
      sendJson(response, statusForError(installed.error), { error: errorMessage(installed.error) })
      return
    }
    sendJson(response, 200, { ok: true })
  }

  // ── vault ─────────────────────────────────────────────────────────────────

  private async vault(data: DashboardData, method: string, response: ServerResponse): Promise<void> {
    const port = data.vault
    if (port === undefined) {
      sendJson(response, 503, { error: 'este projeto ainda não suporta o vault pelo painel' })
      return
    }
    if (method !== 'GET') {
      methodNotAllowed(response, ['GET'])
      return
    }
    sendJson(response, 200, await port.graph())
  }

  // ── grafo (graphify) ─────────────────────────────────────────────────────

  private async graphify(data: DashboardData, method: string, response: ServerResponse): Promise<void> {
    const port = data.graphify
    if (port === undefined) {
      sendJson(response, 503, { error: 'este projeto ainda não suporta o grafo pelo painel' })
      return
    }
    if (method !== 'GET') {
      methodNotAllowed(response, ['GET'])
      return
    }
    sendJson(response, 200, await port.graph())
  }

  // ── memória ───────────────────────────────────────────────────────────────

  private async memory(
    data: DashboardData,
    method: string,
    path: string,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const port = data.memory
    if (port === undefined) {
      sendJson(response, 503, { error: 'este projeto ainda não suporta memória pelo painel' })
      return
    }
    if (path !== '/api/memory') {
      sendJson(response, 404, { error: 'rota desconhecida' })
      return
    }
    if (method === 'GET') {
      // `scopes` junto com a lista, mesmo motivo de `states`/`kinds` em
      // `/api/tasks`: sem isto o formulário de criação teria que repetir os
      // dez `MemoryScope` à mão e ficaria para trás na primeira mudança lá.
      sendJson(response, 200, { records: await port.list(), scopes: MEMORY_SCOPES })
      return
    }
    if (method === 'POST') {
      await this.createMemory(port, request, response)
      return
    }
    methodNotAllowed(response, ['GET', 'POST'])
  }

  private async createMemory(
    port: NonNullable<DashboardData['memory']>,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const body = await readJson(request)
    if (body === undefined) {
      sendJson(response, 400, { error: 'corpo JSON ausente, inválido ou grande demais' })
      return
    }
    const scope = trimmedString(body['scope'])
    if (scope === undefined || !(MEMORY_SCOPES as readonly string[]).includes(scope)) {
      sendJson(response, 400, { error: `escopo inválido; use um de: ${MEMORY_SCOPES.join(', ')}` })
      return
    }
    const title = trimmedString(body['title'])
    if (title === undefined) {
      sendJson(response, 400, { error: 'título é obrigatório' })
      return
    }
    const tags = body['tags'] === undefined ? undefined : stringList(body['tags'])
    if (body['tags'] !== undefined && tags === undefined) {
      sendJson(response, 400, { error: 'tags deve ser uma lista de texto' })
      return
    }
    const confidence = body['confidence']
    if (confidence !== undefined && !isConfidence(confidence)) {
      sendJson(response, 400, { error: 'confidence deve ser um número entre 0 e 1' })
      return
    }

    const created = await port.create({
      scope,
      title,
      body: typeof body['body'] === 'string' ? body['body'] : '',
      ...(tags === undefined ? {} : { tags: [...tags] }),
      ...(isConfidence(confidence) ? { confidence } : {}),
    })
    if (!created.ok) {
      sendJson(response, statusForError(created.error), { error: errorMessage(created.error) })
      return
    }
    sendJson(response, 201, { record: created.value })
  }

  // ── github ────────────────────────────────────────────────────────────────

  private async github(
    data: DashboardData,
    method: string,
    path: string,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const port = data.github
    if (port === undefined) {
      sendJson(response, 503, { error: 'este projeto ainda não suporta GitHub pelo painel' })
      return
    }

    if (path === '/api/github') {
      if (method !== 'GET') {
        methodNotAllowed(response, ['GET'])
        return
      }
      const overview = await port.overview()
      if (!overview.ok) {
        sendJson(response, statusForError(overview.error), { error: errorMessage(overview.error) })
        return
      }
      sendJson(response, 200, overview.value)
      return
    }

    const match = /^\/api\/github\/pulls\/([^/]+)\/(\d+)\/(review|merge|close)$/.exec(path)
    if (match === null) {
      sendJson(response, 404, { error: 'rota desconhecida' })
      return
    }
    if (method !== 'POST') {
      methodNotAllowed(response, ['POST'])
      return
    }
    const repo = safeDecode(match[1] ?? '')
    const number = Number.parseInt(match[2] ?? '', 10)
    const action = match[3]
    if (repo === undefined) {
      sendJson(response, 400, { error: 'repositório inválido' })
      return
    }
    if (action === 'review') {
      await this.reviewPullRequest(port, repo, number, request, response)
    } else if (action === 'merge') {
      await this.mergePullRequest(port, repo, number, request, response)
    } else {
      const closed = await port.closePullRequest(repo, number)
      if (!closed.ok) {
        sendJson(response, statusForError(closed.error), { error: errorMessage(closed.error) })
        return
      }
      sendJson(response, 200, { ok: true })
    }
  }

  private async reviewPullRequest(
    port: NonNullable<DashboardData['github']>,
    repo: string,
    number: number,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const body = await readJson(request)
    const action = body === undefined ? undefined : trimmedString(body['action'])
    if (
      action === undefined ||
      !(['approve', 'request-changes', 'comment'] as readonly string[]).includes(action)
    ) {
      sendJson(response, 400, { error: 'action deve ser approve, request-changes ou comment' })
      return
    }
    const reviewBody = body === undefined ? undefined : trimmedString(body['body'])
    const reviewed = await port.reviewPullRequest(
      repo,
      number,
      action as 'approve' | 'request-changes' | 'comment',
      reviewBody,
    )
    if (!reviewed.ok) {
      sendJson(response, statusForError(reviewed.error), { error: errorMessage(reviewed.error) })
      return
    }
    sendJson(response, 200, { ok: true })
  }

  private async mergePullRequest(
    port: NonNullable<DashboardData['github']>,
    repo: string,
    number: number,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const body = await readJson(request)
    const method = body === undefined ? undefined : trimmedString(body['method'])
    const chosen = method === undefined || !(['merge', 'squash', 'rebase'] as readonly string[]).includes(method)
      ? 'merge'
      : (method as 'merge' | 'squash' | 'rebase')
    const merged = await port.mergePullRequest(repo, number, chosen)
    if (!merged.ok) {
      sendJson(response, statusForError(merged.error), { error: errorMessage(merged.error) })
      return
    }
    sendJson(response, 200, { ok: true })
  }
}

// ── vocabulário de validações ───────────────────────────────────────────────

/**
 * Rótulos iguais aos de `VALIDATION_SEVERITY_LABEL` e `VALIDATION_ORIGIN_LABEL`
 * do CLI. Repetidos aqui pelo mesmo motivo dos rótulos de backlog: o grafo de
 * dependências não deixa a dashboard importar de `@uranus/cli`. As duas telas
 * precisam dizer a mesma coisa, então as duas listas mudam juntas.
 */
const SEVERITY_LABELS: Readonly<Record<ValidationSeverity, string>> = Object.freeze({
  off: 'não verifica',
  advisory: 'avisa, não reprova',
  blocking: 'reprova a verificação',
})

const VALIDATION_SEVERITIES: readonly ValidationSeverity[] = Object.freeze([
  'off',
  'advisory',
  'blocking',
])

type RuleOrigin = 'default' | 'config' | 'global-off'

const ORIGIN_LABELS: Readonly<Record<RuleOrigin, string>> = Object.freeze({
  default: 'default do Uranus',
  config: 'validations.rules',
  'global-off': 'validations.enabled: false',
})

function isSeverity(value: unknown): value is ValidationSeverity {
  return typeof value === 'string' && (VALIDATION_SEVERITIES as readonly string[]).includes(value)
}

/**
 * A seção `validations` **como veio do arquivo** — é o único jeito de
 * distinguir "blocking porque o projeto pediu" de "blocking porque é o
 * default": depois de `resolveValidationPolicy` as duas são a mesma string.
 */
function validationInput(values: Record<string, unknown>): ValidationPolicyInput {
  const rules: Partial<Record<ValidationRule, ValidationSeverity>> = {}
  for (const rule of VALIDATION_RULES) {
    const raw = values[`validations.rules.${rule}`]
    if (isSeverity(raw)) rules[rule] = raw
  }
  const enabled = values['validations.enabled']
  const count = values['validations.countTowardAttempts']
  const max = values['validations.maxRepairAttempts']
  return {
    rules,
    ...(typeof enabled === 'boolean' ? { enabled } : {}),
    ...(typeof count === 'boolean' ? { countTowardAttempts: count } : {}),
    ...(typeof max === 'number' ? { maxRepairAttempts: max } : {}),
  }
}

function validationsView(values: Record<string, unknown>): Record<string, unknown> {
  const input = validationInput(values)
  const policy = resolveValidationPolicy(input)
  return {
    enabled: policy.enabled,
    countTowardAttempts: policy.countTowardAttempts,
    maxRepairAttempts: policy.maxRepairAttempts,
    rules: VALIDATION_RULES.map((rule) => {
      // Com `validations.enabled: false` nenhuma regra roda, e mostrar a
      // severidade gravada faria a tela prometer uma verificação que não
      // acontece. `severityOf` já resolve isso; a origem explica o porquê.
      const severity = policy.enabled ? policy.rules[rule] : 'off'
      const origin: RuleOrigin = !policy.enabled
        ? 'global-off'
        : input.rules?.[rule] === undefined
          ? 'default'
          : 'config'
      return {
        rule,
        severity,
        severityLabel: SEVERITY_LABELS[severity],
        origin,
        originLabel: ORIGIN_LABELS[origin],
      }
    }),
    severities: VALIDATION_SEVERITIES.map((value) => ({ value, label: SEVERITY_LABELS[value] })),
  }
}

/** Corpo do PATCH → uma escrita de config, ou a mensagem do 400. */
function validationWrite(body: Record<string, unknown>): { path: string; value: unknown } | string {
  if (Object.hasOwn(body, 'rule') || Object.hasOwn(body, 'severity')) {
    const rule = trimmedString(body['rule'])
    if (rule === undefined || !isValidationRule(rule)) {
      return `regra desconhecida; use uma de: ${VALIDATION_RULES.join(', ')}`
    }
    const severity = body['severity']
    if (!isSeverity(severity)) {
      return `severidade inválida; use uma de: ${VALIDATION_SEVERITIES.join(', ')}`
    }
    return { path: `validations.rules.${rule}`, value: severity }
  }
  if (Object.hasOwn(body, 'maxRepairAttempts')) {
    const max = body['maxRepairAttempts']
    if (typeof max !== 'number' || !Number.isInteger(max) || max < 0 || max > 20) {
      return 'maxRepairAttempts deve ser um inteiro entre 0 e 20'
    }
    return { path: 'validations.maxRepairAttempts', value: max }
  }
  if (Object.hasOwn(body, 'enabled')) {
    const enabled = body['enabled']
    if (typeof enabled !== 'boolean') return 'enabled deve ser true ou false'
    return { path: 'validations.enabled', value: enabled }
  }
  if (Object.hasOwn(body, 'countTowardAttempts')) {
    const count = body['countTowardAttempts']
    if (typeof count !== 'boolean') return 'countTowardAttempts deve ser true ou false'
    return { path: 'validations.countTowardAttempts', value: count }
  }
  return 'informe { rule, severity } ou { maxRepairAttempts }'
}

// ── auxiliares ──────────────────────────────────────────────────────────────

const FAMILIES: readonly string[] = Object.freeze([
  '/api/tasks',
  '/api/backlog',
  '/api/config',
  '/api/validations',
  '/api/instructions',
  '/api/skills',
  '/api/vault',
  '/api/graphify',
  '/api/memory',
  '/api/github',
])

/**
 * Serializa a categoria explicitamente.
 *
 * `ConfigCategory` do CLI carrega funções (`suggest`, `decode`, `writes`) que o
 * `JSON.stringify` descartaria em silêncio. Mapear campo a campo faz a resposta
 * ser exatamente o contrato, e não "o contrato mais o que sobrou".
 */
function categoryView(category: ConfigCategoryLike): Record<string, unknown> {
  return {
    id: category.id,
    title: category.title,
    blurb: category.blurb,
    questions: category.questions.map((question) => ({
      path: question.path,
      label: question.label,
      help: question.help,
      kind: question.kind,
      ...(question.options === undefined
        ? {}
        : {
            options: question.options.map((option) => ({
              value: option.value,
              label: option.label,
              ...(option.hint === undefined ? {} : { hint: option.hint }),
            })),
          }),
      ...(question.min === undefined ? {} : { min: question.min }),
      ...(question.max === undefined ? {} : { max: question.max }),
    })),
  }
}

/**
 * Id na URL: um segmento, não vazio, decodificável.
 *
 * Barra no meio é recusada em vez de aceita: `/api/tasks/a/b` não é um id com
 * barra, é uma rota que não existe, e tratar as duas como a mesma coisa é como
 * um traversal começa.
 */
function resourceId(path: string, prefix: string): string | undefined {
  const raw = path.slice(prefix.length)
  if (raw === '' || raw.includes('/')) return undefined
  const decoded = safeDecode(raw)
  if (decoded === undefined || decoded.trim() === '' || decoded.includes('\0')) return undefined
  return decoded
}

function trimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function stringList(value: unknown): readonly string[] | undefined {
  if (value === undefined) return []
  if (!Array.isArray(value)) return undefined
  const out: string[] = []
  for (const item of value as readonly unknown[]) {
    if (typeof item !== 'string') return undefined
    const trimmed = item.trim()
    if (trimmed !== '') out.push(trimmed)
  }
  return out
}

function isPriority(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100
}

function isConfidence(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

/** Preenche `patch` com as chaves conhecidas; devolve a mensagem do 400, se houver. */
function collectBacklogPatch(
  body: Record<string, unknown>,
  patch: Record<string, unknown>,
): string | undefined {
  if (Object.hasOwn(body, 'title')) {
    const title = trimmedString(body['title'])
    if (title === undefined) return 'title não pode ficar vazio'
    patch['title'] = title
  }
  if (Object.hasOwn(body, 'body')) {
    if (typeof body['body'] !== 'string') return 'body deve ser texto'
    patch['body'] = body['body']
  }
  if (Object.hasOwn(body, 'priority')) {
    if (!isPriority(body['priority'])) return 'priority deve ser um inteiro entre 0 e 100'
    patch['priority'] = body['priority']
  }
  if (Object.hasOwn(body, 'labels')) {
    const labels = stringList(body['labels'])
    if (labels === undefined) return 'labels deve ser uma lista de texto'
    patch['labels'] = [...labels]
  }
  if (Object.hasOwn(body, 'state')) {
    const state = trimmedString(body['state'])
    if (state === undefined || !BACKLOG_STATES.includes(state)) {
      return `state inválido; use um de: ${BACKLOG_STATES.join(', ')}`
    }
    patch['state'] = state
  }
  return undefined
}

/**
 * Caminho de config aceitável.
 *
 * A validação semântica (o campo existe? o valor cabe no schema?) é do
 * `config.set`, que tem o schema em mãos — repeti-la aqui criaria duas versões
 * da mesma regra. O que esta função impede é o que o schema NÃO veria: um
 * caminho com `__proto__` no meio, que num `set` implementado por navegação de
 * objeto envenenaria o protótipo antes de qualquer validação rodar.
 */
const CONFIG_SEGMENT = /^[A-Za-z0-9_-]+$/
const POLLUTING = new Set(['__proto__', 'prototype', 'constructor'])

function isSafeConfigPath(path: string): boolean {
  const segments = path.split('.')
  if (segments.length === 0 || segments.length > 8) return false
  return segments.every((segment) => CONFIG_SEGMENT.test(segment) && !POLLUTING.has(segment))
}
