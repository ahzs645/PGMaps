/**
 * Road bench evidence from bare-earth cross-sections. Every `spacingM` along a line, a profile is
 * cut square to it and read outward from its flattest point near the line: the first stretch that
 * rises or falls at the shoulder slope or steeper for at least `minEmbankmentM` is a batter (cut or
 * fill), and the bench edge is where that batter starts. A side with no batter takes the first
 * point that departs from the bench level by `flatToleranceM` instead.
 *
 * The width is the **bench** between those edges, not the drivable width: telling brush on the
 * bed from a clear running surface needs the vegetation returns of an unthinned point cloud. The
 * method is the ground-only form of the slice measurement in Roussel et al. (2022); see
 * docs/forestry-road-design/road-relocation-and-tracing.md. Pure: no DOM or network access.
 */
import { cumulativeLength, pointAlong, quantile, type XY } from './roadGrid'
import { sampleBilinear, type SurfaceGrid } from './surfaceGrid'

/** Slices are cut this far apart along the line, m. */
export const ROAD_SLICE_SPACING_M = 10
/** Each slice reaches this far either side of the line, m. */
export const ROAD_SLICE_HALF_WIDTH_M = 15
/** Profile sample spacing across a slice, m. */
export const ROAD_SLICE_STEP_M = 0.5
/** A batter starts where the cross slope reaches this, degrees. */
export const ROAD_SHOULDER_SLOPE_DEG = 10
/** A batter must run at least this far across to count, m. */
export const ROAD_MIN_EMBANKMENT_M = 1
/** With no batter, the edge is where the ground departs this far from the bench level, m. */
export const ROAD_FLAT_TOLERANCE_M = 0.15
/** The slice centre may move this far either side to sit on the bench, m. */
export const ROAD_SLICE_RECENTRE_M = 2
/** A bench narrower or wider than this is not read as a road, m. */
export const ROAD_BENCH_MIN_WIDTH_M = 2.5
export const ROAD_BENCH_MAX_WIDTH_M = 20

export interface RoadSlice {
  /** Along the measured line, m. */
  chainage: number
  /** Slice centre after re-centring; negative is left looking along the line. */
  centreShiftM: number
  /** Bench edges, offsets from the line (negative left). */
  leftEdgeM: number
  rightEdgeM: number
  widthM: number
  /** Sides whose edge is the start of a batter rather than a level departure. */
  shoulders: 0 | 1 | 2
  /** Cross slope at the centre, degrees. */
  centreSlopeDeg: number
  /** Every profile sample had ground. Incomplete slices are excluded from all figures. */
  complete: boolean
  /** A flat centre, at least one batter and a plausible width: what a road bench looks like. */
  bench: boolean
}

export interface RoadSliceOptions {
  spacingM: number
  halfWidthM: number
  stepM: number
  shoulderSlopeDeg: number
  minEmbankmentM: number
  flatToleranceM: number
  recentreM: number
}
export const DEFAULT_ROAD_SLICES: RoadSliceOptions = {
  spacingM: ROAD_SLICE_SPACING_M,
  halfWidthM: ROAD_SLICE_HALF_WIDTH_M,
  stepM: ROAD_SLICE_STEP_M,
  shoulderSlopeDeg: ROAD_SHOULDER_SLOPE_DEG,
  minEmbankmentM: ROAD_MIN_EMBANKMENT_M,
  flatToleranceM: ROAD_FLAT_TOLERANCE_M,
  recentreM: ROAD_SLICE_RECENTRE_M,
}

export interface RoadSliceSummary {
  slices: RoadSlice[]
  /** Bench width over the slices read as a bench; null when none was. */
  widthM: { p10: number; p50: number; p90: number } | null
  /** Share of complete slices with a bench. */
  benchShare: number
  /** Share of complete slices with a bench and a batter on both sides. */
  bothShoulderShare: number
  /** Complete slices, of all slices cut. */
  complete: number
}

const movingAverage3 = (v: Float64Array) => {
  const out = new Float64Array(v)
  for (let i = 1; i < v.length - 1; i++) out[i] = (v[i - 1] + v[i] + v[i + 1]) / 3
  return out
}

