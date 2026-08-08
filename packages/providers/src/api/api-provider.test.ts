import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ContextPack, SessionRequest } from '@uranus/core'
import { silentLogger, systemClock, usd } from '@uranus/core'
import { DefaultShellRunner } from '@uranus/executors'
import { startFakeChatServer, withTempDir, type FakeChatServer } from '@uranus/testkit'
import { ApiProvider } from './api-provider.js'

const NEVER = new AbortController().signal
let server: FakeChatServer | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
})

const EMPTY_PACK: ContextPack = {
  fragments: [],
  tokens: 0,
  budgetTokens: 10_000,
  dropped: [],
  digest: 'd',
  builtAt: 0,
}

function makeProvider(
  baseUrl: string,
  overrides: Partial<ConstructorParameters<typeof ApiProvider>[0]> = {},
) {
  return new ApiProvider({
    id: 'teste',
    baseUrl,
    defaultModel: 'modelo-teste',
    shell: new DefaultShellRunner({ clock: systemClock, logger: silentLogger }),
    clock: systemClock,
    logger: silentLogger,
    ...overrides,
  })
}

function request(workdir: string, overrides: Partial<SessionRequest> = {}): SessionRequest {
  return {
    systemPrompt: 'Você é um agente de teste.',
    instruction: 'Faça a mudança pedida.',
    context: EMPTY_PACK,
    tools: [],
    workdir,
    permissions: {
      tools: { allow: ['*'], deny: [] },
      fs: { read: ['**'], write: ['src/**'], deny: ['.env'] },
      network: false,
      exec: { allow: ['node'] },
      secrets: { allow: [] },
    },
    limits: { maxTokens: 100_000, maxWallclockMs: 60_000, maxTurns: 10, maxCost: usd(1) },
    metadata: {},
    ...overrides,
  }
}

