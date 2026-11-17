import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadPreviewTerrain } from './previewTerrainCache'
import { demTileRange, type Bounds, type ElevationSource } from '@/lib/forestry/terrain/terrain'
import { haversineMeters, polygonBounds, type PolygonGeometry } from './visibility'

/** Most decoded tiles one road view mosaic holds (~32 MB). */
export const DRIVE_TERRAIN_MAX_TILES = 128
/** The finest and coarsest zooms the mosaic is loaded at. */
export const DRIVE_TERRAIN_ZOOMS = { finest: 14, coarsest: 10 } as const

/**
 * The tiles the road view loads: the road and blocks' box, widened by `reach` when given (a photo viewpoint's wedge,
 * `photoStandReach`), at the finest zoom that keeps within `DRIVE_TERRAIN_MAX_TILES`. A wider reach costs detail,
 * never more tiles; finer near-road data is not fabricated.
 */
export function driveTerrainRange(bounds: Bounds, reach: Bounds | null = null) {
  const box: Bounds = reach
    ? [
        Math.min(bounds[0], reach[0]),
        Math.min(bounds[1], reach[1]),
        Math.max(bounds[2], reach[2]),
        Math.max(bounds[3], reach[3]),
      ]
    : bounds
  let zoom: number = DRIVE_TERRAIN_ZOOMS.finest
  let range = demTileRange(box, zoom, 1000)
  while (range.tileCount > DRIVE_TERRAIN_MAX_TILES && zoom > DRIVE_TERRAIN_ZOOMS.coarsest)
    range = demTileRange(box, --zoom, 1000)
  return { zoom, range, tooLarge: range.tileCount > DRIVE_TERRAIN_MAX_TILES }
}

/** A bounded, fixed DEM mosaic is loaded before growing trees. Camera movement
 * cannot change a stem's elevation or turn an unloaded tile into sea level.
 * Fetching the whole route also warms the browser's terrain cache ahead of travel.
 * `reach` widens what is loaded for a photo viewpoint taken from the air (`photoStandReach`). */
export function useDriveTerrain(
  active: boolean,
  road: number[][],
  polygons: PolygonGeometry[],
  reach: Bounds | null = null,
) {
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  const extent = useMemo(() => {
    const points = [...road]
    for (const polygon of polygons) {
      const b = polygonBounds(polygon)
      points.push([b[0], b[1]], [b[2], b[3]])
    }
    if (!points.length) return null
    const bounds: Bounds = [Infinity, Infinity, -Infinity, -Infinity]
    for (const [lng, lat] of points) {
      bounds[0] = Math.min(bounds[0], lng)
      bounds[1] = Math.min(bounds[1], lat)
      bounds[2] = Math.max(bounds[2], lng)
      bounds[3] = Math.max(bounds[3], lat)
    }
    // A bounding-box diagonal covers every eye/target pair in linear time,
    // even for an imported road with thousands of vertices.
    const radius = Math.max(
      3500,
      haversineMeters({ lng: bounds[0], lat: bounds[1] }, { lng: bounds[2], lat: bounds[3] }) + 500,
    )
    return { bounds, radius: Math.min(20000, radius) }
  }, [road, polygons])
  // Compared by value: a new array with the same box must not reload the mosaic.
  const reachKey = reach ? reach.join(',') : ''
  const request = useMemo(() => {
    if (!active || !extent) return null
    // Include roadside foreground and the full assessment hillside, and a photo viewpoint's view.
    const reachBox = reachKey ? (reachKey.split(',').map(Number) as Bounds) : null
    const { range, tooLarge } = driveTerrainRange(extent.bounds, reachBox)
    return { extent, range, attempt, tooLarge }
  }, [active, extent, attempt, reachKey])
  const [state, setState] = useState<{
    request: typeof request
    extent?: typeof extent
    source: ElevationSource | null
    message: string | null
    progress: number
    loading: boolean
  } | null>(null)
  const pendingMessage = 'Loading terrain along the road and assessment hillside…'
  useEffect(() => {
    if (!request || request.tooLarge) return
    const abort = new AbortController()
    loadPreviewTerrain(
      {
        range: request.range,
        signal: abort.signal,
        concurrency: 4,
        onProgress: (completed, total) => {
          if (!abort.signal.aborted)
            setState({
              request,
              source: null,
              message: pendingMessage,
              progress: Math.round((100 * completed) / total),
              loading: true,
            })
        },
      },
      request.attempt > 0,
    )
      .then(({ source, missingTileCount }) => {
        if (!abort.signal.aborted) {
          setState((current) => ({
            request,
            extent: request.extent,
            // The camera and tree bases stand on the ground MapLibre draws,
            // which registers DEM samples half a pixel from the analysis grid.
            source,
            message: missingTileCount
              ? `${missingTileCount} terrain tiles unavailable; trees are omitted where ground is unknown.`
              : null,
            progress: current?.request === request ? current.progress : 0,
            loading: false,
          }))
        }
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted)
          setState((current) => ({
            request,
            source: null,
            message: `Preview terrain could not load: ${String(error)}`,
            progress: current?.request === request ? current.progress : 0,
            loading: false,
          }))
      })
    return () => abort.abort()
  }, [request])
  const visible = !request
    ? { source: null, message: null, progress: 0, loading: false }
    : request.tooLarge
      ? {
          source: null,
          message: 'Preview extent is too large. Use a shorter road or a smaller assessment area.',
          progress: 0,
          loading: false,
        }
      : state && state.request === request
        ? state
        : { source: null, message: pendingMessage, progress: 0, loading: true }
  return {
    source: visible.source,
    message: visible.message,
    progress: visible.progress,
    loading: visible.loading,
    extent: 'extent' in visible ? visible.extent : undefined,
    retry,
    radius: extent?.radius ?? 3500,
  }
}
