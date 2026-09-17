/**
 * Runs a visibility analysis off the main thread: fetch the DEM tiles the run
 * needs, then walk every sightline. A corridor of a few hundred stations
 * against a few thousand samples is seconds of arithmetic, which would
 * otherwise freeze the map mid-drag.
 */

import { analysisBounds, buildStations, computeAnalysis } from './analysis'
import { fetchCanopyStands } from './bcVisualInventory'
import type { CanopyStand } from './canopy'
import { loadElevationGrid } from './demLoader'
import { MAX_DEM_TILES, demResolutionMeters, demTileRange } from './terrain'
import type { AnalysisWorkerRequest, AnalysisWorkerResponse } from './types'

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<AnalysisWorkerRequest>) => void) | null
  postMessage: (message: AnalysisWorkerResponse, transfer?: Transferable[]) => void
}

/** DEM tiles are worth keeping between runs: settings change far more often than terrain. */
const post = (message: AnalysisWorkerResponse, transfer?: Transferable[]) => {
  workerScope.postMessage(message, transfer)
}

async function runAnalysis(request: AnalysisWorkerRequest) {
  const { requestId, input } = request
  const stations = buildStations(input)
  if (stations.length === 0) throw new Error('Place a viewpoint on the road first')
  if (input.targets.length === 0) throw new Error('Add at least one polygon to assess')

  const bounds = analysisBounds(input, stations)
  if (!bounds) throw new Error('Nothing in range of the viewpoint')

  // Pad by a tile so terrain normals and grazing sightlines at the edge of the
  // area still have ground under them.
  const range = demTileRange(bounds, input.settings.demZoom, 600)
  if (range.tileCount > MAX_DEM_TILES) {
    throw new Error(
      `This area needs ${range.tileCount} terrain tiles at zoom ${input.settings.demZoom}. ` +
        'Lower the terrain detail or shorten the view distance.',
    )
  }

  post({
    type: 'progress',
    requestId,
    progress: { phase: 'terrain', completed: 0, total: range.tileCount },
  })

  const { grid, missingTileCount } = await loadElevationGrid({
    range,
    onProgress: (completed, total) => {
      post({ type: 'progress', requestId, progress: { phase: 'terrain', completed, total } })
    },
  })

  // Terrain the mosaic is missing never blocks a sightline, so a run built on
  // mostly-absent tiles would report everything as visible. A stray hole is
  // worth a warning; this much of one is worth refusing to answer.
  if (missingTileCount > range.tileCount / 3) {
    throw new Error(
      `Only ${range.tileCount - missingTileCount} of ${range.tileCount} terrain tiles loaded. ` +
        'Check the connection and run again.',
    )
  }

  // Screening timber is optional context: a failed inventory query costs
  // accuracy, not the whole run, so it degrades to a bare-earth answer.
  let canopyStands: CanopyStand[] = []
  if (input.settings.screeningEnabled) {
    try {
      const canopy = await fetchCanopyStands(bounds)
      canopyStands = canopy.stands
    } catch {
      canopyStands = []
    }
  }

  const result = computeAnalysis(
    grid,
    input,
    {
      tileCount: range.tileCount,
      missingTileCount,
      resolutionMeters: demResolutionMeters(stations[0].lat, input.settings.demZoom),
    },
    (progress) => post({ type: 'progress', requestId, progress }),
    canopyStands,
  )

  // Sample buffers are the bulk of the payload; handing over their memory
  // avoids a structured clone of every grid point.
  const transfer = result.targets.flatMap((target) => [
    target.positions.buffer,
    target.elevations.buffer,
    target.anyVisible.buffer,
    target.visibleByStation.buffer,
    target.visibleDistances.buffer,
  ]) as Transferable[]

  post({ type: 'result', requestId, result }, transfer)
}

workerScope.onmessage = (event: MessageEvent<AnalysisWorkerRequest>) => {
  const request = event.data
  if (request?.type !== 'analyze') return
  runAnalysis(request).catch((error: unknown) => {
    post({
      type: 'error',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    })
  })
}
