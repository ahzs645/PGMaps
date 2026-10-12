import {
  EARTH_CIRCUMFERENCE_METERS,
  lngLatToMercator,
  mercatorToLngLat,
  type Bounds,
  type ElevationSource,
} from '@/pages/dev-forestry/terrain'
import { earthCurvatureDropMeters, testSightline, type GeoPoint } from '@/pages/dev-forestry/visibility'
export type { GeoPoint } from '@/pages/dev-forestry/visibility'

export type ViewshedSettings = {
  observer: GeoPoint
  radiusMeters: number
  heightA: number
  heightB: number
}
export const HORIZON_DIRECTIONS = 720
export const VIEWSHED_SIZE = 192
export const VIEWSHED_COLORS = {
  visible: '#e11d48',
  both: '#059669',
  aOnly: '#0284c7',
  bOnly: '#f59e0b',
  hidden: '#64748b',
  unknown: '#a855f7',
}
export type ViewshedResult = {
  settings: ViewshedSettings
  bounds: Bounds
  size: number
  /** 0 outside, 1 hidden, 2 A only, 3 B only, 4 both, 5 unknown. */
  cells: Uint8Array
  counts: { total: number; visibleA: number; visibleB: number; unknown: number }
  groundMeters: number
  horizonA: Float32Array
  horizonB: Float32Array
  horizonUnknown: Uint8Array
  sourceResolutionMeters: number
  missingTileCount: number
}

/** Square Mercator image footprint, sampled at pixel centres and draped by MapLibre. */
export function viewshedBounds({ observer, radiusMeters }: ViewshedSettings): Bounds {
  if (
    !Number.isFinite(observer.lng) ||
    !Number.isFinite(observer.lat) ||
    Math.abs(observer.lat) > 80 ||
    Math.abs(observer.lng) > 180
  ) {
    throw new Error('Choose a valid location between 80°S and 80°N.')
  }
  if (!Number.isFinite(radiusMeters) || radiusMeters < 100 || radiusMeters > 25000) {
    throw new Error('Choose a radius between 100 m and 25 km.')
  }
  const [x, y] = lngLatToMercator(observer.lng, observer.lat)
  const delta = radiusMeters / (EARTH_CIRCUMFERENCE_METERS * Math.cos((observer.lat * Math.PI) / 180))
  if (x - delta <= 0 || x + delta >= 1) throw new Error('Move the observer away from the date line.')
  const [west, south] = mercatorToLngLat(x - delta, y + delta)
  const [east, north] = mercatorToLngLat(x + delta, y - delta)
  return [west, south, east, north]
}

export function destination(observer: GeoPoint, bearing: number, distance: number): GeoPoint {
  const r = Math.PI / 180
  const lat = observer.lat * r,
    lng = observer.lng * r,
    angle = distance / 6371008.8,
    b = bearing * r
  const phi = Math.asin(Math.sin(lat) * Math.cos(angle) + Math.cos(lat) * Math.sin(angle) * Math.cos(b))
  const lambda =
    lng + Math.atan2(Math.sin(b) * Math.sin(angle) * Math.cos(lat), Math.cos(angle) - Math.sin(lat) * Math.sin(phi))
  return { lng: lambda / r, lat: phi / r }
}

