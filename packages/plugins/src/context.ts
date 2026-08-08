import type {
  AgentSpec,
  CheckImpl,
  ConfigReader,
  ContextSource,
  EventBus,
  EventHandler,
  EventName,
  InterceptHandler,
  InterceptOptions,
  Logger,
  PluginContext,
  PluginManifest,
  ProjectRef,
  PromptTemplate,
  Rule,
  SchedulerPolicy,
  ShellCommand,
  ShellProcess,
  ShellResult,
  ShellRunner,
  Tool,
  Unsubscribe,
} from '@uranus/core'
import { PermissionDeniedError } from '@uranus/core'
import type { PluginRegistry } from './registry.js'

export interface PluginContextOptions {
  readonly manifest: PluginManifest
  readonly project: ProjectRef
  readonly logger: Logger
  readonly config: ConfigReader
  readonly shell: ShellRunner
  readonly events: EventBus
  readonly registry: PluginRegistry
}

/**
 * A única superfície exposta a um plugin (ADR-010).
 *
 * Sem acesso ao kernel, ao state store nem ao event store bruto. O plugin
 * registra capacidades e observa eventos — e é só.
 *
 * As assinaturas devolvem `Unsubscribe` que o loader coleciona, para que
 * desativar um plugin realmente o desligue em vez de deixar handlers órfãos
 * reagindo a eventos de um plugin que "não está mais lá".
 */
export class ScopedPluginContext implements PluginContext {
  readonly project: ProjectRef
  readonly logger: Logger
  readonly config: ConfigReader
  readonly shell: ShellRunner

  private readonly unsubscribes: Unsubscribe[] = []
  private active = true

  constructor(private readonly options: PluginContextOptions) {
    this.project = options.project
    this.logger = options.logger.child({ plugin: options.manifest.id })
    this.config = options.config
    // O shell entregue ao plugin respeita a permissão declarada no manifesto.
    this.shell = options.manifest.permissions.exec
      ? options.shell
      : deniedShell(options.manifest.id)
  }

  registerAgent(spec: AgentSpec): void {
    this.guard('registerAgent')
    this.options.registry.addAgent(this.options.manifest.id, spec)
  }

  registerTool(tool: Tool): void {
    this.guard('registerTool')
    this.options.registry.addTool(this.options.manifest.id, tool)
  }

  registerCheck(check: CheckImpl): void {
    this.guard('registerCheck')
    this.options.registry.addCheck(this.options.manifest.id, check)
  }

  registerContextSource(source: ContextSource): void {
    this.guard('registerContextSource')
    this.options.registry.addContextSource(this.options.manifest.id, source)
  }

  registerPrompt(template: PromptTemplate): void {
    this.guard('registerPrompt')
    this.options.registry.addPrompt(this.options.manifest.id, template)
  }

  registerRule(rule: Rule): void {
    this.guard('registerRule')
    this.options.registry.addRule(this.options.manifest.id, rule)
  }

  registerSchedulerPolicy(policy: SchedulerPolicy, weight: number): void {
    this.guard('registerSchedulerPolicy')
    this.options.registry.addSchedulerPolicy(this.options.manifest.id, policy, weight)
  }

  registerTestRunner(runner: string, command: string): void {
    this.guard('registerTestRunner')
    this.options.registry.addTestRunner(this.options.manifest.id, runner, command)
  }

  on<N extends EventName>(name: N | readonly N[], handler: EventHandler<N>): Unsubscribe {
    const unsubscribe = this.options.events.on(name, this.wrapHandler(handler))
    this.unsubscribes.push(unsubscribe)
    return unsubscribe
  }

  intercept<N extends EventName>(
    name: N | readonly N[],
    handler: InterceptHandler<N>,
    options: InterceptOptions = {},
  ): Unsubscribe {
    const unsubscribe = this.options.events.intercept(name, handler, options)
    this.unsubscribes.push(unsubscribe)
    return unsubscribe
  }

  /** Desliga tudo o que o plugin assinou. Chamado ao desativar. */
  dispose(): void {
    this.active = false
    for (const unsubscribe of this.unsubscribes) unsubscribe()
    this.unsubscribes.length = 0
  }

  /**
   * Registro fora do `activate` seria estado surgindo em momento imprevisível —
   * um agente aparecendo no meio de um tick, por exemplo. O ciclo de vida é
   * explícito: registra na ativação, some na desativação.
   */
  private guard(operation: string): void {
    if (!this.active) {
      throw new PermissionDeniedError(
        `Plugin "${this.options.manifest.id}" chamou ${operation} após ser desativado.`,
      )
    }
  }

  /** Erro em handler de plugin não pode derrubar o barramento (R17). */
  private wrapHandler<N extends EventName>(handler: EventHandler<N>): EventHandler<N> {
    return async (event) => {
      try {
        await handler(event)
      } catch (error: unknown) {
        this.logger.error('Handler de evento do plugin falhou', {
          event: event.name,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
}

/** Shell que recusa tudo, para plugins sem `permissions.exec`. */
function deniedShell(pluginId: string): ShellRunner {
  const denial = (command: ShellCommand): Error =>
    new PermissionDeniedError(
      `Plugin "${pluginId}" tentou executar "${command.command}" sem declarar "permissions.exec" no manifesto.`,
      { context: { pluginId, command: command.command } },
    )
  return {
    // `run` rejeita em vez de lançar de forma síncrona: quem chama uma API
    // assíncrona trata o erro no `catch` da promise, e um throw síncrono
    // escaparia desse tratamento.
    run: (command): Promise<ShellResult> => Promise.reject(denial(command)),
    spawn: (command): ShellProcess => {
      throw denial(command)
    },
  }
}
