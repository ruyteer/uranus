import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildActivityEntry } from './relay.js'

const dirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'uranus-relay-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('buildActivityEntry', () => {
  it('UserPromptSubmit vira uma entrada de role "user" com o prompt', async () => {
    const entry = await buildActivityEntry(
      'UserPromptSubmit',
      JSON.stringify({ prompt: 'implemente o item X', session_id: 's1' }),
    )
    expect(entry).toEqual({
      event: 'UserPromptSubmit',
      role: 'user',
      summary: 'implemente o item X',
      sessionId: 's1',
    })
  })

  it('prompt vazio ainda produz uma entrada legível', async () => {
    const entry = await buildActivityEntry('UserPromptSubmit', JSON.stringify({ prompt: '' }))
    expect(entry.summary).toBe('(prompt vazio)')
  })

  it('SubagentStop sem transcript cai no resumo genérico com o nome do agente', async () => {
    const entry = await buildActivityEntry(
      'SubagentStop',
      JSON.stringify({ agent_type: 'reviewer' }),
    )
    expect(entry.role).toBe('assistant')
    expect(entry.agent).toBe('reviewer')
    expect(entry.summary).toContain('reviewer')
  })

  it('SubagentStop ignora subagent_type/agent_name — não são os campos reais do hook', async () => {
    const entry = await buildActivityEntry('SubagentStop', JSON.stringify({ subagent_type: 'reviewer' }))
    expect(entry.agent).toBeUndefined()
  })

  it('SubagentStop com transcript extrai a última fala do assistente (formato message.content[])', async () => {
    const dir = await tempDir()
    const transcriptPath = join(dir, 'transcript.jsonl')
    await writeFile(
      transcriptPath,
      [
        JSON.stringify({ message: { role: 'user', content: 'oi' } }),
        JSON.stringify({
          message: { role: 'assistant', content: [{ type: 'text', text: 'terminei a subtask X' }] },
        }),
      ].join('\n'),
      'utf8',
    )
    const entry = await buildActivityEntry(
      'SubagentStop',
      JSON.stringify({ agent_type: 'backend', transcript_path: transcriptPath }),
    )
    expect(entry.summary).toBe('terminei a subtask X')
  })

  it('transcript com role em string simples (message.content string) também funciona', async () => {
    const dir = await tempDir()
    const transcriptPath = join(dir, 'transcript.jsonl')
    await writeFile(
      transcriptPath,
      JSON.stringify({ role: 'assistant', content: 'resposta direta' }),
      'utf8',
    )
    const entry = await buildActivityEntry('Stop', JSON.stringify({ transcript_path: transcriptPath }))
    expect(entry.summary).toBe('resposta direta')
  })

  it('transcript inexistente não lança — cai no resumo genérico', async () => {
    const entry = await buildActivityEntry(
      'Stop',
      JSON.stringify({ transcript_path: join(await tempDir(), 'nao-existe.jsonl') }),
    )
    expect(entry.summary).toBe('o orquestrador pausou ou terminou o turno')
  })

  it('stdin vazio ou JSON inválido nunca lança', async () => {
    await expect(buildActivityEntry('Stop', '')).resolves.toBeDefined()
    await expect(buildActivityEntry('Stop', '{ não é json')).resolves.toBeDefined()
  })

  it('evento desconhecido ainda produz uma entrada', async () => {
    const entry = await buildActivityEntry('Notification', '{}')
    expect(entry).toEqual({ event: 'Notification', summary: 'Notification' })
  })

  it('SubagentStart (hook nativo) vira entrada com o agent_type', async () => {
    const entry = await buildActivityEntry(
      'SubagentStart',
      JSON.stringify({ agent_type: 'backend', session_id: 's1' }),
    )
    expect(entry).toEqual({
      event: 'SubagentStart',
      role: 'assistant',
      agent: 'backend',
      sessionId: 's1',
      summary: 'despachando backend',
    })
  })

  it('SubagentStart sem agent_type ainda produz uma entrada legível, sem campo agent', async () => {
    const entry = await buildActivityEntry('SubagentStart', '{}')
    expect(entry.agent).toBeUndefined()
    expect(entry.summary).toBe('subagente iniciando')
  })
})
