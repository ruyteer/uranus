import { readFile, readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
  ConfigReader,
  EventBus,
  Logger,
  Plugin,
  PluginLoader,
  PluginManifest,
  ProjectRef,
  Result,
  ShellRunner,
} from '@uranus/core'
import { NotFoundError, PluginError, err, ok, tryParseJson } from '@uranus/core'
import { formatViolations, scanCapabilities } from './capability-scan.js'
import { ScopedPluginContext } from './context.js'
import { evaluateDetect } from './detect.js'
import { validateManifest } from './manifest.js'
import type { PluginRegistry } from './registry.js'

const MANIFEST_FILE = 'uranus.plugin.json'

export type PluginOrigin = 'builtin' | 'project' | 'node_modules'

export interface DiscoveredPlugin {
  readonly manifest: PluginManifest
  readonly origin: PluginOrigin
  /** Diretório do plugin. Ausente em builtins, que já vêm em memória. */
  readonly dir?: string
  /** Instância já resolvida. Presente apenas em builtins. */
  readonly instance?: Plugin
}

export interface PluginLoaderOptions {
  readonly project: ProjectRef
  readonly logger: Logger
  readonly config: ConfigReader
  readonly shell: ShellRunner
  readonly events: EventBus
  readonly registry: PluginRegistry
  /**
   * Plugins que acompanham o framework. Não passam por import dinâmico nem
   * por varredura de capacidades: eles são parte do produto e têm a mesma
   * confiança que o kernel. O que continua valendo para eles é o `detect` —
   * um builtin só liga se o projeto for daquele tipo.
   */
  readonly builtins?: readonly Plugin[]
  /** Ids listados em `config.plugins`. Ativam mesmo sem `detect`. */
  readonly enabled?: readonly string[]
  /** Ids que nunca ativam, mesmo detectados. */
  readonly disabled?: readonly string[]
  /** Recorta a config para `plugins.<id>.*`. Sem isto, o plugin lê a config toda. */
  readonly configFor?: (pluginId: string) => ConfigReader
  /** `false` desliga a varredura estática de capacidades (não recomendado). */
  readonly enforceCapabilities?: boolean
}

export interface ActivationReport {
  readonly activated: readonly { id: string; reason: string }[]
  readonly skipped: readonly { id: string; reason: string }[]
  readonly failed: readonly { id: string; error: string }[]
}

/**
 * Carregador de plugins.
 *
 * Três garantias que importam mais do que a mecânica:
 *
 * 1. **Falha de plugin é contida.** Manifesto inválido, import quebrado ou
 *    exceção no `activate` viram entrada no relatório — o kernel continua. Um
 *    plugin ruim degrada capacidades, não derruba o run (R17).
 *
 * 2. **Ativação é explicável.** Todo plugin ativado carrega o motivo ("arquivo
 *    `next.config.js` existe") e todo pulado carrega o porquê. É o que
 *    `uranus plugin list` mostra — ninguém precisa adivinhar de onde veio um
 *    check que reprovou a task.
 *
 * 3. **Capacidade não declarada barra a ativação** de plugin de terceiro. Ver a
 *    nota de honestidade em `capability-scan.ts` sobre o alcance real disso.
 */
export class DefaultPluginLoader implements PluginLoader {
  private readonly contexts = new Map<string, ScopedPluginContext>()
  private readonly instances = new Map<string, Plugin>()
  private readonly discovered = new Map<string, DiscoveredPlugin>()

  constructor(private readonly options: PluginLoaderOptions) {}

  async discover(project: ProjectRef): Promise<readonly PluginManifest[]> {
    return (await this.discoverDetailed(project)).map((entry) => entry.manifest)
  }

  async discoverDetailed(project: ProjectRef): Promise<readonly DiscoveredPlugin[]> {
    const found: DiscoveredPlugin[] = []
    const seen = new Set<string>()

    // Ordem = precedência. Um plugin em `.uranus/plugins/` com o mesmo id de um
    // builtin substitui o builtin: é assim que o usuário corrige ou estende um
    // plugin do framework sem esperar por uma release.
    const add = (entry: DiscoveredPlugin): void => {
      if (seen.has(entry.manifest.id)) return
      seen.add(entry.manifest.id)
      found.push(entry)
      this.discovered.set(entry.manifest.id, entry)
    }

    for (const entry of await this.scanDir(join(project.uranusDir, 'plugins'), 'project', false)) {
      add(entry)
    }
    for (const entry of await this.scanDir(
      join(project.rootDir, 'node_modules'),
      'node_modules',
      true,
    )) {
      add(entry)
    }
    for (const plugin of this.options.builtins ?? []) {
      const validated = validateManifest(plugin.manifest, `builtin:${plugin.manifest.id}`)
      if (!validated.ok) {
        // Manifesto builtin inválido é bug nosso, não do usuário — mas ainda
        // assim não vale derrubar o run por causa disso.
        this.options.logger.error(validated.error.message)
        continue
      }
      add({ manifest: validated.value, origin: 'builtin', instance: plugin })
    }

    return found
  }

