#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Command } from 'commander'
import { parse as parseYaml } from 'yaml'
import type { Task, TaskKind } from '@uranus/core'
import { formatMoney, newProjectId, newTaskId, systemClock } from '@uranus/core'
import { loadConfig } from '@uranus/config'
import { compose } from './composition.js'

/* eslint-disable no-console -- a CLI fala com o humano por stdout */

const program = new Command()
program.name('uranus').description('Uranus — Agentic Coding Harness Framework').version('0.1.0')

// ── init ────────────────────────────────────────────────────────────────────

program
  .command('init')
  .description('Inicializa .uranus/ no diretório atual')
  .option('--name <name>', 'nome do projeto')
  .action(async (options: { name?: string }) => {
    const dir = process.cwd()
    const uranusDir = join(dir, '.uranus')
    await mkdir(join(uranusDir, 'backlog'), { recursive: true })
    await mkdir(join(uranusDir, 'memory'), { recursive: true })
    // `.uranus/` invisível para o git do projeto desde o primeiro instante.
    const { ensureUranusIgnored } = await import('@uranus/executors')
    await ensureUranusIgnored(uranusDir)

    const name = options.name ?? dir.split(/[\\/]/).at(-1) ?? 'projeto'
    const configPath = join(uranusDir, 'config.yaml')
    const exists = await readFile(configPath, 'utf8').catch(() => undefined)
    if (exists !== undefined) {
      console.log(`Já existe: ${configPath}`)
      return
    }
    await writeFile(
      configPath,
      [
        'version: 1',
        'project:',
        `  name: ${name}`,
        'kernel:',
        '  concurrency: 1',
        'budget:',
        '  perRun: { usd: 10, tokens: 2000000, wallclockMs: 7200000 }',
        '  perTask: { usd: 2, tokens: 400000, wallclockMs: 900000 }',
        'providers:',
        '  default: claude-code',
        'integration:',
        '  strategy: pull-request',
        '  draftPullRequests: true',
        '',
      ].join('\n'),
    )
    console.log(`Criado: ${configPath}`)
    console.log('Próximo passo: uranus task add --file <task.yaml> && uranus start')
  })

// ── task ────────────────────────────────────────────────────────────────────

const task = program.command('task').description('Gerencia tasks')

task
  .command('add')
  .description('Adiciona uma task a partir de um arquivo YAML')
  .requiredOption('--file <path>', 'arquivo YAML da task')
  .action(async (options: { file: string }) => {
    await withComposition(async ({ composition }) => {
      const raw = await readFile(resolve(options.file), 'utf8')
      const parsed = parseYaml(raw) as {
        kind?: string
        title?: string
        intent?: string
        touches?: string[]
        acceptance?: { checks?: unknown[] }
        maxAttempts?: number
      }
      const now = systemClock.now()
      const newTask: Task = {
        id: newTaskId(now),
        projectId: composition.project.id,
        kind: (parsed.kind ?? 'feature') as TaskKind,
        title: parsed.title ?? 'sem título',
        intent: parsed.intent ?? '',
        state: 'ready',
        priority: 50,
        deps: [],
        touches: parsed.touches ?? [],
        acceptance: {
          checks: (parsed.acceptance?.checks ?? []) as Task['acceptance']['checks'],
          requireAll: true,
        },
        attempts: 0,
        maxAttempts: parsed.maxAttempts ?? 3,
        labels: [],
        createdAt: now,
        updatedAt: now,
      }
      const queued = await composition.deps.queue.enqueue(newTask)
      if (!queued.ok) {
        console.error(`ERRO: ${queued.error.message}`)
        process.exitCode = 1
        return
      }
      console.log(`Task enfileirada: ${newTask.id} — ${newTask.title}`)
    })
  })

