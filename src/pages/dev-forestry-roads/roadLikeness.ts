/**
 * Road-likeness: how much each cell of a bare-earth grid looks like a road bed, from 0.1 (not at
 * all) to 1. A road bed is gentle, smooth, and bounded by sharp breaks of slope at its cut and fill
 * batters. The score multiplies three terms read off the ground alone:
 *
 * - slope: 1 below 5°, falling to 0 at 20° (Horn's 3×3 slope);
 * - roughness: the spread (3×3 max − min) of the ground's departure from its own 5×5 mean, 1 below
 *   0.05 m falling to 0 at 0.10 m — stumps, windthrow and rock read as rough, a graded bed does not;
 * - slope edges: 0 where the 3×3 Sobel gradient of the slope raster is 40 or more (degrees per
 *   cell), the break-lines at road edges, ditches and batters, so the search cannot run along one.
 *
 * The product is floored at 0.1 so a short culvert fill or rough patch stays passable. This is the
 * ground-only form of the conductivity described by Roussel et al. (2022), "Correction, update, and
 * enhancement of vectorial forestry road maps using ALS data, a pathfinder, and seven metrics"
 * (doi:10.1016/j.jag.2022.103020; see docs/forestry-road-design/road-relocation-and-tracing.md).
 * The point-cloud terms (canopy over the bed, ground density, intensity) are not used.
 *
 * Missing ground stays missing: a cell is NaN when any ground value its windows read is NaN, so the
 * score of a cell near a gap is unknown, never floored. Pure: no DOM or network access.
 */
import type { SurfaceGrid } from './surfaceGrid'

/** Coarser ground cannot show a road bench: a 4–8 m bed is two to four 2 m cells. */
export const ROAD_FIND_MAX_CELL_M = 2
/** Cell the ground is sampled at for road finding and tracing; the activations are tuned at 1 m. */
export const ROAD_FIND_SAMPLE_CELL_M = 1
/** Cells the score's windows reach beyond a cell (5×5 mean, then 3×3 spread): sample this much extra. */
export const ROAD_LIKENESS_REACH_CELLS = 4

export interface RoadLikenessOptions {
  /** Slope term: 1 at or below the first, 0 at or above the second, degrees. */
  slopeDeg: [number, number]
  /** Roughness term: 1 at or below the first, 0 at or above the second, metres. */
  roughnessM: [number, number]
  /** Sobel magnitude of the slope raster (degrees per cell) at which a cell is a slope edge. */
  edgeLimit: number
  /** Lowest score of a known cell. */
  floor: number
}
export const DEFAULT_ROAD_LIKENESS: RoadLikenessOptions = {
  slopeDeg: [5, 20],
  roughnessM: [0.05, 0.1],
  edgeLimit: 40,
  floor: 0.1,
}

/**
 * Why this terrain cannot be searched for a road bench, or null when it can. `cellM` is the
 * terrain's own resolution, not the sampling cell.
 */
export function roadFindingTerrainProblem(cellM: number): string | null {
  if (!(cellM > 0) || !Number.isFinite(cellM))
    return 'The terrain has no known cell size, so a road bench cannot be read from it.'
  if (cellM > ROAD_FIND_MAX_CELL_M)
    return (
      `The terrain is ${cellM >= 10 ? cellM.toFixed(0) : cellM.toFixed(1)} m per cell. Finding a road on the ground needs bare-earth ` +
      `terrain of ${ROAD_FIND_MAX_CELL_M} m or finer: a 4–8 m road bench is lost in coarser cells, and the regional DEM (about 22 m) cannot show one. Import LiDAR under Terrain.`
    )
  return null
}

const down = (x: number, a: number, b: number) => Math.min(1, Math.max(0, (b - x) / (b - a)))
const ROW_SLICE = 64

/** Road-likeness on the same cells as `dtm`, run in slices. Throws on ground coarser than the limit. */
export function* roadLikenessSteps(
  dtm: SurfaceGrid,
  options: Partial<RoadLikenessOptions> = {},
): Generator<{ rows: number; of: number }, SurfaceGrid> {
  const problem = roadFindingTerrainProblem(dtm.cellM)
  if (problem) throw Error(problem)
  const o = { ...DEFAULT_ROAD_LIKENESS, ...options }
  const { width: w, height: h, cellM, values: z } = dtm
  const n = w * h
  const of = h * 4
  // Edge cells repeat their nearest neighbour; NaN propagates through every sum and comparison.
  const at = (arr: ArrayLike<number>, r: number, c: number) =>
    arr[Math.min(h - 1, Math.max(0, r)) * w + Math.min(w - 1, Math.max(0, c))]
  const slope = new Float64Array(n)
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const a = at(z, r - 1, c - 1),
        b = at(z, r - 1, c),
        cc = at(z, r - 1, c + 1),
        d = at(z, r, c - 1),
        f = at(z, r, c + 1),
        g = at(z, r + 1, c - 1),
        hh = at(z, r + 1, c),
        i = at(z, r + 1, c + 1)
      const dzdx = (cc + 2 * f + i - (a + 2 * d + g)) / (8 * cellM)
      const dzdy = (g + 2 * hh + i - (a + 2 * b + cc)) / (8 * cellM)
      const centre = z[r * w + c]
      slope[r * w + c] = Number.isNaN(centre) ? NaN : (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI
    }
    if (r % ROW_SLICE === 0) yield { rows: r, of }
  }
  // Residual from the 5×5 mean, separably: row sums, then column sums.
  const rowSum = new Float64Array(n)
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      let s = 0
      for (let k = -2; k <= 2; k++) s += at(z, r, c + k)
      rowSum[r * w + c] = s
    }
    if (r % ROW_SLICE === 0) yield { rows: h + r, of }
  }
  const residual = new Float64Array(n)
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      let s = 0
      for (let k = -2; k <= 2; k++) s += at(rowSum, r + k, c)
      residual[r * w + c] = z[r * w + c] - s / 25
    }
    if (r % ROW_SLICE === 0) yield { rows: 2 * h + r, of }
  }
  const values = new Float64Array(n)
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      let hi = -Infinity,
        lo = Infinity,
        unknown = false,
        gx = 0,
        gy = 0
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const v = at(residual, r + dr, c + dc)
          if (Number.isNaN(v)) unknown = true
          hi = Math.max(hi, v)
          lo = Math.min(lo, v)
          const s = at(slope, r + dr, c + dc)
          if (Number.isNaN(s)) unknown = true
          gx += s * dc * (dr === 0 ? 2 : 1)
          gy += s * dr * (dc === 0 ? 2 : 1)
        }
      const i = r * w + c
      if (unknown) {
        values[i] = NaN
        continue
      }
      const edge = Math.hypot(gx, gy)
      const score =
        down(slope[i], o.slopeDeg[0], o.slopeDeg[1]) *
        (edge < o.edgeLimit ? 1 : 0) *
        down(hi - lo, o.roughnessM[0], o.roughnessM[1])
      values[i] = Math.max(o.floor, score)
    }
    if (r % ROW_SLICE === 0) yield { rows: 3 * h + r, of }
  }
  return { origin: [dtm.origin[0], dtm.origin[1]], cellM, width: w, height: h, values }
}

/** Road-likeness in one go. */
export function roadLikeness(dtm: SurfaceGrid, options: Partial<RoadLikenessOptions> = {}): SurfaceGrid {
  const steps = roadLikenessSteps(dtm, options)
  let next = steps.next()
  while (!next.done) next = steps.next()
  return next.value
}
