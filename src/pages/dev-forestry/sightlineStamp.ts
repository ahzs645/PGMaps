/**
 * Recording the run's sightline figure on a saved view without capturing it again: a view saved before the run's
 * readiness was recorded, or while the run was provisional, keeps its picture and its class pass, and only its
 * sightline record is stamped again from a ready run of the scene it was captured under (*Record the run's figure*
 * on its row, one click, never a gate). An engine's redraw of a view takes the view's own record, never the run's at
 * render time (`savedIdentity`). DOM-free.
 */
import {
  captureSightline,
  sightlineStampCurrent,
  type CapturedSightlineRecord,
  type RunFigures,
  type SightlineKeys,
} from './runFigures'

/** The sightline fields a saved figure carries (`SavedFigure`). */
export type SightlineStamp = CapturedSightlineRecord & { sightlineClass: string | null }

/** Every field of a saved view's sightline record, for carrying it whole from one figure to another. */
export const SIGHTLINE_STAMP_FIELDS = [
  'sightlinePercent',
  'sightlineClass',
  'sightlineReadiness',
  'sightlineWithheld',
  'sightlineRunKey',
  'sightlineCaptureKey',
] as const satisfies ReadonlyArray<keyof SightlineStamp>

/**
 * The record to stamp on a saved view from the run as it stands, or null when there is nothing to record: the run is
 * not ready, it is not a run of the scene the view was captured under (`keys.runKey !== keys.captureKey`), or the
 * view's own record is already the current figure. `classOf` names a percent's Table 2 class.
 */
export function restampSightline(
  record: CapturedSightlineRecord | null | undefined,
  figures: RunFigures,
  stationIndex: number,
  keys: SightlineKeys,
  classOf: (percent: number) => string | null,
): SightlineStamp | null {
  if (!record || figures.state !== 'ready') return null
  if (!keys.runKey || keys.runKey !== keys.captureKey) return null
  if (sightlineStampCurrent(record)) return null
  const stamp = captureSightline(figures, stationIndex, keys)
  return {
    ...stamp,
    sightlineClass: stamp.sightlinePercent === null ? null : classOf(stamp.sightlinePercent),
  }
}

/**
 * A figure with another's sightline record: every stamp field `own` has, and none it lacks. An engine's redraw keeps
 * the view's own record this way (`savedIdentity`), and a restamp replaces a figure's.
 */
export function withSightlineStamp<F extends object>(figure: F, own: Partial<SightlineStamp>): F {
  const next = { ...figure } as Record<string, unknown>
  for (const field of SIGHTLINE_STAMP_FIELDS) {
    if (field in own) next[field] = own[field]
    else delete next[field]
  }
  return next as F
}
