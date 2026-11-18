/**
 * The own photo's options card (doc proposal `forestry-visual-quality-own-photo-redesign-2026-11-17.md`, §2.2): one
 * row per candidate camera, from whatever is known (the skyline search's winner and runner-up, the model-view scores,
 * the sun, the phone's heading, a burst neighbour's accepted camera, a point solve, a matched camera), ranked by the
 * evidence behind it. Nothing here accepts a camera: the reviewer checks one and accepts it (`photoAcceptance.ts`).
 *
 * Also the automatic queue's states and failure reasons, with the plain words the photo strip shows for each.
 *
 * Free of DOM and network access.
 */
import type { HeadingReference } from './exifPose'
import type { MatchedCamera } from './matchedCamera'
import type { FlightCameraProposal } from './photoFlightMatching'
import type { AcceptanceEvidence, AcceptancePose } from './photoAcceptance'
import { POINTS_REFERENCE_WIDTH, pointsHeldOutLimit, sameCamera, wrapHeading } from './photoAcceptance'
import type { SunCheck, WideSearchResult } from './wideOrientation'

/** Two cameras within this many degrees of heading agree; past it a neighbour's ±15° prior would not hold the other. */
export const NEIGHBOUR_AGREE_DEGREES = 15
/**
 * A model-view score this much higher for the runner-up than the winner is worth a warning. On fourteen helicopter
 * photos the score ranked the skyline's winner first on all five checked, winning by 0.36 in the browser case
 * (`docs/forestry-visual-quality.md`), so a reversal by a tenth is a sign, not noise. Provisional.
 */
export const MODEL_SCORE_REVERSAL = 0.1
/**
 * A narrow search round an accepted burst neighbour's camera that lands within this many degrees of it, on at least
 * `NARROW_AGREE_SHARE` of the columns that can be judged, is evidence: two frames seconds apart, fitted alone, agreeing.
 * It is shown beside the fit, never as settling it; only the all-headings search settles a fit.
 */
export const NARROW_AGREE_DEGREES = 2
export const NARROW_AGREE_SHARE = 0.8

export type PhotoOptionKind = 'winner' | 'runner-up' | 'phone' | 'neighbour' | 'points' | 'matched' | 'landmark'

export type PhotoOption = {
  id: string
  kind: PhotoOptionKind
  label: string
  pose: AcceptancePose
  evidence: AcceptanceEvidence
  warnings: string[]
  overlap?: Pick<FlightCameraProposal, 'basis' | 'matches' | 'controls' | 'medianPx' | 'p90Px'>
}

export interface PhotoOptionsInput {
  /** This photo's place, altitude (null on the ground) and lens: the base every heading-only candidate stands on. */
  base: { lng: number; lat: number; altitudeMeters: number | null; hfov: number }
  /** The all-headings skyline search, with the sun for its winner and runner-up. */
  search?: {
    result: WideSearchResult
    sun?: { best: SunCheck; runnerUp: SunCheck | null } | null
  } | null
  /** Model-view scores (`modelAgreement`), for the cameras they were drawn for. */
  modelScores?: ReadonlyArray<{ pose: AcceptancePose; score: number }>
  /** The phone's recorded heading, and the tilt sensor's pitch when it read gravity alone. */
  phone?: { bearing: number; reference: HeadingReference; pitch?: number | null; airborne: boolean } | null
  /** A burst neighbour's accepted camera. */
  neighbour?: {
    id: string
    label: string
    gapSeconds: number
    distanceMeters: number
    pose: Pick<AcceptancePose, 'bearing' | 'pitch' | 'roll'>
  } | null
  /**
   * The narrow search round the neighbour's camera, when it agreed with it (`narrowAgreement`) but did not stand alone:
   * the full search ran too. Its fit is a row of its own unless the full search's winner is the same camera.
   */
  narrow?: {
    pose: Pick<AcceptancePose, 'bearing' | 'pitch' | 'roll'> & { hfov?: number }
    neighbourId: string
    label: string
    agreesDegrees: number
    agreeShare: number
    skyColumns: number
    skySpanShare: number
  } | null
  landmark?: Pick<AcceptancePose, 'bearing' | 'pitch' | 'roll'> | null
  /** A camera solved from paired points. */
  points?: {
    pose: AcceptancePose
    pairs: number
    /** Worst held-out pair, pixels of a frame `photoWidth` wide; null when no pair could be held out. */
    worstPairPixels: number | null
    heldOutMeters: number | null
    photoWidth?: number
    /** `solveLooksWrong`: rolled over, or moved far from the GPS. */
    suspect?: boolean
  } | null
  /** A camera from the photo-matching bench's case file, with `matchedCameraChecks`. */
  matched?: { camera: MatchedCamera; checks: string[] } | null
  flightProposals?: readonly FlightCameraProposal[]
}

