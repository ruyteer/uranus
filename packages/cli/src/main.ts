#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Command } from 'commander'
import { parseDocument } from 'yaml'
import type { Logger, ProjectDigest } from '@uranus/core'
import { MEMORY_SCOPES, createLogger, formatMoney, newProjectId, systemClock } from '@uranus/core'
import type { BacklogItemState } from '@uranus/backlog'
import type { ConfigLayer, UranusConfig } from '@uranus/config'
import { loadConfig } from '@uranus/config'
import { compose } from './composition.js'
import { renderValidations } from './task-view.js'
import {
  BACKLOG_STATE_LABEL,
  parseLabels,
  parsePriority,
  renderBacklogList,
  renderBacklogShow,
} from './backlog-view.js'
import type { InstructionNote } from './instructions.js'

/* eslint-disable no-console -- a CLI fala com o humano por stdout */

const program = new Command()
program.name('uranus').description('Uranus — Agentic Coding Harness Framework').version('0.1.0')

// ── init ────────────────────────────────────────────────────────────────────

program
  .command('init')
  .description('Inicializa .uranus/ no diretório atual (guiado, quando há terminal)')
  .option('--name <name>', 'nome do projeto')
  .option('--yes', 'não pergunta nada: escreve a configuração padrão e sai')
  .option('--defaults', 'sinônimo de --yes')
  .action(async (options: { name?: string; yes?: boolean; defaults?: boolean }) => {
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

    const guiado = options.yes !== true && options.defaults !== true && process.stdin.isTTY
    // A config mínima é escrita ANTES de qualquer pergunta, e não depois: o
    // wizard edita um arquivo existente (`loadConfig` → `parseDocument`), e a
    // composição que produz as sugestões também precisa de config para subir.
    await writeFile(configPath, guiado ? configComentada(name) : configMinima(name))
    console.log(`Criado: ${configPath}`)
    if (guiado) await configurarAposInit()

    const digest = await detectarProjeto()
    const { writeClaudeConfig } = await import('./claude-bridge.js')
    const claude = await writeClaudeConfig({
      projectDir: dir,
      projectName: name,
      ...(digest === undefined ? {} : { digest }),
      instructions: await instructionNotes(uranusDir),
    })
    console.log(`\nClaude Code treinado para este projeto (${String(claude.wrote.length)} arquivos):`)
    console.log(`  ${claude.wrote.join(', ')}`)
    console.log('\nPróximo passo: uranus backlog add "..." && uranus chat')
  })

program
  .command('claude')
  .description('Gera/atualiza .claude/ (CLAUDE.md, agentes, hooks) — o "treino" que o Claude Code lê sozinho')
  .action(async () => {
    const dir = process.cwd()
    const loaded = await loadConfig({ projectDir: dir })
    if (!loaded.ok) {
      console.error(loaded.error.message)
      process.exitCode = 1
      return
    }
    const digest = await detectarProjeto()
    const { writeClaudeConfig } = await import('./claude-bridge.js')
    const result = await writeClaudeConfig({
      projectDir: dir,
      projectName: loaded.value.config.project.name,
      ...(digest === undefined ? {} : { digest }),
      instructions: await instructionNotes(join(dir, '.uranus')),
    })
    console.log(`Atualizado: ${result.wrote.join(', ')}`)
  })

// ── relay (uso interno dos hooks do Claude Code) ────────────────────────────

program
  .command('relay <event> [marker...]')
  .description(
    'Uso interno: hook do `.claude/settings.json` repassa atividade da sessão pro painel. ' +
      'Nunca falha nem bloqueia a sessão do Claude Code.',
  )
  .action(async (event: string) => {
    // `[marker...]` existe só para engolir o `#uranus-managed` que o próprio
    // Uranus grava depois do comando (ver `HOOK_MARKER` em `claude-bridge.ts`)
    // — em shells que não tratam `#` como comentário (cmd.exe no Windows), ele
    // chega como argumento de verdade, e sem isto o commander recusaria o
    // comando inteiro com "too many arguments".
    try {
      const { readHookStdin, buildActivityEntry, postActivity } = await import('./relay.js')
      const raw = await readHookStdin()
      const entry = await buildActivityEntry(event, raw)
      const loaded = await loadConfig({ projectDir: process.cwd() })
      const dashboard = loaded.ok ? loaded.value.config.telemetry.dashboard : undefined
      const host = dashboard?.host
      await postActivity(entry, {
        host: host === undefined || host === '0.0.0.0' ? '127.0.0.1' : host,
        port: dashboard?.port ?? 4319,
        ...(dashboard?.token === undefined ? {} : { token: dashboard.token }),
      })
    } catch {
      // Hook do Claude Code: uma falha aqui nunca pode travar a sessão do
      // usuário por causa do painel do Uranus.
    }
  })

// ── chat ────────────────────────────────────────────────────────────────────

