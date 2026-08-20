import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { withTempDir } from '@uranus/testkit'
import {
  AGENT_CATALOG,
  MANAGED_BEGIN,
  MANAGED_END,
  agentFileName,
  defaultHooks,
  isUranusAgentFile,
  mergeManagedBlock,
  mergeSettingsJson,
  renderAgentFile,
  renderClaudeMdBody,
  writeClaudeConfig,
} from './claude-bridge.js'

describe('mergeManagedBlock — nunca apaga o que é do usuário', () => {
  it('sem CLAUDE.md prévio, cria só o bloco gerido', () => {
    const out = mergeManagedBlock(undefined, 'conteúdo gerado')
    expect(out).toContain(MANAGED_BEGIN)
    expect(out).toContain(MANAGED_END)
    expect(out).toContain('conteúdo gerado')
  })

  it('CLAUDE.md existente sem marcador: acrescenta no final, preserva tudo', () => {
    const original = '# Meu projeto\n\nRegras que eu escrevi à mão.\n'
    const out = mergeManagedBlock(original, 'bloco novo')
    expect(out).toContain('# Meu projeto')
    expect(out).toContain('Regras que eu escrevi à mão.')
    expect(out).toContain('bloco novo')
    expect(out.indexOf('Regras que eu escrevi à mão.')).toBeLessThan(out.indexOf(MANAGED_BEGIN))
  })

  it('CLAUDE.md com marcador: substitui só o miolo, preserva o que está fora', () => {
    const first = mergeManagedBlock(
      '# Antes do marcador\n\nTexto do usuário.\n',
      'versão 1 do bloco',
    )
    const withUserEditAfter = `${first}\n## Depois do marcador\n\nMais texto do usuário.\n`

    const second = mergeManagedBlock(withUserEditAfter, 'versão 2 do bloco')

    expect(second).toContain('# Antes do marcador')
    expect(second).toContain('Texto do usuário.')
    expect(second).toContain('## Depois do marcador')
    expect(second).toContain('Mais texto do usuário.')
    expect(second).toContain('versão 2 do bloco')
    expect(second).not.toContain('versão 1 do bloco')
  })

  it('é idempotente: aplicar duas vezes o mesmo corpo não duplica nada', () => {
    const once = mergeManagedBlock('# projeto\n', 'corpo')
    const twice = mergeManagedBlock(once, 'corpo')
    expect(twice.split(MANAGED_BEGIN)).toHaveLength(2)
    expect(twice.split(MANAGED_END)).toHaveLength(2)
  })
})

describe('mergeSettingsJson — funde hooks sem apagar o que o usuário configurou', () => {
  it('sem settings.json prévio, cria a partir do zero', () => {
    const out = JSON.parse(mergeSettingsJson(undefined, defaultHooks())) as Record<string, unknown>
    const hooks = out['hooks'] as Record<string, unknown>
    expect(Array.isArray(hooks['Stop'])).toBe(true)
  })

  it('registra o hook nativo SubagentStart (não PreToolUse com matcher de regex)', () => {
    const out = JSON.parse(mergeSettingsJson(undefined, defaultHooks())) as {
      hooks: { SubagentStart: { hooks: { command: string }[] }[] }
    }
    const commands = out.hooks.SubagentStart.flatMap((e) => e.hooks.map((h) => h.command))
    expect(commands.some((c) => c.includes('uranus relay SubagentStart'))).toBe(true)
  })

  it('preserva chaves e hooks de outra origem que já existiam', () => {
    const existing = JSON.stringify({
      model: 'opus',
      hooks: {
        Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'echo do-usuario' }] }],
      },
    })
    const out = JSON.parse(mergeSettingsJson(existing, defaultHooks())) as {
      model: string
      hooks: { Stop: { hooks: { command: string }[] }[] }
    }
    expect(out.model).toBe('opus')
    const commands = out.hooks.Stop.flatMap((entry) => entry.hooks.map((h) => h.command))
    expect(commands.some((c) => c.includes('echo do-usuario'))).toBe(true)
    expect(commands.some((c) => c.includes('uranus relay Stop'))).toBe(true)
  })

  it('reaplicar não duplica as entradas que o próprio Uranus escreveu', () => {
    const first = mergeSettingsJson(undefined, defaultHooks())
    const second = mergeSettingsJson(first, defaultHooks())
    const parsed = JSON.parse(second) as { hooks: { Stop: { hooks: { command: string }[] }[] } }
    const stopCommands = parsed.hooks.Stop.flatMap((e) => e.hooks.map((h) => h.command))
    expect(stopCommands.filter((c) => c.includes('uranus relay Stop'))).toHaveLength(1)
  })

  it('settings.json inválido/corrompido não quebra — trata como vazio', () => {
    const out = mergeSettingsJson('{ isto não é json', defaultHooks())
    expect(() => {
      JSON.parse(out)
    }).not.toThrow()
  })
})

