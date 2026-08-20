/**
 * Atividade de sessões do Claude Code, relayed pelos hooks de `.claude/settings.json`
 * (`uranus relay <evento>`, ver `@uranus/cli`).
 *
 * Deliberadamente efêmero: a fonte da verdade da conversa é o transcript que o
 * próprio Claude Code já mantém em disco. Este buffer só existe para o painel
 * mostrar "o que está acontecendo agora" sem o usuário ter que abrir um
 * terceiro arquivo — perdê-lo num restart do painel não perde histórico real.
 */

export interface ClaudeActivityEntry {
  readonly at: number
  /** `UserPromptSubmit`, `Stop`, `SubagentStart`, `SubagentStop` — nome do hook do Claude Code, repassado como veio. */
  readonly event: string
  /** Linha curta e pronta para exibir — o relay já resume antes de enviar. */
  readonly summary: string
  readonly role?: 'user' | 'assistant'
  /** Nome do subagente, quando o evento for `SubagentStart`/`SubagentStop`. */
  readonly agent?: string
  readonly sessionId?: string
}

const MAX_ENTRIES = 300

/** Buffer circular em memória — mesma ideia do `TelemetryAggregator`, sem persistência. */
export class ClaudeActivityLog {
  private readonly entries: ClaudeActivityEntry[] = []

  push(entry: ClaudeActivityEntry): void {
    this.entries.push(entry)
    if (this.entries.length > MAX_ENTRIES) this.entries.shift()
  }

  recent(limit = MAX_ENTRIES): readonly ClaudeActivityEntry[] {
    return this.entries.slice(-limit)
  }
}

export function isClaudeActivityEntry(body: Record<string, unknown>): ClaudeActivityEntry | undefined {
  const event = body['event']
  const summary = body['summary']
  if (typeof event !== 'string' || event === '') return undefined
  if (typeof summary !== 'string') return undefined
  const role = body['role']
  const agent = body['agent']
  const sessionId = body['sessionId']
  return {
    at: Date.now(),
    event,
    summary: summary.slice(0, 4000),
    ...(role === 'user' || role === 'assistant' ? { role } : {}),
    ...(typeof agent === 'string' && agent !== '' ? { agent } : {}),
    ...(typeof sessionId === 'string' && sessionId !== '' ? { sessionId } : {}),
  }
}
