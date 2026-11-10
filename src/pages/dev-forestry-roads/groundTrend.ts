/**
 * The ground trend a road grade is judged against. A 1 m DTM carries relief no road follows: stump
 * holes, skid ruts and windthrow mounds. Comparing neighbouring 1 m samples reads those as grades of
 * 30 % or more on a hillside a road crosses at 6 %, which blocked every route search on LiDAR.
 *
 * Route searches read this surface for grades. Missing ground still comes from the source, sample
 * for sample, so a narrow data gap cannot be averaged away. Designed profiles, sections and
 * quantities never use it.
 */
import type { TerrainSource } from './types'

const METRES_PER_DEGREE = 111_194.93
/** Cells this fine or finer resolve the micro-relief; a coarser model has already averaged it. */
const FINEST_UNSMOOTHED_CELL_M = 3
export const DEFAULT_GROUND_WINDOW_M = 12
export const MAX_GROUND_WINDOW_M = 100

/** The search window a terrain needs: 12 m on LiDAR-scale cells, none on a coarser model. */
export const groundWindowFor = (resolutionM: number) =>
  resolutionM <= FINEST_UNSMOOTHED_CELL_M ? DEFAULT_GROUND_WINDOW_M : 0

/** The project's window, or the terrain's default when none was chosen. */
export const resolvedGroundWindow = (route: { groundWindowM: number | null } | undefined, resolutionM: number) =>
  route?.groundWindowM ?? groundWindowFor(resolutionM)

/** A moving mean of `terrain` over a square `windowM` wide. A window of 0 returns `terrain` itself. */
export function groundTrendTerrain(terrain: TerrainSource, windowM: number): TerrainSource {
  if (!(windowM > 0)) return terrain
  const spacing = windowM / 2,
    step = windowM / 4
  // Keyed by the numbers rather than `${col},${row}`: building that string was a tenth of a search.
  const nodes = new Map<number, Map<number, number>>()
  let origin: [number, number] | null = null,
    cosLat = 1
  const node = (col: number, row: number) => {
    let column = nodes.get(col)
    if (!column) nodes.set(col, (column = new Map()))
    const cached = column.get(row)
    if (cached !== undefined) return cached
    let sum = 0,
      count = 0
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const z = terrain.elevationAt(
          origin![0] + (col * spacing + dx * step) / (METRES_PER_DEGREE * cosLat),
          origin![1] + (row * spacing + dy * step) / METRES_PER_DEGREE,
        )
        if (Number.isFinite(z)) {
          sum += z
          count++
        }
      }
    const mean = count ? sum / count : NaN
    column.set(row, mean)
    return mean
  }
  return {
    elevationAt(lng, lat) {
      const source = terrain.elevationAt(lng, lat)
      if (!Number.isFinite(source)) return NaN
      if (!origin) {
        origin = [lng, lat]
        cosLat = Math.cos((lat * Math.PI) / 180)
      }
      const x = ((lng - origin[0]) * METRES_PER_DEGREE * cosLat) / spacing,
        y = ((lat - origin[1]) * METRES_PER_DEGREE) / spacing
      const col = Math.floor(x),
        row = Math.floor(y),
        fx = x - col,
        fy = y - row
      let sum = 0,
        weight = 0
      // The four corners in a fixed order, unrolled: the same sums as a loop, with no array per read.
      const add = (z: number, w: number) => {
        if (Number.isFinite(z) && w > 0) {
          sum += z * w
          weight += w
        }
      }
      add(node(col, row), (1 - fx) * (1 - fy))
      add(node(col + 1, row), fx * (1 - fy))
      add(node(col, row + 1), (1 - fx) * fy)
      add(node(col + 1, row + 1), fx * fy)
      return weight > 0 ? sum / weight : source
    },
  }
}
