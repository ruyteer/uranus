import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PermissionSet, ShellRunner, ToolDescriptor } from '@uranus/core'
import { isAllowed, isWithin, relativeWithin, toPosix, truncateMiddle } from '@uranus/core'

/**
 * Ferramentas de arquivo para o `ApiProvider`.
 *
 * A diferença estrutural para o `CliProvider` está aqui: com um CLI agêntico, o
 * modelo edita arquivos por conta própria e o Uranus só observa o resultado via
 * `git diff`. Com a API, CADA chamada de ferramenta passa por este código —
 * então a permissão é verificada antes de qualquer escrita, e não depois.
 *
 * Isso torna o `ApiProvider` estritamente mais seguro que o CLI: o INV-5 deixa
 * de depender do mapeamento correto para `--allowedTools` e passa a ser
 * verificado a cada operação, com o caminho já resolvido.
 */

export interface ToolContext {
  readonly workdir: string
  readonly permissions: PermissionSet
  readonly shell: ShellRunner
  readonly signal: AbortSignal
}

export interface ToolResult {
  readonly ok: boolean
  readonly content: string
  /** Caminho relativo alterado, quando houve escrita. */
  readonly changed?: string
}

export interface FileTool extends ToolDescriptor {
  execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult>
}

const MAX_READ_CHARS = 60_000
const MAX_OUTPUT_CHARS = 20_000

/** Resolve e valida um caminho relativo dentro do workspace. */
function resolveInside(
  workdir: string,
  raw: unknown,
): { path: string; rel: string } | { error: string } {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { error: 'Parâmetro "path" é obrigatório e deve ser uma string.' }
  }
  const path = join(workdir, raw)
  // INV-5: `..` e caminhos absolutos não escapam do worktree.
  if (!isWithin(workdir, path)) {
    return { error: `Caminho fora do workspace: ${raw}` }
  }
  const rel = relativeWithin(workdir, path)
  if (rel === undefined) return { error: `Caminho fora do workspace: ${raw}` }
  return { path, rel: toPosix(rel) }
}

function denied(rel: string, axis: string): ToolResult {
  return {
    ok: false,
    content: `PERMISSÃO NEGADA: ${axis} em "${rel}" está fora do escopo declarado desta tarefa. Trabalhe apenas nos caminhos permitidos.`,
  }
}

// ── read_file ───────────────────────────────────────────────────────────────

export const readFileTool: FileTool = {
  name: 'read_file',
  description:
    'Lê o conteúdo de um arquivo do workspace. Use antes de editar, para conhecer o conteúdo atual.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['path'],
    properties: {
      path: { type: 'string', description: 'Caminho relativo à raiz do workspace.' },
    },
  },
  sideEffects: 'read',
  requiresApproval: false,

  async execute(input, context): Promise<ToolResult> {
    const resolved = resolveInside(context.workdir, input['path'])
    if ('error' in resolved) return { ok: false, content: resolved.error }
    if (!isAllowed(resolved.rel, context.permissions.fs.read, context.permissions.fs.deny)) {
      return denied(resolved.rel, 'leitura')
    }
    try {
      const content = await readFile(resolved.path, 'utf8')
      return { ok: true, content: truncateMiddle(content, MAX_READ_CHARS) }
    } catch {
      return { ok: false, content: `Arquivo não encontrado ou ilegível: ${resolved.rel}` }
    }
  },
}

// ── write_file ──────────────────────────────────────────────────────────────

