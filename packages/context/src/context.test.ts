import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ContextRequest, ContextSource, ProjectRef, Task } from '@uranus/core'
import {
  isRestrictedMode,
  silentLogger,
  systemClock,
  verificationSignalStrength,
} from '@uranus/core'
import { DefaultShellRunner } from '@uranus/executors'
import { createGitRepo, makeTask, withTempDir } from '@uranus/testkit'
import { EXECUTOR_SPEC } from '@uranus/agents'
import { buildProjectDigest, freshnessKey } from './digest.js'
import { DefaultContextManager } from './manager.js'
import { DefaultContextPacker } from './packer.js'

const NEVER = new AbortController().signal

function projectRef(dir: string): ProjectRef {
  return {
    id: 'prj_x' as ProjectRef['id'],
    name: 'fixture',
    rootDir: dir,
    uranusDir: join(dir, '.uranus'),
  }
}

function shell(): DefaultShellRunner {
  return new DefaultShellRunner({ clock: systemClock, logger: silentLogger })
}

function write(dir: string, rel: string, content: string): void {
  const abs = join(dir, rel)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, content)
}

// ── Fixtures de três stacks distintas (DoD F3) ──────────────────────────────

function nodeFixture(dir: string): void {
  createGitRepo({
    dir,
    files: {
      'package.json': JSON.stringify({
        name: 'api-node',
        scripts: { test: 'vitest run', dev: 'next dev' },
        dependencies: {
          next: '^15.0.0',
          react: '^19.0.0',
          '@prisma/client': '^6.0.0',
          pg: '^8.0.0',
        },
        devDependencies: { vitest: '^3.0.0', prisma: '^6.0.0', eslint: '^9.0.0' },
      }),
      'tsconfig.json': '{}',
      'eslint.config.js': 'export default []',
      'src/index.ts': 'export const main = () => 1\n'.repeat(30),
      'src/api/users.ts': 'export const users = []\n'.repeat(20),
      'src/api/users.test.ts': 'import { it } from "vitest"\nit("x", () => {})\n',
      'prisma/schema.prisma': 'datasource db { provider = "postgresql" }',
      'prisma/migrations/001_init/migration.sql': 'CREATE TABLE users();',
      '.github/workflows/ci.yml': 'on: push\njobs: {}',
      'README.md': '# API Node\nDocumentação.',
    },
  })
}

function phpFixture(dir: string): void {
  createGitRepo({
    dir,
    files: {
      'composer.json': JSON.stringify({
        require: { 'laravel/framework': '^11.0', php: '^8.2' },
        'require-dev': { 'phpunit/phpunit': '^11.0' },
      }),
      artisan: '#!/usr/bin/env php',
      'app/Http/Controllers/UserController.php': '<?php\nclass UserController {}\n'.repeat(15),
      'app/Models/User.php': '<?php\nclass User {}\n'.repeat(10),
      'routes/web.php': '<?php\n// rotas\n',
      'database/migrations/2024_create_users.php': '<?php\n// migration\n',
      'tests/Feature/UserTest.php': '<?php\nclass UserTest {}\n',
      'phpunit.xml': '<phpunit/>',
    },
  })
}

function pythonFixture(dir: string): void {
  createGitRepo({
    dir,
    files: {
      'pyproject.toml': `[project]\nname = "api-py"\ndependencies = [\n  "fastapi>=0.110",\n  "sqlalchemy>=2.0",\n  "pytest>=8.0",\n]\n`,
      'app/main.py': 'from fastapi import FastAPI\napp = FastAPI()\n'.repeat(10),
      'app/models.py': 'class User: pass\n'.repeat(10),
      'tests/test_users.py': 'def test_ok():\n    assert True\n',
      'conftest.py': '',
    },
  })
}

