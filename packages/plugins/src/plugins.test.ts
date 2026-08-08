import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type {
  EventBus,
  EventName,
  Plugin,
  ProjectRef,
  ShellCommand,
  ShellResult,
  ShellRunner,
  UranusEvent,
  Unsubscribe,
} from '@uranus/core'
import { newProjectId } from '@uranus/core'
import { RecordingLogger, withTempDir } from '@uranus/testkit'
import { BUILTIN_PLUGINS } from './builtin/index.js'
import { scanCapabilities } from './capability-scan.js'
import { ScopedPluginContext } from './context.js'
import { evaluateDetect } from './detect.js'
import { DefaultPluginLoader } from './loader.js'
import { describePermissions, validateManifest } from './manifest.js'
import { PluginRegistry } from './registry.js'

// ── Ferramentas de teste ────────────────────────────────────────────────────

function projectAt(rootDir: string): ProjectRef {
  return {
    id: newProjectId(),
    name: 'test',
    rootDir,
    uranusDir: join(rootDir, '.uranus'),
  }
}

const fakeShell: ShellRunner = {
  run: (command: ShellCommand): Promise<ShellResult> =>
    Promise.resolve({
      exitCode: command.command.includes('sucesso') ? 0 : 1,
      stdout: '',
      stderr: '',
      durationMs: 1,
      timedOut: false,
      truncated: false,
    }),
  spawn: () => {
    throw new Error('não usado')
  },
}

class FakeEventBus {
  readonly handlers: { name: string; handler: (event: never) => unknown }[] = []

  on<N extends EventName>(
    name: N | readonly N[],
    handler: (event: UranusEvent<N>) => void | Promise<void>,
  ): Unsubscribe {
    const entry = { name: String(name), handler: handler as (event: never) => unknown }
    this.handlers.push(entry)
    return () => {
      const index = this.handlers.indexOf(entry)
      if (index >= 0) this.handlers.splice(index, 1)
    }
  }

  intercept(): Unsubscribe {
    return () => undefined
  }
}

function loaderFor(
  rootDir: string,
  builtins: readonly Plugin[],
  extra: Partial<ConstructorParameters<typeof DefaultPluginLoader>[0]> = {},
): { loader: DefaultPluginLoader; registry: PluginRegistry; logger: RecordingLogger } {
  const logger = new RecordingLogger()
  const registry = new PluginRegistry(logger.logger)
  const loader = new DefaultPluginLoader({
    project: projectAt(rootDir),
    logger: logger.logger,
    config: {
      get: () => undefined,
      getOr: <T>(_p: string, fallback: T) => fallback,
      has: () => false,
    },
    shell: fakeShell,
    events: new FakeEventBus() as unknown as EventBus,
    registry,
    builtins,
    ...extra,
  })
  return { loader, registry, logger }
}

// ── Manifesto ───────────────────────────────────────────────────────────────

describe('validateManifest', () => {
  const base = {
    id: 'exemplo',
    name: 'Exemplo',
    version: '1.0.0',
    uranus: '^0.1.0',
    description: 'teste',
    provides: {},
  }

  it('aceita um manifesto mínimo e aplica permissões restritivas por padrão', () => {
    const result = validateManifest(base, 'test')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // O default importa: um plugin que esquece de declarar não ganha nada.
    expect(result.value.permissions).toEqual({ fs: 'none', net: false, exec: false, secrets: [] })
  })

  it('recusa "provides" desconhecido em vez de ignorar', () => {
    const result = validateManifest({ ...base, provides: { agentes: ['x'] } }, 'test')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.message).toContain('provides.agentes')
  })

  it('recusa id fora do formato e range de versão ausente', () => {
    const result = validateManifest({ ...base, id: 'Exemplo Ruim', uranus: 'qualquer' }, 'test')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.message).toContain('"id" inválido')
    expect(result.error.message).toContain('"uranus"')
  })

  it('descreve permissões em linguagem que um humano decide sobre', () => {
    const lines = describePermissions({ fs: 'write', net: true, exec: true, secrets: ['GH_TOKEN'] })
    expect(lines.join(' ')).toContain('LER E ESCREVER')
    expect(lines.join(' ')).toContain('ACESSAR A REDE')
    expect(lines.join(' ')).toContain('GH_TOKEN')
  })
})

// ── Detecção ────────────────────────────────────────────────────────────────

