/**
 * The state of a found road from airborne LiDAR: four sub-scores (vegetation over the bed, drivable
 * width, path conductivity, shoulders found), their mean as a score from 0 to 100, and a class from
 * 1 (best) to 4 (looks abandoned). Also the length-weighted harmonic mean of the conductivity along
 * a path, the line's sinuosity, the settings a road search can be given, and how far a corrected
 * line moved from its record.
 *
 * The score is the state score of Roussel, Bourdon, Morley, Coops & Achim (2022), "Correction,
 * update, and enhancement of vectorial forestry road maps using ALS data, a pathfinder, and seven
 * metrics", IJAEOG 114, 103020 (doi:10.1016/j.jag.2022.103020), with the thresholds of the ALSroads
 * user guide (Morley 2022). Written from a functional specification of ALSroads 0.2.0 and the paper;
 * no code from ALSroads (GPL-3) was used.
 *
 * A state class is evidence about the bed seen from the air on the acquisition date, never a road
 * condition: it is recorded as a dated LiDAR observation (`roadCondition.ts`) and only counts once a
 * person reviews it. Pure: no DOM or network access.
 */
import { cumulativeLength, nearestOnLine, pointAlong, spreadOf, type XY } from './roadGrid'

export type RoadStateClass = 1 | 2 | 3 | 4

/** A threshold pair: the sub-score runs linearly between them. */
export type ThresholdPair = [number, number]

export interface RoadStateThresholds {
  /** Vegetation over the bed, %: sub-score 1 at or below the first, 0 at or above the second. */
  vegetationPercent: ThresholdPair
  /** Drivable width, m: 0 at or below the first, 1 at or above the second. */
  drivableWidthM: ThresholdPair
  /** Path conductivity (harmonic mean): 0 at or below the first, 1 at or above the second. */
  conductivity: ThresholdPair
  /** Shoulders found, % of the two possible per section: 0 at or below the first, 1 at or above the second. */
  shoulderPercent: ThresholdPair
}

export const DEFAULT_ROAD_STATE_THRESHOLDS: RoadStateThresholds = {
  vegetationPercent: [10, 40],
  drivableWidthM: [1, 5],
  conductivity: [0.25, 0.5],
  shoulderPercent: [50, 75],
}

/** Class from the score: 1 at 75 or more, 2 at 50, 3 at 25, 4 below. */
export const ROAD_STATE_CLASS_FLOORS = [75, 50, 25] as const

export interface RoadStateInput {
  vegetationPercent: number
  drivableWidthM: number
  conductivity: number
  shoulderPercent: number
}

