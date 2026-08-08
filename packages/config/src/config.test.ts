import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { withTempDir, createTempDir, type TempDir } from '@uranus/testkit'
import { deepMerge, envLayer, mergeLayers, traceOrigins } from './layers.js'
import { loadConfig, parseConfig } from './loader.js'
import { createConfigReader, scopedReader } from './reader.js'
import { chainSecretProviders, envSecretProvider, fileSecretProvider } from './secrets.js'

describe('deepMerge', () => {
  it('a camada mais específica vence campo a campo', () => {
    const merged = deepMerge(
      { kernel: { concurrency: 1, tickIntervalMs: 1000 } },
      { kernel: { concurrency: 4 } },
    )
    expect(merged).toEqual({ kernel: { concurrency: 4, tickIntervalMs: 1000 } })
  })

  it('arrays substituem em vez de concatenar', () => {
    // Se concatenassem, um projeto não conseguiria RESTRINGIR o que o global
    // permite — permissão só cresceria (§15.1).
    const merged = deepMerge(
      { permissions: { execAllow: ['npm', 'git'] } },
      { permissions: { execAllow: ['git'] } },
    )
    expect(merged.permissions.execAllow).toEqual(['git'])
  })

  it('undefined não sobrescreve valor definido', () => {
    expect(deepMerge({ a: 1 }, { a: undefined })).toEqual({ a: 1 })
  })

  it('mergeLayers aplica na ordem defaults → flags', () => {
    const merged = mergeLayers([
      { name: 'flags', source: 'cli', data: { x: 3 } },
      { name: 'defaults', source: 'code', data: { x: 1, y: 1 } },
      { name: 'project', source: 'file', data: { x: 2 } },
    ])
    expect(merged).toEqual({ x: 3, y: 1 })
  })

  it('traceOrigins aponta a camada vencedora de cada campo', () => {
    const origins = traceOrigins([
      { name: 'defaults', source: 'code', data: { a: { b: 1 }, c: 1 } },
      { name: 'project', source: '.uranus/config.yaml', data: { a: { b: 2 } } },
    ])
    expect(origins.get('a.b')).toEqual({ layer: 'project', source: '.uranus/config.yaml' })
    expect(origins.get('c')).toEqual({ layer: 'defaults', source: 'code' })
  })
})

describe('envLayer', () => {
  it('converte URANUS_* em estrutura aninhada com coerção de tipo', () => {
    const layer = envLayer({
      URANUS_KERNEL__CONCURRENCY: '4',
      URANUS_KERNEL__TICK_INTERVAL_MS: '500',
      URANUS_TELEMETRY__ENABLED: 'false',
      URANUS_PLUGINS: '["node","github"]',
      OUTRA_VAR: 'ignorada',
    })
    expect(layer.data).toEqual({
      kernel: { concurrency: 4, tickIntervalMs: 500 },
      telemetry: { enabled: false },
      plugins: ['node', 'github'],
    })
  })

  it('mantém string quando o JSON é inválido', () => {
    const layer = envLayer({ URANUS_PROJECT__NAME: '[quebrado' })
    expect(layer.data).toEqual({ project: { name: '[quebrado' } })
  })

  it('coerção cobre null e float', () => {
    const layer = envLayer({ URANUS_A: 'null', URANUS_B: '1.5', URANUS_C: '-2' })
    expect(layer.data).toEqual({ a: null, b: 1.5, c: -2 })
  })
})

