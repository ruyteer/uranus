import { readFile } from 'node:fs/promises'

/**
 * Repasse de atividade dos hooks do Claude Code pro dashboard do Uranus.
 *
 * Invocado pelo próprio Claude Code (`.claude/settings.json`, gerado por
 * `claude-bridge.ts`) como `uranus relay <evento>`, com o JSON do hook no
 * stdin. Regra inegociável: isto roda DENTRO do turno do usuário — qualquer
 * demora ou exceção aqui é uma sessão de trabalho travada por causa do
 * painel. Por isso: timeout curto em toda operação de I/O, `catch` em toda
 * função pública, nunca lança.
 *
 * O esquema exato do JSON do hook (e do transcript que `transcript_path`
 * aponta) não é um contrato público estável do Claude Code — este módulo lê
 * de forma defensiva e degrada para um resumo genérico quando não reconhece
 * o formato, em vez de falhar.
 */

export interface ActivityEntry {
  /** `UserPromptSubmit` | `Stop` | `SubagentStart` | `SubagentStop` — nome do hook do Claude Code, repassado como veio. */
  readonly event: string
  readonly summary: string
  readonly role?: 'user' | 'assistant'
  /** Vem do campo `agent_type` do hook (`SubagentStart`/`SubagentStop`) — não `subagent_type`, esse é só o parâmetro de entrada da ferramenta que despacha o subagente. */
  readonly agent?: string
  readonly sessionId?: string
}

const SUMMARY_MAX = 600

/** Lê o stdin do hook. Sem TTY presume pipe; com timeout para nunca travar. */
export async function readHookStdin(timeoutMs = 1000): Promise<string> {
  if (process.stdin.isTTY) return ''
  try {
    return await Promise.race([collectStdin(), timeoutAfter(timeoutMs, '')])
  } catch {
    return ''
  }
}

async function collectStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

function timeoutAfter<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(value)
    }, ms).unref()
  })
}

export async function buildActivityEntry(event: string, rawStdin: string): Promise<ActivityEntry> {
  const payload = parseRecord(rawStdin)
  const sessionId = stringField(payload, 'session_id')

  if (event === 'UserPromptSubmit') {
    const prompt = stringField(payload, 'prompt') ?? ''
    return {
      event,
      role: 'user',
      summary: truncate(prompt.trim() === '' ? '(prompt vazio)' : prompt),
      ...(sessionId === undefined ? {} : { sessionId }),
    }
  }

  if (event === 'SubagentStart') {
    // Campo real do hook nativo é `agent_type` — não `subagent_type` (esse é
    // só o parâmetro de ENTRADA da ferramenta Agent/Task, não o que o hook
    // devolve) nem `agent_name` (nome que este módulo chutou antes de checar
    // a documentação; nenhum dos dois existe no payload de verdade).
    const agent = stringField(payload, 'agent_type')
    return {
      event,
      role: 'assistant',
      summary: truncate(agent === undefined ? 'subagente iniciando' : `despachando ${agent}`),
      ...(agent === undefined ? {} : { agent }),
      ...(sessionId === undefined ? {} : { sessionId }),
    }
  }

  if (event === 'SubagentStop' || event === 'Stop') {
    const agent = stringField(payload, 'agent_type')
    const transcriptPath = stringField(payload, 'transcript_path')
    const text = await lastAssistantText(transcriptPath)
    const fallback =
      event === 'SubagentStop'
        ? `subagente terminou${agent === undefined ? '' : ` (${agent})`}`
        : 'o orquestrador pausou ou terminou o turno'
    return {
      event,
      role: 'assistant',
      summary: truncate(text ?? fallback),
      ...(agent === undefined ? {} : { agent }),
      ...(sessionId === undefined ? {} : { sessionId }),
    }
  }

  return { event, summary: event, ...(sessionId === undefined ? {} : { sessionId }) }
}

/**
 * Última mensagem do assistente no transcript, se der para achar.
 *
 * Varre de trás para frente, no máximo as últimas 30 linhas — o transcript
 * inteiro de uma sessão longa não precisa ser lido para achar a última fala.
 */
async function lastAssistantText(transcriptPath: string | undefined): Promise<string | undefined> {
  if (transcriptPath === undefined || transcriptPath === '') return undefined
  let raw: string | undefined
  try {
    raw = await Promise.race([readFile(transcriptPath, 'utf8'), timeoutAfter(500, undefined)])
  } catch {
    return undefined
  }
  if (raw === undefined) return undefined

  const lines = raw.split('\n').filter((line) => line.trim() !== '')
  const from = Math.max(0, lines.length - 30)
  for (let i = lines.length - 1; i >= from; i--) {
    const entry = parseRecord(lines[i] ?? '')
    const text = extractAssistantText(entry)
    if (text !== undefined && text.trim() !== '') return text
  }
  return undefined
}

/** Formato do transcript não é contrato público — tenta as formas conhecidas, sem lançar. */
function extractAssistantText(entry: Record<string, unknown>): string | undefined {
  const message = entry['message']
  const container = isRecord(message) ? message : entry
  const role = container['role'] ?? entry['type']
  if (role !== 'assistant') return undefined

  const content = container['content']
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    for (const block of content as readonly unknown[]) {
      if (isRecord(block) && block['type'] === 'text' && typeof block['text'] === 'string') {
        return block['text']
      }
    }
  }
  return undefined
}

export interface DashboardTarget {
  readonly host: string
  readonly port: number
  readonly token?: string
}

/** POST best-effort — falha silenciosa: o painel não estar de pé não é um erro do hook. */
export async function postActivity(entry: ActivityEntry, target: DashboardTarget): Promise<void> {
  const suffix = target.token === undefined ? '' : `?token=${encodeURIComponent(target.token)}`
  const url = `http://${target.host}:${String(target.port)}/api/claude-activity${suffix}`
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(entry),
      signal: AbortSignal.timeout(800),
    })
  } catch {
    /* dashboard fora do ar — o hook segue sem interromper a sessão */
  }
}

function truncate(text: string): string {
  return text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX)}…` : text
}

function parseRecord(raw: string): Record<string, unknown> {
  if (raw.trim() === '') return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