describe('ProjectDigest — três stacks reais (DoD F3)', () => {
  it('detecta corretamente um projeto Node/Next/Prisma', async () => {
    await withTempDir(async (dir) => {
      nodeFixture(dir)
      const digest = await buildProjectDigest(projectRef(dir), shell(), Date.now())

      expect(digest.languages[0]!.name).toBe('TypeScript')
      expect(digest.frameworks).toContain('Next.js')
      expect(digest.frameworks).toContain('React')
      expect(digest.frameworks).toContain('Prisma')
      expect(digest.tests.runner).toBe('vitest')
      expect(digest.tests.command).toBe('npm test')
      expect(digest.tests.count).toBeGreaterThanOrEqual(1)
      expect(digest.ci.provider).toBe('github-actions')
      expect(digest.database.orm).toBe('prisma')
      expect(digest.database.engine).toBe('postgres')
      expect(digest.database.migrations).toContain('prisma')
      expect(digest.docs).toContain('README.md')
      expect(digest.conventions).toContain('eslint.config.js')
      expect(digest.vcs.defaultBranch).toBe('main')
      expect(digest.dependencies.direct).toBe(4)
      expect(digest.summary).toContain('TypeScript')
      expect(verificationSignalStrength(digest)).toBeGreaterThanOrEqual(70)
      expect(isRestrictedMode(digest)).toBe(false)
    })
  }, 30_000)

  it('detecta corretamente um projeto PHP/Laravel', async () => {
    await withTempDir(async (dir) => {
      phpFixture(dir)
      const digest = await buildProjectDigest(projectRef(dir), shell(), Date.now())

      expect(digest.languages[0]!.name).toBe('PHP')
      expect(digest.frameworks).toContain('Laravel')
      expect(digest.tests.runner).toBe('phpunit')
      expect(digest.database.orm).toBe('eloquent')
      expect(digest.database.migrations).toContain('database/migrations')
      expect(digest.architecture.layers.length).toBeGreaterThan(0)
    })
  }, 30_000)

  it('detecta corretamente um projeto Python/FastAPI', async () => {
    await withTempDir(async (dir) => {
      pythonFixture(dir)
      const digest = await buildProjectDigest(projectRef(dir), shell(), Date.now())

      expect(digest.languages[0]!.name).toBe('Python')
      expect(digest.frameworks).toContain('FastAPI')
      expect(digest.tests.runner).toBe('pytest')
      expect(digest.tests.command).toBe('pytest')
      expect(digest.dependencies.direct).toBeGreaterThanOrEqual(3)
    })
  }, 30_000)

  it('repo sem testes cai em modo restrito (R4)', async () => {
    await withTempDir(async (dir) => {
      createGitRepo({ dir, files: { 'src/app.js': 'console.log(1)\n' } })
      const digest = await buildProjectDigest(projectRef(dir), shell(), Date.now())
      expect(digest.tests.runner).toBeUndefined()
      expect(isRestrictedMode(digest)).toBe(true)
      expect(digest.summary).toContain('modo restrito')
    })
  }, 30_000)

  it('o digest é determinístico para o mesmo repositório', async () => {
    await withTempDir(async (dir) => {
      nodeFixture(dir)
      const a = await buildProjectDigest(projectRef(dir), shell(), 1_000)
      const b = await buildProjectDigest(projectRef(dir), shell(), 2_000)
      // Tudo menos o timestamp é idêntico.
      expect({ ...a, generatedAt: 0 }).toEqual({ ...b, generatedAt: 0 })
    })
  }, 30_000)
})

describe('FreshnessKey e ContextManager', () => {
  it('a chave muda quando um manifest muda, e não muda à toa', async () => {
    await withTempDir(async (dir) => {
      nodeFixture(dir)
      const before = await freshnessKey(projectRef(dir), shell())
      expect(await freshnessKey(projectRef(dir), shell())).toBe(before)

      write(dir, 'package.json', JSON.stringify({ name: 'renomeado' }))
      expect(await freshnessKey(projectRef(dir), shell())).not.toBe(before)
    })
  }, 30_000)

  it('bootstrap → cache em disco → isStale detecta mudança estrutural', async () => {
    await withTempDir(async (dir) => {
      nodeFixture(dir)
      const project = projectRef(dir)
      const manager = new DefaultContextManager({
        shell: shell(),
        clock: systemClock,
        logger: silentLogger,
      })

      await manager.bootstrap(project, NEVER)
      expect(await manager.isStale(project, NEVER)).toBe(false)

      // Um manager NOVO (processo novo) lê o cache do disco.
      const fresh = new DefaultContextManager({
        shell: shell(),
        clock: systemClock,
        logger: silentLogger,
      })
      const cached = await fresh.digest(project)
      expect(cached?.frameworks).toContain('Next.js')

      // Mudança em código comum NÃO invalida (HEAD não mudou, lockfiles idem)…
      write(dir, 'src/outro.ts', 'export {}')
      expect(await fresh.isStale(project, NEVER)).toBe(false)
      // …mas mudança de manifest invalida.
      write(dir, 'package.json', JSON.stringify({ name: 'outro' }))
      expect(await fresh.isStale(project, NEVER)).toBe(true)
    })
  }, 30_000)
})

