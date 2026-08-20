import { createInterface } from 'node:readline/promises'

/**
 * Primitivas de terminal dos modos guiados (`uranus config`, `uranus init`).
 *
 * Três decisões moldam o arquivo:
 *
 * 1. **Select é numerado**, não navegação por setas. Seta exige raw mode e
 *    controle de cursor ANSI — de onde vem a maior parte dos defeitos de
 *    terminal entre plataformas, e este projeto roda em Windows. Digitar um
 *    número funciona em todo lugar, inclusive para quem não vive no terminal.
 *
 * 2. **O I/O entra por parâmetro (`PromptIo`)** e a interpretação da resposta é
 *    função pura. É o que permite exercitar uma sessão inteira do wizard com um
 *    roteiro de respostas, sem TTY nenhum.
 *
 * 3. **Resposta inválida repergunta**, com o motivo — nunca aborta na primeira
 *    e nunca aceita valor errado em silêncio. O teto de tentativas existe para
 *    o caso de alguém canalizar um arquivo na entrada: sem ele, o laço giraria
 *    para sempre lendo EOF.
 */

export interface PromptOption<T> {
  readonly value: T
  readonly label: string
  readonly hint?: string
}

export interface PromptIo {
  question(prompt: string): Promise<string>
  write(text: string): void
}

/**
 * Resultado de interpretar uma resposta digitada.
 *
 * Não é o `Result` de `@uranus/core` de propósito: lá o erro é um `UranusError`
 * com código e contexto, feito para atravessar camadas; aqui o "erro" é uma
 * frase curta que o humano lê e responde de novo na linha seguinte.
 */
export type Parsed<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: string }

export function parsedOk<T>(value: T): Parsed<T> {
  return { ok: true, value }
}

export function parsedProblem<T>(problem: string): Parsed<T> {
  return { ok: false, problem }
}

/** Tentativas antes de desistir. Ver decisão 3 no topo do arquivo. */
export const MAX_PROMPT_ATTEMPTS = 3

export class PromptGiveUpError extends Error {
  constructor(label: string) {
    super(
      `Três respostas inválidas seguidas em "${label}" — desisti de perguntar. ` +
        'Nada foi gravado.',
    )
    this.name = 'PromptGiveUpError'
  }
}

// ── renderização (puro) ─────────────────────────────────────────────────────

/** `Rótulo [padrão]: ` — o padrão entre colchetes é o que o Enter em branco aceita. */
export function formatPrompt(label: string, shownDefault?: string): string {
  return shownDefault === undefined || shownDefault === ''
    ? `${label}: `
    : `${label} [${shownDefault}]: `
}

export function renderHelpLines(help?: string): readonly string[] {
  if (help === undefined || help.trim() === '') return []
  return help.split('\n').map((line) => `  ${line.trim()}`)
}

function padLabels<T>(options: readonly PromptOption<T>[]): number {
  const comDica = options.filter((option) => option.hint !== undefined)
  return comDica.length === 0 ? 0 : Math.max(...comDica.map((option) => option.label.length))
}

/** `   1) rótulo — dica`. O número é o que o humano digita. */
export function renderOptionLines<T>(options: readonly PromptOption<T>[]): readonly string[] {
  const width = padLabels(options)
  return options.map((option, index) => {
    const numero = String(index + 1).padStart(3)
    const rotulo = option.hint === undefined ? option.label : option.label.padEnd(width)
    return `${numero}) ${rotulo}${option.hint === undefined ? '' : ` — ${option.hint}`}`
  })
}

/** Igual, com o estado atual de cada item — o multiselect precisa mostrá-lo. */
export function renderCheckboxLines<T>(
  options: readonly PromptOption<T>[],
  selected: readonly T[],
): readonly string[] {
  const width = padLabels(options)
  return options.map((option, index) => {
    const numero = String(index + 1).padStart(3)
    const marca = selected.includes(option.value) ? '[x]' : '[ ]'
    const rotulo = option.hint === undefined ? option.label : option.label.padEnd(width)
    return `${numero}) ${marca} ${rotulo}${option.hint === undefined ? '' : ` — ${option.hint}`}`
  })
}

// ── interpretação das respostas (puro) ──────────────────────────────────────

export function parseTextAnswer(raw: string, fallback?: string): Parsed<string> {
  const texto = raw.trim()
  if (texto !== '') return parsedOk(texto)
  if (fallback !== undefined && fallback !== '') return parsedOk(fallback)
  return parsedProblem('Precisa de um valor — não há padrão para esta pergunta.')
}

export interface NumberBounds {
  readonly min?: number
  readonly max?: number
}

