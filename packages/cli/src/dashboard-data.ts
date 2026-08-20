import { readFile, writeFile } from 'node:fs/promises'
import { parseDocument } from 'yaml'
import type {
  Logger,
  MemoryDraft,
  MemoryQuery,
  MemoryRecord,
  Result,
  Task,
  TaskKind,
  TaskState,
} from '@uranus/core'
import {
  MEMORY_SCOPES,
  ValidationError,
  canTransition,
  err,
  newTaskId,
  ok,
  taskStateLabel,
  transition,
} from '@uranus/core'
import { loadConfig } from '@uranus/config'
import type { FileBacklogStore, StoredBacklogItem } from '@uranus/backlog'
import type { DashboardData } from '@uranus/dashboard'
import type { StateStore } from '@uranus/state'
import type { TaskQueue } from '@uranus/core'
import { CONFIG_CATEGORIES } from './config-wizard.js'
import { applyWrites, cloneDocument, documentToData, validateProjectData } from './config-file.js'
import type { FileInstructionsStore } from './instructions.js'
import { writeClaudeConfig } from './claude-bridge.js'
import { SKILLS_CATALOG, installSkill, installedSkillIds } from './skills-catalog.js'
import { watchMemoryDir } from './memory-watch.js'
import { buildVaultGraph } from './vault.js'
import { readGraphifyGraph } from './graphify.js'
import type { MultiRepoGitHubControl } from './git-control.js'

/**
 * O suficiente de `MemoryStore` para o vault e a aba Memória lerem os registros ativos.
 *
 * `reload` existe porque `MarkdownMemoryStore.load()` só lê `.uranus/memory/` UMA vez
 * por processo (`this.loaded`) — certo para o kernel, que é o único escritor durante
 * um run, errado para o painel: `uranus dashboard` é um processo de longa duração, e
 * quem grava memória (`uranus memory add`, ou o Claude direto em `uranus chat`) roda
 * num processo separado. Sem recarregar, o painel mostra pra sempre a fotografia do
 * instante em que subiu — memória nova (do jeito que for gravada) nunca aparece até
 * reiniciar o painel à mão. `reload` é opcional só porque a interface aceita
 * implementações de teste sem essa capacidade.
 */
export interface DashboardMemoryReader {
  query(query: MemoryQuery): Promise<readonly MemoryRecord[]>
  reload?(): Promise<void>
}

/** O suficiente de `MemoryManager` para o painel gravar — a mesma curadoria que `uranus memory add` usa. */
export interface DashboardMemoryManager {
  remember(drafts: readonly MemoryDraft[]): Promise<readonly MemoryRecord[]>
}

export interface DashboardDataDeps {
  readonly state: StateStore
  readonly queue: TaskQueue
  readonly backlog: FileBacklogStore
  readonly instructions: FileInstructionsStore
  readonly memory: DashboardMemoryReader
  readonly memoryManager: DashboardMemoryManager
  /** `.uranus/memory/` real no disco — só pra `watch()`, observar mudanças de outros processos. */
  readonly memoryDir: string
  readonly github: MultiRepoGitHubControl
  readonly projectId: Task['projectId']
  readonly projectDir: string
  readonly projectName: string
  readonly maxAttemptsPerTask: number
  readonly now: () => number
  readonly logger: Logger
}

/**
 * Implementação da porta que o painel usa para escrever.
 *
 * Fica aqui, e não no pacote `dashboard`, pelo mesmo motivo da `BacklogPort`:
 * o painel não deve conhecer `StateStore`, `FileBacklogStore` nem o formato do
 * arquivo de configuração. Ele recebe operações, não repositórios.
 */
