/**
 * Where an own photo stands in its line-up (`OwnPhotoDialog`): three steps, each done, wanting
 * attention or still to do, with one line saying why, and the step to go to next. The dialog's
 * tabs, its Next button and the sidebar's summary read the same answer.
 *
 * A step being done is never a verdict on the camera: it says what the camera rests on (the
 * phone's own heading, the skyline, paired points, a matched file, the reviewer), and the reviewer
 * still judges it against the photo.
 *
 * Free of DOM and network access.
 */
import type { PoseSource } from './exifPose'
import { ACCEPTANCE_ANGLE_DEGREES } from './photoAcceptance'

export type OwnPhotoStep = 'position' | 'direction' | 'check'

export const OWN_PHOTO_STEPS: ReadonlyArray<{ step: OwnPhotoStep; label: string; title: string }> = [
  { step: 'position', label: 'Position', title: 'Where it was taken' },
  { step: 'direction', label: 'Direction', title: 'Which way it looked' },
  { step: 'check', label: 'Check', title: 'Check the camera' },
]

export type OwnPhotoStepState = 'todo' | 'attention' | 'done'

export interface OwnPhotoStepReading {
  state: OwnPhotoStepState
  /** One line, a sentence fragment with no full stop: what the step rests on, or what it wants. */
  note: string
}

export interface OwnPhotoStepsInput {
  /** Where the position came from; null when the photo has none yet. */
  position: PoseSource | null
  heading: PoseSource
  /** Whether the eye stands at an absolute altitude (from the air, or matched). */
  airborne: boolean
  /** The all-headings skyline search, when it has finished for this photo. */
  search: { trustworthy: boolean; ambiguous: boolean } | null
  /** Points paired so far, and whether a solve from them stands. */
  pairs: number
  solved: { points: number; suspect: boolean } | null
  /** A matched camera's warnings, when one is applied. */
  matched: { checks: number } | null
  /** The camera's heading, and the headings the checks were made for. */
  bearing: number
  checkedBearings: number[]
}

/** A check made for a camera within this many degrees still speaks for it: the acceptance's own tolerance. */
const CHECK_BEARING_TOLERANCE = ACCEPTANCE_ANGLE_DEGREES

const headingGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)

function positionStep({ position, airborne }: OwnPhotoStepsInput): OwnPhotoStepReading {
  if (!position) return { state: 'attention', note: 'pick the spot on the plan, or type it' }
  const height = airborne ? ', at its altitude' : ''
  switch (position) {
    case 'exif':
      return { state: 'done', note: `from the photo’s GPS${height}` }
    case 'record':
      return { state: 'done', note: `from the field record${height}` }
    case 'matched':
      return { state: 'done', note: 'from the matched camera' }
    case 'controls':
      return { state: 'done', note: 'solved from the paired points' }
    case 'reviewer':
      return { state: 'done', note: `set by you${height}` }
    default:
      // The road view's spot or a default: a start, not where the photo was taken.
      return { state: 'todo', note: 'the road view’s spot: set where the photo was taken' }
  }
}

function directionStep(input: OwnPhotoStepsInput): OwnPhotoStepReading {
  const { heading, search, solved, matched, pairs, airborne } = input
  switch (heading) {
    case 'skyline':
      if (!search) return { state: 'done', note: 'aligned to the skyline' }
      if (search.trustworthy) return { state: 'done', note: 'fitted to the skyline' }
      return {
        state: 'attention',
        note: search.ambiguous
          ? 'not settled: another heading fits about as well'
          : 'the skyline fit is not trustworthy',
      }
    case 'controls':
      if (solved?.suspect) return { state: 'attention', note: 'solved, but the camera looks wrong: check the pairs' }
      return { state: 'done', note: `solved from ${solved?.points ?? pairs} paired points` }
    case 'matched':
      return matched && matched.checks > 0
        ? { state: 'attention', note: 'from the matched camera, with warnings' }
        : { state: 'done', note: 'from the matched camera' }
    case 'record':
      return { state: 'done', note: 'from the field record' }
    case 'reviewer':
      return { state: 'done', note: 'set by you' }
    case 'landmark':
      return { state: 'todo', note: 'toward the spot picked at the photo’s centre: search or pair points to finish' }
    case 'exif':
      return {
        state: 'todo',
        note: airborne
          ? 'the phone’s heading, which from an aircraft can be far out'
          : 'the phone’s heading, often a few degrees out',
      }
    default:
      return { state: 'todo', note: 'not known yet: the road view’s heading, as it stood' }
  }
}

function checkStep({ bearing, checkedBearings }: OwnPhotoStepsInput): OwnPhotoStepReading {
  if (checkedBearings.some((checked) => headingGap(checked, bearing) <= CHECK_BEARING_TOLERANCE))
    return { state: 'done', note: 'drawn for this camera: compare it with the photo' }
  if (checkedBearings.length) return { state: 'todo', note: 'the camera has changed since it was checked' }
  return { state: 'todo', note: 'not checked yet' }
}

/** Each step's state, and the first one that is not done (`line-up` when all are). */
export function ownPhotoSteps(input: OwnPhotoStepsInput): {
  steps: Record<OwnPhotoStep, OwnPhotoStepReading>
  next: OwnPhotoStep | 'line-up'
} {
  const steps: Record<OwnPhotoStep, OwnPhotoStepReading> = {
    position: positionStep(input),
    direction: directionStep(input),
    check: checkStep(input),
  }
  const next = OWN_PHOTO_STEPS.find(({ step }) => steps[step].state !== 'done')?.step ?? 'line-up'
  return { steps, next }
}
