import type { ReliefInput, ReliefResult } from './hillshadeRelief'

/**
 * `refineWithHillshade` in a worker: a sheet of two million cells takes the better part of a
 * minute, too long for the page's thread. Aborting the signal stops the worker at once.
 */
export function refineWithHillshadeInWorker(
  input: ReliefInput,
  signal?: AbortSignal,
  onProgress?: (progress: number) => void,
): Promise<ReliefResult> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./hillshadeRelief.worker.ts', import.meta.url), { type: 'module' })
    const close = () => {
      signal?.removeEventListener('abort', abort)
      worker.terminate()
    }
    const abort = () => {
      close()
      reject(signal?.reason ?? new DOMException('Refinement cancelled.', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    worker.onerror = () => {
      close()
      reject(Error('The hillshade refinement could not run in this browser.'))
    }
    worker.onmessage = ({
      data,
    }: MessageEvent<{ type?: string; progress?: number; result?: ReliefResult; error?: string }>) => {
      if (data.type === 'relief-progress') {
        onProgress?.(data.progress ?? 0)
        return
      }
      if (data.type !== 'relief-result') return
      close()
      if (data.result) resolve(data.result)
      else reject(Error(data.error ?? 'The hillshade could not refine the contours.'))
    }
    // Copies, not transfers: the caller keeps its contour surface whether or not this succeeds.
    worker.postMessage({ input })
  })
}
