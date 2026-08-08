import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PermissionSet } from '@uranus/core'
import { silentLogger, systemClock } from '@uranus/core'
import { DefaultShellRunner } from '@uranus/executors'
import { withTempDir } from '@uranus/testkit'
import {
  DEFAULT_FILE_TOOLS,
  editFileTool,
  listFilesTool,
  readFileTool,
  runCommandTool,
  toolsForPermissions,
  writeFileTool,
  type ToolContext,
} from './file-tools.js'

const NEVER = new AbortController().signal

/** Permissões típicas de um Executor com escopo em `src/`. */
function permissions(overrides: Partial<PermissionSet> = {}): PermissionSet {
  return {
    tools: { allow: ['*'], deny: [] },
    fs: { read: ['**'], write: ['src/**'], deny: ['.env', '.git/**'] },
    network: false,
    exec: { allow: ['node'] },
    secrets: { allow: [] },
    ...overrides,
  }
}

function context(workdir: string, perms = permissions()): ToolContext {
  return {
    workdir,
    permissions: perms,
    shell: new DefaultShellRunner({ clock: systemClock, logger: silentLogger }),
    signal: NEVER,
  }
}

function setup(dir: string): void {
  mkdirSync(join(dir, 'src'), { recursive: true })
  mkdirSync(join(dir, 'infra'), { recursive: true })
  writeFileSync(join(dir, 'src', 'app.ts'), 'export const app = 1\n')
  writeFileSync(join(dir, 'infra', 'deploy.yml'), 'on: push\n')
  writeFileSync(join(dir, '.env'), 'SECRET=nao-vaza\n')
}

describe('read_file', () => {
  it('lê arquivo dentro do escopo de leitura', async () => {
    await withTempDir(async (dir) => {
      setup(dir)
      const result = await readFileTool.execute({ path: 'src/app.ts' }, context(dir))
      expect(result.ok).toBe(true)
      expect(result.content).toContain('export const app')
    })
  })

  it('nega leitura de caminho em deny (INV-5)', async () => {
    await withTempDir(async (dir) => {
      setup(dir)
      const result = await readFileTool.execute({ path: '.env' }, context(dir))
      expect(result.ok).toBe(false)
      expect(result.content).toContain('PERMISSÃO NEGADA')
      // O conteúdo do segredo nunca chega ao modelo.
      expect(result.content).not.toContain('nao-vaza')
    })
  })

  it('nega escape do workspace por caminho relativo', async () => {
    await withTempDir(async (dir) => {
      setup(dir)
      for (const escape of ['../fora.txt', '../../etc/passwd', 'src/../../fuga']) {
        const result = await readFileTool.execute({ path: escape }, context(dir))
        expect(result.ok, `deveria negar: ${escape}`).toBe(false)
        expect(result.content).toContain('fora do workspace')
      }
    })
  })

  it('arquivo inexistente devolve erro legível, não exceção', async () => {
    await withTempDir(async (dir) => {
      setup(dir)
      const result = await readFileTool.execute({ path: 'src/nada.ts' }, context(dir))
      expect(result.ok).toBe(false)
      expect(result.content).toContain('não encontrado')
    })
  })

  it('parâmetro ausente é erro de ferramenta, não crash', async () => {
    await withTempDir(async (dir) => {
      const result = await readFileTool.execute({}, context(dir))
      expect(result.ok).toBe(false)
      expect(result.content).toContain('obrigatório')
    })
  })
})

describe('write_file', () => {
  it('escreve dentro do escopo e reporta o arquivo alterado', async () => {
    await withTempDir(async (dir) => {
      setup(dir)
      const result = await writeFileTool.execute(
        { path: 'src/novo.ts', content: 'export const novo = 2\n' },
        context(dir),
      )
      expect(result.ok).toBe(true)
      expect(result.changed).toBe('src/novo.ts')
      expect(readFileSync(join(dir, 'src', 'novo.ts'), 'utf8')).toContain('novo = 2')
    })
  })

  it('NEGA escrita fora do escopo declarado da task (INV-5)', async () => {
    await withTempDir(async (dir) => {
      setup(dir)
      // Este é o teste central do ApiProvider: a permissão é verificada ANTES
      // da escrita, não descoberta depois pelo DiffCheck.
      const result = await writeFileTool.execute(
        { path: 'infra/deploy.yml', content: 'malicioso' },
        context(dir),
      )
      expect(result.ok).toBe(false)
      expect(result.content).toContain('PERMISSÃO NEGADA')
      // E o arquivo continua intacto.
      expect(readFileSync(join(dir, 'infra', 'deploy.yml'), 'utf8')).toBe('on: push\n')
    })
  })

  it('cria diretórios intermediários', async () => {
    await withTempDir(async (dir) => {
      setup(dir)
      const result = await writeFileTool.execute(
        { path: 'src/a/b/c.ts', content: 'x' },
        context(dir),
      )
      expect(result.ok).toBe(true)
      expect(readFileSync(join(dir, 'src', 'a', 'b', 'c.ts'), 'utf8')).toBe('x')
    })
  })
})

