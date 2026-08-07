import type {
  HealthReport,
  Logger,
  Money,
  Provider,
  ProviderCapabilities,
  ProviderEvent,
  ProviderSession,
  SessionRequest,
  SessionResult,
  ShellProcess,
  ShellRunner,
  TokenUsage,
} from '@uranus/core'
import { EMPTY_USAGE, estimateTokens, newSessionId, usd } from '@uranus/core'
import { renderContextPack } from '../render-context.js'
import { locateClaudeBinary } from './locate.js'
import { parseClaudeLine, type StreamParseState } from './stream.js'

export interface ClaudeCodeProviderOptions {
  readonly shell: ShellRunner
  readonly logger: Logger
  /** Binário do CLI; default `claude`. Pinning de versão via config (R5). */
  readonly binary?: string
  readonly defaultModel?: string
  readonly extraArgs?: readonly string[]
}

const CAPABILITIES: ProviderCapabilities = Object.freeze({
  streaming: true,
  nativeFileEditing: true,
  toolUse: true,
  structuredOutput: false,
  resumableSessions: true,
  vision: true,
  maxContextTokens: 200_000,
  models: ['opus', 'sonnet', 'haiku'],
  maxConcurrentSessions: 1,
})

/**
 * Provider do Claude Code em modo headless (`-p --output-format stream-json`).
 *
 * Duas decisões de segurança que não são negociáveis:
 *  - Permissões: mapeamos `PermissionSet` para `--allowedTools`. Nunca usamos
 *    `--dangerously-skip-permissions` — o CLI é a última linha de defesa se o
 *    mapeamento tiver um buraco.
 *  - O que mudou no disco é apurado por `git diff` no Verifier, não pelo stream.
 *    O stream informa; o diff decide (R5: formato de stream muda, git não).
 */
export class ClaudeCodeProvider implements Provider {
  readonly id = 'claude-code'
  readonly kind = 'cli' as const
  readonly capabilities = CAPABILITIES

  private readonly shell: ShellRunner
  private readonly logger: Logger
  private readonly binary: string
  private readonly defaultModel: string
  private readonly extraArgs: readonly string[]

  constructor(options: ClaudeCodeProviderOptions) {
    this.shell = options.shell
    this.logger = options.logger.child({ component: 'claude-code' })
    this.binary = locateClaudeBinary(options.binary)
    this.defaultModel = options.defaultModel ?? 'sonnet'
    this.extraArgs = options.extraArgs ?? []
  }

  async health(signal: AbortSignal): Promise<HealthReport> {
    const result = await this.shell.run(
      { command: this.binary, args: ['--version'], cwd: process.cwd(), timeoutMs: 15_000 },
      signal,
    )
    const healthy = result.exitCode === 0
    return {
      healthy,
      detail: healthy
        ? result.stdout.trim()
        : `"${this.binary} --version" falhou (exit ${result.exitCode}): instale o Claude Code CLI`,
      ...(healthy ? { version: result.stdout.trim() } : {}),
      checkedAt: Date.now(),
    }
  }

  createSession(request: SessionRequest, signal: AbortSignal): Promise<ProviderSession> {
    const contextText = renderContextPack(request.context)
    const prompt =
      contextText.length > 0 ? `${contextText}\n\n${request.instruction}` : request.instruction

    const args: string[] = [
      '-p',
      prompt,
      '--output-format',
      'stream-json',
      '--verbose',
      '--model',
      request.model ?? this.defaultModel,
      '--max-turns',
      String(request.limits.maxTurns),
      '--append-system-prompt',
      request.systemPrompt,
      '--permission-mode',
      'acceptEdits',
    ]

    const allowedTools = mapPermissionsToTools(request)
    if (allowedTools.length > 0) {
      args.push('--allowedTools', allowedTools.join(','))
    }
    if (request.resumeToken !== undefined) {
      args.push('--resume', request.resumeToken)
    }
    args.push(...this.extraArgs)

    const child = this.shell.spawn(
      {
        command: this.binary,
        args,
        cwd: request.workdir,
        timeoutMs: request.limits.maxWallclockMs,
        env: {
          NO_COLOR: '1',
          // Sessões headless não devem herdar config interativa do usuário.
          CLAUDE_CODE_ENTRYPOINT: 'uranus',
        },
        maxOutputBytes: 16 * 1024 * 1024,
      },
      signal,
    )

    return Promise.resolve(new ClaudeCodeSession(child, this, this.logger))
  }

