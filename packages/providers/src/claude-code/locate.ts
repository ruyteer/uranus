import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'
import { homedir } from 'node:os'

/**
 * Localiza o binário do Claude Code.
 *
 * Necessário porque instaladores comuns (o instalador nativo usa
 * `~/.local/bin`) não entram no PATH de shells não-interativos no Windows —
 * e o kernel roda exatamente nesse tipo de shell. Ordem: caminho explícito da
 * config → PATH → locais conhecidos de instalação.
 */
export function locateClaudeBinary(explicit?: string): string {
  if (explicit !== undefined && explicit.trim() !== '') return explicit

  const names = process.platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude']

  for (const dir of (process.env['PATH'] ?? '').split(delimiter)) {
    if (dir === '') continue
    for (const name of names) {
      if (isExecutable(join(dir, name))) return join(dir, name)
    }
  }

  const home = homedir()
  const known = [
    join(home, '.local', 'bin'),
    join(process.env['APPDATA'] ?? join(home, 'AppData', 'Roaming'), 'npm'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
  ]
  for (const dir of known) {
    for (const name of names) {
      if (isExecutable(join(dir, name))) return join(dir, name)
    }
  }

  // Não achou: devolve o nome simples — o erro do spawn (exit 127) vai apontar
  // claramente para "instale o Claude Code" via health().
  return 'claude'
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}