  /** Descobre, decide o que ativa e ativa. Ponto de entrada da composição. */
  async loadAll(signal: AbortSignal): Promise<ActivationReport> {
    const activated: { id: string; reason: string }[] = []
    const skipped: { id: string; reason: string }[] = []
    const failed: { id: string; error: string }[] = []

    const enabled = new Set(this.options.enabled ?? [])
    const disabled = new Set(this.options.disabled ?? [])

    for (const entry of await this.discoverDetailed(this.options.project)) {
      const id = entry.manifest.id

      if (disabled.has(id)) {
        skipped.push({ id, reason: 'desligado na configuração' })
        continue
      }

      let reason: string
      if (enabled.has(id)) {
        reason = 'listado em config.plugins'
      } else {
        const detected = await evaluateDetect(entry.manifest.detect ?? [], {
          project: this.options.project,
          shell: this.options.shell,
          allowExec: entry.manifest.permissions.exec,
          signal,
        })
        if (!detected.matched) {
          skipped.push({
            id,
            reason:
              (entry.manifest.detect ?? []).length === 0
                ? 'sem regra de detecção; ative em config.plugins'
                : 'nenhuma regra de detecção casou com este projeto',
          })
          continue
        }
        reason = detected.reason ?? 'detectado'
      }

      const loaded = await this.load(id)
      if (!loaded.ok) {
        failed.push({ id, error: loaded.error.message })
        this.options.logger.warn('Plugin não pôde ser carregado', {
          plugin: id,
          error: loaded.error.message,
        })
        continue
      }
      const result = await this.activate(loaded.value, this.options.project)
      if (result.ok) activated.push({ id, reason })
      else failed.push({ id, error: result.error.message })
    }

    this.options.logger.info('Plugins carregados', {
      ativados: activated.map((entry) => entry.id),
      falharam: failed.map((entry) => entry.id),
    })
    return { activated, skipped, failed }
  }

  async load(id: string): Promise<Result<Plugin>> {
    const entry = this.discovered.get(id)
    if (entry === undefined) {
      return err(new NotFoundError(`Plugin "${id}" não foi descoberto.`, { context: { id } }))
    }
    if (entry.instance !== undefined) {
      this.instances.set(id, entry.instance)
      return ok(entry.instance)
    }
    const dir = entry.dir
    if (dir === undefined) {
      return err(new PluginError(`Plugin "${id}" não tem diretório nem instância.`))
    }

    if (this.options.enforceCapabilities !== false) {
      const scan = await scanCapabilities(dir, entry.manifest.permissions)
      if (scan.violations.length > 0) {
        return err(
          new PluginError(formatViolations(id, scan.violations), {
            context: { id, violations: scan.violations },
          }),
        )
      }
    }

    const entryFile = await resolveEntryFile(dir)
    if (entryFile === undefined) {
      return err(
        new PluginError(
          `Plugin "${id}" não tem ponto de entrada carregável (esperado "main"/"module" no package.json ou dist/index.js).`,
        ),
      )
    }

    try {
      const module = (await import(pathToFileURL(entryFile).href)) as { default?: unknown }
      const exported = module.default
      if (
        exported === null ||
        typeof exported !== 'object' ||
        typeof (exported as Plugin).activate !== 'function'
      ) {
        return err(
          new PluginError(
            `Plugin "${id}" precisa exportar como default um objeto com "manifest" e "activate".`,
          ),
        )
      }
      // O manifesto do arquivo é a fonte da verdade: foi ele que passou pela
      // validação e é ele que o usuário aprovou na instalação. Um manifesto
      // embutido no código poderia declarar menos permissões do que usa.
      const plugin: Plugin = { ...(exported as Plugin), manifest: entry.manifest }
      this.instances.set(id, plugin)
      return ok(plugin)
    } catch (error: unknown) {
      return err(
        new PluginError(`Falha ao importar o plugin "${id}"`, {
          cause: error,
          context: { id, entry: entryFile },
        }),
      )
    }
  }