/** One slice at `at`, square to `dir`. */
export function measureSlice(
  dtm: SurfaceGrid,
  at: XY,
  dir: XY,
  chainage: number,
  options: Partial<RoadSliceOptions> = {},
): RoadSlice {
  const o = { ...DEFAULT_ROAD_SLICES, ...options }
  const count = Math.round((2 * o.halfWidthM) / o.stepM) + 1
  const offsets = Array.from({ length: count }, (_, i) => -o.halfWidthM + i * o.stepM)
  // Left of the direction of travel is negative: the unit right normal is (dy, −dx).
  const nx = dir[1],
    ny = -dir[0]
  const raw = new Float64Array(count)
  let complete = true
  for (let i = 0; i < count; i++) {
    raw[i] = sampleBilinear(dtm, at[0] + nx * offsets[i], at[1] + ny * offsets[i])
    if (Number.isNaN(raw[i])) complete = false
  }
  const empty: RoadSlice = {
    chainage,
    centreShiftM: 0,
    leftEdgeM: 0,
    rightEdgeM: 0,
    widthM: 0,
    shoulders: 0,
    centreSlopeDeg: NaN,
    complete: false,
    bench: false,
  }
  if (!complete) return empty
  const z = movingAverage3(raw)
  const slope = new Float64Array(count)
  for (let i = 0; i < count; i++) {
    const a = Math.max(0, i - 1),
      b = Math.min(count - 1, i + 1)
    slope[i] = (Math.atan(Math.abs((z[b] - z[a]) / ((b - a) * o.stepM))) * 180) / Math.PI
  }
  const smoothSlope = movingAverage3(slope)
  let centre = Math.floor(count / 2)
  for (let i = 0; i < count; i++)
    if (Math.abs(offsets[i]) <= o.recentreM + 1e-9 && smoothSlope[i] < smoothSlope[centre]) centre = i
  const zc = z[centre]
  const batter = (step: 1 | -1): number | null => {
    let start = -1
    for (let k = centre + step; k >= 0 && k < count; k += step) {
      if (start < 0) {
        if (slope[k] >= o.shoulderSlopeDeg) start = k
      } else if (slope[k] <= o.shoulderSlopeDeg) {
        return counts(start, k) ? offsets[start] : null
      }
    }
    return start >= 0 && counts(start, step > 0 ? count - 1 : 0) ? offsets[start] : null
  }
  const counts = (start: number, end: number) => {
    const dx = Math.abs(offsets[end] - offsets[start]),
      dz = Math.abs(z[end] - z[start])
    return dx >= o.minEmbankmentM && (Math.atan2(dz, dx) * 180) / Math.PI >= o.shoulderSlopeDeg
  }
  const level = (step: 1 | -1): number => {
    for (let k = centre + step; k >= 0 && k < count; k += step)
      if (Math.abs(z[k] - zc) > o.flatToleranceM) return offsets[k]
    return offsets[step > 0 ? count - 1 : 0]
  }
  const right = batter(1),
    left = batter(-1)
  const rightEdgeM = right ?? level(1),
    leftEdgeM = left ?? level(-1)
  const widthM = rightEdgeM - leftEdgeM
  const shoulders = ((right === null ? 0 : 1) + (left === null ? 0 : 1)) as 0 | 1 | 2
  const centreSlopeDeg = smoothSlope[centre]
  return {
    chainage,
    centreShiftM: offsets[centre],
    leftEdgeM,
    rightEdgeM,
    widthM,
    shoulders,
    centreSlopeDeg,
    complete: true,
    bench:
      centreSlopeDeg < o.shoulderSlopeDeg &&
      shoulders > 0 &&
      widthM >= ROAD_BENCH_MIN_WIDTH_M &&
      widthM <= ROAD_BENCH_MAX_WIDTH_M,
  }
}

/** Slices every `spacingM` along `line`, starting half a spacing in, and what they add up to. */
export function measureRoadSlices(
  dtm: SurfaceGrid,
  line: readonly XY[],
  options: Partial<RoadSliceOptions> = {},
): RoadSliceSummary {
  const o = { ...DEFAULT_ROAD_SLICES, ...options }
  const cum = cumulativeLength(line)
  const total = cum.at(-1) ?? 0
  const slices: RoadSlice[] = []
  for (
    let s = Math.min(o.spacingM / 2, total / 2);
    s <= total - Math.min(o.spacingM / 2, total / 2) + 1e-9;
    s += o.spacingM
  ) {
    if (total <= 0) break
    const { at, dir } = pointAlong(line, cum, s)
    slices.push(measureSlice(dtm, at, dir, s, o))
  }
  return summarizeSlices(slices)
}

export function summarizeSlices(slices: RoadSlice[]): RoadSliceSummary {
  const complete = slices.filter((s) => s.complete)
  const benches = complete.filter((s) => s.bench)
  const widths = benches.map((s) => s.widthM).sort((a, b) => a - b)
  return {
    slices,
    widthM: widths.length
      ? { p10: quantile(widths, 0.1)!, p50: quantile(widths, 0.5)!, p90: quantile(widths, 0.9)! }
      : null,
    benchShare: complete.length ? benches.length / complete.length : 0,
    bothShoulderShare: complete.length ? benches.filter((s) => s.shoulders === 2).length / complete.length : 0,
    complete: complete.length,
  }
}
