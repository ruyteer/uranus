import { mkdirSync, writeFileSync } from 'node:fs'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { MemoryDraft, ProjectId } from '@uranus/core'
import { hashText, silentLogger, systemClock, unwrap } from '@uranus/core'
import { InProcessEventBus } from '@uranus/events'
import { FakeClock, InMemoryEventStore, withTempDir } from '@uranus/testkit'
import { keyToFilename, parseRecord, recordChecksum, serializeRecord } from './frontmatter.js'
import { MarkdownMemoryStore } from './markdown-store.js'
import { DefaultMemoryManager } from './manager.js'

const PROJECT_ID = 'prj_01HZZZZZZZZZZZZZZZZZZZZZZZ' as ProjectId
const NEVER = new AbortController().signal

function draft(overrides: Partial<MemoryDraft> = {}): MemoryDraft {
  return {
    scope: 'convention',
    key: 'imports-ordenados',
    title: 'Imports em ordem alfabética',
    body: 'O projeto ordena imports alfabeticamente, com type-imports separados.',
    tags: ['estilo'],
    confidence: 0.8,
    source: { kind: 'agent', ref: 'run_teste' },
    refs: [],
    ...overrides,
  }
}

function makeStore(dir: string, clock = systemClock): MarkdownMemoryStore {
  return new MarkdownMemoryStore({
    dir: join(dir, '.uranus', 'memory'),
    projectRootDir: dir,
    projectId: PROJECT_ID,
    clock,
    logger: silentLogger,
  })
}

describe('frontmatter', () => {
  it('serializa e parseia sem perda', async () => {
    await withTempDir(async (dir) => {
      const store = makeStore(dir)
      const record = unwrap(await store.put(draft()))
      const roundtrip = parseRecord(serializeRecord(record))
      expect(roundtrip).toEqual(record)
      await store.close()
    })
  })

  it('parse rejeita conteúdo malformado sem lançar', () => {
    expect(parseRecord('sem frontmatter')).toBeUndefined()
    expect(parseRecord('---\n{invalido yaml::\n---\ncorpo')).toBeUndefined()
    expect(parseRecord('---\nfoo: 1\n---\ncorpo')).toBeUndefined() // sem id/scope
  })

  it('checksum muda quando o significado muda', () => {
    const a = draft()
    expect(recordChecksum(a)).toBe(recordChecksum({ ...a }))
    expect(recordChecksum(a)).not.toBe(recordChecksum({ ...a, body: 'outro corpo' }))
    expect(recordChecksum(a)).not.toBe(recordChecksum({ ...a, confidence: 0.3 }))
  })

  it('keyToFilename produz slug estável e seguro', () => {
    expect(keyToFilename('Imports Ordenados!')).toBe('imports-ordenados.md')
    expect(keyToFilename('')).toBe('sem-chave.md')
  })
})