program
  .command('chat')
  .description(
    'Abre uma sessão do Claude Code neste projeto — orquestrador mestre, mesma interface e ' +
      'mesmo custo/sessão do `claude` real. `uranus init` já o deixou treinado.',
  )
  .argument('[args...]', 'argumentos repassados direto para o `claude` (ex.: --resume <id>)')
  .allowUnknownOption()
  .action(async (args: string[]) => {
    const dir = process.cwd()
    const loaded = await loadConfig({ projectDir: dir })
    if (!loaded.ok) {
      console.error(loaded.error.message)
      console.error('Rode `uranus init` primeiro.')
      process.exitCode = 1
      return
    }

    // Atualiza .claude/ antes de abrir — best-effort: uma falha aqui não pode
    // impedir o usuário de conversar com o Claude, só significa que o
    // catálogo/CLAUDE.md podem estar um passo atrás do projeto atual.
    try {
      const digest = await detectarProjeto()
      const { writeClaudeConfig } = await import('./claude-bridge.js')
      await writeClaudeConfig({
        projectDir: dir,
        projectName: loaded.value.config.project.name,
        ...(digest === undefined ? {} : { digest }),
        instructions: await instructionNotes(join(dir, '.uranus')),
      })
    } catch (error) {
      console.error(
        `Aviso: não deu para atualizar .claude/ antes de abrir a sessão (${
          error instanceof Error ? error.message : String(error)
        }).`,
      )
    }

    const { locateClaudeBinary } = await import('@uranus/providers')
    const explicitBinary = loaded.value.config.providers.entries['claude-code']?.binary
    const binary = locateClaudeBinary(explicitBinary)

    console.log(`Abrindo Claude Code (orquestrado pelo Uranus) — ${binary}\n`)
    const { spawn } = await import('node:child_process')
    const child = spawn(binary, args, { stdio: 'inherit', cwd: dir })
    const exitCode = await new Promise<number>((resolveExit) => {
      child.on('error', (error) => {
        console.error(
          `Não foi possível iniciar o Claude Code: ${error.message}\n` +
            'Instale o Claude Code CLI: https://docs.claude.com/claude-code',
        )
        resolveExit(1)
      })
      child.on('exit', (code) => {
        resolveExit(code ?? 0)
      })
    })
    process.exitCode = exitCode
  })

/**
 * A configuração mínima do `--yes` e do modo não interativo.
 *
 * Estes bytes são contrato: script e CI dependem deles desde a primeira versão,
 * e o modo guiado é um caminho a mais, não a substituição deste.
 */
/**
 * Config mínima do `init`.
 *
 * Desde o pivot "Uranus é armadura" (ver `docs/00-ARCHITECTURE`), o Kernel
 * não roda tasks sozinho por padrão — então orçamento, estratégia de
 * integração e validação de código (que calibravam ESSE laço autônomo) não
 * têm mais lugar aqui: gravar um valor "enxuto" pra eles seria fingir que
 * ainda existe algo rodando para enxugar. `providers.default: claude-code` e
 * o resto ficam nos defaults do schema — só o nome do projeto é decisão de
 * verdade neste momento. O modo Kernel continua existindo (`ALL_CONFIG_CATEGORIES`
 * em `config-wizard.ts`) para quem quiser voltar a ligá-lo à mão.
 */
function configMinima(name: string): string {
  return ['version: 1', 'project:', `  name: ${name}`, ''].join('\n')
}

/**
 * O mesmo, comentado — só o caminho guiado usa.
 *
 * Quem chega pelo wizard vai continuar abrindo este arquivo à mão depois, e uma
 * seção sem explicação é uma seção que ninguém mexe. As edições seguintes
 * preservam estes comentários.
 */
function configComentada(name: string): string {
  return [
    '# Configuração do Uranus.',
    '# Edite à vontade: o `uranus config` muda valor por valor e preserva',
    '# comentários, ordem e formatação deste arquivo.',
    'version: 1',
    '',
    '# Nome que aparece nos commits, nos PRs e no painel.',
    'project:',
    `  name: ${name}`,
    '',
    '# Isto basta. O Uranus não roda tasks sozinho por padrão — quem decide e',
    '# age é o Claude, via `uranus chat`. Orçamento, integração automática e',
    '# validação de código continuam existindo como modo avançado',
    '# (`uranus config` mostra as categorias padrão; o resto fica em',
    '# ADVANCED_CONFIG_CATEGORIES para quando esse modo voltar a fazer sentido).',
    '',
  ].join('\n')
}