  async activate(plugin: Plugin, project: ProjectRef): Promise<Result<void>> {
    const id = plugin.manifest.id
    const context = new ScopedPluginContext({
      manifest: plugin.manifest,
      project,
      logger: this.options.logger,
      config: this.options.configFor?.(id) ?? this.options.config,
      shell: this.options.shell,
      events: this.options.events,
      registry: this.options.registry,
    })

    try {
      await plugin.activate(context)
      this.contexts.set(id, context)
      this.instances.set(id, plugin)
      return ok()
    } catch (error: unknown) {
      // Contenção: desfaz o que o plugin conseguiu registrar antes de quebrar.
      // Meio-plugin ativo é pior que plugin ausente — o usuário veria um agente
      // sem o check que o acompanha.
      context.dispose()
      this.options.registry.removePlugin(id)
      this.options.logger.error('Plugin falhou ao ativar; o kernel continua sem ele', {
        plugin: id,
        error: error instanceof Error ? error.message : String(error),
      })
      return err(
        new PluginError(`Plugin "${id}" falhou ao ativar`, { cause: error, context: { id } }),
      )
    }
  }

  async deactivate(id: string): Promise<void> {
    const context = this.contexts.get(id)
    if (context === undefined) return
    context.dispose()
    this.options.registry.removePlugin(id)
    this.contexts.delete(id)

    const plugin = this.instances.get(id)
    try {
      await plugin?.deactivate?.()
    } catch (error: unknown) {
      this.options.logger.warn('deactivate() do plugin lançou; ignorado', {
        plugin: id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async deactivateAll(): Promise<void> {
    for (const id of [...this.contexts.keys()]) await this.deactivate(id)
  }

  active(): readonly PluginManifest[] {
    return [...this.contexts.keys()]
      .map((id) => this.discovered.get(id)?.manifest)
      .filter((manifest): manifest is PluginManifest => manifest !== undefined)
  }

  entryOf(id: string): DiscoveredPlugin | undefined {
    return this.discovered.get(id)
  }

  // ── Interno ───────────────────────────────────────────────────────────────

  private async scanDir(
    baseDir: string,
    origin: PluginOrigin,
    scoped: boolean,
  ): Promise<readonly DiscoveredPlugin[]> {
    let entries: string[]
    try {
      entries = await readdir(baseDir)
    } catch {
      return []
    }

    const found: DiscoveredPlugin[] = []
    for (const name of entries.sort()) {
      const dir = join(baseDir, name)
      if (scoped && name.startsWith('@')) {
        // `node_modules/@escopo/uranus-plugin-x`
        found.push(...(await this.scanDir(dir, origin, false)))
        continue
      }
      // Em node_modules só olhamos o que se anuncia como plugin: varrer todo o
      // node_modules atrás de manifestos custaria segundos em todo boot.
      if (origin === 'node_modules' && !name.includes('uranus-plugin')) continue
      if (!(await isDirectory(dir))) continue

      const manifest = await this.readManifest(dir)
      if (manifest !== undefined) found.push({ manifest, dir, origin })
    }
    return found
  }

  private async readManifest(dir: string): Promise<PluginManifest | undefined> {
    let raw: string
    try {
      raw = await readFile(join(dir, MANIFEST_FILE), 'utf8')
    } catch {
      return undefined
    }
    const parsed = tryParseJson(raw)
    if (parsed === undefined) {
      this.options.logger.warn('Manifesto de plugin ilegível; ignorado', { dir })
      return undefined
    }
    const validated = validateManifest(parsed, join(dir, MANIFEST_FILE))
    if (!validated.ok) {
      this.options.logger.warn(validated.error.message, { dir })
      return undefined
    }
    return validated.value
  }
}

async function resolveEntryFile(dir: string): Promise<string | undefined> {
  const pkg = tryParseJson<{ main?: string; module?: string }>(
    await readFile(join(dir, 'package.json'), 'utf8').catch(() => '{}'),
  )
  const candidates = [pkg?.module, pkg?.main, 'dist/index.js', 'index.js', 'index.mjs'].filter(
    (candidate): candidate is string => typeof candidate === 'string',
  )
  for (const candidate of candidates) {
    const path = resolve(dir, candidate)
    if (await isFile(path)) return path
  }
  return undefined
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}
