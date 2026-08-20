import type {
  Clock,
  HealthReport,
  Logger,
  Money,
  ModelPricing,
  Provider,
  ProviderCapabilities,
  ProviderEvent,
  ProviderSession,
  SessionRequest,
  SessionResult,
  ShellRunner,
  TokenUsage,
} from '@uranus/core'
import {
  EMPTY_USAGE,
  ZERO_USD,
  addUsage,
  estimateTokens,
  newSessionId,
  priceUsage,
  usd,
} from '@uranus/core'
import { renderContextPack } from '../render-context.js'
import { extractJson } from '../structured.js'
import type { ChatMessage, ChatToolCall, ChatToolDefinition } from './chat-types.js'
import { ChatClient } from './http-client.js'
import { recoverToolCalls } from './tool-call-recovery.js'
import {
  DEFAULT_FILE_TOOLS,
  toolsForPermissions,
  type FileTool,
  type ToolResult,
} from './file-tools.js'

export interface ApiProviderOptions {
  readonly id: string
  readonly baseUrl: string
  readonly apiKey?: string
  readonly defaultModel: string
  readonly shell: ShellRunner
  readonly clock: Clock
  readonly logger: Logger
  readonly capabilities?: Partial<ProviderCapabilities>
  readonly pricing?: ModelPricing
  readonly headers?: Readonly<Record<string, string>>
  readonly requestTimeoutMs?: number
  readonly tools?: readonly FileTool[]
  readonly temperature?: number
}

const DEFAULT_CAPABILITIES: ProviderCapabilities = {
  streaming: false,
  // A diferença central para o CliProvider: aqui QUEM edita é o Uranus.
  nativeFileEditing: false,
  toolUse: true,
  structuredOutput: true,
  resumableSessions: false,
  vision: false,
  maxContextTokens: 128_000,
  models: [],
  maxConcurrentSessions: 2,
}

/**
 * Provider sobre APIs de chat compatíveis com OpenAI — inclui **modelos locais**
 * (Ollama, LM Studio, llama.cpp, vLLM) e serviços (OpenAI, OpenRouter, Groq).
 *
 * Diferença de garantia em relação ao `CliProvider`:
 *
 * | | CliProvider (Claude Code) | ApiProvider |
 * |---|---|---|
 * | Quem edita arquivos | o CLI | **o Uranus** |
 * | Permissão verificada | via `--allowedTools` | **a cada chamada** |
 * | Fonte de verdade do diff | `git diff` | `git diff` (igual) |
 *
 * Como o laço de ferramentas roda aqui, o INV-5 deixa de depender de um
 * mapeamento correto de flags e passa a ser verificado por código a cada
 * operação — o que torna este caminho estritamente mais seguro.
 */
export class ApiProvider implements Provider {
  readonly id: string
  readonly kind = 'api' as const
  readonly capabilities: ProviderCapabilities

  private readonly client: ChatClient
  private readonly options: ApiProviderOptions
  private readonly tools: readonly FileTool[]

  constructor(options: ApiProviderOptions) {
    this.id = options.id
    this.options = options
    this.capabilities = { ...DEFAULT_CAPABILITIES, ...options.capabilities }
    this.tools = options.tools ?? DEFAULT_FILE_TOOLS
    this.client = new ChatClient({
      baseUrl: options.baseUrl,
      ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
      clock: options.clock,
      logger: options.logger,
      ...(options.headers === undefined ? {} : { headers: options.headers }),
      ...(options.requestTimeoutMs === undefined
        ? {}
        : { requestTimeoutMs: options.requestTimeoutMs }),
    })
  }