  estimateCost(usage: TokenUsage, model: string): Money {
    // Preços por milhão (tabela mínima do MVP; a Fase 7 versiona isto).
    const pricing = model.includes('opus')
      ? { in: 15, out: 75, cr: 1.5, cw: 18.75 }
      : model.includes('haiku')
        ? { in: 1, out: 5, cr: 0.1, cw: 1.25 }
        : { in: 3, out: 15, cr: 0.3, cw: 3.75 }
    const dollars =
      (usage.input / 1e6) * pricing.in +
      (usage.output / 1e6) * pricing.out +
      (usage.cacheRead / 1e6) * pricing.cr +
      (usage.cacheWrite / 1e6) * pricing.cw
    return usd(dollars)
  }

  estimateTokens(request: SessionRequest): number {
    return (
      estimateTokens(request.systemPrompt) +
      estimateTokens(request.instruction) +
      request.context.tokens +
      // Saída e turnos de ferramenta: multiplicador empírico e pessimista.
      request.limits.maxTurns * 2_000
    )
  }
}

class ClaudeCodeSession implements ProviderSession {
  readonly id = newSessionId()
  private readonly state: StreamParseState = {}
  private readonly filesTouched = new Set<string>()
  private aggregatedUsage: TokenUsage = EMPTY_USAGE
  private resultPromise: Promise<SessionResult> | undefined

  constructor(
    private readonly child: ShellProcess,
    private readonly provider: ClaudeCodeProvider,
    private readonly logger: Logger,
  ) {}

  async *stream(): AsyncIterable<ProviderEvent> {
    for await (const line of this.child.stdout()) {
      for (const event of parseClaudeLine(line, this.state)) {
        if (event.type === 'file_changed') this.filesTouched.add(event.path)
        if (event.type === 'usage') {
          this.aggregatedUsage = {
            input: this.aggregatedUsage.input + event.usage.input,
            output: this.aggregatedUsage.output + event.usage.output,
            cacheRead: this.aggregatedUsage.cacheRead + event.usage.cacheRead,
            cacheWrite: this.aggregatedUsage.cacheWrite + event.usage.cacheWrite,
            reasoning: this.aggregatedUsage.reasoning + event.usage.reasoning,
          }
        }
        yield event
      }
    }
    const result = await this.result()
    yield { type: 'done', result }
  }

  result(): Promise<SessionResult> {
    this.resultPromise ??= this.child.wait().then((shell) => {
      const meta = this.state.resultMeta
      const usage = meta?.usage ?? this.aggregatedUsage
      const model = this.state.model ?? 'sonnet'

      const status: SessionResult['status'] = shell.timedOut
        ? 'limit_reached'
        : meta === undefined
          ? 'error'
          : meta.isError
            ? 'error'
            : 'completed'

      if (status === 'error') {
        this.logger.warn('Sessão do Claude Code terminou com erro', {
          exitCode: shell.exitCode,
          stderr: shell.stderr.slice(0, 500),
        })
      }

      return {
        status,
        text: meta?.resultText ?? shell.stdout.slice(-4_000),
        usage,
        cost:
          meta !== undefined && meta.costUsd > 0
            ? usd(meta.costUsd)
            : this.provider.estimateCost(usage, model),
        turns: meta?.turns ?? 0,
        ...(meta?.sessionId === undefined ? {} : { resumeToken: meta.sessionId }),
        filesTouched: [...this.filesTouched],
      }
    })
    return this.resultPromise
  }

  async interrupt(_reason: string): Promise<void> {
    await this.child.kill()
  }
}

/**
 * `PermissionSet` → `--allowedTools`.
 * Leitura sempre liberada (o modelo precisa ler para editar); escrita/execução
 * derivam das permissões efetivas da task.
 */
export function mapPermissionsToTools(request: SessionRequest): readonly string[] {
  const tools: string[] = ['Read', 'Glob', 'Grep', 'LS']

  const canWrite = request.permissions.fs.write.length > 0
  if (canWrite) tools.push('Edit', 'Write', 'MultiEdit')

  if (request.permissions.exec !== false) {
    for (const pattern of request.permissions.exec.allow) {
      tools.push(pattern === '*' ? 'Bash' : `Bash(${pattern})`)
    }
  }
  if (request.permissions.network !== false) {
    tools.push('WebFetch')
  }
  return tools
}
