/**
 * Road-likeness: how much each cell of a bare-earth grid looks like a road bed, from 0.1 (not at
 * all) to 1. A road bed is gentle, smooth, and bounded by sharp breaks of slope at its cut and fill
 * batters. Two forms, and the result card names the one that ran:
 *
 * **Terrain only** (no point cloud) multiplies three terms read off the ground alone:
 *
 * - slope: 1 below 5°, falling to 0 at 20° (Horn's 3×3 slope);
 * - roughness: the spread (3×3 max − min) of the ground's departure from its own 5×5 mean, 1 below
 *   0.05 m falling to 0 at 0.10 m — stumps, windthrow and rock read as rough, a graded bed does not;
 * - slope edges: 0 where the 3×3 Sobel gradient of the slope raster is 40 or more (degrees per
 *   cell), the break-lines at road edges, ditches and batters, so the search cannot run along one.
 *
 * **Terrain + vegetation** (with point-cloud evidence, `vegetationEvidence.ts`) follows the paper's
 * equation 1: three gates — slope, low vegetation (fewer than two returns 0.5–3 m up) and slope
 * edges — times a weighted vote of ground-return density (weight 2, rising between the corridor's
 * 25th and 95th percentiles), canopy height (1 at 0.1 m, 0 at 0.2 m), roughness, and intensity range
 * (1 at the corridor's 10th percentile, 0 at its 50th; left out when the cloud has no intensity).
 * Roughness is a vote here, not a gate. Every activation is rounded to three decimals.
 *
 * Either is floored at 0.1 so a short culvert fill or rough patch stays passable. Both follow
 * Roussel, Bourdon, Morley, Coops & Achim (2022), "Correction, update, and enhancement of
 * vectorial forestry road maps using ALS data, a pathfinder, and seven metrics", IJAEOG 114,
 * 103020 (doi:10.1016/j.jag.2022.103020; see docs/forestry-road-design/road-relocation-and-tracing.md).
 * Written from the paper and a functional specification of ALSroads 0.2.0; no code from ALSroads
 * (GPL-3) was used.
 *
 * Missing ground stays missing: a cell is NaN when any ground value its windows read is NaN, so the
 * score of a cell near a gap is unknown, never floored. Pure: no DOM or network access.
 */
import { quantile } from './roadGrid'
import type { EvidenceOnFrame } from './vegetationEvidence'
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

/** The point-cloud terms of equation 1 and the weights of its vote. */
export interface RoadConductivityOptions {
  /** Canopy term: 1 at or below the first height above ground, 0 at or above the second, m. */
  canopyM: [number, number]
  /** Low-vegetation gate: closed at this many returns 0.5–3 m up per cell, or more. */
  lowCount: number
  /** Density term: 0 at or below the corridor's first quantile of non-zero densities, 1 at the second. */
  densityQuantiles: [number, number]
  /** Intensity term: 1 at or below the corridor's first quantile of cell ranges, 0 at the second. */
  intensityQuantiles: [number, number]
  weights: { density: number; canopy: number; roughness: number; intensity: number }
}
export const DEFAULT_ROAD_CONDUCTIVITY: RoadConductivityOptions = {
  canopyM: [0.1, 0.2],
  lowCount: 2,
  densityQuantiles: [0.25, 0.95],
  intensityQuantiles: [0.1, 0.5],
  weights: { density: 2, canopy: 1, roughness: 1, intensity: 1 },
}

/** Activations of the seven terms, each 0–1; intensity null when the cloud has none. */
export interface RoadConductivityTerms {
  slope: number
  roughness: number
  edge: number
  low: number
  canopy: number
  density: number
  intensity: number | null
}

const round3 = (v: number) => Math.round(v * 1000) / 1000
export const slopeActivation = (deg: number, o: Pick<RoadLikenessOptions, 'slopeDeg'> = DEFAULT_ROAD_LIKENESS) =>
  round3(down(deg, o.slopeDeg[0], o.slopeDeg[1]))
export const roughnessActivation = (m: number, o: Pick<RoadLikenessOptions, 'roughnessM'> = DEFAULT_ROAD_LIKENESS) =>
  round3(down(m, o.roughnessM[0], o.roughnessM[1]))
export const edgeActivation = (sobel: number, o: Pick<RoadLikenessOptions, 'edgeLimit'> = DEFAULT_ROAD_LIKENESS) =>
  sobel < o.edgeLimit ? 1 : 0
export const lowVegetationActivation = (
  returns: number,
  o: Pick<RoadConductivityOptions, 'lowCount'> = DEFAULT_ROAD_CONDUCTIVITY,
) => (returns < o.lowCount ? 1 : 0)
export const canopyActivation = (m: number, o: Pick<RoadConductivityOptions, 'canopyM'> = DEFAULT_ROAD_CONDUCTIVITY) =>
  round3(down(m, o.canopyM[0], o.canopyM[1]))
