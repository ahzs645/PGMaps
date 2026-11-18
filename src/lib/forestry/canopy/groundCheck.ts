/**
 * Checks a terrain against independent ground heights (ICESat-2 ground photons, survey shots,
 * LiDAR ground points): the difference at every point, binned so that a dense laser track is not
 * counted a thousand times, and summarised by local slope, where a few metres of horizontal error
 * become metres of height. A check, never a correction: the terrain is not shifted by its result.
 *
 * DOM and network free.
 */
export interface GroundPoint {
  lon: number
  lat: number
  /** Orthometric height in the terrain's vertical datum, metres. */
  h: number
  /** Groups points that came from one pass (a date, a beam), so a bin never mixes passes. */
  group: string
}

export interface GroundCheckBin {
  lon: number
  lat: number
  group: string
  /** Median of the bin's reference heights. */
  reference: number
  terrain: number
  difference: number
  points: number
  slopePercent: number | null
}

export interface DifferenceStats {
  bins: number
  meanM: number
  medianM: number
  /** Median absolute deviation from the median, scaled to a normal standard deviation (× 1.4826). */
  robustSpreadM: number
  rmseM: number
  p05M: number
  p95M: number
}

const sorted = (v: number[]) => [...v].sort((a, b) => a - b)
const quantile = (s: number[], q: number) => {
  if (!s.length) return NaN
  const i = (s.length - 1) * q,
    lo = Math.floor(i),
    hi = Math.ceil(i)
  return s[lo] + (s[hi] - s[lo]) * (i - lo)
}
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d

export function differenceStats(differences: number[]): DifferenceStats | null {
  if (!differences.length) return null
  const s = sorted(differences)
  const med = quantile(s, 0.5)
  const mad = quantile(sorted(s.map((d) => Math.abs(d - med))), 0.5)
  return {
    bins: s.length,
    meanM: round(s.reduce((t, d) => t + d, 0) / s.length),
    medianM: round(med),
    robustSpreadM: round(mad * 1.4826),
    rmseM: round(Math.sqrt(s.reduce((t, d) => t + d * d, 0) / s.length)),
    p05M: round(quantile(s, 0.05)),
    p95M: round(quantile(s, 0.95)),
  }
}

/**
 * Bins reference points on a `binM` grid per group and compares each bin's median with the
 * terrain at the bin's mean position. `slopeAt` gives the local slope used to stratify the result.
 */
export function groundCheck(
  points: readonly GroundPoint[],
  terrainAt: (lon: number, lat: number) => number,
  options: { binM?: number; minPoints?: number; slopeAt?: (lon: number, lat: number) => number } = {},
): GroundCheckBin[] {
  const binM = options.binM ?? 20,
    minPoints = options.minPoints ?? 3
  const bins = new Map<string, { lon: number; lat: number; h: number[]; group: string }>()
  // One east–west scale for the whole set: scaled by each point's own latitude, a column edge at 121° W
  // moves some 300 m over 200 m of track and cuts a pass into slivers.
  const refLat = points.length ? points.reduce((t, p) => t + p.lat, 0) / points.length : 0
  const metresPerDegreeLon = 111_320 * Math.cos((refLat * Math.PI) / 180)
  for (const p of points) {
    const kx = Math.floor((p.lon * metresPerDegreeLon) / binM)
    const ky = Math.floor((p.lat * 110_574) / binM)
    const key = `${p.group}|${kx}|${ky}`
    let b = bins.get(key)
    if (!b) bins.set(key, (b = { lon: 0, lat: 0, h: [], group: p.group }))
    b.lon += p.lon
    b.lat += p.lat
    b.h.push(p.h)
  }
  const out: GroundCheckBin[] = []
  for (const b of bins.values()) {
    if (b.h.length < minPoints) continue
    const lon = b.lon / b.h.length,
      lat = b.lat / b.h.length
    const terrain = terrainAt(lon, lat)
    if (!Number.isFinite(terrain)) continue
    const reference = quantile(sorted(b.h), 0.5)
    const slope = options.slopeAt?.(lon, lat)
    out.push({
      lon,
      lat,
      group: b.group,
      reference: round(reference),
      terrain: round(terrain),
      difference: round(terrain - reference),
      points: b.h.length,
      slopePercent: slope === undefined || !Number.isFinite(slope) ? null : round(slope, 1),
    })
  }
  return out
}

/** Statistics of terrain − reference, overall and by slope class. */
export function groundCheckSummary(bins: readonly GroundCheckBin[], slopeBreaks = [10, 30, 50]) {
  const classes = [0, ...slopeBreaks].map((lo, i) => ({
    label: i < slopeBreaks.length ? `${lo}–${slopeBreaks[i]} %` : `${lo} % +`,
    lo,
    hi: i < slopeBreaks.length ? slopeBreaks[i] : Infinity,
  }))
  return {
    all: differenceStats(bins.map((b) => b.difference)),
    bySlope: classes.map((c) => ({
      slope: c.label,
      stats: differenceStats(
        bins
          .filter((b) => b.slopePercent !== null && b.slopePercent >= c.lo && b.slopePercent < c.hi)
          .map((b) => b.difference),
      ),
    })),
    byGroup: [...new Set(bins.map((b) => b.group))].sort().map((group) => ({
      group,
      stats: differenceStats(bins.filter((b) => b.group === group).map((b) => b.difference)),
    })),
  }
}
