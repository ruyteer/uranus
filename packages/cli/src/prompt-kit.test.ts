import { describe, expect, it } from 'vitest'
import type { PromptIo, PromptOption } from './prompt-kit.js'
import {
  MAX_PROMPT_ATTEMPTS,
  PromptGiveUpError,
  ask,
  askMultiline,
  askNumber,
  confirm,
  formatPrompt,
  multiselect,
  parseConfirmAnswer,
  parseMultiselectAnswer,
  parseNumberAnswer,
  parseSelectAnswer,
  parseTextAnswer,
  renderCheckboxLines,
  renderOptionLines,
  select,
} from './prompt-kit.js'

/** `PromptIo` roteirizado: é o que torna uma sessão inteira testável sem TTY. */
function roteiro(respostas: readonly string[]): PromptIo & {
  readonly saida: string[]
  readonly pendentes: () => number
} {
  const saida: string[] = []
  let proxima = 0
  return {
    saida,
    pendentes: () => respostas.length - proxima,
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

const CORES: readonly PromptOption<string>[] = [
  { value: 'azul', label: 'azul', hint: 'o padrão' },
  { value: 'verde', label: 'verde' },
  { value: 'vermelho', label: 'vermelho', hint: 'chama atenção' },
]

describe('formatPrompt', () => {
  it('mostra o padrão entre colchetes, e some quando não há padrão', () => {
    expect(formatPrompt('número', '3')).toBe('número [3]: ')
    expect(formatPrompt('número')).toBe('número: ')
    expect(formatPrompt('número', '')).toBe('número: ')
  })
})

describe('renderOptionLines', () => {
  it('numera a partir de 1 — é o número que o humano digita', () => {
    const linhas = renderOptionLines(CORES)
    expect(linhas[0]).toContain('1) azul')
    expect(linhas[2]).toContain('3) vermelho')
  })

  it('alinha as dicas e não inventa travessão para quem não tem dica', () => {
    const linhas = renderOptionLines(CORES)
    expect(linhas[0]).toContain('— o padrão')
    expect(linhas[1]).not.toContain('—')
  })

  it('o checkbox mostra o que já está ligado', () => {
    const linhas = renderCheckboxLines(CORES, ['verde'])
    expect(linhas[0]).toContain('[ ]')
    expect(linhas[1]).toContain('[x]')
  })
})

describe('parseTextAnswer', () => {
  it('entrada vazia vira o padrão', () => {
    expect(parseTextAnswer('  ', 'main')).toEqual({ ok: true, value: 'main' })
  })

  it('sem padrão, entrada vazia é recusada em vez de gravar string vazia', () => {
    expect(parseTextAnswer('')).toMatchObject({ ok: false })
  })
})

describe('parseNumberAnswer', () => {
  it('aceita vírgula decimal — quem digita 12,5 está escrevendo português', () => {
    expect(parseNumberAnswer('12,5')).toEqual({ ok: true, value: 12.5 })
  })

  it('recusa fora da faixa e diz qual é a faixa', () => {
    const abaixo = parseNumberAnswer('0', { min: 1, max: 10 })
    expect(abaixo.ok).toBe(false)
    expect(abaixo.ok ? '' : abaixo.problem).toContain('entre 1 e 10')
    expect(parseNumberAnswer('11', { min: 1, max: 10 }).ok).toBe(false)
    expect(parseNumberAnswer('10', { min: 1, max: 10 })).toEqual({ ok: true, value: 10 })
  })

  it('texto que não é número é recusado, não vira NaN', () => {
    expect(parseNumberAnswer('abc', { default: 3 })).toMatchObject({ ok: false })
  })

  it('entrada vazia vira o padrão', () => {
    expect(parseNumberAnswer('', { default: 3 })).toEqual({ ok: true, value: 3 })
  })
})

describe('parseConfirmAnswer', () => {
  it('entende sim e não em português e em inglês', () => {
    for (const sim of ['s', 'S', 'sim', 'y', 'yes', 'true']) {
      expect(parseConfirmAnswer(sim)).toEqual({ ok: true, value: true })
    }
    for (const nao of ['n', 'nao', 'não', 'no', 'false']) {
      expect(parseConfirmAnswer(nao)).toEqual({ ok: true, value: false })
    }
  })

  it('entrada vazia vira o padrão; qualquer outra coisa é recusada', () => {
    expect(parseConfirmAnswer('', false)).toEqual({ ok: true, value: false })
    expect(parseConfirmAnswer('talvez', false)).toMatchObject({ ok: false })
  })
})

describe('parseSelectAnswer', () => {
  it('aceita o número da opção', () => {
    expect(parseSelectAnswer('2', CORES)).toEqual({ ok: true, value: 'verde' })
  })

  it('aceita o valor literal para quem já conhece a configuração', () => {
    expect(parseSelectAnswer('VERMELHO', CORES)).toEqual({ ok: true, value: 'vermelho' })
  })

  it('número fora da faixa é recusado em vez de virar a última opção', () => {
    expect(parseSelectAnswer('4', CORES)).toMatchObject({ ok: false })
    expect(parseSelectAnswer('0', CORES)).toMatchObject({ ok: false })
  })

  it('entrada vazia vira o padrão', () => {
    expect(parseSelectAnswer('', CORES, 'azul')).toEqual({ ok: true, value: 'azul' })
  })
})

describe('parseMultiselectAnswer', () => {
  it('lê a lista de números separada por vírgula, sem repetir', () => {
    expect(parseMultiselectAnswer('1, 3,1', CORES)).toEqual({
      ok: true,
      value: ['azul', 'vermelho'],
    })
  })

  it('entrada vazia mantém o que estava marcado; "-" é a forma de zerar', () => {
    expect(parseMultiselectAnswer('', CORES, ['verde'])).toEqual({ ok: true, value: ['verde'] })
    expect(parseMultiselectAnswer('-', CORES, ['verde'])).toEqual({ ok: true, value: [] })
  })

  it('um item inválido recusa a resposta inteira — meia seleção é pior que nenhuma', () => {
    const resultado = parseMultiselectAnswer('1,9', CORES)
    expect(resultado.ok).toBe(false)
    expect(resultado.ok ? '' : resultado.problem).toContain('1 a 3')
  })
})

describe('perguntas com I/O roteirizado', () => {
  it('escreve a ajuda antes de perguntar e devolve o padrão no Enter em branco', async () => {
    const io = roteiro([''])
    const valor = await ask(io, 'Branch padrão', { default: 'main', help: 'De onde o trabalho parte.' })

    expect(valor).toBe('main')
    expect(io.saida.join('')).toContain('De onde o trabalho parte.')
    expect(io.saida.join('')).toContain('[main]')
  })

  it('resposta inválida repergunta explicando, em vez de abortar ou aceitar', async () => {
    const io = roteiro(['dez', '7'])
    const valor = await askNumber(io, 'Tentativas', { min: 1, max: 10 })

    expect(valor).toBe(7)
    expect(io.saida.join('')).toContain('não é um número')
    expect(io.pendentes()).toBe(0)
  })

  it('desiste depois de três respostas inválidas, sem travar num pipe', async () => {
    const io = roteiro(['x', 'y', 'z', 'w'])
    await expect(askNumber(io, 'Tentativas', { min: 1 })).rejects.toBeInstanceOf(PromptGiveUpError)
    // Consumiu exatamente o teto, e não a quarta resposta.
    expect(io.pendentes()).toBe(4 - MAX_PROMPT_ATTEMPTS)
  })

  it('select mostra as opções e devolve o valor escolhido pelo número', async () => {
    const io = roteiro(['3'])
    expect(await select(io, 'Cor', CORES, { default: 'azul' })).toBe('vermelho')
    expect(io.saida.join('')).toContain('3) vermelho')
  })

  it('multiselect devolve lista e mostra o estado atual de cada item', async () => {
    const io = roteiro(['1,2'])
    expect(await multiselect(io, 'Cores', CORES, { defaults: ['verde'] })).toEqual([
      'azul',
      'verde',
    ])
    expect(io.saida.join('')).toContain('[x] verde')
  })

  it('askMultiline junta as linhas e para no ponto sozinho', async () => {
    const io = roteiro(['primeira', 'segunda', '.'])
    expect(await askMultiline(io, 'Descreva')).toBe('primeira\nsegunda')
  })

  it('confirm marca qual é o padrão na própria linha do prompt', async () => {
    const io = roteiro([''])
    expect(await confirm(io, 'Continuar?', { default: true })).toBe(true)
    expect(io.saida.join('')).toContain('[S/n]')
  })
})