task
  .command('list')
  .description('Lista tasks e estados')
  .action(async () => {
    await withComposition(async ({ composition }) => {
      const all = await composition.state.tasks.all()
      if (all.length === 0) {
        console.log('Nenhuma task.')
        return
      }
      for (const item of all) {
        const block = item.blockReason === undefined ? '' : ` [${item.blockReason.message}]`
        console.log(
          `${item.id}  ${item.state.padEnd(12)} ${item.kind.padEnd(9)} ${String(item.attempts)}/${String(item.maxAttempts)}  ${item.title}${block}`,
        )
      }
    })
  })

task
  .command('why <taskId>')
  .description('Explica por que uma task está (ou não) sendo escolhida')
  .action(async (taskId: string) => {
    await withComposition(async ({ composition }) => {
      const found = await composition.state.tasks.find(taskId as Task['id'])
      if (found === undefined) {
        console.error('Task não encontrada')
        process.exitCode = 1
        return
      }
      const { formatExplanation } = await import('@uranus/scheduler')
      const now = systemClock.now()
      const explanation = composition.deps.scheduler.explain(found, {
        now,
        stats: await composition.deps.queue.stats(),
        budget: composition.deps.budget.state(),
        activeLeases: await composition.deps.queue.activeLeases(now),
        recentOutcomes: [],
        mix: composition.config.scheduler.mix,
        observedMix: {},
        providerHealth: {},
        restrictedMode: false,
      })
      console.log(formatExplanation(explanation, `${found.title} (${found.state})`))
    })
  })

task
  .command('retry <taskId>')
  .description('Devolve uma task bloqueada para a fila')
  .action(async (taskId: string) => {
    await withComposition(async ({ composition }) => {
      const found = await composition.state.tasks.find(taskId as Task['id'])
      if (found === undefined) {
        console.error('Task não encontrada')
        process.exitCode = 1
        return
      }
      const { transition } = await import('@uranus/core')
      const moved = transition(found, 'ready', { at: systemClock.now() })
      if (!moved.ok) {
        console.error(`Transição inválida: ${moved.error.message}`)
        process.exitCode = 1
        return
      }
      await composition.state.tasks.save(moved.value)
      console.log(`Task ${taskId} devolvida à fila.`)
    })
  })

// ── backlog / plan ──────────────────────────────────────────────────────────

const backlog = program.command('backlog').description('Itens de backlog do projeto')

backlog
  .command('add <title>')
  .description('Adiciona um item ao backlog')
  .option('--body <text>', 'descrição do que precisa ser feito', '')
  .option('--label <label...>', 'labels')
  .option('--priority <n>', 'prioridade 0-100', (v) => Number.parseInt(v, 10), 50)
  .action(async (title: string, options: { body: string; label?: string[]; priority: number }) => {
    await withComposition(async ({ composition }) => {
      const added = await composition.backlog.add({
        title,
        body: options.body,
        labels: options.label ?? [],
        priority: options.priority,
        createdAt: systemClock.now(),
      })
      if (!added.ok) {
        console.error(`ERRO: ${added.error.message}`)
        process.exitCode = 1
        return
      }
      console.log(`Item criado: ${added.value.id}`)
      console.log(
        `Edite em .uranus/backlog/${added.value.id}.yaml ou rode: uranus plan ${added.value.id}`,
      )
    })
  })

backlog
  .command('list')
  .description('Lista itens do backlog')
  .action(async () => {
    await withComposition(async ({ composition }) => {
      const items = await composition.backlog.list()
      if (items.length === 0) {
        console.log('Backlog vazio. Use: uranus backlog add "título" --body "..."')
        return
      }
      for (const item of items) {
        const rejections =
          item.lastRejections === undefined ? '' : ` [rejeitado: ${item.lastRejections.length}]`
        console.log(
          `${item.id.padEnd(40)} ${item.state.padEnd(8)} p${String(item.priority).padStart(3)}  ${item.title}${rejections}`,
        )
      }
    })
  })

