import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * Servidor de chat compatível com OpenAI, para testar o `ApiProvider` sem
 * rede externa e sem custo.
 *
 * Roteiriza respostas em sequência, exatamente como um modelo real responderia:
 * primeiro pedindo ferramentas, depois entregando o texto final. É o que
 * permite exercitar o laço agêntico inteiro de forma determinística.
 */

export interface ScriptedChatTurn {
  /** Chamadas de ferramenta que o "modelo" pede neste turno. */
  readonly toolCalls?: readonly { name: string; arguments: Record<string, unknown> }[]
  /** Texto do assistente. Sem `toolCalls`, encerra a sessão. */
  readonly content?: string
  readonly finishReason?: 'stop' | 'length' | 'tool_calls'
  readonly usage?: { prompt: number; completion: number; cached?: number }
  /** Força um status HTTP de erro neste turno. */
  readonly httpStatus?: number
  readonly retryAfterSeconds?: number
}

export interface FakeChatServer {
  readonly baseUrl: string
  /** Requisições recebidas, para asserção. */
  readonly requests: readonly Record<string, unknown>[]
  /** Quantas vezes `/chat/completions` foi chamado. */
  readonly callCount: number
  close(): Promise<void>
}

export async function startFakeChatServer(
  turns: readonly ScriptedChatTurn[],
  options: { models?: readonly string[] } = {},
): Promise<FakeChatServer> {
  const requests: Record<string, unknown>[] = []
  let cursor = 0

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const url = req.url ?? ''

      if (url.endsWith('/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            data: (options.models ?? ['modelo-teste']).map((id) => ({ id })),
          }),
        )
        return
      }

      if (!url.endsWith('/chat/completions')) {
        res.writeHead(404).end('{}')
        return
      }

      try {
        requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>)
      } catch {
        requests.push({})
      }

      const turn = turns[cursor] ?? { content: 'Sem mais respostas roteirizadas.' }
      cursor++

      if (turn.httpStatus !== undefined) {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (turn.retryAfterSeconds !== undefined) {
          headers['Retry-After'] = String(turn.retryAfterSeconds)
        }
        res.writeHead(turn.httpStatus, headers)
        res.end(JSON.stringify({ error: { message: 'erro roteirizado' } }))
        return
      }

      const toolCalls = (turn.toolCalls ?? []).map((call, index) => ({
        id: `call_${String(cursor)}_${String(index)}`,
        type: 'function' as const,
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      }))

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          id: `chatcmpl-${String(cursor)}`,
          model: 'modelo-teste',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: turn.content ?? null,
                ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
              },
              finish_reason: turn.finishReason ?? (toolCalls.length > 0 ? 'tool_calls' : 'stop'),
            },
          ],
          usage: {
            prompt_tokens: turn.usage?.prompt ?? 100,
            completion_tokens: turn.usage?.completion ?? 50,
            ...(turn.usage?.cached === undefined
              ? {}
              : { prompt_tokens_details: { cached_tokens: turn.usage.cached } }),
          },
        }),
      )
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port

  return {
    baseUrl: `http://127.0.0.1:${String(port)}/v1`,
    get requests() {
      return requests
    },
    get callCount() {
      return cursor
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
      }),
  }
}
