import type { Clock, Logger, Result } from '@uranus/core'
import { ProviderError, RateLimitedError, TimeoutError, backoffDelay, err, ok } from '@uranus/core'
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatErrorResponse,
} from './chat-types.js'

export interface ChatClientOptions {
  readonly baseUrl: string
  readonly apiKey?: string
  readonly clock: Clock
  readonly logger: Logger
  readonly maxRetries?: number
  readonly requestTimeoutMs?: number
  /** Cabeçalhos extras (ex.: `HTTP-Referer` do OpenRouter). */
  readonly headers?: Readonly<Record<string, string>>
}

/**
 * Cliente HTTP para APIs de chat compatíveis com OpenAI.
 *
 * O que ele acrescenta sobre um `fetch` cru:
 *
 * - **Retry só do que é retryable.** 429 e 5xx são transitórios; 400 e 401 não.
 *   Repetir um erro de schema ou de credencial só queima tempo e, em API paga,
 *   dinheiro.
 * - **Respeita `Retry-After`.** O servidor sabe melhor que o nosso backoff
 *   quando ele volta.
 * - **Timeout por requisição, separado do timeout da sessão.** Um modelo local
 *   carregando pesos na primeira chamada demora minutos; isso não pode ser
 *   confundido com travamento.
 * - **A chave nunca entra no log.** Só o host e o modelo.
 */
export class ChatClient {
  private readonly baseUrl: string
  private readonly apiKey: string | undefined
  private readonly clock: Clock
  private readonly logger: Logger
  private readonly maxRetries: number
  private readonly requestTimeoutMs: number
  private readonly extraHeaders: Readonly<Record<string, string>>

  constructor(options: ChatClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.apiKey = options.apiKey
    this.clock = options.clock
    this.logger = options.logger.child({ component: 'chat-client' })
    this.maxRetries = options.maxRetries ?? 3
    this.requestTimeoutMs = options.requestTimeoutMs ?? 300_000
    this.extraHeaders = options.headers ?? {}
  }

  async complete(
    request: ChatCompletionRequest,
    signal: AbortSignal,
  ): Promise<Result<ChatCompletionResponse>> {
    let lastError: Error | undefined

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      if (signal.aborted) {
        return err(new ProviderError('Requisição abortada pelo kernel'))
      }

      const outcome = await this.attempt(request, signal)
      if (outcome.ok) return outcome

      lastError = outcome.error
      const retryable = outcome.error instanceof RateLimitedError || isRetryable(outcome.error)
      if (!retryable || attempt === this.maxRetries) break

      const retryAfter =
        outcome.error instanceof RateLimitedError
          ? (outcome.error.context['retryAfterMs'] as number | undefined)
          : undefined
      const delay = retryAfter ?? backoffDelay(attempt)

      this.logger.warn('Requisição falhou; repetindo', {
        attempt,
        delayMs: delay,
        error: outcome.error.message.slice(0, 200),
      })
      await this.clock.sleep(delay, signal).catch(() => undefined)
    }

