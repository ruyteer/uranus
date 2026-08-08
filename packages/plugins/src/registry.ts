import type {
  AgentSpec,
  CheckImpl,
  ContextSource,
  Logger,
  PromptTemplate,
  Rule,
  SchedulerPolicy,
  Tool,
} from '@uranus/core'

/**
 * Coleta o que os plugins registram, com atribuição de origem.
 *
 * Guardar quem registrou o quê não é burocracia: quando um check de plugin
 * reprova uma task ou um agente de plugin se comporta mal, a primeira pergunta
 * é "de onde isso veio?". Sem atribuição, a resposta exige arqueologia.
 */

export interface Registration<T> {
  readonly pluginId: string
  readonly value: T
}

export interface PluginRegistrations {
  readonly agents: readonly Registration<AgentSpec>[]
  readonly tools: readonly Registration<Tool>[]
  readonly checks: readonly Registration<CheckImpl>[]
  readonly contextSources: readonly Registration<ContextSource>[]
  readonly prompts: readonly Registration<PromptTemplate>[]
  readonly rules: readonly Registration<Rule>[]
  readonly schedulerPolicies: readonly Registration<{
    policy: SchedulerPolicy
    weight: number
  }>[]
  readonly testRunners: readonly Registration<{ runner: string; command: string }>[]
}

export class PluginRegistry {
  private readonly agents: Registration<AgentSpec>[] = []
  private readonly tools: Registration<Tool>[] = []
  private readonly checks: Registration<CheckImpl>[] = []
  private readonly contextSources: Registration<ContextSource>[] = []
  private readonly prompts: Registration<PromptTemplate>[] = []
  private readonly rules: Registration<Rule>[] = []
  private readonly schedulerPolicies: Registration<{
    policy: SchedulerPolicy
    weight: number
  }>[] = []
  private readonly testRunners: Registration<{ runner: string; command: string }>[] = []

  constructor(private readonly logger: Logger) {}

  addAgent(pluginId: string, value: AgentSpec): void {
    this.warnDuplicate('agente', pluginId, value.name, this.agents, (r) => r.value.name)
    this.agents.push({ pluginId, value })
  }

  addTool(pluginId: string, value: Tool): void {
    this.warnDuplicate('ferramenta', pluginId, value.name, this.tools, (r) => r.value.name)
    this.tools.push({ pluginId, value })
  }

  addCheck(pluginId: string, value: CheckImpl): void {
    this.checks.push({ pluginId, value })
  }

  addContextSource(pluginId: string, value: ContextSource): void {
    this.warnDuplicate('context source', pluginId, value.id, this.contextSources, (r) => r.value.id)
    this.contextSources.push({ pluginId, value })
  }

  addPrompt(pluginId: string, value: PromptTemplate): void {
    this.prompts.push({ pluginId, value })
  }

  addRule(pluginId: string, value: Rule): void {
    this.rules.push({ pluginId, value })
  }

  addSchedulerPolicy(pluginId: string, policy: SchedulerPolicy, weight: number): void {
    this.schedulerPolicies.push({ pluginId, value: { policy, weight } })
  }

  addTestRunner(pluginId: string, runner: string, command: string): void {
    this.warnDuplicate('runner de teste', pluginId, runner, this.testRunners, (r) => r.value.runner)
    this.testRunners.push({ pluginId, value: { runner, command } })
  }

  /**
   * Resolve `TestsCheck.runner` para o comando concreto. O último registro
   * vence — plugin de projeto sobrepõe builtin, que é a precedência esperada.
   */
  resolveTestCommand(runner: string): string | undefined {
    for (let index = this.testRunners.length - 1; index >= 0; index--) {
      const entry = this.testRunners[index]!
      if (entry.value.runner === runner) return entry.value.command
    }
    return undefined
  }

  /** Runners conhecidos, para o Planner saber o que pode citar num plano. */
  knownTestRunners(): readonly string[] {
    return [...new Set(this.testRunners.map((entry) => entry.value.runner))]
  }

  /** Remove tudo o que um plugin registrou. Usado ao desativar. */
  removePlugin(pluginId: string): void {
    for (const list of [
      this.agents,
      this.tools,
      this.checks,
      this.contextSources,
      this.prompts,
      this.rules,
      this.schedulerPolicies,
      this.testRunners,
    ] as { pluginId: string }[][]) {
      for (let index = list.length - 1; index >= 0; index--) {
        if (list[index]!.pluginId === pluginId) list.splice(index, 1)
      }
    }
  }

  snapshot(): PluginRegistrations {
    return {
      agents: [...this.agents],
      tools: [...this.tools],
      checks: [...this.checks],
      contextSources: [...this.contextSources],
      prompts: [...this.prompts],
      rules: [...this.rules],
      schedulerPolicies: [...this.schedulerPolicies],
      testRunners: [...this.testRunners],
    }
  }

  /** Resumo por plugin, para `uranus plugin list`. */
  summaryOf(pluginId: string): Readonly<Record<string, number>> {
    const count = <T>(list: readonly Registration<T>[]): number =>
      list.filter((entry) => entry.pluginId === pluginId).length
    return {
      agentes: count(this.agents),
      ferramentas: count(this.tools),
      checks: count(this.checks),
      contextSources: count(this.contextSources),
      prompts: count(this.prompts),
      regras: count(this.rules),
      políticas: count(this.schedulerPolicies),
      runners: count(this.testRunners),
    }
  }

  /**
   * Colisão de nome não é erro fatal: o último registrado vence, e o aviso
   * deixa rastro. Recusar quebraria um projeto por causa de dois plugins que
   * o usuário talvez queira mesmo ter juntos.
   */
  private warnDuplicate<T>(
    kind: string,
    pluginId: string,
    name: string,
    list: readonly Registration<T>[],
    nameOf: (entry: Registration<T>) => string,
  ): void {
    const existing = list.find((entry) => nameOf(entry) === name)
    if (existing !== undefined) {
      this.logger.warn(`Colisão de ${kind}: o registro mais recente prevalece`, {
        name,
        anterior: existing.pluginId,
        novo: pluginId,
      })
    }
  }
}
