/** Terrain-only geometry. Unknown terrain is NOT an unobstructed sightline. */
import type { CanopySource } from './canopy'
import { EARTH_RADIUS_METERS, lngLatToMercator, mercatorToLngLat, type ElevationSource } from './terrain'
export type GeoPoint = { lng: number; lat: number }
export type GroundPoint = GeoPoint & { groundElevationMeters: number }
export type SightlineOptions = {
  observerHeightMeters: number
  targetOffsetMeters: number
  stepMeters: number
  maxDistanceMeters: number
  refractionCoefficient: number
  clearanceMeters: number
  /** Upper bound on samples per ray (default 1200); longer rays are sampled more coarsely than stepMeters. */
  maxSteps?: number
}
export const DEFAULT_SIGHTLINE_OPTIONS: SightlineOptions = {
  observerHeightMeters: 1.6,
  targetOffsetMeters: 0,
  stepMeters: 20,
  maxDistanceMeters: 12000,
  refractionCoefficient: 0.13,
  clearanceMeters: 0.5,
}
export type SightlineResult = {
  visible: boolean
  distanceMeters: number
  blockedAtMeters: number | null
  status: 'visible' | 'occluded' | 'unknown' | 'out-of-range'
  /**
   * What hides an occluded target: `terrain` when the bare ground alone crosses
   * the sightline, `canopy` when only the timber on it does and the rest of the
   * ray is known. Absent when the cause cannot be told (an unknown stretch).
   * It lets a hidden sample be reported as screened by timber rather than by
   * the shape of the ground, which is the distinction a planning note makes.
   */
  occludedBy?: 'terrain' | 'canopy'
}
export function earthCurvatureDropMeters(distance: number, refraction = 0.13): number {
  return ((1 - refraction) * distance * distance) / (2 * EARTH_RADIUS_METERS)
}
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const rad = Math.PI / 180
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)))
}
export function bearingDegrees(a: GeoPoint, b: GeoPoint): number {
  const r = Math.PI / 180,
    d = (b.lng - a.lng) * r
  return (
    (Math.atan2(
      Math.sin(d) * Math.cos(b.lat * r),
      Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos(d),
    ) /
      r +
      360) %
    360
  )
}
export function metersPerDegree(latitude: number): { lng: number; lat: number } {
  const lat = (Math.PI * EARTH_RADIUS_METERS) / 180
  return { lat, lng: lat * Math.cos((latitude * Math.PI) / 180) }
}
export function testSightline(
  source: ElevationSource,
  observer: GroundPoint,
  target: GroundPoint,
  options: SightlineOptions,
  canopy?: CanopySource,
): SightlineResult {
  const distanceMeters = haversineMeters(observer, target)
  const answer = (status: SightlineResult['status'], blockedAtMeters: number | null = null): SightlineResult => ({
    status,
    visible: status === 'visible',
    distanceMeters,
    blockedAtMeters,
  })
  if (!Number.isFinite(distanceMeters)) return answer('unknown')
  if (distanceMeters > options.maxDistanceMeters) return answer('out-of-range')
  const eye = observer.groundElevationMeters + options.observerHeightMeters
  const targetHeight = target.groundElevationMeters + options.targetOffsetMeters
  if (!Number.isFinite(eye) || !Number.isFinite(targetHeight)) return answer('unknown')
  if (distanceMeters < 1) return answer('visible')
  if (!(options.stepMeters > 0)) throw new Error('Sightline step must be positive.')
  const steps = Math.min(options.maxSteps ?? 1200, Math.max(2, Math.ceil(distanceMeters / options.stepMeters)))
  const start = lngLatToMercator(observer.lng, observer.lat),
    end = lngLatToMercator(target.lng, target.lat)
  const slope =
    (targetHeight - earthCurvatureDropMeters(distanceMeters, options.refractionCoefficient) - eye) / distanceMeters
  let unknown = false,
    terrainUnknown = false,
    screenedAt: number | null = null
  for (let i = 1; i < steps; i++) {
    const f = i / steps,
      distance = distanceMeters * f
    const x = start[0] + (end[0] - start[0]) * f,
      y = start[1] + (end[1] - start[1]) * f
    const ll = source.elevationAtMercator ? null : mercatorToLngLat(x, y)
    const ground = source.elevationAtMercator ? source.elevationAtMercator(x, y) : source.elevationAt(ll![0], ll![1])
    const height = canopy && screenedAt === null ? canopy.heightAtMercator(x, y) : 0
    if (!Number.isFinite(ground)) {
      unknown = true
      terrainUnknown = true
      continue
    }
    if (!Number.isFinite(height)) {
      unknown = true
      continue
    }
    const limit =
      eye +
      slope * distance +
      earthCurvatureDropMeters(distance, options.refractionCoefficient) +
      options.clearanceMeters
    // A known obstruction establishes occlusion even if another part of the profile is unknown.
    if (ground > limit) return { ...answer('occluded', screenedAt ?? distance), occludedBy: 'terrain' }
    // Timber hides it here. Keep walking the bare ground, which no longer
    // samples the canopy, to tell screening from terrain.
    if (screenedAt === null && ground + height > limit) screenedAt = distance
  }
  if (screenedAt !== null)
    return terrainUnknown ? answer('occluded', screenedAt) : { ...answer('occluded', screenedAt), occludedBy: 'canopy' }
  return answer(unknown ? 'unknown' : 'visible')
}
export type CorridorStation = GeoPoint & { distanceAlongMeters: number }
export function lineLengthMeters(coordinates: ReadonlyArray<readonly [number, number]>): number {
  let length = 0
  for (let i = 1; i < coordinates.length; i++)
    length += haversineMeters(
      { lng: coordinates[i - 1][0], lat: coordinates[i - 1][1] },
      { lng: coordinates[i][0], lat: coordinates[i][1] },
    )
  return length
}
export function sampleAlongLine(
  coordinates: ReadonlyArray<readonly [number, number]>,
  spacingMeters: number,
  maxStations = 400,
): CorridorStation[] {
  if (!coordinates.length) return []
  if (!(spacingMeters > 0) || !Number.isFinite(spacingMeters)) throw new Error('Station spacing must be positive.')
  const total = lineLengthMeters(coordinates)
  const first: CorridorStation = { lng: coordinates[0][0], lat: coordinates[0][1], distanceAlongMeters: 0 }
  if (!total) return [first]
  const spacing = Math.max(spacingMeters, total / Math.max(1, maxStations - 1)),
    output = [first]
  let segment = 1,
    startDistance = 0
  const segmentLength = (i: number) =>
    haversineMeters(
      { lng: coordinates[i - 1][0], lat: coordinates[i - 1][1] },
      { lng: coordinates[i][0], lat: coordinates[i][1] },
    )
  let length = segmentLength(segment)
  for (let distance = spacing; distance < total - spacing * 0.5; distance += spacing) {
    while (segment < coordinates.length - 1 && (length === 0 || startDistance + length < distance)) {
      startDistance += length
      length = segmentLength(++segment)
    }
    const t = length ? (distance - startDistance) / length : 0
    output.push({
      lng: coordinates[segment - 1][0] + t * (coordinates[segment][0] - coordinates[segment - 1][0]),
      lat: coordinates[segment - 1][1] + t * (coordinates[segment][1] - coordinates[segment - 1][1]),
      distanceAlongMeters: distance,
    })
  }
  const last = coordinates[coordinates.length - 1]
  output.push({ lng: last[0], lat: last[1], distanceAlongMeters: total })
  return output
}
export type PolygonGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon
export type Bounds = [number, number, number, number]
const ringsOf = (geometry: PolygonGeometry): GeoJSON.Position[][][] =>
  geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