export function createDashboardData(deps: DashboardDataDeps): DashboardData {
  return {
    tasks: {
      list: () => deps.state.tasks.all(),

      async create(input): Promise<Result<Task>> {
        const titulo = input.title.trim()
        if (titulo === '') {
          return err(new ValidationError('A task precisa de um título.'))
        }
        if (input.intent.trim() === '') {
          return err(new ValidationError('A task precisa de uma intenção — o que fazer, em prosa.'))
        }
        // Escopo vazio deixaria a verificação de diff sem referência (INV-5), e
        // o painel existe justamente para quem não sabe que isso é obrigatório.
        const touches = input.touches.map((glob) => glob.trim()).filter((glob) => glob !== '')
        if (touches.length === 0) {
          return err(
            new ValidationError('Declare ao menos um caminho no escopo (ex.: `src/**`).', {
              context: { field: 'touches' },
            }),
          )
        }

        const now = deps.now()
        const task: Task = {
          id: newTaskId(now),
          projectId: deps.projectId,
          kind: input.kind as TaskKind,
          title: titulo,
          intent: input.intent.trim(),
          state: 'ready',
          priority: 50,
          deps: [],
          touches,
          acceptance: {
            checks: input.checks.map((kind, index) => checkFor(kind, index)),
            requireAll: true,
          },
          attempts: 0,
          maxAttempts: deps.maxAttemptsPerTask,
          repairAttempts: 0,
          labels: [],
          createdAt: now,
          updatedAt: now,
        }
        const queued = await deps.queue.enqueue(task)
        return queued.ok ? ok(task) : err(queued.error)
      },

      async setState(id, state, reason): Promise<Result<Task>> {
        const alvo = await deps.state.tasks.find(id as Task['id'])
        if (alvo === undefined) {
          return err(new ValidationError(`Task "${id}" não encontrada.`))
        }
        const destino = state as TaskState
        if (alvo.state === destino) {
          return ok(alvo)
        }
        if (!canTransition(alvo.state, destino)) {
          // A mensagem cita os rótulos em português: quem usa o painel não
          // conhece a máquina de estados, e "ready → done" não explica nada.
          return err(
            new ValidationError(
              `Não dá para ir de "${taskStateLabel(alvo.state)}" para "${taskStateLabel(destino)}".`,
              { context: { from: alvo.state, to: destino } },
            ),
          )
        }
        const motivo = (reason ?? '').trim()
        if (destino === 'blocked' && motivo === '') {
          return err(
            new ValidationError(
              'Bloquear exige um motivo — sem ele a task some da fila sem ninguém saber o que destrava.',
              { context: { field: 'reason' } },
            ),
          )
        }
        const movida = transition(alvo, destino, {
          at: deps.now(),
          ...(destino === 'blocked'
            ? {
                blockReason: {
                  kind: 'human' as const,
                  message: motivo,
                  resolvableBy: 'human' as const,
                },
              }
            : {}),
        })
        if (!movida.ok) return err(movida.error)
        const salva = await deps.state.tasks.save(movida.value)
        return salva.ok ? ok(movida.value) : err(salva.error)
      },

      async remove(id): Promise<Result<void>> {
        const alvo = await deps.state.tasks.find(id as Task['id'])
        if (alvo === undefined) {
          return err(new ValidationError(`Task "${id}" não encontrada.`))
        }
        return deps.state.tasks.delete(alvo.id)
      },
    },

    backlog: {
      list: () => deps.backlog.list(),

      async create(input): Promise<Result<StoredBacklogItem>> {
        return deps.backlog.add({
          title: input.title,
          body: input.body,
          ...(input.priority === undefined ? {} : { priority: input.priority }),
          ...(input.labels === undefined ? {} : { labels: input.labels }),
          createdAt: deps.now(),
        })
      },

      async update(id, patch): Promise<Result<StoredBacklogItem>> {
        const item = await deps.backlog.get(id)
        if (item === undefined) {
          return err(new ValidationError(`Item "${id}" não encontrado.`))
        }
        // Lista fechada de campos editáveis: `planId`, `createdAt` e
        // `externalRef` são identidade e procedência, não conteúdo. Deixar o
        // painel sobrescrevê-los quebraria a deduplicação cross-project e o
        // vínculo com as subtasks.
        const atualizado: StoredBacklogItem = {
          ...item,
          ...(typeof patch['title'] === 'string' && patch['title'].trim() !== ''
            ? { title: patch['title'].trim() }
            : {}),
          ...(typeof patch['body'] === 'string' ? { body: patch['body'] } : {}),
          ...(typeof patch['priority'] === 'number'
            ? { priority: clamp(patch['priority'], 0, 100) }
            : {}),
          ...(isItemState(patch['state']) ? { state: patch['state'] } : {}),
          ...(Array.isArray(patch['labels'])
            ? { labels: (patch['labels'] as unknown[]).map(String) }
            : {}),
        }
        const written = await deps.backlog.update(atualizado)
        return written.ok ? ok(atualizado) : err(written.error)
      },

      remove: (id) => deps.backlog.remove(id),
    },

    config: {
      categories: () => CONFIG_CATEGORIES,

      async effective() {
        const loaded = await loadConfig({ projectDir: deps.projectDir })
        if (!loaded.ok) return { values: {}, origins: {} }
        // Indexado pelo MESMO `path` das perguntas — é o que deixa o painel
        // casar valor, origem e pergunta sem tabela de conversão.
        const values: Record<string, unknown> = {}
        const origins: Record<string, string> = {}
        for (const category of CONFIG_CATEGORIES) {
          for (const question of category.questions) {
            values[question.path] = valueAt(loaded.value.config, question.path)
            origins[question.path] = loaded.value.origins.get(question.path)?.layer ?? 'default'
          }
        }
        return { values, origins }
      },

      async set(path, value): Promise<Result<void>> {
        const loaded = await loadConfig({ projectDir: deps.projectDir })
        if (!loaded.ok) return err(loaded.error)
        const camada = loaded.value.layers.find((layer) => layer.name === 'project')
        if (camada === undefined) {
          return err(new ValidationError('Nenhuma configuração de projeto. Rode: uranus init'))
        }
        if (camada.source.endsWith('.json')) {
          return err(
            new ValidationError(
              `A configuração deste projeto está em JSON (${camada.source}); a edição pelo painel só mexe em YAML.`,
            ),
          )
        }

        const doc = parseDocument(await readFile(camada.source, 'utf8'))
        // Grava numa cópia e só efetiva depois de validar: um PATCH inválido
        // não pode deixar no disco um arquivo que o próximo boot recusa a ler.
        const rascunho = cloneDocument(doc)
        applyWrites(rascunho, loaded.value.config, [{ path, value }])
        const validado = validateProjectData(documentToData(rascunho), loaded.value.layers)
        if (!validado.ok) return err(validado.error)

        await writeFile(camada.source, rascunho.toString(), 'utf8')
        deps.logger.info('Configuração alterada pelo painel', { path })
        return ok()
      },
    },

    instructions: {
      list: () => deps.instructions.list(),

      async create(input) {
        const created = await deps.instructions.add(
          {
            title: input.title,
            body: input.body,
            ...(input.scope === undefined ? {} : { scope: input.scope }),
          },
          deps.now(),
        )
        if (created.ok) await syncClaudeConfig(deps)
        return created
      },

      async update(id, patch) {
        const updated = await deps.instructions.update(
          id,
          {
            ...(patch.title === undefined ? {} : { title: patch.title }),
            ...(patch.body === undefined ? {} : { body: patch.body }),
            ...(patch.scope === undefined ? {} : { scope: patch.scope }),
          },
          deps.now(),
        )
        if (updated.ok) await syncClaudeConfig(deps)
        return updated
      },

      async remove(id) {
        const removed = await deps.instructions.remove(id)
        if (removed.ok) await syncClaudeConfig(deps)
        return removed
      },
    },

    skills: {
      async list() {
        const installed = new Set(await installedSkillIds(deps.projectDir))
        return SKILLS_CATALOG.map((skill) => ({
          id: skill.id,
          title: skill.title,
          description: skill.description,
          official: skill.official,
          sourceRepo: skill.sourceRepo,
          sourceUrl: skill.sourceUrl,
          installed: installed.has(skill.id),
        }))
      },

      install: (id) => installSkill(deps.projectDir, id),
    },

    vault: {
      async graph() {
        await deps.memory.reload?.()
        const [memory, backlog, instructions] = await Promise.all([
          deps.memory.query({}),
          deps.backlog.list(),
          deps.instructions.list(),
        ])
        return buildVaultGraph({ memory, backlog, instructions })
      },
    },

    graphify: {
      graph: () => readGraphifyGraph(deps.projectDir),
    },

    memory: {
      async list() {
        await deps.memory.reload?.()
        return deps.memory.query({})
      },

      async create(input): Promise<Result<MemoryRecord>> {
        await deps.memory.reload?.()
        if (!isMemoryScope(input.scope)) {
          return err(
            new ValidationError(
              `Escopo inválido: "${input.scope}". Use um de: ${MEMORY_SCOPES.join(', ')}.`,
            ),
          )
        }
        const title = input.title.trim()
        if (title === '') {
          return err(new ValidationError('A memória precisa de um título.'))
        }
        // Mesma porta que `uranus memory add`: dedupe por chave e piso de
        // confiança são aplicados aqui, não reimplementados pelo painel.
        const draft: MemoryDraft = {
          scope: input.scope,
          key: slugifyMemoryKey(title),
          title,
          body: input.body,
          tags: input.tags ?? [],
          confidence: input.confidence ?? 0.8,
          // `human`, ao contrário do `agent` do `uranus memory add`: quem grava
          // pelo painel é a pessoa no navegador, não o Claude na sessão de chat.
          source: { kind: 'human', ref: 'painel' },
          refs: [],
        }
        const saved = await deps.memoryManager.remember([draft])
        const record = saved[0]
        if (record === undefined) {
          return err(
            new ValidationError(
              'Memória não gravada — confiança abaixo do piso configurado (memory.minConfidence).',
            ),
          )
        }
        return ok(record)
      },

      watch: (onChange) => watchMemoryDir(deps.memoryDir, onChange),
    },

    github: {
      overview: () => deps.github.overview(),
      reviewPullRequest: (repo, number, action, body) => deps.github.reviewPullRequest(repo, number, action, body),
      mergePullRequest: (repo, number, method) => deps.github.mergePullRequest(repo, number, method),
      closePullRequest: (repo, number) => deps.github.closePullRequest(repo, number),
    },
  }
}

