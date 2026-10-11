import { demResolutionMeters, demTileRange, type ElevationGrid } from '../dev-forestry/terrain'
import { loadElevationGrid } from '../dev-forestry/demLoader'
import { localRasterResolution, parseRasters, rasterSampler } from '../dev-forestry/localRaster'
import { computeViewshedRow, createViewshedResult, viewshedLayout, type WorkerRequest, type WorkerResponse } from './analysis'

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<WorkerRequest>) => void
  postMessage: (message: WorkerResponse, transfer?: Transferable[]) => void
}
let active: AbortController | null = null
// Cache complete mosaics for height changes and nearby dragging. At most ~32 MB.
const cache: ElevationGrid[] = []
const post = (message: WorkerResponse) => scope.postMessage(message)

async function run(request: Extract<WorkerRequest, { type: 'run' }>, signal: AbortSignal) {
  const { id, input } = request
  const started = performance.now()
  const local = input.localTerrain ? parseRasters([input.localTerrain])[0] : null
  if (local && local.kind !== 'terrain') throw new Error('Import a terrain DEM, not a canopy raster.')
  const resolution = local ? localRasterResolution(local, input.observer.lat) : demResolutionMeters(input.observer.lat, input.demZoom)
  const layout = viewshedLayout(input, resolution)
  const range = demTileRange(layout.bounds, input.demZoom, 100)
  if (!local && range.tileCount > 64) throw new Error('This radius needs too many terrain tiles. Lower terrain detail or reduce the radius.')
  let source = local ? rasterSampler(local) : cache.find((grid) =>
    grid.zoom === range.zoom && grid.range.minX <= range.minX && grid.range.maxX >= range.maxX &&
    grid.range.minY <= range.minY && grid.range.maxY >= range.maxY)
  let missingTiles = 0
  if (!source) {
    post({ type: 'progress', id, message: 'Loading terrain…' })
    const loaded = await loadElevationGrid({
      range, signal,
      onProgress: (completed, total) => {
        if (!signal.aborted) post({ type: 'progress', id, message: `Loading terrain: ${completed}/${total} tiles` })
      },
    })
    if (signal.aborted) return
    source = loaded.grid
    missingTiles = loaded.missingTileCount
    if (missingTiles === range.tileCount) throw new Error('Terrain could not be loaded. Check the connection and retry.')
    if (!missingTiles) { cache.unshift(loaded.grid); cache.length = Math.min(2, cache.length) }
  }
  const result = createViewshedResult(source, input, resolution)
  result.missingTiles = missingTiles
  post({ type: 'progress', id, message: 'Computing terrain sightlines…' })
  for (let row = 0; row < result.layout.size; row++) {
    if (signal.aborted) return
    computeViewshedRow(source, input, result, row)
    if (row % 4 === 3) await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  if (signal.aborted) return
  result.elapsedMs = performance.now() - started
  scope.postMessage({ type: 'result', id, result }, [result.pixels.buffer as ArrayBuffer])
}
scope.onmessage = ({ data }) => {
  active?.abort()
  if (data.type === 'cancel') return
  const controller = new AbortController()
  active = controller
  void run(data, controller.signal).catch((error: unknown) => {
    if (!controller.signal.aborted) post({ type: 'error', id: data.id, message: error instanceof Error ? error.message : String(error) })
  })
}
