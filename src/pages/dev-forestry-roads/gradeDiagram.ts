/**
 * The grade diagram: the road's grade plotted along its length, with the limits it is held to.
 * Pure, with no DOM access, so the chart (`GradeChart` in `Charts.tsx`) only draws it.
 *
 * Every value comes from the calculated stations, never interpolated between them. A design grade
 * is drawn as a step over the interval its station describes (`gradeSpanOf`), which is the interval
 * the grade standard measures a pitch on, so the red stretches here are the Review's grade row
 * station for station (`reviewGrades`). The ground grade is a chord between calculated stations at
 * least `GROUND_GRADE_CHORD_M` apart, so a short interval beside an event station does not read
 * micro-relief as a steep pitch; a chord over missing terrain is unknown, never zero.
 */
import { DEFAULT_GROUND_WINDOW_M } from './groundTrend'
import { gradeSide, gradeSpanOf, reviewGrades, sustainedLimit, type GradeRule } from './designStandards'
import type { Alignment, RoadStation } from './types'

const EPS = 1e-6
const finite = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/** The shortest chord a ground grade is read over: the route searches' ground-trend window. */
export const GROUND_GRADE_CHORD_M = DEFAULT_GROUND_WINDOW_M

/** One design grade held over the stretch of road its station describes. */
export interface GradeStep {
  start: number
  end: number
  gradePercent: number
  /** Index of the calculated station the grade belongs to. */
  station: number
}

/** A ground grade read over the chord `start`–`end`, plotted at its middle. */
export interface GroundGradePoint {
  start: number
  end: number
  chainage: number
  /** Null where either end, or a station between them, has no ground elevation. */
  gradePercent: number | null
}

/** A stretch of road over its sustained limit, as the grade standard judges it. */
export interface GradeBreachSpan {
  start: number
  end: number
  /** `breach` breaks the standard; `pitch` is permitted by the short-pitch allowance. */
  kind: 'breach' | 'pitch'
}

export interface GradeLimitLine {
  /** Signed: positive climbs up-station. */
  percent: number
  side: 'adverse' | 'favourable' | 'either'
}

export interface GradeDiagram {
  /** Empty without a designed profile: the road then follows the ground. */
  design: GradeStep[]
  ground: GroundGradePoint[]
  limits: { rising: GradeLimitLine; falling: GradeLimitLine }
  /** The short-pitch allowance, where it is above at least one sustained limit. */
  shortPitch: { percent: number; maxLengthM: number } | null
  spans: GradeBreachSpan[]
  steepest: { percent: number; chainage: number } | null
  breachLengthM: number
  /** True when the judged grade is the ground's because no profile is designed. */
  groundFollowing: boolean
}

/** The interval each station's grade describes, as `reviewGrades` measures it. */
function stationShares(stations: readonly Pick<RoadStation, 'chainage'>[], span: 'ahead' | 'behind') {
  return stations.map((station, i): [number, number] => {
    if (span === 'ahead') {
      const next = stations[i + 1]
      return next
        ? [station.chainage, next.chainage]
        : [stations[i - 1]?.chainage ?? station.chainage, station.chainage]
    }
    const previous = stations[i - 1]
    return previous
      ? [previous.chainage, station.chainage]
      : [station.chainage, stations[i + 1]?.chainage ?? station.chainage]
  })
}

/**
 * Ground grade over chords of at least `chordM`, each ending at a calculated station and starting
 * at the nearest station that far behind it. Stations closer than `chordM` to the start of the road
 * share the first full chord. A road shorter than the chord has one chord, end to end.
 */
export function groundGradeChords(
  stations: readonly Pick<RoadStation, 'chainage' | 'groundElevation'>[],
  chordM = GROUND_GRADE_CHORD_M,
): GroundGradePoint[] {
  if (stations.length < 2) return []
  const points: GroundGradePoint[] = []
  // `missingBefore[i]`: how many stations before index i have no ground, for a gap test in O(1).
  const missingBefore = [0]
  for (const station of stations) missingBefore.push(missingBefore.at(-1)! + (finite(station.groundElevation) ? 0 : 1))
  const chord = (from: number, to: number): GroundGradePoint => {
    const a = stations[from],
      b = stations[to]
    const complete = missingBefore[to + 1] - missingBefore[from] === 0
    return {
      start: a.chainage,
      end: b.chainage,
      chainage: (a.chainage + b.chainage) / 2,
      gradePercent: complete ? ((b.groundElevation! - a.groundElevation!) / (b.chainage - a.chainage)) * 100 : null,
    }
  }
  let from = 0
  for (let to = 1; to < stations.length; to++) {
    if (stations[to].chainage - stations[0].chainage < chordM - EPS) continue
    while (from + 1 < to && stations[to].chainage - stations[from + 1].chainage >= chordM - EPS) from++
    if (stations[to].chainage - stations[from].chainage > EPS) points.push(chord(from, to))
  }
  if (!points.length && stations.at(-1)!.chainage - stations[0].chainage > EPS)
    points.push(chord(0, stations.length - 1))
  return points
}