  async health(signal: AbortSignal): Promise<HealthReport> {
    const models = await this.client.listModels(signal)
    if (!models.ok) {
      return {
        healthy: false,
        detail: models.error.message,
        checkedAt: this.options.clock.now(),
      }
    }
    const hasModel = models.value.length === 0 || models.value.includes(this.options.defaultModel)
    if (!hasModel) {
      return {
        healthy: false,
        detail: `Modelo "${this.options.defaultModel}" não está disponível. Disponíveis: ${models.value.slice(0, 10).join(', ')}`,
        checkedAt: this.options.clock.now(),
      }
    }

    // O modelo existir não basta: sem function calling o Executor não consegue
    // editar nada. Uma requisição barata aqui evita descobrir isso no meio de
    // uma task, depois de já ter criado worktree e gasto contexto.
    const tools = await this.client.probeToolSupport(this.options.defaultModel, signal)
    if (!tools.ok) {
      // A sonda é a requisição mais simples possível. Se ela falha, as reais
      // também vão — reportar saudável aqui só adiaria a descoberta.
      return {
        healthy: false,
        detail: `Falha ao sondar o modelo: ${tools.error.message}`,
        checkedAt: this.options.clock.now(),
      }
    }
    if (!tools.value) {
      return {
        healthy: false,
        detail: `O modelo "${this.options.defaultModel}" não suporta ferramentas (function calling). Use um modelo com suporte a tools — por exemplo qwen2.5-coder, llama3.1 ou mistral-nemo.`,
        checkedAt: this.options.clock.now(),
      }
    }

    return {
      healthy: true,
      detail: `${String(models.value.length)} modelo(s) em ${this.options.baseUrl}; "${this.options.defaultModel}" suporta ferramentas`,
      checkedAt: this.options.clock.now(),
    }
  }

  createSession(request: SessionRequest, signal: AbortSignal): Promise<ProviderSession> {
    return Promise.resolve(
      new ApiSession({
        request,
        signal,
        client: this.client,
        provider: this,
        model: request.model ?? this.options.defaultModel,
        tools: toolsForPermissions(this.tools, request.permissions),
        shell: this.options.shell,
        logger: this.options.logger.child({ component: this.id }),
        ...(this.options.temperature === undefined
          ? {}
          : { temperature: this.options.temperature }),
      }),
    )
  }

  estimateCost(usage: TokenUsage, model: string): Money {
    const pricing = this.options.pricing
    // Sem tabela de preços (o caso de modelo local), o custo em dinheiro é
    // zero — o que é a verdade: a eletricidade não passa pelo BudgetGuard.
    // Os limites de tokens e de tempo continuam valendo.
    if (pricing === undefined) return ZERO_USD
    return priceUsage(usage, { ...pricing, model })
  }

  estimateTokens(request: SessionRequest): number {
    return (
      estimateTokens(request.systemPrompt) +
      estimateTokens(request.instruction) +
      request.context.tokens +
      request.limits.maxTurns * 1_500
    )
  }
}

interface ApiSessionOptions {
  readonly request: SessionRequest
  readonly signal: AbortSignal
  readonly client: ChatClient
  readonly provider: ApiProvider
  readonly model: string
  readonly tools: readonly FileTool[]
  readonly shell: ShellRunner
  readonly logger: Logger
  readonly temperature?: number
}

/**
 * O laço agêntico. Enquanto o modelo pedir ferramentas, executamos e
 * devolvemos o resultado — até ele parar, estourar os turnos ou o kernel abortar.
 */
class ApiSession implements ProviderSession {
  readonly id = newSessionId()
  private readonly events: ProviderEvent[] = []
  private result_: SessionResult | undefined
  private running: Promise<SessionResult> | undefined

  constructor(private readonly options: ApiSessionOptions) {}

  async *stream(): AsyncIterable<ProviderEvent> {
    const result = await this.result()
    // Sem streaming nativo: os eventos são emitidos ao final, na ordem em que
    // aconteceram. O kernel só usa o stream para log, então isso não muda
    // nenhuma decisão — apenas o momento em que a informação aparece.
    for (const event of this.events) yield event
    yield { type: 'done', result }
  }

  result(): Promise<SessionResult> {
    this.running ??= this.run()
    return this.running
  }

  interrupt(_reason: string): Promise<void> {
    return Promise.resolve() // o AbortSignal do kernel já cobre isto
  }

