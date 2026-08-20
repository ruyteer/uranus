import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import type { ProjectDigest } from '@uranus/core'
import type { ConfigLayer, UranusConfig } from '@uranus/config'
import { parseConfig } from '@uranus/config'
import type { PromptIo } from './prompt-kit.js'
import { allowedValues, numberBoundsOf, schemaAt } from './config-file.js'
import {
  ADVANCED_CONFIG_CATEGORIES,
  ALL_CONFIG_CATEGORIES,
  CONFIG_CATEGORIES,
  currentAnswer,
  pendingChanges,
  renderCategoryOptions,
  renderChangeSummary,
  renderConfigShow,
  resolvedConfig,
  runConfigWizard,
  writesFor,
} from './config-wizard.js'

const FONTE = [
  '# comentário do dono do projeto',
  'version: 1',
  'project:',
  '  name: exemplo # não mexa',
  'providers:',
  '  default: claude-code',
  '',
].join('\n')

function efetiva(source: string): UranusConfig {
  const parsed = parseConfig(parseYaml(source))
  if (!parsed.ok) throw new Error(parsed.error.message)
  return parsed.value
}

function camadas(source: string): readonly ConfigLayer[] {
  return [
    {
      name: 'project',
      source: '.uranus/config.yaml',
      data: parseYaml(source) as Record<string, unknown>,
    },
  ]
}

/** Mesmo `PromptIo` roteirizado de `prompt-kit.test.ts`, repetido de propósito. */
function roteiro(respostas: readonly string[]): PromptIo & { readonly saida: string[] } {
  const saida: string[] = []
  let proxima = 0
  return {
    saida,
    question: (prompt: string) => {
      saida.push(prompt)
      const resposta = respostas[proxima]
      if (resposta === undefined) throw new Error(`roteiro esgotado em: ${prompt}`)
      proxima += 1
      return Promise.resolve(resposta)
    },
    write: (text: string) => {
      saida.push(text)
    },
  }
}

interface SessaoDeTeste {
  readonly io: ReturnType<typeof roteiro>
  readonly gravado: string[]
  readonly gravacoes: Promise<number>
}

function sessao(respostas: readonly string[], source = FONTE): SessaoDeTeste {
  const io = roteiro(respostas)
  const gravado: string[] = []
  return {
    io,
    gravado,
    gravacoes: runConfigWizard({
      io,
      configPath: '.uranus/config.yaml',
      source,
      layers: camadas(source),
      effective: efetiva(source),
      save: (text: string) => {
        gravado.push(text)
        return Promise.resolve()
      },
    }),
  }
}

// Posição das categorias no menu PADRÃO ([projeto, painel]), na ordem
// declarada. `sair` é a última.
const MENU_PAINEL = '2'
const MENU_SAIR = String(CONFIG_CATEGORIES.length + 1)

