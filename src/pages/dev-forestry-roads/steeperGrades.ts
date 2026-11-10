/**
 * "Try steeper grades": when a goal finds no line within the grade limit, the search is run again a
 * little over it, so the failure can say how far off the ends are ("connects at 14 %") rather than
 * only that they do not connect. Information only: nothing here makes a road, and the project's
 * grade limit is never changed.
 *
 * Free of DOM and network access; the search itself is passed in.
 */

/** How far over the grade limit a failed search is tried again, in order, percentage points. */
export const STEEPER_GRADE_STEPS_PERCENT: readonly number[] = [2, 4]
/** The steepest grade the corridor and switchback searches take (`optimizeRoadCorridor`'s 1–30 %). */
export const MAX_STEEPER_GRADE_PERCENT = 30

export interface SteeperGradeLine {
  lengthM: number
  /** Which search found it, in words: "the corridor search" or "the switchback search". */
  search: string
}
export interface SteeperGradeResult {
  /** The project's grade limit, unchanged. */
  limitPercent: number
  /** The grades tried, in order; the sweep stops at the first that connects. */
  tried: number[]
  /** The first grade that connected, or null. */
  connectsAt: number | null
  line: SteeperGradeLine | null
  /** Why a grade could not be tried at all (an end off the terrain, say), in the search's words. */
  refused?: string
}

const isAbort = (cause: unknown) => cause instanceof Error && cause.name === 'AbortError'

/** The grades a sweep tries over `limitPercent`: each step, held to the searches' ceiling, without repeats. */
export function steeperGrades(limitPercent: number, steps: readonly number[] = STEEPER_GRADE_STEPS_PERCENT) {
  const grades: number[] = []
  for (const step of steps) {
    const grade = Math.min(MAX_STEEPER_GRADE_PERCENT, Math.round((limitPercent + step) * 10) / 10)
    if (grade > limitPercent && !grades.includes(grade)) grades.push(grade)
  }
  return grades
}

/**
 * Runs `connect` at each steeper grade until one finds a line. `connect` returns null when its search
 * ran and found none, and throws when the search could not run; a cancel (`AbortError`) is passed on.
 */
export async function sweepSteeperGrades(
  limitPercent: number,
  connect: (gradePercent: number) => Promise<SteeperGradeLine | null>,
  steps: readonly number[] = STEEPER_GRADE_STEPS_PERCENT,
): Promise<SteeperGradeResult> {
  const tried: number[] = []
  for (const grade of steeperGrades(limitPercent, steps)) {
    tried.push(grade)
    let line: SteeperGradeLine | null
    try {
      line = await connect(grade)
    } catch (cause) {
      if (isAbort(cause)) throw cause
      return {
        limitPercent,
        tried,
        connectsAt: null,
        line: null,
        refused: cause instanceof Error ? cause.message : 'The search could not run.',
      }
    }
    if (line) return { limitPercent, tried, connectsAt: grade, line }
  }
  return { limitPercent, tried, connectsAt: null, line: null }
}

const pct = (value: number) => `${Number(value.toFixed(1))}%`

/** The sweep's finding, for the failure row. Always says the limit and the road are unchanged. */
export function steeperGradeText(result: SteeperGradeResult): string {
  const limit = pct(result.limitPercent)
  if (result.refused) return `Could not try ${pct(result.tried[result.tried.length - 1])}: ${result.refused}`
  if (!result.tried.length)
    return `No steeper grade tried: ${limit} is already at the ${MAX_STEEPER_GRADE_PERCENT}% the searches take.`
  if (result.connectsAt !== null && result.line) {
    const over = pct(result.connectsAt - result.limitPercent)
    const below = result.tried.length > 1 ? `, not at ${result.tried.slice(0, -1).map(pct).join(' or ')}` : ''
    return `Connects at ${pct(result.connectsAt)}${below}: ${over} over the ${limit} limit, a ${Math.round(result.line.lengthM).toLocaleString('en-CA')} m line by ${result.line.search}. For information only: no road was added and the grade limit is still ${limit}.`
  }
  return `Does not connect up to ${pct(result.tried[result.tried.length - 1])}: the search found no line at ${result.tried.map(pct).join(' or ')} in the same corridor either. A steeper grade alone will not join these ends; move an end or widen the corridor.`
}
