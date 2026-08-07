import type { ProjectDigest, ProjectRef, ShellRunner } from '@uranus/core'
import { hashText, verificationSignalStrength } from '@uranus/core'
import {
  collectArchitecture,
  collectCi,
  collectConventions,
  collectDatabase,
  collectDocs,
  collectFrameworks,
  collectLanguages,
  collectManifests,
  collectTests,
  collectVcs,
} from './collectors.js'
import { findFile, readRepoFile, scanRepo } from './scan.js'

const NEVER = new AbortController().signal

/**
 * Chave de frescor do digest: HEAD + hash dos manifests/lockfiles/configs.
 * Se nada disso mudou, o digest cacheado continua válido — reescanear um repo
 * a cada tick custaria mais que a task inteira.
 */
export async function freshnessKey(project: ProjectRef, shell: ShellRunner): Promise<string> {
  const parts: string[] = []

  const head = await shell.run(
    {
      command: 'git',
      args: ['rev-parse', 'HEAD'],
      cwd: project.rootDir,
      timeoutMs: 15_000,
      env: { GIT_TERMINAL_PROMPT: '0' },
    },
    NEVER,
  )
  parts.push(head.exitCode === 0 ? head.stdout.trim() : 'no-git')

  for (const name of [
    'package.json',
    'pnpm-lock.yaml',
    'package-lock.json',
    'yarn.lock',
    'composer.json',
    'composer.lock',
    'pyproject.toml',
    'poetry.lock',
    'go.mod',
    'go.sum',
    'Cargo.toml',
    'Cargo.lock',
  ]) {
    const content = await readRepoFile(project.rootDir, name)
    if (content !== undefined) parts.push(`${name}:${hashText(content).slice(0, 16)}`)
  }

  return hashText(parts.join('|'))
}

/**
 * Bootstrap: reconstrói o entendimento do projeto do zero, em uma varredura.
 * Determinístico — mesmo repo, mesmo digest (o DoD da Fase 3 depende disso).
 */
export async function buildProjectDigest(
  project: ProjectRef,
  shell: ShellRunner,
  now: number,
  signal?: AbortSignal,
): Promise<ProjectDigest> {
  const scan = await scanRepo(project.rootDir, signal)
  const manifests = await collectManifests(project.rootDir, scan)

  const languages = collectLanguages(scan)
  const frameworks = collectFrameworks(scan, manifests)
  const architecture = collectArchitecture(scan)
  const tests = collectTests(scan, manifests)
  const ci = collectCi(scan)
  const database = collectDatabase(scan, manifests)
  const docs = collectDocs(scan)
  const conventions = collectConventions(scan)
  const vcs = await collectVcs(project.rootDir, shell)

  const directDeps = manifests.reduce((total, manifest) => total + manifest.dependencies.length, 0)

  const digest: ProjectDigest = {
    languages,
    frameworks,
    architecture,
    dependencies: { direct: directDeps, outdated: 0, vulnerable: 0 },
    tests,
    ci,
    database,
    docs,
    conventions,
    vcs,
    summary: '',
    freshness: await freshnessKey(project, shell),
    generatedAt: now,
  }

  return { ...digest, summary: composeSummary(project.name, digest, scan.truncated) }
}

/**
 * Resumo em linguagem natural, montado deterministicamente a partir dos dados.
 * Sem modelo: o mesmo repositório produz exatamente o mesmo parágrafo.
 */
export function composeSummary(name: string, digest: ProjectDigest, truncated: boolean): string {
  const parts: string[] = []

  const mainLanguages = digest.languages
    .slice(0, 3)
    .map((language) => `${language.name} (${String(Math.round(language.share * 100))}%)`)
  parts.push(
    mainLanguages.length > 0
      ? `Projeto "${name}" escrito em ${mainLanguages.join(', ')}.`
      : `Projeto "${name}" sem código-fonte detectável.`,
  )

  if (digest.frameworks.length > 0) {
    parts.push(`Frameworks: ${digest.frameworks.join(', ')}.`)
  }
  parts.push(
    `Estrutura: ${digest.architecture.style}${
      digest.architecture.layers.length > 0
        ? ` (camadas: ${digest.architecture.layers.slice(0, 5).join(', ')})`
        : ''
    }.`,
  )

  if (digest.tests.runner !== undefined) {
    parts.push(
      `Testes via ${digest.tests.runner}${digest.tests.command === undefined ? '' : ` (\`${digest.tests.command}\`)`}, ${String(digest.tests.count ?? 0)} arquivo(s) de teste.`,
    )
  } else {
    parts.push('SEM runner de testes detectado — sinal de verificação fraco (modo restrito).')
  }

  if (digest.ci.provider !== undefined) parts.push(`CI: ${digest.ci.provider}.`)
  if (digest.database.orm !== undefined || digest.database.engine !== undefined) {
    parts.push(
      `Banco: ${[digest.database.engine, digest.database.orm].filter(Boolean).join(' + ')}${
        digest.database.migrations === undefined
          ? ''
          : ` (migrations em ${digest.database.migrations})`
      }.`,
    )
  }
  parts.push(`${String(digest.dependencies.direct)} dependência(s) direta(s).`)
  if (digest.vcs.commitStyle !== undefined) {
    parts.push(`Commits seguem ${digest.vcs.commitStyle}.`)
  }
  parts.push(`Sinal de verificação: ${String(verificationSignalStrength(digest))}/100.`)
  if (truncated) parts.push('(varredura truncada — repositório muito grande)')

  return parts.join(' ')
}

export function digestNeedsTests(digest: ProjectDigest): boolean {
  return digest.tests.runner === undefined || (digest.tests.count ?? 0) === 0
}

export { findFile }
