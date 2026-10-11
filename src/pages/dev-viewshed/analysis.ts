import type { LocalRaster } from '../dev-forestry/types'
import type { Bounds, ElevationSource } from '../dev-forestry/terrain'
import { lngLatToMercator, mercatorToLngLat } from '../dev-forestry/terrain'
import { EARTH_CIRCUMFERENCE_METERS } from '../dev-forestry/terrain'
import { DEFAULT_SIGHTLINE_OPTIONS, haversineMeters, testSightline, type GeoPoint } from '../dev-forestry/visibility'

export const VIEWSHED_COLORS = {
  visible: [16, 185, 129, 175],
  occluded: [239, 68, 68, 140],
  unknown: [148, 163, 184, 170],
} as const
export type ViewshedInput = {
  observer: GeoPoint
  radiusMeters: number
  observerHeightMeters: number
  targetHeightMeters: number
  demZoom: number
  localTerrain: LocalRaster | null
}
export type ViewshedLayout = {
  size: number
  west: number
  north: number
  span: number
  bounds: Bounds
  cellMeters: number
}
export type ViewshedResult = {
  layout: ViewshedLayout
  pixels: Uint8ClampedArray
  visible: number
  occluded: number
  unknown: number
  groundElevationMeters: number
  demPixelMeters: number
  missingTiles: number
  elapsedMs: number
}
export type WorkerRequest =
  | { type: 'run'; id: number; input: ViewshedInput }
  | { type: 'cancel' }
export type WorkerResponse =
  | { type: 'result'; id: number; result: ViewshedResult }
  | { type: 'progress'; id: number; message: string }
  | { type: 'error'; id: number; message: string }

export function viewshedLayout(input: ViewshedInput, demPixelMeters: number): ViewshedLayout {
  const { observer, radiusMeters, observerHeightMeters, targetHeightMeters, demZoom } = input
  if (![observer.lng, observer.lat, radiusMeters, observerHeightMeters, targetHeightMeters].every(Number.isFinite) ||
    observer.lng < -140 || observer.lng > -113 || observer.lat < 48 || observer.lat > 61 ||
    radiusMeters < 250 || radiusMeters > 10000 ||
    observerHeightMeters < 0.5 || observerHeightMeters > 500 ||
    targetHeightMeters < 0 || targetHeightMeters > 500 ||
    ![12, 13, 14].includes(demZoom) || !(demPixelMeters > 0) || !Number.isFinite(demPixelMeters)) {
    throw new Error('Choose a BC location, a 0.25–10 km radius, and valid heights.')
  }
  const [x, y] = lngLatToMercator(observer.lng, observer.lat)
  const span = 2 * radiusMeters / (EARTH_CIRCUMFERENCE_METERS * Math.cos(observer.lat * Math.PI / 180))
  // The output is a sampled view, capped at 128². Extra tile zoom does not create source detail.
  const size = Math.max(8, Math.min(128, Math.ceil(2 * radiusMeters / demPixelMeters)))
  const west = x - span / 2, north = y - span / 2
  const [minLng, maxLat] = mercatorToLngLat(west, north)
  const [maxLng, minLat] = mercatorToLngLat(west + span, north + span)
  return { size, west, north, span, bounds: [minLng, minLat, maxLng, maxLat], cellMeters: 2 * radiusMeters / size }
}

export function createViewshedResult(source: ElevationSource, input: ViewshedInput, demPixelMeters: number): ViewshedResult {
  const layout = viewshedLayout(input, demPixelMeters)
  const groundElevationMeters = source.elevationAt(input.observer.lng, input.observer.lat)
  if (!Number.isFinite(groundElevationMeters)) throw new Error('No terrain at the observer. Move inside the DEM coverage or retry.')
  return { layout, groundElevationMeters, demPixelMeters, pixels: new Uint8ClampedArray(layout.size ** 2 * 4), visible: 0, occluded: 0, unknown: 0, missingTiles: 0, elapsedMs: 0 }
}

/** One row at a time lets the worker yield to newer observer positions. */
export function computeViewshedRow(source: ElevationSource, input: ViewshedInput, result: ViewshedResult, row: number): void {
  const { layout } = result
  const observer = { ...input.observer, groundElevationMeters: result.groundElevationMeters }
  for (let col = 0; col < layout.size; col++) {
    const [lng, lat] = mercatorToLngLat(
      layout.west + (col + 0.5) / layout.size * layout.span,
      layout.north + (row + 0.5) / layout.size * layout.span,
    )
    const target = { lng, lat, groundElevationMeters: source.elevationAt(lng, lat) }
    if (haversineMeters(observer, target) > input.radiusMeters) continue
    const sightline = testSightline(source, observer, target, {
      ...DEFAULT_SIGHTLINE_OPTIONS,
      observerHeightMeters: input.observerHeightMeters,
      targetOffsetMeters: input.targetHeightMeters,
      stepMeters: Math.max(1, result.demPixelMeters),
      maxDistanceMeters: input.radiusMeters,
      clearanceMeters: 0,
    })
    const status = sightline.status === 'out-of-range' ? 'unknown' : sightline.status
    result[status]++
    result.pixels.set(VIEWSHED_COLORS[status], (row * layout.size + col) * 4)
  }
}