  private async run(): Promise<SessionResult> {
    const { request, tools, logger, model } = this.options

    const contextText = renderContextPack(request.context)
    const messages: ChatMessage[] = [
      { role: 'system', content: request.systemPrompt },
      {
        role: 'user',
        content:
          contextText.length > 0 ? `${contextText}\n\n${request.instruction}` : request.instruction,
      },
    ]

    const toolDefs: ChatToolDefinition[] = tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }))

    const filesTouched = new Set<string>()
    let usage: TokenUsage = EMPTY_USAGE
    let turns = 0
    let finalText = ''
    let status: SessionResult['status'] = 'completed'

    this.events.push({ type: 'started', model })

    while (turns < request.limits.maxTurns) {
      if (this.options.signal.aborted) {
        status = 'interrupted'
        break
      }
      turns++

      const response = await this.options.client.complete(
        {
          model,
          messages,
          // No 1º turno nada foi tocado ainda, então força uma tool-call em vez
          // de confiar só no prompt — modelos genéricos (fora do Claude/CLI)
          // às vezes respondem só em texto quando `auto` deixa a decisão livre.
          // Turnos seguintes voltam a `auto` para ele poder concluir sem forçar
          // uma chamada supérflua quando já terminou.
          ...(toolDefs.length > 0
            ? { tools: toolDefs, tool_choice: turns === 1 ? 'required' : 'auto' }
            : {}),
          ...(this.options.temperature === undefined
            ? {}
            : { temperature: this.options.temperature }),
          // Saída estruturada nativa quando pedida. Se o servidor ignorar,
          // o `extractJson` recupera do texto e o SchemaCheck valida (INV-2).
          ...(request.outputSchema === undefined
            ? {}
            : {
                response_format: {
                  type: 'json_schema' as const,
                  json_schema: {
                    name: 'resposta',
                    schema: request.outputSchema,
                    strict: false,
                  },
                },
              }),
        },
        this.options.signal,
      )

      if (!response.ok) {
        logger.error('Chamada ao modelo falhou', { error: response.error.message })
        this.events.push({
          type: 'error',
          error: { code: 'E_PROVIDER', message: response.error.message, retryable: true },
        })
        status = 'error'
        finalText = response.error.message
        break
      }

      usage = addUsage(usage, toTokenUsage(response.value.usage))
      this.events.push({ type: 'usage', usage: toTokenUsage(response.value.usage) })

      const choice = response.value.choices[0]!
      const message = choice.message

      // Servidor que não converte a chamada em `tool_calls` a deixa no texto.
      // Sem esta recuperação, o laço interpreta "o modelo não pediu nada" e a
      // sessão termina sem tocar em arquivo — ver `tool-call-recovery.ts`.
      let calls = message.tool_calls ?? []
      let recovered = false
      if (calls.length === 0) {
        const fromText = recoverToolCalls(
          message.content,
          this.options.tools.map((tool) => tool.name),
          `${this.id}_t${String(turns)}`,
        )
        if (fromText.length > 0) {
          calls = fromText
          recovered = true
          logger.debug('Chamada de ferramenta recuperada do texto da resposta', {
            ferramentas: fromText.map((call) => call.function.name),
          })
        }
      }

      // Histórico normalizado: a mensagem entra com `tool_calls` preenchido, e
      // sem o texto que era a chamada. Empilhar um `role: "tool"` sem a chamada
      // correspondente quebra a conversa em servidores mais estritos.
      messages.push(recovered ? { ...message, content: null, tool_calls: calls } : message)

      // Texto que era, na verdade, uma chamada de ferramenta não é resposta do
      // modelo: tratá-lo como tal faria a chamada crua vazar para o resumo da
      // tentativa e para a extração de saída estruturada.
      if (!recovered && message.content !== null && message.content.trim() !== '') {
        finalText = message.content
        this.events.push({ type: 'text', delta: message.content })
      }

      if (calls.length === 0) {
        // Encerrar no primeiro turno sem ter chamado ferramenta nenhuma é o
        // sintoma de "o modelo não edita arquivos". As causas são várias
        // (modelo sem function calling, template que não emite `tool_calls`,
        // modelo que só descreve o que faria) e distingui-las sem ver o texto
        // cru é adivinhação. Em `debug` isso fica registrado uma vez.
        if (turns === 1 && this.options.tools.length > 0) {
          logger.debug('Sessão terminou no 1º turno sem chamar ferramenta', {
            finishReason: choice.finish_reason,
            ferramentasOferecidas: this.options.tools.length,
            respostaCrua: (message.content ?? '').slice(0, 1_000),
          })
        }
        if (choice.finish_reason === 'length') status = 'limit_reached'
        break
      }

      for (const call of calls) {
        const outcome = await this.executeTool(call)
        if (outcome.changed !== undefined) filesTouched.add(outcome.changed)
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content: outcome.content,
        })
      }
    }

    if (turns >= request.limits.maxTurns && status === 'completed') {
      status = 'limit_reached'
      logger.warn('Sessão atingiu o limite de turnos', { turns })
    }

    const structured = request.outputSchema === undefined ? undefined : extractJson(finalText)

    this.result_ = {
      status,
      text: finalText,
      ...(structured === undefined ? {} : { structured }),
      usage,
      cost: this.options.provider.estimateCost(usage, model),
      turns,
      filesTouched: [...filesTouched],
    }
    return this.result_
  }

  private async executeTool(call: ChatToolCall): Promise<ToolResult> {
    const tool = this.options.tools.find((candidate) => candidate.name === call.function.name)
    this.events.push({
      type: 'tool_call',
      call: { id: call.id, name: call.function.name, input: call.function.arguments },
    })

    if (tool === undefined) {
      // Ferramenta inexistente é erro do modelo, não do harness: devolvemos a
      // mensagem para ele se corrigir, em vez de abortar a sessão.
      const content = `Ferramenta desconhecida: "${call.function.name}". Disponíveis: ${this.options.tools.map((t) => t.name).join(', ')}`
      this.events.push({ type: 'tool_result', callId: call.id, ok: false, summary: content })
      return { ok: false, content }
    }

    let input: Record<string, unknown>
    try {
      input = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>
    } catch {
      const content = `Argumentos inválidos (não é JSON): ${call.function.arguments.slice(0, 200)}`
      this.events.push({ type: 'tool_result', callId: call.id, ok: false, summary: content })
      return { ok: false, content }
    }

    let outcome: ToolResult
    try {
      outcome = await tool.execute(input, {
        workdir: this.options.request.workdir,
        permissions: this.options.request.permissions,
        shell: this.options.shell,
        signal: this.options.signal,
      })
    } catch (error: unknown) {
      outcome = {
        ok: false,
        content: `Erro ao executar ${tool.name}: ${error instanceof Error ? error.message : String(error)}`,
      }
    }

    this.events.push({
      type: 'tool_result',
      callId: call.id,
      ok: outcome.ok,
      summary: outcome.content.slice(0, 300),
    })
    if (outcome.changed !== undefined) {
      this.events.push({
        type: 'file_changed',
        path: outcome.changed,
        change: tool.name === 'write_file' ? 'create' : 'modify',
      })
    }
    return outcome
  }
}

function toTokenUsage(usage: ChatUsageLike | undefined): TokenUsage {
  if (usage === undefined) return EMPTY_USAGE
  const cached = usage.prompt_tokens_details?.cached_tokens ?? usage.cache_read_input_tokens ?? 0
  return {
    // `prompt_tokens` já inclui os cacheados na maioria dos servidores;
    // separamos para que o preço de cache seja aplicado corretamente.
    input: Math.max(0, (usage.prompt_tokens ?? 0) - cached),
    output: usage.completion_tokens ?? 0,
    cacheRead: cached,
    cacheWrite: usage.cache_creation_input_tokens ?? 0,
    reasoning: 0,
  }
}

interface ChatUsageLike {
  prompt_tokens?: number
  completion_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

export { usd }
