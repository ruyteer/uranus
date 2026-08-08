import type {
  Check,
  CheckImpl,
  CheckResult,
  ContextFragment,
  ContextSource,
  Plugin,
  PluginContext,
  PluginManifest,
  VerifyInput,
} from '@uranus/core'
import { estimateTokens, truncateMiddle } from '@uranus/core'

/**
 * SDK para autores de plugin.
 *
 * O objetivo é que um plugin útil caiba em poucas dezenas de linhas e que os
 * detalhes fáceis de errar — truncar saída, marcar conteúdo do repositório
 * como não-confiável (INV-6), preencher `CheckResult` por inteiro — já venham
 * resolvidos.
 */

export type { Plugin, PluginContext, PluginManifest }

/** Define um plugin com tipagem, sem precisar montar o objeto na mão. */
export function definePlugin(
  manifest: PluginManifest,
  activate: (context: PluginContext) => void | Promise<void>,
  deactivate?: () => void | Promise<void>,
): Plugin {
  return { manifest, activate, ...(deactivate === undefined ? {} : { deactivate }) }
}

export interface CommandCheckSpec {
  /** Id do check, referenciado em `acceptance.checks[].check`. */
  readonly id: string
  /** Comando a executar no workspace. */
  readonly run: string | ((input: VerifyInput) => string)
  readonly timeoutMs?: number
  readonly expectExit?: number
  readonly env?: Readonly<Record<string, string>>
}

/**
 * Cria um `CheckImpl` que roda um comando — o formato mais comum de check de
 * plugin (`build`, `lint`, `typecheck`, `docker build`).
 *
 * O plugin precisa de `permissions.exec` no manifesto; sem isso o `shell`
 * injetado recusa e o check reporta a negação em vez de executar.
 */
export function commandCheck(context: PluginContext, spec: CommandCheckSpec): CheckImpl {
  return {
    id: spec.id,
    kind: 'plugin',
    async run(check: Check, input: VerifyInput, signal: AbortSignal): Promise<CheckResult> {
      const started = Date.now()
      const command = typeof spec.run === 'function' ? spec.run(input) : spec.run

      try {
        const result = await context.shell.run(
          {
            command,
            cwd: input.workspace.rootDir,
            timeoutMs: spec.timeoutMs ?? 300_000,
            shell: true,
            ...(spec.env === undefined ? {} : { env: spec.env }),
          },
          signal,
        )
        return {
          checkId: check.id,
          kind: 'plugin',
          passed: result.exitCode === (spec.expectExit ?? 0) && !result.timedOut,
          advisory: check.advisory === true,
          durationMs: result.durationMs,
          exitCode: result.exitCode,
          stdout: truncateMiddle(result.stdout, 8_000),
          stderr: truncateMiddle(result.stderr, 8_000),
          ...(result.timedOut ? { detail: { timedOut: true } } : {}),
        }
      } catch (error: unknown) {
        // Permissão negada e falha de spawn viram check reprovado com motivo,
        // nunca exceção subindo para o kernel.
        return {
          checkId: check.id,
          kind: 'plugin',
          passed: false,
          advisory: check.advisory === true,
          durationMs: Date.now() - started,
          detail: { reason: error instanceof Error ? error.message : String(error) },
        }
      }
    },
  }
}

export interface FileContextSourceSpec {
  readonly id: string
  /** Arquivos a incluir, relativos à raiz do projeto. */
  readonly files: readonly string[]
  readonly title?: (path: string) => string
  readonly maxChars?: number
  readonly priority?: number
}

/**
 * Context source que injeta arquivos do projeto no prompt.
 *
 * Marca tudo como `untrusted` (INV-6) sem o autor precisar lembrar: é conteúdo
 * do repositório, e é exatamente onde uma prompt injection viveria.
 */
export function fileContextSource(spec: FileContextSourceSpec): ContextSource {
  return {
    id: spec.id,
    cost: 'cheap',
    kinds: ['doc'],
    async collect(input, _signal): Promise<readonly ContextFragment[]> {
      const fs = await import('node:fs/promises')
      const path = await import('node:path')
      const fragments: ContextFragment[] = []

      for (const file of spec.files) {
        try {
          const content = await fs.readFile(path.join(input.project.rootDir, file), 'utf8')
          const body = truncateMiddle(content, spec.maxChars ?? 8_000)
          fragments.push({
            id: `${spec.id}:${file}`,
            sourceId: spec.id,
            kind: 'doc',
            title: spec.title?.(file) ?? `Arquivo: ${file}`,
            body,
            tokens: estimateTokens(body),
            priority: spec.priority ?? 45,
            pinned: false,
            untrusted: true,
            refs: [],
          })
        } catch {
          /* arquivo ausente: o plugin declara o que espera, não o que existe */
        }
      }
      return fragments
    },
    freshness(_input, _signal): Promise<string> {
      return Promise.resolve(spec.id)
    },
  }
}

/** Lê um JSON do projeto; `undefined` se ausente ou inválido. */
export async function readProjectJson<T>(
  context: PluginContext,
  relativePath: string,
): Promise<T | undefined> {
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  try {
    return JSON.parse(
      await fs.readFile(path.join(context.project.rootDir, relativePath), 'utf8'),
    ) as T
  } catch {
    return undefined
  }
}

/** Verifica se uma dependência está declarada no `package.json` do projeto. */
export async function hasNodeDependency(context: PluginContext, name: string): Promise<boolean> {
  const pkg = await readProjectJson<{
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }>(context, 'package.json')
  if (pkg === undefined) return false
  return name in { ...pkg.dependencies, ...pkg.devDependencies }
}
