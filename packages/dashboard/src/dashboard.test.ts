import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import type {
  ApprovalRequest,
  BlockReason,
  EventBus,
  HumanGate,
  Result,
  Task,
  TaskState,
} from '@uranus/core'
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  canTransition,
  err,
  globalSecrets,
  newApprovalId,
  newProjectId,
  newSessionId,
  newTaskId,
  ok,
  systemClock,
  usd,
} from '@uranus/core'
import { InProcessEventBus, JsonlEventStore } from '@uranus/events'
import { RecordingLogger, withTempDir } from '@uranus/testkit'
import {
  DefaultCostAccountant,
  DefaultTelemetry,
  TelemetryAggregator,
  attachCostAccounting,
  createPricingTable,
} from '@uranus/telemetry'
import type {
  ConfigCategoryLike,
  DashboardData,
  GraphifyGraphLike,
  InstructionNoteLike,
  MemoryRecordLike,
  NewMemoryInput,
  NewTaskInput,
  SkillCatalogEntryLike,
  StoredBacklogItemLike,
  VaultGraphLike,
} from './data.js'
import { DashboardServer, uiPath } from './server.js'
import { publicDir, resolvePublicPath } from './static-files.js'
import { SseHub } from './sse.js'

const USAGE = { input: 1_000, output: 100, cacheRead: 0, cacheWrite: 0, reasoning: 0 }

interface Harness {
  readonly url: string
  readonly events: EventBus
  readonly gate: FakeHumanGate
  readonly aggregator: TelemetryAggregator
  // Propriedades e não métodos: desestruturar `{ get, post }` de um objeto com
  // métodos desprenderia o `this`.
  readonly get: (path: string, token?: string) => Promise<Response>
  readonly post: (path: string, body: unknown, token?: string) => Promise<Response>
  readonly send: (method: string, path: string, body?: unknown, token?: string) => Promise<Response>
}

/** `HumanGate` de teste: `request` resolve quando a UI decide. */
class FakeHumanGate implements HumanGate {
  private readonly waiting = new Map<string, (decision: never) => void>()
  private readonly requests = new Map<string, ApprovalRequest>()

  request(approval: ApprovalRequest): Promise<never> {
    this.requests.set(approval.id, approval)
    return new Promise((resolve) => {
      this.waiting.set(approval.id, resolve)
    })
  }

  pending(): Promise<readonly ApprovalRequest[]> {
    return Promise.resolve([...this.requests.values()])
  }

  resolve(id: string, decision: never): Promise<{ ok: true; value: undefined }> {
    const waiter = this.waiting.get(id)
    if (waiter === undefined) {
      return Promise.resolve({
        ok: false,
        error: new Error('Aprovação não está pendente'),
      } as never)
    }
    this.waiting.delete(id)
    this.requests.delete(id)
    waiter(decision)
    return Promise.resolve({ ok: true, value: undefined })
  }
}

/**
 * Porta de dados de teste, em memória.
 *
 * Reproduz o que importa do lado real: a máquina de estados decide se a
 * transição é legal (`canTransition`), e o que não existe devolve
 * `NotFoundError`. Sem isso os testes de 404/409 provariam só que este arquivo
 * concorda com ele mesmo.
 */
class FakeData implements DashboardData {
  readonly taskList: Task[] = []
  readonly itemList: StoredBacklogItemLike[] = []
  readonly values: Record<string, unknown> = { 'validations.rules.tests': 'advisory' }
  readonly writes: { path: string; value: unknown }[] = []

  readonly tasks = {
    list: (): Promise<readonly Task[]> => Promise.resolve([...this.taskList]),
    create: (input: NewTaskInput): Promise<Result<Task>> => {
      const now = 1_000
      const task = makeTask({
        title: input.title,
        intent: input.intent,
        touches: [...input.touches],
        state: 'ready',
        updatedAt: now,
      })
      this.taskList.push(task)
      return Promise.resolve(ok(task))
    },
    setState: (id: string, state: string, reason?: string): Promise<Result<Task>> => {
      const index = this.taskList.findIndex((task) => task.id === id)
      const current = this.taskList[index]
      if (current === undefined) {
        return Promise.resolve(err(new NotFoundError(`Task ${id} não existe.`)))
      }
      if (!canTransition(current.state, state as TaskState)) {
        return Promise.resolve(
          err(new ConflictError(`Transição ilegal: ${current.state} → ${state}.`)),
        )
      }
      const blockReason: BlockReason = {
        kind: 'human',
        message: reason ?? '',
        resolvableBy: 'human',
      }
      const moved: Task = {
        ...current,
        state: state as TaskState,
        ...(reason === undefined ? {} : { blockReason }),
      }
      this.taskList[index] = moved
      return Promise.resolve(ok(moved))
    },
    remove: (id: string): Promise<Result<void>> => {
      const index = this.taskList.findIndex((task) => task.id === id)
      if (index < 0) return Promise.resolve(err(new NotFoundError(`Task ${id} não existe.`)))
      this.taskList.splice(index, 1)
      return Promise.resolve(ok())
    },
  }

  readonly backlog = {
    list: (): Promise<readonly StoredBacklogItemLike[]> => Promise.resolve([...this.itemList]),
    create: (input: {
      title: string
      body: string
      priority?: number
      labels?: string[]
    }): Promise<Result<StoredBacklogItemLike>> => {
      const item: StoredBacklogItemLike = {
        id: `item-${this.itemList.length + 1}`,
        title: input.title,
        body: input.body,
        labels: input.labels ?? [],
        priority: input.priority ?? 50,
        source: 'manual',
        state: 'open',
        createdAt: 1_000,
      }
      this.itemList.push(item)
      return Promise.resolve(ok(item))
    },
    update: (
      id: string,
      patch: Record<string, unknown>,
    ): Promise<Result<StoredBacklogItemLike>> => {
      const index = this.itemList.findIndex((item) => item.id === id)
      const current = this.itemList[index]
      if (current === undefined) {
        return Promise.resolve(err(new NotFoundError(`Item ${id} não existe.`)))
      }
      const updated: StoredBacklogItemLike = { ...current, ...patch }
      this.itemList[index] = updated
      return Promise.resolve(ok(updated))
    },
    remove: (id: string): Promise<Result<void>> => {
      const index = this.itemList.findIndex((item) => item.id === id)
      if (index < 0) return Promise.resolve(err(new NotFoundError(`Item ${id} não existe.`)))
      this.itemList.splice(index, 1)
      return Promise.resolve(ok())
    },
  }