backlog
  .command('import <path>')
  .description('Importa itens de um arquivo Markdown (listas e seções)')
  .action(async (path: string) => {
    await withComposition(async ({ composition }) => {
      const { readMarkdownBacklog } = await import('@uranus/backlog')
      const parsed = await readMarkdownBacklog(resolve(path))
      if (parsed.length === 0) {
        console.log('Nenhum item reconhecido no arquivo.')
        return
      }
      const result = await composition.backlog.importItems(
        parsed.map((item) => ({ ...item, source: 'file' as const })),
        systemClock.now(),
      )
      console.log(
        `Importados: ${String(result.imported)} · ignorados (já existiam): ${String(result.skipped)}`,
      )
    })
  })

program
  .command('plan <itemId>')
  .description('Planeja um item de backlog, transformando-o em tasks')
  .option('--dry-run', 'valida o plano sem enfileirar as tasks')
  .action(async (itemId: string, options: { dryRun?: boolean }) => {
    await withComposition(async ({ composition }) => {
      const item = await composition.backlog.get(itemId)
      if (item === undefined) {
        console.error(`Item "${itemId}" não encontrado. Veja: uranus backlog list`)
        process.exitCode = 1
        return
      }
      if (options.dryRun === true) {
        console.log('--dry-run ainda invoca o Planner (custa tokens), mas não enfileira nada.')
      }

      const digest = await composition.contextManager.digest(composition.project)
      console.log(`Planejando "${item.title}"…`)

      const result = await composition.planning.planItem(item, digest, new AbortController().signal)
      if (!result.ok) {
        console.error(`\nPlano rejeitado: ${result.error.message}`)
        const { isUranusError } = await import('@uranus/core')
        const rejections = isUranusError(result.error)
          ? result.error.context['rejections']
          : undefined
        if (Array.isArray(rejections)) {
          for (const rejection of rejections) console.error(`  • ${String(rejection)}`)
        }
        await composition.backlog.update({
          ...item,
          lastRejections: Array.isArray(rejections) ? rejections.map(String) : [],
        })
        process.exitCode = 1
        return
      }

      console.log(`\n${result.value.summary}\n`)
      for (const task of result.value.created) {
        console.log(`  ${task.id}  ${task.kind.padEnd(9)} ${task.title}`)
        console.log(`    escopo: ${task.touches.join(', ')}`)
        console.log(`    checks: ${task.acceptance.checks.map((c) => c.kind).join(', ')}`)
      }
      await composition.backlog.update({ ...item, state: 'planned', planId: result.value.planId })
      console.log(`\n${String(result.value.created.length)} task(s) na fila. Rode: uranus start`)
    })
  })

// ── providers ───────────────────────────────────────────────────────────────

const provider = program.command('provider').description('Modelos e roteamento')

provider
  .command('list')
  .description('Lista providers registrados e o roteamento por papel')
  .action(async () => {
    await withComposition(({ composition }) => {
      const registered = composition.deps.providers.list()
      if (registered.length === 0) {
        console.log('Nenhum provider registrado.')
        return Promise.resolve()
      }

      console.log('Providers:')
      for (const entry of registered) {
        const caps = entry.capabilities
        console.log(
          `  ${entry.id.padEnd(14)} ${entry.kind.padEnd(4)} ${
            caps.nativeFileEditing ? 'edita arquivos' : 'ferramentas via Uranus'
          } · contexto ${String(caps.maxContextTokens)} · ${String(caps.maxConcurrentSessions)} sessão(ões)`,
        )
      }

      const byAgent = composition.config.providers.byAgent
      const byTier = composition.config.providers.byTier
      if (Object.keys(byAgent).length > 0 || Object.keys(byTier).length > 0) {
        console.log('\nRoteamento:')
        for (const [agent, id] of Object.entries(byAgent)) {
          console.log(`  agente ${agent.padEnd(12)} → ${id}`)
        }
        for (const [tier, id] of Object.entries(byTier)) {
          console.log(`  tier   ${tier.padEnd(12)} → ${id}`)
        }
      }
      console.log(`\nPadrão: ${composition.config.providers.default}`)
      return Promise.resolve()
    })
  })