const gap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)
const deg = (value: number) => `${Math.round(value)}°`
const signed = (value: number) => `${Math.round(Math.abs(value))}° ${value < 0 ? 'left' : 'right'}`

/** One line on where the sun falls for a camera: evidence beside the skyline, never a verdict. */
export function sunNote(sun: SunCheck): string {
  if (sun.elevation < 0) return 'sun below the horizon'
  if (sun.inFrame) return 'sun in frame: look for its glare or a lit patch of cloud'
  if (Math.abs(sun.relativeBearing) > 90) return `sun behind the camera, ${signed(sun.relativeBearing)}`
  return `sun out of frame, ${signed(sun.relativeBearing)}`
}

/** A score belongs to the camera that drew the view, including its position and lens. */
function scoreFor(input: PhotoOptionsInput, pose: AcceptancePose): number | null {
  return input.modelScores?.find((view) => sameCamera(view.pose, pose))?.score ?? null
}

/**
 * Evidence tiers, strongest first. Within a tier the higher model-view score leads (a candidate without one comes
 * after those with one), then the order of `KIND_ORDER`: ground recognised by the reviewer and checked by a held-out
 * pair before the skyline, which looking steeply down at forest under one smooth ridge can leave ambiguous.
 *
 * 0. A camera that independent evidence fixes: a trustworthy skyline winner; a point solve whose worst held-out pair
 *    is inside the acceptance limit; a matched camera with nothing to check.
 * 1. A camera with evidence that leaves doubt: a skyline winner that is not settled; a burst neighbour's accepted
 *    camera (right for another frame, a prior for this one); a point solve or matched camera with warnings.
 * 2. The skyline's runner-up.
 * 3. The phone's own heading, which from an aircraft can be 50–140° out.
 * Agreement between two candidates (within `NEIGHBOUR_AGREE_DEGREES`) is noted on both and never moves a tier.
 */
const KIND_ORDER: readonly PhotoOptionKind[] = [
  'points',
  'winner',
  'landmark',
  'matched',
  'neighbour',
  'runner-up',
  'phone',
]

