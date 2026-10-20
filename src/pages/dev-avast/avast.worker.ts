/// <reference lib="webworker" />
/**
 * Runs the overlay off the main thread and posts each candidate as it
 * finishes. DEM tiles come through the forestry loader, which shares its
 * decoded-tile and Cache Storage caches with the other terrain tools.
 */
import { loadElevationGrid } from '../dev-forestry/demLoader'
import { demTileRange } from '../dev-forestry/terrain'
import { albersBoxToLngLat, albersToLngLat } from './projection'
import { runOverlay, type ElevationFactory } from './run'
import type { AvastWorkerRequest, AvastWorkerResponse } from './workerProtocol'

let controller: AbortController | null = null

const post = (message: AvastWorkerResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(message)

self.onmessage = async (event: MessageEvent<AvastWorkerRequest>) => {
  const message = event.data
  if (message.type === 'cancel') {
    controller?.abort()
    return
  }
  controller?.abort()
  const local = new AbortController()
  controller = local
  const { runId, candidates, avast, lidar, settings } = message
  const elevation: ElevationFactory = async (bbox) => {
    const range = demTileRange(albersBoxToLngLat(bbox), settings.demZoom, 0)
    const { grid, missingTileCount } = await loadElevationGrid({ range, signal: local.signal, concurrency: 6 })
    return { elevationAt: (x, y) => grid.elevationAt(...albersToLngLat(x, y)), missingTiles: missingTileCount }
  }
  try {
    await runOverlay({
      candidates,
      avast,
      lidar,
      settings,
      elevation,
      signal: local.signal,
      onCandidate: ({ index, total, candidate, overlay }) => post({ type: 'candidate', runId, index, total, key: candidate.key, overlay }),
    })
    if (!local.signal.aborted) post({ type: 'done', runId })
  } catch (error) {
    if (local.signal.aborted) post({ type: 'cancelled', runId })
    else post({ type: 'error', runId, message: error instanceof Error ? error.message : String(error) })
  }
}
