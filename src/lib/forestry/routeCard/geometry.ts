/**
 * Shapes in metres on BC Albers (EPSG:3005), the frame DataBC serves and the route card tool
 * measured in: how far a feature is from a block or road, whether it touches it, how much of a
 * block it covers, which side of the block it lies on, and how much of a road runs through it.
 *
 * A feature "touches" when any edge crosses or any vertex lies inside the other shape: distance 0.
 * Polygons are read even-odd, so holes are holes. No DOM or network access.
 */
import polygonClipping, { type MultiPolygon as ClipMultiPolygon } from 'polygon-clipping'
import proj4 from 'proj4'

import { BC_ALBERS } from '@/lib/geo/projectedCrs'

export type XY = [number, number]
export type Ring = XY[]

export type Planar =
  | { kind: 'polygon'; polygons: Ring[][] }
  | { kind: 'line'; lines: XY[][] }
  | { kind: 'point'; points: XY[] }

export type PlanarBounds = [number, number, number, number]

const toAlbers = proj4('EPSG:4326', BC_ALBERS)

/** Longitude and latitude to BC Albers metres. */
export const albers = (lng: number, lat: number): XY => toAlbers.forward([lng, lat]) as XY

const finitePair = (value: unknown): value is [number, number] =>
  Array.isArray(value) && Number.isFinite(value[0]) && Number.isFinite(value[1])

/**
 * A GeoJSON geometry as a planar shape. `project` turns each position into metres: `albers` for
 * longitude and latitude, the identity for a layer already served in EPSG:3005. Null for an empty or
 * unreadable geometry; a collection of mixed kinds keeps its highest kind (polygon, then line).
 */
export function planarFromGeoJson(
  geometry: GeoJSON.Geometry | null | undefined,
  project: (position: [number, number]) => XY = (position) => [position[0], position[1]],
): Planar | null {
  const polygons: Ring[][] = []
  const lines: XY[][] = []
  const points: XY[] = []
  const path = (positions: unknown): XY[] =>
    Array.isArray(positions) ? positions.filter(finitePair).map((position) => project(position)) : []
  const visit = (shape: GeoJSON.Geometry | null | undefined) => {
    if (!shape) return
    switch (shape.type) {
      case 'Point':
        if (finitePair(shape.coordinates)) points.push(project(shape.coordinates))
        break
      case 'MultiPoint':
        points.push(...path(shape.coordinates))
        break
      case 'LineString':
        lines.push(path(shape.coordinates))
        break
      case 'MultiLineString':
        for (const line of shape.coordinates) lines.push(path(line))
        break
      case 'Polygon':
        polygons.push(shape.coordinates.map((ring) => path(ring)).filter((ring) => ring.length >= 3))
        break
      case 'MultiPolygon':
        for (const polygon of shape.coordinates)
          polygons.push(polygon.map((ring) => path(ring)).filter((ring) => ring.length >= 3))
        break
      case 'GeometryCollection':
        for (const part of shape.geometries) visit(part)
        break
    }
  }
  visit(geometry)
  const keptPolygons = polygons.filter((polygon) => polygon.length > 0)
  if (keptPolygons.length) return { kind: 'polygon', polygons: keptPolygons }
  const keptLines = lines.filter((line) => line.length >= 2)
  if (keptLines.length) return { kind: 'line', lines: keptLines }
  return points.length ? { kind: 'point', points } : null
}

/** Every vertex of a shape. */
function vertices(shape: Planar): XY[] {
  if (shape.kind === 'point') return shape.points
  if (shape.kind === 'line') return shape.lines.flat()
  return shape.polygons.flat(2)
}

/** Every edge of a shape, rings closed. */
function edges(shape: Planar): Array<[XY, XY]> {
  const out: Array<[XY, XY]> = []
  if (shape.kind === 'line')
    for (const line of shape.lines) for (let i = 1; i < line.length; i += 1) out.push([line[i - 1], line[i]])
  if (shape.kind === 'polygon')
    for (const polygon of shape.polygons)
      for (const ring of polygon)
        for (let i = 0; i < ring.length; i += 1) {
          const next = ring[(i + 1) % ring.length]
          if (next[0] !== ring[i][0] || next[1] !== ring[i][1]) out.push([ring[i], next])
        }
  return out
}

export function planarBounds(shape: Planar): PlanarBounds {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const [x, y] of vertices(shape)) {
    if (x < w) w = x
    if (y < s) s = y
    if (x > e) e = x
    if (y > n) n = y
  }
  return [w, s, e, n]
}

