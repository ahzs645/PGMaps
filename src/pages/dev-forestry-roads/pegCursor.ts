/**
 * Grade-held pegging on the plan. The cursor (or a typed aim) gives a direction; the next peg is
 * placed one step from the last at the target ground grade, on the heading nearest that direction
 * (`findGradePeg`). A straight leg goes to the cursor itself and ignores the grade. Legs are held
 * in a chain until the reader finishes it; nothing here edits a road. No DOM.
 */
import { distance, offsetCoordinate } from './engine'
import { findGradePeg, measurePeg, pegBearing, type PegMeasurement } from './pegging'
import type { Coordinate, TerrainSource } from './types'

/** Step between pegs. `findGradePeg` itself accepts 0.2–1,000 m. */
export const MIN_PEG_STEP_M = 1
export const MAX_PEG_STEP_M = 500
/** Target ground grade, either way. */
export const MAX_PEG_TARGET_GRADE = 30
/** Legs one chain may hold before it must be finished. */
export const MAX_PEG_TOOL_LEGS = 200
/** A straight leg no longer than this; `measurePeg` samples longer legs more coarsely. */
export const MAX_STRAIGHT_LEG_M = 2000
/** `findGradePeg` looks this far either side of the aimed direction, in 2° brackets. */
export const PEG_SEARCH_HALF_ANGLE = 90
const SCAN_STEP = 2
/** A second click this soon and this close to a committed one is part of a double-click. */
export const PEG_DOUBLE_CLICK_MS = 400
export const PEG_DOUBLE_CLICK_PX = 6
/** Turn per arrow key, and with Shift. */
export const PEG_AIM_STEP_DEG = 5
export const PEG_AIM_FINE_STEP_DEG = 1

/** The cursor label's widest (Tailwind `max-w-56`) and its gap from the point it labels. */
export const CURSOR_LABEL_MAX_WIDTH_PX = 224
export const CURSOR_LABEL_GAP_PX = 12

/**
 * Which side of its point a cursor label sits: right of it, unless a label that wide would run past
 * the plan's right edge and there is more room to the left.
 */
export function cursorLabelSide(
  pointX: number,
  viewWidth: number,
  labelWidthPx = CURSOR_LABEL_MAX_WIDTH_PX + CURSOR_LABEL_GAP_PX,
): 'right' | 'left' {
  if (!Number.isFinite(pointX) || !Number.isFinite(viewWidth)) return 'right'
  return pointX + labelWidthPx > viewWidth && pointX > viewWidth - pointX ? 'left' : 'right'
}

export const PEG_LEG_COLORS = {
  up: '#c2410c',
  down: '#2563eb',
  over: '#dc2626',
  unknown: '#6b7280',
} as const
export type PegLegClass = keyof typeof PEG_LEG_COLORS

export interface PegToolSettings {
  /** Size of the target grade, in percent. */
  gradePercent: number
  direction: 'up' | 'down'
  stepM: number
  /** Every leg goes straight to the cursor, as an Alt-click does. */
  straight: boolean
}
export const DEFAULT_PEG_TOOL: PegToolSettings = { gradePercent: 8, direction: 'up', stepM: 30, straight: false }

export const signedTargetGrade = (settings: PegToolSettings) =>
  settings.direction === 'down' ? -Math.abs(settings.gradePercent) : Math.abs(settings.gradePercent)

/** Why this target grade cannot be held, or null. The field keeps the typed value and shows this. */
export const pegGradeError = (gradePercent: number): string | null =>
  !Number.isFinite(gradePercent) || gradePercent < 0 || gradePercent > MAX_PEG_TARGET_GRADE
    ? `Enter a target grade of 0–${MAX_PEG_TARGET_GRADE} %.`
    : null
/** Why this step cannot be pegged, or null. The field keeps the typed value and shows this. */
export const pegStepError = (stepM: number): string | null =>
  !Number.isFinite(stepM) || stepM < MIN_PEG_STEP_M || stepM > MAX_PEG_STEP_M
    ? `Enter a step of ${MIN_PEG_STEP_M}–${MAX_PEG_STEP_M} m.`
    : null

/** Why these settings cannot peg, or null when they can. */
export function pegToolSettingsError(settings: PegToolSettings): string | null {
  return pegGradeError(settings.gradePercent) ?? pegStepError(settings.stepM)
}

