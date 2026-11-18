/**
 * Canopy across a road corridor, station by station, from any canopy-height sampler. A screen read
 * beside the design, never an input to it: it says where the road clears standing timber, where a
 * tree is tall enough to reach the running surface, and where a straight gap in the canopy already
 * runs along the line (an old road, trail or seismic line, or only a mapping artefact).
 *
 * Offsets are negative to the left looking up-station, as everywhere in the road designer.
 * DOM and network free.
 */
export interface CorridorStation {
  chainage: number
  coordinate: [number, number]
  /** Degrees clockwise from true north, up-station. */
  bearing: number
  /** Clearing edges from the centreline, metres; the corridor default is used when absent. */
  leftClearingM?: number
  rightClearingM?: number
}

export interface CorridorOptions {
  /** Half-width scanned either side of the centreline, metres. */
  halfWidthM: number
  /** Spacing of samples across the corridor, metres. */
  stepM: number
  /** Clearing half-width used when a station has none (a design's slope stakes are better). */
  defaultClearingHalfWidthM: number
  /** Height from which a cell counts as standing timber, metres. */
  timberM: number
  /** A centreline at or below this height between timber on both sides reads as a linear gap. */
  gapMaxM: number
  /** Half-width of the centreline band read for a gap, metres. */
  gapHalfWidthM: number
  /** Running-surface half-width a falling tree is screened against, metres. */
  runningHalfWidthM: number
}

export const CORRIDOR_DEFAULTS: CorridorOptions = {
  halfWidthM: 40,
  stepM: 1,
  defaultClearingHalfWidthM: 10,
  timberM: 5,
  gapMaxM: 2,
  gapHalfWidthM: 2,
  runningHalfWidthM: 3,
}

export interface CorridorStationCanopy {
  chainage: number
  /** Median height on the centreline band. */
  centreM: number | null
  /** Share of sampled cells inside the clearing at or above `timberM`. */
  clearingTimberShare: number | null
  /** Tallest cell inside the clearing. */
  clearingMaxM: number | null
  /** Cells outside the clearing whose height reaches the running surface's edge. */
  reachingTrees: number
  /** Tallest of those, with its offset (negative left). */
  tallestReaching: { heightM: number; offsetM: number } | null
  /** The centreline is open between timber on both sides. */
  gap: boolean
  sampled: number
}

const EARTH_M_PER_DEG = 111_320

function offset([lon, lat]: [number, number], bearingDeg: number, distanceM: number): [number, number] {
  const b = (bearingDeg * Math.PI) / 180
  return [
    lon + (Math.sin(b) * distanceM) / (EARTH_M_PER_DEG * Math.cos((lat * Math.PI) / 180)),
    lat + (Math.cos(b) * distanceM) / EARTH_M_PER_DEG,
  ]
}

const median = (v: number[]) => {
  if (!v.length) return null
  const s = [...v].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}

/** `sample` returns metres or NaN where the source has nothing. */
export function corridorCanopy(
  stations: readonly CorridorStation[],
  sample: (lon: number, lat: number) => number,
  options: Partial<CorridorOptions> = {},
): CorridorStationCanopy[] {
  const o = { ...CORRIDOR_DEFAULTS, ...options }
  return stations.map((s) => {
    const left = s.leftClearingM ?? o.defaultClearingHalfWidthM,
      right = s.rightClearingM ?? o.defaultClearingHalfWidthM
    const centre: number[] = [],
      inside: number[] = []
    const leftSide: number[] = [],
      rightSide: number[] = []
    let reachingTrees = 0,
      sampled = 0
    let tallestReaching: CorridorStationCanopy['tallestReaching'] = null
    for (let d = -o.halfWidthM; d <= o.halfWidthM + 1e-9; d += o.stepM) {
      const [lon, lat] = offset(s.coordinate, s.bearing + 90, d)
      const h = sample(lon, lat)
      if (!Number.isFinite(h)) continue
      sampled++
      if (Math.abs(d) <= o.gapHalfWidthM) centre.push(h)
      const inClearing = d >= -left && d <= right
      if (inClearing) inside.push(h)
      else {
        // Beside the clearing: the canopy the gap test compares against, within 15 m of its edge.
        if (d < 0 && d >= -left - 15) leftSide.push(h)
        if (d > 0 && d <= right + 15) rightSide.push(h)
        const reach = Math.abs(d) - o.runningHalfWidthM
        if (h >= reach) {
          reachingTrees++
          if (!tallestReaching || h > tallestReaching.heightM) tallestReaching = { heightM: h, offsetM: d }
        }
      }
    }
    const centreM = median(centre)
    const sideL = median(leftSide),
      sideR = median(rightSide)
    return {
      chainage: s.chainage,
      centreM,
      clearingTimberShare: inside.length ? inside.filter((h) => h >= o.timberM).length / inside.length : null,
      clearingMaxM: inside.length ? Math.max(...inside) : null,
      reachingTrees,
      tallestReaching,
      gap: centreM !== null && centreM <= o.gapMaxM && (sideL ?? 0) >= o.timberM && (sideR ?? 0) >= o.timberM,
      sampled,
    }
  })
}

/** Consecutive stations that read as a gap, as chainage ranges at least `minLengthM` long. */
export function gapRuns(canopy: readonly CorridorStationCanopy[], minLengthM: number) {
  const runs: { fromM: number; toM: number }[] = []
  let start: number | null = null,
    last = 0
  for (const c of canopy) {
    if (c.gap) {
      if (start === null) start = c.chainage
      last = c.chainage
    } else if (start !== null) {
      if (last - start >= minLengthM) runs.push({ fromM: start, toM: last })
      start = null
    }
  }
  if (start !== null && last - start >= minLengthM) runs.push({ fromM: start, toM: last })
  return runs
}
