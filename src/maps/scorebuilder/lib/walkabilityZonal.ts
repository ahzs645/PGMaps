import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import type { ScoreBuilderRegion } from '../types'

/**
 * Zonal aggregation of the citywide walkability Mobility Index raster into
 * boundary regions. This is what turns the MI surface from a display-only
 * overlay into a first-class scored output: the per-region mean band feeds a
 * normal metric, so it is ranked, inspectable, and exportable like any other.
 */
export interface WalkabilityMiGrid {
  rows: number
  cols: number
  imageCoordinates: [[number, number], [number, number], [number, number], [number, number]]
  defaultVariant: string
  grids: Record<string, Array<[number, number]>>
}

export interface RegionMiSummary {
  mean: number
  cellCount: number
}

/** Expands run-length `[band, count]` pairs into a per-cell band array (row-major). */
export function decodeRleBands(rle: Array<[number, number]>, cellCount: number): Uint8Array {
  const bands = new Uint8Array(cellCount)
  let index = 0
  for (const [value, count] of rle) {
    for (let k = 0; k < count && index < cellCount; k += 1) {
      bands[index] = value
      index += 1
    }
  }
  return bands
}

/**
 * Bilinear interpolation of a cell centre to lng/lat. `imageCoordinates` is the
 * MapLibre image-source convention `[topLeft, topRight, bottomRight, bottomLeft]`;
 * row 0 is the north edge and col 0 the west edge.
 */
export function cellCenterLngLat(
  imageCoordinates: WalkabilityMiGrid['imageCoordinates'],
  rows: number,
  cols: number,
  row: number,
  col: number,
): [number, number] {
  const u = cols > 0 ? (col + 0.5) / cols : 0.5
  const v = rows > 0 ? (row + 0.5) / rows : 0.5
  const [tl, tr, br, bl] = imageCoordinates
  const topLng = tl[0] + (tr[0] - tl[0]) * u
  const topLat = tl[1] + (tr[1] - tl[1]) * u
  const bottomLng = bl[0] + (br[0] - bl[0]) * u
  const bottomLat = bl[1] + (br[1] - bl[1]) * u
  return [topLng + (bottomLng - topLng) * v, topLat + (bottomLat - topLat) * v]
}

function resolveVariantKey(grid: WalkabilityMiGrid, variantKey?: string): string | null {
  if (variantKey && grid.grids[variantKey]) return variantKey
  if (grid.defaultVariant && grid.grids[grid.defaultVariant]) return grid.defaultVariant
  const first = Object.keys(grid.grids)[0]
  return first ?? null
}

/**
 * Mean MI band (1–5) of the raster cells whose centre falls inside each region.
 * Iterates only non-zero RLE runs, so the ~550k-cell citywide grid is cheap.
 */
export function zonalMeanMiByRegion(
  grid: WalkabilityMiGrid,
  regions: ScoreBuilderRegion[],
  variantKey?: string,
): Map<string, RegionMiSummary> {
  const result = new Map<string, RegionMiSummary>()
  if (regions.length === 0) return result

  const variant = resolveVariantKey(grid, variantKey)
  const rle = variant ? grid.grids[variant] : null
  if (!rle) return result

  const { rows, cols } = grid
  const sums = new Map<string, number>()
  const counts = new Map<string, number>()
  // Reused probe point so the per-cell hit test allocates nothing.
  const probe: GeoJSON.Point = { type: 'Point', coordinates: [0, 0] }

  let index = 0
  for (const [band, count] of rle) {
    if (band <= 0) {
      index += count
      continue
    }
    for (let k = 0; k < count; k += 1) {
      const cell = index + k
      const row = Math.floor(cell / cols)
      const col = cell % cols
      const [lng, lat] = cellCenterLngLat(grid.imageCoordinates, rows, cols, row, col)
      probe.coordinates[0] = lng
      probe.coordinates[1] = lat
      for (const region of regions) {
        const [west, south, east, north] = region.bounds
        if (lng < west || lng > east || lat < south || lat > north) continue
        if (booleanPointInPolygon(probe, region.feature as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>)) {
          sums.set(region.id, (sums.get(region.id) ?? 0) + band)
          counts.set(region.id, (counts.get(region.id) ?? 0) + 1)
          break
        }
      }
    }
    index += count
  }

  for (const region of regions) {
    const cellCount = counts.get(region.id) ?? 0
    result.set(region.id, {
      mean: cellCount > 0 ? (sums.get(region.id) ?? 0) / cellCount : 0,
      cellCount,
    })
  }
  return result
}
