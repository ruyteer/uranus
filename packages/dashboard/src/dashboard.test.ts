import { describe, expect, it } from 'vitest'
import type { ApprovalRequest, EventBus, HumanGate } from '@uranus/core'
import {
  globalSecrets,
  newApprovalId,
  newProjectId,
  newSessionId,
  newTaskId,
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
import { DashboardServer, uiPath } from './server.js'
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

async function withDashboard<T>(
  fn: (harness: Harness) => Promise<T>,
  options: { token?: string } = {},
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

      const html = await response.text()
      expect(html).toContain('URANUS')
      // Autocontido de verdade: nada de script, fonte ou folha de estilo
      // externa. É o que faz o CSP acima ser cumprível em vez de decorativo.
      expect(html).not.toMatch(/<script[^>]+src=/)
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