provider
  .command('test [providerId]')
  .description('Testa a conectividade dos providers (health check)')
  .action(async (providerId?: string) => {
    await withComposition(async ({ composition }) => {
      const alvos = composition.deps.providers
        .list()
        .filter((entry) => providerId === undefined || entry.id === providerId)

      if (alvos.length === 0) {
        console.error(
          providerId === undefined
            ? 'Nenhum provider registrado.'
            : `Provider "${providerId}" não registrado.`,
        )
        process.exitCode = 1
        return
      }

      let algumFalhou = false
      for (const entry of alvos) {
        const report = await entry.health(new AbortController().signal)
        console.log(
          `  ${report.healthy ? 'OK   ' : 'FALHA'} ${entry.id.padEnd(14)} ${report.detail}`,
        )
        if (!report.healthy) algumFalhou = true
      }
      if (algumFalhou) process.exitCode = 1
    })
  })

provider
  .command('why <agente>')
  .description('Mostra qual provider seria escolhido para um agente e por quê')
  .action(async (agente: string) => {
    await withComposition(async ({ composition }) => {
      const spec = composition.deps.agents.get(agente)
      if (spec === undefined) {
        console.error(
          `Agente "${agente}" não registrado. Disponíveis: ${composition.deps.agents
            .list()
            .map((s) => s.name)
            .join(', ')}`,
        )
        process.exitCode = 1
        return
      }
      const { ProviderRouter } = await import('@uranus/providers')
      if (composition.deps.providers instanceof ProviderRouter) {
        console.log(
          composition.deps.providers.explain({
            agent: agente,
            ...(spec.model?.tier === undefined ? {} : { tier: spec.model.tier }),
          }),
        )
      }
      const resolved = composition.deps.providers.resolve({
        agent: agente,
        ...(spec.model?.tier === undefined ? {} : { tier: spec.model.tier }),
        ...(spec.requires === undefined ? {} : { capabilities: spec.requires }),
      })
      console.log(
        resolved.ok
          ? `\nEscolhido: ${resolved.value.id}`
          : `\nNenhum provider satisfaz: ${resolved.error.message}`,
      )
    })
  })

// ── context / memory ────────────────────────────────────────────────────────

const context = program.command('context').description('Contexto do projeto (ProjectDigest)')

context
  .command('show')
  .description('Mostra o digest atual do projeto')
  .action(async () => {
    await withComposition(async ({ composition }) => {
      const digest = await composition.contextManager.digest(composition.project)
      if (digest === undefined) {
        console.log('Sem digest. Rode: uranus context rebuild')
        return
      }
      console.log(digest.summary)
      console.log('')
      console.log(
        `Linguagens : ${digest.languages.map((l) => `${l.name} ${String(Math.round(l.share * 100))}%`).join(', ') || '—'}`,
      )
      console.log(`Frameworks : ${digest.frameworks.join(', ') || '—'}`)
      console.log(
        `Testes     : ${digest.tests.runner ?? '—'}${digest.tests.command === undefined ? '' : ` (${digest.tests.command})`} · ${String(digest.tests.count ?? 0)} arquivo(s)`,
      )
      console.log(`CI         : ${digest.ci.provider ?? '—'}`)
      console.log(
        `Banco      : ${[digest.database.engine, digest.database.orm].filter(Boolean).join(' + ') || '—'}`,
      )
      console.log(`Convenções : ${digest.conventions.join(', ') || '—'}`)
      console.log(`Freshness  : ${digest.freshness.slice(0, 16)}…`)
    })
  })

context
  .command('rebuild')
  .description('Reconstrói o digest do zero (ignora o cache)')
  .action(async () => {
    await withComposition(async ({ composition }) => {
      composition.contextManager.invalidate()
      const digest = await composition.contextManager.bootstrap(
        composition.project,
        new AbortController().signal,
      )
      console.log('Digest reconstruído.')
      console.log(digest.summary)
    })
  })

const memory = program.command('memory').description('Memória persistente do projeto')

