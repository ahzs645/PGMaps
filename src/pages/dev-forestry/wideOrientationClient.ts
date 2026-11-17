import type { WideSearchInput, WideSearchResult } from './wideOrientation'

/** Searches in a worker; aborting terminates it at once. */
export function runWideOrientation(
  input: Omit<WideSearchInput, 'onProgress' | 'cancelled'>,
  signal?: AbortSignal,
  onProgress?: (done: number) => void,
): Promise<WideSearchResult | null> {
  signal?.throwIfAborted()
  const worker = new Worker(new URL('./wideOrientation.worker.ts', import.meta.url), { type: 'module' })
  return new Promise((resolve, reject) => {
    const finish = () => {
      worker.terminate()
      signal?.removeEventListener('abort', abort)
    }
    const abort = () => {
      finish()
      reject(signal?.reason ?? new DOMException('Cancelled', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') {
        onProgress?.(data.done)
        return
      }
      finish()
      if (data.type === 'done') resolve(data.result)
      else reject(Error(data.message))
    }
    worker.onerror = (event) => {
      finish()
      reject(Error(event.message || 'The camera search failed.'))
    }
    worker.postMessage(input)
  })
}
