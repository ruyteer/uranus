import type { PluginManifest } from '@uranus/core'
import {
  commandCheck,
  definePlugin,
  fileContextSource,
  readProjectJson,
  type PluginContext,
} from '../sdk.js'

/**
 * Plugin `node` — o ecossistema JavaScript/TypeScript.
 *
 * Este plugin é o motivo pelo qual o INV-8 se sustenta. Antes dele, a composição
 * carregava um mapa fixo de `runner → comando` (`npm test`, `pnpm test`, ...):
 * o kernel sabia o que é npm. Agora esse conhecimento vive aqui, ativado só
 * quando existe um `package.json`, e um projeto Python nunca o vê.
 *
 * O que ele descobre no projeto real, em vez de assumir:
 *
 *   - o gerenciador de pacotes, pelo lockfile presente;
 *   - o runner de testes, pelas dependências declaradas;
 *   - se há `typecheck`/`lint`/`build`, pelos scripts que existem de fato.
 *
 * Registrar um check de `lint` num projeto sem lint só produziria uma task
 * reprovada por um comando inexistente.
 */

const MANIFEST: PluginManifest = {
  id: 'node',
  name: 'Node.js / TypeScript',
  version: '1.0.0',
  uranus: '^0.1.0',
  description:
    'Runners de teste, typecheck, lint e build para projetos Node.js — descobertos a partir do package.json.',
  provides: {
    checks: ['node:typecheck', 'node:lint', 'node:build'],
    contextSources: ['node-project'],
  },
  permissions: { fs: 'read', net: false, exec: true, secrets: [] },
  detect: [{ kind: 'file', path: 'package.json' }],
}

interface PackageJson {
  readonly scripts?: Readonly<Record<string, string>>
  readonly dependencies?: Readonly<Record<string, string>>
  readonly devDependencies?: Readonly<Record<string, string>>
  readonly packageManager?: string
}

const LOCKFILES: readonly { file: string; manager: PackageManager }[] = [
  { file: 'pnpm-lock.yaml', manager: 'pnpm' },
  { file: 'yarn.lock', manager: 'yarn' },
  { file: 'bun.lockb', manager: 'bun' },
  { file: 'package-lock.json', manager: 'npm' },
]

type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

export default definePlugin(MANIFEST, async (context: PluginContext) => {
  const pkg = (await readProjectJson<PackageJson>(context, 'package.json')) ?? {}
  const scripts = pkg.scripts ?? {}
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }

  const manager = await detectPackageManager(context, pkg)
  const exec = execPrefix(manager)

  // ── Runners de teste ──────────────────────────────────────────────────────

  // Override explícito ganha de tudo: quem tem um comando esquisito de teste
  // não deveria precisar de um plugin novo para dizer isso.
  const override = context.config.get<string>('testCommand')
  if (typeof override === 'string' && override.trim() !== '') {
    context.registerTestRunner(manager, override)
    context.registerTestRunner('default', override)
  } else {
    if (typeof scripts['test'] === 'string') {
      context.registerTestRunner(manager, `${manager} test`)
      context.registerTestRunner('default', `${manager} test`)
    }
    if ('vitest' in deps) context.registerTestRunner('vitest', `${exec} vitest run`)
    if ('jest' in deps) context.registerTestRunner('jest', `${exec} jest --ci`)
    if ('mocha' in deps) context.registerTestRunner('mocha', `${exec} mocha`)
    if ('ava' in deps) context.registerTestRunner('ava', `${exec} ava`)
    // `node --test` não precisa de dependência: vem no runtime.
    context.registerTestRunner('node', 'node --test')
  }

  // ── Checks ────────────────────────────────────────────────────────────────

  // `tsc --noEmit` mesmo sem script: um projeto com tsconfig sempre pode ser
  // checado, e erro de tipo é o retorno mais barato que existe.
  const typecheckCommand =
    typeof scripts['typecheck'] === 'string'
      ? `${manager} run typecheck`
      : 'typescript' in deps
        ? `${exec} tsc --noEmit`
        : undefined

  if (typecheckCommand !== undefined) {
    context.registerCheck(
      commandCheck(context, { id: 'node:typecheck', run: typecheckCommand, timeoutMs: 180_000 }),
    )
  }

  if (typeof scripts['lint'] === 'string') {
    context.registerCheck(
      commandCheck(context, { id: 'node:lint', run: `${manager} run lint`, timeoutMs: 180_000 }),
    )
  }

  if (typeof scripts['build'] === 'string') {
    context.registerCheck(
      commandCheck(context, { id: 'node:build', run: `${manager} run build`, timeoutMs: 600_000 }),
    )
  }

  // ── Contexto ──────────────────────────────────────────────────────────────

  context.registerContextSource(
    fileContextSource({
      id: 'node-project',
      files: ['package.json', 'tsconfig.json'],
      title: (path) => `Manifesto do projeto: ${path}`,
      maxChars: 4_000,
      priority: 60,
    }),
  )

  context.logger.info('Plugin node ativo', {
    gerenciador: manager,
    typecheck: typecheckCommand !== undefined,
    lint: typeof scripts['lint'] === 'string',
    build: typeof scripts['build'] === 'string',
  })
})

async function detectPackageManager(
  context: PluginContext,
  pkg: PackageJson,
): Promise<PackageManager> {
  // `packageManager: "pnpm@9.0.0"` é declaração explícita e vence o lockfile.
  const declared = pkg.packageManager?.split('@')[0]
  if (declared === 'npm' || declared === 'pnpm' || declared === 'yarn' || declared === 'bun') {
    return declared
  }

  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  for (const entry of LOCKFILES) {
    try {
      await fs.stat(path.join(context.project.rootDir, entry.file))
      return entry.manager
    } catch {
      /* próximo lockfile */
    }
  }
  return 'npm'
}

function execPrefix(manager: PackageManager): string {
  switch (manager) {
    case 'pnpm':
      return 'pnpm exec'
    case 'yarn':
      return 'yarn'
    case 'bun':
      return 'bunx'
    case 'npm':
      return 'npx --no-install'
  }
}
