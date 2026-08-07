import { join } from 'node:path'
import { rm } from 'node:fs/promises'
import type {
  Checkpoint,
  CheckpointId,
  CheckpointManager,
  CheckpointRef,
  Clock,
  KernelSnapshot,
  Result,
  RunId,
  WorkspaceRef,
} from '@uranus/core'
import { NotFoundError, err, newCheckpointId, ok } from '@uranus/core'
import type { StateStore } from '@uranus/state'
import { readDigested, writeDigested } from '@uranus/state'

export interface FileCheckpointManagerOptions {
  readonly dir: string
  readonly state: StateStore
  readonly clock: Clock
}

interface CheckpointRow extends Record<string, unknown> {
  id: string
  run_id: string
  seq: number
  at: number
  event_offset: number
  path: string
  digest: string
}

/**
 * Checkpoints em arquivo (payload) + índice no SQLite (lookup).
 *
 * O payload vai para arquivo — e não para o banco — porque a recuperação
 * precisa funcionar mesmo com o banco íntegro mas o processo morto no meio de
 * uma transação: `readDigested` valida o digest e recusa qualquer checkpoint
 * corrompido (R11). O índice existe só para achar o mais recente sem listar
 * o diretório.
 */
export class FileCheckpointManager implements CheckpointManager {
  private readonly dir: string
  private readonly state: StateStore
  private readonly clock: Clock
  private seq = 0

  constructor(options: FileCheckpointManagerOptions) {
    this.dir = options.dir
    this.state = options.state
    this.clock = options.clock
  }

  async create(
    runId: RunId,
    snapshot: KernelSnapshot,
    eventOffset: number,
    workspaces: readonly WorkspaceRef[],
  ): Promise<Result<Checkpoint>> {
    this.seq += 1
    const id = newCheckpointId(this.clock.now())
    const checkpoint: Omit<Checkpoint, 'digest'> = {
      id,
      runId,
      seq: this.seq,
      at: this.clock.now(),
      eventOffset,
      snapshot,
      workspaces,
    }

    const path = join(this.dir, runId, `${String(this.seq).padStart(8, '0')}.json`)
    const written = await writeDigested(path, checkpoint)
    if (!written.ok) return err(written.error)

    const full: Checkpoint = { ...checkpoint, digest: written.value }
    try {
      this.state.db
        .prepare(
          'INSERT INTO checkpoints (id, run_id, seq, at, event_offset, path, digest) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(id, runId, this.seq, full.at, eventOffset, path, written.value)
    } catch {
      // Índice é reconstruível; o arquivo é a verdade. Não falha o checkpoint.
    }
    return ok(full)
  }

  async latest(runId: RunId): Promise<Checkpoint | undefined> {
    const rows = this.state.db
      .prepare('SELECT * FROM checkpoints WHERE run_id = ? ORDER BY seq DESC')
      .all<CheckpointRow>(runId)

    // Anda do mais novo para o mais velho pulando corrompidos — um checkpoint
    // ruim nunca impede a recuperação se houver um íntegro atrás dele.
    for (const row of rows) {
      const loaded = await readDigested<Omit<Checkpoint, 'digest'>>(row.path)
      if (loaded.ok) {
        this.seq = Math.max(this.seq, row.seq)
        return { ...loaded.value.payload, digest: loaded.value.digest }
      }
    }
    return undefined
  }

  async load(id: CheckpointId): Promise<Result<Checkpoint>> {
    const row = this.state.db
      .prepare('SELECT * FROM checkpoints WHERE id = ?')
      .get<CheckpointRow>(id)
    if (row === undefined) {
      return err(new NotFoundError('Checkpoint não indexado', { context: { id } }))
    }
    const loaded = await readDigested<Omit<Checkpoint, 'digest'>>(row.path)
    if (!loaded.ok) return err(loaded.error)
    return ok({ ...loaded.value.payload, digest: loaded.value.digest })
  }

  list(runId: RunId): Promise<readonly CheckpointRef[]> {
    const rows = this.state.db
      .prepare('SELECT * FROM checkpoints WHERE run_id = ? ORDER BY seq ASC')
      .all<CheckpointRow>(runId)
    return Promise.resolve(
      rows.map((row) => ({
        id: row.id as CheckpointId,
        runId: row.run_id as RunId,
        seq: row.seq,
        at: row.at,
        eventOffset: row.event_offset,
      })),
    )
  }

  async prune(runId: RunId, keep: number): Promise<number> {
    const rows = this.state.db
      .prepare('SELECT * FROM checkpoints WHERE run_id = ? ORDER BY seq DESC')
      .all<CheckpointRow>(runId)
    const toDelete = rows.slice(keep)
    for (const row of toDelete) {
      await rm(row.path, { force: true })
      this.state.db.prepare('DELETE FROM checkpoints WHERE id = ?').run(row.id)
    }
    return toDelete.length
  }
}
