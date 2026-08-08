import type { JsonSchema } from '@uranus/core'
import { tryParseJson } from '@uranus/core'

/**
 * Saída estruturada em providers que não a suportam nativamente (CLIs).
 *
 * A abordagem é honesta sobre o que garante: pedimos JSON no prompt e extraímos
 * do texto final. Isso NÃO garante conformidade — por isso todo agente com
 * `outputs.schema` carrega um `SchemaCheck` no contrato de aceite. O parse aqui
 * é melhor-esforço; a validação é o árbitro (INV-2).
 */

const JSON_INSTRUCTION_HEADER =
  '## Formato obrigatório da resposta\n\n' +
  'Sua resposta final deve conter EXCLUSIVAMENTE um bloco de código JSON, sem texto antes ou depois:\n\n' +
  '```json\n{ ... }\n```\n\n' +
  'O JSON deve validar contra este JSON Schema:\n\n'

export function appendSchemaInstruction(instruction: string, schema: JsonSchema): string {
  return `${instruction}\n\n${JSON_INSTRUCTION_HEADER}\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``
}

/**
 * Extrai JSON do texto do modelo. Tenta, em ordem: bloco ```json, bloco ```
 * genérico, e o maior objeto balanceado no texto. Retorna `undefined` quando
 * não há JSON reconhecível — o que reprova o `SchemaCheck` com mensagem clara.
 */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n```/g
  const blocks: string[] = []
  for (const match of text.matchAll(fenced)) blocks.push(match[1]!)

  // Do último para o primeiro: se o modelo mostrou rascunhos, o final é o bom.
  for (const block of blocks.reverse()) {
    const parsed = tryParseJson(block.trim())
    if (parsed !== undefined) return parsed
  }

  const balanced = extractBalancedObject(text)
  return balanced === undefined ? undefined : tryParseJson(balanced)
}

function extractBalancedObject(text: string): string | undefined {
  const start = text.indexOf('{')
  if (start < 0) return undefined

  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < text.length; index++) {
    const char = text[index]!
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (char === '{') depth++
    else if (char === '}') {
      depth--
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  return undefined
}