describe('ALL_CONFIG_CATEGORIES', () => {
  it('todo caminho existe no schema da configuração', () => {
    for (const category of ALL_CONFIG_CATEGORIES) {
      for (const question of category.questions) {
        expect(schemaAt(question.path), `${category.id}: ${question.path}`).toBeDefined()
      }
    }
  })

  it('toda pergunta explica a consequência — sem ajuda, o leigo responde no chute', () => {
    for (const category of ALL_CONFIG_CATEGORIES) {
      expect(category.blurb.trim(), category.id).not.toBe('')
      for (const question of category.questions) {
        expect(question.help.trim(), question.path).not.toBe('')
        expect(question.label.trim(), question.path).not.toBe('')
      }
    }
  })

  it('as opções oferecidas são exatamente as que o schema aceita', () => {
    for (const category of ALL_CONFIG_CATEGORIES) {
      for (const question of category.questions) {
        if (question.kind !== 'select' && question.kind !== 'multiselect') continue
        expect(question.options?.length ?? 0, question.path).toBeGreaterThan(0)
        const aceitos = allowedValues(schemaAt(question.path)!)
        if (aceitos === undefined) continue
        for (const option of question.options ?? []) {
          expect(aceitos, `${question.path} → ${option.value}`).toContain(option.value)
        }
      }
    }
  })

  it('a faixa numérica perguntada cabe na faixa do schema', () => {
    for (const category of ALL_CONFIG_CATEGORIES) {
      for (const question of category.questions) {
        if (question.kind !== 'number') continue
        const bounds = numberBoundsOf(schemaAt(question.path)!)
        if (bounds.min !== undefined) {
          expect(question.min ?? Number.NEGATIVE_INFINITY, question.path).toBeGreaterThanOrEqual(
            bounds.min,
          )
        }
        if (bounds.max !== undefined) {
          expect(question.max ?? Number.POSITIVE_INFINITY, question.path).toBeLessThanOrEqual(
            bounds.max,
          )
        }
      }
    }
  })

  it('nenhum caminho é perguntado duas vezes, e nenhum id se repete', () => {
    const caminhos = ALL_CONFIG_CATEGORIES.flatMap((c) => c.questions.map((q) => q.path))
    expect(new Set(caminhos).size).toBe(caminhos.length)
    const ids = ALL_CONFIG_CATEGORIES.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('CONFIG_CATEGORIES (o que o wizard pergunta por padrão) é só projeto e painel', () => {
    expect(CONFIG_CATEGORIES.map((c) => c.id)).toEqual(['projeto', 'painel'])
  })

  it('o resto — orçamento, validações, backlog, integração, qualidade, provider — fica em modo avançado', () => {
    const ids = ADVANCED_CONFIG_CATEGORIES.map((c) => c.id)
    expect(ids).toEqual(
      expect.arrayContaining(['modelo', 'orcamento', 'validacoes', 'backlog', 'integracao', 'qualidade']),
    )
    // As dez regras de validação, uma a uma — continuam declaradas, só não
    // aparecem no wizard padrão.
    const validacoes = ADVANCED_CONFIG_CATEGORIES.find((c) => c.id === 'validacoes')
    expect(
      validacoes?.questions.filter((q) => q.path.startsWith('validations.rules.')),
    ).toHaveLength(10)
  })

  it('juntas, padrão e avançado cobrem exatamente todas as categorias', () => {
    const juntas = [...CONFIG_CATEGORIES, ...ADVANCED_CONFIG_CATEGORIES].map((c) => c.id).sort()
    expect(juntas).toEqual([...ALL_CONFIG_CATEGORIES].map((c) => c.id).sort())
  })

  it('o menu termina em uma saída explícita', () => {
    const opcoes = renderCategoryOptions()
    expect(opcoes).toHaveLength(CONFIG_CATEGORIES.length + 1)
    expect(opcoes.at(-1)?.label).toBe('sair')
  })
})

describe('currentAnswer', () => {
  it('mostra o valor de hoje como padrão', () => {
    const pergunta = CONFIG_CATEGORIES[0]!.questions[0]!
    expect(currentAnswer(pergunta, efetiva(FONTE))).toBe('exemplo')
  })

  it('a sugestão da detecção passa na frente do default do schema, e só dele', () => {
    const branch = CONFIG_CATEGORIES.find((c) => c.id === 'projeto')!.questions.find(
      (q) => q.path === 'project.vcs.defaultBranch',
    )!
    const digest = { vcs: { defaultBranch: 'master' } } as unknown as ProjectDigest
    const effective = efetiva(FONTE)

    // `main` é default do schema: ninguém escolheu, então a detecção manda.
    expect(currentAnswer(branch, effective, digest, new Map())).toBe('master')
    // Declarado no arquivo, o wizard não contradiz o dono do projeto.
    const declarado = new Map([
      ['project.vcs.defaultBranch', { layer: 'project', source: '.uranus/config.yaml' }],
    ])
    expect(currentAnswer(branch, effective, digest, declarado)).toBe('main')
  })

  it('regra de validação ausente mostra a severidade que de fato vale', () => {
    const scope = ADVANCED_CONFIG_CATEGORIES.find((c) => c.id === 'validacoes')!.questions.find(
      (q) => q.path === 'validations.rules.scope',
    )!
    // Cru, a seção é `{}`; resolvida, a regra é `blocking` — e é isso que roda.
    expect(currentAnswer(scope, efetiva(FONTE))).toBeUndefined()
    expect(currentAnswer(scope, resolvedConfig(efetiva(FONTE)))).toBe('blocking')
  })

  it('sem runner de teste detectado, sugere avisar em vez de reprovar', () => {
    const tests = ADVANCED_CONFIG_CATEGORIES.find((c) => c.id === 'validacoes')!.questions.find(
      (q) => q.path === 'validations.rules.tests',
    )!
    const resolvida = resolvedConfig(efetiva(FONTE))
    const semRunner = { tests: {} } as unknown as ProjectDigest
    const comRunner = { tests: { runner: 'vitest' } } as unknown as ProjectDigest

    expect(currentAnswer(tests, resolvida, semRunner, new Map())).toBe('advisory')
    expect(currentAnswer(tests, resolvida, comRunner, new Map())).toBe('blocking')
  })

  it('traduz o valor gravado para a resposta mostrada (gates de qualidade)', () => {
    const gates = ADVANCED_CONFIG_CATEGORIES.find((c) => c.id === 'qualidade')!.questions.find(
      (q) => q.path === 'quality.gates',
    )!
    expect(currentAnswer(gates, efetiva(FONTE))).toEqual(['reviewer', 'security'])
  })
})

describe('writesFor', () => {
  it('escolher um provider de API declara também a entrada dele', () => {
    const pergunta = ADVANCED_CONFIG_CATEGORIES.find((c) => c.id === 'modelo')!.questions[0]!
    const writes = writesFor(pergunta, 'ollama', 'claude-code')

    expect(writes).toEqual([
      { path: 'providers.default', value: 'ollama' },
      { path: 'providers.entries.ollama.mode', value: 'api' },
      { path: 'providers.entries.ollama.preset', value: 'ollama' },
    ])
  })

  it('provider pago aponta a chave para a variável de ambiente, nunca para o arquivo', () => {
    const pergunta = ADVANCED_CONFIG_CATEGORIES.find((c) => c.id === 'modelo')!.questions[0]!
    const writes = writesFor(pergunta, 'openrouter', 'claude-code')
    expect(writes).toContainEqual({
      path: 'providers.entries.openrouter.apiKeyRef',
      value: 'env:OPENROUTER_API_KEY',
    })
    expect(JSON.stringify(writes)).not.toContain('sk-')
  })

  it('o gate que o projeto declarou à mão não é apagado pelo wizard', () => {
    const gates = ADVANCED_CONFIG_CATEGORIES.find((c) => c.id === 'qualidade')!.questions.find(
      (q) => q.path === 'quality.gates',
    )!
    const writes = writesFor(gates, ['reviewer'], [
      { agent: 'reviewer', enabled: true },
      { agent: 'meu-gate', enabled: true },
    ])

    expect(writes[0]?.value).toEqual([
      { agent: 'reviewer', enabled: true },
      { agent: 'security', enabled: false },
      { agent: 'qa', enabled: false },
      { agent: 'meu-gate', enabled: true },
    ])
  })
})

describe('pendingChanges', () => {
  it('resposta igual ao valor atual não é mudança', () => {
    const effective = efetiva(FONTE)
    expect(
      pendingChanges(effective, [{ path: 'providers.default', value: 'claude-code' }]),
    ).toEqual([])
  })

  it('resume valor atual → valor novo, com o caminho', () => {
    const mudancas = pendingChanges(efetiva(FONTE), [{ path: 'budget.perRun.usd', value: 5 }])
    expect(mudancas).toEqual([{ path: 'budget.perRun.usd', from: 25, to: 5 }])
    expect(renderChangeSummary(mudancas)[0]).toContain('budget.perRun.usd  25 → 5')
  })
})

describe('runConfigWizard', () => {
  it('grava a resposta no caminho certo e preserva os comentários do arquivo', async () => {
    const s = sessao([MENU_PAINEL, '5000', '', MENU_SAIR])
    expect(await s.gravacoes).toBe(1)

    const texto = s.gravado.at(-1) ?? ''
    expect(texto).toContain('# comentário do dono do projeto')
    expect(texto).toContain('# não mexa')
    expect(texto).toContain('port: 5000')
    expect(parseConfig(parseYaml(texto)).ok).toBe(true)
  })

  it('não grava o que não mudou — Enter em branco mantém o arquivo enxuto', async () => {
    const s = sessao([MENU_PAINEL, '5000', '', MENU_SAIR])
    await s.gravacoes
    const texto = s.gravado.at(-1) ?? ''

    expect(texto).toContain('port: 5000')
    expect(texto).not.toContain('enabled')
  })

  it('mostra o resumo do que vai mudar antes de pedir a confirmação', async () => {
    const s = sessao([MENU_PAINEL, '5000', '', MENU_SAIR])
    await s.gravacoes
    const saida = s.io.saida.join('')

    expect(saida).toContain('O que vai mudar')
    expect(saida).toContain('telemetry.dashboard.port')
    expect(saida).toContain('4319 → 5000')
  })

  it('recusar a confirmação não grava nada e volta ao menu', async () => {
    const s = sessao([MENU_PAINEL, '5000', 'n', MENU_SAIR])
    expect(await s.gravacoes).toBe(0)
    expect(s.gravado).toEqual([])
    expect(s.io.saida.join('')).toContain('Nada foi gravado')
  })

  it('categoria respondida sem mudar nada não gera gravação', async () => {
    const s = sessao([MENU_PAINEL, '', MENU_SAIR])
    expect(await s.gravacoes).toBe(0)
    expect(s.io.saida.join('')).toContain('Nada mudou nesta categoria')
  })

  it('a sessão continua até a saída explícita, gravando categoria a categoria', async () => {
    const s = sessao([
      '1', // Projeto
      'renomeado',
      '', // branch: mantém
      '', // confirma
      MENU_PAINEL,
      '5000',
      '', // confirma
      MENU_SAIR,
    ])
    expect(await s.gravacoes).toBe(2)

    const texto = s.gravado.at(-1) ?? ''
    expect(texto).toContain('name: renomeado')
    expect(texto).toContain('port: 5000')
    expect(texto).toContain('# comentário do dono do projeto')
  })
})

describe('renderConfigShow', () => {
  it('distingue o que veio do arquivo do que é default', () => {
    const origins = new Map([
      ['project.name', { layer: 'project', source: '.uranus/config.yaml' }],
    ])
    const linhas = renderConfigShow(efetiva(FONTE), origins, '.uranus/config.yaml').join('\n')

    expect(linhas).toContain('project.name')
    expect(linhas).toContain('arquivo do projeto')
    expect(linhas).toContain('default do Uranus')
    // Toda categoria aparece, mesmo a que o arquivo não menciona.
    for (const category of CONFIG_CATEGORIES) expect(linhas).toContain(category.title)
  })
})
