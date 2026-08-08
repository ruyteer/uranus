import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { silentLogger, unwrap } from '@uranus/core'
import { withTempDir } from '@uranus/testkit'
import { loadAgentSpecs, parseAgentSpec } from './spec-loader.js'
import { validateSpec } from './registry.js'

const CATALOG_DIR = join(fileURLToPath(import.meta.url), '..', '..', 'catalog')

const SPEC_MINIMA = `
name: exemplo
mission: Fazer algo útil e verificável no projeto.
responsibilities: [Fazer a coisa]
prompts:
  system: executor/system@1
  instruction: executor/instruction@1
handles: [chore]
successCriteria:
  checks:
    - kind: diff
      id: mudou
      requireNonEmpty: true
      timeoutMs: 30000
`

describe('parseAgentSpec', () => {
  it('carrega uma spec mínima com defaults seguros', () => {
    const spec = unwrap(parseAgentSpec(SPEC_MINIMA, 'exemplo.yaml'))
    expect(spec.name).toBe('exemplo')
    expect(spec.handles).toEqual(['chore'])

    // Defaults RESTRITIVOS: uma spec que não declara permissões não escreve.
    expect(spec.permissions.fs.write).toEqual([])
    expect(spec.permissions.network).toBe(false)
    expect(spec.permissions.exec).toBe(false)
    expect(spec.permissions.fs.deny).toContain('.env')
  })

  it('rejeita spec sem nome ou sem prompts', () => {
    expect(parseAgentSpec('mission: x', 'a.yaml').ok).toBe(false)
    expect(parseAgentSpec('name: x\nmission: y', 'a.yaml').ok).toBe(false)
  })

  it('rejeita YAML inválido sem lançar', () => {
    const result = parseAgentSpec('{{{ isso não é yaml', 'a.yaml')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('inválido')
  })

  it('permissões declaradas sobrescrevem os defaults', () => {
    const spec = unwrap(
      parseAgentSpec(
        `${SPEC_MINIMA}
permissions:
  fs:
    read: ['**']
    write: ['src/**']
  exec: ['npm test']
  network: false
`,
        'a.yaml',
      ),
    )
    expect(spec.permissions.fs.write).toEqual(['src/**'])
    expect(spec.permissions.exec).toEqual({ allow: ['npm test'] })
    expect(spec.permissions.network).toBe(false)
  })

  it('converte maxCostUsd para Money', () => {
    const spec = unwrap(parseAgentSpec(`${SPEC_MINIMA}\nlimits:\n  maxCostUsd: 2.5\n`, 'a.yaml'))
    expect(spec.limits.maxCost.micros).toBe(2_500_000)
  })
})

describe('catálogo builtin', () => {
  it('todas as specs do catálogo carregam e são válidas', async () => {
    const loaded = await loadAgentSpecs(CATALOG_DIR, silentLogger)

    expect(loaded.failures).toEqual([])
    expect(loaded.specs.length).toBeGreaterThanOrEqual(6)

    for (const spec of loaded.specs) {
      const problems = validateSpec(spec)
      expect(problems, `spec "${spec.name}" inválida`).toEqual([])
    }
  })

  it('os agentes de revisão são estritamente somente-leitura', async () => {
    const loaded = await loadAgentSpecs(CATALOG_DIR, silentLogger)
    for (const name of ['reviewer', 'security', 'qa']) {
      const spec = loaded.specs.find((candidate) => candidate.name === name)
      expect(spec, `spec "${name}" não encontrada`).toBeDefined()
      // Um revisor que pode editar código deixa de ser revisor.
      expect(spec!.permissions.fs.write).toEqual([])
      expect(spec!.permissions.exec).toBe(false)
      expect(spec!.tools.deny).toContain('Edit')
      // E precisa devolver findings estruturados.
      expect(spec!.requires?.structuredOutput).toBe(true)
    }
  })

  it('o Security não tem acesso à rede (vetor de exfiltração)', async () => {
    const loaded = await loadAgentSpecs(CATALOG_DIR, silentLogger)
    const security = loaded.specs.find((spec) => spec.name === 'security')
    expect(security!.permissions.network).toBe(false)
    expect(security!.tools.deny).toContain('WebFetch')
  })

  it('o BugHunter é agente de escalada, não a primeira escolha', async () => {
    const loaded = await loadAgentSpecs(CATALOG_DIR, silentLogger)
    const hunter = loaded.specs.find((spec) => spec.name === 'bug-hunter')
    // Specificity negativa: perde o roteamento normal para o Executor. Com ela
    // positiva, todo bug custaria tier `deep` — caro para o caso comum.
    expect(hunter!.specificity).toBeLessThan(0)
    expect(hunter!.handles).toContain('bugfix')
    expect(hunter!.model?.tier).toBe('deep')
  })

  it('o Testing é o preferido em tasks de teste', async () => {
    const loaded = await loadAgentSpecs(CATALOG_DIR, silentLogger)
    const testing = loaded.specs.find((spec) => spec.name === 'testing')
    expect(testing!.handles).toEqual(['test'])
    expect(testing!.specificity).toBeGreaterThan(0)
    expect(testing!.permissions.fs.write).toContain('**')
  })
})

describe('loadAgentSpecs', () => {
  it('diretório inexistente devolve vazio sem lançar', async () => {
    const loaded = await loadAgentSpecs('/caminho/que/nao/existe', silentLogger)
    expect(loaded.specs).toEqual([])
  })

  it('uma spec quebrada não impede as demais', async () => {
    await withTempDir(async (dir) => {
      const { writeFile } = await import('node:fs/promises')
      await writeFile(join(dir, 'boa.yaml'), SPEC_MINIMA)
      await writeFile(join(dir, 'ruim.yaml'), '{{{ quebrado')
      await writeFile(join(dir, 'ignorado.txt'), 'não é yaml')

      const loaded = await loadAgentSpecs(dir, silentLogger)
      expect(loaded.specs).toHaveLength(1)
      expect(loaded.specs[0]!.name).toBe('exemplo')
      expect(loaded.failures).toHaveLength(1)
      expect(loaded.failures[0]!.file).toBe('ruim.yaml')
    })
  })

  it('editar o YAML muda o comportamento sem recompilar (ADR-008)', async () => {
    await withTempDir(async (dir) => {
      const { writeFile } = await import('node:fs/promises')
      const path = join(dir, 'agente.yaml')

      await writeFile(path, SPEC_MINIMA)
      const antes = (await loadAgentSpecs(dir, silentLogger)).specs[0]!
      expect(antes.handles).toEqual(['chore'])
      expect(antes.permissions.fs.write).toEqual([])

      // Só o arquivo muda — nenhum código é tocado.
      await writeFile(
        path,
        SPEC_MINIMA.replace('handles: [chore]', 'handles: [feature, refactor]') +
          "\npermissions:\n  fs:\n    write: ['src/**']\n",
      )
      const depois = (await loadAgentSpecs(dir, silentLogger)).specs[0]!
      expect(depois.handles).toEqual(['feature', 'refactor'])
      expect(depois.permissions.fs.write).toEqual(['src/**'])
    })
  })
})
