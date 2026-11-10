/**
 * The facts a block sheet can work out for itself: gross area, centroid, BCGS mapsheet and the
 * elevation range inside the block. Area and centroid are planar in BC Albers (EPSG:3005), the
 * projection BC tenure areas are reported in. No DOM or network access.
 */
import proj4 from 'proj4'
import { BC_ALBERS } from '@/lib/geo/projectedCrs'
import { bcgsMapsheet } from './bcgs'
import type { HeightSource } from './classedRasters'

export type BlockGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon
type Ring = number[][]

/** Elevation samples taken inside a block at most; a larger block is sampled more coarsely. */
export const MAX_BLOCK_ELEVATION_SAMPLES = 250_000
/** The finest spacing elevation is sampled at inside a block, metres. */
export const MIN_BLOCK_ELEVATION_SPACING_M = 1

const albers = proj4('EPSG:4326', BC_ALBERS)

const polygonsOf = (geometry: BlockGeometry): Ring[][] =>
  geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates

function projectRings(geometry: BlockGeometry): [number, number][][][] {
  return polygonsOf(geometry).map((polygon) =>
    polygon.map((ring) => ring.map((p) => albers.forward([p[0], p[1]]) as [number, number])),
  )
}

/** Signed shoelace area and first moments of a ring. */
function ringMoments(ring: [number, number][]) {
  let area = 0,
    cx = 0,
    cy = 0
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i],
      [x1, y1] = ring[(i + 1) % ring.length]
    const cross = x0 * y1 - x1 * y0
    area += cross
    cx += (x0 + x1) * cross
    cy += (y0 + y1) * cross
  }
  return { area: area / 2, cx: cx / 6, cy: cy / 6 }
}

/**
 * Area (outer rings less holes, in square metres) and area-weighted centroid of projected
 * polygons. Ring orientation is normalised, so either winding gives the same answer.
 */
function moments(polygons: [number, number][][][]) {
  let area = 0,
    mx = 0,
    my = 0
  for (const polygon of polygons)
    polygon.forEach((ring, index) => {
      const m = ringMoments(ring)
      const sign = (index === 0 ? 1 : -1) * Math.sign(m.area || 1)
      area += sign * m.area
      mx += sign * m.cx
      my += sign * m.cy
    })
  return { area, mx, my }
}

/** Gross block area in hectares, planar in BC Albers (EPSG:3005). */
export function blockAreaHa(geometry: BlockGeometry): number {
  return Math.max(0, moments(projectRings(geometry)).area) / 10_000
}

/** Area-weighted centroid as longitude/latitude, computed in BC Albers. */
export function blockCentroid(geometry: BlockGeometry): [number, number] {
  const { area, mx, my } = moments(projectRings(geometry))
  if (!(Math.abs(area) > 0)) {
    // A degenerate polygon: fall back to the mean of its outer vertices.
    const points = polygonsOf(geometry).flatMap((polygon) => polygon[0] ?? [])
    return [
      points.reduce((sum, p) => sum + p[0], 0) / points.length,
      points.reduce((sum, p) => sum + p[1], 0) / points.length,
    ]
  }
  const [lng, lat] = albers.inverse([mx / area, my / area])
  return [lng, lat]
}

/** Longitude/latitude box of a block. */
export function blockBounds(geometry: BlockGeometry): [number, number, number, number] {
  let west = Infinity,
    south = Infinity,
    east = -Infinity,
    north = -Infinity
  for (const polygon of polygonsOf(geometry))
    for (const [lng, lat] of polygon[0] ?? []) {
      west = Math.min(west, lng)
      east = Math.max(east, lng)
      south = Math.min(south, lat)
      north = Math.max(north, lat)
    }
  return [west, south, east, north]
}

function insideRing(x: number, y: number, ring: [number, number][]) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export interface ElevationRange {
  min: number
  max: number
  /** Grid spacing the samples were taken at, metres. */
  spacingM: number
  /** Samples inside the block that had ground. */
  samples: number
  /** Samples inside the block with no ground under them. */
  missing: number
}

/**
 * Lowest and highest ground inside the block, sampled on a square grid in BC Albers at `spacingM`
 * (coarsened to keep within `MAX_BLOCK_ELEVATION_SAMPLES`). Null when no sample inside had ground.
 * A block only partly covered reports the covered part and how many samples were missing.
 */
export function blockElevationRange(
  geometry: BlockGeometry,
  source: HeightSource,
  spacingM: number,
): ElevationRange | null {
  const polygons = projectRings(geometry)
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const polygon of polygons)
    for (const [x, y] of polygon[0] ?? []) {
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
  if (!Number.isFinite(minX)) return null
  let spacing = Math.max(MIN_BLOCK_ELEVATION_SPACING_M, Number.isFinite(spacingM) ? spacingM : 1)
  const cellsAt = (s: number) => (Math.floor((maxX - minX) / s) + 1) * (Math.floor((maxY - minY) / s) + 1)
  while (cellsAt(spacing) > MAX_BLOCK_ELEVATION_SAMPLES) spacing *= 1.5
  let min = Infinity,
    max = -Infinity,
    samples = 0,
    missing = 0
  const inside = (x: number, y: number) =>
    polygons.some(
      (polygon) => insideRing(x, y, polygon[0] ?? []) && !polygon.slice(1).some((hole) => insideRing(x, y, hole)),
    )
  for (let y = minY + spacing / 2; y <= maxY; y += spacing)
    for (let x = minX + spacing / 2; x <= maxX; x += spacing) {
      if (!inside(x, y)) continue
      const [lng, lat] = albers.inverse([x, y])
      const value = source.elevationAt(lng, lat)
      if (!Number.isFinite(value)) {
        missing++
        continue
      }
      samples++
      if (value < min) min = value
      if (value > max) max = value
    }
  return samples ? { min, max, spacingM: spacing, samples, missing } : null
}

export interface BlockFacts {
  areaHa: number
  centroid: [number, number]
  mapsheet: string | null
  elevation: ElevationRange | null
}

export function blockFacts(geometry: BlockGeometry, terrain?: { source: HeightSource; spacingM: number }): BlockFacts {
  const centroid = blockCentroid(geometry)
  return {
    areaHa: blockAreaHa(geometry),
    centroid,
    mapsheet: bcgsMapsheet(centroid[0], centroid[1]),
    elevation: terrain ? blockElevationRange(geometry, terrain.source, terrain.spacingM) : null,
  }
}
