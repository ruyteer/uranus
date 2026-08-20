import type { ChatToolCall } from './chat-types.js'

/**
 * Recupera chamadas de ferramenta que o servidor devolveu como TEXTO.
 *
 * Vários modelos locais decidem corretamente chamar a ferramenta e emitem o
 * JSON certo, mas o template do servidor não converte isso no campo
 * `tool_calls` da resposta. Observado com `qwen2.5-coder` (7b e 14b) no Ollama,
 * inclusive com `tool_choice: "required"`:
 *
 *     "message": {
 *       "role": "assistant",
 *       "content": "```json\n{\"name\": \"edit_file\", \"arguments\": {...}}\n```",
 *       "tool_calls": null            ← o laço de ferramentas não vê nada
 *     }
 *
 * Para o `ApiProvider` isso é indistinguível de "o modelo terminou e não quer
 * ferramenta nenhuma": a sessão encerra sem tocar em arquivo algum. O sintoma
 * que o usuário vê é "o modelo não edita arquivos" — quando na verdade ele
 * pediu para editar e ninguém escutou.
 *
 * A recuperação é deliberadamente conservadora. O risco oposto — inventar uma
 * chamada de ferramenta a partir de um texto qualquer — é pior que não
 * recuperar, porque produziria escrita em disco que o modelo não pediu. Por
 * isso o filtro mais forte não é sintático: **o nome precisa ser de uma
 * ferramenta que existe nesta sessão**. Um gate que devolve `{"findings": []}`
 * não tem campo `name`, e mesmo que tivesse, `findings` não é ferramenta.
 */

/** Formatos aceitos, do mais comum para o menos. */
interface RawCall {
  readonly name: string
  readonly args: unknown
}

/** Remove cercas markdown (```json … ```) preservando o miolo. */
function stripFences(text: string): string {
  const fenced = /```(?:json|tool_call|[a-z]*)?\s*\n?([\s\S]*?)```/i.exec(text)
  return (fenced?.[1] ?? text).trim()
}

function asRawCall(value: unknown): RawCall | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>

  // Alguns templates aninham em `function`, espelhando o formato da OpenAI.
  const inner = record['function']
  if (typeof inner === 'object' && inner !== null) return asRawCall(inner)

  const name = record['name']
  if (typeof name !== 'string' || name === '') return undefined

  // `arguments` é o nome canônico; `parameters` e `input` aparecem em
  // templates que copiaram o vocabulário do schema em vez do da chamada.
  const args = record['arguments'] ?? record['parameters'] ?? record['input'] ?? {}
  return { name, args }
}

/** `arguments` chega ora como objeto, ora como string JSON. Normaliza para string. */
function argsToString(args: unknown): string {
  if (typeof args === 'string') {
    const trimmed = args.trim()
    // Já é JSON: repassa como veio, para não reserializar e perder precisão.
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return trimmed
    return JSON.stringify({ value: args })
  }
  try {
    return JSON.stringify(args ?? {})
  } catch {
    return '{}'
  }
}

/**
 * Extrai chamadas de ferramenta do texto, aceitando só nomes conhecidos.
 *
 * @param content texto do `message.content`
 * @param knownTools nomes registrados nesta sessão
 * @param idPrefix para gerar `tool_call_id` estáveis e rastreáveis
 */
export function recoverToolCalls(
  content: string | null,
  knownTools: readonly string[],
  idPrefix: string,
): readonly ChatToolCall[] {
  if (content === null) return []
  const text = stripFences(content)
  if (text === '') return []
  if (!text.startsWith('{') && !text.startsWith('[')) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }

  const known = new Set(knownTools)
  const candidates = Array.isArray(parsed) ? parsed : [parsed]
  const calls: ChatToolCall[] = []

  for (const candidate of candidates) {
    const raw = asRawCall(candidate)
    if (raw === undefined) continue
    // O filtro que torna a recuperação segura.
    if (!known.has(raw.name)) continue
    calls.push({
      id: `${idPrefix}_rec_${String(calls.length + 1)}`,
      type: 'function',
      function: { name: raw.name, arguments: argsToString(raw.args) },
    })
  }

  return calls
}
