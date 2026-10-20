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
import { buildVriIndex, vriFillCandidate } from './vriFill'
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
  if (message.type === 'vri') {
    const { runId, candidates, avastPieces, vri, minPieceHa } = message
    const search = buildVriIndex(vri)
    const byCandidate = new Map<string, typeof avastPieces>()
    for (const piece of avastPieces) byCandidate.set(piece.candidateKey, [...(byCandidate.get(piece.candidateKey) ?? []), piece])
    try {
      for (const [index, candidate] of candidates.entries()) {
        if (local.signal.aborted) throw new DOMException('Cancelled', 'AbortError')
        const pieces = vriFillCandidate(candidate, byCandidate.get(candidate.key) ?? [], search, minPieceHa)
        post({ type: 'vri-candidate', runId, index, total: candidates.length, key: candidate.key, pieces })
        // Yield so a cancel message can arrive between blocks.
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      post({ type: 'done', runId })
    } catch (error) {
      if (local.signal.aborted) post({ type: 'cancelled', runId })
      else post({ type: 'error', runId, message: error instanceof Error ? error.message : String(error) })
    }
    return
  }
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