export interface RoadState {
  score: number
  stateClass: RoadStateClass
  subScores: { vegetation: number; drivableWidth: number; conductivity: number; shoulders: number }
  input: RoadStateInput
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const round = (v: number, digits: number) => {
  const f = 10 ** digits
  return Math.round(v * f + (v >= 0 ? 1e-9 : -1e-9)) / f
}
/** 1 at or below `a`, 0 at or above `b`, linear between. */
export const falling = (x: number, [a, b]: readonly [number, number]) => clamp01((b - x) / (b - a))
/** 0 at or below `a`, 1 at or above `b`, linear between. */
export const rising = (x: number, pair: readonly [number, number]) => 1 - falling(x, pair)

export function roadStateClass(score: number): RoadStateClass {
  if (score >= ROAD_STATE_CLASS_FLOORS[0]) return 1
  if (score >= ROAD_STATE_CLASS_FLOORS[1]) return 2
  if (score >= ROAD_STATE_CLASS_FLOORS[2]) return 3
  return 4
}

/** Each sub-score to three decimals, the score to one, as the reference implementation reports them. */
export function roadState(
  input: RoadStateInput,
  thresholds: RoadStateThresholds = DEFAULT_ROAD_STATE_THRESHOLDS,
): RoadState {
  const subScores = {
    vegetation: round(falling(input.vegetationPercent, thresholds.vegetationPercent), 3),
    drivableWidth: round(rising(input.drivableWidthM, thresholds.drivableWidthM), 3),
    conductivity: round(rising(input.conductivity, thresholds.conductivity), 3),
    shoulders: round(rising(input.shoulderPercent, thresholds.shoulderPercent), 3),
  }
  const mean = (subScores.vegetation + subScores.drivableWidth + subScores.conductivity + subScores.shoulders) / 4
  const score = round(100 * mean, 1)
  return { score, stateClass: roadStateClass(score), subScores, input }
}

export const ROAD_STATE_CLASS_LABELS: Record<RoadStateClass, string> = {
  1: 'Class 1 · open, wide bed',
  2: 'Class 2 · usable bed',
  3: 'Class 3 · narrowed or brushing in',
  4: 'Class 4 · looks abandoned or overgrown',
}

/**
 * Length-weighted harmonic mean of a conductivity sampled along a path: the path's length over the
 * sum of length ÷ conductivity. This is what the 0.25/0.5 thresholds were set on; the arithmetic
 * mean reads a road that alternates good and poor ground too high. Samples that are not finite or
 * not positive are left out. Null with no usable sample. Rounded to 0.01, as reported.
 */
export function harmonicConductivity(samples: ReadonlyArray<{ lengthM: number; value: number }>): number | null {
  let length = 0,
    cost = 0
  for (const { lengthM, value } of samples) {
    if (!(lengthM > 0) || !(value > 0) || !Number.isFinite(value)) continue
    length += lengthM
    cost += lengthM / value
  }
  return cost > 0 ? round(length / cost, 2) : null
}

/** Line length over the straight distance between its ends; null when the ends meet. */
export function sinuosity(line: readonly XY[]): number | null {
  if (line.length < 2) return null
  const length = cumulativeLength(line).at(-1) ?? 0
  const a = line[0],
    b = line.at(-1)!
  const chord = Math.hypot(b[0] - a[0], b[1] - a[1])
  return chord > 1e-6 ? length / chord : null
}

/**
 * How far a corrected line sits from its record: the distance from points every `stepM` along the
 * record to the nearest point of the corrected line (P50, P90, max), and the larger of the two end
 * gaps. Pairs by nearest point, not by fraction along each line: a corrected line that is merely
 * longer than its record overlaps it and reads 0, not as an offset growing along it.
 */
export function lineDifference(
  record: readonly XY[],
  corrected: readonly XY[],
  stepM = 5,
): { p50: number; p90: number; max: number; endMaxM: number } | null {
  if (record.length < 2 || corrected.length < 2) return null
  const cum = cumulativeLength(record),
    other = cumulativeLength(corrected)
  const total = cum.at(-1) ?? 0
  const distances: number[] = []
  const n = Math.max(1, Math.ceil(total / stepM))
  for (let i = 0; i <= n; i++)
    distances.push(nearestOnLine(corrected, other, pointAlong(record, cum, (total * i) / n).at).distance)
  const spread = spreadOf(distances)
  if (!spread) return null
  const gap = (p: XY, q: XY) => Math.hypot(p[0] - q[0], p[1] - q[1])
  const endMaxM = Math.max(gap(record[0], corrected[0]), gap(record.at(-1)!, corrected.at(-1)!))
  return { ...spread, endMaxM }
}

// --- settings ---------------------------------------------------------------------------------------

/** What a person may change for one search. Everything else stays a constant of the method. */
export interface RoadFindSettings {
  /** Search half-width either side of the line, m. */
  corridorM: number
  /** Pull towards the line: the score falls to 1 − this at the corridor edge. */
  confidence: number
  /** A side with no batter ends where the ground departs this far from the bed, m. */
  flatToleranceM: number
  /** With a point cloud, a side also ends where the ground returns spread more than this, m. */
  maxGroundSdM: number
  /** With a point cloud, the drivable bed ends where returns 0.5–5 m up exceed this share. */
  maxBrushShare: number
  state: RoadStateThresholds
}

export const DEFAULT_ROAD_FIND_SETTINGS: RoadFindSettings = {
  corridorM: 40,
  confidence: 0.1,
  flatToleranceM: 0.15,
  maxGroundSdM: 0.1,
  maxBrushShare: 0.15,
  state: DEFAULT_ROAD_STATE_THRESHOLDS,
}

/** Allowed range of every setting; a value outside it is refused, never clamped silently. */
export const ROAD_FIND_SETTING_LIMITS = {
  corridorM: [10, 80],
  confidence: [0, 0.9],
  flatToleranceM: [0.05, 0.3],
  maxGroundSdM: [0.02, 0.3],
  maxBrushShare: [0.05, 0.5],
  vegetationPercent: [0, 100],
  drivableWidthM: [0, 10],
  conductivity: [0.1, 1],
  shoulderPercent: [0, 100],
} as const

/** Settings from a saved or typed value; throws naming the first field out of range. */
export function parseRoadFindSettings(raw: unknown): RoadFindSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Road search settings must be an object.')
  const r = raw as Record<string, unknown>
  const number = (value: unknown, key: keyof typeof ROAD_FIND_SETTING_LIMITS, label: string) => {
    const [min, max] = ROAD_FIND_SETTING_LIMITS[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
      throw Error(`${label} must be from ${min} to ${max}.`)
    return value
  }
  const pair = (value: unknown, key: keyof RoadStateThresholds, label: string): ThresholdPair => {
    if (!Array.isArray(value) || value.length !== 2) throw Error(`${label} needs two thresholds.`)
    const a = number(value[0], key, label),
      b = number(value[1], key, label)
    if (!(a < b)) throw Error(`${label}: the first threshold must be below the second.`)
    return [a, b]
  }
  const state = (r.state ?? {}) as Record<string, unknown>
  if (typeof state !== 'object' || Array.isArray(state)) throw Error('Road state thresholds must be an object.')
  const d = DEFAULT_ROAD_FIND_SETTINGS
  return {
    corridorM: number(r.corridorM ?? d.corridorM, 'corridorM', 'Search corridor'),
    confidence: number(r.confidence ?? d.confidence, 'confidence', 'Pull to the record'),
    flatToleranceM: number(r.flatToleranceM ?? d.flatToleranceM, 'flatToleranceM', 'Level-edge tolerance'),
    maxGroundSdM: number(r.maxGroundSdM ?? d.maxGroundSdM, 'maxGroundSdM', 'Ground-spread tolerance'),
    maxBrushShare: number(r.maxBrushShare ?? d.maxBrushShare, 'maxBrushShare', 'Drivable vegetation share'),
    state: {
      vegetationPercent: pair(
        state.vegetationPercent ?? d.state.vegetationPercent,
        'vegetationPercent',
        'Vegetation over the bed',
      ),
      drivableWidthM: pair(state.drivableWidthM ?? d.state.drivableWidthM, 'drivableWidthM', 'Drivable width'),
      conductivity: pair(state.conductivity ?? d.state.conductivity, 'conductivity', 'Path conductivity'),
      shoulderPercent: pair(state.shoulderPercent ?? d.state.shoulderPercent, 'shoulderPercent', 'Shoulders found'),
    },
  }
}

/** The settings that differ from the defaults, for a short summary line. */
export function changedRoadFindSettings(settings: RoadFindSettings): string[] {
  const d = DEFAULT_ROAD_FIND_SETTINGS
  const out: string[] = []
  if (settings.corridorM !== d.corridorM) out.push(`corridor ${settings.corridorM} m`)
  if (settings.confidence !== d.confidence) out.push(`pull ${settings.confidence}`)
  if (settings.flatToleranceM !== d.flatToleranceM) out.push(`level edge ${settings.flatToleranceM} m`)
  if (settings.maxGroundSdM !== d.maxGroundSdM) out.push(`ground spread ${settings.maxGroundSdM} m`)
  if (settings.maxBrushShare !== d.maxBrushShare) out.push(`drivable ${Math.round(settings.maxBrushShare * 100)} %`)
  for (const key of Object.keys(d.state) as (keyof RoadStateThresholds)[])
    if (settings.state[key].join() !== d.state[key].join()) out.push(`${key} ${settings.state[key].join('–')}`)
  return out
}
