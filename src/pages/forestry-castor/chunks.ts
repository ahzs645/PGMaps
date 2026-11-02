import {
  castorSnapshotTransfer,
  packCastorSnapshot,
  unpackCastorSnapshot,
  type PackedCastorSnapshot,
} from '@/features/forestry-castor/transfer'
import type { CastorProject, CastorResult, CastorSnapshot } from '@/features/forestry-castor/types'

/**
 * A project or result crosses a worker boundary as a series of small messages
 * instead of one structured clone: each message is (de)serialised in its own
 * task, so a 50,000-cell, 40-period scenario never blocks the page for the
 * whole copy. Large top-level arrays are sent in slices and per-cell snapshot
 * arrays as transferred Float64 buffers.
 */
export type CastorChunkTarget = 'project' | 'result'
export type CastorChunk =
  | { kind: 'shell'; target: CastorChunkTarget; value: Record<string, unknown> }
  | { kind: 'items'; target: CastorChunkTarget; key: string; items: unknown[] }
  | { kind: 'snapshot'; snapshot: PackedCastorSnapshot }

export const CASTOR_ITEMS_PER_CHUNK = 5_000

export function* castorChunks(
  target: CastorChunkTarget,
  value: CastorProject | CastorResult,
): Generator<{ chunk: CastorChunk; transfer: Transferable[] }> {
  const shell: Record<string, unknown> = {}
  const sliced: string[] = []
  for (const [key, entry] of Object.entries(value)) {
    if (target === 'result' && key === 'snapshots') shell[key] = []
    else if (Array.isArray(entry) && entry.length > CASTOR_ITEMS_PER_CHUNK) {
      shell[key] = []
      sliced.push(key)
    } else shell[key] = entry
  }
  yield { chunk: { kind: 'shell', target, value: shell }, transfer: [] }
  for (const key of sliced) {
    const items = (value as unknown as Record<string, unknown[]>)[key]
    for (let start = 0; start < items.length; start += CASTOR_ITEMS_PER_CHUNK)
      yield {
        chunk: { kind: 'items', target, key, items: items.slice(start, start + CASTOR_ITEMS_PER_CHUNK) },
        transfer: [],
      }
  }
  if (target === 'result')
    for (const snapshot of (value as CastorResult).snapshots) {
      const packed = packCastorSnapshot(snapshot)
      yield { chunk: { kind: 'snapshot', snapshot: packed }, transfer: castorSnapshotTransfer(packed) }
    }
}

/** Rebuilds what castorChunks sent, in order. Snapshots are unpacked one message at a time. */
export class CastorChunkAssembler {
  private readonly values: Partial<Record<CastorChunkTarget, Record<string, unknown>>> = {}

  accept(chunk: CastorChunk): void {
    if (chunk.kind === 'shell') {
      this.values[chunk.target] = chunk.value
      return
    }
    const target = this.values[chunk.kind === 'items' ? chunk.target : 'result']
    if (!target) throw new Error('Scenario data arrived out of order.')
    if (chunk.kind === 'items') {
      const items = target[chunk.key] as unknown[]
      for (const item of chunk.items) items.push(item)
    } else (target.snapshots as CastorSnapshot[]).push(unpackCastorSnapshot(chunk.snapshot))
  }

  project(): CastorProject {
    if (!this.values.project) throw new Error('No scenario inputs were received.')
    return this.values.project as unknown as CastorProject
  }

  result(): CastorResult {
    if (!this.values.result) throw new Error('No scenario result was received.')
    return this.values.result as unknown as CastorResult
  }
}

/** Lets the page paint and handle input between chunks; unlike setTimeout it is not clamped to 4 ms. */
export function yieldToPage(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      channel.port1.close()
      resolve()
    }
    channel.port2.postMessage(null)
  })
}