export const growBounds = (bounds: PlanarBounds, meters: number): PlanarBounds => [
  bounds[0] - meters,
  bounds[1] - meters,
  bounds[2] + meters,
  bounds[3] + meters,
]

const boundsMeet = (a: PlanarBounds, b: PlanarBounds) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]

/** Even-odd point in polygon over every ring of every part. */
export function insidePolygons(polygons: readonly Ring[][], [x, y]: XY): boolean {
  let inside = false
  for (const polygon of polygons)
    for (const ring of polygon)
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const [xi, yi] = ring[i]
        const [xj, yj] = ring[j]
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
      }
  return inside
}

function pointSegmentDistance([px, py]: XY, [ax, ay]: XY, [bx, by]: XY): number {
  const dx = bx - ax
  const dy = by - ay
  const length = dx * dx + dy * dy
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

const orientation = (a: XY, b: XY, c: XY) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))

function segmentsCross(a: XY, b: XY, c: XY, d: XY): boolean {
  const o1 = orientation(a, b, c)
  const o2 = orientation(a, b, d)
  const o3 = orientation(c, d, a)
  const o4 = orientation(c, d, b)
  if (o1 !== o2 && o3 !== o4) return true
  const onSegment = (p: XY, q: XY, r: XY) =>
    Math.min(p[0], r[0]) <= q[0] &&
    q[0] <= Math.max(p[0], r[0]) &&
    Math.min(p[1], r[1]) <= q[1] &&
    q[1] <= Math.max(p[1], r[1])
  return (
    (o1 === 0 && onSegment(a, c, b)) ||
    (o2 === 0 && onSegment(a, d, b)) ||
    (o3 === 0 && onSegment(c, a, d)) ||
    (o4 === 0 && onSegment(c, b, d))
  )
}

function segmentDistance(a: XY, b: XY, c: XY, d: XY): number {
  if (segmentsCross(a, b, c, d)) return 0
  return Math.min(
    pointSegmentDistance(a, c, d),
    pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b),
    pointSegmentDistance(d, a, b),
  )
}

const segmentBounds = (a: XY, b: XY): PlanarBounds => [
  Math.min(a[0], b[0]),
  Math.min(a[1], b[1]),
  Math.max(a[0], b[0]),
  Math.max(a[1], b[1]),
]

/**
 * A subject (a block or road) prepared for many distance questions: its edges, vertices and box.
 */
export type PreparedSubject = {
  shape: Planar
  bounds: PlanarBounds
  edges: Array<[XY, XY]>
  vertices: XY[]
  centroid: XY
}

export function prepareSubject(shape: Planar): PreparedSubject {
  const points = vertices(shape)
  const centroid: XY =
    shape.kind === 'polygon'
      ? polygonCentroid(shape.polygons)
      : [mean(points.map((p) => p[0])), mean(points.map((p) => p[1]))]
  return { shape, bounds: planarBounds(shape), edges: edges(shape), vertices: points, centroid }
}

const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)

function polygonCentroid(polygons: readonly Ring[][]): XY {
  let area = 0
  let cx = 0
  let cy = 0
  for (const polygon of polygons)
    polygon.forEach((ring, index) => {
      const sign = index === 0 ? 1 : -1
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
        area += sign * cross
        cx += sign * (ring[j][0] + ring[i][0]) * cross
        cy += sign * (ring[j][1] + ring[i][1]) * cross
      }
    })
  if (Math.abs(area) < 1e-9) {
    const all = polygons.flat(2)
    return [mean(all.map((p) => p[0])), mean(all.map((p) => p[1]))]
  }
  return [cx / (3 * area), cy / (3 * area)]
}

/**
 * Shortest distance in metres between a subject and a feature; 0 when they touch, cross or one
 * lies inside the other. Distances past `limit` are reported as `Infinity` without being measured
 * exactly: the route card asks only whether a feature is within its search.
 */