memory
  .command('list')
  .description('Lista registros ativos de memória')
  .option('--scope <scope>', 'filtra por escopo')
  .action(async (options: { scope?: string }) => {
    await withComposition(async ({ composition }) => {
      const records = await composition.memoryStore.query({
        ...(options.scope === undefined ? {} : { scopes: [options.scope as never] }),
        limit: 100,
      })
      if (records.length === 0) {
        console.log('Nenhuma memória registrada.')
        return
      }
      for (const record of records) {
        console.log(
          `${record.id}  [${record.scope.padEnd(12)}] conf=${record.confidence.toFixed(2)}  ${record.title}`,
        )
      }
      console.log(`\nArquivos em .uranus/memory/ — edite à vontade; o Uranus respeita a edição.`)
    })
  })

memory
  .command('show <idOrKey>')
  .description('Mostra um registro completo')
  .action(async (idOrKey: string) => {
    await withComposition(async ({ composition }) => {
      const { asMemoryId } = await import('@uranus/core')
      let record
      try {
        record = await composition.memoryStore.get(asMemoryId(idOrKey))
      } catch {
        const all = await composition.memoryStore.query({ limit: 500 })
        record = all.find((r) => r.key === idOrKey)
      }
      if (record === undefined) {
        console.error('Registro não encontrado.')
        process.exitCode = 1
        return
      }
      console.log(`# ${record.title}`)
      console.log(
        `escopo=${record.scope} chave=${record.key} confiança=${String(record.confidence)}`,
      )
      console.log(`fonte=${record.source.kind}:${record.source.ref}`)
      console.log('')
      console.log(record.body)
    })
  })

memory
  .command('compact')
  .description('Revalida referências e compacta escopos acima do orçamento')
  .action(async () => {
    await withComposition(async ({ composition }) => {
      const reports = await composition.deps.memoryManager.maintain(new AbortController().signal)
      if (reports.length === 0) {
        console.log('Nada a compactar.')
        return
      }
      for (const report of reports) {
        console.log(
          `${report.scope}: ${String(report.before)} → ${String(report.after)} registros (${String(report.merged.length)} fundidos)`,
        )
      }
    })
  })

// ── start / status / logs ───────────────────────────────────────────────────

program
  .command('start')
  .description('Inicia o kernel e trabalha até drenar a fila')
  .option('--max-tasks <n>', 'máximo de tasks a completar', (v) => Number.parseInt(v, 10))
  .option('--resume <runId>', 'retoma um run interrompido')
  .action(async (options: { maxTasks?: number; resume?: string }) => {
    await withComposition(async ({ composition }) => {
      const { asRunId } = await import('@uranus/core')
      const unsub = composition.kernel.events.onAny((event) => {
        console.log(`  ${event.name}${event.taskId === undefined ? '' : ` ${event.taskId}`}`)
      })
      const started = await composition.kernel.start({
        projectId: composition.project.id,
        ...(options.maxTasks === undefined ? {} : { maxTasks: options.maxTasks }),
        ...(options.resume === undefined ? {} : { resumeRunId: asRunId(options.resume) }),
      })
      if (!started.ok) {
        console.error(`Falha ao iniciar: ${started.error.message}`)
        process.exitCode = 1
        return
      }
      console.log(`Run: ${started.value}`)

      const stop = (): void => {
        void composition.kernel.stop('interrompido pelo usuário (SIGINT)')
      }
      process.on('SIGINT', stop)
      await composition.kernel.wait()
      process.off('SIGINT', stop)
      unsub()

      const budget = composition.kernel.status().budget
      console.log(
        `Encerrado. Custo do run: ${formatMoney(budget.run.usedCost)} · tokens: ${String(budget.run.usedTokens)}`,
      )
    })
  })

program
  .command('status')
  .description('Mostra o estado da fila e do último run')
  .action(async () => {
    await withComposition(async ({ composition }) => {
      const stats = await composition.deps.queue.stats()
      const latest = await composition.state.runs.latest()
      console.log(`Tasks: ${String(stats.total)}`)
      for (const [state, count] of Object.entries(stats.byState)) {
        if (count > 0) console.log(`  ${state.padEnd(12)} ${String(count)}`)
      }
      if (latest !== undefined) {
        console.log(
          `Último run: ${latest.id} — ${latest.status} (${String(latest.tick)} ticks)${latest.stopReason === undefined ? '' : ` — ${latest.stopReason}`}`,
        )
      }
    })
  })

