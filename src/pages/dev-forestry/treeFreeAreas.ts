import { polygonAreaMeters, type PolygonGeometry } from './visibility'

/**
 * Ground the road view draws without timber: a pullout, a stretch of cleared
 * roadside, a field. Drawn on the plan, kept with the scene, and display only:
 * like the stand height and the cleared width, it changes the picture and never
 * the run, so it stays out of `AnalysisInput` and out of `sceneFingerprint`.
 *
 * Kept free of DOM access.
 */
export type TreeFreeArea = { id: string; name: string; geometry: PolygonGeometry }

export const MAX_TREE_FREE_AREAS = 50

/** Reads saved areas, dropping any that are not a polygon with area rather than failing the whole scene. */
export function parseTreeFreeAreas(raw: unknown): TreeFreeArea[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const areas: TreeFreeArea[] = []
  for (const value of raw.slice(0, MAX_TREE_FREE_AREAS)) {
    const area = value as Partial<TreeFreeArea> | null
    if (
      !area ||
      typeof area.id !== 'string' ||
      seen.has(area.id) ||
      !area.geometry ||
      (area.geometry.type !== 'Polygon' && area.geometry.type !== 'MultiPolygon') ||
      !(polygonAreaMeters(area.geometry) > 0)
    )
      continue
    seen.add(area.id)
    areas.push({
      id: area.id,
      name: typeof area.name === 'string' ? area.name.slice(0, 200) : 'Tree-free area',
      geometry: area.geometry,
    })
  }
  return areas
}

export function treeFreeAreasToGeoJson(areas: ReadonlyArray<TreeFreeArea>): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: areas.map((area) => ({
      type: 'Feature',
      id: area.id,
      geometry: area.geometry,
      properties: { id: area.id, name: area.name },
    })),
  }
}

/**
 * The automatic viewpoint clearing: a stood-at viewpoint (a spot, or a pullout through an inventory
 * viewpoint) is a maintained lookout, open toward the view as the VIA photos show it, so the drawn
 * stand leaves a fan in front of the eye and a small circle round it. Without it the stand grows to
 * the eye and the view is trunks. It is a tree-free area like any drawn one: display only, out of
 * `AnalysisInput` and `sceneFingerprint`, and the run's own screening clearing is separate
 * (`screeningEyeClearingMeters`).
 */
export type ViewpointClearingSetting = { enabled: boolean; radiusMeters: number }

export const VIEWPOINT_CLEARING = {
  radiusMeters: 120,
  /** Either side of the view bearing, degrees. */
  halfAngleDegrees: 70,
  /** Round the eye, whichever way the view turns. */
  eyeRadiusMeters: 15,
  minRadiusMeters: 15,
  maxRadiusMeters: 500,
} as const

/** Not a saved area's id: those are `tree-free-…`, or whatever an imported scene carries. */
export const VIEWPOINT_CLEARING_ID = 'viewpoint-clearing-auto'

export const DEFAULT_VIEWPOINT_CLEARING: ViewpointClearingSetting = {
  enabled: true,
  radiusMeters: VIEWPOINT_CLEARING.radiusMeters,
}

/** Reads the saved setting; absent or malformed reads as the default (on, 120 m). */
export function parseViewpointClearing(raw: unknown): ViewpointClearingSetting {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_VIEWPOINT_CLEARING }
  const value = raw as Partial<ViewpointClearingSetting>
  return {
    enabled: value.enabled !== false,
    radiusMeters: clampClearingRadius(value.radiusMeters),
  }
}

export function clampClearingRadius(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(VIEWPOINT_CLEARING.maxRadiusMeters, Math.max(VIEWPOINT_CLEARING.minRadiusMeters, value))
    : VIEWPOINT_CLEARING.radiusMeters
}

/**
 * The clearing round `stand`: a fan of `radiusMeters` within ±70° of `bearing`, closed round the back
 * by the 15 m circle, as one ring. With no bearing (nothing to face yet) it is the circle alone.
 */
export function viewpointClearingArea(
  stand: { lng: number; lat: number },
  bearing: number | null,
  setting: ViewpointClearingSetting,
): TreeFreeArea | null {
  if (!setting.enabled || !Number.isFinite(stand.lng) || !Number.isFinite(stand.lat)) return null
  const radius = clampClearingRadius(setting.radiusMeters)
  const eye = Math.min(VIEWPOINT_CLEARING.eyeRadiusMeters, radius)
  const metresEast = 111_320 * Math.cos((stand.lat * Math.PI) / 180)
  const metresNorth = 110_574
  const at = (degrees: number, metres: number): [number, number] => {
    const radians = (degrees * Math.PI) / 180
    return [
      stand.lng + (Math.sin(radians) * metres) / metresEast,
      stand.lat + (Math.cos(radians) * metres) / metresNorth,
    ]
  }
  const ring: Array<[number, number]> = []
  const half = VIEWPOINT_CLEARING.halfAngleDegrees
  if (bearing === null || !Number.isFinite(bearing)) {
    for (let step = 0; step < 36; step++) ring.push(at(step * 10, eye))
  } else {
    // The fan's arc every 5°, then the circle round the back every 10°.
    for (let degrees = -half; degrees <= half; degrees += 5) ring.push(at(bearing + degrees, radius))
    for (let degrees = half; degrees <= 360 - half; degrees += 10) ring.push(at(bearing + degrees, eye))
  }
  // Counter-clockwise, as GeoJSON's outer rings are.
  ring.reverse()
  ring.push(ring[0])
  return {
    id: VIEWPOINT_CLEARING_ID,
    name: 'Viewpoint clearing',
    geometry: { type: 'Polygon', coordinates: [ring] },
  }
}