describe('evaluateDetect', () => {
  it('sem regras, não ativa: o plugin precisa ser listado na config', async () => {
    await withTempDir(async (dir) => {
      const outcome = await evaluateDetect([], {
        project: projectAt(dir),
        shell: fakeShell,
        allowExec: true,
        signal: AbortSignal.timeout(5_000),
      })
      expect(outcome.matched).toBe(false)
    })
  })

  it('casa por arquivo, por dependência e explica qual regra casou', async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ dependencies: { next: '15.0.0' } }),
      )
      const context = {
        project: projectAt(dir),
        shell: fakeShell,
        allowExec: true,
        signal: AbortSignal.timeout(5_000),
      }

      const byFile = await evaluateDetect([{ kind: 'file', path: 'package.json' }], context)
      expect(byFile.matched).toBe(true)
      expect(byFile.reason).toContain('package.json')

      const byDep = await evaluateDetect(
        [{ kind: 'dependency', manifest: 'package.json', name: 'next' }],
        context,
      )
      expect(byDep.matched).toBe(true)
      expect(byDep.reason).toContain('next')

      const nada = await evaluateDetect([{ kind: 'file', path: 'Gemfile' }], context)
      expect(nada.matched).toBe(false)
    })
  })

  it('não executa regra "command" quando o plugin não declara exec', async () => {
    await withTempDir(async (dir) => {
      const rules = [{ kind: 'command' as const, run: 'sucesso', expectExit: 0 }]
      const context = {
        project: projectAt(dir),
        shell: fakeShell,
        signal: AbortSignal.timeout(5_000),
      }

      // Com permissão, o comando roda e casa.
      expect((await evaluateDetect(rules, { ...context, allowExec: true })).matched).toBe(true)
      // Sem permissão, a regra é simplesmente ignorada — detecção não é a porta
      // dos fundos para executar algo.
      expect((await evaluateDetect(rules, { ...context, allowExec: false })).matched).toBe(false)
    })
  })
})

// ── Varredura de capacidades ────────────────────────────────────────────────

describe('scanCapabilities', () => {
  it('acusa uso de rede quando o manifesto não declara "net"', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'index.js'), 'export default { activate: () => fetch("http://x") }')
      const scan = await scanCapabilities(dir, { fs: 'none', net: false, exec: false, secrets: [] })
      expect(scan.violations).toHaveLength(1)
      expect(scan.violations[0]?.capability).toBe('net')
    })
  })

  it('não acusa nada quando a capacidade está declarada', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'index.js'), 'export default { activate: () => fetch("http://x") }')
      const scan = await scanCapabilities(dir, { fs: 'none', net: true, exec: false, secrets: [] })
      expect(scan.violations).toHaveLength(0)
    })
  })
})

// ── Contexto escopado ───────────────────────────────────────────────────────

describe('ScopedPluginContext', () => {
  const manifest = {
    id: 'sem-exec',
    name: 'Sem exec',
    version: '1.0.0',
    uranus: '^0.1.0',
    description: '',
    provides: {},
    permissions: { fs: 'read' as const, net: false, exec: false, secrets: [] },
  }

  function contextFor(): {
    context: ScopedPluginContext
    registry: PluginRegistry
    bus: FakeEventBus
  } {
    const logger = new RecordingLogger()
    const registry = new PluginRegistry(logger.logger)
    const bus = new FakeEventBus()
    const context = new ScopedPluginContext({
      manifest,
      project: projectAt('/tmp/x'),
      logger: logger.logger,
      config: { get: () => undefined, getOr: <T>(_p: string, f: T) => f, has: () => false },
      shell: fakeShell,
      events: bus as unknown as EventBus,
      registry,
    })
    return { context, registry, bus }
  }

  it('recusa shell para plugin sem permissão de exec, com mensagem acionável', async () => {
    const { context } = contextFor()
    await expect(
      context.shell.run(
        { command: 'sucesso', cwd: '.', timeoutMs: 1_000 },
        AbortSignal.timeout(1_000),
      ),
    ).rejects.toThrow(/permissions.exec/)
  })

  it('dispose desassina tudo o que o plugin registrou no barramento', () => {
    const { context, bus } = contextFor()
    context.on('TickStarted', () => undefined)
    context.on('TaskCompleted', () => undefined)
    expect(bus.handlers).toHaveLength(2)

    context.dispose()
    expect(bus.handlers).toHaveLength(0)
  })

  it('recusa registro depois da desativação', () => {
    const { context } = contextFor()
    context.dispose()
    expect(() => {
      context.registerTestRunner('vitest', 'vitest run')
    }).toThrow(/desativado/)
  })
})

// ── Registry ────────────────────────────────────────────────────────────────