/** The candidate cameras for the options card, ranked by the evidence behind each (see the tiers above). */
export function photoOptions(input: PhotoOptionsInput): PhotoOption[] {
  const { base } = input
  const rows: Array<PhotoOption & { tier: number; score: number | null }> = []
  const at = (angles: { bearing: number; pitch: number; roll: number }, hfov = base.hfov): AcceptancePose => ({
    lng: base.lng,
    lat: base.lat,
    altitudeMeters: base.altitudeMeters,
    bearing: wrapHeading(angles.bearing),
    pitch: angles.pitch,
    roll: angles.roll,
    hfov,
  })

  const search = input.search?.result
  if (search) {
    const fit = search.fit
    const settled = search.trustworthy
    const lens = search.hfov ?? base.hfov
    const winnerPose = at(search, lens)
    const runner = search.runnerUp
    const runnerPose = runner ? at(runner, runner.hfov ?? lens) : null
    const winnerScore = scoreFor(input, winnerPose)
    const runnerScore = runnerPose ? scoreFor(input, runnerPose) : null
    const warnings: string[] = []
    if (search.ambiguous) warnings.push('not settled: another heading fits about as well')
    else if (!fit.trustworthy) warnings.push('the skyline fit is not trustworthy')
    if (winnerScore !== null && runnerScore !== null && runnerScore - winnerScore >= MODEL_SCORE_REVERSAL)
      warnings.push('the model view matches the runner-up better')
    const sun = input.search?.sun
    rows.push({
      id: 'winner',
      kind: 'winner',
      label: 'Skyline: best fit',
      pose: winnerPose,
      evidence: {
        skyColumns: fit.agreeing,
        skySpanShare: fit.span,
        agreeShare: fit.agreement,
        settled,
        runnerUpBearing: runner?.bearing ?? null,
        modelScore: winnerScore,
        runnerUpModelScore: runnerScore,
        sunNote: sun ? sunNote(sun.best) : null,
      },
      warnings,
      tier: settled ? 0 : 1,
      score: winnerScore,
    })
    if (runner && runnerPose) {
      const runnerWarnings = [`${deg(gap(runner.bearing, search.bearing))} from the best fit`]
      if (winnerScore !== null && runnerScore !== null && winnerScore - runnerScore >= MODEL_SCORE_REVERSAL)
        runnerWarnings.push('the model view matches the best fit better')
      rows.push({
        id: 'runner-up',
        kind: 'runner-up',
        label: 'Skyline: runner-up',
        pose: runnerPose,
        evidence: {
          settled: false,
          modelScore: runnerScore,
          sunNote: sun?.runnerUp ? sunNote(sun.runnerUp) : null,
        },
        warnings: runnerWarnings,
        tier: 2,
        score: runnerScore,
      })
    }
  }

  if (input.phone) {
    const { phone } = input
    const warnings = [
      phone.airborne
        ? 'the phone’s heading: from an aircraft can be far out'
        : 'the phone’s heading: often a few degrees out',
    ]
    if (phone.reference !== 'true') warnings.push('magnetic or unstated north: add the declination')
    const pose = at({ bearing: phone.bearing, pitch: phone.pitch ?? 0, roll: 0 })
    rows.push({
      id: 'phone',
      kind: 'phone',
      label: 'Phone’s heading',
      pose,
      evidence: { modelScore: scoreFor(input, pose) },
      warnings,
      tier: 3,
      score: scoreFor(input, pose),
    })
  }

  if (input.neighbour) {
    const { neighbour } = input
    const when = `${Math.abs(Math.round(neighbour.gapSeconds))} s ${neighbour.gapSeconds < 0 ? 'before' : 'after'}`
    const pose = at(neighbour.pose)
    rows.push({
      id: `neighbour:${neighbour.id}`,
      kind: 'neighbour',
      label: `${neighbour.label}’s camera (${when})`,
      pose,
      evidence: { neighbourId: neighbour.id, modelScore: scoreFor(input, pose) },
      warnings: [`accepted for another frame, ${Math.round(neighbour.distanceMeters)} m away: the camera moved`],
      tier: 1,
      score: scoreFor(input, pose),
    })
  }

  if (input.landmark) {
    const pose = at(input.landmark)
    const score = scoreFor(input, pose)
    rows.push({
      id: 'landmark',
      kind: 'landmark',
      label: 'One-landmark starting camera',
      pose,
      evidence: { settled: false, modelScore: score },
      warnings: ['Position, lens and roll come from the current camera. Check a different feature'],
      tier: 1,
      score,
    })
  }

  const { narrow } = input
  // The narrow fit and the full search's winner are one camera: the agreement goes on the winner as evidence.
  const winnerRow = rows.find((row) => row.kind === 'winner')
  const narrowPose = narrow ? at(narrow.pose, narrow.pose.hfov ?? base.hfov) : null
  const narrowIsWinner = !!narrowPose && !!winnerRow && sameCamera(winnerRow.pose, narrowPose)
  if (narrow && narrowPose && !narrowIsWinner)
    rows.push({
      id: `narrow:${narrow.neighbourId}`,
      kind: 'neighbour',
      label: `Skyline round ${narrow.label}’s camera`,
      pose: narrowPose,
      evidence: {
        skyColumns: narrow.skyColumns,
        skySpanShare: narrow.skySpanShare,
        agreeShare: narrow.agreeShare,
        settled: false,
        neighbourId: narrow.neighbourId,
        neighbourAgreesDegrees: narrow.agreesDegrees,
        modelScore: scoreFor(input, narrowPose),
      },
      warnings: ['searched only round the neighbour’s heading: the all-headings search did not settle on it'],
      tier: 1,
      score: scoreFor(input, narrowPose),
    })

  if (input.points) {
    const { points } = input
    const warnings: string[] = []
    const limit = pointsHeldOutLimit(points.photoWidth ?? POINTS_REFERENCE_WIDTH)
    if (points.suspect) warnings.push('the camera looks wrong: check the pairs')
    if (points.worstPairPixels === null) warnings.push('no pair held out: pair one more point to check the solve')
    else if (points.worstPairPixels > limit)
      warnings.push(`a held-out pair lands ${Math.round(points.worstPairPixels)} px off`)
    rows.push({
      id: 'points',
      kind: 'points',
      label: `Paired points (${points.pairs})`,
      pose: points.pose,
      evidence: {
        heldOutMeters: points.heldOutMeters,
        worstPairPixels: points.worstPairPixels,
        modelScore: scoreFor(input, points.pose),
      },
      warnings,
      tier: warnings.length ? 1 : 0,
      score: scoreFor(input, points.pose),
    })
  }

  if (input.matched) {
    const { camera, checks } = input.matched
    const worst = camera.heldOut.length ? Math.max(...camera.heldOut.map((g) => g.metres)) : null
    const pose = {
      lng: camera.lng,
      lat: camera.lat,
      altitudeMeters: camera.altitudeMeters,
      bearing: camera.bearing,
      pitch: camera.pitch,
      roll: camera.roll,
      hfov: camera.hfov,
    }
    rows.push({
      id: 'matched',
      kind: 'matched',
      label: 'Matched camera',
      pose,
      evidence: {
        settled: camera.trusted ?? undefined,
        heldOutMeters: worst,
        modelScore: scoreFor(input, pose),
      },
      warnings: [...checks],
      tier: checks.length || camera.trusted === false ? 1 : 0,
      score: scoreFor(input, pose),
    })
  }

  for (const proposal of input.flightProposals ?? []) {
    const { pose, basis, matches, controls, medianPx, p90Px } = proposal
    rows.push({
      id: `flight:${proposal.referenceId}`,
      kind: 'matched',
      label: `Flight match from ${proposal.referenceName}`,
      pose,
      overlap: { basis, matches, controls, medianPx, p90Px },
      evidence: {
        settled: false,
        neighbourId: proposal.referenceId,
        modelScore: scoreFor(input, pose),
        overlapBasis: basis,
        overlapP90Px: p90Px,
        overlapMatches: matches,
      },
      warnings: [
        basis === 'terrain'
          ? 'Check shared landmarks before accepting this camera'
          : 'Orientation from the two photos. GPS position still needs a map check',
      ],
      tier: 1,
      score: scoreFor(input, pose),
    })
  }

  // Agreement between candidates: two frames 3 s apart agreeing is evidence neither has alone.
  const neighbourRow = rows.find((row) => row.kind === 'neighbour' && !row.id.startsWith('narrow:'))
  if (neighbourRow)
    for (const row of rows) {
      if (
        row === neighbourRow ||
        row.kind === 'phone' ||
        row.kind === 'runner-up' ||
        row.overlap ||
        row.id.startsWith('narrow:')
      )
        continue
      const off = gap(row.pose.bearing, neighbourRow.pose.bearing)
      row.evidence = { ...row.evidence, neighbourId: input.neighbour?.id ?? null, neighbourAgreesDegrees: off }
      if (off > NEIGHBOUR_AGREE_DEGREES) row.warnings.push(`disagrees with ${input.neighbour?.label} by ${deg(off)}`)
      // The neighbour's own row carries its gap to the skyline's winner.
      if (row.kind === 'winner') neighbourRow.evidence = { ...neighbourRow.evidence, neighbourAgreesDegrees: off }
    }

  // Measured by the narrow search, the winner's agreement with the neighbour is the fit's own, not a heading compared.
  if (narrow && narrowIsWinner && winnerRow)
    winnerRow.evidence = {
      ...winnerRow.evidence,
      neighbourId: narrow.neighbourId,
      neighbourAgreesDegrees: narrow.agreesDegrees,
    }

  return rows
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        (b.score ?? -Infinity) - (a.score ?? -Infinity) ||
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
    )
    .map(({ tier: _tier, score: _score, ...row }) => row)
}

