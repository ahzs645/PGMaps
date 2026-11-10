/**
 * Editing the vertical alignment by grade: a typed tangent grade, a PVI dragged while one grade is
 * held, a whole tangent raised or lowered, grades snapped to round values, and a PVI removed.
 * Pure: no DOM, network or terrain access. Every function takes the PVIs and returns new ones, or
 * says why it will not, in words a reviewer can act on.
 *
 * A PVI that sits on an elevation control (`CONTROL_HOLD_M`) and currently meets it is held by it:
 * drags keep it inside the control's tolerance band, and a typed grade that would move it is
 * refused. A PVI that already misses its control is not held, so a bad control never locks a road.
 */
import { formatStation } from './verticalStandards'
import { constrainPviDrag, MAX_DRAG_GRADE, MIN_PVI_GAP_M } from './verticalTools'
import type { VerticalControl, VerticalPoint } from './types'

/** Round grade a snapping drag lands on, percent. Toggled on the profile toolbar. */
export const GRADE_SNAP_STEP_PERCENT = 0.5
/** A tangent grip moves its tangent only once dragged this far; a shorter press opens its grade. */
export const MIN_TANGENT_DRAG_PX = 4
/** Tangent grips show only on tangents at least this long on screen. */
export const MIN_TANGENT_GRIP_PX = 36
/** A PVI within this distance of an elevation control's station is held by that control. */
export const CONTROL_HOLD_M = 0.5
/** Fewest PVIs a delete may leave: two make the shortest profile with a grade. */
export const MIN_PROFILE_PVIS = 2
/** Steepest grade a typed or snapped edit may set, percent: the drag cap in `verticalTools.ts`. */
export const MAX_EDIT_GRADE_PERCENT = MAX_DRAG_GRADE * 100
const ELEVATION_LIMIT_M = 12000
const EPS = 1e-6

/** Which end of a tangent stays put when its grade is typed. */
export type GradeHold = 'back' | 'ahead'