export const writeFileTool: FileTool = {
  name: 'write_file',
  description:
    'Escreve (cria ou substitui) um arquivo do workspace com o conteúdo dado. Para mudanças pontuais prefira edit_file.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['path', 'content'],
    properties: {
      path: { type: 'string', description: 'Caminho relativo à raiz do workspace.' },
      content: { type: 'string', description: 'Conteúdo completo do arquivo.' },
    },
  },
  sideEffects: 'write',
  requiresApproval: false,

  async execute(input, context): Promise<ToolResult> {
    const resolved = resolveInside(context.workdir, input['path'])
    if ('error' in resolved) return { ok: false, content: resolved.error }
    if (!isAllowed(resolved.rel, context.permissions.fs.write, context.permissions.fs.deny)) {
      return denied(resolved.rel, 'escrita')
    }
    const content = input['content']
    if (typeof content !== 'string') {
      return { ok: false, content: 'Parâmetro "content" é obrigatório e deve ser uma string.' }
    }
    try {
      await mkdir(join(resolved.path, '..'), { recursive: true })
      await writeFile(resolved.path, content)
      return {
        ok: true,
        content: `Escrito: ${resolved.rel} (${String(content.length)} caracteres)`,
        changed: resolved.rel,
      }
    } catch (error: unknown) {
      return {
        ok: false,
        content: `Falha ao escrever ${resolved.rel}: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  },
}

// ── edit_file ───────────────────────────────────────────────────────────────

export const editFileTool: FileTool = {
  name: 'edit_file',
  description:
    'Substitui uma ocorrência exata de texto em um arquivo. O texto antigo precisa ser único no arquivo.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['path', 'old_text', 'new_text'],
    properties: {
      path: { type: 'string' },
      old_text: { type: 'string', description: 'Trecho exato a substituir, incluindo indentação.' },
      new_text: { type: 'string', description: 'Texto que entra no lugar.' },
    },
  },
  sideEffects: 'write',
  requiresApproval: false,

  async execute(input, context): Promise<ToolResult> {
    const resolved = resolveInside(context.workdir, input['path'])
    if ('error' in resolved) return { ok: false, content: resolved.error }
    if (!isAllowed(resolved.rel, context.permissions.fs.write, context.permissions.fs.deny)) {
      return denied(resolved.rel, 'escrita')
    }

    const oldText = input['old_text']
    const newText = input['new_text']
    if (typeof oldText !== 'string' || typeof newText !== 'string') {
      return { ok: false, content: '"old_text" e "new_text" são obrigatórios.' }
    }

    let content: string
    try {
      content = await readFile(resolved.path, 'utf8')
    } catch {
      return { ok: false, content: `Arquivo não encontrado: ${resolved.rel}` }
    }

    const occurrences = content.split(oldText).length - 1
    if (occurrences === 0) {
      return {
        ok: false,
        content: `Texto não encontrado em ${resolved.rel}. Leia o arquivo antes de editar.`,
      }
    }
    // Ambiguidade é erro, não escolha: substituir "a primeira ocorrência" de um
    // trecho repetido produz edição silenciosamente errada.
    if (occurrences > 1) {
      return {
        ok: false,
        content: `Texto aparece ${String(occurrences)} vezes em ${resolved.rel}. Inclua mais contexto para torná-lo único.`,
      }
    }

    try {
      await writeFile(resolved.path, content.replace(oldText, newText))
      return { ok: true, content: `Editado: ${resolved.rel}`, changed: resolved.rel }
    } catch (error: unknown) {
      return {
        ok: false,
        content: `Falha ao editar ${resolved.rel}: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  },
}

// ── list_files ──────────────────────────────────────────────────────────────

export const listFilesTool: FileTool = {
  name: 'list_files',
  description: 'Lista arquivos e diretórios de um caminho do workspace.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      path: { type: 'string', description: 'Caminho relativo; vazio lista a raiz.' },
    },
  },
  sideEffects: 'read',
  requiresApproval: false,

  async execute(input, context): Promise<ToolResult> {
    const raw = typeof input['path'] === 'string' && input['path'] !== '' ? input['path'] : '.'
    const resolved = resolveInside(context.workdir, raw)
    if ('error' in resolved) return { ok: false, content: resolved.error }

    try {
      const entries = await readdir(resolved.path, { withFileTypes: true })
      const lines = entries
        .filter((entry) => !['node_modules', '.git', '.uranus'].includes(entry.name))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
      return { ok: true, content: lines.join('\n') || '(vazio)' }
    } catch {
      return { ok: false, content: `Diretório não encontrado: ${resolved.rel}` }
    }
  },
}

// ── run_command ─────────────────────────────────────────────────────────────

export const runCommandTool: FileTool = {
  name: 'run_command',
  description:
    'Executa um comando no workspace e devolve a saída. Use para rodar testes, build ou lint.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['command'],
    properties: {
      command: { type: 'string', description: 'Linha de comando a executar.' },
    },
  },
  sideEffects: 'exec',
  requiresApproval: false,

  async execute(input, context): Promise<ToolResult> {
    const command = input['command']
    if (typeof command !== 'string' || command.trim() === '') {
      return { ok: false, content: 'Parâmetro "command" é obrigatório.' }
    }
    if (context.permissions.exec === false) {
      return {
        ok: false,
        content: 'PERMISSÃO NEGADA: execução de comandos está desligada para este agente.',
      }
    }
    const allow = context.permissions.exec.allow
    const permitted = allow.includes('*') || allow.some((prefix) => command.startsWith(prefix))
    if (!permitted) {
      return {
        ok: false,
        content: `PERMISSÃO NEGADA: "${command}" não está na lista de comandos permitidos (${allow.join(', ')}).`,
      }
    }

    const result = await context.shell.run(
      { command, cwd: context.workdir, timeoutMs: 300_000, shell: true },
      context.signal,
    )
    const output = [
      `exit ${String(result.exitCode)}${result.timedOut ? ' (TIMEOUT)' : ''}`,
      result.stdout.trim() === '' ? '' : `stdout:\n${result.stdout}`,
      result.stderr.trim() === '' ? '' : `stderr:\n${result.stderr}`,
    ]
      .filter((part) => part !== '')
      .join('\n')

    return {
      // Exit != 0 não é falha da FERRAMENTA: o comando rodou e o modelo precisa
      // ver a saída para reagir. Falha de ferramenta é o comando não ter rodado.
      ok: true,
      content: truncateMiddle(output, MAX_OUTPUT_CHARS),
    }
  },
}

export const DEFAULT_FILE_TOOLS: readonly FileTool[] = [
  readFileTool,
  listFilesTool,
  editFileTool,
  writeFileTool,
  runCommandTool,
]

/** Filtra as ferramentas conforme as permissões efetivas do agente. */
export function toolsForPermissions(
  tools: readonly FileTool[],
  permissions: PermissionSet,
): readonly FileTool[] {
  return tools.filter((tool) => {
    if (tool.sideEffects === 'write' && permissions.fs.write.length === 0) return false
    if (tool.sideEffects === 'exec' && permissions.exec === false) return false
    if (permissions.tools.deny.includes(tool.name)) return false
    const allow = permissions.tools.allow
    return allow.length === 0 || allow.includes('*') || allow.includes(tool.name)
  })
}
