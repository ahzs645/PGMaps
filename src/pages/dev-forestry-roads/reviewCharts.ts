/**
 * Data for the review charts: the share of road length in each grade class, the estimate spent so
 * far along the road, and cut and fill by stretch. Read from the analysis and the cost attribution
 * (`costAttribution.ts`), never re-priced. No DOM or network access.
 */
import { niceStep } from './chartScale'
import type { CostAttribution } from './costAttribution'
import type { RoadAnalysis } from './types'

export interface GradeBin {
  /** Grade magnitude range, %: [fromPct, toPct). */
  fromPct: number
  toPct: number
  favourableM: number
  adverseM: number
  lengthM: number
  share: number
}

/**
 * Road length by design grade, in `binPct` classes of its magnitude. Each interval between calculated
 * stations with both design levels counts at its own grade; climbing up-station is "adverse" only
 * in the sense of the stationing (the haul direction is the standards' to say).
 */
export function gradeDistribution(analysis: RoadAnalysis, binPct = 2) {
  const s = analysis.stations
  const intervals: { grade: number; length: number }[] = []
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1],
      b = s[i]
    const run = b.chainage - a.chainage
    if (run <= 1e-6 || a.designElevation == null || b.designElevation == null) continue
    intervals.push({ grade: (100 * (b.designElevation - a.designElevation)) / run, length: run })
  }
  const known = intervals.reduce((sum, i) => sum + i.length, 0)
  const top = Math.max(binPct, ...intervals.map((i) => Math.abs(i.grade)))
  const count = Math.min(40, Math.ceil(top / binPct + 1e-9))
  const bins: GradeBin[] = Array.from({ length: count }, (_, k) => ({
    fromPct: k * binPct,
    toPct: (k + 1) * binPct,
    favourableM: 0,
    adverseM: 0,
    lengthM: 0,
    share: 0,
  }))
  for (const i of intervals) {
    const bin = bins[Math.min(count - 1, Math.floor(Math.abs(i.grade) / binPct))]
    if (i.grade >= 0) bin.adverseM += i.length
    else bin.favourableM += i.length
    bin.lengthM += i.length
  }
  for (const bin of bins) bin.share = known > 0 ? bin.lengthM / known : 0
  return { bins, knownLengthM: known, unknownLengthM: Math.max(0, analysis.length - known) }
}

/** The estimate placed along the road, cumulative at each interval end, and what has no place. */
export function cumulativeCost(attribution: CostAttribution) {
  let running = 0
  const points: [chainage: number, cad: number][] = [[attribution.intervals[0]?.start ?? 0, 0]]
  attribution.intervals.forEach((interval, k) => {
    running += attribution.total[k] ?? 0
    points.push([interval.end, running])
  })
  return {
    points,
    placedTotal: attribution.placedTotal,
    unplacedTotal: attribution.unplacedTotal,
    totalAmount: attribution.totalAmount,
    incompleteM: attribution.intervals.filter((i) => !i.complete).reduce((sum, i) => sum + i.lengthM, 0),
  }
}

export interface EarthworkBin {
  start: number
  end: number
  cutM3: number
  fillM3: number
  unknownM: number
}

/** Cut and fill summed over stretches of a round length (about 20 bars along the road). */
export function earthworkBins(analysis: RoadAnalysis, target = 20): EarthworkBin[] {
  const s = analysis.stations
  if (s.length < 2 || analysis.length <= 0) return []
  const step = niceStep(analysis.length / target, 1)
  const bins: EarthworkBin[] = []
  for (let start = 0; start < analysis.length - 1e-6; start += step)
    bins.push({ start, end: Math.min(analysis.length, start + step), cutM3: 0, fillM3: 0, unknownM: 0 })
  for (let i = 1; i < s.length; i++) {
    const mid = (s[i - 1].chainage + s[i].chainage) / 2
    const bin = bins[Math.min(bins.length - 1, Math.max(0, Math.floor(mid / step)))]
    if (s[i].cutVolumeM3 === null || s[i].fillVolumeM3 === null) bin.unknownM += s[i].chainage - s[i - 1].chainage
    else {
      bin.cutM3 += s[i].cutVolumeM3!
      bin.fillM3 += s[i].fillVolumeM3!
    }
  }
  return bins
}
