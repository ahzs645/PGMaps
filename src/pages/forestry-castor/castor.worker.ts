/// <reference lib="webworker" />
import { runCastor } from '@/features/forestry-castor/engine'
import type { CastorRequest, CastorResponse } from './protocol'

const scope = globalThis as unknown as DedicatedWorkerGlobalScope

scope.onmessage = (event: MessageEvent<CastorRequest>) => {
  const { id, project, config } = event.data
  const post = (response: CastorResponse) => scope.postMessage(response)
  try {
    const started = performance.now()
    const result = runCastor(project, config, {
      onProgress: (progress) => post({ id, type: 'progress', progress }),
    })
    post({ id, type: 'complete', result, elapsedMs: performance.now() - started })
  } catch (cause: unknown) {
    post({ id, type: 'error', message: cause instanceof Error ? cause.message : 'The forest scenario failed.' })
  }
}
