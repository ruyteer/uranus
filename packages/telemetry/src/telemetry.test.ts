import { describe, expect, it } from 'vitest'
import type { EventBus, ModelPricing } from '@uranus/core'
import { formatMoney, globalSecrets, moneyToNumber, priceUsage, usd } from '@uranus/core'
import { InProcessEventBus, JsonlEventStore } from '@uranus/events'
import { FakeClock, RecordingLogger, withTempDir } from '@uranus/testkit'
import { newProjectId, newSessionId, newTaskId } from '@uranus/core'
import { DefaultCostAccountant } from './cost.js'
import { DefaultTelemetry } from './metrics.js'
import { DefaultPricingTable, createPricingTable } from './pricing.js'
import { attachCostAccounting, attachOperationalMetrics } from './accounting.js'
import { TelemetryAggregator } from './aggregator.js'

const USAGE = { input: 1_000_000, output: 100_000, cacheRead: 0, cacheWrite: 0, reasoning: 0 }

describe('DefaultPricingTable', () => {
  it('devolve o preço vigente na data, não o mais recente', () => {
    const table = new DefaultPricingTable()
    const antigo: ModelPricing = {
      model: 'x',
      inputPerMillion: 10,
      outputPerMillion: 20,
      cacheReadPerMillion: 0,
      cacheWritePerMillion: 0,
      effectiveFrom: Date.UTC(2024, 0, 1),
    }
    const novo: ModelPricing = {
      ...antigo,
      inputPerMillion: 3,
      effectiveFrom: Date.UTC(2025, 0, 1),
    }
    table.register('p', antigo)
    table.register('p', novo)

    // Um run de 2024 precisa ser reprecificado com o preço de 2024, ou o
    // histórico de custo muda sozinho a cada reajuste do provider.
    expect(table.lookup('p', 'x', Date.UTC(2024, 5, 1))?.inputPerMillion).toBe(10)
    expect(table.lookup('p', 'x', Date.UTC(2025, 5, 1))?.inputPerMillion).toBe(3)
    expect(table.lookup('p', 'x', Date.UTC(2023, 0, 1))).toBeUndefined()
  })

  it('casa família de modelo com sufixo de data e prefere o padrão mais específico', () => {
    const table = createPricingTable()
    const sonnet = table.lookup('anthropic', 'claude-sonnet-4-5-20250929', Date.now())
    const opus = table.lookup('anthropic', 'claude-opus-4-1-20250805', Date.now())
    expect(sonnet?.inputPerMillion).toBe(3)
    expect(opus?.inputPerMillion).toBe(15)
  })

  it('modelo local tem preço zero — e isso é uma afirmação, não uma lacuna', () => {
    const table = createPricingTable()
    const pricing = table.lookup('ollama', 'qwen2.5-coder:14b', Date.now())
    expect(pricing).toBeDefined()
    expect(priceUsage(USAGE, pricing!).micros).toBe(0)
    // Modelo desconhecido em provider desconhecido devolve undefined: "não sei"
    // é diferente de "de graça".
    expect(table.lookup('provider-inexistente', 'modelo-inexistente', Date.now())).toBeUndefined()
  })

  it('override do usuário vence o embutido com a mesma vigência', () => {
    const table = createPricingTable({
      anthropic: [
        {
          model: 'claude-sonnet',
          inputPerMillion: 99,
          outputPerMillion: 99,
          cacheReadPerMillion: 0,
          cacheWritePerMillion: 0,
          effectiveFrom: Date.UTC(2025, 0, 1),
        },
      ],
    })
    expect(table.lookup('anthropic', 'claude-sonnet-4-5', Date.now())?.inputPerMillion).toBe(99)
  })

  it('a aritmética de preço bate com o cálculo manual', () => {
    // 1M de entrada a $3 + 100k de saída a $15 = 3 + 1,5 = $4,50
    const pricing = createPricingTable().lookup('anthropic', 'claude-sonnet-4', Date.now())!
    expect(moneyToNumber(priceUsage(USAGE, pricing))).toBeCloseTo(4.5, 6)
  })
})

