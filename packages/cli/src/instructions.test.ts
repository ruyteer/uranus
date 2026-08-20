import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { silentLogger, unwrap } from '@uranus/core'
import { withTempDir } from '@uranus/testkit'
import { FileInstructionsStore } from './instructions.js'

describe('FileInstructionsStore', () => {
  function makeStore(dir: string): FileInstructionsStore {
    return new FileInstructionsStore({
      dir: join(dir, '.uranus', 'instructions'),
      logger: silentLogger,
    })
  }

  it('grava Markdown legível e sobrevive a restart', async () => {
    await withTempDir(async (dir) => {
      const store = makeStore(dir)
      const note = unwrap(
        await store.add(
          { title: 'Estilo de commit', body: 'Sempre em português, no imperativo.' },
          1_700_000_000_000,
        ),
      )

      const fresh = makeStore(dir)
      const found = await fresh.get(note.id)
      expect(found?.title).toBe('Estilo de commit')
      expect(found?.body).toBe('Sempre em português, no imperativo.')
      expect(found?.scope).toBeUndefined()
    })
  })

  it('título vazio é rejeitado', async () => {
    await withTempDir(async (dir) => {
      const store = makeStore(dir)
      const result = await store.add({ title: '   ', body: 'x' }, 1)
      expect(result.ok).toBe(false)
    })
  })

  it('lista ordenada por título', async () => {
    await withTempDir(async (dir) => {
      const store = makeStore(dir)
      unwrap(await store.add({ title: 'Zebra', body: '' }, 1))
      unwrap(await store.add({ title: 'Abacate', body: '' }, 2))

      const notes = await store.list()
      expect(notes.map((n) => n.title)).toEqual(['Abacate', 'Zebra'])
    })
  })

  it('normaliza o escopo: barras, `..` e `.` somem', async () => {
    await withTempDir(async (dir) => {
      const store = makeStore(dir)
      const note = unwrap(
        await store.add(
          { title: 'Regra do backend', body: 'x', scope: '/packages/../packages/./api/' },
          1,
        ),
      )
      expect(note.scope).toBe('packages/api')
    })
  })

  it('update muda só os campos informados, e `scope: null` limpa o escopo', async () => {
    await withTempDir(async (dir) => {
      const store = makeStore(dir)
      const note = unwrap(
        await store.add({ title: 'Original', body: 'corpo', scope: 'packages/api' }, 1),
      )

      const editado = unwrap(await store.update(note.id, { body: 'corpo novo' }, 2))
      expect(editado.title).toBe('Original')
      expect(editado.body).toBe('corpo novo')
      expect(editado.scope).toBe('packages/api')

      const semEscopo = unwrap(await store.update(note.id, { scope: null }, 3))
      expect(semEscopo.scope).toBeUndefined()
    })
  })

  it('update de instrução inexistente devolve erro, não exceção', async () => {
    await withTempDir(async (dir) => {
      const store = makeStore(dir)
      const result = await store.update('nao-existe', { body: 'x' }, 1)
      expect(result.ok).toBe(false)
    })
  })

  it('remove é idempotente', async () => {
    await withTempDir(async (dir) => {
      const store = makeStore(dir)
      const note = unwrap(await store.add({ title: 'Descartável', body: '' }, 1))
      expect((await store.remove(note.id)).ok).toBe(true)
      expect((await store.remove(note.id)).ok).toBe(true)
      expect(await store.get(note.id)).toBeUndefined()
    })
  })

  it('arquivo sem frontmatter válido é ignorado, não derruba a listagem', async () => {
    await withTempDir(async (dir) => {
      const store = makeStore(dir)
      unwrap(await store.add({ title: 'Válida', body: '' }, 1))
      const fs = await import('node:fs/promises')
      await fs.writeFile(join(dir, '.uranus', 'instructions', 'lixo.md'), 'isto não é frontmatter')

      const notes = await store.list()
      expect(notes.map((n) => n.title)).toEqual(['Válida'])
    })
  })
})
