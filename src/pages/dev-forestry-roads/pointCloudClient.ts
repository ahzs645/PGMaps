/**
 * Promise wrapper around `pointCloud.worker.ts`: one fresh worker per call, terminated when the
 * call settles or its signal aborts.
 */
import type {
  PointCloudBreaklinesReply,
  PointCloudWorkerRequest,
  PointCloudWorkerResponse,
  PointCloudWorkerStage,
} from './pointCloud.worker'
import type { Breakline } from './tinSurface'

export type PointCloudResult = Extract<PointCloudWorkerResponse, { type: 'done' }>

export interface RunPointCloudOptions extends Omit<PointCloudWorkerRequest, 'bytes' | 'askBreaklines'> {
  onProgress?: (stage: PointCloudWorkerStage, done: number, total: number) => void
  signal?: AbortSignal
  /** Hand an ArrayBuffer input to the worker instead of copying it; it is detached afterwards. */
  transfer?: boolean
  /**
   * Called once the cloud is read, before the ground filter, with the CRS the worker found (the
   * header's, or for a LAZ without header keys, whitebox's). Returns the surface's breaklines in
   * that CRS, replacing `surface.breaklines`; throwing ends the call with that error.
   */
  breaklinesFor?: (epsg: number | null) => Breakline[]
}

export async function runPointCloudWorker(
  input: Blob | ArrayBuffer | Uint8Array,
  { onProgress, signal, transfer = false, breaklinesFor, ...request }: RunPointCloudOptions,
): Promise<PointCloudResult> {
  signal?.throwIfAborted()
  let bytes: ArrayBuffer
  if (input instanceof Blob) bytes = await input.arrayBuffer()
  else if (input instanceof ArrayBuffer) bytes = transfer ? input : input.slice(0)
  else bytes = input.slice().buffer
  signal?.throwIfAborted()
  const worker = new Worker(new URL('./pointCloud.worker.ts', import.meta.url), { type: 'module' })
  return new Promise<PointCloudResult>((resolve, reject) => {
    const finish = () => {
      worker.terminate()
      signal?.removeEventListener('abort', abort)
    }
    const abort = () => {
      finish()
      reject(signal?.reason ?? new DOMException('The point-cloud import was cancelled.', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    worker.onmessage = (event: MessageEvent<PointCloudWorkerResponse>) => {
      const message = event.data
      if (message.type === 'progress') return onProgress?.(message.stage, message.done, message.total)
      if (message.type === 'crs') {
        try {
          const reply: PointCloudBreaklinesReply = { type: 'breaklines', breaklines: breaklinesFor!(message.epsg) }
          worker.postMessage(reply)
        } catch (error) {
          finish()
          reject(error)
        }
        return
      }
      finish()
      if (message.type === 'done') resolve(message)
      else reject(Error(message.message))
    }
    worker.onerror = (event) => {
      finish()
      reject(Error(event.message || 'The point-cloud worker failed to start.'))
    }
    const message: PointCloudWorkerRequest = { ...request, bytes, askBreaklines: Boolean(breaklinesFor) }
    worker.postMessage(message, [bytes, ...(message.additionalBytes ?? [])])
  })
}
