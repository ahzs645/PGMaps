import { bearingDegrees, haversineMeters } from './visibility'
export type DriveStation = { lng: number; lat: number; groundElevationMeters: number; distanceAlongMeters: number }
export type DriveLookAt = { lng: number; lat: number; elevationMeters: number }
export type RoadVertex = { lng: number; lat: number; distanceAlongMeters: number }
export function roadPath(coordinates: ReadonlyArray<readonly [number, number]>): RoadVertex[] {
  const result: RoadVertex[] = []
  for (const [lng, lat] of coordinates) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 85)
      throw new Error('Invalid road coordinate.')
    const previous = result[result.length - 1],
      distance = previous ? haversineMeters(previous, { lng, lat }) : 0
    if (previous && distance < 0.001) continue
    result.push({ lng, lat, distanceAlongMeters: (previous?.distanceAlongMeters ?? 0) + distance })
  }
  return result
}
/** Uses the actual road vertices. Analysis stations are NOT a substitute for the centreline. */
export function roadPlacement(path: readonly RoadVertex[], distance: number) {
  if (!path.length) return null
  const end = path[path.length - 1].distanceAlongMeters,
    d = Math.max(0, Math.min(end, distance))
  if (path.length === 1) return { ...path[0], travelBearing: 0 }
  let lo = 1,
    hi = path.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (path[mid].distanceAlongMeters < d) lo = mid + 1
    else hi = mid
  }
  const a = path[lo - 1],
    b = path[lo],
    fraction = (d - a.distanceAlongMeters) / (b.distanceAlongMeters - a.distanceAlongMeters)
  return {
    lng: a.lng + fraction * (b.lng - a.lng),
    lat: a.lat + fraction * (b.lat - a.lat),
    distanceAlongMeters: d,
    travelBearing: bearingDegrees(a, b),
  }
}
/**
 * How far along the road the point nearest to `point` lies, in metres: a click on the plan's road
 * line seeks the road view there. Measured on a local flat projection per segment, which is ample
 * for picking a place on a road a few kilometres long.
 */
export function distanceAlongRoad(path: readonly RoadVertex[], point: { lng: number; lat: number }): number | null {
  if (!path.length || !Number.isFinite(point.lng) || !Number.isFinite(point.lat)) return null
  const metresPerLng = 111_320 * Math.cos((point.lat * Math.PI) / 180),
    metresPerLat = 110_574
  let best = Infinity,
    along = path[0].distanceAlongMeters
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1],
      b = path[i]
    const bx = (b.lng - a.lng) * metresPerLng,
      by = (b.lat - a.lat) * metresPerLat,
      px = (point.lng - a.lng) * metresPerLng,
      py = (point.lat - a.lat) * metresPerLat
    const lengthSquared = bx * bx + by * by
    const t = lengthSquared > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / lengthSquared)) : 0
    const dx = px - t * bx,
      dy = py - t * by,
      distance = dx * dx + dy * dy
    if (distance < best) {
      best = distance
      along = a.distanceAlongMeters + t * (b.distanceAlongMeters - a.distanceAlongMeters)
    }
  }
  return along
}
export function nearestStation(stations: readonly DriveStation[], distance: number): number {
  if (stations.length < 2) return 0
  let lo = 0,
    hi = stations.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (stations[mid].distanceAlongMeters < distance) lo = mid + 1
    else hi = mid
  }
  return lo > 0 && distance - stations[lo - 1].distanceAlongMeters <= stations[lo].distanceAlongMeters - distance
    ? lo - 1
    : lo
}
export function viewRotation(
  position: { lng: number; lat: number; travelBearing: number },
  altitude: number,
  target: DriveLookAt | null,
  fallback: number,
  yaw: number,
  tilt: number,
) {
  const bearing = target ? bearingDegrees(position, target) : fallback
  const rise = target
    ? (Math.atan2(target.elevationMeters - altitude, Math.max(1, haversineMeters(position, target))) * 180) / Math.PI
    : 0
  return { bearing: (((bearing + yaw) % 360) + 360) % 360, pitch: Math.max(40, Math.min(110, 90 + rise + tilt)) }
}

/** Metres east and north of the road position the walker has stepped. */
export type WalkOffset = { east: number; north: number }

export const NO_WALK: WalkOffset = { east: 0, north: 0 }

/** Walking speeds, metres a second: a stroll across a slope, and a jog to a better spot. */
export const WALK_SPEEDS = { normal: 6, fast: 30 } as const

/** How far off the road the walker is allowed: past this the analysis stations no longer describe the view. */
export const MAX_WALK_METERS = 2000

/**
 * One step of walking, relative to where the camera looks: `forward` along the
 * view bearing, `right` across it, in metres. Pure; the controller checks the
 * ground is loaded at the result before the walker stands on it.
 */
export function walkStep(offset: WalkOffset, bearing: number, forward: number, right: number): WalkOffset {
  const radians = (bearing * Math.PI) / 180
  const east = offset.east + Math.sin(radians) * forward + Math.cos(radians) * right
  const north = offset.north + Math.cos(radians) * forward - Math.sin(radians) * right
  const distance = Math.hypot(east, north)
  if (distance <= MAX_WALK_METERS) return { east, north }
  return { east: (east / distance) * MAX_WALK_METERS, north: (north / distance) * MAX_WALK_METERS }
}