function inRing(ring: GeoJSON.Position[], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
export function pointInPolygon(geometry: PolygonGeometry, lng: number, lat: number): boolean {
  return ringsOf(geometry).some(
    (rings) => !!rings[0] && inRing(rings[0], lng, lat) && !rings.slice(1).some((ring) => inRing(ring, lng, lat)),
  )
}
/**
 * One ring's edges, bucketed into horizontal bands so a test at latitude `y`
 * walks only the edges whose span holds `y`. The crossing test is `inRing`'s,
 * on the same vertices in the same order, so the answer is identical: an edge
 * can only flip the parity when `min(yi, yj) <= y < max(yi, yj)`, and every
 * such edge sits in the band that holds `y`.
 */
type PreparedRing = {
  /** Flat [xi, yi, xj, yj] per edge, where j is the vertex before i, as in `inRing`. */
  edges: Float64Array
  minY: number
  maxY: number
  bandHeight: number
  /** Edge indices per band; null for a ring small enough to walk whole. */
  bands: Uint32Array[] | null
}
type PreparedPart = { bounds: Bounds; outer: PreparedRing; holes: PreparedRing[] }

/** Rings with fewer edges than this are walked whole: banding them saves nothing. */
const BANDED_RING_EDGES = 48

function prepareRing(ring: GeoJSON.Position[]): PreparedRing {
  const count = ring.length
  const edges = new Float64Array(count * 4)
  let minY = Infinity,
    maxY = -Infinity
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j]
    edges.set([xi, yi, xj, yj], i * 4)
    if (yi < minY) minY = yi
    if (yi > maxY) maxY = yi
  }
  if (count < BANDED_RING_EDGES || !(maxY > minY)) return { edges, minY, maxY, bandHeight: 1, bands: null }
  const bandCount = Math.min(1024, Math.ceil(count / 8))
  const bandHeight = (maxY - minY) / bandCount
  const lists: number[][] = Array.from({ length: bandCount }, () => [])
  const bandOf = (y: number) => Math.min(bandCount - 1, Math.max(0, Math.floor((y - minY) / bandHeight)))
  for (let edge = 0; edge < count; edge += 1) {
    const yi = edges[edge * 4 + 1],
      yj = edges[edge * 4 + 3]
    const last = bandOf(Math.max(yi, yj))
    for (let band = bandOf(Math.min(yi, yj)); band <= last; band += 1) lists[band].push(edge)
  }
  return { edges, minY, maxY, bandHeight, bands: lists.map((list) => Uint32Array.from(list)) }
}

