import type { Glob } from '../util/glob.js'

/**
 * Contrato de aceite — o coração do INV-2.
 *
 * "Sucesso é provado por código, nunca por autoavaliação do modelo."
 *
 * Um `Check` é uma asserção executável. O veredito é o exit code, não a opinião
 * do agente. Toda `Task` carrega um contrato obrigatório; uma task sem contrato
 * é rejeitada na admissão, porque sem ela o modo de falha nº1 (R1 — alucinação
 * de sucesso) volta a existir.
 *
 * `advisory: true` registra o resultado mas nunca bloqueia. É o único lugar onde
 * um julgamento por modelo pode entrar, e ele nunca decide nada.
 */

export type JsonSchema = Readonly<Record<string, unknown>>

export interface CheckBase {
  readonly id: string
  readonly advisory?: boolean
  readonly timeoutMs: number
}

export interface CommandCheck extends CheckBase {
  readonly kind: 'command'
  readonly run: string
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string>>
  readonly expectExit?: number
}

export interface TestsCheck extends CheckBase {
  readonly kind: 'tests'
  /** Id de runner registrado por plugin (`vitest`, `pytest`, `phpunit`, ...). */
  readonly runner: string
  readonly scope?: 'all' | 'related' | 'diff'
  /**
   * Exige ao menos um teste novo passando.
   * Sem isto, "implementou sem testar" passa no contrato — e é o segundo caminho
   * mais comum para um falso `done`.
   */
  readonly requireNewTests?: boolean
  readonly forbidSkipped?: boolean
}

export interface CoverageCheck extends CheckBase {
  readonly kind: 'coverage'
  /** Fração entre 0 e 1. */
  readonly min: number
  readonly scope: 'diff' | 'global'
}

export interface DiffCheck extends CheckBase {
  readonly kind: 'diff'
  readonly maxFiles?: number
  readonly maxLines?: number
  /** Pega o caso "o modelo declarou sucesso sem alterar arquivo nenhum". */
  readonly requireNonEmpty?: boolean
  readonly forbidPaths?: readonly Glob[]
  /** Default em tempo de execução: `task.touches`. Faz cumprir o INV-5. */
  readonly requirePathsWithin?: readonly Glob[]
}

export interface ArtifactCheck extends CheckBase {
  readonly kind: 'artifact'
  readonly path: string
  readonly mustExist: boolean
  /** Regex aplicada ao conteúdo, quando o arquivo precisa conter algo específico. */
  readonly matches?: string
}

export interface SchemaCheck extends CheckBase {
  readonly kind: 'schema'
  readonly schema: JsonSchema
}

export interface PluginCheck extends CheckBase {
  readonly kind: 'plugin'
  readonly check: string
  readonly config?: Readonly<Record<string, unknown>>
}

export type Check =
  CommandCheck | TestsCheck | CoverageCheck | DiffCheck | ArtifactCheck | SchemaCheck | PluginCheck

export type CheckKind = Check['kind']

export interface AcceptanceContract {
  readonly checks: readonly Check[]
  /** `true` = todos os checks bloqueantes precisam passar. */
  readonly requireAll: boolean
}

export const EMPTY_CONTRACT: AcceptanceContract = Object.freeze({
  checks: Object.freeze([]),
  requireAll: true,
})

export function isBlocking(check: Check): boolean {
  return check.advisory !== true
}

export function blockingChecks(contract: AcceptanceContract): readonly Check[] {
  return contract.checks.filter(isBlocking)
}

/**
 * Um contrato sem nenhum check bloqueante aprova qualquer coisa — o que é
 * exatamente a ausência de verificação disfarçada de verificação. O kernel
 * rejeita tasks assim na admissão.
 */
export function isEnforceable(contract: AcceptanceContract): boolean {
  return blockingChecks(contract).length > 0
}

/** Soma dos timeouts: teto de tempo da fase `verify` do tick. */
export function contractTimeoutMs(contract: AcceptanceContract): number {
  return contract.checks.reduce((total, check) => total + check.timeoutMs, 0)
}