const pct = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(2)} %`
const label = (index: number) => `V${index + 1}`
/** Typed-grade elevations keep their exact value; this only removes floating-point noise. */
const clean = (value: number) => Math.round(value * 1e6) / 1e6

export const sortProfile = (points: readonly VerticalPoint[]) => [...points].sort((a, b) => a.chainage - b.chainage)

/** Grade from `a` to `b`, percent, positive uphill going up-station. */
export function tangentGrade(a: VerticalPoint, b: VerticalPoint) {
  return (100 * (b.elevation - a.elevation)) / (b.chainage - a.chainage)
}

/** The nearest multiple of `step`, with no negative zero. */
export function snapGrade(gradePercent: number, step = GRADE_SNAP_STEP_PERCENT) {
  if (!(step > 0) || !Number.isFinite(gradePercent)) return gradePercent
  return Math.round(gradePercent / step) * step + 0
}

/** The elevation control a PVI at `chainage` sits on, if any. */
export function controlAt(controls: readonly VerticalControl[] | undefined, chainage: number) {
  return (controls ?? []).find((c) => c.elevation !== null && Math.abs(c.chainage - chainage) <= CONTROL_HOLD_M)
}

/** The band a held PVI keeps to, or null when its control does not hold it. */
function holdingBand(controls: readonly VerticalControl[] | undefined, point: VerticalPoint) {
  const control = controlAt(controls, point.chainage)
  if (!control || control.elevation === null) return null
  const low = control.elevation - control.toleranceBelowM,
    high = control.elevation + control.toleranceAboveM
  // A PVI already off its control is not held: dragging is how it gets fixed.
  if (point.elevation < low - EPS || point.elevation > high + EPS) return null
  return { control, low, high }
}

const controlText = (control: VerticalControl) =>
  `Held by the control at ${formatStation(control.chainage)}: ${control.elevation!.toFixed(2)} m (+${control.toleranceAboveM.toFixed(2)}/−${control.toleranceBelowM.toFixed(2)})`

export type GradeEditResult = { points: VerticalPoint[]; movedId: string } | { error: string }

/**
 * Set the grade of the tangent that starts at PVI `backId`. `hold` names the end that stays; the
 * other PVI's elevation is recomputed, which also changes the grade on its far side.
 */
export function setTangentGrade(
  points: readonly VerticalPoint[],
  backId: string,
  gradePercent: number,
  hold: GradeHold,
  controls?: readonly VerticalControl[],
): GradeEditResult {
  const sorted = sortProfile(points)
  const i = sorted.findIndex((p) => p.id === backId)
  if (i < 0 || i + 1 >= sorted.length) return { error: 'No tangent starts at that PVI.' }
  if (!Number.isFinite(gradePercent)) return { error: 'Enter a grade in percent.' }
  if (Math.abs(gradePercent) > MAX_EDIT_GRADE_PERCENT + EPS)
    return { error: `A profile edit sets at most ±${MAX_EDIT_GRADE_PERCENT} %.` }
  const back = sorted[i],
    ahead = sorted[i + 1]
  const run = ahead.chainage - back.chainage
  if (!(run > 0)) return { error: `${label(i)} and ${label(i + 1)} share a station; move one first.` }
  const movedIndex = hold === 'back' ? i + 1 : i
  const moved = sorted[movedIndex]
  const elevation = clean(
    hold === 'back' ? back.elevation + (gradePercent * run) / 100 : ahead.elevation - (gradePercent * run) / 100,
  )
  if (Math.abs(elevation) > ELEVATION_LIMIT_M) return { error: `That puts ${label(movedIndex)} past ±12,000 m.` }
  const far = hold === 'back' ? sorted[i + 2] : sorted[i - 1]
  if (far) {
    const placed = { ...moved, elevation }
    const farGrade = hold === 'back' ? tangentGrade(placed, far) : tangentGrade(far, placed)
    if (Math.abs(farGrade) > MAX_EDIT_GRADE_PERCENT + EPS)
      return {
        error: `That makes the grade ${hold === 'back' ? 'out of' : 'into'} ${label(movedIndex)} ${pct(farGrade)}, past ±${MAX_EDIT_GRADE_PERCENT} %.`,
      }
  }
  const band = holdingBand(controls, moved)
  if (band && (elevation < band.low - EPS || elevation > band.high + EPS))
    return {
      error: `${label(movedIndex)} sits on the control at ${formatStation(band.control.chainage)} (${band.control.elevation!.toFixed(2)} m). Hold ${label(movedIndex)} instead, or change the control.`,
    }
  return {
    points: sorted.map((p) => (p.id === moved.id ? { ...p, elevation } : p)),
    movedId: moved.id,
  }
}

/** A grade the drag snapped to, and the tangent it is on. */
export interface SnappedGrade {
  /** `back` is the tangent into the PVI (or the tangent before a dragged tangent), `ahead` the one out. */
  side: GradeHold
  gradePercent: number
}

export interface DragOutcome {
  chainage: number
  elevation: number
  /** Why the handle is not under the cursor: said at the cursor. Empty when it follows freely. */
  held: string[]
  /** The tangent whose grade a Shift-drag holds. */
  holding?: GradeHold
  snapped?: SnappedGrade
}

export interface PviDragInput {
  sorted: readonly VerticalPoint[]
  index: number
  /** Cursor position on the chart. */
  chainage: number
  elevation: number
  roadLength: number
  /** Shift: slide along one adjacent tangent, holding its grade. */
  holdGrade?: boolean
  /** Snap a grade to this step, percent; null or absent for no snap. */
  snapStep?: number | null
  controls?: readonly VerticalControl[]
  /** A few pixels in chart units, so a reason is given only when the cursor is visibly elsewhere. */
  slack?: { chainageM: number; elevationM: number }
}

/** Where a dragged PVI lands, and why it is held where it is. */
export function dragPvi(input: PviDragInput): DragOutcome {
  const { sorted, index, chainage, elevation, roadLength, controls } = input
  const slack = input.slack ?? { chainageM: 0, elevationM: 0 }
  const step = input.snapStep && input.snapStep > 0 ? input.snapStep : null
  const origin = sorted[index]
  const previous = sorted[index - 1],
    next = sorted[index + 1]
  const isEnd = sorted.length > 1 && (!previous || !next)
  const held: string[] = []
  const band = holdingBand(controls, origin)
  if (band) {
    // The control holds the station; the level moves only inside its tolerance band.
    const level = Math.min(band.high, Math.max(band.low, input.holdGrade ? origin.elevation : elevation))
    if (Math.abs(chainage - origin.chainage) > slack.chainageM || Math.abs(level - elevation) > slack.elevationM)
      held.push(controlText(band.control))
    return { chainage: origin.chainage, elevation: level, held }
  }
  const spacing = (station: number) => {
    if (isEnd && Math.abs(chainage - origin.chainage) > slack.chainageM) held.push('An end PVI keeps its station')
    if (previous && next) {
      if (chainage < previous.chainage + MIN_PVI_GAP_M - slack.chainageM && station > chainage)
        held.push(`Kept ${MIN_PVI_GAP_M} m from ${label(index - 1)}`)
      if (chainage > next.chainage - MIN_PVI_GAP_M + slack.chainageM && station < chainage)
        held.push(`Kept ${MIN_PVI_GAP_M} m from ${label(index + 1)}`)
    }
  }
  if (input.holdGrade && sorted.length > 1) {
    const side: GradeHold = !previous ? 'ahead' : !next ? 'back' : chainage >= origin.chainage ? 'back' : 'ahead'
    const anchor = side === 'back' ? previous! : next!
    const free = side === 'back' ? next : previous
    const grade = side === 'back' ? tangentGrade(anchor, origin) : tangentGrade(origin, anchor)
    held.push(`Holding grade ${side === 'back' ? 'in' : 'out'} ${pct(grade)}`)
    const along = (station: number) => anchor.elevation + (grade * (station - anchor.chainage)) / 100
    const lo = previous ? previous.chainage + MIN_PVI_GAP_M : origin.chainage,
      hi = next ? next.chainage - MIN_PVI_GAP_M : origin.chainage
    let station = isEnd || lo > hi ? origin.chainage : Math.min(hi, Math.max(lo, chainage))
    spacing(station)
    const freeGrade = (s: number) => (free ? (100 * (free.elevation - along(s))) / (free.chainage - s) : Number.NaN)
    let snapped: SnappedGrade | undefined
    if (step && free && station !== origin.chainage) {
      const target = snapGrade(freeGrade(station), step)
      if (Math.abs(target - grade) > EPS) {
        // Where the line held at `grade` meets the free tangent at the round grade.
        const s =
          (target * free.chainage - 100 * free.elevation + 100 * anchor.elevation - grade * anchor.chainage) /
          (target - grade)
        if (s >= lo - EPS && s <= hi + EPS && Math.abs(target) <= MAX_EDIT_GRADE_PERCENT) {
          station = s
          snapped = { side: side === 'back' ? 'ahead' : 'back', gradePercent: target }
        }
      }
    }
    if (free && Math.abs(freeGrade(station)) > MAX_EDIT_GRADE_PERCENT) {
      // The free grade steepens toward its neighbour: back off toward where the drag began.
      let good = origin.chainage,
        bad = station
      for (let k = 0; k < 40; k++) {
        const mid = (good + bad) / 2
        if (Math.abs(freeGrade(mid)) > MAX_EDIT_GRADE_PERCENT) bad = mid
        else good = mid
      }
      station = good
      snapped = undefined
      held.push(`Grade ${side === 'back' ? 'out' : 'in'} capped at ${MAX_EDIT_GRADE_PERCENT} %`)
    }
    const level = along(station)
    if (Math.abs(level) > ELEVATION_LIMIT_M) return { chainage: origin.chainage, elevation: origin.elevation, held }
    return { chainage: station, elevation: level, held, holding: side, snapped }
  }
  const free = constrainPviDrag(sorted, index, chainage, elevation, roadLength)
  spacing(free.chainage)
  let placed = free
  let snapped: SnappedGrade | undefined
  if (step && sorted.length > 1) {
    // Round whichever adjacent grade needs the smaller move of the cursor's level.
    const options: { side: GradeHold; gradePercent: number; elevation: number }[] = []
    if (previous && free.chainage > previous.chainage) {
      const g = snapGrade((100 * (elevation - previous.elevation)) / (free.chainage - previous.chainage), step)
      options.push({
        side: 'back',
        gradePercent: g,
        elevation: previous.elevation + (g * (free.chainage - previous.chainage)) / 100,
      })
    }
    if (next && next.chainage > free.chainage) {
      const g = snapGrade((100 * (next.elevation - elevation)) / (next.chainage - free.chainage), step)
      options.push({
        side: 'ahead',
        gradePercent: g,
        elevation: next.elevation - (g * (next.chainage - free.chainage)) / 100,
      })
    }
    const best = options
      .filter((o) => Math.abs(o.gradePercent) <= MAX_EDIT_GRADE_PERCENT)
      .sort((a, b) => Math.abs(a.elevation - elevation) - Math.abs(b.elevation - elevation))[0]
    if (best) {
      const again = constrainPviDrag(sorted, index, free.chainage, best.elevation, roadLength)
      if (Math.abs(again.elevation - best.elevation) < EPS) {
        placed = again
        snapped = { side: best.side, gradePercent: best.gradePercent }
      }
    }
  }
  if (!snapped && Math.abs(free.elevation - elevation) > slack.elevationM)
    held.push(`Grade capped at ${MAX_EDIT_GRADE_PERCENT} %`)
  return { chainage: placed.chainage, elevation: placed.elevation, held, snapped }
}

export interface TangentDragInput {
  sorted: readonly VerticalPoint[]
  /** Index of the tangent's back PVI. */
  index: number
  /** How far the cursor has moved up, metres. */
  deltaM: number
  snapStep?: number | null
  controls?: readonly VerticalControl[]
  /** A few pixels of elevation, so a reason is given only when the cursor is visibly elsewhere. */
  slackM?: number
}

/** How far a dragged tangent moves: both its PVIs together, so its own grade is unchanged. */
export function dragTangent(input: TangentDragInput): { deltaM: number; held: string[]; snapped?: SnappedGrade } {
  const { sorted, index, controls } = input
  const step = input.snapStep && input.snapStep > 0 ? input.snapStep : null
  const back = sorted[index],
    ahead = sorted[index + 1]
  const previous = sorted[index - 1],
    next = sorted[index + 2]
  if (!back || !ahead) return { deltaM: 0, held: [] }
  let delta = input.deltaM
  let snapped: SnappedGrade | undefined
  if (step) {
    const options: (SnappedGrade & { delta: number })[] = []
    if (previous) {
      const run = back.chainage - previous.chainage
      const g = snapGrade((100 * (back.elevation + delta - previous.elevation)) / run, step)
      options.push({ side: 'back', gradePercent: g, delta: previous.elevation + (g * run) / 100 - back.elevation })
    }
    if (next) {
      const run = next.chainage - ahead.chainage
      const g = snapGrade((100 * (next.elevation - ahead.elevation - delta)) / run, step)
      options.push({ side: 'ahead', gradePercent: g, delta: next.elevation - (g * run) / 100 - ahead.elevation })
    }
    const best = options.sort((a, b) => Math.abs(a.delta - delta) - Math.abs(b.delta - delta))[0]
    if (best) {
      delta = best.delta
      snapped = { side: best.side, gradePercent: best.gradePercent }
    }
  }
  const wanted = delta
  const held: string[] = []
  let low = -Infinity,
    high = Infinity
  const limit = (lo: number, hi: number) => {
    if (lo > hi) return
    low = Math.max(low, lo)
    high = Math.min(high, hi)
  }
  if (previous) {
    const reach = MAX_DRAG_GRADE * (back.chainage - previous.chainage)
    limit(previous.elevation - reach - back.elevation, previous.elevation + reach - back.elevation)
  }
  if (next) {
    const reach = MAX_DRAG_GRADE * (next.chainage - ahead.chainage)
    limit(next.elevation - reach - ahead.elevation, next.elevation + reach - ahead.elevation)
  }
  const capLow = low,
    capHigh = high
  let control: VerticalControl | undefined
  for (const p of [back, ahead]) {
    const band = holdingBand(controls, p)
    if (!band) continue
    const before = [low, high]
    limit(band.low - p.elevation, band.high - p.elevation)
    if (before[0] !== low || before[1] !== high) control ??= band.control
  }
  limit(
    -ELEVATION_LIMIT_M - Math.min(back.elevation, ahead.elevation),
    ELEVATION_LIMIT_M - Math.max(back.elevation, ahead.elevation),
  )
  delta = Math.min(high, Math.max(low, delta))
  const slack = input.slackM ?? 0
  if (Math.abs(delta - wanted) > EPS) {
    snapped = undefined
    if (Math.abs(input.deltaM - delta) > slack) {
      const byControl = control && (delta === low ? low > capLow : high < capHigh)
      held.push(byControl ? controlText(control!) : `Grade capped at ${MAX_EDIT_GRADE_PERCENT} %`)
    }
  }
  return { deltaM: delta, held, snapped }
}

/** Remove one PVI, keeping at least `MIN_PROFILE_PVIS`. */
export function removePvi(points: readonly VerticalPoint[], id: string): GradeEditResult {
  const sorted = sortProfile(points)
  const index = sorted.findIndex((p) => p.id === id)
  if (index < 0) return { error: 'That PVI is no longer on the profile.' }
  if (sorted.length <= MIN_PROFILE_PVIS)
    return { error: `A profile keeps at least ${MIN_PROFILE_PVIS} PVIs; ${label(index)} stays.` }
  return { points: sorted.filter((p) => p.id !== id), movedId: id }
}

/** One PVI moved to `chainage`/`elevation`. Rounded to the centimetre unless a grade was snapped. */
export function placePvi(
  points: readonly VerticalPoint[],
  id: string,
  placed: { chainage: number; elevation: number },
  exact = false,
): VerticalPoint[] {
  const round = exact ? clean : (n: number) => Math.round(n * 100) / 100
  return points.map((p) =>
    p.id === id ? { ...p, chainage: round(placed.chainage), elevation: round(placed.elevation) } : p,
  )
}

/** Both PVIs of the tangent starting at `index` raised by `deltaM`. */
export function shiftTangent(
  sorted: readonly VerticalPoint[],
  index: number,
  deltaM: number,
  exact = false,
): VerticalPoint[] {
  const d = exact ? deltaM : Math.round(deltaM * 100) / 100
  return sorted.map((p, i) => (i === index || i === index + 1 ? { ...p, elevation: clean(p.elevation + d) } : p))
}