/** 0 at or below `lo`, 1 at or above `hi`; a step at `hi` when the two meet. */
export const risingActivation = (x: number, lo: number, hi: number) =>
  hi > lo ? round3(1 - down(x, lo, hi)) : x >= hi ? 1 : 0
/** 1 at or below `lo`, 0 at or above `hi`; a step at `hi` when the two meet. */
export const fallingActivation = (x: number, lo: number, hi: number) =>
  hi > lo ? round3(down(x, lo, hi)) : x < hi ? 1 : 0

/** Equation 1: gates times the weighted vote, floored. Intensity leaves the vote when null. */
export function combineRoadConductivity(
  t: RoadConductivityTerms,
  weights: RoadConductivityOptions['weights'] = DEFAULT_ROAD_CONDUCTIVITY.weights,
  floor = DEFAULT_ROAD_LIKENESS.floor,
): number {
  const wi = t.intensity === null ? 0 : weights.intensity
  const vote =
    (weights.density * t.density +
      weights.canopy * t.canopy +
      weights.roughness * t.roughness +
      wi * (t.intensity ?? 0)) /
    (weights.density + weights.canopy + weights.roughness + wi)
  return Math.max(floor, t.slope * t.low * t.edge * vote)
}

/** Point-cloud evidence on the same cells as the terrain, and the cells its percentiles come from. */
export interface RoadLikenessEvidence {
  layers: EvidenceOnFrame
  /** Cells (1) whose densities and intensity ranges set the relative thresholds: the corridor. */
  population: Uint8Array
  options?: Partial<RoadConductivityOptions>
}

/** Road-likeness on the same cells as `dtm`, run in slices. Throws on ground coarser than the limit. */
export function* roadLikenessSteps(
  dtm: SurfaceGrid,
  options: Partial<RoadLikenessOptions> = {},
  evidence?: RoadLikenessEvidence,
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
  const cloud = evidence ? cloudTerms(evidence, w, h) : null
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
      if (cloud) {
        values[i] = combineRoadConductivity(
          {
            slope: slopeActivation(slope[i], o),
            roughness: roughnessActivation(hi - lo, o),
            edge: edgeActivation(edge, o),
            ...cloud(i),
          },
          cloud.weights,
          o.floor,
        )
        continue
      }
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

/**
 * The four point-cloud activations per cell. Ground density is smoothed by a 3×3 weighted mean
 * (centre weight 2) before its corridor percentiles are taken over the non-zero values. A cell with
 * no evidence at all votes nothing for road: no canopy or intensity term, no density, gate open.
 */
function cloudTerms(evidence: RoadLikenessEvidence, w: number, h: number) {
  const o = { ...DEFAULT_ROAD_CONDUCTIVITY, ...evidence.options }
  const { layers, population } = evidence
  const n = w * h
  const density = new Float64Array(n)
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      let s = 0,
        weight = 0
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr,
            cc = c + dc
          if (rr < 0 || cc < 0 || rr >= h || cc >= w) continue
          const k = dr === 0 && dc === 0 ? 2 : 1
          s += k * layers.groundDensity[rr * w + cc]
          weight += k
        }
      density[r * w + c] = s / weight
    }
  const densities: number[] = [],
    ranges: number[] = []
  for (let i = 0; i < n; i++) {
    if (!population[i]) continue
    if (density[i] > 0) densities.push(density[i])
    const v = layers.intensityRange?.[i]
    if (v !== undefined && Number.isFinite(v)) ranges.push(v)
  }
  densities.sort((a, b) => a - b)
  ranges.sort((a, b) => a - b)
  const dLo = quantile(densities, o.densityQuantiles[0]) ?? Infinity,
    dHi = quantile(densities, o.densityQuantiles[1]) ?? Infinity
  const iLo = quantile(ranges, o.intensityQuantiles[0]),
    iHi = quantile(ranges, o.intensityQuantiles[1])
  const intensity = layers.intensityRange && iLo !== null && iHi !== null
  const terms = (i: number) => {
    const canopy = layers.canopyM[i],
      low = layers.low[i],
      range = layers.intensityRange?.[i] ?? NaN
    return {
      low: Number.isNaN(low) ? 1 : lowVegetationActivation(low, o),
      canopy: Number.isNaN(canopy) ? 0 : canopyActivation(canopy, o),
      density: risingActivation(density[i], dLo, dHi),
      intensity: intensity ? (Number.isNaN(range) ? 0 : fallingActivation(range, iLo!, iHi!)) : null,
    }
  }
  return Object.assign(terms, { weights: o.weights })
}

/** Road-likeness in one go. */
export function roadLikeness(
  dtm: SurfaceGrid,
  options: Partial<RoadLikenessOptions> = {},
  evidence?: RoadLikenessEvidence,
): SurfaceGrid {
  const steps = roadLikenessSteps(dtm, options, evidence)
  let next = steps.next()
  while (!next.done) next = steps.next()
  return next.value
}
