/**
 * The job's design standards: what this road is designed to, entered once per project. Pure, with no
 * DOM or network access, so the grade rule can be checked outside a browser.
 *
 * Two limits stay where every search and screen already reads them: the sustained grade limit is
 * `settings.maxGradePercent` and the minimum curve radius is `settings.minRadius`. This record adds
 * what those two numbers cannot say (an adverse limit, a short-pitch allowance, the design vehicle,
 * speed and widths) and whether a person has confirmed the set.
 */
import { isCalendarDate } from './projectIssue'
import type { Alignment, RoadSettings, RoadStation } from './types'

export interface DesignStandards {
  /**
   * Sustained limit for loaded trucks climbing. Null judges both directions on the road-wide limit.
   * It only applies once `loadedDirection` says which way loaded trucks travel.
   */
  adverseGradePercent: number | null
  /** Which way loaded trucks travel along a road's stationing. Null is either way. */
  loadedDirection: 'start-to-end' | 'end-to-start' | null
  /** A pitch may exceed the sustained limit up to this grade, for at most `shortPitchMaxLengthM`. */
  shortPitchGradePercent: number | null
  shortPitchMaxLengthM: number | null
  /** A `VEHICLE_PRESETS` id, or the name of a vehicle entered by hand in the swept-path check. */
  designVehicle: string | null
  designSpeedKmh: number | null
  /** Width of the running surface, both sides together. */
  runningSurfaceWidthM: number | null
  /** Widest clearing the job allows, catch line to catch line plus any preparation margin. */
  maxClearingWidthM: number | null
  /** Longest run of road the job allows between drainage structures. */
  maxCrossDrainSpacingM: number | null
  /** Where the limits come from: a road class, a permit condition, a company standard. */
  source?: string
  /** Date a person confirmed the record (YYYY-MM-DD). Absent while the limits are the starting values. */
  confirmedOn?: string
}

/** Starting values for a new project. They are placeholders until a person confirms them. */
export const DEFAULT_DESIGN_STANDARDS: DesignStandards = {
  adverseGradePercent: null,
  loadedDirection: null,
  shortPitchGradePercent: null,
  shortPitchMaxLengthM: null,
  designVehicle: null,
  designSpeedKmh: null,
  runningSurfaceWidthM: null,
  maxClearingWidthM: null,
  maxCrossDrainSpacingM: null,
}

export const STANDARD_LIMITS = {
  gradePercent: [0.1, 100] as const,
  shortPitchLengthM: [1, 2000] as const,
  designSpeedKmh: [5, 120] as const,
  runningSurfaceWidthM: [2, 30] as const,
  clearingWidthM: [3, 200] as const,
  crossDrainSpacingM: [5, 5000] as const,
}

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Design standards must be an object.')
  return value as Record<string, unknown>
}
const optional = (value: unknown, label: string, [min, max]: readonly [number, number]) => {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw Error(`${label} must be between ${min} and ${max}.`)
  return value
}
const shortText = (value: unknown, label: string, max: number) => {
  if (typeof value !== 'string' || value.length > max)
    throw Error(`${label} must be text of at most ${max} characters.`)
  return value
}

