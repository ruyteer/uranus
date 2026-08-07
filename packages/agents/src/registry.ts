import type {
  AgentHooks,
  AgentRegistry,
  AgentSpec,
  ProviderCapabilities,
  Result,
  Task,
} from '@uranus/core'
import { NotFoundError, ValidationError, err, isEnforceable, ok } from '@uranus/core'

/**
 * Registro e roteamento de agentes (ADR-008).
 *
 * Validação no `register`, não no uso: um agente com spec inválida falha na
 * inicialização do kernel — nunca no meio de um run às 3 da manhã.
 */
export class DefaultAgentRegistry implements AgentRegistry {
  private readonly specs = new Map<string, AgentSpec>()
  private readonly agentHooks = new Map<string, AgentHooks>()

  register(spec: AgentSpec, hooks?: AgentHooks): Result<void> {
    const problems = validateSpec(spec)
    if (problems.length > 0) {
      return err(
        new ValidationError(`Spec do agente "${spec.name}" inválida: ${problems.join('; ')}`, {
          context: { agent: spec.name, problems },
        }),
      )
    }
    this.specs.set(spec.name, spec)
    if (hooks !== undefined) this.agentHooks.set(spec.name, hooks)
    return ok()
  }

  get(name: string): AgentSpec | undefined {
    return this.specs.get(name)
  }

  hooks(name: string): AgentHooks | undefined {
    return this.agentHooks.get(name)
  }

  /**
   * Roteamento: `handles ∩ task.kind`, filtro por `requires ⊆ capabilities`,
   * desempate por `specificity` (plugins > genéricos), depois por nome (estável).
   */
  resolve(task: Task, capabilities: ProviderCapabilities): Result<AgentSpec> {
    if (task.agentHint !== undefined) {
      const hinted = this.specs.get(task.agentHint)
      if (hinted !== undefined && meetsRequirements(hinted, capabilities)) return ok(hinted)
    }

    const candidates = [...this.specs.values()]
      .filter((spec) => spec.handles.includes(task.kind))
      .filter((spec) => meetsRequirements(spec, capabilities))
      .sort((a, b) => b.specificity - a.specificity || a.name.localeCompare(b.name))

    const chosen = candidates[0]
    if (chosen === undefined) {
      return err(
        new NotFoundError(`Nenhum agente registrado atende tasks do tipo "${task.kind}"`, {
          context: { kind: task.kind, agents: [...this.specs.keys()] },
        }),
      )
    }
    return ok(chosen)
  }

  list(): readonly AgentSpec[] {
    return [...this.specs.values()]
  }
}

function meetsRequirements(spec: AgentSpec, capabilities: ProviderCapabilities): boolean {
  const required = spec.requires
  if (required === undefined) return true
  const caps = capabilities as unknown as Record<string, unknown>
  for (const [key, value] of Object.entries(required) as [string, unknown][]) {
    if (value === undefined) continue
    const actual = caps[key]
    if (typeof value === 'boolean' && value && actual !== true) return false
    if (typeof value === 'number' && typeof actual === 'number' && actual < value) return false
  }
  return true
}

/** Os sete campos obrigatórios da arquitetura, verificados de fato. */
export function validateSpec(spec: AgentSpec): readonly string[] {
  const problems: string[] = []
  if (spec.name.trim() === '') problems.push('name vazio')
  if (spec.mission.trim().length < 10) problems.push('mission ausente ou trivial')
  if (spec.responsibilities.length === 0) problems.push('responsibilities vazio')
  if (spec.handles.length === 0) problems.push('handles vazio — agente inalcançável')
  if (spec.prompts.system.trim() === '' || spec.prompts.instruction.trim() === '') {
    problems.push('prompts.system e prompts.instruction são obrigatórios')
  }
  if (!isEnforceable(spec.successCriteria)) {
    // Agente sem critério de sucesso executável é trabalho não-verificável (INV-2).
    problems.push('successCriteria sem check bloqueante')
  }
  if (spec.limits.maxTokens <= 0 || spec.limits.maxWallclockMs <= 0 || spec.limits.maxTurns <= 0) {
    problems.push('limits devem ser positivos')
  }
  return problems
}