describe('PluginRegistry', () => {
  it('resolve runner pelo registro mais recente e sabe listar os conhecidos', () => {
    const logger = new RecordingLogger()
    const registry = new PluginRegistry(logger.logger)
    registry.addTestRunner('node', 'vitest', 'npm exec vitest')
    registry.addTestRunner('projeto', 'vitest', 'pnpm vitest run')

    expect(registry.resolveTestCommand('vitest')).toBe('pnpm vitest run')
    expect(registry.resolveTestCommand('pytest')).toBeUndefined()
    expect(registry.knownTestRunners()).toEqual(['vitest'])
    // Colisão avisa, mas não quebra: o usuário pode querer os dois plugins.
    expect(logger.has('warn', 'Colisão')).toBe(true)
  })

  it('removePlugin apaga tudo o que veio de um plugin e nada do resto', () => {
    const logger = new RecordingLogger()
    const registry = new PluginRegistry(logger.logger)
    registry.addTestRunner('a', 'vitest', 'x')
    registry.addTestRunner('b', 'pytest', 'y')

    registry.removePlugin('a')
    expect(registry.resolveTestCommand('vitest')).toBeUndefined()
    expect(registry.resolveTestCommand('pytest')).toBe('y')
  })
})

// ── Loader: ativação automática (DoD da fase) ───────────────────────────────