export function distanceToSubject(subject: PreparedSubject, feature: Planar, limit = Infinity): number {
  const featureBounds = planarBounds(feature)
  if (!boundsMeet(growBounds(subject.bounds, limit), featureBounds)) return Infinity
  if (feature.kind === 'polygon' && subject.vertices.some((vertex) => insidePolygons(feature.polygons, vertex)))
    return 0
  const featureVertices = vertices(feature)
  if (subject.shape.kind === 'polygon') {
    const polygons = subject.shape.polygons
    if (featureVertices.some((vertex) => insidePolygons(polygons, vertex))) return 0
  }
  const reach = growBounds(subject.bounds, Number.isFinite(limit) ? limit : 1e12)
  let best = Infinity
  const featureEdges = edges(feature)
  if (featureEdges.length) {
    for (const [c, d] of featureEdges) {
      if (!boundsMeet(reach, segmentBounds(c, d))) continue
      if (subject.edges.length)
        for (const [a, b] of subject.edges) {
          const distance = segmentDistance(a, b, c, d)
          if (distance < best) best = distance
          if (best === 0) return 0
        }
      else
        for (const vertex of subject.vertices) {
          const distance = pointSegmentDistance(vertex, c, d)
          if (distance < best) best = distance
        }
    }
  } else {
    for (const point of featureVertices) {
      if (point[0] < reach[0] || point[0] > reach[2] || point[1] < reach[1] || point[1] > reach[3]) continue
      if (subject.edges.length)
        for (const [a, b] of subject.edges) best = Math.min(best, pointSegmentDistance(point, a, b))
      else
        for (const vertex of subject.vertices)
          best = Math.min(best, Math.hypot(point[0] - vertex[0], point[1] - vertex[1]))
    }
  }
  return best <= limit ? best : Infinity
}

const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'] as const
export type CompassSide = (typeof COMPASS)[number]

/** The compass point (of eight) a bearing in degrees from north falls in. */
export const compassSide = (bearing: number): CompassSide =>
  COMPASS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8]

/** Degrees clockwise from grid north, from `from` to `to`. */
export const gridBearing = (from: XY, to: XY) => (Math.atan2(to[0] - from[0], to[1] - from[1]) * 180) / Math.PI

/**
 * The side of the subject a feature lies on: the bearing from the subject's centre to the mean of
 * the feature's vertices that lie within `near` metres of the subject (its nearest stretch), or to
 * the feature's centre when none do. For a feature that surrounds the subject the answer means little,
 * so callers ask only of features that do not cover it.
 */
export function sideOfSubject(subject: PreparedSubject, feature: Planar, near = 100): CompassSide {
  const close = vertices(feature).filter((vertex) => {
    const single: Planar = { kind: 'point', points: [vertex] }
    return distanceToSubject(subject, single, near) <= near
  })
  const target: XY = close.length
    ? [mean(close.map((p) => p[0])), mean(close.map((p) => p[1]))]
    : feature.kind === 'polygon'
      ? polygonCentroid(feature.polygons)
      : [mean(vertices(feature).map((p) => p[0])), mean(vertices(feature).map((p) => p[1]))]
  return compassSide(gridBearing(subject.centroid, target))
}

const asClip = (polygons: readonly Ring[][]): ClipMultiPolygon =>
  polygons.map((polygon) => polygon.map((ring) => ring.map(([x, y]) => [x, y] as [number, number])))

function ringArea(ring: readonly XY[]): number {
  let area = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1)
    area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
  return Math.abs(area) / 2
}

/** Area in square metres of a set of polygons, holes taken out. */
export function polygonsArea(polygons: readonly Ring[][]): number {
  return polygons.reduce(
    (sum, polygon) => sum + polygon.reduce((part, ring, index) => part + (index === 0 ? 1 : -1) * ringArea(ring), 0),
    0,
  )
}

/** Square metres where two polygon shapes overlap. */
export function overlapArea(a: readonly Ring[][], b: readonly Ring[][]): number {
  if (!a.length || !b.length) return 0
  try {
    return polygonsArea(polygonClipping.intersection(asClip(a), asClip(b)) as unknown as Ring[][])
  } catch {
    return 0
  }
}

/** Metres of a line shape inside a polygon shape, read at `step` metres along each segment. */
export function lengthInside(lines: readonly XY[][], polygons: readonly Ring[][], step = 5): number {
  let inside = 0
  for (const line of lines)
    for (let i = 1; i < line.length; i += 1) {
      const [a, b] = [line[i - 1], line[i]]
      const length = Math.hypot(b[0] - a[0], b[1] - a[1])
      const pieces = Math.max(1, Math.ceil(length / step))
      for (let k = 0; k < pieces; k += 1) {
        const t = (k + 0.5) / pieces
        if (insidePolygons(polygons, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])) inside += length / pieces
      }
    }
  return inside
}
