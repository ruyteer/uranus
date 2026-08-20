import { describe, expect, it } from 'vitest'
import { parseDocument, parse as parseYaml } from 'yaml'
import type { ConfigLayer, UranusConfig } from '@uranus/config'
import { parseConfig } from '@uranus/config'
import {
  allowedValues,
  applyWrites,
  coerceRawValue,
  describeSchema,
  documentToData,
  formatConfigValue,
  numberBoundsOf,
  pathSegments,
  sameValue,
  schemaAt,
  validateProjectData,
  valueAtPath,
} from './config-file.js'

const FONTE = [
  '# esta linha foi escrita à mão e precisa sobreviver',
  'version: 1',
  'project:',
  '  name: exemplo # o nome do projeto',
  'providers:',
  '  default: claude-code',
  '',
].join('\n')

function camadas(source: string): readonly ConfigLayer[] {
  return [
    {
      name: 'project',
      source: '.uranus/config.yaml',
      data: parseYaml(source) as Record<string, unknown>,
    },
  ]
}

function efetiva(source: string): UranusConfig {
  const parsed = parseConfig(parseYaml(source))
  if (!parsed.ok) throw new Error(parsed.error.message)
  return parsed.value
}

describe('pathSegments', () => {
  it('separa por ponto e transforma índice de lista em número', () => {
    expect(pathSegments('budget.perRun.usd')).toEqual(['budget', 'perRun', 'usd'])
    expect(pathSegments('quality.gates.0.enabled')).toEqual(['quality', 'gates', 0, 'enabled'])
  })
})

describe('schemaAt', () => {
  it('encontra campo aninhado, dentro de record e dentro de lista', () => {
    expect(schemaAt('budget.perRun.usd')).toBeDefined()
    expect(schemaAt('validations.rules.scope')).toBeDefined()
    expect(schemaAt('providers.entries.ollama.mode')).toBeDefined()
    expect(schemaAt('quality.gates.0.agent')).toBeDefined()
  })

  it('recusa caminho que não existe — inclusive chave inválida de record', () => {
    expect(schemaAt('budget.perRun.reais')).toBeUndefined()
    expect(schemaAt('nao.existe')).toBeUndefined()
    // `validations.rules` só aceita as dez regras conhecidas.
    expect(schemaAt('validations.rules.inventada')).toBeUndefined()
  })
})

describe('descrição do schema', () => {
  it('lista os valores de um campo enumerado', () => {
    expect(allowedValues(schemaAt('budget.onExhausted')!)).toEqual(['pause', 'stop', 'ask'])
    // Lista de enum: os valores vêm do elemento, não da lista.
    expect(allowedValues(schemaAt('integration.requireHumanApproval')!)).toContain('merge')
  })

  it('descreve a faixa de um número e o formato dos outros tipos', () => {
    expect(numberBoundsOf(schemaAt('kernel.concurrency')!)).toEqual({ min: 1, max: 32 })
    expect(describeSchema(schemaAt('kernel.concurrency')!)).toBe('número entre 1 e 32')
    expect(describeSchema(schemaAt('integration.strategy')!)).toContain('pull-request')
    expect(describeSchema(schemaAt('backlog.autoPlan')!)).toContain('sim ou não')
  })
})

describe('coerceRawValue', () => {
  it('converte conforme o tipo do campo, e não conforme o formato do texto', () => {
    expect(coerceRawValue(schemaAt('kernel.concurrency')!, '4')).toEqual({ ok: true, value: 4 })
    expect(coerceRawValue(schemaAt('backlog.autoPlan')!, 'nao')).toEqual({ ok: true, value: false })
    expect(coerceRawValue(schemaAt('project.name')!, '42')).toEqual({ ok: true, value: '42' })
    expect(coerceRawValue(schemaAt('integration.requireHumanApproval')!, 'merge,budget')).toEqual({
      ok: true,
      value: ['merge', 'budget'],
    })
  })

  it('recusa texto que não vira número em vez de gravar NaN', () => {
    expect(coerceRawValue(schemaAt('kernel.concurrency')!, 'muitos')).toMatchObject({ ok: false })
  })
})

