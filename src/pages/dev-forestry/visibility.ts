/** Terrain-only geometry. Unknown terrain is NOT an unobstructed sightline. */
import type { CanopySource } from './canopy'
import { EARTH_RADIUS_METERS, lngLatToMercator, mercatorToLngLat, type ElevationSource } from './terrain'
export type GeoPoint = { lng: number; lat: number }
export type GroundPoint = GeoPoint & { groundElevationMeters: number }
export type SightlineOptions = {
  observerHeightMeters: number; targetOffsetMeters: number; stepMeters: number
  maxDistanceMeters: number; refractionCoefficient: number; clearanceMeters: number
}
export const DEFAULT_SIGHTLINE_OPTIONS: SightlineOptions = {
  observerHeightMeters: 1.6, targetOffsetMeters: 0, stepMeters: 20,
  maxDistanceMeters: 12000, refractionCoefficient: 0.13, clearanceMeters: 0.5,
}
export type SightlineResult = {
  visible: boolean; distanceMeters: number; blockedAtMeters: number | null
  status: 'visible' | 'occluded' | 'unknown' | 'out-of-range'
}
export function earthCurvatureDropMeters(distance: number, refraction = 0.13): number {
  return (1 - refraction) * distance * distance / (2 * EARTH_RADIUS_METERS)
}
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const rad = Math.PI / 180
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)))
}
export function bearingDegrees(a: GeoPoint, b: GeoPoint): number {
  const r = Math.PI / 180, d = (b.lng - a.lng) * r
  return (Math.atan2(Math.sin(d) * Math.cos(b.lat * r), Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos(d)) / r + 360) % 360
}
export function metersPerDegree(latitude: number): { lng: number; lat: number } {
  const lat = Math.PI * EARTH_RADIUS_METERS / 180
  return { lat, lng: lat * Math.cos(latitude * Math.PI / 180) }
}
export function testSightline(source: ElevationSource, observer: GroundPoint, target: GroundPoint, options: SightlineOptions, canopy?: CanopySource): SightlineResult {
  const distanceMeters = haversineMeters(observer, target)
  const answer = (status: SightlineResult['status'], blockedAtMeters: number | null = null): SightlineResult => ({ status, visible: status === 'visible', distanceMeters, blockedAtMeters })
  if (!Number.isFinite(distanceMeters)) return answer('unknown')
  if (distanceMeters > options.maxDistanceMeters) return answer('out-of-range')
  const eye = observer.groundElevationMeters + options.observerHeightMeters
  const targetHeight = target.groundElevationMeters + options.targetOffsetMeters
  if (!Number.isFinite(eye) || !Number.isFinite(targetHeight)) return answer('unknown')
  if (distanceMeters < 1) return answer('visible')
  if (!(options.stepMeters > 0)) throw new Error('Sightline step must be positive.')
  const steps = Math.min(1200, Math.max(2, Math.ceil(distanceMeters / options.stepMeters)))
  const start = lngLatToMercator(observer.lng, observer.lat), end = lngLatToMercator(target.lng, target.lat)
  const slope = (targetHeight - earthCurvatureDropMeters(distanceMeters, options.refractionCoefficient) - eye) / distanceMeters
  let unknown = false
  for (let i = 1; i < steps; i++) {
    const f = i / steps, distance = distanceMeters * f
    const x = start[0] + (end[0] - start[0]) * f, y = start[1] + (end[1] - start[1]) * f
    const ll = source.elevationAtMercator ? null : mercatorToLngLat(x, y)
    const ground = source.elevationAtMercator ? source.elevationAtMercator(x, y) : source.elevationAt(ll![0], ll![1])
    const height = canopy ? canopy.heightAtMercator(x, y) : 0
    if (!Number.isFinite(ground) || !Number.isFinite(height)) { unknown = true; continue }
    const limit = eye + slope * distance + earthCurvatureDropMeters(distance, options.refractionCoefficient) + options.clearanceMeters
    // A known obstruction establishes occlusion even if another part of the profile is unknown.
    if (ground + height > limit) return answer('occluded', distance)
  }
  return answer(unknown ? 'unknown' : 'visible')
}
export type CorridorStation = GeoPoint & { distanceAlongMeters: number }
export function lineLengthMeters(coordinates: ReadonlyArray<readonly [number, number]>): number {
  let length = 0
  for (let i = 1; i < coordinates.length; i++) length += haversineMeters({ lng: coordinates[i - 1][0], lat: coordinates[i - 1][1] }, { lng: coordinates[i][0], lat: coordinates[i][1] })
  return length
}
export function sampleAlongLine(coordinates: ReadonlyArray<readonly [number, number]>, spacingMeters: number, maxStations = 400): CorridorStation[] {
  if (!coordinates.length) return []
  if (!(spacingMeters > 0) || !Number.isFinite(spacingMeters)) throw new Error('Station spacing must be positive.')
  const total = lineLengthMeters(coordinates)
  const first: CorridorStation = { lng: coordinates[0][0], lat: coordinates[0][1], distanceAlongMeters: 0 }
  if (!total) return [first]
  const spacing = Math.max(spacingMeters, total / Math.max(1, maxStations - 1)), output = [first]
  let segment = 1, startDistance = 0
  const segmentLength = (i: number) => haversineMeters({ lng: coordinates[i - 1][0], lat: coordinates[i - 1][1] }, { lng: coordinates[i][0], lat: coordinates[i][1] })
  let length = segmentLength(segment)
  for (let distance = spacing; distance < total - spacing * 0.5; distance += spacing) {
    while (segment < coordinates.length - 1 && (length === 0 || startDistance + length < distance)) { startDistance += length; length = segmentLength(++segment) }
    const t = length ? (distance - startDistance) / length : 0
    output.push({ lng: coordinates[segment - 1][0] + t * (coordinates[segment][0] - coordinates[segment - 1][0]), lat: coordinates[segment - 1][1] + t * (coordinates[segment][1] - coordinates[segment - 1][1]), distanceAlongMeters: distance })
  }
  const last = coordinates[coordinates.length - 1]
  output.push({ lng: last[0], lat: last[1], distanceAlongMeters: total })
  return output
}
export type PolygonGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon
export type Bounds = [number, number, number, number]
const ringsOf = (geometry: PolygonGeometry): GeoJSON.Position[][][] => geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
function inRing(ring: GeoJSON.Position[], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
export function pointInPolygon(geometry: PolygonGeometry, lng: number, lat: number): boolean {
  return ringsOf(geometry).some((rings) => !!rings[0] && inRing(rings[0], lng, lat) && !rings.slice(1).some((ring) => inRing(ring, lng, lat)))
}
export function polygonBounds(geometry: PolygonGeometry): Bounds {
  const box: Bounds = [Infinity, Infinity, -Infinity, -Infinity]
  for (const rings of ringsOf(geometry)) for (const ring of rings) for (const [x, y] of ring) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 180 || Math.abs(y) > 85) throw new Error('Invalid longitude/latitude polygon. Reproject the input to WGS84.')
    box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y)
  }
  return box
}
export function polygonAreaMeters(geometry: PolygonGeometry): number {
  const [minX, minY, , maxY] = polygonBounds(geometry)
  if (!Number.isFinite(minX)) return 0
  const scale = metersPerDegree((minY + maxY) / 2)
  let total = 0
  for (const rings of ringsOf(geometry)) rings.forEach((ring, index) => {
    let twice = 0
    // Work relative to the local origin to avoid cancellation of ~1e14 m² terms.
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) twice += ((ring[j][0] - minX) * (ring[i][1] - minY) - (ring[i][0] - minX) * (ring[j][1] - minY)) * scale.lng * scale.lat
    total += (index ? -1 : 1) * Math.abs(twice) / 2
  })
  return Math.max(0, total)
}
/** Interior scanline point: unlike a bounding-box centre it cannot land in a hole or a gap. */
export function polygonInteriorPoint(geometry: PolygonGeometry): GeoPoint | null {
  let best: GeoPoint | null = null, width = 0
  for (const rings of ringsOf(geometry)) {
    const ys = [...new Set(rings.flatMap((ring) => ring.map((p) => p[1])))].sort((a, b) => a - b)
    for (let k = 1; k < ys.length; k++) {
      const y = (ys[k] + ys[k - 1]) / 2, xs: number[] = []
      for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        if ((ring[i][1] > y) !== (ring[j][1] > y)) xs.push(ring[i][0] + (y - ring[i][1]) * (ring[j][0] - ring[i][0]) / (ring[j][1] - ring[i][1]))
      }
      xs.sort((a, b) => a - b)
      for (let j = 1; j < xs.length; j++) {
        const x = (xs[j] + xs[j - 1]) / 2, span = xs[j] - xs[j - 1]
        if (span > width && pointInPolygon(geometry, x, y)) { width = span; best = { lng: x, lat: y } }
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
    const dLat = spacingMeters / metersPerDegree((minLat + maxLat) / 2).lat, before = output.length
    const candidates = Math.ceil((maxLat - minLat) / dLat) * Math.ceil((maxLng - minLng) * metersPerDegree((minLat + maxLat) / 2).lng / spacingMeters)
    if (candidates > 2_000_000) throw new Error('The polygon is too elongated for this grid. Simplify/split the geometry or lower the sample budget.')
    for (let lat = minLat + dLat / 2; lat <= maxLat; lat += dLat) {
      const dLng = spacingMeters / Math.max(1, metersPerDegree(lat).lng)
      for (let lng = minLng + dLng / 2; lng <= maxLng; lng += dLng) if (pointInPolygon(component, lng, lat)) output.push({ lng, lat, areaMeters: spacingMeters ** 2 })
    }
    if (before === output.length) {
      const point = polygonInteriorPoint(component), area = polygonAreaMeters(component)
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
  const scale = metersPerDegree(lat), dx = spacingMeters / Math.max(1, scale.lng), dy = spacingMeters / scale.lat
  const e = source.elevationAt(lng + dx, lat), w = source.elevationAt(lng - dx, lat), n = source.elevationAt(lng, lat + dy), s = source.elevationAt(lng, lat - dy)
  if (![e, w, n, s].every(Number.isFinite)) return [NaN, NaN, NaN]
  const x = (e - w) / (2 * spacingMeters), y = (n - s) / (2 * spacingMeters), length = Math.hypot(x, y, 1)
  return [-x / length, -y / length, 1 / length]
}
/** Small-facet solid angle. Input area is HORIZONTAL, so dA_surface = dA_plan / normal.z. */
export function apparentSolidAngle(observer: GroundPoint & { eyeHeightMeters: number }, sample: GroundPoint, sampleAreaMeters: number, normal: Vector3): number {
  if (!normal.every(Number.isFinite) || !(normal[2] > 1e-8)) return 0
  const scale = metersPerDegree(sample.lat), east = (observer.lng - sample.lng) * scale.lng, north = (observer.lat - sample.lat) * scale.lat
  const up = observer.groundElevationMeters + observer.eyeHeightMeters - sample.groundElevationMeters, distance = Math.hypot(east, north, up)
  if (!Number.isFinite(distance) || distance < 1) return 0
  const incidence = Math.max(0, (normal[0] * east + normal[1] * north + normal[2] * up) / distance)
  return sampleAreaMeters / normal[2] * incidence / (distance * distance)
}