function isMemoryScope(value: string): value is MemoryDraft['scope'] {
  return (MEMORY_SCOPES as readonly string[]).includes(value)
}

/** Sem sufixo de tempo: a chave é o que faz duas gravações do mesmo fato colidirem (dedupe). */
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

/**
 * Regrava `CLAUDE.md` (raiz + um por pasta com `scope`) com as instruções
 * atuais, para que uma edição pelo painel valha na PRÓXIMA mensagem da sessão
 * `uranus chat`, sem exigir `uranus init`/`uranus claude sync` manual.
 *
 * Roda sem `digest` de propósito: recalcular stack/frameworks a cada escrita
 * do painel seria caro e não é o que mudou. A seção "## Projeto" volta a
 * aparecer no próximo `uranus init`/`attach`, que já recalcula o digest.
 */
async function syncClaudeConfig(deps: DashboardDataDeps): Promise<void> {
  const notes = await deps.instructions.list()
  await writeClaudeConfig({
    projectDir: deps.projectDir,
    projectName: deps.projectName,
    instructions: notes,
  })
}

/** Teto por check criado pelo painel. Generoso: suíte de projeto real demora. */
const CHECK_TIMEOUT_MS = 600_000

function checkFor(kind: string, index: number): Task['acceptance']['checks'][number] {
  const id = `${kind}-${String(index + 1)}`
  if (kind === 'tests') {
    return { id, kind: 'tests', runner: 'npm', timeoutMs: CHECK_TIMEOUT_MS }
  }
  // `command` sem comando não é verificável e `schema` exige saída estruturada;
  // o painel só oferece os checks que conseguem se auto-configurar, e qualquer
  // outra coisa cai no diff não-vazio — a garantia mínima contra o R1
  // (modelo declarar sucesso sem alterar arquivo nenhum).
  return { id, kind: 'diff', requireNonEmpty: true, timeoutMs: CHECK_TIMEOUT_MS }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

function isItemState(value: unknown): value is StoredBacklogItem['state'] {
  return value === 'open' || value === 'planned' || value === 'done' || value === 'dropped'
}

function valueAt(data: unknown, path: string): unknown {
  let atual: unknown = data
  for (const parte of path.split('.')) {
    if (atual === null || typeof atual !== 'object') return undefined
    atual = (atual as Record<string, unknown>)[parte]
  }
  return atual
}