program
  .command('logs')
  .description('Mostra os últimos eventos do log')
  .option('--tail <n>', 'quantidade', (v) => Number.parseInt(v, 10), 50)
  .action(async (options: { tail: number }) => {
    await withComposition(async ({ composition }) => {
      const head = await composition.eventStore.head()
      const from = Math.max(1, head - options.tail + 1)
      for await (const event of composition.eventStore.read(from)) {
        console.log(
          `${String(event.seq).padStart(6)} ${new Date(event.at).toISOString()} ${event.name}${event.taskId === undefined ? '' : ` ${event.taskId}`}`,
        )
      }
    })
  })

// ── doctor ──────────────────────────────────────────────────────────────────

program
  .command('doctor')
  .description('Diagnostica ambiente, git e providers')
  .action(async () => {
    const { execFileSync } = await import('node:child_process')
    const check = (label: string, fn: () => string): void => {
      try {
        console.log(`  OK   ${label}: ${fn().split('\n')[0] ?? ''}`)
      } catch {
        console.log(`  FALHA ${label}`)
        process.exitCode = 1
      }
    }
    console.log('Ambiente:')
    check('node', () => process.version)
    check('git', () => execFileSync('git', ['--version'], { encoding: 'utf8' }))
    // Mesmo localizador que o provider usa em runtime: o doctor testa o que o
    // kernel vai de fato executar, não apenas o PATH do shell atual.
    const { locateClaudeBinary } = await import('@uranus/providers')
    const claudeBin = locateClaudeBinary()
    check(`claude (${claudeBin})`, () =>
      execFileSync(claudeBin, ['--version'], { encoding: 'utf8' }),
    )
    try {
      const { execSync } = await import('node:child_process')
      execSync('gh --version', { encoding: 'utf8', stdio: 'pipe' })
      console.log('  OK   gh')
    } catch {
      console.log('  AVISO gh ausente — PRs não serão abertos; commits ficam na branch local.')
      console.log('        Instale com: winget install GitHub.cli && gh auth login')
    }

    const loaded = await loadConfig({ projectDir: process.cwd() })
    if (!loaded.ok) {
      console.log(`  FALHA config: ${loaded.error.message.split('\n')[0] ?? ''}`)
      process.exitCode = 1
      return
    }
    console.log(`  OK   config: projeto "${loaded.value.config.project.name}"`)

    // Providers configurados: conectividade real, não só "existe no PATH".
    const composition = await compose({ projectDir: process.cwd(), config: loaded.value.config })
    try {
      const registered = composition.deps.providers.list()
      if (registered.length > 0) {
        console.log('\nProviders:')
        for (const entry of registered) {
          const report = await entry.health(new AbortController().signal)
          console.log(
            `  ${report.healthy ? 'OK   ' : 'FALHA'} ${entry.id.padEnd(14)} ${report.detail.split('\n')[0] ?? ''}`,
          )
          if (!report.healthy) process.exitCode = 1
        }
      }
    } finally {
      await composition.close()
    }
  })

// ── infra ───────────────────────────────────────────────────────────────────

async function withComposition(
  fn: (context: { composition: Awaited<ReturnType<typeof compose>> }) => Promise<void>,
): Promise<void> {
  const loaded = await loadConfig({ projectDir: process.cwd() })
  if (!loaded.ok) {
    console.error(loaded.error.message)
    process.exitCode = 1
    return
  }
  const composition = await compose({
    projectDir: process.cwd(),
    config: loaded.value.config,
  })
  try {
    await fn({ composition })
  } finally {
    await composition.close()
  }
}

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

// projectId estável viria do attach; MVP gera por execução quando necessário.
void newProjectId