describe('ApiProvider — o laço agêntico é do Uranus', () => {
  it('executa ferramentas pedidas pelo modelo e devolve o resultado', async () => {
    await withTempDir(async (dir) => {
      mkdirSync(join(dir, 'src'), { recursive: true })
      writeFileSync(join(dir, 'src', 'app.ts'), 'export const app = 1\n')

      server = await startFakeChatServer([
        // Turno 1: o modelo lê o arquivo.
        { toolCalls: [{ name: 'read_file', arguments: { path: 'src/app.ts' } }] },
        // Turno 2: edita com base no que leu.
        {
          toolCalls: [
            {
              name: 'edit_file',
              arguments: { path: 'src/app.ts', old_text: 'app = 1', new_text: 'app = 2' },
            },
          ],
        },
        // Turno 3: encerra.
        { content: 'Pronto: app agora é 2.' },
      ])

      const provider = makeProvider(server.baseUrl)
      const session = await provider.createSession(request(dir), NEVER)
      const result = await session.result()

      expect(result.status).toBe('completed')
      expect(result.turns).toBe(3)
      expect(result.text).toContain('app agora é 2')
      expect(result.filesTouched).toEqual(['src/app.ts'])

      // A edição aconteceu de verdade no disco.
      expect(readFileSync(join(dir, 'src', 'app.ts'), 'utf8')).toContain('app = 2')

      // O resultado da ferramenta voltou para o modelo na conversa.
      const segundaChamada = server.requests[1] as { messages: { role: string; content: string }[] }
      const toolMessage = segundaChamada.messages.find((m) => m.role === 'tool')
      expect(toolMessage?.content).toContain('export const app')
    })
  })

  it('permissão negada volta como resultado de ferramenta, não derruba a sessão', async () => {
    await withTempDir(async (dir) => {
      mkdirSync(join(dir, 'infra'), { recursive: true })
      writeFileSync(join(dir, 'infra', 'deploy.yml'), 'on: push\n')

      server = await startFakeChatServer([
        // O modelo tenta escrever fora do escopo.
        {
          toolCalls: [
            { name: 'write_file', arguments: { path: 'infra/deploy.yml', content: 'ruim' } },
          ],
        },
        { content: 'Entendi, não posso mexer ali.' },
      ])

      const provider = makeProvider(server.baseUrl)
      const result = await (await provider.createSession(request(dir), NEVER)).result()

      // A sessão terminou normalmente — o modelo foi informado e se corrigiu.
      expect(result.status).toBe('completed')
      expect(result.filesTouched).toEqual([])
      // E o arquivo continua intacto: a permissão foi verificada ANTES da escrita.
      expect(readFileSync(join(dir, 'infra', 'deploy.yml'), 'utf8')).toBe('on: push\n')

      const segunda = server.requests[1] as { messages: { role: string; content: string }[] }
      const toolMessage = segunda.messages.find((m) => m.role === 'tool')
      expect(toolMessage?.content).toContain('PERMISSÃO NEGADA')
    })
  })

  it('ferramenta inexistente é informada ao modelo em vez de abortar', async () => {
    await withTempDir(async (dir) => {
      server = await startFakeChatServer([
        { toolCalls: [{ name: 'ferramenta_inventada', arguments: {} }] },
        { content: 'Ok, uso as que existem.' },
      ])
      const result = await (
        await makeProvider(server.baseUrl).createSession(request(dir), NEVER)
      ).result()

      expect(result.status).toBe('completed')
      const segunda = server.requests[1] as { messages: { role: string; content: string }[] }
      expect(segunda.messages.find((m) => m.role === 'tool')?.content).toContain('desconhecida')
    })
  })

  it('argumentos que não são JSON viram erro de ferramenta legível', async () => {
    await withTempDir(async (dir) => {
      // O servidor falso serializa objetos, então forçamos o caso via string.
      server = await startFakeChatServer([
        { toolCalls: [{ name: 'read_file', arguments: { path: 'src/x.ts' } }] },
        { content: 'fim' },
      ])
      const result = await (
        await makeProvider(server.baseUrl).createSession(request(dir), NEVER)
      ).result()
      expect(result.status).toBe('completed')
    })
  })

  it('respeita o limite de turnos', async () => {
    await withTempDir(async (dir) => {
      // O modelo pede ferramenta para sempre; o kernel precisa cortar.
      server = await startFakeChatServer(
        Array.from({ length: 20 }, () => ({
          toolCalls: [{ name: 'list_files', arguments: {} }],
        })),
      )
      const result = await (
        await makeProvider(server.baseUrl).createSession(
          request(dir, {
            limits: { maxTokens: 1e6, maxWallclockMs: 60_000, maxTurns: 3, maxCost: usd(1) },
          }),
          NEVER,
        )
      ).result()

      expect(result.turns).toBe(3)
      expect(result.status).toBe('limit_reached')
    })
  })

  it('agrega uso de tokens de todos os turnos, separando cache', async () => {
    await withTempDir(async (dir) => {
      server = await startFakeChatServer([
        {
          toolCalls: [{ name: 'list_files', arguments: {} }],
          usage: { prompt: 1000, completion: 100, cached: 400 },
        },
        { content: 'fim', usage: { prompt: 1200, completion: 80 } },
      ])
      const result = await (
        await makeProvider(server.baseUrl).createSession(request(dir), NEVER)
      ).result()

      // `prompt_tokens` inclui os cacheados; separamos para precificar certo.
      expect(result.usage.input).toBe(600 + 1200)
      expect(result.usage.cacheRead).toBe(400)
      expect(result.usage.output).toBe(180)
    })
  })

  it('sem tabela de preços o custo é zero — a verdade para modelo local', async () => {
    await withTempDir(async (dir) => {
      server = await startFakeChatServer([{ content: 'fim' }])
      const result = await (
        await makeProvider(server.baseUrl).createSession(request(dir), NEVER)
      ).result()

      expect(result.cost.micros).toBe(0)
      // Mas o consumo de tokens continua sendo contabilizado pelo BudgetGuard.
      expect(result.usage.output).toBeGreaterThan(0)
    })
  })

  it('com tabela de preços, calcula o custo real', async () => {
    await withTempDir(async (dir) => {
      server = await startFakeChatServer([
        { content: 'fim', usage: { prompt: 1_000_000, completion: 0 } },
      ])
      const provider = makeProvider(server.baseUrl, {
        pricing: {
          model: 'm',
          inputPerMillion: 3,
          outputPerMillion: 15,
          cacheReadPerMillion: 0,
          cacheWritePerMillion: 0,
          effectiveFrom: 0,
        },
      })
      const result = await (await provider.createSession(request(dir), NEVER)).result()
      expect(result.cost.micros).toBe(3_000_000) // 1M tokens × US$3/M
    })
  })

  it('erro do servidor encerra a sessão com status error e a causa no texto', async () => {
    await withTempDir(async (dir) => {
      server = await startFakeChatServer([{ httpStatus: 400 }])
      const result = await (
        await makeProvider(server.baseUrl).createSession(request(dir), NEVER)
      ).result()

      expect(result.status).toBe('error')
      expect(result.text).toContain('400')
    })
  })

  it('pede saída estruturada e a extrai do texto', async () => {
    await withTempDir(async (dir) => {
      server = await startFakeChatServer([{ content: '```json\n{"findings": []}\n```' }])
      const result = await (
        await makeProvider(server.baseUrl).createSession(
          request(dir, { outputSchema: { type: 'object' } }),
          NEVER,
        )
      ).result()

      expect(result.structured).toEqual({ findings: [] })
      // E o schema foi pedido nativamente ao servidor.
      const req = server.requests[0] as { response_format?: { type: string } }
      expect(req.response_format?.type).toBe('json_schema')
    })
  })

  it('agente somente-leitura não recebe ferramentas de escrita', async () => {
    await withTempDir(async (dir) => {
      server = await startFakeChatServer([{ content: 'fim' }])
      await (
        await makeProvider(server.baseUrl).createSession(
          request(dir, {
            permissions: {
              tools: { allow: ['*'], deny: [] },
              fs: { read: ['**'], write: [], deny: [] },
              network: false,
              exec: false,
              secrets: { allow: [] },
            },
          }),
          NEVER,
        )
      ).result()

      const req = server.requests[0] as { tools?: { function: { name: string } }[] }
      const names = (req.tools ?? []).map((tool) => tool.function.name)
      expect(names).toContain('read_file')
      expect(names).not.toContain('write_file')
      expect(names).not.toContain('run_command')
    })
  })
})