describe('parseConfig', () => {
  it('aplica defaults em cima do mínimo', () => {
    const result = parseConfig({ project: { name: 'demo' } })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.kernel.concurrency).toBe(1)
      expect(result.value.budget.onExhausted).toBe('pause')
      expect(result.value.integration.strategy).toBe('pull-request')
      expect(result.value.project.vcs.defaultBranch).toBe('main')
    }
  })

  it('aceita a forma curta de plugins e normaliza para a forma longa', () => {
    // `plugins: [node, nextjs]` é a forma documentada; o resto do código só
    // precisa lidar com um formato.
    const curta = parseConfig({ project: { name: 'demo' }, plugins: ['node', 'nextjs'] })
    expect(curta.ok).toBe(true)
    if (curta.ok) {
      expect(curta.value.plugins.enabled).toEqual(['node', 'nextjs'])
      expect(curta.value.plugins.disabled).toEqual([])
    }

    const longa = parseConfig({
      project: { name: 'demo' },
      plugins: { disabled: ['docker'], settings: { node: { testCommand: 'make test' } } },
    })
    expect(longa.ok).toBe(true)
    if (longa.ok) {
      expect(longa.value.plugins.disabled).toEqual(['docker'])
      expect(longa.value.plugins.settings['node']).toEqual({ testCommand: 'make test' })
    }
  })

  it('rejeita config sem projeto', () => {
    const result = parseConfig({})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('project')
  })

  it('rejeita seções de contexto que somam mais de 1.0', () => {
    const result = parseConfig({
      project: { name: 'demo' },
      context: { sections: { code: 0.8, memory: 0.5 } },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('seção')
  })

  it('rejeita valores fora do intervalo com o caminho do campo', () => {
    const result = parseConfig({
      project: { name: 'demo' },
      kernel: { concurrency: 0 },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('kernel.concurrency')
  })
})

describe('loadConfig', () => {
  let temp: TempDir

  beforeEach(async () => {
    temp = await createTempDir()
  })

  afterEach(async () => {
    await temp.cleanup()
  })

  it('exige config de projeto e sugere uranus init', async () => {
    const result = await loadConfig({
      projectDir: temp.path,
      globalConfigPath: join(temp.path, 'inexistente.yaml'),
      env: {},
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('uranus init')
  })

  it('carrega e valida YAML de projeto', async () => {
    await mkdir(join(temp.path, '.uranus'), { recursive: true })
    await writeFile(
      join(temp.path, '.uranus', 'config.yaml'),
      'project:\n  name: demo\nkernel:\n  concurrency: 2\n',
    )
    const result = await loadConfig({
      projectDir: temp.path,
      globalConfigPath: join(temp.path, 'sem-global.yaml'),
      env: {},
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.config.project.name).toBe('demo')
      expect(result.value.config.kernel.concurrency).toBe(2)
    }
  })

  it('env sobrepõe o arquivo do projeto', async () => {
    await mkdir(join(temp.path, '.uranus'), { recursive: true })
    await writeFile(
      join(temp.path, '.uranus', 'config.yaml'),
      'project:\n  name: demo\nkernel:\n  concurrency: 2\n',
    )
    const result = await loadConfig({
      projectDir: temp.path,
      globalConfigPath: join(temp.path, 'sem-global.yaml'),
      env: { URANUS_KERNEL__CONCURRENCY: '8' },
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.config.kernel.concurrency).toBe(8)
  })

  it('erro de validação aponta o arquivo de origem do campo', async () => {
    await mkdir(join(temp.path, '.uranus'), { recursive: true })
    const configPath = join(temp.path, '.uranus', 'config.yaml')
    await writeFile(configPath, 'project:\n  name: demo\nkernel:\n  concurrency: 99\n')
    const result = await loadConfig({
      projectDir: temp.path,
      globalConfigPath: join(temp.path, 'sem-global.yaml'),
      env: {},
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toContain('kernel.concurrency')
      expect(result.error.message).toContain(configPath)
    }
  })

  it('rejeita YAML cujo topo não é objeto', async () => {
    await mkdir(join(temp.path, '.uranus'), { recursive: true })
    await writeFile(join(temp.path, '.uranus', 'config.yaml'), '- apenas\n- lista\n')
    const result = await loadConfig({
      projectDir: temp.path,
      globalConfigPath: join(temp.path, 'sem-global.yaml'),
      env: {},
    })
    expect(result.ok).toBe(false)
  })

  it('flags de CLI vencem todas as camadas', async () => {
    await mkdir(join(temp.path, '.uranus'), { recursive: true })
    await writeFile(join(temp.path, '.uranus', 'config.yaml'), 'project:\n  name: demo\n')
    const result = await loadConfig({
      projectDir: temp.path,
      globalConfigPath: join(temp.path, 'sem-global.yaml'),
      env: { URANUS_KERNEL__CONCURRENCY: '4' },
      flags: { kernel: { concurrency: 16 } },
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.config.kernel.concurrency).toBe(16)
  })
})

describe('ConfigReader', () => {
  const reader = createConfigReader({ a: { b: { c: 42 } }, list: [1, 2] })

  it('lê por caminho pontilhado', () => {
    expect(reader.get('a.b.c')).toBe(42)
    expect(reader.get('a.b')).toEqual({ c: 42 })
    expect(reader.get('inexistente.x')).toBeUndefined()
    expect(reader.has('a.b.c')).toBe(true)
    expect(reader.has('a.z')).toBe(false)
    expect(reader.getOr('a.z', 'padrão')).toBe('padrão')
    expect(reader.getOr('a.b.c', 0)).toBe(42)
  })

  it('scopedReader confina um plugin ao próprio prefixo', () => {
    const scoped = scopedReader(
      createConfigReader({ plugins: { nextjs: { port: 3000 } } }),
      'plugins.nextjs',
    )
    expect(scoped.get('port')).toBe(3000)
    expect(scoped.has('port')).toBe(true)
    expect(scoped.get('')).toEqual({ port: 3000 })
  })
})

describe('secrets (R12)', () => {
  it('resolve de env e registra para redação', async () => {
    const provider = envSecretProvider({ MY_KEY: 'valor-super-secreto-1' })
    expect(await provider.resolve('env:MY_KEY')).toBe('valor-super-secreto-1')
    expect(await provider.resolve('env:INEXISTENTE')).toBeUndefined()
    expect(await provider.resolve('outro:MY_KEY')).toBeUndefined()
    expect(await provider.has('env:MY_KEY')).toBe(true)
  })

  it('resolve de arquivo', async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, 'secret.txt')
      await writeFile(path, 'conteudo-secreto\n')
      const provider = fileSecretProvider()
      expect(await provider.resolve(`file:${path}`)).toBe('conteudo-secreto')
      expect(await provider.has(`file:${path}`)).toBe(true)
      expect(await provider.resolve(`file:${join(dir, 'nao-existe')}`)).toBeUndefined()
      expect(await provider.has(`file:${join(dir, 'nao-existe')}`)).toBe(false)
    })
  })

  it('encadeia provedores com o primeiro resolvendo', async () => {
    const chain = chainSecretProviders(
      envSecretProvider({ A: 'valor-de-a-12345' }),
      envSecretProvider({ B: 'valor-de-b-12345' }),
    )
    expect(await chain.resolve('env:A')).toBe('valor-de-a-12345')
    expect(await chain.resolve('env:B')).toBe('valor-de-b-12345')
    expect(await chain.resolve('env:C')).toBeUndefined()
    expect(await chain.has('env:B')).toBe(true)
    expect(await chain.has('env:C')).toBe(false)
  })
})
