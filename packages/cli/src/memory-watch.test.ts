import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { withTempDir } from '@uranus/testkit'
import { watchMemoryDir } from './memory-watch.js'

/** Espera até `onChange` disparar ou estoura com uma mensagem clara. */
function nextChange(timeoutMs = 2_000): { promise: Promise<void>; onChange: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    setTimeout(() => rej(new Error(`onChange não disparou em ${String(timeoutMs)}ms`)), timeoutMs)
  })
  return { promise, onChange: resolve }
}

describe('watchMemoryDir', () => {
  it('detecta escrita em escopo já existente (simula outro processo gravando)', async () => {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, 'decision'), { recursive: true })
      const { promise, onChange } = nextChange()
      const stop = watchMemoryDir(dir, onChange)
      try {
        await writeFile(join(dir, 'decision', 'x.md'), '---\ntitle: x\n---\ncorpo')
        await promise
      } finally {
        stop()
      }
    })
  })

  it('detecta escopo criado depois do watch começar (primeira memória daquele tipo)', async () => {
    await withTempDir(async (dir) => {
      await mkdir(dir, { recursive: true })
      const { promise, onChange } = nextChange()
      const stop = watchMemoryDir(dir, onChange)
      try {
        await mkdir(join(dir, 'bug'), { recursive: true })
        await writeFile(join(dir, 'bug', 'y.md'), '---\ntitle: y\n---\ncorpo')
        await promise
      } finally {
        stop()
      }
    })
  })

  it('para de notificar depois de cancelado', async () => {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, 'pattern'), { recursive: true })
      let calls = 0
      const stop = watchMemoryDir(dir, () => {
        calls++
      })
      stop()
      await writeFile(join(dir, 'pattern', 'z.md'), 'corpo')
      await new Promise((r) => setTimeout(r, 500))
      expect(calls).toBe(0)
    })
  })

  it('pasta de memória inexistente não lança — só fica sem observar nada', async () => {
    await withTempDir(async (dir) => {
      const stop = watchMemoryDir(join(dir, 'nao-existe'), () => undefined)
      stop()
    })
  })
})