/** Reads a saved record. Anything unusable is refused rather than read as a limit. */
export function parseDesignStandards(raw: unknown): DesignStandards {
  const r = object(raw)
  if (
    r.loadedDirection !== null &&
    r.loadedDirection !== undefined &&
    r.loadedDirection !== 'start-to-end' &&
    r.loadedDirection !== 'end-to-start'
  )
    throw Error('Loaded haul direction must be start-to-end, end-to-start or unset.')
  const shortPitchGradePercent = optional(
      r.shortPitchGradePercent,
      'Short-pitch grade limit',
      STANDARD_LIMITS.gradePercent,
    ),
    shortPitchMaxLengthM = optional(r.shortPitchMaxLengthM, 'Short-pitch length', STANDARD_LIMITS.shortPitchLengthM)
  if ((shortPitchGradePercent === null) !== (shortPitchMaxLengthM === null))
    throw Error('A short-pitch allowance needs both its grade limit and its longest pitch length.')
  if (r.confirmedOn !== undefined && !isCalendarDate(String(r.confirmedOn)))
    throw Error('The design standards confirmation date must be a real date, written YYYY-MM-DD.')
  return {
    adverseGradePercent: optional(r.adverseGradePercent, 'Adverse grade limit', STANDARD_LIMITS.gradePercent),
    loadedDirection: (r.loadedDirection as DesignStandards['loadedDirection']) ?? null,
    shortPitchGradePercent,
    shortPitchMaxLengthM,
    designVehicle:
      r.designVehicle === null || r.designVehicle === undefined
        ? null
        : shortText(r.designVehicle, 'Design vehicle', 200),
    designSpeedKmh: optional(r.designSpeedKmh, 'Design speed', STANDARD_LIMITS.designSpeedKmh),
    runningSurfaceWidthM: optional(
      r.runningSurfaceWidthM,
      'Running-surface width',
      STANDARD_LIMITS.runningSurfaceWidthM,
    ),
    maxClearingWidthM: optional(r.maxClearingWidthM, 'Clearing width', STANDARD_LIMITS.clearingWidthM),
    maxCrossDrainSpacingM: optional(r.maxCrossDrainSpacingM, 'Cross-drain spacing', STANDARD_LIMITS.crossDrainSpacingM),
    ...(r.source === undefined || r.source === '' ? {} : { source: shortText(r.source, 'Standards source', 500) }),
    ...(r.confirmedOn === undefined ? {} : { confirmedOn: String(r.confirmedOn) }),
  }
}

/** The grade limits one road is judged on, resolved from the road-wide limit and the standards. */
export interface GradeRule {
  /** Loaded downhill, and both directions when no adverse limit applies. */
  favourablePercent: number
  /** Loaded uphill. Equals the favourable limit when no adverse limit applies. */
  adversePercent: number
  loadedDirection: DesignStandards['loadedDirection']
  /**
   * The allowance, kept when it is above at least one sustained limit. It relaxes a side only where
   * it is above that side's limit (`pitchAllowance`): 12 % between an 8 % adverse and an 18 %
   * favourable limit is for loaded-uphill pitches only.
   */
  shortPitch: { gradePercent: number; maxLengthM: number } | null
}

export function gradeRule(settings: Pick<RoadSettings, 'maxGradePercent'>, standards?: DesignStandards): GradeRule {
  const favourablePercent = settings.maxGradePercent
  const directional = !!standards?.loadedDirection && standards.adverseGradePercent !== null
  const pitch =
    standards && standards.shortPitchGradePercent !== null && standards.shortPitchMaxLengthM !== null
      ? { gradePercent: standards.shortPitchGradePercent, maxLengthM: standards.shortPitchMaxLengthM }
      : null
  // An adverse limit can only tighten the road-wide one, as the route search's directional limits do.
  const adversePercent = directional ? Math.min(favourablePercent, standards!.adverseGradePercent!) : favourablePercent
  return {
    favourablePercent,
    adversePercent,
    loadedDirection: directional ? standards!.loadedDirection : null,
    // An allowance at or below every sustained limit allows nothing.
    shortPitch: pitch && pitch.gradePercent > adversePercent ? pitch : null,
  }
}

/** The allowance as it applies to a run held to `limitPercent`: null where it is not above that limit. */
const pitchAllowance = (rule: GradeRule, limitPercent: number) =>
  rule.shortPitch && rule.shortPitch.gradePercent > limitPercent + EPS ? rule.shortPitch : null

/**
 * Which stretch of road a station's grade describes, which is what makes a pitch's length exact.
 * `ahead`: a designed profile, where a station on a grade break carries the grade leaving it and
 * the last station repeats the grade behind. `behind`: a ground-following road, where a station
 * carries the grade of the interval it closes and station 0 repeats the first interval.
 */