/**
 * The narrow search's agreement with the neighbour's camera, when it is evidence (`NARROW_AGREE_DEGREES`,
 * `NARROW_AGREE_SHARE`); null otherwise.
 */
export function narrowAgreement(
  narrow: Pick<WideSearchResult, 'bearing' | 'fit'> | null,
  neighbourBearing: number,
): { agreesDegrees: number; agreeShare: number } | null {
  if (!narrow) return null
  const agreesDegrees = gap(narrow.bearing, neighbourBearing)
  if (agreesDegrees > NARROW_AGREE_DEGREES || narrow.fit.agreement < NARROW_AGREE_SHARE) return null
  return { agreesDegrees, agreeShare: narrow.fit.agreement }
}

/** Where a photo stands in the automatic queue. */
export type PhotoQueueStatus = 'unsearched' | 'queued' | 'searching' | 'options' | 'checked' | 'accepted' | 'failed'

/** Why a photo's camera could not be found, or wants the reviewer before it can be. */
export type PhotoFailureReason =
  | 'not-settled'
  | 'no-skyline'
  | 'outside-terrain'
  | 'cropped-lens'
  | 'phone-heading-only'
  | 'disagrees-with-neighbour'

export const PHOTO_QUEUE_STATUSES: readonly PhotoQueueStatus[] = [
  'unsearched',
  'queued',
  'searching',
  'options',
  'checked',
  'accepted',
  'failed',
]