/** Oferece o wizard logo depois do `init`. Recusar aqui não custa nada. */
async function configurarAposInit(): Promise<void> {
  const { confirm, stdioPromptIo } = await import('./prompt-kit.js')
  const io = stdioPromptIo()
  try {
    const quer = await confirm(io, 'Quer configurar o Uranus agora?', {
      default: true,
      help:
        'São perguntas por categoria, com o valor atual sugerido em todas.\n' +
        'Dá para pular e rodar `uranus config` quando quiser.',
    })
    if (!quer) return

    io.write('\nAnalisando o projeto para sugerir valores — leva alguns segundos…\n')
    const digest = await detectarProjeto()
    const aberto = await abrirConfig()
    if (aberto === undefined) return

    const { runConfigWizard } = await import('./config-wizard.js')
    await runConfigWizard({
      io,
      configPath: aberto.configPath,
      source: aberto.source,
      layers: aberto.layers,
      effective: aberto.effective,
      origins: aberto.origins,
      ...(digest === undefined ? {} : { digest }),
      save: (text: string) => writeFile(aberto.configPath, text, 'utf8'),
    })
  } finally {
    io.close()
  }
}

/**
 * Detecção do projeto para alimentar as sugestões do wizard.
 *
 * Monta a composição porque é ela que faz o bootstrap do `ProjectDigest` (e
 * grava o cache que o `uranus config` vai reaproveitar depois). Falhar aqui não
 * é motivo para não configurar: sem digest o wizard só perde as sugestões.
 */
async function detectarProjeto(): Promise<ProjectDigest | undefined> {
  try {
    let digest: ProjectDigest | undefined
    await withComposition(
      async ({ composition }) => {
        digest = await composition.contextManager.digest(composition.project)
      },
      { logger: createLogger({ level: 'error' }) },
    )
    return digest
  } catch {
    return undefined
  }
}

/**
 * Instruções gravadas em `.uranus/instructions/` — via painel ou escritas à
 * mão. Ausente/vazio nunca falha: sem instrução nenhuma o CLAUDE.md só não
 * ganha a seção correspondente.
 */
async function instructionNotes(uranusDir: string): Promise<InstructionNote[]> {
  try {
    const { FileInstructionsStore } = await import('./instructions.js')
    const store = new FileInstructionsStore({
      dir: join(uranusDir, 'instructions'),
      logger: createLogger({ level: 'error' }),
    })
    return [...(await store.list())]
  } catch {
    return []
  }
}

// ── config ──────────────────────────────────────────────────────────────────

const config = program
  .command('config')
  .description('Configuração do projeto: guiada por categorias, perguntas e opções')
  .action(async () => {
    // Mesmo critério do `task delete` e do `backlog add`: sem TTY não há a quem
    // perguntar, e ler EOF como resposta gravaria configuração no escuro.
    if (!process.stdin.isTTY) {
      console.error(
        'Sem terminal interativo: o modo guiado precisa de um TTY.\n' +
          'Para ver o que está valendo : uranus config show\n' +
          'Para mudar um valor         : uranus config set <caminho> <valor>',
      )
      process.exitCode = 1
      return
    }
    const aberto = await abrirConfig()
    if (aberto === undefined) return

    const { runConfigWizard } = await import('./config-wizard.js')
    const { stdioPromptIo } = await import('./prompt-kit.js')
    const digest = await lerDigestEmCache()
    const io = stdioPromptIo()
    try {
      console.log(`Configurando ${aberto.configPath}`)
      console.log('Enter em branco mantém o valor que está entre colchetes.')
      const gravadas = await runConfigWizard({
        io,
        configPath: aberto.configPath,
        source: aberto.source,
        layers: aberto.layers,
        effective: aberto.effective,
        origins: aberto.origins,
        ...(digest === undefined ? {} : { digest }),
        save: (text: string) => writeFile(aberto.configPath, text, 'utf8'),
      })
      console.log(
        gravadas === 0
          ? '\nNada foi alterado.'
          : `\n${String(gravadas)} categoria(s) gravada(s). Confira com: uranus config show`,
      )
    } finally {
      io.close()
    }
  })

config
  .command('show')
  .description('Mostra a configuração efetiva por categoria e de onde veio cada valor')
  .action(async () => {
    const aberto = await abrirConfig()
    if (aberto === undefined) return
    const { renderConfigShow } = await import('./config-wizard.js')
    for (const linha of renderConfigShow(aberto.effective, aberto.origins, aberto.configPath)) {
      console.log(linha)
    }
  })

