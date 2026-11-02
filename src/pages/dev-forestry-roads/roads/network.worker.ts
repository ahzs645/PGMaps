/// <reference lib="webworker" />
import { runNetworkStages } from './stages'
import type { RoadsInput, RoadsLanding, RoadsResult } from './types'

export type NetworkWorkerRequest = { input: RoadsInput; stages?: RoadsLanding[][] }
export type NetworkWorkerResponse =
  | { type: 'progress'; message: string }
  | { type: 'done'; result: RoadsResult }
  | { type: 'error'; message: string }
const scope = globalThis as unknown as DedicatedWorkerGlobalScope
scope.onmessage = (event: MessageEvent<NetworkWorkerRequest>) => {
  const post = (message: NetworkWorkerResponse) => scope.postMessage(message)
  try {
    const result = runNetworkStages(event.data.input, event.data.stages, {
      onProgress: ({ phase, completed, total }) =>
        post({
          type: 'progress',
          message: `${phase === 'graph' ? 'Building graph' : phase === 'mst' ? 'Spanning tree' : 'Routing'} · ${completed}/${total}`,
        }),
    })
    // These buffers are no longer needed by this single-use worker. Transfer ownership rather
    // than retaining a second ~50 MB graph copy at the largest supported grid size.
    const buffers = new Set<ArrayBuffer>()
    for (const value of Object.values(result.simulation.graph))
      if (ArrayBuffer.isView(value) && value.buffer instanceof ArrayBuffer) buffers.add(value.buffer)
    buffers.add(result.simulation.grid.values.buffer as ArrayBuffer)
    buffers.add(result.simulation.constructedEdges.buffer as ArrayBuffer)
    scope.postMessage({ type: 'done', result } satisfies NetworkWorkerResponse, [...buffers])
  } catch (cause) {
    post({ type: 'error', message: cause instanceof Error ? cause.message : String(cause) })
  }
}
