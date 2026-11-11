import type { LargeLazPlan, Selection } from './largeLaz'
import type { LargeLazJob, LargeLazReply } from './largeLaz.worker'

/** Chunks per job: enough to keep workers busy, small enough that progress moves and Cancel takes effect. */
const BATCH = 24

export interface LargeLazProgress {
  read: number
  total: number
  kept: number
}

/**
 * Read `file` chunk by chunk across a few workers and return the records `selection` keeps, in file order.
 * An area read stops with an error once it holds more than twice its limit, so a mistaken box cannot fill
 * memory; the caller thins anything between the limit and that ceiling.
 */
export function readLargeLaz(
  file: File,
  plan: LargeLazPlan,
  selection: Selection,
  { signal, onProgress }: { signal?: AbortSignal; onProgress?: (p: LargeLazProgress) => void } = {},
): Promise<{ records: Uint8Array; count: number }> {
  signal?.throwIfAborted()
  const { header } = plan
  const batches: LargeLazJob[] = []
  for (let i = 0; i < plan.chunks.length; i += BATCH)
    batches.push({
      id: batches.length,
      file,
      compressed: header.compressed,
      format: header.pointFormat,
      length: header.pointLength,
      scale: header.scale,
      offset: header.offset,
      chunks: plan.chunks.slice(i, i + BATCH),
      selection,
    })
  const cores = typeof navigator === 'undefined' ? 2 : navigator.hardwareConcurrency || 2
  const workers = Array.from(
    { length: Math.max(1, Math.min(4, cores - 1, batches.length)) },
    () => new Worker(new URL('./largeLaz.worker.ts', import.meta.url), { type: 'module' }),
  )
  const results: { records: ArrayBuffer; count: number }[] = []
  let next = 0,
    finished = 0,
    read = 0,
    kept = 0
  return new Promise((resolve, reject) => {
    let settled = false
    const stop = () => {
      settled = true
      workers.forEach((w) => w.terminate())
      signal?.removeEventListener('abort', abort)
    }
    const fail = (error: unknown) => {
      if (settled) return
      stop()
      reject(error)
    }
    const abort = () => fail(signal?.reason ?? new DOMException('Import cancelled', 'AbortError'))
    signal?.addEventListener('abort', abort, { once: true })
    const feed = (worker: Worker) => {
      if (next < batches.length) worker.postMessage(batches[next++])
    }
    for (const worker of workers) {
      worker.onmessage = ({ data }: MessageEvent<LargeLazReply>) => {
        if (settled) return
        if (data.type === 'error') return fail(Error(data.message))
        results[data.id] = { records: data.records, count: data.count }
        read += data.read
        kept += data.count
        finished++
        onProgress?.({ read, total: header.points, kept })
        if (selection.kind === 'area' && kept > selection.limit * 2)
          return fail(
            Error(
              `This area holds more than ${(selection.limit * 2).toLocaleString()} points, more than the browser can show at full detail. Zoom in further and try again.`,
            ),
          )
        if (finished === batches.length) {
          stop()
          const length = header.pointLength
          const records = new Uint8Array(kept * length)
          let at = 0
          for (const r of results) {
            records.set(new Uint8Array(r.records), at)
            at += r.count * length
          }
          resolve({ records, count: kept })
          return
        }
        feed(worker)
      }
      worker.onerror = (event) => fail(Error(event.message || 'The point cloud reader failed.'))
      feed(worker)
    }
  })
}

/** Keep every `step`-th of `count` records, so an area over its limit is thinned evenly rather than cut off. */
export function thinRecords(records: Uint8Array, count: number, length: number, limit: number) {
  if (count <= limit) return { records, count }
  const step = Math.ceil(count / limit)
  const kept = Math.ceil(count / step)
  const out = new Uint8Array(kept * length)
  for (let i = 0, k = 0; i < count; i += step, k++) out.set(records.subarray(i * length, (i + 1) * length), k * length)
  return { records: out, count: kept }
}
