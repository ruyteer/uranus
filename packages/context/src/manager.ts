import { join } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type {
  Clock,
  ContextManager,
  EventBus,
  Logger,
  ProjectDigest,
  ProjectRef,
  ShellRunner,
} from '@uranus/core'
import { isRestrictedMode, tryParseJson, verificationSignalStrength } from '@uranus/core'
import { buildProjectDigest, freshnessKey } from './digest.js'

export interface DefaultContextManagerOptions {
  readonly shell: ShellRunner
  readonly clock: Clock
  readonly logger: Logger
  readonly events?: EventBus
}

const CACHE_FILE = 'project-digest.json'

/**
 * Gerência do `ProjectDigest`: bootstrap no attach, cache em disco, invalidação
 * por `FreshnessKey` (HEAD + lockfiles). O digest é reconstruído apenas quando
 * algo estrutural mudou — nunca a cada tick.
 */
export class DefaultContextManager implements ContextManager {
  private readonly shell: ShellRunner
  private readonly clock: Clock
  private readonly logger: Logger
  private readonly events: EventBus | undefined
  private cached: ProjectDigest | undefined

  constructor(options: DefaultContextManagerOptions) {
    this.shell = options.shell
    this.clock = options.clock
    this.logger = options.logger.child({ component: 'context-manager' })
    this.events = options.events
  }

  private cachePath(project: ProjectRef): string {
    return join(project.uranusDir, 'cache', CACHE_FILE)
  }

  async bootstrap(project: ProjectRef, signal: AbortSignal): Promise<ProjectDigest> {
    const started = this.clock.monotonic()
    const digest = await buildProjectDigest(project, this.shell, this.clock.now(), signal)
    this.cached = digest

    await mkdir(join(project.uranusDir, 'cache'), { recursive: true })
    await writeFile(this.cachePath(project), JSON.stringify(digest, null, 2)).catch(() => undefined)

    const strength = verificationSignalStrength(digest)
    this.logger.info('ProjectDigest gerado', {
      durationMs: Math.round(this.clock.monotonic() - started),
      languages: digest.languages.map((l) => l.name),
      frameworks: digest.frameworks,
      signalStrength: strength,
      restricted: isRestrictedMode(digest),
    })
    await this.events?.emit('ProjectDigestUpdated', {
      freshness: digest.freshness,
      signalStrength: strength,
      restricted: isRestrictedMode(digest),
    })
    return digest
  }

  async digest(project: ProjectRef): Promise<ProjectDigest | undefined> {
    if (this.cached !== undefined) return this.cached
    const raw = await readFile(this.cachePath(project), 'utf8').catch(() => undefined)
    if (raw === undefined) return undefined
    this.cached = tryParseJson<ProjectDigest>(raw)
    return this.cached
  }

  async isStale(project: ProjectRef, _signal: AbortSignal): Promise<boolean> {
    const current = await this.digest(project)
    if (current === undefined) return true
    const key = await freshnessKey(project, this.shell)
    return key !== current.freshness
  }

  invalidate(_sourceId?: string): void {
    this.cached = undefined
  }

  /** Garante digest fresco: rebootstrap somente quando o FreshnessKey mudou. */
  async ensureFresh(project: ProjectRef, signal: AbortSignal): Promise<ProjectDigest> {
    if (await this.isStale(project, signal)) {
      return this.bootstrap(project, signal)
    }
    return (await this.digest(project))!
  }
}
