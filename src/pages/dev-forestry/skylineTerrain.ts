/**
 * Ground out to the skyline for an engine's capture (`engineCapture.ts`): the road view's own terrain where it has
 * posts, and past it a coarser Terrarium mosaic of the same source round the eye, so the ridges an engine draws
 * behind a landform are real rather than its own invention. Given the frames' bearings, a coarser wide mosaic out to
 * `SKYLINE_MAX_RADIUS_METERS` lets the frames' skyline be found (`skylineReach`), and the ground out to it is
 * reloaded at the finest zoom the tile budget allows. Network access (the DEM tiles); no DOM.
 */

import { createPreviewTerrainLoader } from './previewTerrainCache'
import {
  skylineReach,
  skylineTerrainRadius,
  SKYLINE_MAX_RADIUS_METERS,
  type BearingRange,
  type SkylineReach,
} from './skylineReach'
import { demTileRange, type Bounds, type DemTileRange, type ElevationSource } from './terrain'
import { metersPerDegree } from './visibility'

/** Most tiles one skyline mosaic may take; the zoom steps down until it fits (z12 at 15 km in B.C.: about 36). */
const MAX_SKYLINE_TILES = 48

// Their own caches, so a capture never evicts the road view's two mosaics: the 15 km mosaic and the one reloaded
// to the skyline in one, the wide scanning mosaic in the other.
const loadSkyline = createPreviewTerrainLoader()
const loadWide = createPreviewTerrainLoader()

export type SkylineTerrain = {
  /** The near terrain where it reads, the skyline mosaics elsewhere; null when the 15 km mosaic could not load. */
  source: ElevationSource | null
  zoom: number
  missingTileCount: number
  /** The frames' skyline (`skylineReach`); null without bearings or when the wide mosaic could not load. */
  reach: SkylineReach | null
  /** The mosaic past the 15 km one, when one loaded: its zoom, radius and missing tiles. */
  outer: { zoom: number; radiusMeters: number; missingTileCount: number } | null
}

/** `near` where it has a value, else `far`. */
export function layeredElevation(near: ElevationSource | null, far: ElevationSource): ElevationSource {
  return {
    elevationAt(lng, lat) {
      const value = near?.elevationAt(lng, lat) ?? Number.NaN
      return Number.isFinite(value) ? value : far.elevationAt(lng, lat)
    },
  }
}

/** The tile range round the eye at the finest zoom (≤ 12) whose mosaic fits `MAX_SKYLINE_TILES`. */
export function skylineTileRange(eye: { lng: number; lat: number }, radiusMeters: number): DemTileRange {
  const scale = metersPerDegree(eye.lat)
  const bounds: Bounds = [
    eye.lng - radiusMeters / scale.lng,
    eye.lat - radiusMeters / scale.lat,
    eye.lng + radiusMeters / scale.lng,
    eye.lat + radiusMeters / scale.lat,
  ]
  let zoom = 12
  let range = demTileRange(bounds, zoom)
  while (range.tileCount > MAX_SKYLINE_TILES && zoom > 6) range = demTileRange(bounds, --zoom)
  return range
}

type Loaded = { source: ElevationSource | null; missingTileCount: number }

async function mosaic(
  loader: ReturnType<typeof createPreviewTerrainLoader>,
  range: DemTileRange,
  signal?: AbortSignal,
): Promise<Loaded> {
  try {
    return await loader({ range, signal, concurrency: 4 })
  } catch (error) {
    if (signal?.aborted) throw error
    return { source: null, missingTileCount: range.tileCount }
  }
}

/**
 * The capture's ground: `near`, then a mosaic out to `radiusMeters`. With `look` (the frames' bearings) and the
 * eye's absolute height, also a wide mosaic to `SKYLINE_MAX_RADIUS_METERS` to scan the frames' skyline on, and,
 * when that skyline stands past `radiusMeters`, the ground out to it (`skylineTerrainRadius`) at the finest zoom the
 * tile budget allows, layered in front of the wide one.
 */
export async function loadSkylineTerrain(
  near: ElevationSource | null,
  eye: { lng: number; lat: number; elevation?: number },
  radiusMeters: number,
  options: { signal?: AbortSignal; look?: readonly BearingRange[] } = {},
): Promise<SkylineTerrain> {
  const { signal, look } = options
  const range = skylineTileRange(eye, radiusMeters)
  const scan = !!look?.length && Number.isFinite(eye.elevation)
  const wideRange = scan ? skylineTileRange(eye, SKYLINE_MAX_RADIUS_METERS) : null
  const [inner, wide] = await Promise.all([
    mosaic(loadSkyline, range, signal),
    wideRange ? mosaic(loadWide, wideRange, signal) : Promise.resolve(null),
  ])
  const base = { zoom: range.zoom, missingTileCount: inner.missingTileCount }
  if (!inner.source) return { source: null, ...base, reach: null, outer: null }
  let source = layeredElevation(near, inner.source)
  if (!wide?.source || !wideRange || !look) return { source, ...base, reach: null, outer: null }

  const wideSource = layeredElevation(source, wide.source)
  const reach = skylineReach(wideSource, { lng: eye.lng, lat: eye.lat, elevation: eye.elevation! }, look, {
    maxDistanceMeters: SKYLINE_MAX_RADIUS_METERS,
  })
  const wanted = skylineTerrainRadius(reach).radiusMeters
  if (wanted <= radiusMeters) return { source, ...base, reach, outer: null }

  // The skyline stands past the 15 km mosaic: reload the ground out to it finer than the scan's, where the budget
  // allows, with the wide mosaic behind it for anything it misses.
  const outerRange = skylineTileRange(eye, wanted)
  let outer = { zoom: wideRange.zoom, radiusMeters: SKYLINE_MAX_RADIUS_METERS, missingTileCount: wide.missingTileCount }
  let far: ElevationSource = wide.source
  if (outerRange.zoom > wideRange.zoom) {
    const refined = await mosaic(loadSkyline, outerRange, signal)
    if (refined.source) {
      far = layeredElevation(refined.source, wide.source)
      outer = { zoom: outerRange.zoom, radiusMeters: wanted, missingTileCount: refined.missingTileCount }
    }
  }
  source = layeredElevation(source, far)
  return { source, ...base, reach, outer }
}
