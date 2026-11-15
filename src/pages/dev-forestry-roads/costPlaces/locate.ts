/**
 * Suggests a project's cost location from where its road is: each of the road's points is tested
 * against a pack's region boundaries, and the region holding most of them is offered. A suggestion,
 * never a stored location: the project keeps a place only when the user accepts it. Free of DOM and
 * network access; the boundary file is fetched by the caller.
 */
import type { Coordinate } from '../types'
import type { CostPack, CostRegion } from './packs'
import type { CostPlace } from './places'

type Ring = Coordinate[]
type Polygon = Ring[]

interface BoundaryFeature {
  properties?: Record<string, unknown> | null
  geometry?: { type: string; coordinates: unknown } | null
}

export interface PreparedBoundary {
  region: CostRegion
  polygons: Polygon[]
  bbox: [number, number, number, number]
}

/** Matches each boundary feature to a pack region by the scheme's name property; unmatched features are dropped. */
export function prepareBoundaries(pack: CostPack, features: readonly BoundaryFeature[]): PreparedBoundary[] {
  const scheme = pack.regionScheme
  if (!scheme?.boundary) return []
  const prepared: PreparedBoundary[] = []
  for (const feature of features) {
    const name = feature.properties?.[scheme.boundary.nameProperty]
    const region = scheme.regions.find((item) => item.boundaryName === name)
    const geometry = feature.geometry
    if (!region || !geometry) continue
    const polygons =
      geometry.type === 'Polygon'
        ? [geometry.coordinates as Polygon]
        : geometry.type === 'MultiPolygon'
          ? (geometry.coordinates as Polygon[])
          : []
    if (!polygons.length) continue
    let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
    for (const polygon of polygons)
      for (const [x, y] of polygon[0] ?? []) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    prepared.push({ region, polygons, bbox: [minX, minY, maxX, maxY] })
  }
  return prepared
}

function inRing([x, y]: Coordinate, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function inPolygon(point: Coordinate, polygon: Polygon): boolean {
  if (!polygon.length || !inRing(point, polygon[0])) return false
  return !polygon.slice(1).some((hole) => inRing(point, hole))
}

/** The region a point falls in, or null outside every boundary. */
export function regionAt(point: Coordinate, boundaries: readonly PreparedBoundary[]): CostRegion | null {
  for (const boundary of boundaries) {
    const [minX, minY, maxX, maxY] = boundary.bbox
    if (point[0] < minX || point[0] > maxX || point[1] < minY || point[1] > maxY) continue
    if (boundary.polygons.some((polygon) => inPolygon(point, polygon))) return boundary.region
  }
  return null
}

export interface PlaceSuggestion {
  place: CostPlace
  /** Share of the road's points inside the suggested region, 0–1. */
  share: number
  /** "8 of 9 road points are in Omineca." */
  basis: string
}

/** The region holding most of the points; null when none falls inside the pack's boundaries. */
export function suggestPlace(
  pack: CostPack,
  points: readonly Coordinate[],
  boundaries: readonly PreparedBoundary[],
): PlaceSuggestion | null {
  if (!points.length || !pack.subdivision) return null
  const counts = new Map<string, { region: CostRegion; count: number }>()
  for (const point of points) {
    const region = regionAt(point, boundaries)
    if (!region) continue
    const entry = counts.get(region.id) ?? { region, count: 0 }
    entry.count++
    counts.set(region.id, entry)
  }
  const best = [...counts.values()].sort((a, b) => b.count - a.count)[0]
  if (!best) return null
  return {
    place: { country: pack.country, subdivision: pack.subdivision, region: best.region.id },
    share: best.count / points.length,
    basis: `${best.count} of ${points.length} road ${points.length === 1 ? 'point is' : 'points are'} in ${best.region.name}.`,
  }
}
