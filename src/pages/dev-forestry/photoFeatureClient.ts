import type { FeatureOverlap } from './photoFeatureGeometry'
import type { PhotoMatcher } from './photoMatchers'
import type { Rgba } from './photoViews'

/** Omit pixels after a frame has been sent successfully to this worker. */
export type FeatureFrame = { key: string; pixels?: Rgba }
export type FeatureRequest = {
  reference: FeatureFrame
  target: FeatureFrame
  /** Target to reference normalized focal length, when the recorded lens is known. */
  focalRatio?: number
  /** Which matcher pairs the two photos; XFeat when left out. */
  matcher?: PhotoMatcher
}
export type FeatureReply = FeatureOverlap | { error: string }

/** One feature worker per flight run. Pair calls are sequential, so the worker can reuse descriptors. */
export function openPhotoFeatureMatcher(signal: AbortSignal) {
  const worker = new Worker(new URL('./photoFeatures.worker.ts', import.meta.url), { type: 'module' })
  let stopped: Error | null = null
  const close = () => {
    stopped ??= Error('The flight matcher is closed.')
    worker.terminate()
  }
  return {
    close,
    match: (request: FeatureRequest) => {
      signal.throwIfAborted()
      if (stopped) throw stopped
      return new Promise<FeatureOverlap>((resolve, reject) => {
        const cleanup = () => {
          signal.removeEventListener('abort', abort)
          worker.onmessage = null
          worker.onerror = null
        }
        const abort = () => {
          cleanup()
          close()
          reject(signal.reason)
        }
        signal.addEventListener('abort', abort, { once: true })
        worker.onmessage = ({ data }: MessageEvent<FeatureReply>) => {
          cleanup()
          if ('error' in data) reject(Error(data.error))
          else resolve(data)
        }
        worker.onerror = (event) => {
          cleanup()
          stopped = Error(event.message || 'The flight matcher stopped.')
          close()
          reject(stopped)
        }
        try {
          worker.postMessage(request)
        } catch (error) {
          cleanup()
          reject(error)
        }
      })
    },
  }
}