export const PHOTO_STATUS_TEXT: Record<PhotoQueueStatus, string> = {
  unsearched: 'Not searched yet',
  queued: 'Waiting its turn',
  searching: 'Searching for the camera',
  options: 'Options ready: choose a camera',
  checked: 'Looked at: accept it or choose another camera',
  accepted: 'Accepted',
  failed: 'Camera not found',
}

export const PHOTO_FAILURE_TEXT: Record<PhotoFailureReason, string> = {
  'not-settled': 'Not settled: another heading fits about as well. Compare both before choosing.',
  'no-skyline': 'No skyline to read: the photo shows too little sky over the ridges. Pair points instead.',
  'outside-terrain': 'Outside the terrain: the photo was taken where no elevation data loaded.',
  'cropped-lens': 'Cropped: the photo is not the size the camera took, so its lens is unknown.',
  'phone-heading-only': 'Only the phone’s heading, which from an aircraft can be far out.',
  'disagrees-with-neighbour': 'Disagrees with the frame taken just before or after it.',
}

/** What goes with a removed photo, said under the question wherever a photo is removed. */
export const PHOTO_REMOVE_DETAIL =
  'Its field record and its original go from this browser. A viewpoint made from it stays, without the link.'

/** What a photo's dot says: nothing yet, in hand, the reviewer's to confirm, wanting the reviewer's help, or done. */
export type PhotoStripTone = 'idle' | 'waiting' | 'working' | 'ready' | 'help' | 'done' | 'failed'

/**
 * A photo in the strip: the dot's tone, a word or two under its picture, and the sentence that says what to do next.
 * A status alone does not sort a set: every searched photo is *options*, but one whose skyline settled only wants a
 * look, and one where two headings fit wants a landmark.
 */
