import type { Rgba } from './photoViews'

export type DepthGrid = { width: number; height: number; inverse: Float32Array }
export type PhotoDepthModel = 'da2-small' | 'da3-small'
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