function inPreparedRing(ring: PreparedRing, x: number, y: number): boolean {
  // No edge spans a latitude outside the ring's own range.
  if (y < ring.minY || y >= ring.maxY) return false
  const { edges } = ring
  let inside = false
  const crosses = (edge: number) => {
    const xi = edges[edge * 4],
      yi = edges[edge * 4 + 1],
      xj = edges[edge * 4 + 2],
      yj = edges[edge * 4 + 3]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  if (!ring.bands) {
    for (let edge = 0; edge < edges.length / 4; edge += 1) crosses(edge)
    return inside
  }
  const band = ring.bands[Math.min(ring.bands.length - 1, Math.max(0, Math.floor((y - ring.minY) / ring.bandHeight)))]
  for (let index = 0; index < band.length; index += 1) crosses(band[index])
  return inside
}

/** Each geometry's parts, prepared once and kept while the geometry object lives. */
const preparedParts = new WeakMap<PolygonGeometry, PreparedPart[]>()

function partsOf(geometry: PolygonGeometry): PreparedPart[] {
  let parts = preparedParts.get(geometry)
  if (!parts) {
    parts = ringsOf(geometry)
      .filter((rings) => rings[0]?.length)
      .map((rings) => {
        const bounds: Bounds = [Infinity, Infinity, -Infinity, -Infinity]
        for (const [x, y] of rings[0]) {
          bounds[0] = Math.min(bounds[0], x)
          bounds[1] = Math.min(bounds[1], y)
          bounds[2] = Math.max(bounds[2], x)
          bounds[3] = Math.max(bounds[3], y)
        }
        return { bounds, outer: prepareRing(rings[0]), holes: rings.slice(1).map(prepareRing) }
      })
    preparedParts.set(geometry, parts)
  }
  return parts
}

/** A set of polygons to test many points against, as `pointInPolygon` on any of them answers. */
export type PreparedPolygons = {
  contains: (lng: number, lat: number) => boolean
  /** The index of the first polygon holding the point, or -1. */
  indexAt: (lng: number, lat: number) => number
  /** Polygon parts kept after the `within` filter. */
  partCount: number
}

/**
 * Prepares polygons for many point tests: each multipolygon is split into its
 * parts, each part keeps its own bounding box (a lake no longer carries the
 * box of a whole basemap tile), and long rings are banded by latitude. With
 * `within`, parts whose box misses it are left out, for a run of points that
 * all fall inside it. Answers match `pointInPolygon` exactly.
 */
export function preparePolygons(polygons: ReadonlyArray<PolygonGeometry>, within?: Bounds): PreparedPolygons {
  const parts: Array<PreparedPart & { polygon: number }> = []
  polygons.forEach((geometry, polygon) => {
    for (const part of partsOf(geometry)) {
      const box = part.bounds
      if (within && (box[2] < within[0] || box[0] > within[2] || box[3] < within[1] || box[1] > within[3])) continue
      parts.push({ ...part, polygon })
    }
  })
  const indexAt = (lng: number, lat: number) => {
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index]
      const box = part.bounds
      if (lng < box[0] || lng > box[2] || lat < box[1] || lat > box[3]) continue
      if (!inPreparedRing(part.outer, lng, lat)) continue
      if (part.holes.some((hole) => inPreparedRing(hole, lng, lat))) continue
      return part.polygon
    }
    return -1
  }
  return { contains: (lng, lat) => indexAt(lng, lat) >= 0, indexAt, partCount: parts.length }
}