describe('DefaultContextPacker (ADR-007)', () => {
  function fragmentSource(
    id: string,
    fragments: readonly Partial<ContextFragmentInput>[],
  ): ContextSource {
    return {
      id,
      cost: 'cheap',
      kinds: ['code'],
      collect: () =>
        Promise.resolve(
          fragments.map((fragment, index) => ({
            id: fragment.id ?? `${id}:${String(index)}`,
            sourceId: id,
            kind: fragment.kind ?? 'code',
            title: fragment.title ?? 'f',
            body: fragment.body ?? 'corpo',
            tokens: fragment.tokens ?? 100,
            priority: fragment.priority ?? 50,
            pinned: fragment.pinned ?? false,
            untrusted: fragment.untrusted ?? false,
            refs: [],
          })),
        ),
      freshness: () => Promise.resolve('static'),
    }
  }
  interface ContextFragmentInput {
    id: string
    kind: 'digest' | 'code' | 'memory' | 'task' | 'diff' | 'doc' | 'error' | 'external'
    title: string
    body: string
    tokens: number
    priority: number
    pinned: boolean
    untrusted: boolean
  }

  function request(dir: string, task: Task, budget = 1_000): ContextRequest {
    return {
      budgetTokens: budget,
      sectionBudgets: {},
      agent: EXECUTOR_SPEC,
      task,
      project: projectRef(dir),
      mustInclude: [],
      hints: [],
    }
  }

  it('mesmo estado ⇒ mesmo digest (determinismo)', async () => {
    await withTempDir(async (dir) => {
      const packer = new DefaultContextPacker({ clock: systemClock, logger: silentLogger })
      packer.addSource(
        fragmentSource('s', [
          { id: 'a', body: 'A' },
          { id: 'b', body: 'B' },
        ]),
      )
      const task = makeTask()
      const first = await packer.pack(request(dir, task), NEVER)
      const second = await packer.pack(request(dir, task), NEVER)
      expect(first.digest).toBe(second.digest)
      expect(first.digest).toMatch(/^[0-9a-f]{64}$/)
    })
  })

  it('nunca estoura o orçamento e registra tudo que caiu', async () => {
    await withTempDir(async (dir) => {
      const packer = new DefaultContextPacker({ clock: systemClock, logger: silentLogger })
      packer.addSource(
        fragmentSource(
          's',
          Array.from({ length: 30 }, (_, index) => ({
            id: `f${String(index)}`,
            tokens: 100,
            priority: 100 - index,
          })),
        ),
      )
      const pack = await packer.pack(request(dir, makeTask(), 1_000), NEVER)

      expect(pack.tokens).toBeLessThanOrEqual(1_000)
      // Contabilidade fecha: mantidos + descartados = coletados.
      expect(pack.fragments.length + pack.dropped.length).toBe(30)
      for (const dropped of pack.dropped) {
        expect(['budget', 'section-budget', 'duplicate']).toContain(dropped.reason)
      }
      // Prioridade respeitada: os mantidos têm prioridade >= à dos descartados.
      const minKept = Math.min(...pack.fragments.map((f) => f.priority))
      const maxDroppedNonDup = Math.max(
        ...pack.dropped.map((d) => Number(d.id.slice(1))).map((index) => 100 - index),
      )
      expect(minKept).toBeGreaterThanOrEqual(maxDroppedNonDup)
    })
  })

  it('orçamento por seção limita cada kind separadamente', async () => {
    await withTempDir(async (dir) => {
      const packer = new DefaultContextPacker({ clock: systemClock, logger: silentLogger })
      packer.addSource(
        fragmentSource('s', [
          { id: 'code1', kind: 'code', tokens: 300 },
          { id: 'code2', kind: 'code', tokens: 300 },
          { id: 'mem1', kind: 'memory', tokens: 150 },
        ]),
      )
      // code: 40% de 1000 = 400 → só um fragmento de 300 cabe.
      const pack = await packer.pack(request(dir, makeTask(), 1_000), NEVER)
      const codeKept = pack.fragments.filter((f) => f.kind === 'code')
      expect(codeKept).toHaveLength(1)
      expect(pack.dropped.some((d) => d.reason === 'section-budget')).toBe(true)
      // A seção de memória não foi afetada pelo estouro da de código.
      expect(pack.fragments.some((f) => f.kind === 'memory')).toBe(true)
    })
  })

  it('pinned entra mesmo com a seção cheia; duplicatas resolvem por prioridade', async () => {
    await withTempDir(async (dir) => {
      const packer = new DefaultContextPacker({ clock: systemClock, logger: silentLogger })
      packer.addSource(
        fragmentSource('s', [
          { id: 'grande', kind: 'code', tokens: 380 },
          { id: 'vip', kind: 'code', tokens: 100, pinned: true, priority: 1 },
          { id: 'dup', kind: 'code', tokens: 50, priority: 10, body: 'fraco' },
          { id: 'dup', kind: 'code', tokens: 50, priority: 90, body: 'forte' },
        ]),
      )
      const pack = await packer.pack(request(dir, makeTask(), 1_000), NEVER)
      expect(pack.fragments.some((f) => f.id === 'vip')).toBe(true)
      const dup = pack.fragments.find((f) => f.id === 'dup')
      expect(dup?.body).toBe('forte')
      expect(pack.dropped.filter((d) => d.id === 'dup')).toHaveLength(1)
    })
  })

  it('source quebrada degrada o contexto, não o pack', async () => {
    await withTempDir(async (dir) => {
      const packer = new DefaultContextPacker({ clock: systemClock, logger: silentLogger })
      packer.addSource({
        id: 'quebrada',
        cost: 'cheap',
        kinds: ['code'],
        collect: () => Promise.reject(new Error('boom')),
        freshness: () => Promise.resolve('x'),
      })
      packer.addSource(fragmentSource('ok', [{ id: 'a' }]))
      const pack = await packer.pack(request(dir, makeTask(), 1_000), NEVER)
      expect(pack.fragments).toHaveLength(1)
    })
  })
})
