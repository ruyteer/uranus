import type { Result } from '../result.js'
import type { AcceptanceContract, Check, CheckKind } from '../domain/acceptance.js'
import type { Task } from '../domain/task.js'
import type { Workspace, WorkspaceRef } from '../domain/vcs.js'
import type { CheckResult, Verification } from '../domain/verification.js'

/**
 * Execução de shell — ADR-011 / R10.
 *
 * Este é o **único** lugar do sistema autorizado a criar processos. A regra
 * existe porque quoting, resolução de shell e propagação de sinal diferem entre
 * Windows e POSIX de formas que quebram silenciosamente; centralizar significa
 * um lugar para corrigir e um lugar para auditar.
 */
export interface ShellCommand {
  readonly command: string
  readonly args?: readonly string[]
  readonly cwd: string
  readonly env?: Readonly<Record<string, string>>
  readonly timeoutMs: number
  /** `true` interpreta a string via shell da plataforma. Use apenas quando necessário. */
  readonly shell?: boolean
  readonly maxOutputBytes?: number
  readonly stdin?: string
}

export interface ShellResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly durationMs: number
  readonly timedOut: boolean
  readonly truncated: boolean
  readonly signal?: string
}

export interface ShellProcess {
  readonly pid?: number
  stdout(): AsyncIterable<string>
  stderr(): AsyncIterable<string>
  write(data: string): Promise<void>
  wait(): Promise<ShellResult>
  kill(signal?: string): Promise<void>
}

export interface ShellRunner {
  run(command: ShellCommand, signal: AbortSignal): Promise<ShellResult>
  spawn(command: ShellCommand, signal: AbortSignal): ShellProcess
}

/**
 * Sandbox — INV-5: escrita apenas em workspace isolado.
 *
 * Um agente que destrói tudo destrói apenas o próprio worktree, e `release` com
 * `discard` desfaz isso em uma operação.
 */
export interface Sandbox {
  acquire(task: Task, signal: AbortSignal): Promise<Result<Workspace>>
  release(workspace: WorkspaceRef, disposition: 'keep' | 'discard' | 'archive'): Promise<void>
  list(): Promise<readonly WorkspaceRef[]>
  /** Workspaces sem task ativa. Reconciliação obrigatória no `recover` (R11). */
  orphans(activeTaskIds: ReadonlySet<string>): Promise<readonly WorkspaceRef[]>
}

export interface VerifyInput {
  readonly contract: AcceptanceContract
  readonly workspace: Workspace
  readonly task: Task
  /** Saída estruturada do agente, para `SchemaCheck`. */
  readonly structuredOutput?: unknown
}

/**
 * O árbitro do INV-2. Nenhum outro componente decide se uma task passou.
 */
export interface Verifier {
  verify(input: VerifyInput, signal: AbortSignal): Promise<Verification>
}

/** Como plugins estendem a verificação com checks específicos de stack. */
export interface CheckImpl<C extends Check = Check> {
  readonly id: string
  readonly kind: CheckKind
  run(check: C, input: VerifyInput, signal: AbortSignal): Promise<CheckResult>
}

export interface CheckRegistry {
  register(impl: CheckImpl): void
  get(kind: CheckKind, id?: string): CheckImpl | undefined
  list(): readonly CheckImpl[]
}