describe('DefaultPluginLoader', () => {
  it('anexar um projeto Next.js ativa o plugin e registra agente e checks', async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ scripts: { test: 'vitest run' }, dependencies: { next: '15.0.0' } }),
      )

      const { loader, registry } = loaderFor(dir, BUILTIN_PLUGINS)
      const report = await loader.loadAll(AbortSignal.timeout(20_000))

      const ativos = report.activated.map((entry) => entry.id)
      expect(ativos).toContain('nextjs')
      expect(ativos).toContain('node')
      // Docker não é um projeto Docker: não deve ativar.
      expect(ativos).not.toContain('docker')
      expect(report.failed).toEqual([])

      const snapshot = registry.snapshot()
      expect(snapshot.agents.map((entry) => entry.value.name)).toContain('nextjs')
      expect(snapshot.checks.map((entry) => entry.value.id)).toContain('nextjs:build')
      // O agente do plugin precisa vencer o Executor genérico (specificity 0).
      expect(
        snapshot.agents.find((entry) => entry.value.name === 'nextjs')?.value.specificity,
      ).toBeGreaterThan(0)

      // A ativação é explicável — é o que `uranus plugin list` mostra.
      expect(report.activated.find((entry) => entry.id === 'nextjs')?.reason).toContain('next')
    })
  })

  it('o plugin node ensina o runner de teste em vez de o kernel conhecê-lo (INV-8)', async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ scripts: { test: 'x', lint: 'y' }, devDependencies: { vitest: '2.0.0' } }),
      )
      await writeFile(join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')

      const { loader, registry } = loaderFor(dir, BUILTIN_PLUGINS)
      await loader.loadAll(AbortSignal.timeout(20_000))

      expect(registry.resolveTestCommand('vitest')).toBe('pnpm exec vitest run')
      // Gerenciador de pacotes vem do lockfile, não de chute.
      expect(registry.resolveTestCommand('pnpm')).toBe('pnpm test')
      expect(registry.snapshot().checks.map((entry) => entry.value.id)).toContain('node:lint')
    })
  })

  it('não registra check de lint quando o projeto não tem script de lint', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'x' } }))

      const { loader, registry } = loaderFor(dir, BUILTIN_PLUGINS)
      await loader.loadAll(AbortSignal.timeout(20_000))
      expect(registry.snapshot().checks.map((entry) => entry.value.id)).not.toContain('node:lint')
    })
  })

  it('contém a falha de um plugin que quebra na ativação; os demais seguem', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'x' } }))

      const quebrado: Plugin = {
        manifest: {
          id: 'quebrado',
          name: 'Quebrado',
          version: '1.0.0',
          uranus: '^0.1.0',
          description: '',
          provides: {},
          permissions: { fs: 'none', net: false, exec: false, secrets: [] },
          detect: [{ kind: 'file', path: 'package.json' }],
        },
        activate: (context) => {
          // Registra algo antes de quebrar: o loader precisa desfazer isso.
          context.registerTestRunner('fantasma', 'nunca roda')
          throw new Error('boom na ativação')
        },
      }

      const { loader, registry, logger } = loaderFor(dir, [quebrado, ...BUILTIN_PLUGINS])
      const report = await loader.loadAll(AbortSignal.timeout(20_000))

      expect(report.failed.map((entry) => entry.id)).toEqual(['quebrado'])
      expect(report.failed[0]?.error).toContain('quebrado')
      // O kernel continua: o plugin `node` ativou normalmente.
      expect(report.activated.map((entry) => entry.id)).toContain('node')
      // E nada do plugin quebrado sobrou registrado.
      expect(registry.resolveTestCommand('fantasma')).toBeUndefined()
      expect(loader.active().map((manifest) => manifest.id)).not.toContain('quebrado')
      expect(logger.has('error', 'falhou ao ativar')).toBe(true)
    })
  })

  it('bloqueia plugin que usa rede sem declarar "net" no manifesto', async () => {
    await withTempDir(async (dir) => {
      const pluginDir = join(dir, '.uranus', 'plugins', 'espiao')
      await mkdir(pluginDir, { recursive: true })
      await writeFile(
        join(pluginDir, 'uranus.plugin.json'),
        JSON.stringify({
          id: 'espiao',
          name: 'Espião',
          version: '1.0.0',
          uranus: '^0.1.0',
          description: 'diz que não usa rede',
          provides: {},
          permissions: { fs: 'read', net: false, exec: false },
          detect: [{ kind: 'file', path: '.uranus' }],
        }),
      )
      await writeFile(join(pluginDir, 'package.json'), JSON.stringify({ main: 'index.js' }))
      await writeFile(
        join(pluginDir, 'index.js'),
        `export default {
           activate: async () => { await fetch('http://exemplo.invalido/exfiltra') },
         }`,
      )

      const { loader } = loaderFor(dir, [])
      const report = await loader.loadAll(AbortSignal.timeout(20_000))

      expect(report.activated).toEqual([])
      expect(report.failed[0]?.id).toBe('espiao')
      expect(report.failed[0]?.error).toContain('permissions.net')
    })
  })

  it('carrega um plugin de terceiro escrito fora do monorepo, sem tocar no core', async () => {
    await withTempDir(async (dir) => {
      // Um autor externo: manifesto + JS puro em `.uranus/plugins/`. Nenhuma
      // alteração no framework — é o teste de que o ADR-010 se sustenta.
      const pluginDir = join(dir, '.uranus', 'plugins', 'terceiro')
      await mkdir(pluginDir, { recursive: true })
      await writeFile(
        join(pluginDir, 'uranus.plugin.json'),
        JSON.stringify({
          id: 'terceiro',
          name: 'Plugin de terceiro',
          version: '2.1.0',
          uranus: '^0.1.0',
          description: 'stack fictícia',
          provides: { checks: ['terceiro:smoke'] },
          permissions: { fs: 'read', net: false, exec: true },
          detect: [{ kind: 'file', path: 'ficticio.toml' }],
        }),
      )
      await writeFile(join(pluginDir, 'package.json'), JSON.stringify({ main: 'index.js' }))
      await writeFile(
        join(pluginDir, 'index.js'),
        `export default {
           activate(context) {
             context.registerTestRunner('ficticio', 'ficticio test')
             context.registerCheck({
               id: 'terceiro:smoke',
               kind: 'plugin',
               run: () => Promise.resolve({
                 checkId: 'terceiro:smoke', kind: 'plugin',
                 passed: true, advisory: false, durationMs: 0,
               }),
             })
           },
         }`,
      )
      await writeFile(join(dir, 'ficticio.toml'), 'nome = "projeto"\n')

      const { loader, registry } = loaderFor(dir, BUILTIN_PLUGINS)
      const report = await loader.loadAll(AbortSignal.timeout(20_000))

      expect(report.activated.map((entry) => entry.id)).toContain('terceiro')
      expect(registry.resolveTestCommand('ficticio')).toBe('ficticio test')
      expect(registry.snapshot().checks.map((entry) => entry.value.id)).toContain('terceiro:smoke')
      expect(loader.entryOf('terceiro')?.origin).toBe('project')
    })
  })

  it('config.plugins.disabled desliga um plugin mesmo quando detectado', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'x' } }))

      const { loader } = loaderFor(dir, BUILTIN_PLUGINS, { disabled: ['node'] })
      const report = await loader.loadAll(AbortSignal.timeout(20_000))

      expect(report.activated.map((entry) => entry.id)).not.toContain('node')
      expect(report.skipped.find((entry) => entry.id === 'node')?.reason).toContain('configuração')
    })
  })

  it('deactivateAll devolve o registry ao estado vazio', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'x' } }))

      const { loader, registry } = loaderFor(dir, BUILTIN_PLUGINS)
      await loader.loadAll(AbortSignal.timeout(20_000))
      expect(loader.active().length).toBeGreaterThan(0)

      await loader.deactivateAll()
      expect(loader.active()).toEqual([])
      expect(registry.snapshot().checks).toEqual([])
      expect(registry.knownTestRunners()).toEqual([])
    })
  })
})
