import { describe, expect, it } from 'vitest'
import { recoverToolCalls } from './tool-call-recovery.js'

const TOOLS = ['read_file', 'edit_file', 'write_file', 'list_files', 'run_command']

function recover(content: string | null): readonly { name: string; args: unknown }[] {
  return recoverToolCalls(content, TOOLS, 'sess').map((call) => ({
    name: call.function.name,
    args: JSON.parse(call.function.arguments) as unknown,
  }))
}

describe('recoverToolCalls', () => {
  it('recupera a resposta real do qwen2.5-coder:7b (cercada em markdown)', () => {
    // Capturado de um Ollama de verdade, com tool_choice: "required".
    const content =
      '```json\n{"name": "edit_file", "arguments": {"path": "src/app.js", "old_text": "", "new_text": "export function soma(a, b) {\\n  return a + b;\\n}"}} \n```'
    expect(recover(content)).toEqual([
      {
        name: 'edit_file',
        args: {
          path: 'src/app.js',
          old_text: '',
          new_text: 'export function soma(a, b) {\n  return a + b;\n}',
        },
      },
    ])
  })

  it('recupera a resposta real do qwen2.5-coder:14b (JSON puro)', () => {
    const content =
      '{\n  "name": "edit_file",\n  "arguments": {\n    "path": "src/app.js",\n    "old_text": "",\n    "new_text": "export function soma(a, b) { return a + b; }"\n  }\n}'
    expect(recover(content)[0]?.name).toBe('edit_file')
  })

  it('recupera chamada sem cerca e sem quebras', () => {
    expect(recover('{"name":"read_file","arguments":{"path":"a.ts"}}')).toEqual([
      { name: 'read_file', args: { path: 'a.ts' } },
    ])
  })

  // ── O que NÃO pode ser recuperado ────────────────────────────────────────

  it('ignora nome que não é ferramenta desta sessão', () => {
    // O filtro que torna a recuperação segura: sem ele, qualquer JSON com um
    // campo `name` viraria escrita em disco não pedida.
    expect(recover('{"name":"rm_rf","arguments":{"path":"/"}}')).toEqual([])
  })

  it('ignora a saída estruturada de um gate', () => {
    // Este é o falso positivo que mais custaria: gates devolvem findings, e
    // um deles podendo virar `write_file` seria desastroso.
    const findings =
      '{"findings":[{"severity":"high","category":"sql-injection","title":"Injeção","detail":"..."}]}'
    expect(recover(findings)).toEqual([])
  })

  it('ignora findings que por acaso tenham um campo `name`', () => {
    expect(recover('{"name":"findings","arguments":{"x":1}}')).toEqual([])
  })

  it('ignora prosa', () => {
    expect(recover('Editei o arquivo src/app.js e adicionei a função soma.')).toEqual([])
    expect(recover('')).toEqual([])
    expect(recover(null)).toEqual([])
  })

  it('ignora JSON malformado', () => {
    expect(recover('{"name":"edit_file","arguments":{')).toEqual([])
  })

  it('ignora texto que só menciona uma ferramenta', () => {
    expect(recover('Vou usar edit_file para isso.')).toEqual([])
  })

  // ── Variações de formato ─────────────────────────────────────────────────

  it('aceita `arguments` como string JSON', () => {
    expect(recover('{"name":"read_file","arguments":"{\\"path\\":\\"a.ts\\"}"}')).toEqual([
      { name: 'read_file', args: { path: 'a.ts' } },
    ])
  })

  it('aceita `parameters` e `input` como sinônimos de `arguments`', () => {
    expect(recover('{"name":"read_file","parameters":{"path":"a.ts"}}')[0]?.args).toEqual({
      path: 'a.ts',
    })
    expect(recover('{"name":"read_file","input":{"path":"b.ts"}}')[0]?.args).toEqual({
      path: 'b.ts',
    })
  })

  it('aceita o aninhamento em `function`, como no formato da OpenAI', () => {
    expect(recover('{"function":{"name":"read_file","arguments":{"path":"a.ts"}}}')).toEqual([
      { name: 'read_file', args: { path: 'a.ts' } },
    ])
  })

  it('aceita várias chamadas num array', () => {
    const content =
      '[{"name":"read_file","arguments":{"path":"a.ts"}},{"name":"read_file","arguments":{"path":"b.ts"}}]'
    expect(recover(content)).toHaveLength(2)
  })

  it('filtra os desconhecidos e mantém os válidos do mesmo array', () => {
    const content =
      '[{"name":"read_file","arguments":{"path":"a.ts"}},{"name":"inventada","arguments":{}}]'
    expect(recover(content)).toEqual([{ name: 'read_file', args: { path: 'a.ts' } }])
  })

  it('chamada sem argumentos vira objeto vazio, não erro', () => {
    expect(recover('{"name":"list_files"}')).toEqual([{ name: 'list_files', args: {} }])
  })

  it('gera ids distintos por chamada', () => {
    const calls = recoverToolCalls(
      '[{"name":"read_file","arguments":{"path":"a"}},{"name":"read_file","arguments":{"path":"b"}}]',
      TOOLS,
      'sess',
    )
    expect(new Set(calls.map((c) => c.id)).size).toBe(2)
  })

  it('sem ferramentas registradas, não recupera nada', () => {
    expect(recoverToolCalls('{"name":"edit_file","arguments":{}}', [], 'sess')).toEqual([])
  })
})
