import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPreviewTerrainLoader, loadPreviewTerrain } from './previewTerrainCache'
import { DRIVE_FOREST_CONTEXT_METERS, driveForestTerrainRange, type ForestContextRead } from './driveForestTerrain'
import { fetchOpenGround } from './bcVegetationInventory'
import { demTileRange, type Bounds, type ElevationSource } from '@/lib/forestry/terrain/terrain'
import { haversineMeters, polygonBounds, type PolygonGeometry } from './visibility'

/** Most decoded tiles one road view mosaic holds (~32 MB). */
export const DRIVE_TERRAIN_MAX_TILES = 128
/** The finest and coarsest zooms the mosaic is loaded at. */
export const DRIVE_TERRAIN_ZOOMS = { finest: 14, coarsest: 10 } as const

// Kept separately so the background never evicts a decoded road-view mosaic.
const loadForestContext = createPreviewTerrainLoader()
/**
 * The background reads made, by request: its terrain and its inventory together, so a road view closed and opened
 * again, or a page that asks for the same ground twice, gets the very read it had (and the background band's patches,
 * kept under its key, are reused). Two, as the terrain loader keeps two mosaics. Only a whole read is kept (no terrain
 * tile missing, no inventory tile failed, capped or cut short by the time limit): a partial one is shown but asked for
 * again next time. Each is kept with the retry it was read on, and a later retry reads it afresh, once.
 */
const forestContextReads = new Map<string, { read: ForestContextRead; attempt: number }>()
let forestContextReadCount = 0
const FOREST_CONTEXT_READS_KEPT = 2

/**
 * The background read that answers `request`, or null while its read is still to come. A read that came is matched by
 * the request's key, not its identity: a new extent over the same ground keeps the band. A failed read answers only
 * the very request it was made for: every new request starts a new read (failures are never kept), so a retry, or the
 * option switched off and on again, shows as loading rather than as the old failure.
 */
export function answeringContext<R extends { key: string }, T extends { request: R | null; read: unknown }>(
  context: T | null,
  request: R | null,
): T | null {
  if (!request || !context?.request || context.request.key !== request.key) return null
  return context.read || context.request === request ? context : null
}

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

/** How many loaded mosaics the road view holds by their tile range: where the reviewer stood and where a capture stands. */
export const DRIVE_TERRAIN_HELD = 2

/** A mosaic's tile range as a key: two requests over the same tiles load the same ground. */
export const driveTerrainKey = (range: ReturnType<typeof driveTerrainRange>['range']) =>
  `${range.zoom}/${range.minX}/${range.minY}/${range.maxX}/${range.maxY}`

/**
 * The last `limit` loaded mosaics by tile range, the most recently used kept longest. Standing at a view and back
 * again asks for the same tiles: the road view takes the very `ElevationSource` it had, at once, so the drawn timber
 * keyed to it (`forestPatches`) is not grown again from nothing.
 */