describe('catálogo de agentes e arquivos', () => {
  it('todo id do catálogo vira uranus-<id>.md e passa em isUranusAgentFile', () => {
    for (const spec of AGENT_CATALOG) {
      const name = agentFileName(spec.id)
      expect(name).toBe(`uranus-${spec.id}.md`)
      expect(isUranusAgentFile(name)).toBe(true)
    }
  })

  it('arquivo escrito à mão pelo usuário nunca casa com o prefixo gerenciado', () => {
    expect(isUranusAgentFile('meu-agente-custom.md')).toBe(false)
  })

  it('renderAgentFile produz frontmatter válido com name/description/model', () => {
    const spec = AGENT_CATALOG[0]!
    const rendered = renderAgentFile(spec)
    expect(rendered).toMatch(/^---\n/)
    expect(rendered).toContain(`name: ${spec.id}`)
    expect(rendered).toContain(`model: ${spec.model}`)
  })

  it('todo modelo do catálogo é um tier válido do Claude Code', () => {
    for (const spec of AGENT_CATALOG) {
      expect(['haiku', 'sonnet', 'opus']).toContain(spec.model)
    }
  })

  it('não há dois agentes com o mesmo id', () => {
    const ids = AGENT_CATALOG.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('renderClaudeMdBody', () => {
  it('lista todos os agentes do catálogo na tabela', () => {
    const body = renderClaudeMdBody({ projectName: 'demo' })
    for (const spec of AGENT_CATALOG) {
      expect(body).toContain(`\`${spec.id}\``)
    }
  })

  it('deixa claro que não há verificação de código própria do Uranus', () => {
    const body = renderClaudeMdBody({ projectName: 'demo' })
    expect(body).not.toMatch(/advisory/i)
    expect(body).toMatch(/não roda verificação de código própria/i)
  })

  it('instrui a checar wikilinks contra uranus vault antes de considerar a memória pronta', () => {
    const body = renderClaudeMdBody({ projectName: 'demo' })
    expect(body).toContain('Links ainda sem nota correspondente')
    expect(body).toMatch(/título exato/i)
  })

  it('instrui a validar UI web de verdade com agent-browser', () => {
    const body = renderClaudeMdBody({ projectName: 'demo' })
    expect(body).toContain('## Testar UI no navegador (agent-browser)')
    expect(body).toContain('agent-browser install')
    expect(body).toContain('agent-browser snapshot -i')
  })

  it('sem instruções, não gera a seção', () => {
    expect(renderClaudeMdBody({ projectName: 'demo' })).not.toContain('## Instruções do projeto')
  })

  it('com instruções, cada uma vira um `###` com o corpo verbatim', () => {
    const body = renderClaudeMdBody({
      projectName: 'demo',
      instructions: [
        { title: 'Estilo de commit', body: 'Sempre em português.' },
        { title: 'Testes', body: 'Nunca pule um teste para fazer passar.' },
      ],
    })
    expect(body).toContain('## Instruções do projeto')
    expect(body).toContain('### Estilo de commit')
    expect(body).toContain('Sempre em português.')
    expect(body).toContain('### Testes')
    expect(body).toContain('Nunca pule um teste para fazer passar.')
  })
})

describe('writeClaudeConfig — instruções por escopo', () => {
  it('instrução sem escopo entra no CLAUDE.md da raiz', async () => {
    await withTempDir(async (dir) => {
      const result = await writeClaudeConfig({
        projectDir: dir,
        projectName: 'demo',
        instructions: [{ title: 'Regra geral', body: 'Vale para o repo inteiro.' }],
      })
      expect(result.wrote).toContain('CLAUDE.md')
      const root = await readFile(join(dir, 'CLAUDE.md'), 'utf8')
      expect(root).toContain('Regra geral')
      expect(root).toContain('Vale para o repo inteiro.')
    })
  })

  it('instrução com escopo vira CLAUDE.md dentro da pasta, sem entrar na raiz', async () => {
    await withTempDir(async (dir) => {
      const result = await writeClaudeConfig({
        projectDir: dir,
        projectName: 'demo',
        instructions: [
          { title: 'Regra geral', body: 'Vale para o repo inteiro.' },
          { title: 'Regra do backend', body: 'Só para packages/api.', scope: 'packages/api' },
        ],
      })
      expect(result.wrote).toContain('packages/api/CLAUDE.md')

      const root = await readFile(join(dir, 'CLAUDE.md'), 'utf8')
      expect(root).toContain('Regra geral')
      expect(root).not.toContain('Regra do backend')

      const scoped = await readFile(join(dir, 'packages', 'api', 'CLAUDE.md'), 'utf8')
      expect(scoped).toContain('Regra do backend')
      expect(scoped).toContain('Só para packages/api.')
      expect(scoped).not.toContain('Regra geral')
    })
  })

  it('reexecutar não duplica o bloco gerido no CLAUDE.md escopado', async () => {
    await withTempDir(async (dir) => {
      const options = {
        projectDir: dir,
        projectName: 'demo',
        instructions: [{ title: 'Regra', body: 'x', scope: 'packages/api' }],
      }
      await writeClaudeConfig(options)
      await writeClaudeConfig(options)
      const scoped = await readFile(join(dir, 'packages', 'api', 'CLAUDE.md'), 'utf8')
      expect(scoped.split(MANAGED_BEGIN)).toHaveLength(2)
    })
  })
})
