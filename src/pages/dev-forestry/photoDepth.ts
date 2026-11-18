import { PHOTO_DEPTH_CACHE, depthModelUrls, type PhotoDepthModel } from './photoDepthModels'
import type { Rgba } from './photoViews'

export type { PhotoDepthModel }

export type DepthGrid = { width: number; height: number; inverse: Float32Array }
export type PhotoDepthRequest = { photo: Rgba; model: PhotoDepthModel }
export type PhotoDepthReply = { depth: DepthGrid } | { error: string }

/** Runs the optional model off the UI thread and releases the session when the estimate is ready. */
export function estimatePhotoDepth(photo: Rgba, model: PhotoDepthModel, signal: AbortSignal): Promise<DepthGrid> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./photoDepth.worker.ts', import.meta.url), { type: 'module' })
    const close = () => {
      signal.removeEventListener('abort', abort)
      worker.terminate()
    }
    const abort = () => {
      close()
      reject(signal.reason)
    }
    signal.addEventListener('abort', abort, { once: true })
    worker.onmessage = ({ data }: MessageEvent<PhotoDepthReply>) => {
      close()
      if ('error' in data) reject(Error(data.error))
      else resolve(data.depth)
    }
    worker.onerror = (event) => {
      close()
      reject(Error(event.message || 'The depth worker stopped.'))
    }
    worker.postMessage({ photo, model } satisfies PhotoDepthRequest)
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