export function polygonBounds(geometry: PolygonGeometry): Bounds {
  const box: Bounds = [Infinity, Infinity, -Infinity, -Infinity]
  for (const rings of ringsOf(geometry))
    for (const ring of rings)
      for (const [x, y] of ring) {
        if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 180 || Math.abs(y) > 85)
          throw new Error('Invalid longitude/latitude polygon. Reproject the input to WGS84.')
        box[0] = Math.min(box[0], x)
        box[1] = Math.min(box[1], y)
        box[2] = Math.max(box[2], x)
        box[3] = Math.max(box[3], y)
      }
  return box
}
export function polygonAreaMeters(geometry: PolygonGeometry): number {
  const [minX, minY, , maxY] = polygonBounds(geometry)
  if (!Number.isFinite(minX)) return 0
  const scale = metersPerDegree((minY + maxY) / 2)
  let total = 0
  for (const rings of ringsOf(geometry))
    rings.forEach((ring, index) => {
      let twice = 0
      // Work relative to the local origin to avoid cancellation of ~1e14 m² terms.
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
        twice +=
          ((ring[j][0] - minX) * (ring[i][1] - minY) - (ring[i][0] - minX) * (ring[j][1] - minY)) *
          scale.lng *
          scale.lat
      total += ((index ? -1 : 1) * Math.abs(twice)) / 2
    })
  return Math.max(0, total)
}
/** Interior scanline point: unlike a bounding-box centre it cannot land in a hole or a gap. */
export function polygonInteriorPoint(geometry: PolygonGeometry): GeoPoint | null {
  let best: GeoPoint | null = null,
    width = 0
  for (const rings of ringsOf(geometry)) {
    const ys = [...new Set(rings.flatMap((ring) => ring.map((p) => p[1])))].sort((a, b) => a - b)
    for (let k = 1; k < ys.length; k++) {
      const y = (ys[k] + ys[k - 1]) / 2,
        xs: number[] = []
      for (const ring of rings)
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          if (ring[i][1] > y !== ring[j][1] > y)
            xs.push(ring[i][0] + ((y - ring[i][1]) * (ring[j][0] - ring[i][0])) / (ring[j][1] - ring[i][1]))
        }
      xs.sort((a, b) => a - b)
      for (let j = 1; j < xs.length; j++) {
        const x = (xs[j] + xs[j - 1]) / 2,
          span = xs[j] - xs[j - 1]
        if (span > width && pointInPolygon(geometry, x, y)) {
          width = span
          best = { lng: x, lat: y }
        }
      }
    }
  }
  return best
}
export type GridSample = GeoPoint & { areaMeters: number; fallback?: boolean }
export function polygonGridSamples(geometry: PolygonGeometry, spacingMeters: number): GridSample[] {
  if (!(spacingMeters > 0) || !Number.isFinite(spacingMeters)) throw new Error('Grid spacing must be positive.')
  const output: GridSample[] = []
  for (const rings of ringsOf(geometry)) {
    const component: GeoJSON.Polygon = { type: 'Polygon', coordinates: rings }
    const [minLng, minLat, maxLng, maxLat] = polygonBounds(component)
    if (!Number.isFinite(minLng)) continue
    const dLat = spacingMeters / metersPerDegree((minLat + maxLat) / 2).lat,
      before = output.length
    const candidates =
      Math.ceil((maxLat - minLat) / dLat) *
      Math.ceil(((maxLng - minLng) * metersPerDegree((minLat + maxLat) / 2).lng) / spacingMeters)
    if (candidates > 2_000_000)
      throw new Error(
        'The polygon is too elongated for this grid. Simplify/split the geometry or lower the sample budget.',
      )
    for (let lat = minLat + dLat / 2; lat <= maxLat; lat += dLat) {
      const dLng = spacingMeters / Math.max(1, metersPerDegree(lat).lng)
      for (let lng = minLng + dLng / 2; lng <= maxLng; lng += dLng)
        if (pointInPolygon(component, lng, lat)) output.push({ lng, lat, areaMeters: spacingMeters ** 2 })
    }
    if (before === output.length) {
      const point = polygonInteriorPoint(component),
        area = polygonAreaMeters(component)
      if (point && area > 0) output.push({ ...point, areaMeters: area, fallback: true })
    }
  }
  return output
}
export function spacingForSampleBudget(geometry: PolygonGeometry, budget: number, minSpacingMeters: number): number {
  return Math.max(minSpacingMeters, Math.sqrt(polygonAreaMeters(geometry) / Math.max(1, budget)))
}
export type Vector3 = [x: number, y: number, z: number]
export function terrainNormal(source: ElevationSource, lng: number, lat: number, spacingMeters: number): Vector3 {
  const scale = metersPerDegree(lat),
    dx = spacingMeters / Math.max(1, scale.lng),
    dy = spacingMeters / scale.lat
  const e = source.elevationAt(lng + dx, lat),
    w = source.elevationAt(lng - dx, lat),
    n = source.elevationAt(lng, lat + dy),
    s = source.elevationAt(lng, lat - dy)
  if (![e, w, n, s].every(Number.isFinite)) return [NaN, NaN, NaN]
  const x = (e - w) / (2 * spacingMeters),
    y = (n - s) / (2 * spacingMeters),
    length = Math.hypot(x, y, 1)
  return [-x / length, -y / length, 1 / length]
}
/** Small-facet solid angle. Input area is HORIZONTAL, so dA_surface = dA_plan / normal.z. */
export function apparentSolidAngle(
  observer: GroundPoint & { eyeHeightMeters: number },
  sample: GroundPoint,
  sampleAreaMeters: number,
  normal: Vector3,
): number {
  if (!normal.every(Number.isFinite) || !(normal[2] > 1e-8)) return 0
  const scale = metersPerDegree(sample.lat),
    east = (observer.lng - sample.lng) * scale.lng,
    north = (observer.lat - sample.lat) * scale.lat
  const up = observer.groundElevationMeters + observer.eyeHeightMeters - sample.groundElevationMeters,
    distance = Math.hypot(east, north, up)
  if (!Number.isFinite(distance) || distance < 1) return 0
  const incidence = Math.max(0, (normal[0] * east + normal[1] * north + normal[2] * up) / distance)
  return ((sampleAreaMeters / normal[2]) * incidence) / (distance * distance)
}