export type GradeSpan = 'ahead' | 'behind'
export const gradeSpanOf = (alignment: Pick<Alignment, 'vertical'>): GradeSpan =>
  alignment.vertical.length ? 'ahead' : 'behind'

type GradeSide = 'adverse' | 'favourable' | 'either'

/** Which limit a signed grade is held to. Positive grades climb up-station. */
export function gradeSide(rule: GradeRule, signedGradePercent: number): GradeSide {
  if (!rule.loadedDirection || rule.adversePercent === rule.favourablePercent) return 'either'
  const loadedClimbs = rule.loadedDirection === 'start-to-end' ? signedGradePercent > 0 : signedGradePercent < 0
  return loadedClimbs ? 'adverse' : 'favourable'
}
export const sustainedLimit = (rule: GradeRule, signedGradePercent: number) =>
  gradeSide(rule, signedGradePercent) === 'adverse' ? rule.adversePercent : rule.favourablePercent

export type GradeVerdict = 'short-pitch' | 'over-limit' | 'pitch-too-steep' | 'pitch-too-long'

/** One unbroken stretch of road steeper than its sustained limit. */
export interface GradeRun {
  start: number
  end: number
  /**
   * The sum of the intervals the run's stations describe (`GradeSpan`): one over-limit station at
   * 10 m spacing is a 10 m pitch, and a 50 m pitch measures 50 m wherever it lies on the road.
   */
  lengthM: number
  /** Signed grade of the largest magnitude in the run. */
  worstPercent: number
  worstChainage: number
  limitPercent: number
  side: GradeSide
  /** `short-pitch` is allowed by the allowance; the others are breaches somewhere along the run. */
  verdict: GradeVerdict
  stationIndexes: number[]
}

export interface GradeReview {
  rule: GradeRule
  runs: GradeRun[]
  /** Runs that break the standard. */
  breaches: GradeRun[]
  /** Runs the short-pitch allowance permits. */
  pitches: GradeRun[]
  breachStationCount: number
  breachLengthM: number
  steepest: { percent: number; chainage: number } | null
  /** Station index to the flag that station carries. Stations in a permitted pitch carry none. */
  flags: Map<number, string>
}

const EPS = 1e-6
const trim = (value: number) => String(Math.round(value * 100) / 100)

/** Text of the limit a road is judged on, for a row, a warning or a report. */
export function gradeRuleText(rule: GradeRule): string {
  const sustained =
    rule.adversePercent === rule.favourablePercent
      ? `${trim(rule.favourablePercent)}%`
      : `${trim(rule.favourablePercent)}% favourable, ${trim(rule.adversePercent)}% adverse`
  if (!rule.shortPitch) return sustained
  // Between the two limits the allowance relaxes the adverse one only, and the text says so.
  const side = rule.shortPitch.gradePercent > rule.favourablePercent + EPS ? '' : 'adverse '
  return `${sustained}; ${trim(rule.shortPitch.gradePercent)}% for ${side}pitches up to ${trim(rule.shortPitch.maxLengthM)} m`
}

const GRADE_FLAG = /^(Grade exceeds |Pitch over )/
/** True for a station flag raised by the grade standard. */
export const isGradeBreachFlag = (flag: string) => GRADE_FLAG.test(flag)

/** The flag one over-limit station carries, or null inside a permitted pitch. */
function stationFlag(run: GradeRun, gradePercent: number, rule: GradeRule): string | null {
  const pitch = pitchAllowance(rule, run.limitPercent)
  if (!pitch) {
    // The plain road-wide limit keeps the wording it has always had.
    return run.side === 'either'
      ? `Grade exceeds ${trim(run.limitPercent)}%`
      : `Grade exceeds the ${trim(run.limitPercent)}% ${run.side} limit`
  }
  if (Math.abs(gradePercent) > pitch.gradePercent + EPS)
    return `Grade exceeds the ${trim(pitch.gradePercent)}% short-pitch limit`
  return run.verdict === 'pitch-too-long'
    ? `Pitch over ${trim(run.limitPercent)}% runs ${run.lengthM.toFixed(0)} m; the allowance is ${trim(pitch.maxLengthM)} m`
    : null
}