/** Up, down, over the limit either way, or unknown where the ground is missing at an end. */
export function pegLegClass(gradePercent: number | null, limitPercent: number): PegLegClass {
  if (gradePercent === null || !Number.isFinite(gradePercent)) return 'unknown'
  if (Math.abs(gradePercent) > limitPercent) return 'over'
  return gradePercent < 0 ? 'down' : 'up'
}

export interface PegLeg {
  start: Coordinate
  end: Coordinate
  measurement: PegMeasurement
  /** Placed straight to a point, not held to the grade. */
  straight: boolean
}

export type PegCursorFailure =
  | 'invalid'
  | 'no-direction'
  | 'origin-off-terrain'
  | 'no-ground'
  | 'gap'
  | 'unreachable'
  | 'too-long'

export type PegCursorResult =
  | {
      ok: true
      leg: PegLeg
      legClass: PegLegClass
      /** How far the leg swung from the aimed direction to hold the grade, degrees (+ clockwise). */
      swingDeg: number
    }
  | { ok: false; reason: PegCursorFailure; message: string }

const fixed = (value: number, decimals = 1) => value.toFixed(decimals)
const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${fixed(Math.abs(value))}`
/**
 * A ground grade beside the target it failed to reach, with decimals enough not to read as the
 * target: −2.96 against −3 prints "−2.96", not "−3.0".
 */
export function signedApart(value: number, target: number): string {
  // No sign on a value that prints as zero: "0.0", not "−0.0".
  const text = (n: number, decimals: number) => {
    const size = fixed(Math.abs(n), decimals)
    return Number(size) === 0 ? size : `${n > 0 ? '+' : '−'}${size}`
  }
  let shown = text(value, 1)
  for (let decimals = 2; decimals <= 3 && shown === text(target, decimals - 1); decimals++)
    shown = text(value, decimals)
  return shown
}
const finite = (value: number) => (Number.isFinite(value) ? value : null)
const turn = (from: number, to: number) => ((to - from + 540) % 360) - 180

/**
 * The next leg from `origin` toward `cursor`. Grade legs are `settings.stepM` long and end on ground
 * at the target grade; a straight leg ends at the cursor. Where no leg can be placed the result says
 * why, in words fit to show at the cursor, and holds no coordinate.
 */
export function solvePegCursor(
  origin: Coordinate,
  cursor: Coordinate,
  settings: PegToolSettings,
  terrain: TerrainSource,
  limitPercent: number,
  options: { straight?: boolean } = {},
): PegCursorResult {
  const straight = options.straight ?? settings.straight
  const reach = distance(origin, cursor)
  if (straight) {
    if (!(reach >= 0.2)) return { ok: false, reason: 'no-direction', message: 'Move away from the last peg.' }
    if (reach > MAX_STRAIGHT_LEG_M)
      return {
        ok: false,
        reason: 'too-long',
        message: `A straight leg is at most ${MAX_STRAIGHT_LEG_M.toLocaleString('en-CA')} m. Add a peg on the way.`,
      }
    const measurement = measurePeg(origin, cursor, terrain)
    return {
      ok: true,
      leg: { start: origin, end: cursor, measurement, straight: true },
      legClass: pegLegClass(measurement.grade, limitPercent),
      swingDeg: 0,
    }
  }
  const settingsError = pegToolSettingsError(settings)
  if (settingsError) return { ok: false, reason: 'invalid', message: settingsError }
  if (!(reach >= 0.01)) return { ok: false, reason: 'no-direction', message: 'Point away from the last peg.' }
  const aimed = pegBearing(origin, cursor)
  const target = signedTargetGrade(settings)
  const step = settings.stepM
  const base = finite(terrain.elevationAt(...origin))
  if (base === null)
    return {
      ok: false,
      reason: 'origin-off-terrain',
      message: 'No ground under the last peg, so no grade can be held from it. Alt-click for a straight leg.',
    }
  const found = findGradePeg(origin, aimed, step, target, terrain)
  if (found)
    return {
      ok: true,
      leg: { start: origin, end: found.coordinate, measurement: found.measurement, straight: false },
      legClass: pegLegClass(found.measurement.grade, limitPercent),
      swingDeg: turn(aimed, found.measurement.bearing),
    }
  // Say why. The same headings `findGradePeg` brackets, read at their end points.
  const grades: (number | null)[] = []
  for (let offset = -PEG_SEARCH_HALF_ANGLE; offset <= PEG_SEARCH_HALF_ANGLE; offset += SCAN_STEP) {
    const ground = finite(terrain.elevationAt(...offsetCoordinate(origin, aimed + offset, step)))
    grades.push(ground === null ? null : (100 * (ground - base)) / step)
  }
  const known = grades.filter((grade): grade is number => grade !== null)
  const crosses = grades.some((grade, i) => {
    const next = grades[i + 1]
    return (
      grade !== null &&
      ((next !== null && next !== undefined && (grade - target) * (next - target) <= 0) || grade === target)
    )
  })
  const at = `${signed(target)} % at ${fixed(step, step < 10 ? 1 : 0)} m`
  if (crosses)
    return {
      ok: false,
      reason: 'gap',
      message: `Every leg at ${at} here crosses a gap in the terrain. Try another direction or step.`,
    }
  if (!known.length)
    return {
      ok: false,
      reason: 'no-ground',
      message: `No ground ${fixed(step, 0)} m out this way: off the terrain or a gap.`,
    }
  const range = `${signedApart(Math.min(...known), target)} to ${signedApart(Math.max(...known), target)} %`
  if (known.length < grades.length)
    return {
      ok: false,
      reason: 'no-ground',
      message: `No leg at ${at}: the ground runs ${range} where there is any, and part of this way has none.`,
    }
  return {
    ok: false,
    reason: 'unreachable',
    message: `No leg at ${at} within ${PEG_SEARCH_HALF_ANGLE}° of this way: the ground runs ${range}.`,
  }
}

/** The leg's label at the cursor: grade, direction and length, and the limit when it is over. */
export function pegLegLabel(result: Extract<PegCursorResult, { ok: true }>, limitPercent: number): string {
  const { grade, length } = result.leg.measurement
  const size = grade === null ? 'grade unknown' : `${signed(grade)} %`
  const over = result.legClass === 'over' ? ` · over ${fixed(limitPercent)} %` : ''
  return `${size} · ${fixed(length)} m${result.leg.straight ? ' · straight' : ''}${over}`
}

export interface PegChain {
  origin: Coordinate
  legs: PegLeg[]
}
export const pegChainEnd = (chain: PegChain): Coordinate => chain.legs.at(-1)?.end ?? chain.origin

/** The chain with one more leg, or unchanged when it is full or the leg does not start at its end. */
export function addPegLeg(chain: PegChain, leg: PegLeg): PegChain {
  if (chain.legs.length >= MAX_PEG_TOOL_LEGS) return chain
  if (distance(pegChainEnd(chain), leg.start) > 0.001) return chain
  return { ...chain, legs: [...chain.legs, leg] }
}
export const removeLastPegLeg = (chain: PegChain): PegChain =>
  chain.legs.length ? { ...chain, legs: chain.legs.slice(0, -1) } : chain

export function pegChainSummary(chain: PegChain) {
  const lengthM = chain.legs.reduce((sum, leg) => sum + leg.measurement.length, 0)
  const start = chain.legs.length ? chain.legs[0].measurement.startElevation : null
  const end = chain.legs.at(-1)?.measurement.endElevation ?? null
  return {
    legs: chain.legs.length,
    lengthM,
    /** Overall ground grade from the first peg to the last, or null where either end has no ground. */
    gradePercent: start !== null && end !== null && lengthM > 0 ? (100 * (end - start)) / lengthM : null,
  }
}

/** Whether a click is the second of a double-click that began with the previous committed click. */
export function isSecondClickOfDouble(
  previous: { time: number; x: number; y: number } | null,
  next: { time: number; x: number; y: number },
): boolean {
  return (
    !!previous &&
    next.time - previous.time >= 0 &&
    next.time - previous.time <= PEG_DOUBLE_CLICK_MS &&
    Math.hypot(next.x - previous.x, next.y - previous.y) <= PEG_DOUBLE_CLICK_PX
  )
}

/** The chain and the live leg, for the plan: committed legs solid, the preview dashed. */
export function pegChainFeatures(
  chain: PegChain,
  preview: PegCursorResult | null,
  limitPercent: number,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = chain.legs.map((leg, index) => ({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [leg.start, leg.end] },
    properties: {
      role: 'peg-leg',
      index,
      color: PEG_LEG_COLORS[pegLegClass(leg.measurement.grade, limitPercent)],
    },
  }))
  features.push(
    ...chain.legs.map(
      (leg, index): GeoJSON.Feature => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: leg.end },
        properties: { role: 'peg-point', index },
      }),
    ),
  )
  if (preview?.ok)
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [preview.leg.start, preview.leg.end] },
      properties: { role: 'peg-preview', color: PEG_LEG_COLORS[preview.legClass] },
    })
  return { type: 'FeatureCollection', features }
}
