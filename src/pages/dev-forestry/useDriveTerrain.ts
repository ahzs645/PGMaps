import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadElevationGrid } from './demLoader'
import { demTileRange, type Bounds, type ElevationSource } from './terrain'
import { haversineMeters, polygonBounds, type PolygonGeometry } from './visibility'

/** A bounded, fixed DEM mosaic is loaded before growing trees. Camera movement
 * cannot change a stem's elevation or turn an unloaded tile into sea level.
 * Fetching the whole route also warms the browser's terrain cache ahead of travel. */
export function useDriveTerrain(active: boolean, road: number[][], polygons: PolygonGeometry[]) {
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt(value => value + 1), [])
  const [progress, setProgress] = useState(0)
  const [loading, setLoading] = useState(false)
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
  const [state, setState] = useState<{ source: ElevationSource | null; message: string | null }>({
    source: null,
    message: null,
  })
  useEffect(() => {
    setProgress(0)
    setLoading(false)
    if (!active || !extent) {
      setState({ source: null, message: null })
      return
    }
    const abort = new AbortController()
    // Include roadside foreground and the full assessment hillside. At most
    // 128 decoded tiles (~32 MB); finer near-road data is not fabricated.
    let zoom = 14
    let range = demTileRange(extent.bounds, zoom, 1000)
    while (range.tileCount > 128 && zoom > 10) range = demTileRange(extent.bounds, --zoom, 1000)
    if (range.tileCount > 128) {
      setState({
        source: null,
        message: 'Preview extent is too large. Use a shorter road or a smaller assessment area.',
      })
      return
    }
    setLoading(true)
    setState({ source: null, message: 'Loading terrain along the road and assessment hillside…' })
    loadElevationGrid({ range, signal: abort.signal, concurrency: 4, onProgress: (completed, total) => { if (!abort.signal.aborted) setProgress(Math.round(100 * completed / total)) } })
      .then(({ grid, missingTileCount }) => {
        if (!abort.signal.aborted) {
          setLoading(false)
          setState({
            source: missingTileCount === range.tileCount ? null : grid,
            message: missingTileCount
              ? `${missingTileCount} terrain tiles unavailable; trees are omitted where ground is unknown.`
              : null,
          })
        }
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted) {
          setLoading(false)
          setState({ source: null, message: `Preview terrain could not load: ${String(error)}` })
        }
      })
    return () => abort.abort()
  }, [active, extent, attempt])
  return { ...state, progress, loading, retry, radius: extent?.radius ?? 3500 }
}
