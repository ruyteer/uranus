import { describe, expect, it } from 'vitest'
import { InvariantViolation } from '../errors.js'
import { assertDefined, assertNever, invariant } from './assert.js'
import { digestEquals, digestOf, hashText, shortDigest } from './checksum.js'
import { createMatcher, globsIntersect, isAllowed, literalPrefix, matchesAny } from './glob.js'
import { stableStringify, tryParseJson } from './json.js'
import {
  exceedsWindowsMaxPath,
  isWithin,
  pathEquals,
  pathKey,
  relativeWithin,
  toNative,
  toPosix,
  workspaceDirName,
} from './path.js'
import { REDACTED, SecretRegistry, isSensitiveKey, redact, redactText } from './redact.js'
import { detectKind, estimateTokens, estimateTokensOf, truncateMiddle } from './tokens.js'

describe('assert', () => {
  it('invariant passa quando verdadeiro e lança quando falso', () => {
    expect(() => {
      invariant(true, 'ok')
    }).not.toThrow()
    expect(() => {
      invariant(false, 'INV-2 violado', { taskId: 'tsk_1' })
    }).toThrow(InvariantViolation)
  })

  it('assertNever documenta caso não tratado', () => {
    expect(() => assertNever('x' as never)).toThrow(InvariantViolation)
  })

  it('assertDefined estreita o tipo', () => {
    expect(assertDefined(1, 'm')).toBe(1)
    expect(() => {
      assertDefined(undefined, 'm')
    }).toThrow(InvariantViolation)
    expect(() => assertDefined(null, 'm')).toThrow(InvariantViolation)
  })
})

describe('stableStringify', () => {
  it('produz a mesma string independentemente da ordem das chaves', () => {
    // Sem esta propriedade, ContextPack.digest seria inútil (ADR-007).
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }))
  })

  it('preserva a ordem de arrays', () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]))
  })

  it('trata tipos especiais de forma determinística', () => {
    expect(stableStringify(undefined)).toBe('null')
    expect(stableStringify(Number.NaN)).toBe('null')
    expect(stableStringify(Number.POSITIVE_INFINITY)).toBe('null')
    expect(stableStringify(10n)).toBe('"10"')
    expect(stableStringify(() => 1)).toBe('null')
    expect(stableStringify(new Date(0))).toBe('"1970-01-01T00:00:00.000Z"')
  })

  it('ordena Map por chave e Set por conteúdo', () => {
    const a = stableStringify(
      new Map([
        ['b', 1],
        ['a', 2],
      ]),
    )
    const b = stableStringify(
      new Map([
        ['a', 2],
        ['b', 1],
      ]),
    )
    expect(a).toBe(b)
    expect(stableStringify(new Set([2, 1]))).toBe(stableStringify(new Set([1, 2])))
  })

  it('ignora campos undefined em objetos', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}')
  })

  it('detecta referência circular', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic['self'] = cyclic
    expect(() => stableStringify(cyclic)).toThrow(TypeError)
  })

  it('tryParseJson devolve undefined em vez de lançar', () => {
    expect(tryParseJson('{"a":1}')).toEqual({ a: 1 })
    expect(tryParseJson('{quebrado')).toBeUndefined()
  })
})

describe('checksum', () => {
  it('digest é estável para conteúdo equivalente', () => {
    expect(digestOf({ a: 1, b: 2 })).toBe(digestOf({ b: 2, a: 1 }))
    expect(digestOf({ a: 1 })).not.toBe(digestOf({ a: 2 }))
  })

  it('hashText produz sha256 hexadecimal', () => {
    expect(hashText('abc')).toMatch(/^[0-9a-f]{64}$/)
    expect(hashText('abc', 'sha1')).toMatch(/^[0-9a-f]{40}$/)
  })

  it('digestEquals compara sem vazar por comprimento', () => {
    const digest = digestOf({ a: 1 })
    expect(digestEquals(digest, digest)).toBe(true)
    expect(digestEquals(digest, 'curto')).toBe(false)
    expect(digestEquals(digest, digestOf({ a: 2 }))).toBe(false)
  })

  it('shortDigest encurta para exibição', () => {
    expect(shortDigest(digestOf({}))).toHaveLength(12)
  })
})