describe('DefaultCostAccountant', () => {
  function accountant(): DefaultCostAccountant {
    return new DefaultCostAccountant({ pricing: createPricingTable() })
  }

  it('agrega por task, agente, modelo e dia', () => {
    const cost = accountant()
    const taskA = newTaskId(1)
    const taskB = newTaskId(2)
    const at = Date.UTC(2026, 0, 15, 12)

    cost.record({
      at,
      taskId: taskA,
      agent: 'executor',
      provider: 'claude-code',
      model: 'sonnet',
      usage: USAGE,
      cost: usd(1),
    })
    cost.record({
      at,
      taskId: taskA,
      agent: 'reviewer',
      provider: 'ollama',
      model: 'qwen',
      usage: USAGE,
      cost: usd(0),
    })
    cost.record({
      at,
      taskId: taskB,
      agent: 'executor',
      provider: 'claude-code',
      model: 'sonnet',
      usage: USAGE,
      cost: usd(2),
    })

    expect(moneyToNumber(cost.byTask(taskA))).toBe(1)
    expect(moneyToNumber(cost.byAgent('executor'))).toBe(3)
    expect(moneyToNumber(cost.byDay(at))).toBe(3)
    expect(moneyToNumber(cost.total())).toBe(3)
    expect(cost.breakdownByAgent()[0]?.key).toBe('executor')
    expect(cost.breakdownByModel().map((row) => row.key)).toContain('ollama/qwen')
  })

  it('projeta pelo custo médio por task concluída, não por chamada', () => {
    const cost = accountant()
    const task = newTaskId(1)
    // Uma task que precisou de três sessões custou $6 no total.
    for (const value of [3, 2, 1]) {
      cost.record({
        at: 1,
        taskId: task,
        agent: 'executor',
        provider: 'p',
        model: 'm',
        usage: USAGE,
        cost: usd(value),
      })
    }
    cost.recordTaskCompleted(task)
    // 10 tasks restantes × $6 por task = $60. Dividir por chamada daria $20.
    expect(moneyToNumber(cost.project(10))).toBeCloseTo(60, 6)
  })

  it('sem task concluída ainda, projeta em vez de devolver zero', () => {
    const cost = accountant()
    cost.record({ at: 1, agent: 'executor', provider: 'p', model: 'm', usage: USAGE, cost: usd(1) })
    expect(moneyToNumber(cost.project(2))).toBeGreaterThan(0)
    expect(moneyToNumber(cost.project(0))).toBe(0)
  })

  it('reconcilia contra a fatura com tolerância de 3%', () => {
    const cost = accountant()
    cost.record({
      at: 1,
      agent: 'executor',
      provider: 'p',
      model: 'm',
      usage: USAGE,
      cost: usd(10),
    })

    expect(cost.reconcile(10).withinTolerance).toBe(true)
    expect(cost.reconcile(10.2).withinTolerance).toBe(true)
    const fora = cost.reconcile(8)
    expect(fora.withinTolerance).toBe(false)
    expect(fora.deltaRatio).toBeCloseTo(0.25, 4)
  })

  it('descarta detalhe antigo sem perder o total', () => {
    const cost = new DefaultCostAccountant({ pricing: createPricingTable(), maxEntries: 10 })
    for (let index = 0; index < 100; index++) {
      cost.record({
        at: index,
        agent: 'executor',
        provider: 'p',
        model: 'm',
        usage: USAGE,
        cost: usd(1),
      })
    }
    expect(cost.stats().entries).toBe(10)
    expect(cost.stats().dropped).toBe(90)
    // O agregado é o que importa: o total continua exato.
    expect(moneyToNumber(cost.total())).toBe(100)
  })
})

describe('DefaultTelemetry', () => {
  it('percentis são exatos onde precisam ser e a contagem nunca é amostrada', async () => {
    const telemetry = new DefaultTelemetry({ clock: new FakeClock(0), reservoirSize: 50 })
    for (let index = 1; index <= 1_000; index++) telemetry.histogram('t', index)

    const snapshot = await telemetry.snapshot()
    const summary = snapshot.histograms['t']!
    expect(summary.count).toBe(1_000)
    expect(summary.min).toBe(1)
    expect(summary.max).toBe(1_000)
    expect(summary.sum).toBe(500_500)
    // p95 vem de uma amostra de 50; exigir precisão cirúrgica seria testar o
    // gerador aleatório. Exigimos que esteja na metade de cima.
    expect(summary.p95).toBeGreaterThan(400)
  })

  it('limita a cardinalidade em vez de crescer sem fim', async () => {
    const logger = new RecordingLogger()
    const telemetry = new DefaultTelemetry({
      clock: new FakeClock(0),
      logger: logger.logger,
      maxSeries: 5,
    })
    for (let index = 0; index < 50; index++) {
      telemetry.counter('c', 1, { taskId: `tsk_${String(index)}` })
    }
    const snapshot = await telemetry.snapshot()
    expect(Object.keys(snapshot.counters).length).toBeLessThanOrEqual(6)
    expect(Object.keys(snapshot.counters)).toContain('c{overflow}')
    expect(logger.has('warn', 'Cardinalidade')).toBe(true)
  })

  it('spans aninhados compartilham o trace e encadeiam o pai', async () => {
    const telemetry = new DefaultTelemetry({ clock: new FakeClock(0) })
    await telemetry.span('tick', async () => {
      await telemetry.span('execute', () => Promise.resolve())
      await telemetry.span('verify', () => Promise.resolve())
    })
    const spans = telemetry.spans()
    const tick = spans.find((span) => span.name === 'tick')!
    const execute = spans.find((span) => span.name === 'execute')!
    expect(execute.traceId).toBe(tick.traceId)
    expect(execute.parentSpanId).toBe(tick.spanId)
    expect(tick.parentSpanId).toBeUndefined()
  })

  it('erro que sobe pelo span é registrado mesmo sem recordError explícito', async () => {
    const telemetry = new DefaultTelemetry({ clock: new FakeClock(0) })
    await expect(
      telemetry.span('quebra', () => Promise.reject(new Error('estourou'))),
    ).rejects.toThrow('estourou')
    expect(telemetry.spans()[0]?.error).toBe('estourou')
  })
})

