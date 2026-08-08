import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { AgentSpec, Logger, PermissionSet, Result, RunLimits } from '@uranus/core'
import { FINDINGS_OUTPUT_SCHEMA, ValidationError, err, ok, usd } from '@uranus/core'
import { PLAN_OUTPUT_SCHEMA } from '@uranus/backlog'

/**
 * Carrega `AgentSpec` de arquivos YAML (ADR-008).
 *
 * É isto que torna o catálogo de agentes configuração em vez de código: mudar
 * a missão, o escopo de ferramentas ou o critério de sucesso de um agente é
 * editar um `.yaml` — nada recompila. Plugins registram agentes pelo mesmo
 * caminho, sem escrever TypeScript.
 *
 * Os defaults abaixo existem para que uma spec curta seja legível; tudo o que
 * tem consequência de segurança (permissões, limites) tem default RESTRITIVO.
 */

/**
 * Schemas nomeados, referenciáveis do YAML por `schema: findings`.
 *
 * Sem isto, cada spec de revisão precisaria inline do schema inteiro de
 * findings — três cópias que divergem na primeira mudança. Plugins podem
 * registrar os seus pelo mesmo mecanismo.
 */
const NAMED_SCHEMAS: Record<string, unknown> = {
  findings: FINDINGS_OUTPUT_SCHEMA,
  plan: PLAN_OUTPUT_SCHEMA,
}

export function registerNamedSchema(name: string, schema: unknown): void {
  NAMED_SCHEMAS[name] = schema
}

function resolveSchema(value: unknown, context: string): Result<unknown> {
  if (typeof value === 'string') {
    const named = NAMED_SCHEMAS[value]
    if (named === undefined) {
      return err(
        new ValidationError(`Schema nomeado desconhecido: "${value}" (${context})`, {
          context: { available: Object.keys(NAMED_SCHEMAS) },
        }),
      )
    }
    return ok(named)
  }
  return ok(value)
}

const DEFAULT_LIMITS: RunLimits = {
  maxTokens: 200_000,
  maxWallclockMs: 10 * 60_000,
  maxTurns: 30,
  maxCost: usd(1),
}

/** Deny-by-default: uma spec que não declara permissões não escreve nada. */
const READ_ONLY_PERMISSIONS: PermissionSet = {
  tools: { allow: ['Read', 'Glob', 'Grep', 'LS'], deny: ['*'] },
  fs: { read: ['**'], write: [], deny: ['.git/**', '.env', '.env.*', '.uranus/**'] },
  network: false,
  exec: false,
  secrets: { allow: [] },
}

interface RawSpec {
  name?: string
  version?: string
  mission?: string
  responsibilities?: string[]
  inputs?: { schema?: unknown }
  outputs?: { schema?: unknown }
  memory?: { read?: string[]; write?: string[] }
  tools?: { allow?: string[]; deny?: string[] }
  permissions?: {
    fs?: { read?: string[]; write?: string[]; deny?: string[] }
    network?: string[] | false
    exec?: string[] | false
    secrets?: string[]
  }
  successCriteria?: { checks?: unknown[] }
  prompts?: { system?: string; instruction?: string }
  model?: { tier?: string; minContextTokens?: number }
  limits?: {
    maxTokens?: number
    maxWallclockMs?: number
    maxTurns?: number
    maxCostUsd?: number
  }
  handles?: string[]
  specificity?: number
  requires?: Record<string, unknown>
}

