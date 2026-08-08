import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { DetectRule, ProjectRef, ShellRunner } from '@uranus/core'
import { createMatcher, toPosix, tryParseJson } from '@uranus/core'

/**
 * Ativação automática de plugins.
 *
 * A promessa é concreta: anexar um projeto Next.js liga o plugin do Next.js
 * sem que o usuário precise saber que ele existe. As regras são avaliadas com
 * OU — basta uma casar — porque um mesmo ecossistema tem várias assinaturas
 * (o Laravel tem `artisan` E `laravel/framework` no composer).
 *
 * Regras `command` só rodam se o plugin declarar permissão de execução: uma
 * regra de detecção não pode ser a porta dos fundos para executar algo.
 */

export interface DetectContext {
  readonly project: ProjectRef
  readonly shell: ShellRunner
  readonly allowExec: boolean
  readonly signal: AbortSignal
}

export interface DetectOutcome {
  readonly matched: boolean
  /** Regra que casou, para explicar a ativação ao usuário. */
  readonly reason?: string
}

export async function evaluateDetect(
  rules: readonly DetectRule[],
  context: DetectContext,
): Promise<DetectOutcome> {
  // Sem regras, o plugin só ativa se listado explicitamente na config.
  if (rules.length === 0) return { matched: false }

  for (const rule of rules) {
    if (context.signal.aborted) break
    const reason = await evaluateRule(rule, context)
    if (reason !== undefined) return { matched: true, reason }
  }
  return { matched: false }
}

async function evaluateRule(rule: DetectRule, context: DetectContext): Promise<string | undefined> {
  switch (rule.kind) {
    case 'file': {
      const exists = await fileExists(join(context.project.rootDir, rule.path))
      return exists ? `arquivo "${rule.path}" existe` : undefined
    }

    case 'glob': {
      const found = await findByGlob(context.project.rootDir, rule.pattern)
      return found === undefined ? undefined : `"${found}" casa com "${rule.pattern}"`
    }

    case 'dependency': {
      const deps = await readDependencies(context.project.rootDir, rule.manifest)
      return deps.has(rule.name) ? `dependência "${rule.name}" em ${rule.manifest}` : undefined
    }

    case 'command': {
      if (!context.allowExec) return undefined
      const result = await context.shell.run(
        {
          command: rule.run,
          cwd: context.project.rootDir,
          timeoutMs: 15_000,
          shell: true,
        },
        context.signal,
      )
      return result.exitCode === rule.expectExit
        ? `comando "${rule.run}" saiu com ${String(rule.expectExit)}`
        : undefined
    }
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** Lê dependências de manifestos conhecidos, sem depender de nenhum parser pesado. */
async function readDependencies(rootDir: string, manifest: string): Promise<ReadonlySet<string>> {
  let raw: string
  try {
    raw = await readFile(join(rootDir, manifest), 'utf8')
  } catch {
    return new Set()
  }

  if (manifest.endsWith('.json')) {
    const parsed = tryParseJson<Record<string, Record<string, string> | undefined>>(raw)
    if (parsed === undefined) return new Set()
    const names = new Set<string>()
    for (const field of ['dependencies', 'devDependencies', 'require', 'require-dev']) {
      for (const name of Object.keys(parsed[field] ?? {})) names.add(name)
    }
    return names
  }

  // TOML/txt: busca textual pelo nome. Suficiente para detecção — não é
  // resolução de dependências, é "este projeto menciona X".
  const names = new Set<string>()
  for (const match of raw.matchAll(/^\s*["']?([A-Za-z0-9_.@/-]+)["']?\s*[=><~^"]/gm)) {
    names.add(match[1]!)
  }
  return names
}

const MAX_GLOB_FILES = 2_000

/** Varredura rasa e limitada — detecção não pode custar segundos. */
async function findByGlob(rootDir: string, pattern: string): Promise<string | undefined> {
  const matcher = createMatcher([pattern])
  let visited = 0

  const walk = async (relDir: string, depth: number): Promise<string | undefined> => {
    if (visited >= MAX_GLOB_FILES || depth > 4) return undefined
    let entries
    try {
      entries = await readdir(join(rootDir, relDir), { withFileTypes: true })
    } catch {
      return undefined
    }
    for (const entry of entries) {
      if (visited >= MAX_GLOB_FILES) return undefined
      const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`
      if (entry.isDirectory()) {
        if (['node_modules', '.git', '.uranus', 'dist', 'vendor'].includes(entry.name)) continue
        const found = await walk(rel, depth + 1)
        if (found !== undefined) return found
      } else {
        visited++
        if (matcher(rel)) return toPosix(rel)
      }
    }
    return undefined
  }

  return walk('', 0)
}