describe('edit_file', () => {
  it('substitui trecho único', async () => {
    await withTempDir(async (dir) => {
      setup(dir)
      const result = await editFileTool.execute(
        { path: 'src/app.ts', old_text: 'app = 1', new_text: 'app = 2' },
        context(dir),
      )
      expect(result.ok).toBe(true)
      expect(readFileSync(join(dir, 'src', 'app.ts'), 'utf8')).toContain('app = 2')
    })
  })

  it('recusa trecho ambíguo em vez de escolher a primeira ocorrência', async () => {
    await withTempDir(async (dir) => {
      setup(dir)
      writeFileSync(join(dir, 'src', 'app.ts'), 'const x = 1\nconst x = 1\n')
      const result = await editFileTool.execute(
        { path: 'src/app.ts', old_text: 'const x = 1', new_text: 'const y = 2' },
        context(dir),
      )
      // Substituir "a primeira" produziria edição silenciosamente errada.
      expect(result.ok).toBe(false)
      expect(result.content).toContain('2 vezes')
      expect(readFileSync(join(dir, 'src', 'app.ts'), 'utf8')).toBe('const x = 1\nconst x = 1\n')
    })
  })

  it('trecho inexistente instrui o modelo a ler antes', async () => {
    await withTempDir(async (dir) => {
      setup(dir)
      const result = await editFileTool.execute(
        { path: 'src/app.ts', old_text: 'não existe', new_text: 'x' },
        context(dir),
      )
      expect(result.ok).toBe(false)
      expect(result.content).toContain('Leia o arquivo antes')
    })
  })

  it('respeita o escopo de escrita', async () => {
    await withTempDir(async (dir) => {
      setup(dir)
      const result = await editFileTool.execute(
        { path: 'infra/deploy.yml', old_text: 'on: push', new_text: 'on: nada' },
        context(dir),
      )
      expect(result.ok).toBe(false)
      expect(result.content).toContain('PERMISSÃO NEGADA')
    })
  })
})

describe('list_files', () => {
  it('lista e marca diretórios, escondendo infraestrutura do harness', async () => {
    await withTempDir(async (dir) => {
      setup(dir)
      mkdirSync(join(dir, 'node_modules'), { recursive: true })
      mkdirSync(join(dir, '.uranus'), { recursive: true })

      const result = await listFilesTool.execute({}, context(dir))
      expect(result.ok).toBe(true)
      expect(result.content).toContain('src/')
      expect(result.content).not.toContain('node_modules')
      expect(result.content).not.toContain('.uranus')
    })
  })
})

describe('run_command', () => {
  it('executa comando permitido e devolve saída com exit code', async () => {
    await withTempDir(async (dir) => {
      setup(dir)
      const result = await runCommandTool.execute(
        { command: 'node -e "console.log(1+1)"' },
        context(dir),
      )
      expect(result.ok).toBe(true)
      expect(result.content).toContain('exit 0')
      expect(result.content).toContain('2')
    })
  })

  it('exit != 0 NÃO é falha de ferramenta — o modelo precisa ver a saída', async () => {
    await withTempDir(async (dir) => {
      setup(dir)
      const result = await runCommandTool.execute(
        { command: 'node -e "console.error(\'quebrou\'); process.exit(3)"' },
        context(dir),
      )
      // A ferramenta funcionou: ela rodou o comando. Falha seria não rodar.
      expect(result.ok).toBe(true)
      expect(result.content).toContain('exit 3')
      expect(result.content).toContain('quebrou')
    })
  })

  it('nega comando fora da allowlist', async () => {
    await withTempDir(async (dir) => {
      setup(dir)
      const result = await runCommandTool.execute({ command: 'rm -rf /' }, context(dir))
      expect(result.ok).toBe(false)
      expect(result.content).toContain('PERMISSÃO NEGADA')
    })
  })

  it('nega tudo quando exec está desligado', async () => {
    await withTempDir(async (dir) => {
      setup(dir)
      const readOnly = context(dir, permissions({ exec: false }))
      const result = await runCommandTool.execute({ command: 'node -v' }, readOnly)
      expect(result.ok).toBe(false)
      expect(result.content).toContain('desligada')
    })
  })
})

describe('toolsForPermissions', () => {
  it('agente somente-leitura não recebe ferramentas de escrita nem exec', () => {
    const readOnly = permissions({
      fs: { read: ['**'], write: [], deny: [] },
      exec: false,
    })
    const tools = toolsForPermissions(DEFAULT_FILE_TOOLS, readOnly).map((tool) => tool.name)

    expect(tools).toContain('read_file')
    expect(tools).toContain('list_files')
    expect(tools).not.toContain('write_file')
    expect(tools).not.toContain('edit_file')
    expect(tools).not.toContain('run_command')
  })

  it('agente completo recebe tudo', () => {
    const tools = toolsForPermissions(DEFAULT_FILE_TOOLS, permissions()).map((tool) => tool.name)
    expect(tools).toHaveLength(DEFAULT_FILE_TOOLS.length)
  })

  it('deny explícito remove a ferramenta mesmo com permissão de escrita', () => {
    const perms = permissions({ tools: { allow: ['*'], deny: ['run_command'] } })
    const tools = toolsForPermissions(DEFAULT_FILE_TOOLS, perms).map((tool) => tool.name)
    expect(tools).not.toContain('run_command')
    expect(tools).toContain('write_file')
  })
})
