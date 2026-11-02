/// <reference lib="webworker" />
import { runCastor } from '@/features/forestry-castor/engine'
import { castorChunks } from './chunks'
import type { CastorRequest, CastorResponse } from './protocol'

const scope = globalThis as unknown as DedicatedWorkerGlobalScope

scope.onmessage = (event: MessageEvent<CastorRequest>) => {
  const { id, project, config } = event.data
  const post = (response: CastorResponse, transfer: Transferable[] = []) => scope.postMessage(response, transfer)
  try {
    const started = performance.now()
    const result = runCastor(project, config, {
      onProgress: (progress) => post({ id, type: 'progress', progress }),
    })
    // Small messages keep each deserialisation on the page short; snapshot buffers are transferred.
    for (const { chunk, transfer } of castorChunks('result', result)) post({ id, type: 'chunk', chunk }, transfer)
    post({ id, type: 'complete', elapsedMs: performance.now() - started })
  } catch (cause: unknown) {
    post({ id, type: 'error', message: cause instanceof Error ? cause.message : 'The forest scenario failed.' })
  }
}
