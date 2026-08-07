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
    check('claude', () =>
      execFileSync('claude', ['--version'], {
        encoding: 'utf8',
        shell: process.platform === 'win32',
      }),
    )
    check('gh', () =>
      execFileSync('gh', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' }),
    )

    const loaded = await loadConfig({ projectDir: process.cwd() })
    if (loaded.ok) {
      console.log(`  OK   config: projeto "${loaded.value.config.project.name}"`)
    } else {
      console.log(`  FALHA config: ${loaded.error.message.split('\n')[0] ?? ''}`)
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
