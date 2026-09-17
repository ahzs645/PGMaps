/**
 * Runs a visibility analysis off the main thread: fetch the DEM tiles the run
 * needs, then walk every sightline. A corridor of a few hundred stations
 * against a few thousand samples is seconds of arithmetic, which would
 * otherwise freeze the map mid-drag.
 */

import { analysisBounds, buildStations, computeAnalysis } from './analysis'
import { fetchVegetationStands, forestedGeometries } from './bcVegetationInventory'
import type { CanopyStand } from './canopy'
import { loadElevationGrid } from './demLoader'
import { DEFAULT_REVERSE_SETTINGS, computeReverseViewshed } from './reverseViewshed'
import { MAX_DEM_TILES, demResolutionMeters, demTileRange } from './terrain'
import { polygonBounds, type PolygonGeometry } from './visibility'
import type { AnalysisWorkerRequest, AnalysisWorkerResponse } from './types'

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<AnalysisWorkerRequest>) => void) | null
  postMessage: (message: AnalysisWorkerResponse, transfer?: Transferable[]) => void
}

/** DEM tiles are worth keeping between runs: settings change far more often than terrain. */
const post = (message: AnalysisWorkerResponse, transfer?: Transferable[]) => {
  workerScope.postMessage(message, transfer)
}

async function runAnalysis(request: Extract<AnalysisWorkerRequest, { type: 'analyze' }>) {
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

  // One vegetation query answers two questions: which ground is treed, which
  // is what the planimetric figure divides by, and how tall that timber is,
  // which is what screens a view. Both are optional context — a failed query
  // costs accuracy, not the whole run — so each degrades on its own.
  let canopyStands: CanopyStand[] = []
  let forestedGround: PolygonGeometry[] = []
  const wantsGreenArea = input.targets.some((target) => target.role === 'landscape')
  if (input.settings.screeningEnabled || wantsGreenArea) {
    try {
      const { stands } = await fetchVegetationStands(bounds)
      if (wantsGreenArea) forestedGround = forestedGeometries(stands)
      if (input.settings.screeningEnabled) {
        canopyStands = stands.flatMap((stand) =>
          stand.treed && stand.heightMeters !== null && stand.heightMeters > 0
            ? [
                {
                  heightMeters: stand.heightMeters,
                  crownClosurePercent: stand.crownClosurePercent,
                  speciesCode: stand.speciesCode,
                  geometry: stand.geometry,
                },
              ]
            : [],
        )
      }
    } catch {
      canopyStands = []
      forestedGround = []
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
    forestedGround,
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

/**
 * The reverse run: fetch terrain over the blocks and every road, then score the
 * roads. Blocks are few and roads are many, so the DEM is the same cost and the
 * sightline count is bounded by the road sampling rather than the grid.
 */
async function runReverse(request: Extract<AnalysisWorkerRequest, { type: 'reverse' }>) {
  const { requestId, input } = request
  if (input.blocks.length === 0) throw new Error('Draw or select a block first')
  if (input.roads.length === 0) throw new Error('No roads in view to test against')

  // Terrain has to cover both ends of every sightline: the blocks and the roads.
  const lngs = input.roads.flatMap((road) => road.coordinates.map(([lng]) => lng))
  const lats = input.roads.flatMap((road) => road.coordinates.map(([, lat]) => lat))
  for (const block of input.blocks) {
    const blockBounds = polygonBounds(block.geometry)
    lngs.push(blockBounds[0], blockBounds[2])
    lats.push(blockBounds[1], blockBounds[3])
  }
  if (lngs.length === 0) throw new Error('Nothing to work from')

  const bounds: [number, number, number, number] = [
    Math.min(...lngs),
    Math.min(...lats),
    Math.max(...lngs),
    Math.max(...lats),
  ]

  const range = demTileRange(bounds, input.settings.demZoom, 600)
  if (range.tileCount > MAX_DEM_TILES) {
    throw new Error(`This view needs ${range.tileCount} terrain tiles. Zoom in, or lower the terrain detail.`)
  }

  post({ type: 'progress', requestId, progress: { phase: 'terrain', completed: 0, total: range.tileCount } })
  const { grid } = await loadElevationGrid({
    range,
    onProgress: (completed, total) => {
      post({ type: 'progress', requestId, progress: { phase: 'terrain', completed, total } })
    },
  })

  post({ type: 'progress', requestId, progress: { phase: 'sightlines', completed: 0, total: 1 } })
  const result = computeReverseViewshed(
    grid,
    input.blocks.map((block) => block.geometry),
    input.roads,
    {
      ...DEFAULT_REVERSE_SETTINGS,
      observerHeightMeters: input.settings.observerHeightMeters,
      targetOffsetMeters: input.settings.targetOffsetMeters,
      maxViewDistanceMeters: input.settings.maxViewDistanceMeters,
      demResolutionMeters: demResolutionMeters(bounds[1], input.settings.demZoom),
    },
  )

  post({ type: 'reverse-result', requestId, result })
}

workerScope.onmessage = (event: MessageEvent<AnalysisWorkerRequest>) => {
  const request = event.data
  if (request?.type === 'reverse') {
    runReverse(request).catch((error: unknown) => {
      post({
        type: 'error',
        requestId: request.requestId,
        message: error instanceof Error ? error.message : String(error),
      })
    })
    return
  }
  if (request?.type !== 'analyze') return
  runAnalysis(request).catch((error: unknown) => {
    post({
      type: 'error',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    })
  })
}