config
  .command('set <caminho> <valor>')
  .description('Muda um valor sem perguntar nada — para script e CI')
  .action(async (caminho: string, valor: string) => {
    const aberto = await abrirConfig()
    if (aberto === undefined) return
    const {
      applyWrites,
      coerceRawValue,
      describeSchema,
      documentToData,
      formatConfigValue,
      pathSegments,
      schemaAt,
      validateProjectData,
      valueAtPath,
    } = await import('./config-file.js')

    const node = schemaAt(caminho)
    if (node === undefined) {
      console.error(
        `Não existe configuração em "${caminho}".\n` +
          'Os caminhos válidos aparecem em: uranus config show',
      )
      process.exitCode = 1
      return
    }
    const parsed = coerceRawValue(node, valor)
    if (!parsed.ok) {
      console.error(`Valor inválido para ${caminho}: ${parsed.problem}`)
      console.error(`Este campo aceita ${describeSchema(node)}.`)
      process.exitCode = 1
      return
    }

    // Valida ANTES de gravar: caminho certo com valor fora da faixa não pode
    // virar um arquivo que o próximo comando se recusa a carregar.
    const doc = parseDocument(aberto.source)
    applyWrites(doc, aberto.effective, [{ path: caminho, value: parsed.value }])
    const validado = validateProjectData(documentToData(doc), aberto.layers)
    if (!validado.ok) {
      console.error(validado.error.message)
      console.error(`\nO arquivo não foi alterado. ${caminho} aceita ${describeSchema(node)}.`)
      process.exitCode = 1
      return
    }

    // `resolvedConfig` porque o valor anterior de uma regra de validação ausente
    // é a severidade que o core aplica, não "—": mostrar vazio faria parecer que
    // a regra não rodava antes.
    const { resolvedConfig } = await import('./config-wizard.js')
    const antes = valueAtPath(resolvedConfig(aberto.effective), pathSegments(caminho))
    const depois = valueAtPath(resolvedConfig(validado.value), pathSegments(caminho))
    await writeFile(aberto.configPath, doc.toString(), 'utf8')
    console.log(`${caminho}: ${formatConfigValue(antes)} → ${formatConfigValue(depois)}`)
  })

interface ConfigAberta {
  readonly configPath: string
  readonly source: string
  readonly layers: readonly ConfigLayer[]
  readonly effective: UranusConfig
  readonly origins: ReadonlyMap<string, { layer: string; source: string }>
}

/**
 * Abre a configuração do projeto para leitura ou edição.
 *
 * Deliberadamente sem `withComposition`: montar a composição carrega plugins,
 * providers e digest — dezenas de segundos antes da primeira pergunta, para
 * editar um arquivo de texto. `loadConfig` sozinho já dá o valor efetivo, as
 * camadas (é no merge delas que a validação precisa acontecer) e a procedência.
 */
async function abrirConfig(): Promise<ConfigAberta | undefined> {
  const loaded = await loadConfig({ projectDir: process.cwd() })
  if (!loaded.ok) {
    console.error(loaded.error.message)
    process.exitCode = 1
    return undefined
  }
  const camada = loaded.value.layers.find((layer) => layer.name === 'project')
  if (camada === undefined) {
    console.error('Nenhuma configuração de projeto encontrada. Rode: uranus init')
    process.exitCode = 1
    return undefined
  }
  if (camada.source.endsWith('.json')) {
    console.error(
      `A configuração deste projeto está em JSON (${camada.source}).\n` +
        'A edição guiada só mexe em YAML — converta o arquivo ou edite-o à mão.',
    )
    process.exitCode = 1
    return undefined
  }
  return {
    configPath: camada.source,
    source: await readFile(camada.source, 'utf8'),
    layers: loaded.value.layers,
    effective: loaded.value.config,
    origins: loaded.value.origins,
  }
}

/**
 * O digest já detectado, lido direto do cache em disco.
 *
 * O `uranus config` não pode pagar uma composição inteira só para sugerir uma
 * branch: o cache é escrito pelo `init` e por qualquer comando que já tenha
 * rodado, e sem ele o wizard apenas fica sem sugestões.
 */
async function lerDigestEmCache(): Promise<ProjectDigest | undefined> {
  const raw = await readFile(
    join(process.cwd(), '.uranus', 'cache', 'project-digest.json'),
    'utf8',
  ).catch(() => undefined)
  if (raw === undefined) return undefined
  const { tryParseJson } = await import('@uranus/core')
  return tryParseJson<ProjectDigest>(raw)
}

// ── validações ──────────────────────────────────────────────────────────────

program
  .command('validations')
  .description('Mostra quais validações rodam, com que severidade e de onde veio cada uma')
  .action(async () => {
    await withComposition(({ composition }) => {
      // A policy resolvida vem da composição; a seção crua da config entra junto
      // porque só ela distingue "é o default" de "o projeto pediu isto".
      for (const linha of renderValidations(composition.validations, composition.config.validations)) {
        console.log(linha)
      }
      return Promise.resolve()
    })
  })

// ── backlog ─────────────────────────────────────────────────────────────────

const backlog = program.command('backlog').description('Itens de backlog do projeto')