describe('glob', () => {
  it('normaliza separadores do Windows antes de comparar (R10)', () => {
    expect(matchesAny('src\\api\\user.ts', ['src/**'])).toBe(true)
    expect(matchesAny('src/api/user.ts', ['src/**'])).toBe(true)
  })

  it('matcher vazio nunca casa', () => {
    const matcher = createMatcher([])
    expect(matcher('qualquer/coisa.ts')).toBe(false)
    expect(matcher.patterns).toEqual([])
  })

  it('deny sempre vence sobre allow', () => {
    expect(isAllowed('src/a.ts', ['**'], ['src/**'])).toBe(false)
    expect(isAllowed('src/a.ts', ['**'], [])).toBe(true)
    expect(isAllowed('.env', ['**'], ['.env'])).toBe(false)
  })

  it('extrai o prefixo literal de um padrão', () => {
    expect(literalPrefix('src/api/**/*.ts')).toBe('src/api')
    expect(literalPrefix('src/a.ts')).toBe('src')
    expect(literalPrefix('*.ts')).toBe('')
  })

  describe('globsIntersect', () => {
    it('conjuntos vazios nunca conflitam', () => {
      expect(globsIntersect([], ['src/**'])).toBe(false)
      expect(globsIntersect(['src/**'], [])).toBe(false)
    })

    it('detecta sobreposição por prefixo aninhado', () => {
      expect(globsIntersect(['src/**'], ['src/api/*.ts'])).toBe(true)
      expect(globsIntersect(['**'], ['docs/*.md'])).toBe(true)
    })

    it('reconhece literais idênticos e distintos', () => {
      expect(globsIntersect(['src/a.ts'], ['src/a.ts'])).toBe(true)
      expect(globsIntersect(['src/a.ts'], ['src/b.ts'])).toBe(false)
    })

    it('é conservador: prefere falso positivo a conflito de merge (R6)', () => {
      // Não conseguimos provar disjunção quando há metacaractere; responder
      // "não conflita" custaria um merge hell, responder "conflita" custa espera.
      expect(globsIntersect(['src/**/*.ts'], ['src/**/*.md'])).toBe(true)
    })

    it('declara disjunto quando os prefixos não se contêm', () => {
      expect(globsIntersect(['src/api/**'], ['docs/**'])).toBe(false)
    })
  })
})

describe('path', () => {
  it('converte para forma canônica POSIX e de volta', () => {
    expect(toPosix('a\\b\\c')).toBe('a/b/c')
    expect(toPosix('a//b')).toBe('a/b')
    expect(toNative('a/b')).toBe(['a', 'b'].join(process.platform === 'win32' ? '\\' : '/'))
  })

  it('relativeWithin devolve undefined para caminho fora da raiz (INV-5)', () => {
    expect(relativeWithin('/root', '/root/src/a.ts')).toBe('src/a.ts')
    expect(relativeWithin('/root', '/root')).toBe('.')
    expect(relativeWithin('/root', '/outro/a.ts')).toBeUndefined()
    expect(relativeWithin('/root', '/root/../fuga.ts')).toBeUndefined()
  })

  it('isWithin reflete relativeWithin', () => {
    expect(isWithin('/root', '/root/a')).toBe(true)
    expect(isWithin('/root', '/fora')).toBe(false)
  })

  it('compara caminhos conforme a sensibilidade a maiúsculas da plataforma', () => {
    expect(pathEquals('src/a.ts', 'src/a.ts')).toBe(true)
    const caseInsensitive = process.platform === 'win32' || process.platform === 'darwin'
    expect(pathEquals('src/A.ts', 'src/a.ts')).toBe(caseInsensitive)
    expect(pathKey('SRC/A.ts')).toBe(caseInsensitive ? 'src/a.ts' : 'SRC/A.ts')
  })

  it('alerta sobre estouro do limite de 260 caracteres no Windows', () => {
    const longPath = `C:\\${'x'.repeat(250)}`
    expect(exceedsWindowsMaxPath(longPath)).toBe(process.platform === 'win32')
    expect(exceedsWindowsMaxPath('C:\\curto')).toBe(false)
  })

  it('gera nome de worktree curto para preservar margem de path', () => {
    const name = workspaceDirName('wsp_01HZZZZZZZZZZZZZZZZZZZZZZZ')
    expect(name).toHaveLength(8)
    expect(name).toBe(name.toLowerCase())
    expect(workspaceDirName('semprefixo')).toHaveLength(8)
  })
})