describe('MarkdownMemoryStore', () => {
  it('put grava arquivo legível em .uranus/memory/<scope>/', async () => {
    await withTempDir(async (dir) => {
      const store = makeStore(dir)
      const record = unwrap(await store.put(draft()))

      const path = join(dir, '.uranus', 'memory', 'convention', 'imports-ordenados.md')
      const raw = await readFile(path, 'utf8')
      expect(raw).toContain('---')
      expect(raw).toContain('Imports em ordem alfabética')
      expect(raw).toContain(record.id)
      await store.close()
    })
  })

  it('put idempotente: mesmo conteúdo não cria registro novo', async () => {
    await withTempDir(async (dir) => {
      const store = makeStore(dir)
      const first = unwrap(await store.put(draft()))
      const second = unwrap(await store.put(draft()))
      expect(second.id).toBe(first.id)
      await store.close()
    })
  })

  it('contradição supersede, nunca sobrescreve (R9)', async () => {
    await withTempDir(async (dir) => {
      const clock = new FakeClock()
      const store = makeStore(dir, clock)
      const original = unwrap(await store.put(draft({ body: 'Usamos tabs.' })))
      clock.advance(1_000)
      const replacement = unwrap(await store.put(draft({ body: 'Usamos espaços.' })))

      expect(replacement.id).not.toBe(original.id)
      expect(replacement.supersedes).toBe(original.id)

      const old = await store.get(original.id)
      expect(old?.supersededBy).toBe(replacement.id)

      // O ativo pela chave é o novo; o antigo continua existindo no disco.
      const active = await store.getByKey('convention', 'imports-ordenados')
      expect(active?.id).toBe(replacement.id)
      const files = await readdir(join(dir, '.uranus', 'memory', 'convention'))
      expect(files.length).toBe(2)
      await store.close()
    })
  })

  it('sobrevive a restart: um store novo lê o que o anterior gravou', async () => {
    await withTempDir(async (dir) => {
      const store1 = makeStore(dir)
      unwrap(await store1.put(draft()))
      await store1.close()

      const store2 = makeStore(dir)
      const found = await store2.getByKey('convention', 'imports-ordenados')
      expect(found?.title).toBe('Imports em ordem alfabética')
      await store2.close()
    })
  })

  it('edição manual do arquivo vence: checksum recalculado no load', async () => {
    await withTempDir(async (dir) => {
      const store1 = makeStore(dir)
      const record = unwrap(await store1.put(draft()))
      await store1.close()

      const path = join(dir, '.uranus', 'memory', 'convention', 'imports-ordenados.md')
      const raw = await readFile(path, 'utf8')
      await writeFile(path, raw.replace('ordena imports alfabeticamente', 'CORRIGIDO PELO HUMANO'))

      const store2 = makeStore(dir)
      const reloaded = await store2.get(record.id)
      expect(reloaded?.body).toContain('CORRIGIDO PELO HUMANO')
      // O checksum reflete o conteúdo editado, não o original.
      expect(reloaded?.checksum).toBe(recordChecksum(reloaded!))
      await store2.close()
    })
  })

  it('query filtra por escopo, tag e confiança; busca lexical ranqueia', async () => {
    await withTempDir(async (dir) => {
      const store = makeStore(dir)
      unwrap(await store.put(draft()))
      unwrap(
        await store.put(
          draft({
            scope: 'bug',
            key: 'timeout-webhook',
            title: 'Webhook estoura timeout com payload grande',
            body: 'O endpoint de webhook falha com payloads acima de 1MB.',
            tags: ['webhook'],
            confidence: 0.9,
          }),
        ),
      )
      unwrap(
        await store.put(
          draft({
            scope: 'stack',
            key: 'node-22',
            title: 'Node 22 obrigatório',
            body: 'O projeto exige Node >= 22 por causa do node:sqlite.',
            confidence: 0.4,
          }),
        ),
      )

      expect(await store.query({ scopes: ['bug'] })).toHaveLength(1)
      expect(await store.query({ tags: ['webhook'] })).toHaveLength(1)
      expect(await store.query({ minConfidence: 0.7 })).toHaveLength(2)

      const found = await store.query({ text: 'webhook payload' })
      expect(found.length).toBeGreaterThanOrEqual(1)
      expect(found[0]!.key).toBe('timeout-webhook')
      await store.close()
    })
  })

  it('revalidate invalida memória cujo código referenciado mudou (R9)', async () => {
    await withTempDir(async (dir) => {
      mkdirSync(join(dir, 'src'), { recursive: true })
      const filePath = join(dir, 'src', 'api.ts')
      writeFileSync(filePath, 'export const versao = 1\n')

      const store = makeStore(dir)
      const record = unwrap(
        await store.put(
          draft({
            key: 'api-versao',
            body: 'A API expõe versao=1 em src/api.ts.',
            refs: [{ path: 'src/api.ts', checksum: hashText('export const versao = 1\n') }],
          }),
        ),
      )

      // Nada mudou: nada invalida.
      const before = await store.revalidate(NEVER)
      expect(before.invalidated).toHaveLength(0)

      // O arquivo mudou: a memória que o referencia é invalidada.
      writeFileSync(filePath, 'export const versao = 2\n')
      const after = await store.revalidate(NEVER)
      expect(after.invalidated).toEqual([record.id])
      expect(await store.getByKey('convention', 'api-versao')).toBeUndefined()
      await store.close()
    })
  })

  it('compact funde registros excedentes em resumo, preservando originais', async () => {
    await withTempDir(async (dir) => {
      const clock = new FakeClock()
      const store = makeStore(dir, clock)
      for (let index = 0; index < 6; index++) {
        clock.advance(10)
        unwrap(
          await store.put(
            draft({
              key: `registro-${String(index)}`,
              title: `Registro ${String(index)}`,
              confidence: 0.3 + index * 0.1,
            }),
          ),
        )
      }

      const report = await store.compact('convention', { maxRecords: 3, minConfidence: 0.3 })
      expect(report.before).toBe(6)
      expect(report.merged.length).toBeGreaterThan(0)

      const active = await store.query({ scopes: ['convention'] })
      // 3 mantidos + 1 resumo.
      expect(active).toHaveLength(4)
      const summary = active.find((record) => record.tags.includes('compactado'))
      expect(summary).toBeDefined()
      expect(summary!.source.kind).toBe('derived')

      // Originais supersedidos ainda existem no disco (histórico).
      const all = await store.query({ scopes: ['convention'], includeSuperseded: true })
      expect(all.length).toBeGreaterThan(4)
      await store.close()
    })
  })
})

