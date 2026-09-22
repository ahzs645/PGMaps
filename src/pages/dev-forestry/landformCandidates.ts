import type { BcSensitivityUnit } from './bcVisualInventory'
import { metersPerDegree, pointInPolygon, polygonBounds, type GeoPoint, type PolygonGeometry } from './visibility'

/** Distance to the actual polygon edges, not its centroid or bounding box.
 * Local equirectangular metres are appropriate for ranking nearby BC units. */
export function distanceToPolygon(point: GeoPoint, geometry: PolygonGeometry): number {
  if (pointInPolygon(geometry, point.lng, point.lat)) return 0
  const scale = metersPerDegree(point.lat)
  let distance = Infinity
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  for (const rings of polygons) for (const ring of rings) for (let i = 1; i < ring.length; i++) {
    const ax = (ring[i - 1][0] - point.lng) * scale.lng, ay = (ring[i - 1][1] - point.lat) * scale.lat
    const bx = (ring[i][0] - point.lng) * scale.lng, by = (ring[i][1] - point.lat) * scale.lat
    const dx = bx - ax, dy = by - ay, length2 = dx * dx + dy * dy
    const t = length2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length2)) : 0
    distance = Math.min(distance, Math.hypot(ax + t * dx, ay + t * dy))
  }
  return distance
}

export function nearestLandformCandidates(units: BcSensitivityUnit[], point: GeoPoint, maxDistanceMeters = 25000) {
  return units.map(unit => ({ unit, distanceMeters: distanceToPolygon(point, unit.geometry) }))
    .filter(candidate => candidate.distanceMeters <= maxDistanceMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters || a.unit.id.localeCompare(b.unit.id))
    .slice(0, 5)
}

type XY = readonly [number, number]
function pointSegment2(p: XY, a: XY, b: XY) {
  const dx = b[0] - a[0], dy = b[1] - a[1], length = dx * dx + dy * dy
  const t = length ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length)) : 0
  return (p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2
}
function segmentDistance2(a: XY, b: XY, c: XY, d: XY) {
  const cross = (p: XY, q: XY, r: XY) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const ab = cross(a, b, c), ad = cross(a, b, d), ca = cross(c, d, a), cb = cross(c, d, b)
  if (ab * ad < 0 && ca * cb < 0) return 0
  return Math.min(pointSegment2(a, c, d), pointSegment2(b, c, d), pointSegment2(c, a, b), pointSegment2(d, a, b))
}

/** Closest approach anywhere on the supplied polyline, including between its
 * vertices. Polygon holes remain open; touching/crossing a boundary is zero.
 * Local planar metres are for candidate ranking, not a survey distance. */
export function distanceFromRoadToPolygon(road: ReadonlyArray<XY>, geometry: PolygonGeometry, limit = Infinity): number {
  if (!road.length) return Infinity
  if (pointInPolygon(geometry, road[0][0], road[0][1])) return 0
  if (road.length === 1) return distanceToPolygon({ lng: road[0][0], lat: road[0][1] }, geometry)
  const scale = metersPerDegree((Math.min(...road.map(p => p[1])) + Math.max(...road.map(p => p[1]))) / 2)
  const xy = (p: readonly number[]): XY => [(p[0] - road[0][0]) * scale.lng, (p[1] - road[0][1]) * scale.lat]
  const vertices = road.map(xy), bounds = polygonBounds(geometry), lo = xy([bounds[0], bounds[1]]), hi = xy([bounds[2], bounds[3]])
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  const edges = polygons.flatMap(rings => rings.flatMap(ring => ring.slice(1).map((p, i): [XY, XY] => [xy(ring[i]), xy(p)])))
  let best = Infinity
  const boxesDistance2 = (a: XY, b: XY, c: XY, d: XY) => {
    const dx = Math.max(0, Math.min(a[0], b[0]) - Math.max(c[0], d[0]), Math.min(c[0], d[0]) - Math.max(a[0], b[0]))
    const dy = Math.max(0, Math.min(a[1], b[1]) - Math.max(c[1], d[1]), Math.min(c[1], d[1]) - Math.max(a[1], b[1]))
    return dx * dx + dy * dy
  }
  for (let i = 1; i < vertices.length; i++) {
    const a = vertices[i - 1], b = vertices[i]
    if (boxesDistance2(a, b, lo, hi) > Math.min(best, limit * limit)) continue
    for (const [c, d] of edges) {
      if (boxesDistance2(a, b, c, d) > Math.min(best, limit * limit)) continue
      best = Math.min(best, segmentDistance2(a, b, c, d))
      if (best < 1e-12) return 0
    }
  }
  // A limit is a pruning bound, not evidence that a distant unit is at it.
  return best <= limit * limit ? Math.sqrt(best) : Infinity
}

export function nearestLandformsAlongRoad(units: BcSensitivityUnit[], road: ReadonlyArray<XY>, maxDistanceMeters = 25000) {
  return units.map(unit => ({ unit, distanceMeters: distanceFromRoadToPolygon(road, unit.geometry, maxDistanceMeters) }))
    .filter(candidate => candidate.distanceMeters <= maxDistanceMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters || a.unit.id.localeCompare(b.unit.id)).slice(0, 5)
}