describe('redact', () => {
  it('redige por nome de campo sensível', () => {
    expect(isSensitiveKey('apiKey')).toBe(true)
    expect(isSensitiveKey('api_key')).toBe(true)
    expect(isSensitiveKey('password')).toBe(true)
    expect(isSensitiveKey('title')).toBe(false)

    expect(redact({ apiKey: 'segredo-longo', title: 'ok' })).toEqual({
      apiKey: REDACTED,
      title: 'ok',
    })
  })

  it('redige padrões conhecidos mesmo em campo de nome inocente', () => {
    const text = 'usando sk-ant-abcdefghijklmnopqrst para chamar'
    expect(redactText(text)).toContain(REDACTED)
    expect(redactText(text)).not.toContain('sk-ant-abcdefghijklmnopqrst')
    expect(redactText('ghp_abcdefghijklmnopqrstuvwx')).toBe(REDACTED)
  })

  it('redige valores registrados pelo SecretProvider', () => {
    const registry = new SecretRegistry()
    registry.register('valor-super-secreto')
    // Valores curtos causariam falso positivo em todo texto e são ignorados.
    registry.register('abc')
    expect(registry.size).toBe(1)
    expect(redactText('o token é valor-super-secreto!', registry)).toBe(`o token é ${REDACTED}!`)
    expect(redactText('abc', registry)).toBe('abc')

    registry.clear()
    expect(registry.size).toBe(0)
  })

  it('percorre estruturas aninhadas sem quebrar em ciclo', () => {
    const cyclic: Record<string, unknown> = { token: 'x' }
    cyclic['self'] = cyclic
    const result = redact(cyclic) as Record<string, unknown>
    expect(result['token']).toBe(REDACTED)
    expect(result['self']).toBe('[CIRCULAR]')
  })

  it('redige dentro de arrays e mensagens de erro', () => {
    expect(redact(['ghp_abcdefghijklmnopqrstuvwx'])).toEqual([REDACTED])
    const error = redact(new Error('vazou ghp_abcdefghijklmnopqrstuvwx')) as {
      message: string
    }
    expect(error.message).toContain(REDACTED)
  })

  it('preserva primitivos não sensíveis', () => {
    expect(redact(42)).toBe(42)
    expect(redact(null)).toBeNull()
    expect(redact(true)).toBe(true)
  })
})

describe('tokens', () => {
  it('detecta código e prosa', () => {
    expect(detectKind('import { a } from "b"')).toBe('code')
    expect(detectKind('Este é um texto comum em português.')).toBe('prose')
  })

  it('estima de forma pessimista (R18)', () => {
    const text = 'a'.repeat(360)
    // Prosa: 360/3.6 = 100 tokens "reais"; a margem de segurança sobe isso.
    expect(estimateTokens(text, 'prose')).toBeGreaterThan(100)
    expect(estimateTokens('', 'prose')).toBe(0)
  })

  it('código estima mais tokens que prosa para o mesmo tamanho', () => {
    const text = 'x'.repeat(1000)
    expect(estimateTokens(text, 'code')).toBeGreaterThan(estimateTokens(text, 'prose'))
  })

  it('soma estimativas de vários textos', () => {
    expect(estimateTokensOf(['abcd', 'efgh'], 'prose')).toBe(
      estimateTokens('abcd', 'prose') + estimateTokens('efgh', 'prose'),
    )
  })

  it('trunca preservando início e fim', () => {
    const text = `INICIO${'m'.repeat(500)}FIM`
    const truncated = truncateMiddle(text, 100)
    expect(truncated.length).toBeLessThanOrEqual(100)
    expect(truncated.startsWith('INICIO')).toBe(true)
    expect(truncated.endsWith('FIM')).toBe(true)
  })

  it('não altera texto que já cabe', () => {
    expect(truncateMiddle('curto', 100)).toBe('curto')
  })

  it('degrada para corte simples quando o limite é menor que o marcador', () => {
    expect(truncateMiddle('abcdef', 3)).toBe('abc')
  })
})
