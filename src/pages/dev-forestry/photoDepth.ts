import { PHOTO_DEPTH_CACHE, depthModelUrls, type PhotoDepthModel } from './photoDepthModels'
import type { Rgba } from './photoViews'

export type { PhotoDepthModel }

export type DepthGrid = { width: number; height: number; inverse: Float32Array }
export type PhotoDepthRequest = { id: number; photo: Rgba; model: PhotoDepthModel }
export type PhotoDepthReply = { id: number; depth: DepthGrid } | { id: number; error: string }

/** How long the depth worker is kept with nothing asked of it: it holds a model's session, tens of megabytes. */
const DEPTH_WORKER_IDLE_MS = 60_000

type Waiting = { resolve: (depth: DepthGrid) => void; reject: (error: unknown) => void }
type DepthHost = { worker: Worker; waiting: Map<number, Waiting>; idle: ReturnType<typeof setTimeout> | null }
let shared: DepthHost | null = null
let nextId = 1

/** Ends the worker and what it holds; whoever still waits is told why. */
function endDepthWorker(error: unknown) {
  const ended = shared
  if (!ended) return
  shared = null
  if (ended.idle) clearTimeout(ended.idle)
  ended.worker.terminate()
  for (const entry of ended.waiting.values()) entry.reject(error)
}

function depthWorker() {
  if (shared) return shared
  const worker = new Worker(new URL('./photoDepth.worker.ts', import.meta.url), { type: 'module' })
  const made: DepthHost = { worker, waiting: new Map(), idle: null }
  worker.onmessage = ({ data }: MessageEvent<PhotoDepthReply>) => {
    const entry = made.waiting.get(data.id)
    if (!entry) return
    made.waiting.delete(data.id)
    if ('error' in data) entry.reject(Error(data.error))
    else entry.resolve(data.depth)
    if (!made.waiting.size && shared === made)
      made.idle = setTimeout(() => {
        if (shared === made && !made.waiting.size) endDepthWorker(Error('The depth worker was let go.'))
      }, DEPTH_WORKER_IDLE_MS)
  }
  worker.onerror = (event) => {
    if (shared === made) endDepthWorker(Error(event.message || 'The depth worker stopped.'))
  }
  shared = made
  return made
}

/**
 * Runs the optional model off the UI thread. One worker serves a run of photos and keeps the model's session between
 * them, so only the first pays for reading the weights and building it; the worker is let go a minute after the last
 * estimate. A request given up while its estimate is running ends the worker, since an estimate cannot be interrupted.
 */
export function estimatePhotoDepth(photo: Rgba, model: PhotoDepthModel, signal: AbortSignal): Promise<DepthGrid> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const host = depthWorker()
    if (host.idle) clearTimeout(host.idle)
    host.idle = null
    const id = nextId++
    const abort = () => {
      if (!host.waiting.delete(id)) return
      reject(signal.reason)
      // Others still waiting are told the worker went, and may ask again.
      if (shared === host) endDepthWorker(Error('The depth estimate was stopped.'))
    }
    signal.addEventListener('abort', abort, { once: true })
    host.waiting.set(id, {
      resolve: (depth) => {
        signal.removeEventListener('abort', abort)
        resolve(depth)
      },
      reject: (error) => {
        signal.removeEventListener('abort', abort)
        reject(error)
      },
    })
    host.worker.postMessage({ id, photo, model } satisfies PhotoDepthRequest)
  })
}

/**
 * Whether a model's weights are already in this browser (downloaded for an earlier comparison). The queue runs a
 * depth comparison by itself only then: it never starts a download of tens of megabytes nobody asked for.
 */
export async function depthModelStored(model: PhotoDepthModel): Promise<boolean> {
  try {
    const cache = await globalThis.caches?.open(PHOTO_DEPTH_CACHE)
    if (!cache) return false
    const kept = await Promise.all(depthModelUrls(model).map((url) => cache.match(url)))
    return kept.every(Boolean)
  } catch {
    return false
  }
}
