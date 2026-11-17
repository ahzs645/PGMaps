/// <reference lib="webworker" />
/** Decodes batches of a large LAS/LAZ `File` off the page; see `largeLazDecode.ts`. */
import { createLazPerf, type LazPerf } from 'laz-perf'
import wasmUrl from 'laz-perf/lib/web/laz-perf.wasm?url'
import { decodeBatch, newScratch, type DecodeBatch } from './largeLazDecode'

export interface LargeLazJob extends DecodeBatch {
  id: number
  file: File
}
export type LargeLazReply =
  | { id: number; type: 'done'; records: ArrayBuffer; count: number; read: number }
  | { id: number; type: 'error'; message: string }

const scope = globalThis as unknown as DedicatedWorkerGlobalScope
let laz: Promise<LazPerf> | undefined
const scratch = newScratch()

scope.onmessage = async ({ data: job }: MessageEvent<LargeLazJob>) => {
  try {
    const module = job.compressed ? await (laz ??= createLazPerf({ locateFile: () => wasmUrl })) : null
    const { records, count, read } = await decodeBatch(
      module,
      job,
      async (c) => new Uint8Array(await job.file.slice(c.start, c.start + c.bytes).arrayBuffer()),
      scratch,
    )
    const buffer = records.buffer as ArrayBuffer
    scope.postMessage({ id: job.id, type: 'done', records: buffer, count, read } satisfies LargeLazReply, [buffer])
  } catch (error) {
    scope.postMessage({
      id: job.id,
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    } satisfies LargeLazReply)
  }
}
