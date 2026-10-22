/**
 * Planar polygon overlay in BC Albers. No DOM or network access, so the
 * procedure's arithmetic can be unit-tested outside a browser.
 */
import polygonClipping from 'polygon-clipping'
import type { BBox, MultiPolygonCoords, PolygonCoords, Ring } from './types'

const EMPTY: MultiPolygonCoords = []

function ringArea(ring: Ring): number {
  let sum = 0
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    sum += (ring[previous][0] - ring[index][0]) * (ring[previous][1] + ring[index][1])
  }
  return sum / 2
}

/** Square metres. Holes subtract whatever winding the source used. */
export function multiPolygonArea(geometry: MultiPolygonCoords): number {
  let total = 0
  for (const polygon of geometry) {
    polygon.forEach((ring, index) => {
      const area = Math.abs(ringArea(ring))
      total += index === 0 ? area : -area
    })
  }
  return Math.max(0, total)
}

export const squareMetresToHa = (value: number) => value / 10_000

export function bboxOf(geometry: MultiPolygonCoords): BBox {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const polygon of geometry) {
    for (const [x, y] of polygon[0] ?? []) {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  return [minX, minY, maxX, maxY]
}

export function bboxesOverlap(a: BBox, b: BBox): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]
}

/** Any GeoJSON polygonal geometry as multipolygon coordinates; other types become empty. */
export function toMultiPolygon(geometry: GeoJSON.Geometry | null | undefined): MultiPolygonCoords {
  if (!geometry) return EMPTY
  if (geometry.type === 'Polygon') return [geometry.coordinates.map(stripRing)]
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.map((polygon) => polygon.map(stripRing))
  if (geometry.type === 'GeometryCollection') return geometry.geometries.flatMap((part) => toMultiPolygon(part))
  return EMPTY
}

function stripRing(ring: GeoJSON.Position[]): Ring {
  return ring.map((position) => [position[0], position[1]])
}

type ClipGeom = Parameters<typeof polygonClipping.intersection>[0]
const asClip = (geometry: MultiPolygonCoords) => geometry as unknown as ClipGeom

function guarded(operation: () => MultiPolygonCoords): MultiPolygonCoords {
  try {
    return operation()
  } catch {
    // polygon-clipping throws on rare degenerate inputs (self-touching
    // slivers). Treat the pair as not overlapping; the caller's coverage
    // percentage then shows the gap rather than the run failing.
    return EMPTY
  }
}

export function intersect(a: MultiPolygonCoords, b: MultiPolygonCoords): MultiPolygonCoords {
  if (!a.length || !b.length) return EMPTY
  return guarded(() => polygonClipping.intersection(asClip(a), asClip(b)) as MultiPolygonCoords)
}

export function difference(a: MultiPolygonCoords, ...others: MultiPolygonCoords[]): MultiPolygonCoords {
  const parts = others.filter((part) => part.length)
  if (!a.length || !parts.length) return a
  return guarded(() => polygonClipping.difference(asClip(a), ...parts.map(asClip)) as MultiPolygonCoords)
}

export function union(...parts: MultiPolygonCoords[]): MultiPolygonCoords {
  const present = parts.filter((part) => part.length)
  if (!present.length) return EMPTY
  if (present.length === 1) return present[0]
  return guarded(() => polygonClipping.union(asClip(present[0]), ...present.slice(1).map(asClip)) as MultiPolygonCoords)
}

/** A cleaned copy of an input polygon: self-intersections and ring order fixed by a self-union. */
export function normalise(geometry: MultiPolygonCoords): MultiPolygonCoords {
  if (!geometry.length) return EMPTY
  try {
    return polygonClipping.union(asClip(geometry)) as MultiPolygonCoords
  } catch {
    return geometry
  }
}

export function rectangle(minX: number, minY: number, maxX: number, maxY: number): PolygonCoords {
  return [[[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY]]]
}

/**
 * Grows bounding boxes into clusters so a layer can be read with one spatial
 * filter per group of nearby blocks rather than one per block or one over a
 * whole region.
 */
export function clusterBoxes(boxes: BBox[], padding: number): BBox[] {
  return settle(boxes.map((box): BBox => [box[0] - padding, box[1] - padding, box[2] + padding, box[3] + padding]))
}

function settle(clusters: BBox[]): BBox[] {
  let changed = true
  let current = clusters
  while (changed) {
    changed = false
    const next: BBox[] = []
    for (const box of current) {
      const hit = next.findIndex((other) => bboxesOverlap(other, box))
      if (hit >= 0) {
        const other = next[hit]
        next[hit] = [Math.min(other[0], box[0]), Math.min(other[1], box[1]), Math.max(other[2], box[2]), Math.max(other[3], box[3])]
        changed = true
      } else next.push(box)
    }
    current = next
  }
  return current
}