  readonly config = {
    categories: (): readonly ConfigCategoryLike[] => CATEGORIES,
    effective: (): Promise<{
      values: Record<string, unknown>
      origins: Record<string, string>
    }> =>
      Promise.resolve({ values: { ...this.values }, origins: { 'budget.perRun.usd': 'config' } }),
    set: (path: string, value: unknown): Promise<Result<void>> => {
      if (path === 'budget.perRun.usd' && typeof value !== 'number') {
        return Promise.resolve(err(new ValidationError('budget.perRun.usd deve ser número.')))
      }
      this.writes.push({ path, value })
      this.values[path] = value
      return Promise.resolve(ok())
    },
  }

  readonly noteList: InstructionNoteLike[] = []

  readonly instructions = {
    list: (): Promise<readonly InstructionNoteLike[]> => Promise.resolve([...this.noteList]),
    create: (input: {
      title: string
      body: string
      scope?: string
    }): Promise<Result<InstructionNoteLike>> => {
      const note: InstructionNoteLike = {
        id: `note-${this.noteList.length + 1}`,
        title: input.title,
        body: input.body,
        ...(input.scope === undefined ? {} : { scope: input.scope }),
        createdAt: 1_000,
        updatedAt: 1_000,
      }
      this.noteList.push(note)
      return Promise.resolve(ok(note))
    },
    update: (
      id: string,
      patch: { title?: string; body?: string; scope?: string | null },
    ): Promise<Result<InstructionNoteLike>> => {
      const index = this.noteList.findIndex((note) => note.id === id)
      const current = this.noteList[index]
      if (current === undefined) {
        return Promise.resolve(err(new NotFoundError(`Instrução ${id} não existe.`)))
      }
      const updated: InstructionNoteLike = {
        id: current.id,
        title: patch.title ?? current.title,
        body: patch.body ?? current.body,
        ...(patch.scope === null
          ? {}
          : patch.scope !== undefined
            ? { scope: patch.scope }
            : current.scope === undefined
              ? {}
              : { scope: current.scope }),
        createdAt: current.createdAt,
        updatedAt: 2_000,
      }
      this.noteList[index] = updated
      return Promise.resolve(ok(updated))
    },
    remove: (id: string): Promise<Result<void>> => {
      const index = this.noteList.findIndex((note) => note.id === id)
      if (index < 0) return Promise.resolve(err(new NotFoundError(`Instrução ${id} não existe.`)))
      this.noteList.splice(index, 1)
      return Promise.resolve(ok())
    },
  }

  readonly installedSkills = new Set<string>()

  readonly skills = {
    list: (): Promise<readonly SkillCatalogEntryLike[]> =>
      Promise.resolve(
        SKILL_CATALOG_FIXTURE.map((skill) => ({
          ...skill,
          installed: this.installedSkills.has(skill.id),
        })),
      ),
    install: (id: string): Promise<Result<{ id: string }>> => {
      if (!SKILL_CATALOG_FIXTURE.some((skill) => skill.id === id)) {
        return Promise.resolve(err(new NotFoundError(`Skill ${id} não existe no catálogo.`)))
      }
      this.installedSkills.add(id)
      return Promise.resolve(ok({ id }))
    },
  }

  readonly vault = {
    graph: (): Promise<VaultGraphLike> =>
      Promise.resolve({
        nodes: this.noteList.map((note) => ({
          id: `instruction:${note.id}`,
          title: note.title,
          kind: 'instruction',
          excerpt: note.body,
        })),
        edges: [],
        unresolved: [],
      }),
  }

  graphifyGraph: GraphifyGraphLike = { nodes: [], edges: [], communities: [], godNodes: [] }
  readonly graphify = {
    graph: (): Promise<GraphifyGraphLike> => Promise.resolve(this.graphifyGraph),
  }

  readonly recordList: MemoryRecordLike[] = []
  /** Capturado por `memory.watch()`, pra um teste disparar manualmente — simula outro processo escrevendo. */
  onMemoryChange: (() => void) | undefined = undefined

  readonly memory = {
    list: (): Promise<readonly MemoryRecordLike[]> => Promise.resolve([...this.recordList]),
    create: (input: NewMemoryInput): Promise<Result<MemoryRecordLike>> => {
      const record: MemoryRecordLike = {
        id: `mem-${this.recordList.length + 1}`,
        scope: input.scope,
        key: input.title,
        title: input.title,
        body: input.body ?? '',
        tags: input.tags ?? [],
        confidence: input.confidence ?? 0.8,
        source: { kind: 'human', ref: 'painel' },
        validFrom: 1_000,
      }
      this.recordList.push(record)
      return Promise.resolve(ok(record))
    },
    watch: (onChange: () => void): (() => void) => {
      this.onMemoryChange = onChange
      return () => {
        this.onMemoryChange = undefined
      }
    },
  }
}

const SKILL_CATALOG_FIXTURE: readonly Omit<SkillCatalogEntryLike, 'installed'>[] = [
  {
    id: 'pdf',
    title: 'PDF',
    description: 'Extrai, combina e edita PDFs.',
    official: true,
    sourceRepo: 'anthropics/skills',
    sourceUrl: 'https://github.com/anthropics/skills/tree/main/skills/pdf',
  },
]

/**
 * A categoria como o `CONFIG_CATEGORIES` do CLI realmente é: com campos que o
 * contrato não declara e com funções, que o `JSON.stringify` descartaria em
 * silêncio. O servidor mapeia campo a campo justamente por causa disto.
 */
const CATEGORIA_DO_CLI = {
  id: 'budget',
  title: 'Orçamento',
  blurb: 'Quanto o Uranus pode gastar.',
  blurbExtra: 'campo que não faz parte do contrato e não deve vazar',
  questions: [
    {
      path: 'budget.perRun.usd',
      label: 'Teto por run (USD)',
      help: 'Quando estourar, o run para.',
      kind: 'number',
      min: 0,
      max: 1_000,
      suggest: (): number => 5,
    },
  ],
}

const CATEGORIES: readonly ConfigCategoryLike[] = [CATEGORIA_DO_CLI]

