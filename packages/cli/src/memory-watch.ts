import { watch } from 'node:fs'
import { join } from 'node:path'
import { MEMORY_SCOPES, type MemoryScope } from '@uranus/core'

/**
 * Observa mudanças em `.uranus/memory/` feitas por QUALQUER processo (kernel
 * rodando `uranus start` em outro terminal, `uranus chat`, edição manual) e
 * chama `onChange` — debounced, porque um único `write` costuma disparar mais
 * de um evento de FS (editor grava, depois fecha o handle).
 *
 * Sem isto, o painel só notava essas mudanças no próximo poll de 10s do
 * cliente (e só na aba que estivesse aberta) — dava a impressão de que só
 * reiniciar o processo do painel "resolvia".
 *
 * Observa cada pasta de escopo individualmente, e não com `recursive: true`
 * na pasta toda: esse modo só tem suporte garantido no Windows/macOS (ADR-011
 * mira Windows, mas o pacote roda em CI Linux também), então nada de depender
 * de uma flag que o Node pode se recusar a honrar lá.
 */
export function watchMemoryDir(memoryDir: string, onChange: () => void): () => void {
  const scopeWatchers = new Map<MemoryScope, ReturnType<typeof watch>>()
  let timer: ReturnType<typeof setTimeout> | undefined

  const notify = (): void => {
    if (timer !== undefined) return
    timer = setTimeout(() => {
      timer = undefined
      onChange()
    }, 300)
  }

  const watchScope = (scope: MemoryScope): void => {
    if (scopeWatchers.has(scope)) return
    try {
      scopeWatchers.set(scope, watch(join(memoryDir, scope), notify))
    } catch {
      // Pasta do escopo ainda não existe — nenhuma memória gravada nele ainda.
    }
  }
  for (const scope of MEMORY_SCOPES) watchScope(scope)

  // Escopo criado DEPOIS do painel subir (primeira memória daquele tipo,
  // gravada por outro processo) precisa religar o watch específico — senão o
  // painel fica cego pra esse escopo pelo resto da sessão.
  let parentWatcher: ReturnType<typeof watch> | undefined
  try {
    parentWatcher = watch(memoryDir, (_event, filename) => {
      if (filename !== null && (MEMORY_SCOPES as readonly string[]).includes(filename)) {
        watchScope(filename as MemoryScope)
      }
      notify()
    })
  } catch {
    // Pasta de memória ainda não existe — nada a observar até ela nascer.
  }

  return () => {
    for (const watcher of scopeWatchers.values()) watcher.close()
    parentWatcher?.close()
    if (timer !== undefined) clearTimeout(timer)
  }
}