/** The walker's ground position: the road position moved by the offset. */
export function offsetPosition<T extends { lng: number; lat: number }>(
  point: T,
  offset: WalkOffset | null | undefined,
): T {
  if (!offset || (offset.east === 0 && offset.north === 0)) return point
  const metresPerLat = 111320,
    metresPerLng = 111320 * Math.cos((point.lat * Math.PI) / 180)
  return { ...point, lng: point.lng + offset.east / metresPerLng, lat: point.lat + offset.north / metresPerLat }
}

/** Look across a short window of the original road, without moving the eye off it. */
export function roadLookAhead(path: readonly RoadVertex[], distance: number, windowMeters = 30) {
  const before = roadPlacement(path, distance - windowMeters)
  const after = roadPlacement(path, distance + windowMeters)
  if (!before || !after) return null
  return { before, after, bearing: bearingDegrees(before, after), span: haversineMeters(before, after) }
}

export function smoothAngle(previous: number, next: number, amount: number): number {
  const delta = ((next - previous + 540) % 360) - 180
  return (previous + delta * amount + 360) % 360
}

/**
 * How far from dead level the camera is kept. A pitch of exactly 90° (looking
 * straight at the horizon) crashed the renderer outright in testing: a level
 * view from a 360° photo did it every time, and a road whose look-ahead grade
 * came out at exactly zero would too. A tenth of a degree down is invisible.
 */
export const HORIZON_MARGIN_DEGREES = 0.1

export function horizonSafePitch(pitch: number): number {
  return Math.abs(pitch - 90) < HORIZON_MARGIN_DEGREES ? 90 - HORIZON_MARGIN_DEGREES : pitch
}

/** Preview travel speeds, not inferred posted road limits. */
export const DRIVE_SPEEDS_KMH = [5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]

/**
 * Meteorological visibility for the road view's distance haze, metres: a clear
 * day in the BC interior. Only the picture uses it.
 */
export const HAZE_VISIBILITY_METERS = 60_000

/**
 * Air haze as rings draped on the ground around the eye, each faded by
 * Koschmieder's law: an object `d` away keeps `exp(-3.912 d / V)` of its
 * contrast, so the haze over it is `1 - exp(-3.912 d / V)`. Every ridge is then
 * hazed by its real distance from the eye, and a nearer layer of mountain stands
 * out from the one behind it, as in real air.
 *
 * MapLibre's own sky fog cannot do this at eye level: its fog depth uses a near
 * plane about 11.5 × the camera's elevation above sea level once the view is
 * pitched to the horizon, so at 700 m it begins about 8 km out and moves with
 * the transform's elevation residual.
 *
 * Rings are annuli, so each spot is covered once. Pure; the page drapes them.
 */
export function hazeRings(
  centre: { lng: number; lat: number },
  {
    visibilityMeters = HAZE_VISIBILITY_METERS,
    innerMeters = 400,
    outerMeters = 40_000,
    rings = 20,
    sides = 72,
    maxOpacity = 0.85,
  }: {
    visibilityMeters?: number
    innerMeters?: number
    outerMeters?: number
    rings?: number
    sides?: number
    maxOpacity?: number
  } = {},
): GeoJSON.FeatureCollection {
  const metresPerLat = 111_320,
    metresPerLng = 111_320 * Math.cos((centre.lat * Math.PI) / 180)
  const circle = (radius: number) => {
    const ring: Array<[number, number]> = []
    for (let i = 0; i <= sides; i += 1) {
      const angle = (2 * Math.PI * (i % sides)) / sides
      ring.push([
        centre.lng + (Math.sin(angle) * radius) / metresPerLng,
        centre.lat + (Math.cos(angle) * radius) / metresPerLat,
      ])
    }
    return ring
  }
  const ratio = Math.pow(outerMeters / innerMeters, 1 / rings)
  const features: GeoJSON.Feature[] = []
  for (let i = 0; i < rings; i += 1) {
    const inner = innerMeters * Math.pow(ratio, i),
      outer = inner * ratio
    const middle = Math.sqrt(inner * outer)
    const opacity = Math.min(maxOpacity, 1 - Math.exp((-3.912 * middle) / visibilityMeters))
    // The hole runs the other way round, as GeoJSON asks.
    features.push({
      type: 'Feature',
      properties: { opacity, innerMeters: inner, outerMeters: outer },
      geometry: { type: 'Polygon', coordinates: [circle(outer), circle(inner).reverse()] },
    })
  }
  // Past the last ring the haze holds at its last value, out to the horizon.
  const last = Math.min(maxOpacity, 1 - Math.exp((-3.912 * outerMeters) / visibilityMeters))
  features.push({
    type: 'Feature',
    properties: { opacity: last, innerMeters: outerMeters, outerMeters: outerMeters * 4 },
    geometry: { type: 'Polygon', coordinates: [circle(outerMeters * 4), circle(outerMeters).reverse()] },
  })
  return { type: 'FeatureCollection', features }
}
