import type { Logger } from '../logger.js'
import type { Result } from '../result.js'
import type { EventName } from '../domain/events.js'
import type { ProjectRef } from '../domain/project.js'
import type { Glob } from '../util/glob.js'
import type { AgentSpec, PromptTemplate, Tool } from './agent.js'
import type { ConfigReader, Unsubscribe } from './common.js'
import type { ContextSource } from './context.js'
import type { EventHandler, InterceptHandler, InterceptOptions } from './events.js'
import type { CheckImpl, ShellRunner } from './execution.js'
import type { SchedulerPolicy } from './queue.js'

export type DetectRule =
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'dependency'; readonly manifest: string; readonly name: string }
  | { readonly kind: 'glob'; readonly pattern: Glob }
  | { readonly kind: 'command'; readonly run: string; readonly expectExit: number }

export interface PluginPermissions {
  readonly fs: 'none' | 'read' | 'write'
  readonly net: boolean
  readonly exec: boolean
  readonly secrets: readonly string[]
}

export interface PluginManifest {
  readonly id: string
  readonly name: string
  readonly version: string
  /** Range semver do framework com que este plugin é compatível. */
  readonly uranus: string
  readonly description: string
  readonly provides: {
    readonly agents?: readonly string[]
    readonly tools?: readonly string[]
    readonly checks?: readonly string[]
    readonly contextSources?: readonly string[]
    readonly rules?: readonly string[]
    readonly prompts?: readonly string[]
    readonly schedulerPolicies?: readonly string[]
  }
  readonly permissions: PluginPermissions
  /** Ativação automática quando o projeto casa com alguma regra. */
  readonly detect?: readonly DetectRule[]
}

export interface Rule {
  readonly id: string
  readonly description: string
  readonly severity: 'info' | 'warn' | 'error'
  readonly appliesTo: readonly Glob[]
}

/**
 * A **única** superfície exposta a plugins (ADR-010).
 *
 * Sem acesso ao kernel, ao state store ou ao event store bruto. Um plugin não
 * consegue alterar estado diretamente — só registrar capacidades e observar/vetar
 * eventos. É o que mantém R17 (plugin malicioso ou defeituoso) contido.
 */
export interface PluginContext {
  readonly project: ProjectRef
  readonly logger: Logger
  readonly config: ConfigReader
  /** Sujeito às permissões declaradas no manifesto. */
  readonly shell: ShellRunner

  registerAgent(spec: AgentSpec): void
  registerTool(tool: Tool): void
  registerCheck(check: CheckImpl): void
  registerContextSource(source: ContextSource): void
  registerPrompt(template: PromptTemplate): void
  registerRule(rule: Rule): void
  registerSchedulerPolicy(policy: SchedulerPolicy, weight: number): void
  /**
   * Ensina ao verificador como rodar a suíte de um ecossistema — INV-8.
   *
   * `TestsCheck.runner` é um id abstrato (`vitest`, `pytest`, `phpunit`); o
   * comando concreto é conhecimento de stack, e stack é assunto de plugin. Sem
   * isto o kernel precisaria carregar um mapa de linguagens, que é exatamente o
   * que o INV-8 proíbe.
   */
  registerTestRunner(runner: string, command: string): void

  on<N extends EventName>(name: N | readonly N[], handler: EventHandler<N>): Unsubscribe
  intercept<N extends EventName>(
    name: N | readonly N[],
    handler: InterceptHandler<N>,
    options?: InterceptOptions,
  ): Unsubscribe
}

export interface Plugin {
  readonly manifest: PluginManifest
  activate(context: PluginContext): void | Promise<void>
  deactivate?(): void | Promise<void>
}

export interface PluginLoader {
  discover(project: ProjectRef): Promise<readonly PluginManifest[]>
  load(id: string): Promise<Result<Plugin>>
  /** Erro na ativação é contido e reportado; o kernel continua. */
  activate(plugin: Plugin, project: ProjectRef): Promise<Result<void>>
  deactivateAll(): Promise<void>
  active(): readonly PluginManifest[]
}
