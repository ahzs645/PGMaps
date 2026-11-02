import type { CastorReportProgress } from '@/features/forestry-castor/outputs'
import type { CastorProject, CastorResult } from '@/features/forestry-castor/types'
import { castorChunks, yieldToPage } from './chunks'
import type { CastorReportRequest, CastorReportResponse } from './protocol'

const PROGRESS_INTERVAL_MS = 200
const cancelled = () => new DOMException('The report export was cancelled.', 'AbortError')

/**
 * Streams the project and result to a report worker in small messages,
 * yielding to the page between them, then asks it to build the archive.
 * Returns false if `stopped` reported true before everything was sent.
 */
export async function sendCastorReportRequest(
  project: CastorProject,
  result: CastorResult,
  post: (request: CastorReportRequest, transfer: Transferable[]) => void,
  stopped: () => boolean = () => false,
): Promise<boolean> {
  for (const [target, value] of [
    ['project', project],
    ['result', result],
  ] as const)
    for (const { chunk, transfer } of castorChunks(target, value)) {
      if (stopped()) return false
      post({ type: 'chunk', chunk }, transfer)
      await yieldToPage()
    }
  if (stopped()) return false
  post({ type: 'build' }, [])
  return true
}

/**
 * Builds the complete report ZIP in a dedicated worker so serialising,
 * rasterising and compressing hundreds of megabytes never blocks the page.
 * Aborting the signal terminates the worker.
 */
export function buildCastorReportInWorker(
  project: CastorProject,
  result: CastorResult,
  options: { onProgress?: (progress: CastorReportProgress) => void; signal?: AbortSignal } = {},
): Promise<Blob> {
  const { signal, onProgress } = options
  return new Promise<Blob>((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancelled())
      return
    }
    let worker: Worker
    try {
      worker = new Worker(new URL('./castorReport.worker.ts', import.meta.url), { type: 'module' })
    } catch (cause: unknown) {
      reject(cause instanceof Error ? cause : new Error('The report worker could not start.'))
      return
    }
    let settled = false
    const finish = () => {
      settled = true
      worker.terminate()
      signal?.removeEventListener('abort', abort)
    }
    const abort = () => {
      finish()
      reject(cancelled())
    }
    signal?.addEventListener('abort', abort, { once: true })
    // Compression reports every percent; repainting the page that often is wasted work.
    let reportedAt = -Infinity
    worker.onmessage = (event: MessageEvent<CastorReportResponse>) => {
      const response = event.data
      if (response.type === 'progress') {
        const now = performance.now()
        if (now - reportedAt < PROGRESS_INTERVAL_MS) return
        reportedAt = now
        onProgress?.(response.progress)
        return
      }
      finish()
      if (response.type === 'complete') resolve(new Blob([response.bytes], { type: 'application/zip' }))
      else reject(new Error(response.message))
    }
    worker.onerror = (event) => {
      event.preventDefault()
      finish()
      reject(new Error('The report worker could not complete. The scenario may be too large for this browser.'))
    }
    onProgress?.({ message: 'Sending scenario to the report worker…', fraction: 0 })
    sendCastorReportRequest(
      project,
      result,
      (request, transfer) => worker.postMessage(request, transfer),
      () => settled,
    )
      .then(() => undefined)
      .catch((cause: unknown) => {
        if (settled) return
        finish()
        reject(cause instanceof Error ? cause : new Error('The scenario could not be sent to the report worker.'))
      })
  })
}
