/**
 * Comparing a replayed sightline run with the figures its archive saved (`analysisReplay.ts`), and the sentence the
 * reference run panel prints for it. Kept apart from the replay so the panel reads it without loading the
 * calculation. No DOM or network access.
 */

/**
 * The version of the sightline calculation an archive's figures came from, written in its manifest. Raise it when a
 * change to `computeAnalysis` is meant to move the figures, so a replay that differs says which calculation it ran.
 * Archives written before it carry none ("not recorded").
 */
export const SIGHTLINE_CALC_VERSION = 1

/**
 * How far a replayed percentage may sit from the saved one, in percentage points. Summing in another order moves a
 * figure by about 1e-14 points; one sightline of 21,348 is about 0.0047 points, so a real change in what a sightline
 * sees still fails.
 */
export const REPLAY_TOLERANCE_PP = 1e-6

/** Fields compared exactly: the assessment station and the sightline count, never a tolerance. */
const EXACT_FIELDS = new Set(['station', 'sightlines'])

export interface ReplayComparison {
  /** Every exact field equal, every shape the same, every percentage within `REPLAY_TOLERANCE_PP`. */
  matches: boolean
  /** The largest difference between two finite percentages, in points; 0 when none differ or none were compared. */
  maxAbsDeltaPp: number
  /** What differs, each as "path: saved → replayed". */
  mismatches: string[]
}

const shown = (value: unknown) => (value === undefined ? 'absent' : JSON.stringify(value))

/**
 * The saved figures (`expected`, as the manifest holds them) against the replay's. The station, the sightline count,
 * array lengths and which figures are present or null must match exactly; a finite percentage may differ by
 * `REPLAY_TOLERANCE_PP`. Both sides are read as JSON, so a figure the manifest wrote as null compares as null.
 */
export function compareReplayFigures(expected: unknown, actual: unknown): ReplayComparison {
  const mismatches: string[] = []
  let maxAbsDeltaPp = 0
  const walk = (a: unknown, b: unknown, path: string, key: string) => {
    if (typeof a === 'number' && typeof b === 'number' && Number.isFinite(a) && Number.isFinite(b)) {
      if (EXACT_FIELDS.has(key)) {
        if (a !== b) mismatches.push(`${path}: ${a} → ${b}`)
        return
      }
      const delta = Math.abs(a - b)
      maxAbsDeltaPp = Math.max(maxAbsDeltaPp, delta)
      if (!(delta <= REPLAY_TOLERANCE_PP)) mismatches.push(`${path}: ${a} → ${b}`)
      return
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) {
        mismatches.push(`${path}: ${a.length} entries → ${b.length}`)
        return
      }
      a.forEach((item, i) => walk(item, b[i], `${path}[${i}]`, key))
      return
    }
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)])
      for (const k of keys)
        walk((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k, k)
      return
    }
    if (a !== b) mismatches.push(`${path || 'figures'}: ${shown(a)} → ${shown(b)}`)
  }
  walk(expected, actual, '', '')
  return { matches: mismatches.length === 0, maxAbsDeltaPp, mismatches }
}

/** A difference in points as the panel prints it: exponent form below a thousandth. */
export const formatReplayDelta = (delta: number) =>
  delta === 0 ? '0' : delta < 1e-3 ? delta.toExponential(1) : String(Number(delta.toPrecision(3)))

/** The panel's sentence for a replay: whether it matched, within what, the largest difference and the calculation. */
export function replayEvidence(replay: {
  replayMatches?: boolean
  replayMaxDeltaPp?: number
  replayMismatches?: string[]
  replayCalcVersion?: number | null
}): string {
  const largest = `largest difference ${formatReplayDelta(replay.replayMaxDeltaPp ?? 0)} points`
  const version = `Calculation version ${replay.replayCalcVersion ?? 'not recorded'} in the archive.`
  if (replay.replayMatches)
    return `Replayed the saved numerical results: within ${REPLAY_TOLERANCE_PP.toExponential(0)} points (${largest}). ${version}`
  const differ = replay.replayMismatches ?? []
  const listed = differ.slice(0, 3).join('; ')
  return `Replayed figures differ from the saved run (${largest}; ${differ.length} differ${
    listed ? `: ${listed}${differ.length > 3 ? '; …' : ''}` : ''
  }). ${version}`
}