export function describeBounds(bounds: NumberBounds): string {
  if (bounds.min !== undefined && bounds.max !== undefined) {
    return `entre ${String(bounds.min)} e ${String(bounds.max)}`
  }
  if (bounds.min !== undefined) return `mínimo ${String(bounds.min)}`
  if (bounds.max !== undefined) return `máximo ${String(bounds.max)}`
  return ''
}

export function parseNumberAnswer(
  raw: string,
  opts?: NumberBounds & { readonly default?: number },
): Parsed<number> {
  const texto = raw.trim()
  if (texto === '') {
    return opts?.default === undefined
      ? parsedProblem('Precisa de um número — não há padrão para esta pergunta.')
      : parsedOk(opts.default)
  }
  // Vírgula decimal: quem escreve "12,5" está digitando português, não errando.
  const valor = Number.parseFloat(texto.replace(',', '.'))
  if (!Number.isFinite(valor)) return parsedProblem(`"${texto}" não é um número.`)
  if (opts?.min !== undefined && valor < opts.min) {
    return parsedProblem(`Precisa ser ${describeBounds(opts)} — ${String(valor)} é baixo demais.`)
  }
  if (opts?.max !== undefined && valor > opts.max) {
    return parsedProblem(`Precisa ser ${describeBounds(opts)} — ${String(valor)} é alto demais.`)
  }
  return parsedOk(valor)
}

const SIM = new Set(['s', 'si', 'sim', 'y', 'yes', 'true', '1'])
const NAO = new Set(['n', 'nao', 'não', 'no', 'false', '0'])

export function parseConfirmAnswer(raw: string, fallback?: boolean): Parsed<boolean> {
  const texto = raw.trim().toLowerCase()
  if (texto === '') {
    return fallback === undefined ? parsedProblem('Responda s (sim) ou n (não).') : parsedOk(fallback)
  }
  if (SIM.has(texto)) return parsedOk(true)
  if (NAO.has(texto)) return parsedOk(false)
  return parsedProblem(`"${raw.trim()}" não é sim nem não. Digite s ou n.`)
}

/**
 * Aceita o número da opção ou o valor literal.
 *
 * O literal existe porque quem já conhece a configuração digita "pull-request"
 * por reflexo, e recusar isso seria pedantismo — o número continua sendo o
 * caminho anunciado.
 */
export function parseSelectAnswer<T>(
  raw: string,
  options: readonly PromptOption<T>[],
  fallback?: T,
): Parsed<T> {
  const texto = raw.trim()
  if (texto === '') {
    return fallback === undefined
      ? parsedProblem(`Digite um número de 1 a ${String(options.length)}.`)
      : parsedOk(fallback)
  }
  const indice = parseIndex(texto, options.length)
  if (indice !== undefined) return parsedOk(options[indice]!.value)

  const literal = options.find(
    (option) =>
      String(option.value).toLowerCase() === texto.toLowerCase() ||
      option.label.toLowerCase() === texto.toLowerCase(),
  )
  if (literal !== undefined) return parsedOk(literal.value)
  return parsedProblem(
    `"${texto}" não é uma das opções. Digite um número de 1 a ${String(options.length)}.`,
  )
}

/** Números separados por vírgula. `-` é a forma explícita de escolher nenhum. */
export function parseMultiselectAnswer<T>(
  raw: string,
  options: readonly PromptOption<T>[],
  fallback?: readonly T[],
): Parsed<readonly T[]> {
  const texto = raw.trim()
  if (texto === '') {
    return fallback === undefined ? parsedOk([]) : parsedOk(fallback)
  }
  if (texto === '-') return parsedOk([])

  const escolhidos: T[] = []
  for (const parte of texto.split(',')) {
    const item = parte.trim()
    if (item === '') continue
    const indice = parseIndex(item, options.length)
    if (indice === undefined) {
      return parsedProblem(
        `"${item}" não é uma opção. Use números de 1 a ${String(options.length)} ` +
          'separados por vírgula, ou - para nenhum.',
      )
    }
    const valor = options[indice]!.value
    if (!escolhidos.includes(valor)) escolhidos.push(valor)
  }
  return parsedOk(escolhidos)
}

function parseIndex(texto: string, count: number): number | undefined {
  if (!/^\d+$/.test(texto)) return undefined
  const numero = Number.parseInt(texto, 10)
  return numero >= 1 && numero <= count ? numero - 1 : undefined
}

// ── perguntas (I/O) ─────────────────────────────────────────────────────────

