import type { PromptRegistry, PromptTemplate, Result } from '@uranus/core'
import { NotFoundError, ValidationError, err, ok } from '@uranus/core'

const VARIABLE_RE = /\{\{([a-zA-Z][a-zA-Z0-9_.]*)\}\}/g

export function extractVariables(body: string): readonly string[] {
  const found = new Set<string>()
  for (const match of body.matchAll(VARIABLE_RE)) found.add(match[1]!)
  return [...found]
}

/**
 * Registro de prompts.
 *
 * Prompts são artefatos versionados e endereçáveis por id — nunca strings
 * inline em código de agente. É o que impede o "prompt gigante" que a
 * arquitetura proíbe, e o que permite fazer diff de prompt entre versões
 * quando a qualidade muda.
 *
 * Render é **estrito**: variável usada no template e não fornecida é erro, não
 * string vazia. Um `{{diagnosis}}` silenciosamente vazio produziria um retry
 * sem o diagnóstico — exatamente o loop cego que o R3 proíbe.
 */
export class DefaultPromptRegistry implements PromptRegistry {
  private readonly templates = new Map<string, PromptTemplate>()

  register(template: PromptTemplate): void {
    this.templates.set(template.id, template)
  }

  registerBody(id: string, version: string, body: string): void {
    this.register({ id, version, body, variables: extractVariables(body) })
  }

  get(id: string): PromptTemplate | undefined {
    return this.templates.get(id)
  }

  render(id: string, variables: Readonly<Record<string, string>>): Result<string> {
    const template = this.templates.get(id)
    if (template === undefined) {
      return err(new NotFoundError(`Prompt não registrado: ${id}`, { context: { id } }))
    }

    const missing = template.variables.filter((name) => variables[name] === undefined)
    if (missing.length > 0) {
      return err(
        new ValidationError(`Variáveis ausentes no render de "${id}": ${missing.join(', ')}`, {
          context: { id, missing },
        }),
      )
    }

    return ok(template.body.replaceAll(VARIABLE_RE, (_, name: string) => variables[name] ?? ''))
  }

  list(): readonly PromptTemplate[] {
    return [...this.templates.values()]
  }
}
