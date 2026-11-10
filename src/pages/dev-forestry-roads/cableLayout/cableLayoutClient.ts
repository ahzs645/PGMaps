/**
 * Promise wrapper around `cableLayout.worker.ts`: one fresh worker per call, terminated when the
 * call settles or its signal aborts, so Cancel stops a search at once.
 */
import { CableLayoutInputError, decodeLayoutResult } from './cableLayout'
import type { CableLayoutInput, CableLayoutResult, LayoutToAnalyse } from './cableLayout'
import type { CableLayoutRequest, CableLayoutResponse } from './cableLayout.worker'

export interface RunCableLayoutOptions {
  signal?: AbortSignal
  /** Share of spans checked (0–1) and how many there are. */
  onProgress?: (done: number, spans: number) => void
}

function call(request: CableLayoutRequest, { signal, onProgress }: RunCableLayoutOptions): Promise<CableLayoutResult> {
  signal?.throwIfAborted()
  const worker = new Worker(new URL('./cableLayout.worker.ts', import.meta.url), { type: 'module' })
  return new Promise<CableLayoutResult>((resolve, reject) => {
    const finish = () => {
      worker.terminate()
      signal?.removeEventListener('abort', abort)
    }
    const abort = () => {
      finish()
      reject(signal?.reason ?? new DOMException('The support search was cancelled.', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    worker.onmessage = (event: MessageEvent<CableLayoutResponse>) => {
      const message = event.data
      if (message.type === 'progress') return onProgress?.(message.done, message.spans)
      finish()
      if (message.type === 'error')
        return reject(message.code ? new CableLayoutInputError(message.code) : new Error(message.message))
      try {
        resolve(decodeLayoutResult(message.buffer))
      } catch (error) {
        reject(error)
      }
    }
    worker.onerror = (event) => {
      finish()
      reject(new Error(event.message || 'The cable-layout worker failed to start.'))
    }
    worker.postMessage(request)
  })
}

/** Finds supports for the line. */
export const searchCableLayout = (input: CableLayoutInput, options: RunCableLayoutOptions = {}) =>
  call({ type: 'search', input }, options)

/** Analyses a given layout at its pre-tension, without searching. */
export const analyzeCableLayout = (
  input: CableLayoutInput,
  layout: LayoutToAnalyse,
  options: RunCableLayoutOptions = {},
) => call({ type: 'analyze', input, layout }, options)
