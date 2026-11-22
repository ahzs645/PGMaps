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

/** Whether any of the gaps is filled by `action` (a lookup), wherever it stands in the list: not only the first. */
export function gapsAsk(gaps: readonly RunGap[], action: NonNullable<RunGap['action']>): boolean {
  return gaps.some((gap) => gap.action === action)
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
  /**
   * The scene fingerprint of the run the stamp was read from, and of the scene the view was captured under. Absent on
   * views saved before they were kept; a `ready` stamp whose two keys differ is not the view's figure.
   */
  sightlineRunKey?: string
  sightlineCaptureKey?: string
}

/** The run's scene and the view's, for a stamp (`captureSightline`). */
export type SightlineKeys = { runKey: string | null; captureKey: string | null }

/** The record a save stamps from the run as it stands (`runFigures`). */
export function captureSightline(
  figures: RunFigures,
  stationIndex: number,
  keys?: SightlineKeys,
): CapturedSightlineRecord {
  const stamped = {
    ...(keys?.runKey ? { sightlineRunKey: keys.runKey } : {}),
    ...(keys?.captureKey ? { sightlineCaptureKey: keys.captureKey } : {}),
  }
  if (figures.state === 'ready')
    return {
      sightlinePercent: figures.atStation(stationIndex)?.cumulativePercent ?? null,
      sightlineReadiness: 'ready',
      ...stamped,
    }
  return {
    sightlinePercent: null,
    sightlineReadiness: 'withheld',
    sightlineWithheld: figures.gaps[0]?.text ?? 'The run was provisional when the view was saved.',
    ...stamped,
  }
}

/** Printed where a view saved before readiness was recorded would have shown its sightline figure. */
export const READINESS_NOT_RECORDED =
  'Readiness not recorded: the view was saved before the run’s readiness was checked. Stand at it with a current run and record the run’s figure, or save it again, for the assessment’s figure.'

/** Printed where a view's stamp came from a run of another scene than the one it was captured under. */
export const SIGHTLINE_NOT_CURRENT =
  'Out of date: the figure was read from a run of another scene than the view’s. Stand at it with a current run and record the run’s figure.'

/** Whether a stamp is the view's own current figure: `ready`, from a run of the scene the view was captured under. */
export function sightlineStampCurrent(record: CapturedSightlineRecord | null | undefined): boolean {
  if (record?.sightlineReadiness !== 'ready') return false
  return !(
    record.sightlineRunKey &&
    record.sightlineCaptureKey &&
    record.sightlineRunKey !== record.sightlineCaptureKey
  )
}

/**
 * A saved view's sightline figure as the assessment's (`percent`), or what to print in its place (`note`). A view
 * saved before the readiness check never passes its figure off as the assessment's.
 */
export function capturedSightline(record: CapturedSightlineRecord | null | undefined): {
  percent: number | null
  note: string | null
} {
  if (!record) return { percent: null, note: null }
  if (record.sightlineReadiness === 'ready')
    return sightlineStampCurrent(record)
      ? { percent: record.sightlinePercent, note: null }
      : { percent: null, note: SIGHTLINE_NOT_CURRENT }
  if (record.sightlineReadiness === 'withheld')
    return {
      percent: null,
      note: `Withheld — ${record.sightlineWithheld ?? 'the run was provisional when the view was saved.'}`,
    }
  return record.sightlinePercent === null
    ? { percent: null, note: null }
    : { percent: null, note: READINESS_NOT_RECORDED }
}
