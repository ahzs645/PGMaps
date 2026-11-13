/**
 * Slope classes measured on the project's terrain, read with a sheet's own legend breaks, so a
 * printed slope map and the terrain can be compared range for range over the same block.
 * DOM and network free: a terrain raster and a lon/lat polygon in.
 */
import type { LocalRaster } from '../dev-forestry/types'
import { roadProjection } from './terrain'

export interface SlopeRange {
  minimum: number
  maximum: number | null
}
export interface TerrainSlopeSummary {
  areaM2: number
  /** Per legend range. Overlapping open ranges (85+, 95+) take the one with the highest minimum. */
  classM2: number[]
  /** Below the lowest printed range: what the sheet leaves undrawn. */
  belowM2: number
  /** Cells whose slope is unknown: terrain missing at the cell or a neighbour, or outside the raster. */
  missingM2: number
  cellM: number
  method: 'terrain-cell-centres'
}

/** Percent slope by central differences; NaN where the cell or a neighbour it needs is missing. */
export function slopePercentAt(raster: LocalRaster, col: number, row: number): number {
  const { width, height, values } = raster
  const at = (c: number, r: number) => values[r * width + c]
  const centre = at(col, row)
  if (centre === null) return NaN
  const left = col > 0 ? at(col - 1, row) : centre,
    right = col < width - 1 ? at(col + 1, row) : centre,
    up = row > 0 ? at(col, row - 1) : centre,
    down = row < height - 1 ? at(col, row + 1) : centre
  if (left === null || right === null || up === null || down === null) return NaN
  const spanX = (col > 0 ? 1 : 0) + (col < width - 1 ? 1 : 0),
    spanY = (row > 0 ? 1 : 0) + (row < height - 1 ? 1 : 0)
  const gx = (right - left) / (spanX * Math.abs(raster.pixelSize[0])),
    gy = (down - up) / (spanY * Math.abs(raster.pixelSize[1]))
  return Math.hypot(gx, gy) * 100
}

/** Index of the range a slope falls in, -1 below the lowest printed range. */
export function slopeRangeIndex(ranges: readonly SlopeRange[], slope: number): number {
  let best = -1
  ranges.forEach((range, i) => {
    if (slope >= range.minimum && (range.maximum === null || slope < range.maximum))
      if (best < 0 || range.minimum > ranges[best].minimum) best = i
  })
  return best
}

function insideRings(rings: readonly [number, number][][], x: number, y: number) {
  let hit = false
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i],
        b = ring[j]
      if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) hit = !hit
    }
  return hit
}

/**
 * Counts terrain cell centres inside the polygon by slope range. Cells are the terrain's own; area
 * is cell count × cell area, so the boundary is good to half a cell. Yields cooperatively.
 */
export function* summarizeTerrainSlopeSteps(
  raster: LocalRaster,
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  ranges: readonly SlopeRange[],
): Generator<number, TerrainSlopeSummary> {
  if (raster.epsg === 4326 || raster.epsg === 3857)
    throw Error('Slope needs terrain in a projected metre grid (BC Albers or UTM).')
  const projection = roadProjection(raster.epsg)
  const polygons = (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates).map((p) =>
    p.map((ring) => ring.map((c) => projection.forward([c[0], c[1]]) as [number, number])),
  )
  const cellArea = Math.abs(raster.pixelSize[0] * raster.pixelSize[1])
  const classM2 = ranges.map(() => 0)
  let belowM2 = 0,
    missingM2 = 0,
    areaM2 = 0
  for (const rings of polygons) {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity
    for (const [x, y] of rings[0]) {
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
    // Cell centres are at origin + index × pixel size; the raster's rows run south.
    const sx = raster.pixelSize[0],
      sy = raster.pixelSize[1]
    const c0 = Math.floor((minX - raster.origin[0]) / sx) - 1,
      c1 = Math.ceil((maxX - raster.origin[0]) / sx) + 1,
      r0 = Math.floor((maxY - raster.origin[1]) / sy) - 1,
      r1 = Math.ceil((minY - raster.origin[1]) / sy) + 1
    for (let row = r0; row <= r1; row++) {
      const y = raster.origin[1] + row * sy
      for (let col = c0; col <= c1; col++) {
        const x = raster.origin[0] + col * sx
        if (!insideRings(rings, x, y)) continue
        areaM2 += cellArea
        const slope =
          col < 0 || row < 0 || col >= raster.width || row >= raster.height ? NaN : slopePercentAt(raster, col, row)
        if (!Number.isFinite(slope)) missingM2 += cellArea
        else {
          const index = slopeRangeIndex(ranges, slope)
          if (index < 0) belowM2 += cellArea
          else classM2[index] += cellArea
        }
      }
      yield row
    }
  }
  if (!(areaM2 > 0)) throw Error('The area is smaller than one terrain cell.')
  return { areaM2, classM2, belowM2, missingM2, cellM: Math.abs(raster.pixelSize[0]), method: 'terrain-cell-centres' }
}
