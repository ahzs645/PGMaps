import type { RestorationOptions, RestorationResult } from './model'
import type { Progress } from './run'

/** Files are cloned as Blob handles; decoded point records never cross to the UI thread. */
export function runRestorationWorker(
  files: File[],
  options: RestorationOptions,
  signal?: AbortSignal,
  onProgress?: (p: Progress) => void,
): Promise<RestorationResult> {
  signal?.throwIfAborted()
  const worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })
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
        onProgress?.(data.progress)
        return
      }
      finish()
      if (data.type === 'done') resolve(data.result)
      else reject(Error(data.message))
    }
    worker.onerror = (event) => {
      finish()
      reject(Error(event.message || 'The restoration worker failed.'))
    }
    worker.postMessage({ files, options })
  })
}