describe('DefaultMemoryManager', () => {
  function makeManager(dir: string): {
    manager: DefaultMemoryManager
    store: MarkdownMemoryStore
    events: InMemoryEventStore
  } {
    const store = makeStore(dir)
    const eventStore = new InMemoryEventStore()
    const bus = new InProcessEventBus({
      store: eventStore,
      clock: systemClock,
      logger: silentLogger,
      projectId: PROJECT_ID,
    })
    return {
      manager: new DefaultMemoryManager({
        store,
        events: bus,
        logger: silentLogger,
        maxRecordsPerScope: 50,
        minConfidence: 0.3,
      }),
      store,
      events: eventStore,
    }
  }

  it('descarta rascunho abaixo do piso de confiança', async () => {
    await withTempDir(async (dir) => {
      const { manager, store } = makeManager(dir)
      const saved = await manager.remember([draft({ confidence: 0.1 })])
      expect(saved).toHaveLength(0)
      expect(await store.query({})).toHaveLength(0)
      await store.close()
    })
  })

  it('dedupe no lote: maior confiança vence', async () => {
    await withTempDir(async (dir) => {
      const { manager, store } = makeManager(dir)
      const saved = await manager.remember([
        draft({ confidence: 0.5, body: 'versão fraca' }),
        draft({ confidence: 0.9, body: 'versão forte' }),
      ])
      expect(saved).toHaveLength(1)
      expect(saved[0]!.body).toBe('versão forte')
      await store.close()
    })
  })

  it('contradição com confiança comparável emite MemoryConflictDetected', async () => {
    await withTempDir(async (dir) => {
      const { manager, events, store } = makeManager(dir)
      await manager.remember([draft({ body: 'Usamos tabs.', confidence: 0.7 })])
      await manager.remember([draft({ body: 'Usamos espaços.', confidence: 0.8 })])

      expect(events.byName('MemoryConflictDetected')).toHaveLength(1)
      expect(events.byName('MemoryUpdated').length).toBeGreaterThanOrEqual(2)
      await store.close()
    })
  })

  it('supersessão com confiança muito maior NÃO é conflito', async () => {
    await withTempDir(async (dir) => {
      const { manager, events, store } = makeManager(dir)
      await manager.remember([draft({ body: 'palpite', confidence: 0.35 })])
      await manager.remember([draft({ body: 'fato confirmado', confidence: 0.95 })])
      expect(events.byName('MemoryConflictDetected')).toHaveLength(0)
      await store.close()
    })
  })

  it('maintain compacta escopos acima do orçamento e emite eventos', async () => {
    await withTempDir(async (dir) => {
      const store = makeStore(dir)
      const eventStore = new InMemoryEventStore()
      const bus = new InProcessEventBus({
        store: eventStore,
        clock: systemClock,
        logger: silentLogger,
        projectId: PROJECT_ID,
      })
      const manager = new DefaultMemoryManager({
        store,
        events: bus,
        logger: silentLogger,
        maxRecordsPerScope: 2,
        minConfidence: 0.3,
      })
      for (let index = 0; index < 5; index++) {
        await manager.remember([
          draft({ key: `k${String(index)}`, title: `T${String(index)}`, confidence: 0.5 }),
        ])
      }
      const reports = await manager.maintain(NEVER)
      expect(reports.length).toBeGreaterThan(0)
      expect(eventStore.byName('MemoryCompacted')).toHaveLength(1)
      await store.close()
    })
  })

  it('maintain remove registros supersedidos antigos (Fase 9: compactação em escala)', async () => {
    await withTempDir(async (dir) => {
      const clock = new FakeClock()
      const store = makeStore(dir, clock)
      const eventStore = new InMemoryEventStore()
      const bus = new InProcessEventBus({
        store: eventStore,
        clock,
        logger: silentLogger,
        projectId: PROJECT_ID,
      })
      const ONE_DAY_MS = 24 * 60 * 60 * 1000
      const manager = new DefaultMemoryManager({
        store,
        events: bus,
        logger: silentLogger,
        maxRecordsPerScope: 50,
        minConfidence: 0.3,
        pruneSupersededOlderThanMs: 30 * ONE_DAY_MS,
      })

      const first = (await manager.remember([draft({ body: 'versão 1', confidence: 0.6 })]))[0]!
      clock.advance(ONE_DAY_MS)
      await manager.remember([draft({ body: 'versão 2', confidence: 0.6 })])

      // Ainda dentro da janela: o supersedido continua no disco e no cache.
      await manager.maintain(NEVER)
      expect((await store.get(first.id))?.supersededBy).toBeDefined()

      // 31 dias depois, a próxima manutenção remove de verdade.
      clock.advance(31 * ONE_DAY_MS)
      await manager.maintain(NEVER)
      expect(await store.get(first.id)).toBeUndefined()

      // A visão ativa nunca dependeu do registro removido.
      const active = await store.getByKey('convention', 'imports-ordenados')
      expect(active?.body).toBe('versão 2')
      await store.close()
    })
  })
})
