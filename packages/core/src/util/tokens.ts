/**
 * Estimativa de tokens — **apenas para admissão**, nunca para contabilidade.
 *
 * R18: a contabilidade de custo usa sempre o `usage` real reportado pelo provider.
 * Esta heurística existe para uma única decisão: o `BudgetGuard` precisa saber,
 * *antes* de gastar, se uma requisição cabe no orçamento restante. Errar para mais
 * é seguro (recusa uma task que caberia); errar para menos estoura o orçamento.
 * Por isso a estimativa é deliberadamente pessimista.
 */

/** Caracteres por token em texto natural (inglês/português) para modelos BPE. */
const CHARS_PER_TOKEN_PROSE = 3.6
/** Código tokeniza pior: identificadores, pontuação e indentação. */
const CHARS_PER_TOKEN_CODE = 3.0
/** Margem aplicada por cima. Ver comentário acima sobre a assimetria do erro. */
const SAFETY_MARGIN = 1.15

export type TextKind = 'prose' | 'code' | 'auto'

const CODE_SIGNALS =
  /(^|\n)\s*(import|from|function|class|const|let|var|def |public |private |return |if \(|for \(|<\/?[a-z]|[{};]\s*$)/m

export function detectKind(text: string): Exclude<TextKind, 'auto'> {
  return CODE_SIGNALS.test(text) ? 'code' : 'prose'
}

/**
 * Estimativa pessimista do número de tokens de um texto.
 * Não substitui o tokenizador do provider — providers que expõem contagem exata
 * devem sobrescrever isto em `Provider.estimateTokens`.
 */
export function estimateTokens(text: string, kind: TextKind = 'auto'): number {
  if (text.length === 0) return 0
  const resolved = kind === 'auto' ? detectKind(text) : kind
  const ratio = resolved === 'code' ? CHARS_PER_TOKEN_CODE : CHARS_PER_TOKEN_PROSE
  return Math.ceil((text.length / ratio) * SAFETY_MARGIN)
}

export function estimateTokensOf(values: readonly string[], kind: TextKind = 'auto'): number {
  let total = 0
  for (const value of values) total += estimateTokens(value, kind)
  return total
}

/**
 * Trunca preservando início e fim, que é onde a informação útil de um log de
 * erro está. Cortar só o fim descarta o stack trace; cortar só o início descarta
 * o comando que falhou.
 */
export function truncateMiddle(
  text: string,
  maxChars: number,
  marker = '\n…[truncado]…\n',
): string {
  if (text.length <= maxChars) return text
  if (maxChars <= marker.length) return text.slice(0, maxChars)
  const keep = maxChars - marker.length
  const head = Math.ceil(keep * 0.6)
  const tail = keep - head
  return text.slice(0, head) + marker + text.slice(text.length - tail)
}