// ── Integração com o barramento ─────────────────────────────────────────────

async function withBus<T>(
  fn: (context: {
    events: EventBus
    clock: FakeClock
    cost: DefaultCostAccountant
    telemetry: DefaultTelemetry
    aggregator: TelemetryAggregator
  }) => Promise<T>,
): Promise<T> {
  return withTempDir(async (dir) => {
    // Depois de `effectiveFrom` da tabela embutida: em 2023 nenhum preço vigia.
    const clock = new FakeClock(Date.UTC(2026, 5, 1))
    const logger = new RecordingLogger()
    const store = await JsonlEventStore.open({ dir })
    const events = new InProcessEventBus({
      store,
      clock,
      logger: logger.logger,
      projectId: newProjectId(1),
    })
    const telemetry = new DefaultTelemetry({ clock })
    const cost = new DefaultCostAccountant({ pricing: createPricingTable() })
    const aggregator = new TelemetryAggregator({
      clock,
      events,
      cost,
      telemetry,
    })
    attachCostAccounting({ events, cost, telemetry, logger: logger.logger })
    attachOperationalMetrics({ events, telemetry })
    aggregator.start()
    try {
      return await fn({ events, clock, cost, telemetry, aggregator })
    } finally {
      aggregator.stop()
      await store.close()
    }
  })
}

describe('contabilidade a partir do log de eventos', () => {
  it('conta o Executor E os gates — o gasto que antes ficava invisível', async () => {
    await withBus(async ({ events, cost }) => {
      const taskId = newTaskId(1)
      const sessions = [
        { agent: 'executor', cost: usd(0.5) },
        { agent: 'reviewer', cost: usd(0.2) },
        { agent: 'security', cost: usd(0.2) },
      ]

      for (const session of sessions) {
        const sessionId = newSessionId()
        await events.emit(
          'AgentRunStarted',
          {
            sessionId,
            attemptId: 'att_x' as never,
            agent: session.agent,
            provider: 'claude-code',
            model: 'claude-sonnet-4',
            contextDigest: 'd',
          },
          { taskId },
        )
        await events.emit(
          'AgentRunFinished',
          { sessionId, status: 'completed', turns: 3, usage: USAGE, cost: session.cost },
          { taskId },
        )
      }

      // O total inclui a cadeia de qualidade: $0,50 do Executor mais $0,40 dos
      // dois gates. Antes da Fase 7 o relatório mostraria só os $0,50.
      expect(moneyToNumber(cost.total())).toBeCloseTo(0.9, 6)
      expect(moneyToNumber(cost.byAgent('reviewer'))).toBeCloseTo(0.2, 6)
      expect(moneyToNumber(cost.byTask(taskId))).toBeCloseTo(0.9, 6)
    })
  })

  it('cai na tabela de preços quando o provider não reporta custo', async () => {
    await withBus(async ({ events, cost }) => {
      const sessionId = newSessionId()
      await events.emit('AgentRunStarted', {
        sessionId,
        attemptId: 'att_x' as never,
        agent: 'executor',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5-20250929',
        contextDigest: 'd',
      })
      await events.emit('AgentRunFinished', {
        sessionId,
        status: 'completed',
        turns: 1,
        usage: USAGE,
        cost: usd(0),
      })
      expect(moneyToNumber(cost.total())).toBeCloseTo(4.5, 6)
    })
  })

  it('sessão sem Started não é contabilizada com dados inventados', async () => {
    await withBus(async ({ events, cost }) => {
      await events.emit('AgentRunFinished', {
        sessionId: newSessionId(),
        status: 'completed',
        turns: 1,
        usage: USAGE,
        cost: usd(5),
      })
      expect(moneyToNumber(cost.total())).toBe(0)
    })
  })
})