export function gradeDiagram(
  stations: readonly Pick<RoadStation, 'chainage' | 'gradePercent' | 'groundElevation'>[],
  alignment: Pick<Alignment, 'vertical'>,
  rule: GradeRule,
  options: { terrainOnly?: boolean } = {},
): GradeDiagram {
  const span = gradeSpanOf(alignment)
  const groundFollowing = span === 'behind'
  const shares = stationShares(stations, span)
  const judged = options.terrainOnly ? null : reviewGrades(stations, rule, span)
  const design = groundFollowing
    ? []
    : stations.flatMap((station, i): GradeStep[] => {
        const [start, end] = shares[i]
        // The last station repeats the grade behind it over an interval its neighbour already drew.
        if (!finite(station.gradePercent) || end - start <= EPS || i === stations.length - 1) return []
        return [{ start, end, gradePercent: station.gradePercent, station: i }]
      })
  const spans: GradeBreachSpan[] = []
  const addSpan = (index: number, kind: GradeBreachSpan['kind']) => {
    const [start, end] = shares[index]
    if (end - start <= EPS) return
    const previous = spans.at(-1)
    // On a ground-following road station 0 repeats the first interval, so intervals can coincide.
    if (previous && previous.kind === kind && start <= previous.end + EPS) previous.end = Math.max(previous.end, end)
    else spans.push({ start, end, kind })
  }
  if (judged) {
    const pitchStations = new Set(judged.pitches.flatMap((run) => run.stationIndexes))
    const flagged = [...judged.flags.keys(), ...pitchStations].sort((a, b) => a - b)
    for (const index of flagged) addSpan(index, judged.flags.has(index) ? 'breach' : 'pitch')
  }
  const limit = (sign: 1 | -1): GradeLimitLine => ({
    percent: sign * sustainedLimit(rule, sign),
    side: gradeSide(rule, sign),
  })
  return {
    design,
    ground: groundGradeChords(stations),
    limits: { rising: limit(1), falling: limit(-1) },
    shortPitch: rule.shortPitch
      ? { percent: rule.shortPitch.gradePercent, maxLengthM: rule.shortPitch.maxLengthM }
      : null,
    spans,
    steepest: judged?.steepest ?? null,
    breachLengthM: judged?.breachLengthM ?? 0,
    groundFollowing,
  }
}

/*
 * Rolling average. A display aid only: it never feeds the grade standard, the Review or any figure
 * the road is judged on, which stay on the station grades above.
 */

/** Which grade lines a rolling average is drawn for. */
export type GradeAverageSeries = 'ground' | 'design' | 'both'

export interface GradeAverageSettings {
  enabled: boolean
  /** Length of road each average is taken over, centred on the point it is drawn at. */
  windowM: number
  series: GradeAverageSeries
  /**
   * The least share of a window that must have a known grade for its average to be drawn. Below
   * it the average is unknown, so a gap in the terrain is never averaged into a smooth line.
   */
  minCoveragePercent: number
}

export const GRADE_AVERAGE_LIMITS = {
  /** Shorter than the ground chord would only redraw the chord line. */
  windowM: { min: GROUND_GRADE_CHORD_M, max: 1000 },
  minCoveragePercent: { min: 10, max: 100 },
} as const

export const DEFAULT_GRADE_AVERAGE: GradeAverageSettings = {
  enabled: false,
  windowM: 50,
  series: 'ground',
  minCoveragePercent: 50,
}

/** Window lengths offered as one-click choices; any length in the limits can be typed. */
export const GRADE_AVERAGE_PRESETS_M = [25, 50, 100, 200] as const

const clampTo = (value: number, { min, max }: { min: number; max: number }) => Math.min(max, Math.max(min, value))

