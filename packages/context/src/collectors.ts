import type { ProjectDigest, ShellRunner } from '@uranus/core'
import { tryParseJson } from '@uranus/core'
import { filesMatching, findFile, readRepoFile, type RepoScan } from './scan.js'

/**
 * Coletores do `ProjectDigest`. Cada função é pura sobre a varredura + leituras
 * pontuais — sem heurística de modelo, sem rede. O que não é detectável fica
 * `undefined`, nunca inventado.
 */

// ── Linguagens ──────────────────────────────────────────────────────────────

const EXT_TO_LANGUAGE: Readonly<Record<string, string>> = {
  ts: 'TypeScript',
  tsx: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  py: 'Python',
  php: 'PHP',
  go: 'Go',
  rs: 'Rust',
  rb: 'Ruby',
  java: 'Java',
  kt: 'Kotlin',
  cs: 'C#',
  c: 'C',
  cc: 'C++',
  cpp: 'C++',
  swift: 'Swift',
  scala: 'Scala',
  vue: 'Vue',
  svelte: 'Svelte',
  sql: 'SQL',
  sh: 'Shell',
  ps1: 'PowerShell',
}

export function collectLanguages(scan: RepoScan): ProjectDigest['languages'] {
  const loc = new Map<string, number>()
  for (const file of scan.files) {
    const language = EXT_TO_LANGUAGE[file.ext]
    if (language === undefined || file.lines === undefined) continue
    loc.set(language, (loc.get(language) ?? 0) + file.lines)
  }
  const total = [...loc.values()].reduce((a, b) => a + b, 0)
  return [...loc.entries()]
    .map(([name, count]) => ({
      name,
      loc: count,
      share: total === 0 ? 0 : Math.round((count / total) * 1000) / 1000,
    }))
    .sort((a, b) => b.loc - a.loc)
    .slice(0, 8)
}

// ── Manifests e dependências ────────────────────────────────────────────────

export interface ManifestInfo {
  readonly kind: 'node' | 'php' | 'python' | 'go' | 'rust' | 'ruby'
  readonly path: string
  readonly dependencies: readonly string[]
  readonly devDependencies: readonly string[]
  readonly scripts: Readonly<Record<string, string>>
}

export async function collectManifests(
  rootDir: string,
  scan: RepoScan,
): Promise<readonly ManifestInfo[]> {
  const manifests: ManifestInfo[] = []

  const pkg = findFile(scan, 'package.json')
  if (pkg !== undefined && !pkg.path.includes('/')) {
    const raw = await readRepoFile(rootDir, pkg.path)
    const parsed =
      raw === undefined
        ? undefined
        : tryParseJson<{
            dependencies?: Record<string, string>
            devDependencies?: Record<string, string>
            scripts?: Record<string, string>
          }>(raw)
    if (parsed !== undefined) {
      manifests.push({
        kind: 'node',
        path: pkg.path,
        dependencies: Object.keys(parsed.dependencies ?? {}),
        devDependencies: Object.keys(parsed.devDependencies ?? {}),
        scripts: parsed.scripts ?? {},
      })
    }
  }

  const composer = findFile(scan, 'composer.json')
  if (composer !== undefined && !composer.path.includes('/')) {
    const raw = await readRepoFile(rootDir, composer.path)
    const parsed =
      raw === undefined
        ? undefined
        : tryParseJson<{
            require?: Record<string, string>
            'require-dev'?: Record<string, string>
            scripts?: Record<string, unknown>
          }>(raw)
    if (parsed !== undefined) {
      manifests.push({
        kind: 'php',
        path: composer.path,
        dependencies: Object.keys(parsed.require ?? {}),
        devDependencies: Object.keys(parsed['require-dev'] ?? {}),
        scripts: {},
      })
    }
  }

  const pyproject = findFile(scan, 'pyproject.toml')
  if (pyproject !== undefined && !pyproject.path.includes('/')) {
    const raw = (await readRepoFile(rootDir, pyproject.path)) ?? ''
    manifests.push({
      kind: 'python',
      path: pyproject.path,
      dependencies: tomlDeps(raw),
      devDependencies: [],
      scripts: {},
    })
  }

  const goMod = findFile(scan, 'go.mod')
  if (goMod !== undefined && !goMod.path.includes('/')) {
    const raw = (await readRepoFile(rootDir, goMod.path)) ?? ''
    const deps = [...raw.matchAll(/^\t([^\s]+) v/gm)].map((m) => m[1]!)
    manifests.push({
      kind: 'go',
      path: goMod.path,
      dependencies: deps,
      devDependencies: [],
      scripts: {},
    })
  }

  const cargo = findFile(scan, 'Cargo.toml')
  if (cargo !== undefined && !cargo.path.includes('/')) {
    const raw = (await readRepoFile(rootDir, cargo.path)) ?? ''
    manifests.push({
      kind: 'rust',
      path: cargo.path,
      dependencies: tomlDeps(raw),
      devDependencies: [],
      scripts: {},
    })
  }

  return manifests
}