backlog
  .command('add [title]')
  .description('Adiciona um item ao backlog (sem o título, pergunta no terminal)')
  .option('--body <text>', 'descrição do que precisa ser feito', '')
  .option('--label <label...>', 'labels')
  .option('--priority <n>', 'prioridade 0-100', (v) => Number.parseInt(v, 10), 50)
  .action(
    async (
      title: string | undefined,
      options: { body: string; label?: string[]; priority: number },
    ) => {
      // Perguntar ANTES de compor: montar a composição carrega plugins,
      // providers e digest — meio minuto entre o comando e a primeira pergunta.
      const entrada =
        title === undefined
          ? await perguntarItemDeBacklog(options)
          : {
              title,
              body: options.body,
              labels: options.label ?? [],
              priority: options.priority,
            }
      if (entrada === undefined) {
        process.exitCode = 1
        return
      }

      await withComposition(async ({ composition }) => {
        const added = await composition.backlog.add({
          ...entrada,
          createdAt: systemClock.now(),
        })
        if (!added.ok) {
          console.error(`ERRO: ${added.error.message}`)
          process.exitCode = 1
          return
        }
        console.log(`\nItem criado: ${added.value.id}`)
        console.log('Peça pro Claude puxar o backlog: uranus chat')
        console.log(`Texto do item em .uranus/backlog/${added.value.id}.yaml — edite à vontade.`)
      })
    },
  )

backlog
  .command('list')
  .description('Lista itens do backlog com o progresso das subtasks de cada um')
  .action(async () => {
    await withComposition(async ({ composition }) => {
      const items = await composition.backlog.list()
      if (items.length === 0) {
        console.log('Backlog vazio. Use: uranus backlog add "título" --body "..."')
        return
      }
      // Progresso vem das tasks do estado quente, casadas pelo item de origem.
      const tasks = await composition.state.tasks.all()
      for (const linha of renderBacklogList(
        items,
        tasks,
        composition.config.backlog.maxPlanningFailures,
      )) {
        console.log(linha)
      }
    })
  })

backlog
  .command('show <id>')
  .description('Mostra um item por inteiro: corpo, plano, subtasks e recusas do validador')
  .action(async (id: string) => {
    await withComposition(async ({ composition }) => {
      const item = await composition.backlog.get(id)
      if (item === undefined) {
        console.error(`Item "${id}" não encontrado. Veja: uranus backlog list`)
        process.exitCode = 1
        return
      }
      const tasks = await composition.state.tasks.all()
      for (const linha of renderBacklogShow(
        item,
        tasks,
        composition.config.backlog.maxPlanningFailures,
      )) {
        console.log(linha)
      }
    })
  })

