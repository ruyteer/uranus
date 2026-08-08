import type { DetectRule, PluginManifest, PluginPermissions, Result } from '@uranus/core'
import { ValidationError, err, ok } from '@uranus/core'

/**
 * Validação de manifesto de plugin.
 *
 * O manifesto é um **contrato de intenção**: o plugin declara o que registra e
 * de que permissões precisa, e o usuário vê isso antes de instalar. Um campo
 * desconhecido é erro, não algo ignorado — plugin que declara o que não existe
 * provavelmente foi escrito contra outra versão do framework.
 */

const ID_RE = /^[a-z][a-z0-9-]{1,40}$/
const SEMVER_RANGE_RE = /^[\^~>=<]*\d+\.\d+\.\d+/

const KNOWN_PROVIDES = [
  'agents',
  'tools',
  'checks',
  'contextSources',
  'rules',
  'prompts',
  'schedulerPolicies',
] as const

const DEFAULT_PERMISSIONS: PluginPermissions = {
  fs: 'none',
  net: false,
  exec: false,
  secrets: [],
}

export function validateManifest(raw: unknown, source: string): Result<PluginManifest> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return err(new ValidationError(`Manifesto de plugin deve ser um objeto: ${source}`))
  }
  const data = raw as Record<string, unknown>
  const problems: string[] = []

  const id = typeof data['id'] === 'string' ? data['id'] : ''
  if (!ID_RE.test(id)) {
    problems.push(`"id" inválido ("${id}"): use letras minúsculas, números e hífen.`)
  }
  if (typeof data['version'] !== 'string') problems.push('"version" é obrigatório.')

  const uranus = typeof data['uranus'] === 'string' ? data['uranus'] : ''
  if (!SEMVER_RANGE_RE.test(uranus)) {
    problems.push(`"uranus" precisa declarar o range de versão do framework (ex.: "^0.1.0").`)
  }

  const provides = (data['provides'] ?? {}) as Record<string, unknown>
  if (typeof provides !== 'object' || Array.isArray(provides)) {
    problems.push('"provides" deve ser um objeto.')
  } else {
    for (const key of Object.keys(provides)) {
      if (!(KNOWN_PROVIDES as readonly string[]).includes(key)) {
        problems.push(`"provides.${key}" desconhecido. Válidos: ${KNOWN_PROVIDES.join(', ')}.`)
      }
    }
  }

  const permissions = validatePermissions(data['permissions'], problems)
  const detect = validateDetect(data['detect'], problems)

  if (problems.length > 0) {
    return err(
      new ValidationError(`Manifesto inválido (${source}):\n  • ${problems.join('\n  • ')}`, {
        context: { source, problems },
      }),
    )
  }

  return ok({
    id,
    name: typeof data['name'] === 'string' ? data['name'] : id,
    version: data['version'] as string,
    uranus,
    description: typeof data['description'] === 'string' ? data['description'] : '',
    provides: provides,
    permissions,
    ...(detect.length === 0 ? {} : { detect }),
  })
}

function validatePermissions(raw: unknown, problems: string[]): PluginPermissions {
  if (raw === undefined) return DEFAULT_PERMISSIONS
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    problems.push('"permissions" deve ser um objeto.')
    return DEFAULT_PERMISSIONS
  }
  const data = raw as Record<string, unknown>

  const fs = data['fs'] ?? 'none'
  if (fs !== 'none' && fs !== 'read' && fs !== 'write') {
    problems.push('"permissions.fs" deve ser "none", "read" ou "write".')
  }
  if (data['net'] !== undefined && typeof data['net'] !== 'boolean') {
    problems.push('"permissions.net" deve ser booleano.')
  }
  if (data['exec'] !== undefined && typeof data['exec'] !== 'boolean') {
    problems.push('"permissions.exec" deve ser booleano.')
  }

  return {
    fs: fs === 'read' || fs === 'write' ? fs : 'none',
    net: data['net'] === true,
    exec: data['exec'] === true,
    secrets: Array.isArray(data['secrets']) ? (data['secrets'] as string[]).map(String) : [],
  }
}

function validateDetect(raw: unknown, problems: string[]): readonly DetectRule[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    problems.push('"detect" deve ser uma lista de regras.')
    return []
  }

  const rules: DetectRule[] = []
  for (const [index, entry] of raw.entries()) {
    if (entry === null || typeof entry !== 'object') {
      problems.push(`detect[${String(index)}] deve ser um objeto.`)
      continue
    }
    const rule = entry as Record<string, unknown>
    switch (rule['kind']) {
      case 'file':
        if (typeof rule['path'] === 'string') rules.push({ kind: 'file', path: rule['path'] })
        else problems.push(`detect[${String(index)}]: regra "file" exige "path".`)
        break
      case 'glob':
        if (typeof rule['pattern'] === 'string') {
          rules.push({ kind: 'glob', pattern: rule['pattern'] })
        } else problems.push(`detect[${String(index)}]: regra "glob" exige "pattern".`)
        break
      case 'dependency':
        if (typeof rule['manifest'] === 'string' && typeof rule['name'] === 'string') {
          rules.push({ kind: 'dependency', manifest: rule['manifest'], name: rule['name'] })
        } else
          problems.push(`detect[${String(index)}]: regra "dependency" exige "manifest" e "name".`)
        break
      case 'command':
        if (typeof rule['run'] === 'string') {
          rules.push({
            kind: 'command',
            run: rule['run'],
            expectExit: typeof rule['expectExit'] === 'number' ? rule['expectExit'] : 0,
          })
        } else problems.push(`detect[${String(index)}]: regra "command" exige "run".`)
        break
      default:
        problems.push(
          `detect[${String(index)}]: kind "${String(rule['kind'])}" desconhecido (file, glob, dependency, command).`,
        )
    }
  }
  return rules
}

/** Descreve as permissões em texto, para o usuário aprovar na instalação. */
export function describePermissions(permissions: PluginPermissions): readonly string[] {
  const lines: string[] = []
  if (permissions.fs === 'read') lines.push('ler arquivos do projeto')
  if (permissions.fs === 'write') lines.push('LER E ESCREVER arquivos do projeto')
  if (permissions.net) lines.push('ACESSAR A REDE')
  if (permissions.exec) lines.push('EXECUTAR COMANDOS')
  for (const secret of permissions.secrets) lines.push(`ler o segredo "${secret}"`)
  return lines.length === 0 ? ['nenhuma permissão especial'] : lines
}