export function parseAgentSpec(raw: string, source: string): Result<AgentSpec> {
  let parsed: unknown
  try {
    parsed = parseYaml(raw)
  } catch (error: unknown) {
    return err(new ValidationError(`YAML inválido em ${source}`, { cause: error }))
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return err(new ValidationError(`Spec deve ser um objeto no topo: ${source}`))
  }

  const data = parsed as RawSpec
  if (data.name === undefined || data.name.trim() === '') {
    return err(new ValidationError(`Spec sem "name": ${source}`))
  }
  if (data.prompts?.system === undefined || data.prompts.instruction === undefined) {
    return err(new ValidationError(`Spec "${data.name}" sem prompts.system/instruction`))
  }

  const permissions = buildPermissions(data)

  const outputSchema = resolveSchema(data.outputs?.schema, `outputs de "${data.name}"`)
  if (!outputSchema.ok) return err(outputSchema.error)

  // Checks do tipo `schema` também aceitam nome — mesma razão.
  const checks: unknown[] = []
  for (const raw of data.successCriteria?.checks ?? []) {
    if (raw !== null && typeof raw === 'object' && (raw as { kind?: string }).kind === 'schema') {
      const check = raw as { schema?: unknown }
      const resolved = resolveSchema(check.schema, `check de "${data.name}"`)
      if (!resolved.ok) return err(resolved.error)
      checks.push({ ...check, schema: resolved.value })
    } else {
      checks.push(raw)
    }
  }

  const spec: AgentSpec = {
    name: data.name,
    version: data.version ?? '1.0.0',
    mission: data.mission ?? '',
    responsibilities: data.responsibilities ?? [],
    inputs: {
      schema: (data.inputs?.schema ?? { type: 'object' }) as AgentSpec['inputs']['schema'],
    },
    outputs:
      outputSchema.value === undefined
        ? {}
        : { schema: outputSchema.value as NonNullable<AgentSpec['outputs']['schema']> },
    memory: {
      read: (data.memory?.read ?? []) as AgentSpec['memory']['read'],
      write: (data.memory?.write ?? []) as AgentSpec['memory']['write'],
    },
    tools: {
      allow: data.tools?.allow ?? [...READ_ONLY_PERMISSIONS.tools.allow],
      deny: data.tools?.deny ?? [],
    },
    permissions,
    successCriteria: {
      checks: checks as AgentSpec['successCriteria']['checks'],
      requireAll: true,
    },
    prompts: { system: data.prompts.system, instruction: data.prompts.instruction },
    ...(data.model?.tier === undefined
      ? {}
      : {
          model: {
            tier: data.model.tier as 'fast' | 'balanced' | 'deep',
            ...(data.model.minContextTokens === undefined
              ? {}
              : { minContextTokens: data.model.minContextTokens }),
          },
        }),
    limits: {
      maxTokens: data.limits?.maxTokens ?? DEFAULT_LIMITS.maxTokens,
      maxWallclockMs: data.limits?.maxWallclockMs ?? DEFAULT_LIMITS.maxWallclockMs,
      maxTurns: data.limits?.maxTurns ?? DEFAULT_LIMITS.maxTurns,
      maxCost:
        data.limits?.maxCostUsd === undefined
          ? DEFAULT_LIMITS.maxCost
          : usd(data.limits.maxCostUsd),
    },
    handles: (data.handles ?? []) as AgentSpec['handles'],
    specificity: data.specificity ?? 0,
    ...(data.requires === undefined ? {} : { requires: data.requires }),
  }

  return ok(spec)
}

function buildPermissions(data: RawSpec): PermissionSet {
  const declared = data.permissions
  if (declared === undefined) return READ_ONLY_PERMISSIONS

  return {
    tools: {
      allow: data.tools?.allow ?? [...READ_ONLY_PERMISSIONS.tools.allow],
      deny: data.tools?.deny ?? [],
    },
    fs: {
      read: declared.fs?.read ?? ['**'],
      write: declared.fs?.write ?? [],
      deny: declared.fs?.deny ?? [...READ_ONLY_PERMISSIONS.fs.deny],
    },
    network:
      declared.network === undefined || declared.network === false
        ? false
        : { allow: declared.network },
    exec: declared.exec === undefined || declared.exec === false ? false : { allow: declared.exec },
    secrets: { allow: declared.secrets ?? [] },
  }
}

export interface LoadedSpecs {
  readonly specs: readonly AgentSpec[]
  readonly failures: readonly { file: string; error: string }[]
}

/** Carrega todos os `.yaml` de um diretório. Falha em um não impede os demais. */
export async function loadAgentSpecs(dir: string, logger: Logger): Promise<LoadedSpecs> {
  let files: string[]
  try {
    files = await readdir(dir)
  } catch {
    return { specs: [], failures: [] }
  }

  const specs: AgentSpec[] = []
  const failures: { file: string; error: string }[] = []

  for (const file of files.sort()) {
    if (!/\.ya?ml$/.test(file)) continue
    const path = join(dir, file)
    try {
      const parsed = parseAgentSpec(await readFile(path, 'utf8'), path)
      if (parsed.ok) specs.push(parsed.value)
      else failures.push({ file, error: parsed.error.message })
    } catch (error: unknown) {
      failures.push({ file, error: error instanceof Error ? error.message : String(error) })
    }
  }

  if (failures.length > 0) {
    logger.warn('Specs de agente ignoradas por erro', { failures })
  }
  return { specs, failures }
}
