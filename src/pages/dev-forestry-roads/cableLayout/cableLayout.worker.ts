/// <reference lib="webworker" />
/**
 * Runs the cable-layout search off the page's thread. The wasm file is fetched here, only when a
 * search or analysis is asked for. One job per worker: the client terminates it afterwards, which
 * is also how Cancel stops a search mid-run.
 */
import { CableLayoutInputError, instantiateCableLayout, type CableLayoutEngine } from './cableLayout'
import type { CableCoverInput, CableLayoutInput, LayoutToAnalyse } from './cableLayout'

export type CableLayoutRequest =
  | { type: 'search'; input: CableLayoutInput }
  | { type: 'analyze'; input: CableLayoutInput; layout: LayoutToAnalyse }
  /** Coverage screen: every batch in turn, one progress message each. */
  | { type: 'cover'; batches: CableCoverInput[] }
export type CableLayoutResponse =
  | { type: 'progress'; done: number; spans: number }
  | { type: 'result'; buffer: Float64Array }
  | { type: 'cover-result'; buffers: Float64Array[] }
  | { type: 'error'; message: string; code?: number }

let engine: Promise<CableLayoutEngine> | null = null
const load = () =>
  (engine ??= fetch(new URL('./cable_layout.wasm', import.meta.url))
    .then((r) => {
      if (!r.ok) throw new Error(`The cable-layout module did not load (${r.status}).`)
      return r.arrayBuffer()
    })
    .then(instantiateCableLayout))

const post = (message: CableLayoutResponse, transfer: Transferable[] = []) =>
  (self as DedicatedWorkerGlobalScope).postMessage(message, transfer)

self.onmessage = async (event: MessageEvent<CableLayoutRequest>) => {
  try {
    const module = await load()
    const request = event.data
    if (request.type === 'cover') {
      const buffers: Float64Array[] = []
      const lines = request.batches.reduce((sum, batch) => sum + batch.lines.length, 0)
      let done = 0
      for (const batch of request.batches) {
        buffers.push(module.coverRaw(batch))
        done += batch.lines.length
        post({ type: 'progress', done: done / Math.max(1, lines), spans: lines })
      }
      post(
        { type: 'cover-result', buffers },
        buffers.map((b) => b.buffer),
      )
      return
    }
    if (request.type === 'analyze') {
      const buffer = module.analyzeRaw(request.input, request.layout)
      post({ type: 'result', buffer }, [buffer.buffer])
      return
    }
    const spans = module.begin(request.input)
    let done = 0
    let last = 0
    while (done < 1) {
      done = module.step(32)
      const now = performance.now()
      if (now - last > 100) {
        post({ type: 'progress', done, spans })
        last = now
      }
    }
    post({ type: 'progress', done: 1, spans })
    const buffer = module.finishRaw()
    post({ type: 'result', buffer }, [buffer.buffer])
  } catch (error) {
    post({
      type: 'error',
      message: error instanceof Error ? error.message : 'The cable-layout search failed.',
      code: error instanceof CableLayoutInputError ? error.code : undefined,
    })
  }
}
