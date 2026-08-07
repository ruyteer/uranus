import { closeSync, fsyncSync, openSync, writeSync } from 'node:fs'
import { mkdir, readFile, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { IntegrityError, IoError, digestEquals, digestOf, err, ok, type Result } from '@uranus/core'

/**
 * Escrita atômica: `tmp` → `fsync` → `rename`.
 *
 * `rename` dentro do mesmo filesystem é atômico; combinado com `fsync` antes,
 * garante que o arquivo de destino ou é o conteúdo antigo íntegro ou o novo
 * íntegro — nunca um híbrido. É o que sustenta R11: um checkpoint corrompido
 * jamais substitui um íntegro.
 *
 * O `fsync` do diretório depois do rename é o passo que quase todo mundo esquece:
 * sem ele, a *entrada* do novo nome pode não estar durável mesmo com o conteúdo
 * já em disco.
 */
export async function writeFileAtomic(path: string, contents: string): Promise<Result<void>> {
  const dir = dirname(path)
  const tmp = `${path}.${String(process.pid)}.tmp`

  try {
    await mkdir(dir, { recursive: true })

    const fd = openSync(tmp, 'w')
    try {
      writeSync(fd, contents)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }

    await rename(tmp, path)
    syncDirectory(dir)
    return ok()
  } catch (error: unknown) {
    await unlink(tmp).catch(() => undefined)
    return err(new IoError('Falha na escrita atômica', { cause: error, context: { path } }))
  }
}

function syncDirectory(dir: string): void {
  // Windows não permite abrir diretório como arquivo; o rename já é durável lá.
  if (process.platform === 'win32') return
  try {
    const fd = openSync(dir, 'r')
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  } catch {
    // Filesystems que não suportam fsync de diretório não são um erro fatal.
  }
}

export interface DigestedFile<T> {
  readonly payload: T
  readonly digest: string
}

/** Grava um objeto junto com o digest do próprio conteúdo. */
export async function writeDigested<T>(path: string, payload: T): Promise<Result<string>> {
  const digest = digestOf(payload)
  const written = await writeFileAtomic(path, JSON.stringify({ payload, digest }))
  return written.ok ? ok(digest) : err(written.error)
}

/**
 * Lê e **verifica** a integridade. Digest divergente é erro, não aviso: restaurar
 * um checkpoint corrompido produziria um estado plausível e errado, que é pior do
 * que não restaurar nada.
 */
export async function readDigested<T>(path: string): Promise<Result<DigestedFile<T>>> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error: unknown) {
    return err(new IoError('Falha ao ler arquivo', { cause: error, context: { path } }))
  }

  let parsed: { payload: T; digest: string }
  try {
    parsed = JSON.parse(raw) as { payload: T; digest: string }
  } catch (error: unknown) {
    return err(new IntegrityError('Arquivo ilegível', { cause: error, context: { path } }))
  }

  if (typeof parsed.digest !== 'string') {
    return err(new IntegrityError('Arquivo sem digest', { context: { path } }))
  }

  const actual = digestOf(parsed.payload)
  if (!digestEquals(actual, parsed.digest)) {
    return err(
      new IntegrityError('Digest divergente — arquivo corrompido', {
        context: { path, expected: parsed.digest, actual },
      }),
    )
  }

  return ok({ payload: parsed.payload, digest: parsed.digest })
}