export function photoStripState(entry: Pick<PhotoQueueEntry, 'status' | 'reasons'> | undefined): {
  tone: PhotoStripTone
  short: string
  text: string
} {
  const status = entry?.status ?? 'queued'
  const has = (reason: PhotoFailureReason) => !!entry?.reasons.includes(reason)
  switch (status) {
    case 'unsearched':
      return { tone: 'idle', short: 'Not searched', text: PHOTO_STATUS_TEXT.unsearched }
    case 'queued':
      return { tone: 'waiting', short: 'Waiting', text: PHOTO_STATUS_TEXT.queued }
    case 'searching':
      return { tone: 'working', short: 'Searching', text: PHOTO_STATUS_TEXT.searching }
    case 'accepted':
      return { tone: 'done', short: 'Accepted', text: PHOTO_STATUS_TEXT.accepted }
    case 'failed':
      if (has('outside-terrain'))
        return { tone: 'failed', short: 'No terrain', text: PHOTO_FAILURE_TEXT['outside-terrain'] }
      if (has('no-skyline'))
        return {
          tone: 'failed',
          short: 'No skyline',
          text: 'No skyline to search by: pair a landmark in the photo and on the plan to get a camera.',
        }
      return { tone: 'failed', short: 'Not found', text: PHOTO_STATUS_TEXT.failed }
    // The check images are drawn whenever a photo's camera is on screen, so *checked* says only that it was looked
    // at: what the photo needs is still read from why its camera is in doubt.
    case 'checked':
    case 'options':
      if (has('disagrees-with-neighbour'))
        return {
          tone: 'help',
          short: 'Disagrees with a neighbour',
          text: 'The camera found disagrees with the frame taken just before or after it: compare both, or pair a landmark.',
        }
      if (has('not-settled'))
        return {
          tone: 'help',
          short: 'Needs a landmark',
          text: 'More than one heading fits the skyline about as well: pair one landmark to settle it, or compare the options.',
        }
      if (has('phone-heading-only'))
        return {
          tone: 'help',
          short: 'Needs a landmark',
          text: 'Only the phone’s heading so far, which from an aircraft can be far out: pair a landmark.',
        }
      if (has('cropped-lens'))
        return { tone: 'help', short: 'Cropped: check the lens', text: PHOTO_FAILURE_TEXT['cropped-lens'] }
      return {
        tone: 'ready',
        short: 'Check it',
        text: 'A camera was found: check it against the photo, then accept it.',
      }
  }
}

/** A failure reason in words; the neighbour's name when there is one. */
export function photoFailureText(reason: PhotoFailureReason, neighbour?: string | null): string {
  if (reason === 'disagrees-with-neighbour' && neighbour)
    return `Disagrees with ${neighbour}, taken just before or after it.`
  return PHOTO_FAILURE_TEXT[reason]
}

/** One photo's place in the queue. */
export type PhotoQueueEntry = {
  recordId: string
  status: PhotoQueueStatus
  reasons: PhotoFailureReason[]
  /** Notes that never block: *far from the road*, a stale GPS time. */
  notes: string[]
}

export type PhotoQueueState = {
  entries: PhotoQueueEntry[]
  /** The record being worked on now, or null while idle. */
  running: string | null
  cancelled: boolean
}

/**
 * The reasons a photo wants the reviewer, from what the queue found. Each is something the reviewer can act on; far
 * from the road is not one of them (a note), since an aircraft photo is expected to be.
 */
export function photoReasons(found: {
  lens?: { cropped: boolean } | null
  /** False when the skyline reader found too few columns. */
  skyline?: boolean
  /** False when no terrain loaded under the camera. */
  terrain?: boolean
  search?: Pick<WideSearchResult, 'trustworthy' | 'ambiguous'> | null
  /** Options other than the phone's own heading. */
  otherOptions?: number
  /** Heading gap to an accepted burst neighbour's camera, degrees. */
  neighbourGap?: number | null
}): PhotoFailureReason[] {
  const reasons: PhotoFailureReason[] = []
  if (found.terrain === false) reasons.push('outside-terrain')
  if (found.skyline === false) reasons.push('no-skyline')
  if (found.lens?.cropped) reasons.push('cropped-lens')
  if (found.search && !found.search.trustworthy) reasons.push('not-settled')
  if (found.otherOptions === 0) reasons.push('phone-heading-only')
  if (found.neighbourGap !== null && found.neighbourGap !== undefined && found.neighbourGap > NEIGHBOUR_AGREE_DEGREES)
    reasons.push('disagrees-with-neighbour')
  return reasons
}
