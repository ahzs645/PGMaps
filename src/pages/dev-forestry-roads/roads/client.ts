import type { NetworkWorkerRequest, NetworkWorkerResponse } from './network.worker'
import type { RoadsInput, RoadsLanding, RoadsResult } from './types'

/** One disposable worker per run. Cancellation terminates computation immediately. Inputs remain reusable. */
export function runProjection(
  input: RoadsInput,
  {
    signal,
    onProgress,
    stages,
  }: {
    signal?: AbortSignal
    onProgress?: (message: string) => void
    stages?: RoadsLanding[][]
  } = {},
): Promise<RoadsResult> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./network.worker.ts', import.meta.url), { type: 'module' })
    } catch (cause) {
      reject(cause)
      return
    }
    let settled = false
    const finish = (error?: unknown, result?: RoadsResult) => {
      if (settled) return
      settled = true
      worker.terminate()
      signal?.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve(result!)
    }
    const abort = () => finish(signal?.reason ?? new DOMException('Network calculation cancelled.', 'AbortError'))
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) {
      abort()
      return
    }
    worker.onmessage = (event: MessageEvent<NetworkWorkerResponse>) => {
      const message = event.data
      if (message.type === 'progress') onProgress?.(message.message)
      else if (message.type === 'error') finish(Error(message.message))
      else finish(undefined, message.result)
    }
    worker.onerror = (event) => finish(Error(event.message || 'The road-network worker could not run.'))
    worker.onmessageerror = () => finish(Error('The browser could not read the road-network worker result.'))
    const request: NetworkWorkerRequest = { input, stages }
    try {
      worker.postMessage(request)
    } catch (cause) {
      finish(cause)
    }
  })
}