backlog
  .command('status <id> <novoEstado>')
  .description(`Troca o estado de um item à mão (${Object.keys(BACKLOG_STATE_LABEL).join('|')})`)
  .action(async (id: string, novoEstado: string) => {
    await withComposition(async ({ composition }) => {
      const item = await composition.backlog.get(id)
      if (item === undefined) {
        console.error(`Item "${id}" não encontrado. Veja: uranus backlog list`)
        process.exitCode = 1
        return
      }
      if (!(novoEstado in BACKLOG_STATE_LABEL)) {
        console.error(
          `Estado inválido: "${novoEstado}". Use um de: ${Object.keys(BACKLOG_STATE_LABEL).join(', ')}.`,
        )
        process.exitCode = 1
        return
      }
      const alvo = novoEstado as BacklogItemState
      if (item.state === alvo) {
        console.log(`Item ${id} já está em "${novoEstado}". Nada a fazer.`)
        return
      }
      const updated = await composition.backlog.update({ ...item, state: alvo })
      if (!updated.ok) {
        console.error(`ERRO: ${updated.error.message}`)
        process.exitCode = 1
        return
      }
      console.log(`Item ${id}: ${BACKLOG_STATE_LABEL[item.state]} → ${BACKLOG_STATE_LABEL[alvo]}`)
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
  .command('add [title]')
  .description(
    'Grava uma memória — pensado para o Claude registrar o que aprendeu durante `uranus chat` ' +
      '(decisão, preferência, convenção, bug recorrente…), não só para o humano editar à mão',
  )
  .requiredOption('--scope <scope>', `escopo: ${MEMORY_SCOPES.join(', ')}`)
  .option('--body <text>', 'corpo da memória', '')
  .option(
    '--key <key>',
    'chave estável — gravar de novo com a mesma chave atualiza o registro (default: derivada do título)',
  )
  .option('--tags <tags>', 'tags separadas por vírgula', '')
  .option('--confidence <n>', 'confiança 0-1', (v) => Number.parseFloat(v), 0.8)
  .action(
    async (
      title: string | undefined,
      options: { scope: string; body: string; key?: string; tags: string; confidence: number },
    ) => {
      if (title === undefined || title.trim() === '') {
        console.error('Informe um título: uranus memory add "título" --scope <escopo> --body "..."')
        process.exitCode = 1
        return
      }
      if (!MEMORY_SCOPES.includes(options.scope as (typeof MEMORY_SCOPES)[number])) {
        console.error(`Escopo inválido: "${options.scope}". Use um de: ${MEMORY_SCOPES.join(', ')}.`)
        process.exitCode = 1
        return
      }

      await withComposition(async ({ composition }) => {
        const key = options.key === undefined || options.key.trim() === ''
          ? slugifyMemoryKey(title)
          : options.key.trim()
        const confidence = Number.isFinite(options.confidence)
          ? Math.min(1, Math.max(0, options.confidence))
          : 0.8
        const saved = await composition.deps.memoryManager.remember([
          {
            scope: options.scope as (typeof MEMORY_SCOPES)[number],
            key,
            title: title.trim(),
            body: options.body,
            tags: parseLabels(options.tags),
            confidence,
            source: { kind: 'agent', ref: 'uranus chat' },
            refs: [],
          },
        ])
        if (saved.length === 0) {
          console.error(
            'Memória não gravada — confiança abaixo do piso configurado (memory.minConfidence).',
          )
          process.exitCode = 1
          return
        }
        console.log(`Memória gravada: ${saved[0]?.id}  [${saved[0]?.scope}]  ${saved[0]?.title}`)
        console.log(
          'Arquivo em .uranus/memory/ — use [[título de outra nota]] no corpo para linkar no vault. ' +
            'Veja o grafo: uranus vault',
        )
      })
    },
  )

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

program
  .command('vault')
  .description(
    'Mostra o grafo do vault — memória, backlog e instruções ligados por [[wikilinks]] no corpo de cada nota',
  )
  .action(async () => {
    await withComposition(async ({ composition }) => {
      const graph = await composition.dashboardData.vault?.graph()
      if (graph === undefined) {
        console.log('Vault não suportado neste projeto.')
        return
      }
      if (graph.nodes.length === 0) {
        console.log(
          'Vault vazio. Memória (`uranus memory add`), backlog e instruções aparecem aqui assim que existirem.',
        )
        return
      }
      const byId = new Map(graph.nodes.map((node) => [node.id, node]))
      for (const node of graph.nodes) {
        const links = graph.edges
          .filter((edge) => edge.from === node.id)
          .map((edge) => byId.get(edge.to)?.title ?? edge.to)
        console.log(`[${node.kind}] ${node.title}${node.scope === undefined ? '' : ` (${node.scope})`}`)
        console.log(`  ${node.excerpt}`)
        if (links.length > 0) console.log(`  → ${links.join(', ')}`)
      }
      if (graph.unresolved.length > 0) {
        console.log(`\nLinks ainda sem nota correspondente: ${graph.unresolved.join(', ')}`)
      }
    })
  })

// ── plugins ─────────────────────────────────────────────────────────────────

const plugin = program.command('plugin').description('Plugins de stack e de ferramenta')

plugin
  .command('list')
  .description('Lista plugins descobertos, quais ativaram e por quê')
  .action(async () => {
    await withComposition(({ composition }) => {
      const { report, registry } = composition.plugins
      if (
        report.activated.length === 0 &&
        report.skipped.length === 0 &&
        report.failed.length === 0
      ) {
        console.log('Nenhum plugin descoberto.')
        return Promise.resolve()
      }

      if (report.activated.length > 0) {
        console.log('Ativos:')
        for (const entry of report.activated) {
          const summary = Object.entries(registry.summaryOf(entry.id))
            .filter(([, count]) => count > 0)
            .map(([kind, count]) => `${String(count)} ${kind}`)
            .join(', ')
          console.log(`  ${entry.id.padEnd(12)} ${entry.reason}`)
          if (summary !== '') console.log(`  ${' '.repeat(12)} registrou: ${summary}`)
        }
      }
      if (report.skipped.length > 0) {
        console.log('\nInativos:')
        for (const entry of report.skipped) console.log(`  ${entry.id.padEnd(12)} ${entry.reason}`)
      }
      if (report.failed.length > 0) {
        console.log('\nCom falha:')
        for (const entry of report.failed) console.log(`  ${entry.id.padEnd(12)} ${entry.error}`)
        process.exitCode = 1
      }
      return Promise.resolve()
    })
  })

plugin
  .command('info <id>')
  .description('Mostra manifesto, permissões e o que o plugin registrou')
  .action(async (id: string) => {
    await withComposition(async ({ composition }) => {
      const { describePermissions } = await import('@uranus/plugins')
      const entry = composition.plugins.loader.entryOf(id)
      if (entry === undefined) {
        console.error(`Plugin "${id}" não foi descoberto.`)
        process.exitCode = 1
        return
      }

      const { manifest } = entry
      console.log(`${manifest.name} (${manifest.id}) v${manifest.version}`)
      console.log(`  ${manifest.description}`)
      console.log(`  origem: ${entry.origin}${entry.dir === undefined ? '' : ` (${entry.dir})`}`)
      console.log(`  compatível com uranus ${manifest.uranus}`)

      console.log('\nPermissões que o plugin pede:')
      for (const line of describePermissions(manifest.permissions)) console.log(`  • ${line}`)

      console.log('\nDeclara fornecer:')
      for (const [kind, names] of Object.entries(manifest.provides)) {
        if (Array.isArray(names) && names.length > 0) {
          console.log(`  ${kind}: ${names.join(', ')}`)
        }
      }

      const registered = Object.entries(composition.plugins.registry.summaryOf(id)).filter(
        ([, count]) => count > 0,
      )
      console.log(
        registered.length === 0
          ? '\nNão está ativo neste projeto (nada registrado).'
          : `\nRegistrou de fato: ${registered.map(([k, c]) => `${String(c)} ${k}`).join(', ')}`,
      )

      if ((manifest.detect ?? []).length > 0) {
        console.log('\nAtiva automaticamente quando:')
        for (const rule of manifest.detect ?? []) {
          console.log(`  • ${describeRule(rule)}`)
        }
      }
    })
  })

plugin
  .command('check <dir>')
  .description('Valida um plugin antes de instalar: manifesto, permissões e capacidades usadas')
  .action(async (dir: string) => {
    const { validateManifest, describePermissions, scanCapabilities, formatViolations } =
      await import('@uranus/plugins')
    const target = resolve(dir)

    let raw: string
    try {
      raw = await readFile(join(target, 'uranus.plugin.json'), 'utf8')
    } catch {
      console.error(`Nenhum uranus.plugin.json em ${target}`)
      process.exitCode = 1
      return
    }

    const manifest = validateManifest(JSON.parse(raw), join(target, 'uranus.plugin.json'))
    if (!manifest.ok) {
      console.error(manifest.error.message)
      process.exitCode = 1
      return
    }

    console.log(`${manifest.value.name} (${manifest.value.id}) v${manifest.value.version}`)
    console.log('\nAo instalar, você autoriza este plugin a:')
    for (const line of describePermissions(manifest.value.permissions)) console.log(`  • ${line}`)

    const scan = await scanCapabilities(target, manifest.value.permissions)
    if (scan.violations.length > 0) {
      console.error(`\n${formatViolations(manifest.value.id, scan.violations)}`)
      console.error(
        '\nO Uranus recusa carregar este plugin enquanto o manifesto não declarar isso.',
      )
      process.exitCode = 1
      return
    }

    console.log(
      `\nVarredura: ${String(scan.filesScanned)} arquivo(s), nenhuma capacidade não declarada.${
        scan.truncated ? ' (varredura truncada — resultado indicativo)' : ''
      }`,
    )
    console.log(
      '\nLembre-se: plugins rodam no mesmo processo que o kernel. A varredura pega descuido,\n' +
        'não evasão deliberada. Instalar um plugin é confiar no autor, como qualquer pacote npm.',
    )
  })

function describeRule(rule: {
  kind: string
  path?: string
  pattern?: string
  manifest?: string
  name?: string
  run?: string
}): string {
  switch (rule.kind) {
    case 'file':
      return `o arquivo "${rule.path ?? ''}" existe`
    case 'glob':
      return `algum arquivo casa com "${rule.pattern ?? ''}"`
    case 'dependency':
      return `"${rule.name ?? ''}" está em ${rule.manifest ?? ''}`
    case 'command':
      return `o comando "${rule.run ?? ''}" retorna sucesso`
    default:
      return rule.kind
  }
}

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

      // Agente que não cabe no orçamento por task nunca é admitido — ele existe
      // no catálogo, aparece em `uranus agent list` e some na hora de trabalhar.
      // É o tipo de defeito que só aparece na terceira falha de uma task, então
      // ele é reportado aqui, antes de custar tempo.
      const limites = composition.deps.budget.state().task.limits
      const inviaveis = composition.deps.agents.list().filter((spec) => {
        return (
          spec.limits.maxCost.micros > limites.cost.micros ||
          spec.limits.maxWallclockMs > limites.wallclockMs
        )
      })
      if (inviaveis.length > 0) {
        console.log('\nAgentes que NUNCA serão admitidos com o orçamento atual:')
        for (const spec of inviaveis) {
          const motivo =
            spec.limits.maxCost.micros > limites.cost.micros
              ? `precisa de até ${formatMoney(spec.limits.maxCost)} (limite ${formatMoney(limites.cost)})`
              : `precisa de até ${String(Math.round(spec.limits.maxWallclockMs / 1000))}s (limite ${String(Math.round(limites.wallclockMs / 1000))}s)`
          console.log(`  AVISO ${spec.name.padEnd(14)} ${motivo}`)
        }
        console.log('        Aumente budget.perTask ou reduza os limits do agente.')
      }
    } finally {
      await composition.close()
    }
  })

// ── dashboard ───────────────────────────────────────────────────────────────

program
  .command('dashboard')
  .description('Sobe o painel web (estado vivo, custo, qualidade, aprovações)')
  .option('--port <n>', 'porta', (v) => Number.parseInt(v, 10))
  .option('--host <host>', 'endereço de escuta (fora de loopback exige token)')
  .action(async (options: { port?: number; host?: string }) => {
    await withComposition(async ({ composition }) => {
      const painel = await serveDashboard(composition, options.port, options.host)
      console.log(`Painel: ${painel.url}`)
      console.log('O painel reflete o estado do projeto em tempo real. Ctrl+C encerra.')
      await new Promise<void>((resolve) => {
        process.once('SIGINT', () => {
          resolve()
        })
      })
      await painel.close()
    })
  })

async function serveDashboard(
  composition: Awaited<ReturnType<typeof compose>>,
  port?: number,
  host?: string,
): Promise<{ url: string; close: () => Promise<void> }> {
  const { DashboardServer, SseHub } = await import('@uranus/dashboard')
  const { locateClaudeBinary } = await import('@uranus/providers')
  const config = composition.config.telemetry.dashboard
  const hub = new SseHub()
  const claudeBinary = locateClaudeBinary(
    composition.config.providers.entries['claude-code']?.binary,
  )
  const server = new DashboardServer(
    {
      aggregator: composition.observability.aggregator,
      events: composition.deps.events,
      humanGate: composition.deps.humanGate,
      logger: composition.deps.logger,
      clock: composition.deps.clock,
      port: port ?? config.port,
      host: host ?? config.host,
      ...(config.token === undefined ? {} : { token: config.token }),
      // Sem esta porta o painel sobe somente-leitura — é o que o `dashboard.md`
      // pedia para deixar de ser: kanban, CRUD de task, config e validações.
      data: composition.dashboardData,
      control: {
        pause: () => composition.kernel.pause(),
        resume: () => composition.kernel.resume(),
      },
      // A aba Terminal abre um destes dois no navegador: a mesma sessão do
      // `uranus chat` (orquestrador), ou um shell puro para comandos soltos.
      terminalProfiles: {
        claude: {
          command: claudeBinary,
          cwd: composition.project.rootDir,
          label: 'claude',
        },
        shell: {
          command: process.platform === 'win32' ? 'cmd.exe' : (process.env['SHELL'] ?? '/bin/sh'),
          cwd: composition.project.rootDir,
          label: 'shell',
        },
      },
    },
    hub,
  )
  const { url } = await server.listen()
  const suffix = config.token === undefined ? '' : `?token=${encodeURIComponent(config.token)}`
  return { url: `${url}${suffix}`, close: () => server.close() }
}

// ── infra ───────────────────────────────────────────────────────────────────

/**
 * Chave estável de memória a partir do título.
 *
 * Sem sufixo de tempo (diferente do slug de backlog/instrução): a chave é o
 * que faz duas gravações do mesmo fato colidirem e virarem dedupe/supersessão
 * em vez de dois registros soltos dizendo a mesma coisa.
 */
function slugifyMemoryKey(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug === '' ? 'memoria' : slug
}

interface ItemDeBacklogInformado {
  readonly title: string
  readonly body: string
  readonly labels: readonly string[]
  readonly priority: number
}

/**
 * Modo guiado do `uranus backlog add`.
 *
 * Mesmo critério do `task delete`: sem TTY não há a quem perguntar, e ler EOF
 * como resposta criaria um item vazio em script. A saída é recusar e mostrar a
 * forma não-interativa do comando.
 */
async function perguntarItemDeBacklog(padroes: {
  body: string
  label?: string[]
  priority: number
}): Promise<ItemDeBacklogInformado | undefined> {
  if (!process.stdin.isTTY) {
    console.error(
      'Sem terminal interativo: o modo guiado precisa de um TTY.\n' +
        'Passe o título direto — uranus backlog add "título" --body "..." --priority 70 --label x',
    )
    return undefined
  }

  const { createInterface } = await import('node:readline/promises')
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    console.log('Novo item de backlog. Enter em branco aceita o valor entre colchetes.')
    console.log('')
    const title = (await rl.question('Título: ')).trim()
    if (title === '') {
      console.error('Sem título não há item — o título é o que vira o id e o pedido ao Planner.')
      return undefined
    }

    console.log('')
    console.log('Corpo: o que precisa acontecer e como saber que ficou pronto.')
    console.log('Quanto mais concreto, menos o Planner inventa. Termine com um ponto sozinho (.)')
    const linhas: string[] = []
    for (;;) {
      const linha = await rl.question('| ')
      if (linha.trim() === '.') break
      linhas.push(linha)
    }
    const digitado = linhas.join('\n').trim()

    const prioridade = parsePriority(
      await rl.question(`\nPrioridade 0-100 [${String(padroes.priority)}]: `),
      padroes.priority,
    )
    const labels = parseLabels(await rl.question('Labels separadas por vírgula []: '))

    return {
      title,
      body: digitado === '' ? padroes.body : digitado,
      labels: labels.length > 0 ? labels : (padroes.label ?? []),
      priority: prioridade,
    }
  } finally {
    rl.close()
  }
}

async function withComposition(
  fn: (context: { composition: Awaited<ReturnType<typeof compose>> }) => Promise<void>,
  overrides?: { logger?: Logger },
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
    ...(overrides?.logger === undefined ? {} : { logger: overrides.logger }),
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
