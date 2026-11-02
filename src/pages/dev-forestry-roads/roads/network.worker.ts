/// <reference lib="webworker" />
import { runNetworkStages, summarizeRoadsResult } from './stages'
import type { RoadsInput, RoadsLanding, RoadsResultSummary } from './types'

export type NetworkWorkerRequest = { input: RoadsInput; stages?: RoadsLanding[][] }
export type NetworkWorkerResponse =
  | { type: 'progress'; message: string }
  | { type: 'done'; result: RoadsResultSummary }
  | { type: 'error'; message: string }
const scope = globalThis as unknown as DedicatedWorkerGlobalScope
scope.onmessage = (event: MessageEvent<NetworkWorkerRequest>) => {
  const post = (message: NetworkWorkerResponse) => scope.postMessage(message)
  try {
    // The routing graph (~50 MB at the cell limit) is not posted back: the interface only needs paths,
    // targets and road cells, and retaining one graph per compared method could exhaust mobile memory.
    const result = summarizeRoadsResult(
      runNetworkStages(event.data.input, event.data.stages, {
        onProgress: ({ phase, completed, total }) =>
          post({
            type: 'progress',
            message: `${phase === 'graph' ? 'Building graph' : phase === 'mst' ? 'Spanning tree' : 'Routing'} · ${completed}/${total}`,
          }),
      }),
    )
    const buffers = [result.simulation.grid.values.buffer, result.simulation.constructedEdges.buffer].filter(
      (buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer,
    )
    scope.postMessage({ type: 'done', result } satisfies NetworkWorkerResponse, buffers)
  } catch (cause) {
    post({ type: 'error', message: cause instanceof Error ? cause.message : String(cause) })
  }
}