function tomlDeps(raw: string): readonly string[] {
  // Parse superficial deliberado: nomes de dependência, não versões exatas.
  const section = /\[(?:project\.)?dependencies\]([^[]*)/.exec(raw)?.[1] ?? ''
  const inline = /dependencies\s*=\s*\[([^\]]*)\]/.exec(raw)?.[1] ?? ''
  const names = new Set<string>()
  for (const match of section.matchAll(/^([A-Za-z0-9_-]+)\s*=/gm)) names.add(match[1]!)
  for (const match of inline.matchAll(/"([A-Za-z0-9_.-]+)/g)) {
    names.add(match[1]!.split(/[<>=~!\s[]/)[0]!)
  }
  return [...names]
}

// ── Frameworks ──────────────────────────────────────────────────────────────

interface FrameworkSignature {
  readonly name: string
  readonly dependency?: string
  readonly file?: string
}

const FRAMEWORK_SIGNATURES: readonly FrameworkSignature[] = [
  { name: 'Next.js', dependency: 'next' },
  { name: 'NestJS', dependency: '@nestjs/core' },
  { name: 'React', dependency: 'react' },
  { name: 'Vue', dependency: 'vue' },
  { name: 'Angular', dependency: '@angular/core' },
  { name: 'Express', dependency: 'express' },
  { name: 'Fastify', dependency: 'fastify' },
  { name: 'Laravel', file: 'artisan' },
  { name: 'Laravel', dependency: 'laravel/framework' },
  { name: 'Symfony', dependency: 'symfony/framework-bundle' },
  { name: 'Django', file: 'manage.py' },
  { name: 'FastAPI', dependency: 'fastapi' },
  { name: 'Flask', dependency: 'flask' },
  { name: 'Rails', file: 'config.ru' },
  { name: 'Vitest', dependency: 'vitest' },
  { name: 'Prisma', dependency: 'prisma' },
]

export function collectFrameworks(
  scan: RepoScan,
  manifests: readonly ManifestInfo[],
): readonly string[] {
  const allDeps = new Set(
    manifests.flatMap((manifest) => [...manifest.dependencies, ...manifest.devDependencies]),
  )
  const found = new Set<string>()
  for (const signature of FRAMEWORK_SIGNATURES) {
    if (signature.dependency !== undefined && allDeps.has(signature.dependency)) {
      found.add(signature.name)
    }
    if (signature.file !== undefined && findFile(scan, signature.file) !== undefined) {
      found.add(signature.name)
    }
  }
  return [...found]
}

// ── Testes ──────────────────────────────────────────────────────────────────

export function collectTests(
  scan: RepoScan,
  manifests: readonly ManifestInfo[],
): ProjectDigest['tests'] {
  const testFiles = filesMatching(
    scan,
    (path) =>
      /\.(test|spec)\.[a-z]+$/.test(path) ||
      path.includes('/test/') ||
      path.includes('/tests/') ||
      path.startsWith('test/') ||
      path.startsWith('tests/') ||
      /^test_.*\.py$/.test(path.split('/').pop() ?? ''),
  )

  const node = manifests.find((manifest) => manifest.kind === 'node')
  let runner: string | undefined
  let command: string | undefined

  if (node !== undefined) {
    const devDeps = new Set(node.devDependencies)
    if (devDeps.has('vitest')) runner = 'vitest'
    else if (devDeps.has('jest')) runner = 'jest'
    else if (devDeps.has('mocha')) runner = 'mocha'
    const script = node.scripts['test']
    if (script !== undefined && !script.includes('no test specified')) {
      command = 'npm test'
      runner ??= script.includes('node --test') || script.includes('node:test') ? 'node' : runner
    }
  }
  const php = manifests.find((manifest) => manifest.kind === 'php')
  if (php?.devDependencies.includes('phpunit/phpunit') === true) {
    runner = 'phpunit'
    command ??= 'vendor/bin/phpunit'
  }
  const python = manifests.find((manifest) => manifest.kind === 'python')
  if (python !== undefined) {
    const hasPytest =
      python.dependencies.includes('pytest') ||
      filesMatching(scan, (p) => p === 'pytest.ini' || p === 'conftest.py').length > 0 ||
      testFiles.some((f) => f.path.endsWith('.py'))
    if (hasPytest) {
      runner = 'pytest'
      command ??= 'pytest'
    }
  }
  if (manifests.some((manifest) => manifest.kind === 'go')) {
    runner ??= 'go'
    command ??= 'go test ./...'
  }
  if (manifests.some((manifest) => manifest.kind === 'rust')) {
    runner ??= 'cargo'
    command ??= 'cargo test'
  }

  return {
    ...(runner === undefined ? {} : { runner }),
    ...(command === undefined ? {} : { command }),
    count: testFiles.length,
  }
}

// ── CI ──────────────────────────────────────────────────────────────────────

export function collectCi(scan: RepoScan): ProjectDigest['ci'] {
  const workflows = filesMatching(
    scan,
    (path) => path.startsWith('.github/workflows/') && /\.(yml|yaml)$/.test(path),
  )
  if (workflows.length > 0) {
    return { provider: 'github-actions', requiredChecks: workflows.map((f) => f.path) }
  }
  if (findFile(scan, '.gitlab-ci.yml') !== undefined) {
    return { provider: 'gitlab-ci', requiredChecks: ['.gitlab-ci.yml'] }
  }
  if (findFile(scan, 'Jenkinsfile') !== undefined) {
    return { provider: 'jenkins', requiredChecks: ['Jenkinsfile'] }
  }
  return { requiredChecks: [] }
}

// ── Banco de dados ──────────────────────────────────────────────────────────

export function collectDatabase(
  scan: RepoScan,
  manifests: readonly ManifestInfo[],
): ProjectDigest['database'] {
  const allDeps = new Set(
    manifests.flatMap((manifest) => [...manifest.dependencies, ...manifest.devDependencies]),
  )

  let orm: string | undefined
  if (allDeps.has('prisma') || allDeps.has('@prisma/client')) orm = 'prisma'
  else if (allDeps.has('typeorm')) orm = 'typeorm'
  else if (allDeps.has('drizzle-orm')) orm = 'drizzle'
  else if (allDeps.has('sequelize')) orm = 'sequelize'
  else if (allDeps.has('mongoose')) orm = 'mongoose'
  else if (
    manifests.some((m) => m.kind === 'php' && m.dependencies.includes('laravel/framework'))
  ) {
    orm = 'eloquent'
  } else if (allDeps.has('sqlalchemy')) orm = 'sqlalchemy'

  let engine: string | undefined
  if (allDeps.has('pg') || allDeps.has('postgres') || allDeps.has('psycopg2')) engine = 'postgres'
  else if (allDeps.has('mysql2') || allDeps.has('mysql')) engine = 'mysql'
  else if (allDeps.has('mongodb') || allDeps.has('mongoose')) engine = 'mongodb'
  else if (allDeps.has('better-sqlite3') || allDeps.has('sqlite3')) engine = 'sqlite'

  const migrationDirs = filesMatching(
    scan,
    (path) =>
      path.includes('migrations/') || path.includes('migrate/') || path.startsWith('prisma/'),
  )
  const migrations =
    migrationDirs.length > 0 ? migrationDirs[0]!.path.split('/').slice(0, -1).join('/') : undefined

  return {
    ...(engine === undefined ? {} : { engine }),
    ...(orm === undefined ? {} : { orm }),
    ...(migrations === undefined ? {} : { migrations }),
  }
}

// ── Docs e convenções ───────────────────────────────────────────────────────

export function collectDocs(scan: RepoScan): readonly string[] {
  return filesMatching(
    scan,
    (path) =>
      /^readme\.(md|rst|txt)$/i.test(path) ||
      path.startsWith('docs/') ||
      /^(contributing|architecture|adr.*)\.md$/i.test(path.split('/').pop() ?? ''),
  )
    .map((file) => file.path)
    .slice(0, 30)
}

export function collectConventions(scan: RepoScan): readonly string[] {
  const known = [
    'eslint.config.js',
    'eslint.config.mjs',
    '.eslintrc',
    '.eslintrc.json',
    '.eslintrc.js',
    '.prettierrc',
    '.prettierrc.json',
    'prettier.config.js',
    '.editorconfig',
    'tsconfig.json',
    'phpcs.xml',
    'pint.json',
    'ruff.toml',
    '.rubocop.yml',
    'rustfmt.toml',
    '.golangci.yml',
    'biome.json',
  ]
  return known.filter((name) => findFile(scan, name) !== undefined)
}

// ── VCS ─────────────────────────────────────────────────────────────────────

const NEVER = new AbortController().signal

export async function collectVcs(
  rootDir: string,
  shell: ShellRunner,
): Promise<ProjectDigest['vcs']> {
  const run = (args: string[]): Promise<{ exitCode: number; stdout: string }> =>
    shell.run(
      { command: 'git', args, cwd: rootDir, timeoutMs: 15_000, env: { GIT_TERMINAL_PROMPT: '0' } },
      NEVER,
    )

  let defaultBranch = 'main'
  const head = await run(['rev-parse', '--abbrev-ref', 'HEAD'])
  if (head.exitCode === 0 && head.stdout.trim() !== '') defaultBranch = head.stdout.trim()
  const remote = await run(['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'])
  if (remote.exitCode === 0) defaultBranch = remote.stdout.trim().replace(/^origin\//, '')

  const log = await run(['log', '--format=%s', '-n', '40'])
  let commitStyle: string | undefined
  if (log.exitCode === 0) {
    const subjects = log.stdout.split('\n').filter((line) => line.trim() !== '')
    const conventional = subjects.filter((subject) =>
      /^(feat|fix|chore|docs|refactor|test|perf|ci|build|style)(\(.+\))?!?:/.test(subject),
    )
    if (subjects.length >= 5 && conventional.length / subjects.length >= 0.6) {
      commitStyle = 'conventional-commits'
    }
  }

  return { defaultBranch, ...(commitStyle === undefined ? {} : { commitStyle }) }
}

// ── Arquitetura (heurística estrutural) ─────────────────────────────────────

export function collectArchitecture(scan: RepoScan): ProjectDigest['architecture'] {
  const topDirs = new Set<string>()
  for (const file of scan.files) {
    const slash = file.path.indexOf('/')
    if (slash > 0) topDirs.add(file.path.slice(0, slash))
  }

  const layers: string[] = []
  const layerNames = [
    'src',
    'app',
    'lib',
    'packages',
    'apps',
    'domain',
    'application',
    'infrastructure',
    'controllers',
    'services',
    'models',
    'routes',
    'components',
    'pages',
    'api',
    'core',
    'modules',
  ]
  for (const name of layerNames) {
    if (topDirs.has(name)) layers.push(name)
    else if (scan.files.some((f) => f.path.startsWith(`src/${name}/`))) layers.push(`src/${name}`)
  }

  let style = 'unknown'
  if (topDirs.has('packages') || topDirs.has('apps')) style = 'monorepo'
  else if (
    layers.some((l) => l.includes('domain')) &&
    layers.some((l) => l.includes('infrastructure'))
  ) {
    style = 'layered/hexagonal'
  } else if (layers.some((l) => l.includes('controllers') || l.includes('routes'))) style = 'mvc'
  else if (topDirs.has('src') || topDirs.has('app')) style = 'src-based'

  const entrypoints = scan.files
    .filter((file) => {
      const base = file.path.split('/').pop() ?? ''
      return (
        /^(main|index|app|server|cli)\.(ts|js|mjs|py|go|rs|php)$/.test(base) &&
        file.path.split('/').length <= 3
      )
    })
    .map((file) => file.path)
    .slice(0, 8)

  return { style, layers: layers.slice(0, 10), entrypoints }
}