async function askUntilValid<T>(
  io: PromptIo,
  label: string,
  contexto: readonly string[],
  prompt: string,
  parse: (raw: string) => Parsed<T>,
): Promise<T> {
  for (const linha of contexto) io.write(`${linha}\n`)
  for (let tentativa = 0; tentativa < MAX_PROMPT_ATTEMPTS; tentativa++) {
    const parsed = parse(await io.question(prompt))
    if (parsed.ok) return parsed.value
    io.write(`  ⚠ ${parsed.problem}\n`)
  }
  throw new PromptGiveUpError(label)
}

export interface AskOptions {
  readonly default?: string
  readonly help?: string
}

export function ask(io: PromptIo, label: string, opts?: AskOptions): Promise<string> {
  return askUntilValid(
    io,
    label,
    [`\n${label}`, ...renderHelpLines(opts?.help)],
    formatPrompt('resposta', opts?.default),
    (raw) => parseTextAnswer(raw, opts?.default),
  )
}

export interface AskNumberOptions extends NumberBounds {
  readonly default?: number
  readonly help?: string
}

export function askNumber(
  io: PromptIo,
  label: string,
  opts?: AskNumberOptions,
): Promise<number> {
  const faixa = describeBounds(opts ?? {})
  return askUntilValid(
    io,
    label,
    [`\n${label}`, ...renderHelpLines(opts?.help)],
    formatPrompt(faixa === '' ? 'número' : `número (${faixa})`, opts?.default?.toString()),
    (raw) => parseNumberAnswer(raw, opts ?? {}),
  )
}

export interface ConfirmOptions {
  readonly default?: boolean
  readonly help?: string
}

export function confirm(io: PromptIo, label: string, opts?: ConfirmOptions): Promise<boolean> {
  const marca = opts?.default === undefined ? 's/n' : opts.default ? 'S/n' : 's/N'
  return askUntilValid(
    io,
    label,
    [`\n${label}`, ...renderHelpLines(opts?.help)],
    `${marca === 's/n' ? 'sim ou não' : `sim ou não [${marca}]`}: `,
    (raw) => parseConfirmAnswer(raw, opts?.default),
  )
}

export interface SelectOptions<T> {
  readonly default?: T
  readonly help?: string
}

export function select<T>(
  io: PromptIo,
  label: string,
  options: readonly PromptOption<T>[],
  opts?: SelectOptions<T>,
): Promise<T> {
  const atual = options.find((option) => option.value === opts?.default)
  return askUntilValid(
    io,
    label,
    [`\n${label}`, ...renderHelpLines(opts?.help), ...renderOptionLines(options)],
    formatPrompt('número', atual?.label),
    (raw) => parseSelectAnswer(raw, options, opts?.default),
  )
}

export interface MultiselectOptions<T> {
  readonly defaults?: readonly T[]
  readonly help?: string
}

export function multiselect<T>(
  io: PromptIo,
  label: string,
  options: readonly PromptOption<T>[],
  opts?: MultiselectOptions<T>,
): Promise<readonly T[]> {
  const marcados = opts?.defaults ?? []
  return askUntilValid(
    io,
    label,
    [
      `\n${label}`,
      ...renderHelpLines(opts?.help),
      ...renderCheckboxLines(options, marcados),
      '  Enter mantém o que está marcado; - deixa nenhum.',
    ],
    'números separados por vírgula: ',
    (raw) => parseMultiselectAnswer(raw, options, opts?.defaults),
  )
}

/**
 * Texto de várias linhas, terminado por um ponto sozinho.
 *
 * Mesma convenção do modo guiado do `uranus backlog add`, que já estava no
 * `main.ts`: duas formas diferentes de terminar um texto no mesmo CLI seriam
 * uma a mais para o humano decorar.
 */
export async function askMultiline(
  io: PromptIo,
  label: string,
  opts?: { readonly help?: string },
): Promise<string> {
  io.write(`\n${label}\n`)
  for (const linha of renderHelpLines(opts?.help)) io.write(`${linha}\n`)
  io.write('  Termine com um ponto sozinho (.)\n')
  const linhas: string[] = []
  for (;;) {
    const linha = await io.question('| ')
    if (linha.trim() === '.') break
    linhas.push(linha)
  }
  return linhas.join('\n').trim()
}

// ── o I/O de verdade ────────────────────────────────────────────────────────

export interface StdioPromptIo extends PromptIo {
  close(): void
}

/**
 * `PromptIo` sobre o terminal.
 *
 * `process.stdout.write` e não `console.log` porque o prompt não pode terminar
 * em quebra de linha — e porque `no-console` está ligado fora do `main.ts`.
 */
export function stdioPromptIo(): StdioPromptIo {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return {
    question: (prompt: string) => rl.question(prompt),
    write: (text: string) => {
      process.stdout.write(text)
    },
    close: () => {
      rl.close()
    },
  }
}
