import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Repositório git de fixture para testes de sandbox/kernel/caos.
 * Sempre com identidade e branch fixadas — nada herdado da máquina do dev.
 */
export interface RepoFixtureOptions {
  readonly dir: string
  readonly files?: Readonly<Record<string, string>>
  readonly defaultBranch?: string
}

export function createGitRepo(options: RepoFixtureOptions): void {
  const { dir } = options
  mkdirSync(dir, { recursive: true })
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8' })

  git('init', '-b', options.defaultBranch ?? 'main')
  git('config', 'user.email', 'test@uranus.local')
  git('config', 'user.name', 'Uranus Test')
  git('config', 'core.autocrlf', 'false')
  git('config', 'commit.gpgsign', 'false')

  const files = options.files ?? { 'README.md': '# fixture\n' }
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content)
  }
  git('add', '--all')
  git('commit', '-m', 'commit inicial da fixture')
}

export function gitIn(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
}