/** Settings read back from storage, each field checked on its own; anything unreadable is the default. */
export function parseGradeAverage(raw: unknown): GradeAverageSettings {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const number = (field: unknown, fallback: number, limits: { min: number; max: number }) =>
    typeof field === 'number' && Number.isFinite(field) ? clampTo(field, limits) : fallback
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_GRADE_AVERAGE.enabled,
    windowM: number(value.windowM, DEFAULT_GRADE_AVERAGE.windowM, GRADE_AVERAGE_LIMITS.windowM),
    series:
      value.series === 'ground' || value.series === 'design' || value.series === 'both'
        ? value.series
        : DEFAULT_GRADE_AVERAGE.series,
    minCoveragePercent: number(
      value.minCoveragePercent,
      DEFAULT_GRADE_AVERAGE.minCoveragePercent,
      GRADE_AVERAGE_LIMITS.minCoveragePercent,
    ),
  }
}

/** A grade held over one stretch of road; null where it is unknown. */
export interface GradeInterval {
  start: number
  end: number
  gradePercent: number | null
}

/** The ground's grade between each pair of neighbouring calculated stations. */
export function groundGradeIntervals(
  stations: readonly Pick<RoadStation, 'chainage' | 'groundElevation'>[],
): GradeInterval[] {
  return stations.slice(1).flatMap((b, i): GradeInterval[] => {
    const a = stations[i]
    const length = b.chainage - a.chainage
    if (length <= EPS) return []
    return [
      {
        start: a.chainage,
        end: b.chainage,
        gradePercent:
          finite(a.groundElevation) && finite(b.groundElevation)
            ? ((b.groundElevation - a.groundElevation) / length) * 100
            : null,
      },
    ]
  })
}

export interface RollingGradePoint {
  chainage: number
  /** Null where less than the minimum share of the window has a known grade. */
  gradePercent: number | null
  /** The window actually averaged over: shorter than asked near the road's ends. */
  start: number
  end: number
}

/**
 * The length-weighted mean of `intervals` over a window of `windowM` centred on each interval's
 * middle. Each interval counts for the length of it inside the window, so over complete ground the
 * average is the rise across the window divided by its length. At the road's ends the window is cut
 * to the road rather than padded. Unknown intervals add neither grade nor length; a window whose
 * known length is under `minCoverage` (a share, 0–1) of its own length is unknown.
 */
export function rollingGrade(
  intervals: readonly GradeInterval[],
  windowM: number,
  minCoverage = DEFAULT_GRADE_AVERAGE.minCoveragePercent / 100,
): RollingGradePoint[] {
  const steps = intervals.filter((s) => s.end - s.start > EPS).sort((a, b) => a.start - b.start)
  if (!steps.length || !(windowM > 0)) return []
  // Running totals at each interval's end: grade × known length, and known length.
  const ends = steps.map((s) => s.end)
  const sum = [0],
    known = [0]
  for (const s of steps) {
    const length = s.end - s.start
    const ok = finite(s.gradePercent)
    sum.push(sum.at(-1)! + (ok ? s.gradePercent! * length : 0))
    known.push(known.at(-1)! + (ok ? length : 0))
  }
  const roadStart = steps[0].start,
    roadEnd = steps.at(-1)!.end
  // Totals from the road's start to `x`, taking the part of the interval `x` falls in.
  const upTo = (x: number): [number, number] => {
    let lo = 0,
      hi = ends.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (ends[mid] <= x) lo = mid + 1
      else hi = mid
    }
    if (lo >= steps.length) return [sum[lo], known[lo]]
    const s = steps[lo]
    const inside = Math.max(0, x - s.start)
    const ok = finite(s.gradePercent)
    return [sum[lo] + (ok ? s.gradePercent! * inside : 0), known[lo] + (ok ? inside : 0)]
  }
  return steps.map((s) => {
    const chainage = (s.start + s.end) / 2
    const start = Math.max(roadStart, chainage - windowM / 2),
      end = Math.min(roadEnd, chainage + windowM / 2)
    const [sumA, knownA] = upTo(start)
    const [sumB, knownB] = upTo(end)
    const knownLength = knownB - knownA
    const enough = end - start > EPS && knownLength >= minCoverage * (end - start) - EPS && knownLength > EPS
    return { chainage, start, end, gradePercent: enough ? (sumB - sumA) / knownLength : null }
  })
}

/** The steepest averaged grade either way, for the summary line. */
export function steepestAverage(points: readonly RollingGradePoint[]) {
  return points.reduce<{ percent: number; chainage: number } | null>(
    (best, p) =>
      p.gradePercent !== null && (!best || Math.abs(p.gradePercent) > Math.abs(best.percent))
        ? { percent: p.gradePercent, chainage: p.chainage }
        : best,
    null,
  )
}