describe('TelemetryAggregator', () => {
  it('monta o estado vivo a partir dos eventos', async () => {
    await withBus(async ({ events, aggregator, clock }) => {
      const taskId = newTaskId(1)
      await events.emit('KernelStarted', { runId: 'run_1' as never, concurrency: 1 })
      await events.emit('TaskCreated', { taskId, kind: 'feature', title: 'Adicionar login' })
      await events.emit('TaskStarted', {
        taskId,
        attemptId: 'att_1' as never,
        agent: 'executor',
        provider: 'claude-code',
      })
      clock.advance(1_000)
      await events.emit('CheckPassed', {
        taskId,
        result: { checkId: 'c', kind: 'tests', passed: true, advisory: false, durationMs: 10 },
      })
      await events.emit('TaskCompleted', { taskId, attempts: 1, totalCost: usd(1.25) })

      const snapshot = aggregator.snapshot() as Record<string, never>
      const tasks = snapshot['tasks'] as unknown as { id: string; state: string; title: string }[]
      expect(tasks[0]?.state).toBe('done')
      expect(tasks[0]?.title).toBe('Adicionar login')
      expect((snapshot['run'] as unknown as { status: string }).status).toBe('running')
      expect((snapshot['queue'] as unknown as { remaining: number }).remaining).toBe(0)
      expect((snapshot['quality'] as unknown as { passRate: number }).passRate).toBe(1)
      expect((snapshot['timeline'] as unknown as unknown[]).length).toBeGreaterThan(0)
    })
  })

  it('classifica severidade para que a timeline seja legível de relance', async () => {
    await withBus(async ({ events, aggregator }) => {
      await events.emit('TaskBlocked', {
        taskId: newTaskId(1),
        kind: 'exhausted',
        message: 'tentativas esgotadas',
        resolvableBy: 'humano',
      })
      const entry = aggregator.recentTimeline(1)[0]
      expect(entry?.severity).toBe('error')
      expect(entry?.summary).toBe('tentativas esgotadas')
    })
  })

  it('expõe métricas em formato Prometheus', async () => {
    await withBus(async ({ events, aggregator }) => {
      await events.emit('TaskCompleted', { taskId: newTaskId(1), attempts: 2, totalCost: usd(1) })
      const text = await aggregator.prometheus()
      expect(text).toContain('uranus_task_completed')
      expect(text).toContain('uranus_cost_total_usd')
      // Nome inválido em Prometheus quebraria o scrape inteiro.
      for (const line of text.trim().split('\n')) {
        expect(line).toMatch(/^[a-zA-Z_][a-zA-Z0-9_]*(\{.*\})? -?[\d.e+]+$/)
      }
    })
  })

  it('não deixa um evento malformado derrubar o barramento', async () => {
    await withBus(async ({ events, aggregator }) => {
      // Payload sem os campos que o agregador espera.
      await events.emit('CommitCreated', {} as never)
      await events.emit('TaskCompleted', { taskId: newTaskId(1), attempts: 1, totalCost: usd(1) })
      // O segundo evento chegou: o primeiro não interrompeu nada.
      expect(aggregator.recentTimeline(2).map((entry) => entry.name)).toContain('TaskCompleted')
    })
  })
})

describe('redação de segredos (DoD: nunca em log, evento ou UI)', () => {
  it('segredo em título de task e em mensagem de bloqueio não sai no snapshot', async () => {
    globalSecrets.register('super-secreto-do-usuario')
    try {
      await withBus(async ({ events, aggregator }) => {
        const taskId = newTaskId(1)
        await events.emit('TaskCreated', {
          taskId,
          kind: 'chore',
          title: 'usar a chave sk-ant-abcdefghijklmnopqrstuvwxyz123456',
        })
        await events.emit('TaskBlocked', {
          taskId,
          kind: 'auth',
          message: 'falhou com super-secreto-do-usuario e ghp_abcdefghijklmnopqrstuvwxyz1234',
          resolvableBy: 'humano',
        })

        const json = JSON.stringify(aggregator.snapshot())
        expect(json).not.toContain('sk-ant-abcdefghijklmnopqrstuvwxyz123456')
        expect(json).not.toContain('super-secreto-do-usuario')
        expect(json).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz1234')
        expect(json).toContain('[REDACTED]')
      })
    } finally {
      globalSecrets.clear()
    }
  })

  it('formatMoney continua legível — o painel mostra dinheiro, não micros', () => {
    expect(formatMoney(usd(1.2345))).toBe('$1.2345')
  })
})