describe('applyWrites', () => {
  it('preserva o comentário escrito à mão', () => {
    const doc = parseDocument(FONTE)
    applyWrites(doc, efetiva(FONTE), [{ path: 'project.name', value: 'outro' }])
    const texto = doc.toString()

    expect(texto).toContain('# esta linha foi escrita à mão e precisa sobreviver')
    expect(texto).toContain('# o nome do projeto')
    expect(texto).toContain('name: outro')
  })

  it('materializa a seção inteira quando o objeto vazio não valida', () => {
    // `budget.perRun` exige usd, tokens e wallclockMs juntos: gravar só `usd`
    // num arquivo sem a seção produziria uma config que não carrega.
    const doc = parseDocument(FONTE)
    const effective = efetiva(FONTE)
    applyWrites(doc, effective, [{ path: 'budget.perRun.usd', value: 12 }])

    const dados = documentToData(doc)
    expect(valueAtPath(dados, pathSegments('budget.perRun.usd'))).toBe(12)
    expect(valueAtPath(dados, pathSegments('budget.perRun.tokens'))).toBe(
      effective.budget.perRun.tokens,
    )
    expect(validateProjectData(dados, camadas(FONTE)).ok).toBe(true)
  })

  it('cria seção nova sem despejar os defaults de tudo em volta', () => {
    const doc = parseDocument(FONTE)
    applyWrites(doc, efetiva(FONTE), [{ path: 'validations.rules.scope', value: 'advisory' }])

    expect(doc.toString()).toContain('scope: advisory')
    // A seção nasce com o que foi pedido, não com as dez regras.
    expect(doc.toString()).not.toContain('diffSize')
  })
})

describe('validateProjectData', () => {
  it('recusa valor fora da faixa apontando o campo', () => {
    const doc = parseDocument(FONTE)
    applyWrites(doc, efetiva(FONTE), [{ path: 'kernel.concurrency', value: 99 }])
    const resultado = validateProjectData(documentToData(doc), camadas(FONTE))

    expect(resultado.ok).toBe(false)
    expect(resultado.ok ? '' : resultado.error.message).toContain('kernel.concurrency')
  })

  it('valida no merge das camadas, como o carregamento real faz', () => {
    // O arquivo do projeto sozinho não tem `project.name`; quem completa é a
    // camada global. Validar o arquivo isolado daria erro que não existe.
    const semNome = 'version: 1\nkernel:\n  concurrency: 2\n'
    const comGlobal: readonly ConfigLayer[] = [
      { name: 'global', source: '~/.uranus/config.yaml', data: { project: { name: 'do-global' } } },
      {
        name: 'project',
        source: '.uranus/config.yaml',
        data: parseYaml(semNome) as Record<string, unknown>,
      },
    ]
    const resultado = validateProjectData(parseYaml(semNome) as Record<string, unknown>, comGlobal)

    expect(resultado.ok).toBe(true)
    expect(resultado.ok ? resultado.value.project.name : '').toBe('do-global')
  })
})

describe('apresentação de valores', () => {
  it('booleano vira sim/não e lista vazia diz que está vazia', () => {
    expect(formatConfigValue(true)).toBe('sim')
    expect(formatConfigValue(false)).toBe('não')
    expect(formatConfigValue([])).toBe('(nenhum)')
    expect(formatConfigValue(['a', 'b'])).toBe('a, b')
    expect(formatConfigValue(undefined)).toBe('—')
  })

  it('ordem de chave não é diferença de valor', () => {
    expect(sameValue({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
    expect(sameValue({ a: 1 }, { a: 2 })).toBe(false)
    expect(sameValue([1, 2], [2, 1])).toBe(false)
  })
})