    return err(lastError ?? new ProviderError('Falha desconhecida na requisição'))
  }

  private async attempt(
    request: ChatCompletionRequest,
    signal: AbortSignal,
  ): Promise<Result<ChatCompletionResponse>> {
    const controller = new AbortController()
    const onAbort = (): void => {
      controller.abort()
    }
    signal.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => {
      controller.abort()
    }, this.requestTimeoutMs)

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Servidores locais (Ollama, LM Studio) não exigem chave; mandar
          // `Bearer undefined` faria alguns deles recusarem a requisição.
          ...(this.apiKey === undefined ? {} : { Authorization: `Bearer ${this.apiKey}` }),
          ...this.extraHeaders,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      })

      if (!response.ok) {
        return err(await this.toError(response))
      }

      const parsed = (await response.json()) as ChatCompletionResponse & ChatErrorResponse
      if (parsed.error !== undefined) {
        return err(new ProviderError(parsed.error.message ?? 'Erro reportado pelo servidor'))
      }
      if (!Array.isArray(parsed.choices) || parsed.choices.length === 0) {
        return err(new ProviderError('Resposta sem choices — servidor incompatível?'))
      }
      return ok(parsed)
    } catch (error: unknown) {
      if (controller.signal.aborted && !signal.aborted) {
        return err(
          new TimeoutError(`Requisição excedeu ${String(this.requestTimeoutMs)}ms`, {
            context: { baseUrl: this.baseUrl },
          }),
        )
      }
      return err(
        new ProviderError(
          `Falha de rede ao chamar ${this.baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        ),
      )
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }
  }

  private async toError(response: Response): Promise<Error> {
    const body = await response.text().catch(() => '')
    const detail = body.slice(0, 500)

    if (response.status === 429) {
      const header = response.headers.get('retry-after')
      const retryAfterMs =
        header === null ? undefined : Math.max(1_000, Number.parseFloat(header) * 1_000)
      return new RateLimitedError('Rate limit do provider', {
        context: {
          ...(retryAfterMs === undefined || Number.isNaN(retryAfterMs) ? {} : { retryAfterMs }),
          detail,
        },
      })
    }
    if (response.status === 401 || response.status === 403) {
      return new ProviderError(
        `Autenticação recusada (${String(response.status)}). Verifique a chave de API do provider.`,
        { context: { detail } },
      )
    }
    if (response.status === 404) {
      return new ProviderError(
        `Endpoint não encontrado em ${this.baseUrl}. Confirme o baseUrl (ele deve terminar em /v1).`,
        { context: { detail } },
      )
    }
    if (response.status >= 500) {
      return new ProviderError(`Erro do servidor (${String(response.status)})`, {
        context: { detail },
      })
    }
    // Caso muito comum com modelos locais: o modelo existe mas não foi treinado
    // para function calling. O erro genérico ("400") não diz o que fazer; este
    // diz. Sem ferramentas o Executor não consegue produzir diff nenhum.
    if (/does not support tools|tools.*not supported|function.*not supported/i.test(detail)) {
      return new ProviderError(
        `O modelo configurado não suporta ferramentas (function calling), e o Uranus precisa disso para editar arquivos. Escolha um modelo com suporte a tools — por exemplo qwen2.5-coder, llama3.1, mistral-nemo ou firefunction.`,
        { context: { retryable: false, toolSupport: false, detail } },
      )
    }
    if (/context length|context window|too many tokens|maximum context/i.test(detail)) {
      return new ProviderError(
        `O prompt excedeu a janela de contexto do modelo. Reduza \`context.budgetTokens\` na configuração ou use um modelo com janela maior.`,
        { context: { retryable: false, detail } },
      )
    }

    // 4xx que não é rate limit nem auth: erro nosso. Repetir não ajuda.
    return new ProviderError(`Requisição recusada (${String(response.status)}): ${detail}`, {
      context: { retryable: false },
    })
  }

  /**
   * Sonda se o modelo aceita ferramentas, com o menor custo possível.
   *
   * Existe porque `GET /models` responde "OK" para modelos que não fazem
   * function calling — e sem ferramentas o Executor não consegue produzir diff
   * nenhum. Descobrir isso no `doctor` custa uma requisição; descobrir durante
   * um run custa a task inteira.
   */
  async probeToolSupport(model: string, signal: AbortSignal): Promise<Result<boolean>> {
    const probe = await this.complete(
      {
        model,
        messages: [{ role: 'user', content: 'ok' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'ping',
              description: 'Sonda de capacidade.',
              parameters: { type: 'object', properties: {} },
            },
          },
        ],
        max_tokens: 1,
      },
      signal,
    )

    if (probe.ok) return ok(true)
    const unsupported =
      probe.error instanceof ProviderError && probe.error.context['toolSupport'] === false
    return unsupported ? ok(false) : err(probe.error)
  }

  /** `GET /models` — usado pelo `health()` e pelo `uranus doctor`. */
  async listModels(signal: AbortSignal): Promise<Result<readonly string[]>> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.apiKey === undefined ? {} : { Authorization: `Bearer ${this.apiKey}` },
        signal,
      })
      if (!response.ok) return err(await this.toError(response))
      const parsed = (await response.json()) as { data?: { id?: string }[] }
      return ok((parsed.data ?? []).map((entry) => entry.id ?? '').filter((id) => id !== ''))
    } catch (error: unknown) {
      return err(new ProviderError(`Servidor inacessível em ${this.baseUrl}`, { cause: error }))
    }
  }
}

function isRetryable(error: Error): boolean {
  if (error instanceof TimeoutError) return true
  if (!(error instanceof ProviderError)) return false
  return error.context['retryable'] !== false
}
