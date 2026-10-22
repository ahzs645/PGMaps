/**
 * Promise wrapper around `pointCloud.worker.ts`: one fresh worker per call, terminated when the
 * call settles or its signal aborts.
 */
import type { PointCloudWorkerRequest, PointCloudWorkerResponse, PointCloudWorkerStage } from './pointCloud.worker'

export type PointCloudResult = Extract<PointCloudWorkerResponse, { type: 'done' }>

export interface RunPointCloudOptions extends Omit<PointCloudWorkerRequest, 'bytes'> {
  onProgress?: (stage: PointCloudWorkerStage, done: number, total: number) => void
  signal?: AbortSignal
  /** Hand an ArrayBuffer input to the worker instead of copying it; it is detached afterwards. */
  transfer?: boolean
}

export async function runPointCloudWorker(
  input: Blob | ArrayBuffer | Uint8Array,
  { onProgress, signal, transfer = false, ...request }: RunPointCloudOptions,
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
      finish()
      if (message.type === 'done') resolve(message)
      else reject(Error(message.message))
    }
    worker.onerror = (event) => {
      finish()
      reject(Error(event.message || 'The point-cloud worker failed to start.'))
    }
    const message: PointCloudWorkerRequest = { ...request, bytes }
    worker.postMessage(message, [bytes])
  })
}