/**
 * Judges station grades against the rule. A run is a set of consecutive stations over the sustained
 * limit for their direction. With a short-pitch allowance above that limit, a run no steeper than
 * the allowance and no longer than its length is permitted. A run that is too long is a breach
 * along its whole length; a run short enough but too steep is a breach only where it passes the
 * allowance's grade. `span` says which interval each station's grade describes (`gradeSpanOf`).
 */
export function reviewGrades(
  stations: readonly Pick<RoadStation, 'chainage' | 'gradePercent'>[],
  rule: GradeRule,
  span: GradeSpan,
): GradeReview {
  const runs: GradeRun[] = []
  let steepest: GradeReview['steepest'] = null
  let open: GradeRun | null = null
  const interval = (i: number) =>
    i >= 0 && i + 1 < stations.length ? stations[i + 1].chainage - stations[i].chainage : 0
  // The interval a station's grade describes. The station at the far end of the road repeats its
  // neighbour's interval and adds nothing, so a pitch is not half a station long or short there.
  const share = stations.map((_, i) => (span === 'ahead' ? interval(i) : interval(i - 1)))
  const close = () => {
    if (!open) return
    // That end station on its own still stands for some road: the one interval beside it.
    if (open.stationIndexes.length === 1 && share[open.stationIndexes[0]] <= EPS) {
      const only = open.stationIndexes[0]
      share[only] = span === 'ahead' ? interval(only - 1) : interval(only)
      open.lengthM = share[only]
    }
    const pitch = pitchAllowance(rule, open.limitPercent)
    const worst = Math.abs(open.worstPercent)
    open.verdict = !pitch
      ? 'over-limit'
      : open.lengthM > pitch.maxLengthM + EPS
        ? 'pitch-too-long'
        : worst > pitch.gradePercent + EPS
          ? 'pitch-too-steep'
          : 'short-pitch'
    runs.push(open)
    open = null
  }
  stations.forEach((station, i) => {
    const grade = station.gradePercent
    if (grade === null) return close()
    if (!steepest || Math.abs(grade) > Math.abs(steepest.percent))
      steepest = { percent: grade, chainage: station.chainage }
    const limit = sustainedLimit(rule, grade)
    if (Math.abs(grade) <= limit + EPS) return close()
    const side = gradeSide(rule, grade)
    // A crest or sag between two over-limit grades of opposite sign starts a new run.
    if (open && (open.side !== side || Math.sign(open.worstPercent) !== Math.sign(grade))) close()
    if (!open)
      open = {
        start: station.chainage,
        end: station.chainage,
        lengthM: 0,
        worstPercent: grade,
        worstChainage: station.chainage,
        limitPercent: limit,
        side,
        verdict: 'over-limit',
        stationIndexes: [],
      }
    open.end = station.chainage
    open.lengthM += share[i]
    open.stationIndexes.push(i)
    if (Math.abs(grade) > Math.abs(open.worstPercent)) {
      open.worstPercent = grade
      open.worstChainage = station.chainage
    }
  })
  close()
  const breaches = runs.filter((run) => run.verdict !== 'short-pitch')
  const flags = new Map<number, string>()
  let breachLengthM = 0
  for (const run of breaches)
    for (const index of run.stationIndexes) {
      const flag = stationFlag(run, stations[index].gradePercent!, rule)
      if (!flag) continue
      flags.set(index, flag)
      breachLengthM += share[index]
    }
  return {
    rule,
    runs,
    breaches,
    pitches: runs.filter((run) => run.verdict === 'short-pitch'),
    breachStationCount: flags.size,
    breachLengthM,
    steepest,
    flags,
  }
}
