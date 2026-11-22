import type { AlterationBreakdown, AnalysisQuality, RunGap } from './types'

/**
 * The one readiness rule for every output that prints a run's alteration figures. A run's numbers are the
 * assessment's only while the run is current and `quality.numericalReady` holds; otherwise every surface withholds
 * them and names the first gap, or prints them under a label that says they are diagnostic. Reading
 * `perspectiveAlteration`, `planimetricAlteration` or `perspectiveByStation` anywhere else is refused by
 * `runFigures.test.ts`'s source scan. DOM-free.
 *
 * - `none`: nothing has been run.
 * - `stale`: the scene changed since the run (the page drops a stale result, so it passes `stale` alone).
 * - `provisional`: the run is current but a condition for numerical figures fails (`quality.gaps`).
 * - `ready`: the figures are the assessment's.
 */
export type RunFigureState = 'none' | 'stale' | 'provisional' | 'ready'

/** What `runFigures` reads: an `AnalysisResult`, or a saved run summary carrying the same fields. */
export type RunFigureSource = {
  perspectiveAlteration: AlterationBreakdown | null
  planimetricAlteration: AlterationBreakdown | null
  perspectiveByStation: ReadonlyArray<AlterationBreakdown | null>
  assessmentStationIndex?: number
  quality?: Pick<AnalysisQuality, 'numericalReady' | 'warnings'> & { gaps?: RunGap[] }
}

export type RunFigures = {
  state: RunFigureState
  /** The assessment's perspective figure at the run's assessment station; null unless `ready`. */
  perspective: AlterationBreakdown | null
  /** The assessment's planimetric figure; null unless `ready`. */
  planimetric: AlterationBreakdown | null
  /** The perspective figure at a station; null unless `ready`, or where the station has no complete view. */
  atStation(index: number): AlterationBreakdown | null
  /**
   * The run's raw values whatever its state, for a surface that prints them under an explicit "diagnostic" label and
   * never as the assessment's figure. Empty when there is no run.
   */
  diagnostic: {
    perspective: AlterationBreakdown | null
    planimetric: AlterationBreakdown | null
    atStation(index: number): AlterationBreakdown | null
  }
  /** Why the figures are withheld, in the run's order; empty when `ready`. */
  gaps: RunGap[]
}

const NOT_RUN: RunGap = { id: 'not-run', text: 'Not run: run visibility in step 3.', editor: 'run' }
const STALE: RunGap = {
  id: 'stale',
  text: 'Out of date: the scene changed since the run. Run visibility again.',
  editor: 'run',
}
const NOTHING = () => null

export function runFigures(result: RunFigureSource | null | undefined, options: { stale?: boolean } = {}): RunFigures {
  if (!result)
    return {
      state: options.stale ? 'stale' : 'none',
      perspective: null,
      planimetric: null,
      atStation: NOTHING,
      diagnostic: { perspective: null, planimetric: null, atStation: NOTHING },
      gaps: [options.stale ? STALE : NOT_RUN],
    }
  const diagnostic = {
    perspective: result.perspectiveAlteration ?? null,
    planimetric: result.planimetricAlteration ?? null,
    atStation: (index: number) => result.perspectiveByStation?.[index] ?? null,
  }
  const ready = !options.stale && result.quality?.numericalReady === true
  if (ready)
    return {
      state: 'ready',
      perspective: diagnostic.perspective,
      planimetric: diagnostic.planimetric,
      atStation: diagnostic.atStation,
      diagnostic,
      gaps: [],
    }
  const recorded = result.quality?.gaps?.length ? result.quality.gaps : null
  return {
    state: options.stale ? 'stale' : 'provisional',
    perspective: null,
    planimetric: null,
    atStation: NOTHING,
    diagnostic,
    gaps: options.stale
      ? [STALE]
      : (recorded ?? [
          {
            id: 'provisional',
            // A run saved before gaps were recorded names its first warning, as the status rows did.
            text: result.quality?.warnings?.[0] ?? 'The run did not record why it is provisional.',
            editor: 'run',
          },
        ]),
  }
}

/** "Withheld — <first gap>": what a surface prints in place of a figure the run does not stand behind. */
export function withheldText(figures: Pick<RunFigures, 'gaps'>): string {
  const gap = figures.gaps[0]
  return gap ? `Withheld — ${gap.text}` : 'Withheld'
}

/** A figure printed beside the run's state, never as the assessment's: "12.30% (diagnostic, not for reporting)". */
export const DIAGNOSTIC_LABEL = 'Diagnostic (not for reporting)'

/**
 * What a saved view keeps of the run's sightline figure at its station (`SavedFigure`): the figure only when the
 * run's figures were the assessment's when it was saved, else why not. `sightlineReadiness` is absent on views saved
 * before the save checked it.
 */
export type CapturedSightlineRecord = {
  sightlinePercent: number | null
  sightlineReadiness?: 'ready' | 'withheld'
  sightlineWithheld?: string
}

/** The record a save stamps from the run as it stands (`runFigures`). */
export function captureSightline(figures: RunFigures, stationIndex: number): CapturedSightlineRecord {
  if (figures.state === 'ready')
    return { sightlinePercent: figures.atStation(stationIndex)?.cumulativePercent ?? null, sightlineReadiness: 'ready' }
  return {
    sightlinePercent: null,
    sightlineReadiness: 'withheld',
    sightlineWithheld: figures.gaps[0]?.text ?? 'The run was provisional when the view was saved.',
  }
}

/** Printed where a view saved before readiness was recorded would have shown its sightline figure. */
export const READINESS_NOT_RECORDED =
  'Readiness not recorded: the view was saved before the run’s readiness was checked. Save it again for the assessment’s figure.'

/**
 * A saved view's sightline figure as the assessment's (`percent`), or what to print in its place (`note`). A view
 * saved before the readiness check never passes its figure off as the assessment's.
 */
export function capturedSightline(record: CapturedSightlineRecord | null | undefined): {
  percent: number | null
  note: string | null
} {
  if (!record) return { percent: null, note: null }
  if (record.sightlineReadiness === 'ready') return { percent: record.sightlinePercent, note: null }
  if (record.sightlineReadiness === 'withheld')
    return {
      percent: null,
      note: `Withheld — ${record.sightlineWithheld ?? 'the run was provisional when the view was saved.'}`,
    }
  return record.sightlinePercent === null
    ? { percent: null, note: null }
    : { percent: null, note: READINESS_NOT_RECORDED }
}
