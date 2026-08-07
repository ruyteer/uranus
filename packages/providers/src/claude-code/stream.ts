import type { ProviderEvent, TokenUsage } from '@uranus/core'
import { EMPTY_USAGE, tryParseJson } from '@uranus/core'

/**
 * Parser do formato `--output-format stream-json` do Claude Code.
 *
 * Isolado do processo (recebe linhas, devolve `ProviderEvent[]`) por causa do
 * R5: quando o formato do CLI mudar — e vai mudar — o raio de dano é este
 * arquivo e seus testes de fixture, nada mais. Linha desconhecida vira warning,
 * nunca erro: a fonte de verdade sobre o que mudou no disco é o `git diff`,
 * não o stream.
 */

interface ClaudeUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

interface ClaudeLine {
  type?: string
  subtype?: string
  model?: string
  message?: {
    content?: {
      type: string
      text?: string
      thinking?: string
      id?: string
      name?: string
      input?: unknown
    }[]
    usage?: ClaudeUsage
  }
  result?: string
  total_cost_usd?: number
  usage?: ClaudeUsage
  num_turns?: number
  session_id?: string
  is_error?: boolean
}

export interface ParsedResultMeta {
  readonly costUsd: number
  readonly usage: TokenUsage
  readonly turns: number
  readonly sessionId?: string
  readonly resultText: string
  readonly isError: boolean
}

export function toTokenUsage(usage: ClaudeUsage | undefined): TokenUsage {
  if (usage === undefined) return EMPTY_USAGE
  return {
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheWrite: usage.cache_creation_input_tokens ?? 0,
    reasoning: 0,
  }
}

export interface StreamParseState {
  resultMeta?: ParsedResultMeta
  model?: string
}

export function parseClaudeLine(line: string, state: StreamParseState): ProviderEvent[] {
  if (line.trim() === '') return []
  const parsed = tryParseJson<ClaudeLine>(line)
  if (parsed === undefined) {
    return [{ type: 'warning', message: `linha não-JSON do provider: ${line.slice(0, 200)}` }]
  }

  switch (parsed.type) {
    case 'system': {
      if (parsed.subtype === 'init' && parsed.model !== undefined) {
        state.model = parsed.model
        return [{ type: 'started', model: parsed.model }]
      }
      return []
    }

    case 'assistant': {
      const events: ProviderEvent[] = []
      for (const block of parsed.message?.content ?? []) {
        if (block.type === 'text' && block.text !== undefined) {
          events.push({ type: 'text', delta: block.text })
        } else if (block.type === 'thinking' && block.thinking !== undefined) {
          events.push({ type: 'thinking', delta: block.thinking })
        } else if (block.type === 'tool_use') {
          events.push({
            type: 'tool_call',
            call: { id: block.id ?? '', name: block.name ?? '', input: block.input },
          })
          const fileEvent = fileChangeFromToolUse(block.name ?? '', block.input)
          if (fileEvent !== undefined) events.push(fileEvent)
        }
      }
      const usage = parsed.message?.usage
      if (usage !== undefined) {
        events.push({ type: 'usage', usage: toTokenUsage(usage) })
      }
      return events
    }

    case 'user': {
      // Resultados de ferramenta ecoados de volta. Só sinalizamos a conclusão.
      return []
    }

    case 'result': {
      state.resultMeta = {
        costUsd: parsed.total_cost_usd ?? 0,
        usage: toTokenUsage(parsed.usage),
        turns: parsed.num_turns ?? 0,
        ...(parsed.session_id === undefined ? {} : { sessionId: parsed.session_id }),
        resultText: parsed.result ?? '',
        isError: parsed.is_error === true || parsed.subtype !== 'success',
      }
      return []
    }

    default:
      return []
  }
}

/** Extrai mudança de arquivo de tool_use de edição (Edit/Write/NotebookEdit). */
function fileChangeFromToolUse(name: string, input: unknown): ProviderEvent | undefined {
  if (input === null || typeof input !== 'object') return undefined
  const filePath = (input as Record<string, unknown>)['file_path']
  if (typeof filePath !== 'string') return undefined

  if (name === 'Write') return { type: 'file_changed', path: filePath, change: 'create' }
  if (name === 'Edit' || name === 'MultiEdit' || name === 'NotebookEdit') {
    return { type: 'file_changed', path: filePath, change: 'modify' }
  }
  return undefined
}
