/**
 * The little plane geometry the crossing readers need: distances, where a road line meets a stream
 * line, and how far along a line a point lies. Coordinates are WGS84 longitude and latitude;
 * distances are metres on a local plane tangent at a reference latitude, which over the few
 * kilometres round a block differs from BC Albers by well under a metre.
 *
 * DOM- and network-free.
 */
import type { Position } from 'geojson'

const R = 6_371_008.8
const RAD = Math.PI / 180

export type LonLat = [number, number]
type XY = [number, number]

/** Great-circle distance in metres. */
export function distanceM(a: Position, b: Position): number {
  const dLat = (b[1] - a[1]) * RAD
  const dLon = (b[0] - a[0]) * RAD
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

/** A plane tangent at `origin`: metres east and north, and back. */
export function localPlane(origin: Position) {
  const k = Math.cos(origin[1] * RAD) * R * RAD
  const toXY = (p: Position): XY => [(p[0] - origin[0]) * k, (p[1] - origin[1]) * R * RAD]
  const toLonLat = ([x, y]: XY): LonLat => [origin[0] + x / k, origin[1] + y / (R * RAD)]
  return { toXY, toLonLat }
}

/** The length of a line in metres. */
export function lineLengthM(line: Position[]): number {
  let n = 0
  for (let i = 1; i < line.length; i++) n += distanceM(line[i - 1], line[i])
  return n
}

export interface LineHit {
  point: LonLat
  /** Index of the segment on each line, and the share along it. */
  a: { index: number; t: number }
  b: { index: number; t: number }
}

/** Every place two lines cross or touch, segment by segment. */
export function lineIntersections(a: Position[], b: Position[], plane = localPlane(a[0])): LineHit[] {
  const pa = a.map(plane.toXY)
  const pb = b.map(plane.toXY)
  const hits: LineHit[] = []
  for (let i = 1; i < pa.length; i++) {
    const [x1, y1] = pa[i - 1]
    const [x2, y2] = pa[i]
    const minAx = Math.min(x1, x2)
    const maxAx = Math.max(x1, x2)
    const minAy = Math.min(y1, y2)
    const maxAy = Math.max(y1, y2)
    for (let j = 1; j < pb.length; j++) {
      const [x3, y3] = pb[j - 1]
      const [x4, y4] = pb[j]
      if (Math.max(x3, x4) < minAx || Math.min(x3, x4) > maxAx) continue
      if (Math.max(y3, y4) < minAy || Math.min(y3, y4) > maxAy) continue
      const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3)
      if (d === 0) continue
      const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d
      const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d
      if (t < 0 || t > 1 || u < 0 || u > 1) continue
      hits.push({
        point: plane.toLonLat([x1 + t * (x2 - x1), y1 + t * (y2 - y1)]),
        a: { index: i - 1, t },
        b: { index: j - 1, t: u },
      })
    }
  }
  return hits
}

export interface Nearest {
  distanceM: number
  point: LonLat
  /** Metres along the line from its first vertex to the nearest point. */
  alongM: number
  index: number
  t: number
}

/** The nearest point of a line to `p`. */
export function nearestOnLine(p: Position, line: Position[]): Nearest {
  const plane = localPlane(p)
  const pts = line.map(plane.toXY)
  let best: Nearest = { distanceM: Infinity, point: [p[0], p[1]], alongM: 0, index: 0, t: 0 }
  let along = 0
  if (pts.length === 1) {
    const d = Math.hypot(pts[0][0], pts[0][1])
    return { distanceM: d, point: [line[0][0], line[0][1]], alongM: 0, index: 0, t: 0 }
  }
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1]
    const [x2, y2] = pts[i]
    const dx = x2 - x1
    const dy = y2 - y1
    const len2 = dx * dx + dy * dy
    const t = len2 ? Math.max(0, Math.min(1, -(x1 * dx + y1 * dy) / len2)) : 0
    const x = x1 + t * dx
    const y = y1 + t * dy
    const d = Math.hypot(x, y)
    const len = Math.sqrt(len2)
    if (d < best.distanceM) best = { distanceM: d, point: plane.toLonLat([x, y]), alongM: along + t * len, index: i - 1, t }
    along += len
  }
  return best
}

/** Metres along a line to a point given by its segment and share, measured on the line itself. */
export function alongLineM(line: Position[], index: number, t: number): number {
  let n = 0
  for (let i = 1; i <= index && i < line.length; i++) n += distanceM(line[i - 1], line[i])
  if (index + 1 < line.length) n += t * distanceM(line[index], line[index + 1])
  return n
}

/** Whether a point lies inside a polygon's outer rings and outside their holes (even-odd). */
export function pointInPolygons(p: Position, polygons: Position[][][]): boolean {
  let inside = false
  for (const rings of polygons)
    for (const ring of rings)
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]
        const [xj, yj] = ring[j]
        if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
      }
  return inside
}

/** Metres from a point to the nearest edge of the polygons, 0 inside them. */
export function distanceToPolygonsM(p: Position, polygons: Position[][][]): number {
  if (pointInPolygons(p, polygons)) return 0
  let best = Infinity
  for (const rings of polygons) for (const ring of rings) best = Math.min(best, nearestOnLine(p, ring).distanceM)
  return best
}

/** The parts of a line or multi-line, as position lists. */
export function lineParts(geometry: { type: string; coordinates: unknown } | null | undefined): Position[][] {
  if (!geometry) return []
  if (geometry.type === 'LineString') return [geometry.coordinates as Position[]]
  if (geometry.type === 'MultiLineString') return geometry.coordinates as Position[][]
  return []
}

/** The points of a point or multi-point. */
export function pointParts(geometry: { type: string; coordinates: unknown } | null | undefined): Position[] {
  if (!geometry) return []
  if (geometry.type === 'Point') return [geometry.coordinates as Position]
  if (geometry.type === 'MultiPoint') return geometry.coordinates as Position[]
  return []
}

/** The polygons of a polygon or multi-polygon. */
export function polygonParts(geometry: { type: string; coordinates: unknown } | null | undefined): Position[][][] {
  if (!geometry) return []
  if (geometry.type === 'Polygon') return [geometry.coordinates as Position[][]]
  if (geometry.type === 'MultiPolygon') return geometry.coordinates as Position[][][]
  return []
}

/** Rounds a position to about a centimetre, for storing. */
export const roundPoint = (p: Position): LonLat => [Math.round(p[0] * 1e7) / 1e7, Math.round(p[1] * 1e7) / 1e7]