export function computeViewshed(
  source: ElevationSource,
  settings: ViewshedSettings,
  sourceResolutionMeters: number,
  size = VIEWSHED_SIZE,
  includeHorizon = true,
  footprint?: { bounds: Bounds; skipVisible?: Uint8Array },
): ViewshedResult {
  if (![settings.heightA, settings.heightB].every((h) => Number.isFinite(h) && h >= 0 && h <= 100))
    throw new Error('Observer heights must be between 0 and 100 m.')
  const bounds = footprint?.bounds ?? viewshedBounds(settings)
  const nw = lngLatToMercator(bounds[0], bounds[3]),
    se = lngLatToMercator(bounds[2], bounds[1])
  const groundMeters = source.elevationAt(settings.observer.lng, settings.observer.lat)
  const observer = { ...settings.observer, groundElevationMeters: groundMeters }
  const cells = new Uint8Array(size * size)
  const counts = { total: 0, visibleA: 0, visibleB: 0, unknown: 0 }
  const options = {
    targetOffsetMeters: 0,
    stepMeters: Math.max(sourceResolutionMeters, 15),
    maxDistanceMeters: settings.radiusMeters,
    refractionCoefficient: 0.13,
    clearanceMeters: 0,
  }
  for (let row = 0; row < size; row++)
    for (let col = 0; col < size; col++) {
      if (footprint?.skipVisible?.[row * size + col] === 4) continue
      const x = nw[0] + ((col + 0.5) / size) * (se[0] - nw[0])
      const y = nw[1] + ((row + 0.5) / size) * (se[1] - nw[1])
      const [lng, lat] = mercatorToLngLat(x, y)
      const target = { lng, lat, groundElevationMeters: source.elevationAt(lng, lat) }
      const a = testSightline(source, observer, target, { ...options, observerHeightMeters: settings.heightA })
      if (a.status === 'out-of-range') continue
      const b =
        settings.heightA === settings.heightB
          ? a
          : testSightline(source, observer, target, { ...options, observerHeightMeters: settings.heightB })
      counts.total++
      if (a.visible) counts.visibleA++
      if (b.visible) counts.visibleB++
      const unknown = a.status === 'unknown' || b.status === 'unknown'
      if (unknown) counts.unknown++
      cells[row * size + col] = unknown ? 5 : a.visible && b.visible ? 4 : a.visible ? 2 : b.visible ? 3 : 1
    }
  const horizonA = new Float32Array(HORIZON_DIRECTIONS).fill(NaN)
  const horizonB = new Float32Array(HORIZON_DIRECTIONS).fill(NaN)
  const horizonUnknown = new Uint8Array(HORIZON_DIRECTIONS).fill(1)
  // A fixed, bounded skyline lets the time slider update instantly without re-fetching terrain.
  const steps = Math.min(1200, Math.ceil(settings.radiusMeters / Math.max(15, sourceResolutionMeters)))
  for (let i = 0; includeHorizon && i < HORIZON_DIRECTIONS; i++) {
    let a = -90,
      b = -90
    let missing = !Number.isFinite(groundMeters)
    for (let j = 1; j <= steps; j++) {
      const distance = (settings.radiusMeters * j) / steps
      const point = destination(settings.observer, (i * 360) / HORIZON_DIRECTIONS, distance)
      const elevation = source.elevationAt(point.lng, point.lat)
      if (!Number.isFinite(elevation)) {
        missing = true
        continue
      }
      const rise = elevation - groundMeters - earthCurvatureDropMeters(distance)
      a = Math.max(a, (Math.atan2(rise - settings.heightA, distance) * 180) / Math.PI)
      b = Math.max(b, (Math.atan2(rise - settings.heightB, distance) * 180) / Math.PI)
    }
    horizonA[i] = a
    horizonB[i] = b
    horizonUnknown[i] = missing ? 1 : 0
  }
  return {
    settings,
    bounds,
    size,
    cells,
    counts,
    groundMeters,
    horizonA,
    horizonB,
    horizonUnknown,
    sourceResolutionMeters,
    missingTileCount: 0,
  }
}

/** Low-order solar ephemeris: geometric solar centre, true-north azimuth clockwise. */
export function solarPosition(date: Date, observer: GeoPoint): { azimuth: number; altitude: number } {
  const r = Math.PI / 180
  const days = date.getTime() / 86400000 - 10957.5 // Days from J2000, noon Jan 1 2000 UTC.
  const anomaly = r * (357.5291 + 0.98560028 * days)
  const centre = r * (1.9148 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly) + 0.0003 * Math.sin(3 * anomaly))
  const longitude = anomaly + centre + r * 102.9372 + Math.PI
  const obliquity = r * 23.4397
  const declination = Math.asin(Math.sin(longitude) * Math.sin(obliquity))
  const ascension = Math.atan2(Math.sin(longitude) * Math.cos(obliquity), Math.cos(longitude))
  const hour = r * (280.16 + 360.9856235 * days + observer.lng) - ascension
  const lat = observer.lat * r
  return {
    azimuth:
      (Math.atan2(Math.sin(hour), Math.cos(hour) * Math.sin(lat) - Math.tan(declination) * Math.cos(lat)) / r +
        180 +
        360) %
      360,
    altitude:
      Math.asin(Math.sin(lat) * Math.sin(declination) + Math.cos(lat) * Math.cos(declination) * Math.cos(hour)) / r,
  }
}

export function sunVisibility(result: ViewshedResult, sun: { azimuth: number; altitude: number }, height: 'A' | 'B') {
  if (sun.altitude < 0) return { status: 'below-horizon' as const, horizon: 0 }
  const index = Math.round((sun.azimuth / 360) * HORIZON_DIRECTIONS) % HORIZON_DIRECTIONS
  const horizon = (height === 'A' ? result.horizonA : result.horizonB)[index]
  if (!Number.isFinite(result.groundMeters) || !Number.isFinite(horizon)) return { status: 'unknown' as const, horizon }
  if (sun.altitude <= horizon) return { status: 'blocked' as const, horizon }
  return { status: result.horizonUnknown[index] ? ('unknown' as const) : ('clear' as const), horizon }
}

/** Resolve a wall-clock date/time with the zone's offset on that date, including DST. */
export function dateTimeInZone(date: string, minutes: number, timeZone: string): Date | null {
  const target = Date.parse(`${date}T00:00:00Z`) + minutes * 60000
  if (!Number.isFinite(target)) return null
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const wallTime = (timestamp: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map((p) => [p.type, p.value]))
    return Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00Z`)
  }
  let timestamp = target
  for (let i = 0; i < 3; i++) timestamp += target - wallTime(timestamp)
  return wallTime(timestamp) === target ? new Date(timestamp) : null
}