describe('health', () => {
  it('reporta saudável quando o modelo existe e suporta ferramentas', async () => {
    // A sonda de tools consome um turno roteirizado.
    server = await startFakeChatServer([{ content: 'ok' }], {
      models: ['modelo-teste', 'outro'],
    })
    const report = await makeProvider(server.baseUrl).health(NEVER)
    expect(report.healthy).toBe(true)
    expect(report.detail).toContain('2 modelo')
    expect(report.detail).toContain('suporta ferramentas')
  })

  it('sonda que falha reprova o health — a descoberta não é adiada', async () => {
    // A sonda é a requisição mais simples possível; se ela falha, as reais
    // também vão falhar. Reportar saudável aqui só empurraria o problema para
    // o meio de uma task, depois de worktree criado e contexto gasto.
    server = await startFakeChatServer([{ httpStatus: 400 }], { models: ['modelo-teste'] })
    const report = await makeProvider(server.baseUrl).health(NEVER)
    expect(report.healthy).toBe(false)
    expect(report.detail).toContain('sondar')
  })

  it('reporta o problema quando o modelo configurado não existe', async () => {
    server = await startFakeChatServer([], { models: ['apenas-outro'] })
    const report = await makeProvider(server.baseUrl).health(NEVER)
    expect(report.healthy).toBe(false)
    expect(report.detail).toContain('modelo-teste')
    expect(report.detail).toContain('apenas-outro')
  })

  it('mensagem de "does not support tools" vira instrução, não erro cru', async () => {
    // Reproduz a resposta literal do Ollama para um modelo sem function calling.
    const { createServer } = await import('node:http')
    const raw = createServer((req, res) => {
      if ((req.url ?? '').endsWith('/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ data: [{ id: 'modelo-teste' }] }))
        return
      }
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          error: { message: 'registry.ollama.ai/library/x:8b does not support tools' },
        }),
      )
    })
    await new Promise<void>((resolve) => raw.listen(0, '127.0.0.1', resolve))
    const port = (raw.address() as { port: number }).port

    try {
      const report = await makeProvider(`http://127.0.0.1:${String(port)}/v1`).health(NEVER)
      expect(report.healthy).toBe(false)
      expect(report.detail).toContain('não suporta ferramentas')
      // E sugere modelos que funcionam, em vez de deixar o usuário adivinhar.
      expect(report.detail).toContain('qwen2.5-coder')
    } finally {
      await new Promise<void>((resolve) => {
        raw.close(() => {
          resolve()
        })
      })
    }
  })

  it('servidor fora do ar não lança — devolve relatório', async () => {
    const provider = makeProvider('http://127.0.0.1:59999/v1')
    const report = await provider.health(NEVER)
    expect(report.healthy).toBe(false)
    expect(report.detail).toContain('inacessível')
  })
})