export function createHeldTerrain<T>(limit = DRIVE_TERRAIN_HELD) {
  const held = new Map<string, T>()
  return {
    get(key: string): T | undefined {
      const value = held.get(key)
      if (value !== undefined) {
        held.delete(key)
        held.set(key, value)
      }
      return value
    },
    set(key: string, value: T) {
      held.delete(key)
      held.set(key, value)
      while (held.size > limit) held.delete(held.keys().next().value!)
    },
    /** The value without counting it as used: for reading in a render. */
    peek: (key: string): T | undefined => held.get(key),
    clear: () => held.clear(),
  }
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
  drawForestContext = false,
) {
  const [attempt, setAttempt] = useState(0)
  // Complete mosaics by tile range (`createHeldTerrain`); a retry loads afresh, so it lets them all go.
  const [held] = useState(() => createHeldTerrain<ElevationSource>())
  const retry = useCallback(() => {
    held.clear()
    setAttempt((value) => value + 1)
  }, [held])
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
  const heldKey = request && !request.tooLarge ? driveTerrainKey(request.range) : null
  useEffect(() => {
    if (!request || request.tooLarge) return
    // A held mosaic is shown as it is (below), never loaded again.
    if (held.get(driveTerrainKey(request.range))) return
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
          // Only a whole mosaic is held: one with tiles missing is asked for again, as the loader's cache does.
          if (source && !missingTileCount) held.set(driveTerrainKey(request.range), source)
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
  }, [request, held])
  // The background band's read (View options → *Distant trees*): asked for only while the caller keeps the stand
  // (`drawForestContext`), and only where the road view's own ground stops short of its reach.
  const contextWanted = active && drawForestContext && !!extent
  const contextRequest = useMemo(() => {
    if (!contextWanted || !extent || extent.radius >= DRIVE_FOREST_CONTEXT_METERS) return null
    const range = driveForestTerrainRange(extent.bounds)
    if (!range) return null
    const [w, s, e, n] = extent.bounds
    const centre = { lng: (w + e) / 2, lat: (s + n) / 2 }
    const radius = DRIVE_FOREST_CONTEXT_METERS + extent.radius / 2
    const key = [
      range.zoom,
      range.minX,
      range.minY,
      range.maxX,
      range.maxY,
      centre.lng.toFixed(6),
      centre.lat.toFixed(6),
      Math.round(radius),
    ].join('/')
    return { key, range, centre, radius, attempt }
  }, [contextWanted, extent, attempt])
  const [context, setContext] = useState<{ request: typeof contextRequest; read: ForestContextRead | null } | null>(
    null,
  )
  useEffect(() => {
    if (!contextRequest) return
    const controller = new AbortController()
    const { key, range, centre, radius, attempt } = contextRequest
    const finish = (read: ForestContextRead | null) => {
      if (!controller.signal.aborted) setContext({ request: contextRequest, read })
    }
    const kept = forestContextReads.get(key)
    // A read made before the reviewer's latest retry is read again; one made on it (or a later one) is kept.
    if (kept && kept.attempt < attempt) forestContextReads.delete(key)
    else if (kept) {
      // Most recently used last, so the other one is the one let go.
      forestContextReads.delete(key)
      forestContextReads.set(key, kept)
      void Promise.resolve().then(() => finish(kept.read))
      return () => controller.abort()
    }
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)])
    void Promise.all([
      loadForestContext({ range, signal, concurrency: 2 }, attempt > 0),
      fetchOpenGround(centre, radius, { signal, maxTiles: 9, timeoutMs: 8000 }),
    ])
      .then(([{ source, missingTileCount }, cover]) => {
        if (!source || !cover.complete.length) return finish(null)
        const read: ForestContextRead = {
          key: `${key}#${++forestContextReadCount}`,
          source,
          complete: cover.complete,
          stands: cover.stands,
        }
        // Shown either way (unread ground stays empty), kept only whole: the time limit cuts the inventory short
        // without counting a tile failed, so a read whose signal has run out is partial too.
        const whole = !missingTileCount && !cover.failed && !cover.capped && !signal.aborted
        if (whole) {
          forestContextReads.set(key, { read, attempt })
          while (forestContextReads.size > FOREST_CONTEXT_READS_KEPT)
            forestContextReads.delete(forestContextReads.keys().next().value!)
        }
        finish(read)
      })
      .catch(() => finish(null))
    return () => controller.abort()
  }, [contextRequest])
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
        : (() => {
            const source = heldKey ? held.peek(heldKey) : undefined
            return source
              ? { source, message: null, progress: 100, loading: false, extent: request.extent }
              : { source: null, message: pendingMessage, progress: 0, loading: true }
          })()
  const activeContext = answeringContext(context, contextRequest)
  const forestContextNote = !contextWanted
    ? null
    : !contextRequest
      ? extent && extent.radius >= DRIVE_FOREST_CONTEXT_METERS
        ? 'The road view’s own ground already reaches past 8 km.'
        : 'The scene is too wide for the distant-tree terrain.'
      : !activeContext
        ? 'Loading terrain and inventory for distant trees…'
        : activeContext.read
          ? null
          : 'Distant trees could not be read; the road view keeps its own extent.'
  return {
    source: visible.source,
    /** The background read, once it has come; null while it loads, failed or is off. */
    forestContext: activeContext?.read ?? null,
    forestContextLoading: !!contextRequest && !activeContext,
    /** One line for View options → *Distant trees*: why there are none yet, or none at all. */
    forestContextNote,
    message: visible.message,
    progress: visible.progress,
    loading: visible.loading,
    extent: 'extent' in visible ? visible.extent : undefined,
    retry,
    radius: extent?.radius ?? 3500,
  }
}
