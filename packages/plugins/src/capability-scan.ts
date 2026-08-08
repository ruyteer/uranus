import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { PluginPermissions } from '@uranus/core'

/**
 * Varredura estática de capacidades do plugin.
 *
 * **Sobre o que isto é honestamente capaz de garantir:** um plugin JavaScript
 * roda no mesmo processo que o kernel. Não existe sandbox real em processo —
 * `node:vm` é contornável, e `worker_threads` compartilha rede e filesystem.
 * Isolamento verdadeiro exigiria processo separado com IPC, o que a Fase 9
 * pode trazer se o risco justificar.
 *
 * O que ESTA varredura faz é diferente e ainda assim valioso: compara o que o
 * código do plugin importa com o que o manifesto declara. Isso pega
 *
 *   - plugin que pede rede sem declarar (descuido ou versão desatualizada);
 *   - plugin que ganhou uma capacidade nova numa atualização sem avisar;
 *   - plugin malicioso ingênuo.
 *
 * O que NÃO pega é evasão deliberada (`import(atob('...'))`). Por isso a regra
 * de ouro está documentada e repetida ao usuário: **instalar um plugin é
 * confiar no autor**, exatamente como instalar um pacote npm.
 */

interface CapabilitySignature {
  readonly capability: 'net' | 'exec' | 'fs'
  readonly pattern: RegExp
  readonly what: string
}

const SIGNATURES: readonly CapabilitySignature[] = [
  {
    capability: 'net',
    pattern: /from\s+['"]node:(https?|net|dgram|tls)['"]/,
    what: 'módulo de rede',
  },
  { capability: 'net', pattern: /\bfetch\s*\(/, what: 'fetch()' },
  {
    capability: 'net',
    pattern: /from\s+['"](axios|node-fetch|undici|got)['"]/,
    what: 'cliente HTTP',
  },
  {
    capability: 'exec',
    pattern: /from\s+['"]node:(child_process|worker_threads)['"]/,
    what: 'criação de processos',
  },
  {
    capability: 'exec',
    pattern: /\b(execSync|spawnSync|execFileSync)\s*\(/,
    what: 'execução síncrona',
  },
  {
    capability: 'fs',
    pattern: /from\s+['"]node:fs(\/promises)?['"]/,
    what: 'acesso ao filesystem',
  },
]

export interface CapabilityViolation {
  readonly capability: 'net' | 'exec' | 'fs'
  readonly what: string
  readonly file: string
}

export interface ScanResult {
  readonly violations: readonly CapabilityViolation[]
  readonly filesScanned: number
  /** `true` quando a varredura foi incompleta — o resultado é indicativo. */
  readonly truncated: boolean
}

const MAX_FILES = 200
const MAX_BYTES = 512 * 1024

export async function scanCapabilities(
  pluginDir: string,
  permissions: PluginPermissions,
): Promise<ScanResult> {
  const violations: CapabilityViolation[] = []
  let filesScanned = 0
  let truncated = false

  const allowed = {
    net: permissions.net,
    exec: permissions.exec,
    fs: permissions.fs !== 'none',
  }

  const walk = async (dir: string, rel: string): Promise<void> => {
    if (filesScanned >= MAX_FILES) {
      truncated = true
      return
    }
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (filesScanned >= MAX_FILES) {
        truncated = true
        return
      }
      const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (entry.isDirectory()) {
        if (['node_modules', '.git', 'test', 'tests', '__tests__'].includes(entry.name)) continue
        await walk(join(dir, entry.name), childRel)
        continue
      }
      if (!/\.(m?js|cjs|ts)$/.test(entry.name) || entry.name.endsWith('.d.ts')) continue

      let source: string
      try {
        source = await readFile(join(dir, entry.name), 'utf8')
      } catch {
        continue
      }
      filesScanned++
      if (source.length > MAX_BYTES) truncated = true

      for (const signature of SIGNATURES) {
        if (allowed[signature.capability]) continue
        if (signature.pattern.test(source)) {
          violations.push({
            capability: signature.capability,
            what: signature.what,
            file: childRel,
          })
        }
      }
    }
  }

  await walk(pluginDir, '')
  return { violations, filesScanned, truncated }
}

export function formatViolations(
  pluginId: string,
  violations: readonly CapabilityViolation[],
): string {
  const lines = violations.map(
    (violation) =>
      `  • usa ${violation.what} em ${violation.file}, mas não declara "permissions.${violation.capability}"`,
  )
  return `Plugin "${pluginId}" usa capacidades não declaradas no manifesto:\n${lines.join('\n')}`
}