function makeTask(overrides: Partial<Task> = {}): Task {
  const now = 1_000
  return {
    id: newTaskId(now),
    projectId: newProjectId(now),
    kind: 'feature',
    title: 'Task de teste',
    intent: 'fazer alguma coisa',
    state: 'ready',
    priority: 50,
    deps: [],
    touches: ['src/**'],
    acceptance: { checks: [], requireAll: true },
    attempts: 0,
    maxAttempts: 3,
    repairAttempts: 0,
    labels: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

async function withDashboard<T>(
  fn: (harness: Harness) => Promise<T>,
  options: {
    token?: string
    data?: DashboardData
    terminalProfiles?: Record<string, { command: string; args?: string[]; cwd: string }>
  } = {},
): Promise<T> {
  return withTempDir(async (dir) => {
    const logger = new RecordingLogger()
    const store = await JsonlEventStore.open({ dir })
    const events = new InProcessEventBus({
      store,
      clock: systemClock,
      logger: logger.logger,
      projectId: newProjectId(1),
    })
    const telemetry = new DefaultTelemetry({ clock: systemClock })
    const cost = new DefaultCostAccountant({ pricing: createPricingTable() })
    const aggregator = new TelemetryAggregator({ clock: systemClock, events, cost, telemetry })
    attachCostAccounting({ events, cost, telemetry, logger: logger.logger })
    aggregator.start()

    const gate = new FakeHumanGate()
    const server = new DashboardServer(
      {
        aggregator,
        events,
        humanGate: gate,
        logger: logger.logger,
        clock: systemClock,
        port: 0, // porta efêmera: testes paralelos não podem brigar por porta
        ...(options.token === undefined ? {} : { token: options.token }),
        ...(options.data === undefined ? {} : { data: options.data }),
        ...(options.terminalProfiles === undefined
          ? {}
          : { terminalProfiles: options.terminalProfiles }),
      },
      new SseHub(),
    )
    const { url } = await server.listen()

    const authHeaders = (token?: string): Record<string, string> =>
      token === undefined ? {} : { authorization: `Bearer ${token}` }

    try {
      return await fn({
        url,
        events,
        gate,
        aggregator,
        get: (path, token) => fetch(`${url}${path}`, { headers: authHeaders(token) }),
        post: (path, body, token) =>
          fetch(`${url}${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...authHeaders(token) },
            body: JSON.stringify(body),
          }),
        send: (method, path, body, token) =>
          fetch(`${url}${path}`, {
            method,
            headers: { 'content-type': 'application/json', ...authHeaders(token) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          }),
      })
    } finally {
      await server.close()
      aggregator.stop()
      await store.close()
    }
  })
}

describe('DashboardServer', () => {
  it('serve a UI autocontida com CSP que proíbe origem externa', async () => {
    await withDashboard(async ({ get }) => {
      const response = await get('/')
      expect(response.status).toBe(200)
      const csp = response.headers.get('content-security-policy') ?? ''
      expect(csp).toContain("default-src 'none'")
      expect(csp).toContain("connect-src 'self'")
      // Os assets deixaram de ser inline: sem `'self'` aqui o navegador
      // bloquearia o próprio CSS e os módulos que este servidor entrega.
      expect(csp).toContain("script-src 'self'")
      expect(csp).toContain("style-src 'self'")
      // Poppins self-hospedada: soltar os `.woff2` em `public/fonts/` passa a
      // funcionar sem mudar código nem CSP.
      expect(csp).toContain("font-src 'self'")

      const html = await response.text()
      expect(html).toContain('URANUS')
      // Autocontido de verdade: os assets podem ser arquivos separados, mas
      // nenhum recurso pode vir de fora. É o que faz o CSP acima ser cumprível
      // em vez de decorativo.
      expect(html).not.toMatch(/https?:\/\/(?!localhost)/)
    })
  })

  it('/api/state reflete os eventos que aconteceram', async () => {
    await withDashboard(async ({ get, events }) => {
      const taskId = newTaskId(1)
      await events.emit('KernelStarted', { runId: 'run_1' as never, concurrency: 1 })
      await events.emit('TaskCreated', { taskId, kind: 'feature', title: 'Fazer algo' })
      await events.emit('TaskCompleted', { taskId, attempts: 1, totalCost: usd(0.5) })

      const state = (await (await get('/api/state')).json()) as {
        run: { status: string }
        tasks: { title: string; state: string }[]
        queue: { total: number }
      }
      expect(state.run.status).toBe('running')
      expect(state.tasks[0]?.title).toBe('Fazer algo')
      expect(state.tasks[0]?.state).toBe('done')
      expect(state.queue.total).toBe(1)
    })
  })

  it('empurra eventos por SSE em menos de 1s (DoD de latência)', async () => {
    await withDashboard(async ({ url, events }) => {
      const controller = new AbortController()
      const response = await fetch(`${url}/api/stream`, { signal: controller.signal })
      expect(response.headers.get('content-type')).toContain('text/event-stream')

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()

      // Descarta o preâmbulo de conexão antes de medir.
      await reader.read()

      const started = Date.now()
      await events.emit('TaskCreated', {
        taskId: newTaskId(1),
        kind: 'bugfix',
        title: 'evento ao vivo',
      })

      let received = ''
      while (!received.includes('TaskCreated')) {
        const chunk = await reader.read()
        if (chunk.done || chunk.value === undefined) break
        received += decoder.decode(chunk.value as Uint8Array)
      }
      const latency = Date.now() - started

      expect(received).toContain('event: event')
      expect(received).toContain('TaskCreated')
      expect(latency).toBeLessThan(1_000)

      controller.abort()
    })
  })

  it('memória mudando em OUTRO processo chega por SSE, sem precisar reiniciar o painel', async () => {
    const data = new FakeData()
    await withDashboard(
      async ({ url }) => {
        const controller = new AbortController()
        const response = await fetch(`${url}/api/stream`, { signal: controller.signal })
        const reader = response.body!.getReader()
        const decoder = new TextDecoder()
        await reader.read() // preâmbulo

        // `watch()` já deve ter sido registrado no `listen()`, sem round-trip de
        // HTTP: é exatamente o gancho que outro processo (kernel, `uranus chat`)
        // dispararia ao escrever em `.uranus/memory/`.
        expect(data.onMemoryChange).toBeDefined()
        data.onMemoryChange?.()

        let received = ''
        while (!received.includes('MemoryUpdatedExternally')) {
          const chunk = await reader.read()
          if (chunk.done || chunk.value === undefined) break
          received += decoder.decode(chunk.value as Uint8Array)
        }
        expect(received).toContain('event: event')
        expect(received).toContain('MemoryUpdatedExternally')

        controller.abort()
      },
      { data },
    )
  })

  it('aprovação concedida pela UI desbloqueia a task em menos de 2s (DoD)', async () => {
    await withDashboard(async ({ post, gate }) => {
      const approvalId = newApprovalId()
      const request: ApprovalRequest = {
        id: approvalId,
        kind: 'merge',
        title: 'Fazer merge do PR #12',
        detail: 'diff com 3 arquivos',
        risk: 'medium',
        requestedAt: Date.now(),
        defaultOnTimeout: 'deny',
      }

      // O kernel bloqueia aqui, exatamente como no run real.
      const bloqueado = gate.request(request)
      let liberado = false
      void bloqueado.then(() => {
        liberado = true
      })

      const started = Date.now()
      const response = await post(`/api/approvals/${approvalId}`, {
        effect: 'granted',
        note: 'revisei',
      })
      expect(response.status).toBe(200)

      const decision = (await bloqueado) as unknown as { effect: string; by: string; note: string }
      const latency = Date.now() - started

      expect(liberado).toBe(true)
      expect(decision.effect).toBe('granted')
      // Autor rastreável: aprovação anônima não é supervisão registrada.
      expect(decision.by).toBe('dashboard')
      expect(decision.note).toBe('revisei')
      expect(latency).toBeLessThan(2_000)
    })
  })

  it('aprovação inexistente devolve 409 em vez de fingir sucesso', async () => {
    await withDashboard(async ({ post }) => {
      const response = await post(`/api/approvals/${newApprovalId()}`, { effect: 'granted' })
      expect(response.status).toBe(409)
    })
  })

  it('recusa corpo sem effect válido', async () => {
    await withDashboard(async ({ post }) => {
      const response = await post(`/api/approvals/${newApprovalId()}`, { effect: 'talvez' })
      expect(response.status).toBe(400)
    })
  })

  it('exige o token quando configurado, e compara sem vazar tempo', async () => {
    await withDashboard(
      async ({ get }) => {
        expect((await get('/api/state')).status).toBe(401)
        expect((await get('/api/state', 'errado')).status).toBe(401)
        expect((await get('/api/state', 'segredo-do-painel')).status).toBe(200)
      },
      { token: 'segredo-do-painel' },
    )
  })

  it('recusa escutar fora de loopback sem token', async () => {
    const logger = new RecordingLogger()
    const server = new DashboardServer(
      {
        aggregator: undefined as never,
        events: undefined as never,
        logger: logger.logger,
        clock: systemClock,
        host: '0.0.0.0',
        port: 0,
      },
      new SseHub(),
    )
    // O painel concede aprovações e mostra o código do projeto: abrir na rede
    // por descuido tem que ser impossível, não improvável.
    await expect(server.listen()).rejects.toThrow(/sem token/)
  })

  it('nenhum segredo atravessa a fronteira HTTP (DoD de redaction)', async () => {
    globalSecrets.register('valor-secretissimo-123')
    try {
      await withDashboard(async ({ get, events }) => {
        const taskId = newTaskId(1)
        await events.emit('TaskBlocked', {
          taskId,
          kind: 'auth',
          message: 'falhou usando valor-secretissimo-123 e sk-ant-aaaaaaaaaaaaaaaaaaaaaaaa',
          resolvableBy: 'humano',
        })
        const text = await (await get('/api/state')).text()
        expect(text).not.toContain('valor-secretissimo-123')
        expect(text).not.toContain('sk-ant-aaaaaaaaaaaaaaaaaaaaaaaa')
        expect(text).toContain('[REDACTED]')
      })
    } finally {
      globalSecrets.clear()
    }
  })

  it('expõe métricas Prometheus e um health check', async () => {
    await withDashboard(async ({ get, events }) => {
      const sessionId = newSessionId()
      await events.emit('AgentRunStarted', {
        sessionId,
        attemptId: 'att_1' as never,
        agent: 'executor',
        provider: 'claude-code',
        model: 'claude-sonnet-4',
        contextDigest: 'd',
      })
      await events.emit('AgentRunFinished', {
        sessionId,
        status: 'completed',
        turns: 1,
        usage: USAGE,
        cost: usd(0.01),
      })

      const metrics = await (await get('/api/metrics')).text()
      expect(metrics).toContain('uranus_agent_runs')
      expect(metrics).toContain('uranus_cost_total_usd')

      const health = (await (await get('/api/health')).json()) as { ok: boolean }
      expect(health.ok).toBe(true)
    })
  })

  it('/api/claude-activity guarda o que o relay dos hooks envia e devolve no GET', async () => {
    await withDashboard(async ({ get, post }) => {
      const created = await post('/api/claude-activity', {
        event: 'UserPromptSubmit',
        summary: 'implemente o item X',
        role: 'user',
      })
      expect(created.status).toBe(200)
      expect((await created.json()) as { ok: boolean }).toEqual({ ok: true })

      const listed = (await (await get('/api/claude-activity')).json()) as {
        entries: { event: string; summary: string }[]
      }
      expect(listed.entries).toHaveLength(1)
      expect(listed.entries[0]?.event).toBe('UserPromptSubmit')
      expect(listed.entries[0]?.summary).toBe('implemente o item X')
    })
  })

  it('/api/claude-activity ignora corpo inválido sem derrubar a rota', async () => {
    await withDashboard(async ({ post }) => {
      const response = await post('/api/claude-activity', { nonsense: true })
      expect(response.status).toBe(200)
      expect((await response.json()) as { ok: boolean }).toEqual({ ok: false })
    })
  })

  it('rota desconhecida devolve 404 em JSON, não uma página de erro', async () => {
    await withDashboard(async ({ get }) => {
      const response = await get('/api/inexistente')
      expect(response.status).toBe(404)
      expect(response.headers.get('content-type')).toContain('application/json')
    })
  })

  it('o arquivo da UI existe no caminho resolvido em runtime', async () => {
    const { readFile } = await import('node:fs/promises')
    await expect(readFile(uiPath(), 'utf8')).resolves.toContain('<!doctype html>')
  })
})

describe('assets estáticos', () => {
  it('serve index.html por / e por /index.html, com o content-type certo', async () => {
    await withDashboard(async ({ get }) => {
      for (const path of ['/', '/index.html']) {
        const response = await get(path)
        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toContain('text/html')
        expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      }
    })
  })

  it('recusa sair de public/, inclusive com a barra escapada', async () => {
    await withDashboard(async ({ get }) => {
      // `..%2f` é a primeira coisa que alguém tenta: o servidor decodifica,
      // resolve e descobre que o alvo caiu fora de public/.
      for (const path of [
        '/..%2fpackage.json',
        '/..%2f..%2f..%2fetc%2fpasswd',
        '/%2e%2e%2fpackage.json',
        '/..%5cpackage.json',
      ]) {
        const response = await get(path)
        expect(response.status).toBe(404)
        expect(response.headers.get('content-type')).toContain('application/json')
      }
    })
  })

  it('resolvePublicPath prova a contenção sem tocar no disco', () => {
    const root = publicDir()
    expect(resolvePublicPath('/')).toBe(join(root, 'index.html'))
    expect(resolvePublicPath('/app.css')).toBe(join(root, 'app.css'))
    expect(resolvePublicPath('/views/tasks.js')).toBe(join(root, 'views', 'tasks.js'))
    expect(resolvePublicPath('/fonts/poppins.woff2')).toBe(join(root, 'fonts', 'poppins.woff2'))

    // Fora de public/, extensão desconhecida, diretório e byte NUL: tudo o que
    // não é "um arquivo conhecido lá dentro" vira `undefined`, e o servidor
    // devolve 404 sem distinguir os casos.
    expect(resolvePublicPath('/../package.json')).toBeUndefined()
    expect(resolvePublicPath('/../../../etc/passwd')).toBeUndefined()
    // `..` que volta para dentro é normalizado, não recusado: a trava é sobre
    // ONDE o caminho termina, não sobre a presença do segmento.
    expect(resolvePublicPath('/../public/index.html')).toBe(join(root, 'index.html'))
    expect(resolvePublicPath('/segredo.env')).toBeUndefined()
    expect(resolvePublicPath('/config.yaml')).toBeUndefined()
    expect(resolvePublicPath('/fonts')).toBeUndefined()
    expect(resolvePublicPath('/app.css\0.png')).toBeUndefined()
    expect(resolvePublicPath('/%zz')).toBeUndefined()
  })

  it('arquivo inexistente e diretório dão 404 em JSON, nunca listagem', async () => {
    await withDashboard(async ({ get }) => {
      expect((await get('/nao-existe.css')).status).toBe(404)
      expect((await get('/fonts/')).status).toBe(404)
      const listagem = await get('/')
      // A raiz serve o HTML, não o índice da pasta.
      expect(await listagem.text()).not.toContain('index.html</a>')
    })
  })

  it('método errado em asset dá 405 com Allow, não 404', async () => {
    await withDashboard(async ({ send }) => {
      const response = await send('POST', '/index.html', {})
      expect(response.status).toBe(405)
      expect(response.headers.get('allow')).toBe('GET, HEAD')
    })
  })

  it('método errado em rota existente dá 405, não 404', async () => {
    await withDashboard(async ({ send }) => {
      expect((await send('POST', '/api/state', {})).status).toBe(405)
      expect((await send('GET', '/api/control/pause')).status).toBe(405)
      expect((await send('GET', `/api/approvals/${newApprovalId()}`)).status).toBe(405)
      // E o que não existe continua 404.
      expect((await send('POST', '/api/inexistente', {})).status).toBe(404)
    })
  })
})

describe('rotas de dados sem a porta conectada', () => {
  it('devolvem 503 (rota existe, fonte não), e não 404', async () => {
    await withDashboard(async ({ get, send }) => {
      for (const path of [
        '/api/tasks',
        '/api/backlog',
        '/api/config',
        '/api/validations',
        '/api/instructions',
        '/api/skills',
        '/api/vault',
      ]) {
        const response = await get(path)
        expect(response.status).toBe(503)
        expect(((await response.json()) as { error: string }).error).toContain('somente-leitura')
      }
      expect((await send('POST', '/api/tasks', { title: 'x' })).status).toBe(503)
      expect((await send('DELETE', '/api/backlog/qualquer')).status).toBe(503)
    })
  })
})

describe('instruções pela dashboard', () => {
  it('CRUD completo: cria, lista, edita, limpa escopo e apaga', async () => {
    const data = new FakeData()
    await withDashboard(
      async ({ get, send }) => {
        const criada = await send('POST', '/api/instructions', {
          title: 'Estilo de commit',
          body: 'Sempre em português.',
          scope: 'packages/api',
        })
        expect(criada.status).toBe(201)
        const nota = ((await criada.json()) as { note: InstructionNoteLike }).note
        expect(nota.scope).toBe('packages/api')

        const listada = (await (await get('/api/instructions')).json()) as {
          notes: InstructionNoteLike[]
        }
        expect(listada.notes).toHaveLength(1)

        const editada = await send('PATCH', `/api/instructions/${nota.id}`, {
          scope: null,
        })
        expect(editada.status).toBe(200)
        expect(((await editada.json()) as { note: InstructionNoteLike }).note.scope).toBeUndefined()

        const semTitulo = await send('POST', '/api/instructions', { body: 'x' })
        expect(semTitulo.status).toBe(400)

        const apagada = await send('DELETE', `/api/instructions/${nota.id}`)
        expect(apagada.status).toBe(200)
        expect(data.noteList).toHaveLength(0)

        expect((await send('PATCH', '/api/instructions/nao-existe', { title: 'x' })).status).toBe(
          404,
        )
      },
      { data },
    )
  })
})

describe('skills pela dashboard', () => {
  it('lista o catálogo e instala uma skill', async () => {
    const data = new FakeData()
    await withDashboard(
      async ({ get, post }) => {
        const antes = (await (await get('/api/skills')).json()) as {
          skills: SkillCatalogEntryLike[]
        }
        expect(antes.skills.find((s) => s.id === 'pdf')?.installed).toBe(false)

        const instalada = await post('/api/skills/pdf/install', {})
        expect(instalada.status).toBe(200)
        expect(data.installedSkills.has('pdf')).toBe(true)

        const depois = (await (await get('/api/skills')).json()) as {
          skills: SkillCatalogEntryLike[]
        }
        expect(depois.skills.find((s) => s.id === 'pdf')?.installed).toBe(true)

        const inexistente = await post('/api/skills/nao-existe/install', {})
        expect(inexistente.status).toBe(404)
      },
      { data },
    )
  })
})

describe('vault pela dashboard', () => {
  it('GET /api/vault devolve o grafo montado pela porta', async () => {
    const data = new FakeData()
    await data.instructions.create({ title: 'Estilo de commit', body: 'x' })

    await withDashboard(
      async ({ get }) => {
        const body = (await (await get('/api/vault')).json()) as VaultGraphLike
        expect(body.nodes).toHaveLength(1)
        expect(body.nodes[0]?.title).toBe('Estilo de commit')
        expect(body.edges).toEqual([])
      },
      { data },
    )
  })

  it('só aceita GET', async () => {
    const data = new FakeData()
    await withDashboard(
      async ({ send }) => {
        expect((await send('POST', '/api/vault', {})).status).toBe(405)
      },
      { data },
    )
  })
})

describe('grafo (graphify) pela dashboard', () => {
  it('GET /api/graphify devolve o grafo da porta', async () => {
    const data = new FakeData()
    data.graphifyGraph = {
      nodes: [{ id: 'a', title: 'A', community: 0 }, { id: 'b', title: 'B', community: 0 }],
      edges: [{ from: 'a', to: 'b', relation: 'calls' }],
      communities: [{ id: 0, label: 'Núcleo', size: 2 }],
      godNodes: [{ id: 'a', title: 'A', degree: 1 }],
    }

    await withDashboard(
      async ({ get }) => {
        const body = (await (await get('/api/graphify')).json()) as GraphifyGraphLike
        expect(body.nodes).toHaveLength(2)
        expect(body.edges).toEqual([{ from: 'a', to: 'b', relation: 'calls' }])
        expect(body.godNodes[0]?.title).toBe('A')
      },
      { data },
    )
  })

  it('só aceita GET', async () => {
    const data = new FakeData()
    await withDashboard(
      async ({ send }) => {
        expect((await send('POST', '/api/graphify', {})).status).toBe(405)
      },
      { data },
    )
  })

  it('sem a porta de dados, devolve 503', async () => {
    await withDashboard(async ({ get }) => {
      expect((await get('/api/graphify')).status).toBe(503)
    })
  })
})

describe('tasks pela dashboard', () => {
  it('GET /api/tasks devolve dado tratado, não cru', async () => {
    const data = new FakeData()
    const agora = Date.now()
    data.taskList.push(
      makeTask({ title: 'Concluída', state: 'done', updatedAt: agora - 4 * 60_000 }),
      makeTask({
        title: 'Travada',
        state: 'blocked',
        updatedAt: agora,
        blockReason: { kind: 'approval', message: 'esperando você', resolvableBy: 'human' },
      }),
    )

    await withDashboard(
      async ({ get }) => {
        const body = (await (await get('/api/tasks')).json()) as {
          tasks: {
            state: string
            stateLabel: string
            group: string
            groupLabel: string
            tone: string
            updatedLabel: string
            blockReason?: { message: string }
          }[]
          states: {
            value: string
            label: string
            group: string
            groupLabel: string
            tone: string
          }[]
          kinds: string[]
          checkKinds: string[]
        }

        const [concluida, travada] = body.tasks
        // Os rótulos são os mesmos que o CLI imprime (`taskStateLabel`), não
        // uma tradução paralela do painel.
        expect(concluida?.state).toBe('done')
        expect(concluida?.stateLabel).toBe('Concluída')
        expect(concluida?.groupLabel).toBe('Encerrada')
        expect(concluida?.tone).toBe('success')
        expect(concluida?.updatedLabel).toBe('há 4 min')

        expect(travada?.stateLabel).toBe('Bloqueada')
        expect(travada?.group).toBe('attention')
        expect(travada?.groupLabel).toBe('Precisa de você')
        expect(travada?.tone).toBe('warning')
        expect(travada?.updatedLabel).toBe('agora')
        expect(travada?.blockReason?.message).toBe('esperando você')

        // O vocabulário vem do servidor: a tela não repete os `TaskKind` nem
        // os rótulos dos onze estados à mão.
        expect(body.kinds).toContain('feature')
        expect(body.checkKinds).toContain('tests')
        expect(body.states).toHaveLength(11)
        expect(body.states.find((state) => state.value === 'done')).toEqual({
          value: 'done',
          label: 'Concluída',
          group: 'finished',
          groupLabel: 'Encerrada',
          tone: 'success',
        })
      },
      { data },
    )
  })

  it('POST /api/tasks cria e recusa entrada inválida com 400 explicado', async () => {
    const data = new FakeData()
    await withDashboard(
      async ({ send }) => {
        const criada = await send('POST', '/api/tasks', {
          kind: 'feature',
          title: 'Nova task',
          intent: 'trocar o botão de lugar',
          touches: ['src/ui/**'],
          checks: ['tests'],
        })
        expect(criada.status).toBe(201)
        const body = (await criada.json()) as { task: { title: string; stateLabel: string } }
        expect(body.task.title).toBe('Nova task')
        expect(body.task.stateLabel).toBe('Na fila')
        expect(data.taskList).toHaveLength(1)

        const semTitulo = await send('POST', '/api/tasks', { kind: 'feature', intent: 'x' })
        expect(semTitulo.status).toBe(400)
        expect(((await semTitulo.json()) as { error: string }).error).toContain('título')

        const kindErrado = await send('POST', '/api/tasks', {
          kind: 'inventado',
          title: 'x',
          intent: 'y',
        })
        expect(kindErrado.status).toBe(400)
        // O erro lista as opções: quem está do outro lado não precisa adivinhar.
        expect(((await kindErrado.json()) as { error: string }).error).toContain('feature')

        const checkErrado = await send('POST', '/api/tasks', {
          kind: 'feature',
          title: 'x',
          intent: 'y',
          checks: ['nao-existe'],
        })
        expect(checkErrado.status).toBe(400)
      },
      { data },
    )
  })

  it('PATCH move o estado, e transição ilegal vira 409 com o motivo', async () => {
    const data = new FakeData()
    const task = makeTask({ state: 'ready' })
    data.taskList.push(task)

    await withDashboard(
      async ({ send }) => {
        const ilegal = await send('PATCH', `/api/tasks/${task.id}`, { state: 'done' })
        expect(ilegal.status).toBe(409)
        expect(((await ilegal.json()) as { error: string }).error).toContain('Transição ilegal')

        const legal = await send('PATCH', `/api/tasks/${task.id}`, {
          state: 'blocked',
          reason: 'esperando decisão',
        })
        expect(legal.status).toBe(200)
        const body = (await legal.json()) as {
          task: { stateLabel: string; tone: string; blockReason?: { message: string } }
        }
        expect(body.task.stateLabel).toBe('Bloqueada')
        expect(body.task.tone).toBe('warning')
        expect(body.task.blockReason?.message).toBe('esperando decisão')

        const semEstado = await send('PATCH', `/api/tasks/${task.id}`, {})
        expect(semEstado.status).toBe(400)

        const inexistente = await send('PATCH', '/api/tasks/tsk_nao_existe', { state: 'ready' })
        expect(inexistente.status).toBe(404)
      },
      { data },
    )
  })

  it('DELETE apaga, e apagar de novo dá 404', async () => {
    const data = new FakeData()
    const task = makeTask()
    data.taskList.push(task)

    await withDashboard(
      async ({ send }) => {
        expect((await send('DELETE', `/api/tasks/${task.id}`)).status).toBe(200)
        expect(data.taskList).toHaveLength(0)
        expect((await send('DELETE', `/api/tasks/${task.id}`)).status).toBe(404)
        // Sem id não é "apagar tudo": é rota inválida.
        expect((await send('DELETE', '/api/tasks/')).status).toBe(404)
        expect((await send('PUT', `/api/tasks/${task.id}`, {})).status).toBe(405)
      },
      { data },
    )
  })
})

describe('backlog pela dashboard', () => {
  it('GET /api/backlog traz o progresso das subtasks já formatado', async () => {
    const data = new FakeData()
    data.itemList.push({
      id: 'item-1',
      title: 'Migrar autenticação',
      body: 'texto do item',
      labels: ['auth'],
      priority: 80,
      source: 'manual',
      state: 'planned',
      createdAt: Date.now() - 90 * 60_000,
    })
    data.taskList.push(
      makeTask({ backlogItemId: 'item-1', state: 'done' }),
      makeTask({ backlogItemId: 'item-1', state: 'blocked' }),
      makeTask({ backlogItemId: 'outro', state: 'done' }),
    )

    await withDashboard(
      async ({ get }) => {
        const body = (await (await get('/api/backlog')).json()) as {
          items: {
            stateLabel: string
            tone: string
            createdLabel: string
            progress: { total: number; done: number; label: string }
          }[]
        }
        const item = body.items[0]
        expect(item?.stateLabel).toBe('Planejado')
        expect(item?.tone).toBe('info')
        expect(item?.createdLabel).toBe('há 2 h')
        // Só as tasks do item, e já em texto de cartão.
        expect(item?.progress.total).toBe(2)
        expect(item?.progress.done).toBe(1)
        expect(item?.progress.label).toBe('1/2 · 1 bloqueada')
      },
      { data },
    )
  })

  it('POST cria, PATCH move de coluna e DELETE apaga', async () => {
    const data = new FakeData()
    await withDashboard(
      async ({ send }) => {
        const criado = await send('POST', '/api/backlog', {
          title: 'Novo item',
          body: 'descrição',
          priority: 70,
          labels: ['ui'],
        })
        expect(criado.status).toBe(201)
        const { item } = (await criado.json()) as { item: { id: string; stateLabel: string } }
        expect(item.stateLabel).toBe('Aberto')

        const movido = await send('PATCH', `/api/backlog/${item.id}`, { state: 'done' })
        expect(movido.status).toBe(200)
        expect(((await movido.json()) as { item: { stateLabel: string } }).item.stateLabel).toBe(
          'Concluído',
        )

        const estadoInvalido = await send('PATCH', `/api/backlog/${item.id}`, { state: 'quase' })
        expect(estadoInvalido.status).toBe(400)
        expect(((await estadoInvalido.json()) as { error: string }).error).toContain('dropped')

        const vazio = await send('PATCH', `/api/backlog/${item.id}`, { nada: 1 })
        expect(vazio.status).toBe(400)

        expect((await send('DELETE', `/api/backlog/${item.id}`)).status).toBe(200)
        expect(data.itemList).toHaveLength(0)
      },
      { data },
    )
  })
})

describe('config e validações pela dashboard', () => {
  it('GET /api/config devolve as perguntas do wizard, sem as funções', async () => {
    const data = new FakeData()
    await withDashboard(
      async ({ get }) => {
        const body = (await (await get('/api/config')).json()) as {
          categories: {
            id: string
            blurb: string
            questions: { path: string; help: string; min?: number }[]
          }[]
          values: Record<string, unknown>
          origins: Record<string, string>
        }
        const categoria = body.categories[0]
        expect(categoria?.id).toBe('budget')
        expect(categoria?.questions[0]?.help).toBe('Quando estourar, o run para.')
        expect(categoria?.questions[0]?.min).toBe(0)
        // Só o contrato: campo extra da origem não atravessa.
        expect(Object.keys(categoria ?? {})).toEqual(['id', 'title', 'blurb', 'questions'])
        expect(body.origins['budget.perRun.usd']).toBe('config')
      },
      { data },
    )
  })

  it('PATCH /api/config grava, recusa path envenenado e propaga o erro do schema', async () => {
    const data = new FakeData()
    await withDashboard(
      async ({ send }) => {
        const gravado = await send('PATCH', '/api/config', {
          path: 'budget.perRun.usd',
          value: 12,
        })
        expect(gravado.status).toBe(200)
        expect(data.writes).toEqual([{ path: 'budget.perRun.usd', value: 12 }])

        // `__proto__` no caminho envenenaria o protótipo num `set` que navega
        // objeto — o schema do outro lado nem chegaria a rodar.
        for (const path of ['__proto__.polluted', 'a.constructor.x', 'a b', '']) {
          const recusado = await send('PATCH', '/api/config', { path, value: 1 })
          expect(recusado.status).toBe(400)
        }
        expect((await send('PATCH', '/api/config', { path: 'budget.perRun.usd' })).status).toBe(400)

        // Erro de validação do outro lado da porta chega inteiro na tela.
        const invalido = await send('PATCH', '/api/config', {
          path: 'budget.perRun.usd',
          value: 'muito',
        })
        expect(invalido.status).toBe(400)
        expect(((await invalido.json()) as { error: string }).error).toContain('deve ser número')
      },
      { data },
    )
  })

  it('GET /api/validations explica severidade e origem de cada regra', async () => {
    const data = new FakeData()
    await withDashboard(
      async ({ get }) => {
        const body = (await (await get('/api/validations')).json()) as {
          enabled: boolean
          countTowardAttempts: boolean
          maxRepairAttempts: number
          rules: { rule: string; severity: string; severityLabel: string; origin: string }[]
          severities: { value: string; label: string }[]
        }
        expect(body.enabled).toBe(true)
        expect(body.maxRepairAttempts).toBe(3)
        expect(body.rules).toHaveLength(10)

        const tests = body.rules.find((rule) => rule.rule === 'tests')
        expect(tests?.severity).toBe('advisory')
        expect(tests?.severityLabel).toBe('avisa, não reprova')
        // "advisory porque o projeto pediu" ≠ "blocking porque é o default".
        expect(tests?.origin).toBe('config')
        expect(body.rules.find((rule) => rule.rule === 'lint')?.origin).toBe('default')
        expect(body.severities).toHaveLength(3)
      },
      { data },
    )
  })

  it('validações desligadas globalmente não prometem verificação que não roda', async () => {
    const data = new FakeData()
    data.values['validations.enabled'] = false
    await withDashboard(
      async ({ get }) => {
        const body = (await (await get('/api/validations')).json()) as {
          enabled: boolean
          rules: { severity: string; origin: string }[]
        }
        expect(body.enabled).toBe(false)
        expect(body.rules.every((rule) => rule.severity === 'off')).toBe(true)
        expect(body.rules.every((rule) => rule.origin === 'global-off')).toBe(true)
      },
      { data },
    )
  })

  it('PATCH /api/validations escreve na config do projeto', async () => {
    const data = new FakeData()
    await withDashboard(
      async ({ send }) => {
        expect(
          (await send('PATCH', '/api/validations', { rule: 'lint', severity: 'off' })).status,
        ).toBe(200)
        expect((await send('PATCH', '/api/validations', { maxRepairAttempts: 5 })).status).toBe(200)
        expect(data.writes).toEqual([
          { path: 'validations.rules.lint', value: 'off' },
          { path: 'validations.maxRepairAttempts', value: 5 },
        ])

        expect(
          (await send('PATCH', '/api/validations', { rule: 'lint', severity: 'talvez' })).status,
        ).toBe(400)
        expect(
          (await send('PATCH', '/api/validations', { rule: 'inventada', severity: 'off' })).status,
        ).toBe(400)
        expect((await send('PATCH', '/api/validations', { maxRepairAttempts: -1 })).status).toBe(
          400,
        )
        expect((await send('PATCH', '/api/validations', {})).status).toBe(400)
      },
      { data },
    )
  })
})

describe('as rotas novas herdam as garantias das antigas', () => {
  it('os assets estáticos carregam SEM token, mas /api continua exigindo', async () => {
    // O navegador não propaga o `?token=` da URL da página para sub-recurso:
    // a folha de estilo, os módulos ES e os `.woff2` chegam sem nada. Exigir
    // token neles devolvia 401 em todos e o painel travava na tela de
    // carregamento justamente quando o token está configurado — a
    // configuração que existe para expor o painel fora de loopback.
    const data = new FakeData()
    await withDashboard(
      async ({ get }) => {
        expect((await get('/')).status).toBe(200)
        expect((await get('/app.css')).status).toBe(200)
        expect((await get('/app.js')).status).toBe(200)

        // O que tem dado do projeto continua protegido.
        expect((await get('/api/state')).status).toBe(401)
        expect((await get('/api/tasks')).status).toBe(401)
      },
      { data, token: 'segredo-do-painel' },
    )
  })

  it('nenhuma rota de escrita escapa do token', async () => {
    const data = new FakeData()
    data.taskList.push(makeTask())
    await withDashboard(
      async ({ get, send }) => {
        // Uma rota de escrita sem token seria pior que o problema que ela
        // resolve: o painel apaga task e grava config.
        expect((await get('/api/tasks')).status).toBe(401)
        expect((await send('POST', '/api/tasks', {})).status).toBe(401)
        expect((await send('PATCH', '/api/config', { path: 'a', value: 1 })).status).toBe(401)
        expect((await send('DELETE', '/api/backlog/item-1')).status).toBe(401)
        expect((await send('PATCH', '/api/validations', {}, 'errado')).status).toBe(401)
        expect(
          (await send('POST', '/api/claude-activity', { event: 'Stop', summary: 'x' })).status,
        ).toBe(401)
        expect(data.writes).toHaveLength(0)

        expect((await get('/api/tasks', 'segredo-do-painel')).status).toBe(200)
      },
      { data, token: 'segredo-do-painel' },
    )
  })

  it('redact também vale para as rotas novas', async () => {
    globalSecrets.register('senha-do-banco-987')
    try {
      const data = new FakeData()
      data.taskList.push(
        makeTask({ title: 'Corrigir login', intent: 'a senha é senha-do-banco-987' }),
      )
      data.itemList.push({
        id: 'item-1',
        title: 'token sk-ant-bbbbbbbbbbbbbbbbbbbbbbbb',
        body: '',
        labels: [],
        priority: 50,
        source: 'manual',
        state: 'open',
        createdAt: 1_000,
      })

      await withDashboard(
        async ({ get }) => {
          const tasks = await (await get('/api/tasks')).text()
          expect(tasks).not.toContain('senha-do-banco-987')
          expect(tasks).toContain('[REDACTED]')

          const backlog = await (await get('/api/backlog')).text()
          expect(backlog).not.toContain('sk-ant-bbbbbbbbbbbbbbbbbbbbbbbb')
        },
        { data },
      )
    } finally {
      globalSecrets.clear()
    }
  })
})

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', () => {
      resolve()
    })
    socket.once('error', reject)
  })
}

function waitForMessage(
  socket: WebSocket,
  predicate: (message: Record<string, unknown>) => boolean,
  timeoutMs = 5_000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('timeout esperando mensagem'))
    }, timeoutMs)
    socket.on('message', (raw: Buffer) => {
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(raw.toString('utf8')) as Record<string, unknown>
      } catch {
        return
      }
      if (predicate(parsed)) {
        clearTimeout(timer)
        resolve(parsed)
      }
    })
  })
}

describe('terminal embutido', () => {
  const ECHO_PROFILE = {
    claude: {
      command: process.execPath,
      args: ['-e', "process.stdout.write('sessao-pronta')"],
      cwd: process.cwd(),
    },
  }

  it('sem perfil configurado, GET lista vazio e POST devolve 503', async () => {
    await withDashboard(async ({ get, post }) => {
      const listed = (await (await get('/api/terminals')).json()) as {
        sessions: unknown[]
        profiles: string[]
      }
      expect(listed.sessions).toEqual([])
      expect(listed.profiles).toEqual([])

      expect((await post('/api/terminals', { profile: 'claude' })).status).toBe(503)
    })
  })

  it('cria, lista e fecha uma sessão pelo REST', async () => {
    await withDashboard(
      async ({ get, post, send }) => {
        const created = await post('/api/terminals', { profile: 'claude' })
        expect(created.status).toBe(201)
        const body = (await created.json()) as { session: { id: string; label: string } }
        expect(body.session.id).toBeTruthy()

        const listed = (await (await get('/api/terminals')).json()) as {
          sessions: { id: string }[]
        }
        expect(listed.sessions.map((s) => s.id)).toContain(body.session.id)

        const invalido = await post('/api/terminals', { profile: 'nao-existe' })
        expect(invalido.status).toBe(400)

        const fechada = await send('DELETE', `/api/terminals/${body.session.id}`)
        expect(fechada.status).toBe(200)
        const depois = (await (await get('/api/terminals')).json()) as { sessions: unknown[] }
        expect(depois.sessions).toEqual([])
      },
      { terminalProfiles: ECHO_PROFILE },
    )
  })

  it('WebSocket recebe a saída real do processo via /api/terminals/<id>/socket', async () => {
    await withDashboard(
      async ({ url, post }) => {
        const created = await post('/api/terminals', { profile: 'claude' })
        const { session } = (await created.json()) as { session: { id: string } }

        const wsUrl = `${url.replace('http', 'ws')}/api/terminals/${session.id}/socket`
        const socket = new WebSocket(wsUrl)
        await waitForOpen(socket)
        const message = await waitForMessage(
          socket,
          (m) => typeof m['data'] === 'string' && m['data'].includes('sessao-pronta'),
        )
        expect(message['type']).toBe('data')
        socket.close()
      },
      { terminalProfiles: ECHO_PROFILE },
    )
  })

  it('WebSocket exige token válido fora de loopback simulado por token configurado', async () => {
    await withDashboard(
      async ({ url, post }) => {
        const created = await post('/api/terminals', { profile: 'claude' }, 'segredo')
        const { session } = (await created.json()) as { session: { id: string } }

        const semToken = new WebSocket(`${url.replace('http', 'ws')}/api/terminals/${session.id}/socket`)
        const falhou = await new Promise<boolean>((resolve) => {
          semToken.once('error', () => {
            resolve(true)
          })
          semToken.once('open', () => {
            resolve(false)
          })
        })
        expect(falhou).toBe(true)

        const comToken = new WebSocket(
          `${url.replace('http', 'ws')}/api/terminals/${session.id}/socket?token=segredo`,
        )
        await waitForOpen(comToken)
        comToken.close()
      },
      { terminalProfiles: ECHO_PROFILE, token: 'segredo' },
    )
  })

  it('socket para sessão inexistente é fechado com código 4004', async () => {
    await withDashboard(
      async ({ url }) => {
        const socket = new WebSocket(`${url.replace('http', 'ws')}/api/terminals/nao-existe/socket`)
        const code = await new Promise<number>((resolve) => {
          socket.once('close', (c: number) => {
            resolve(c)
          })
        })
        expect(code).toBe(4004)
      },
      { terminalProfiles: ECHO_PROFILE },
    )
  })
})
