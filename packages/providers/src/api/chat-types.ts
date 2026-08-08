import type { JsonSchema } from '@uranus/core'

/**
 * Formato de chat compatível com a API da OpenAI.
 *
 * A escolha desse formato como denominador comum é pragmática, não ideológica:
 * OpenAI, OpenRouter, Ollama, LM Studio, llama.cpp, vLLM, Groq e Together
 * expõem exatamente esta interface. Um único adaptador cobre todos — incluindo
 * qualquer modelo local que você rode na sua máquina.
 *
 * Gemini e Anthropic têm formatos próprios; eles entram como adaptadores que
 * traduzem de e para estes tipos, não como um segundo caminho de código.
 */

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ChatToolCall {
  readonly id: string
  readonly type: 'function'
  readonly function: { readonly name: string; readonly arguments: string }
}

export interface ChatMessage {
  readonly role: ChatRole
  readonly content: string | null
  readonly tool_calls?: readonly ChatToolCall[]
  /** Presente quando `role === 'tool'`: liga o resultado à chamada. */
  readonly tool_call_id?: string
  readonly name?: string
}

export interface ChatToolDefinition {
  readonly type: 'function'
  readonly function: {
    readonly name: string
    readonly description: string
    readonly parameters: JsonSchema
  }
}

export interface ChatCompletionRequest {
  readonly model: string
  readonly messages: readonly ChatMessage[]
  readonly tools?: readonly ChatToolDefinition[]
  readonly tool_choice?: 'auto' | 'none' | 'required'
  readonly temperature?: number
  readonly max_tokens?: number
  readonly stream?: boolean
  /** Saída estruturada nativa, quando o servidor suporta. */
  readonly response_format?:
    | { readonly type: 'json_object' }
    | {
        readonly type: 'json_schema'
        readonly json_schema: {
          readonly name: string
          readonly schema: JsonSchema
          readonly strict?: boolean
        }
      }
}

export interface ChatUsage {
  readonly prompt_tokens?: number
  readonly completion_tokens?: number
  readonly total_tokens?: number
  /** Cache: nomes variam entre servidores; todos opcionais. */
  readonly prompt_tokens_details?: { readonly cached_tokens?: number }
  readonly cache_read_input_tokens?: number
  readonly cache_creation_input_tokens?: number
}

export interface ChatChoice {
  readonly index: number
  readonly message: ChatMessage
  readonly finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null
}

export interface ChatCompletionResponse {
  readonly id: string
  readonly model: string
  readonly choices: readonly ChatChoice[]
  readonly usage?: ChatUsage
}

/** Erro no envelope que os servidores compatíveis usam. */
export interface ChatErrorResponse {
  readonly error?: {
    readonly message?: string
    readonly type?: string
    readonly code?: string | number
  }
}
