import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { ZodError } from 'zod'
import { ConfigError, err, ok, type Result } from '@uranus/core'
import type { ConfigLayer } from './layers.js'
import { envLayer, mergeLayers, traceOrigins } from './layers.js'
import { uranusConfigSchema, type UranusConfig } from './schema.js'

export interface LoadOptions {
  readonly projectDir: string
  readonly globalConfigPath?: string
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly flags?: Readonly<Record<string, unknown>>
}

export interface LoadedConfig {
  readonly config: UranusConfig
  readonly layers: readonly ConfigLayer[]
  readonly origins: ReadonlyMap<string, { layer: string; source: string }>
}

const CONFIG_FILENAMES = ['config.yaml', 'config.yml', 'config.json'] as const

export function projectConfigDir(projectDir: string): string {
  return join(resolve(projectDir), '.uranus')
}

export function globalConfigPath(): string {
  return join(homedir(), '.uranus', 'config.yaml')
}

async function readLayer(
  path: string,
  name: ConfigLayer['name'],
): Promise<ConfigLayer | undefined> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return undefined
  }
  const parsed: unknown = path.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ConfigError(`Configuração deve ser um objeto no topo: ${path}`, {
      context: { path },
    })
  }
  return { name, source: path, data: parsed as Record<string, unknown> }
}

async function findProjectLayer(projectDir: string): Promise<ConfigLayer | undefined> {
  const dir = projectConfigDir(projectDir)
  for (const filename of CONFIG_FILENAMES) {
    const layer = await readLayer(join(dir, filename), 'project')
    if (layer !== undefined) return layer
  }
  return undefined
}

/**
 * Carrega e valida a configuração.
 *
 * Retorna `Result` em vez de lançar porque a CLI precisa formatar o erro com o
 * caminho do campo — e `uranus doctor` precisa relatar *todos* os problemas de
 * uma vez, não o primeiro.
 */
export async function loadConfig(options: LoadOptions): Promise<Result<LoadedConfig>> {
  const layers: ConfigLayer[] = []

  try {
    const globalPath = options.globalConfigPath ?? globalConfigPath()
    const global = await readLayer(globalPath, 'global')
    if (global !== undefined) layers.push(global)

    const project = await findProjectLayer(options.projectDir)
    if (project === undefined) {
      return err(
        new ConfigError(
          `Nenhum arquivo de configuração encontrado em ${projectConfigDir(options.projectDir)}. Rode "uranus init".`,
          { context: { projectDir: options.projectDir } },
        ),
      )
    }
    layers.push(project)

    layers.push(envLayer(options.env ?? process.env))

    if (options.flags !== undefined && Object.keys(options.flags).length > 0) {
      layers.push({ name: 'flags', source: 'cli', data: options.flags })
    }
  } catch (error: unknown) {
    return err(
      error instanceof ConfigError
        ? error
        : new ConfigError('Falha ao ler arquivo de configuração', { cause: error }),
    )
  }

  const merged = mergeLayers(layers)
  const parsed = uranusConfigSchema.safeParse(merged)
  if (!parsed.success) {
    return err(
      new ConfigError(formatZodError(parsed.error, layers), {
        cause: parsed.error,
        context: { issues: parsed.error.issues.length },
      }),
    )
  }

  return ok({ config: parsed.data, layers, origins: traceOrigins(layers) })
}

/** Valida um objeto já em memória. Usado em testes e no `uranus doctor`. */
export function parseConfig(data: unknown): Result<UranusConfig> {
  const parsed = uranusConfigSchema.safeParse(data)
  return parsed.success
    ? ok(parsed.data)
    : err(new ConfigError(formatZodError(parsed.error, []), { cause: parsed.error }))
}

/**
 * Mensagem de erro que aponta arquivo e caminho do campo.
 * A DoD da Fase 1 exige exatamente isso — um erro de config que não diz *onde*
 * custa mais tempo ao usuário do que a configuração inteira economiza.
 */
function formatZodError(error: ZodError, layers: readonly ConfigLayer[]): string {
  const origins = traceOrigins(layers)
  const lines = error.issues.map((issue) => {
    const path = issue.path.join('.')
    const origin = origins.get(path)
    const where = origin === undefined ? '' : ` (definido em ${origin.source})`
    return `  • ${path === '' ? '<raiz>' : path}: ${issue.message}${where}`
  })
  return `Configuração inválida:\n${lines.join('\n')}`
}
