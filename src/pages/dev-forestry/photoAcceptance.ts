/**
 * A reviewer's acceptance of an own photo's camera, stored on the photo's field record (doc proposal
 * `forestry-visual-quality-own-photo-redesign-2026-11-17.md`, §2.6). Nothing before it is a verdict: the skyline
 * search, the point solve and a matched file each say what the camera rests on, and the reviewer's one click says it
 * is the camera to use.
 *
 * The record keeps when, how the camera was found, the pose, the evidence behind it and whether the check images had
 * been drawn for that exact camera (`evidence.checksDrawn`). Initials (typed, never the preparer profile printed
 * directly) and a note are the reviewer's to add or leave out. Moving the pose afterwards lapses it
 * (`acceptanceLapsed`), and the page says so rather than carrying an acceptance over to a camera nobody chose.
 *
 * The gate (`acceptGate`) refuses a placeholder direction and a point solve whose held-out pair misses.
 * Checks, initials and a note were once required first; a forced
 * form before every use of a photo was not how a reviewer works through a flight.
 *
 * Free of DOM and network access: records are validated by hand, with no schema library.
 */

import type { PoseSource } from './exifPose'

const RAD = Math.PI / 180

export type PhotoCameraMethod = 'skyline' | 'landmark' | 'points' | 'matched' | 'neighbour' | 'phone' | 'typed'

export const PHOTO_CAMERA_METHODS: readonly PhotoCameraMethod[] = [
  'skyline',
  'landmark',
  'points',
  'matched',
  'neighbour',
  'phone',
  'typed',
]

export type PhotoAcceptance = {
  /** Typed initials; empty when the reviewer added none. */
  acceptedBy: string
  /** ISO time. */
  acceptedAt: string
  method: PhotoCameraMethod
  pose: {
    lng: number
    lat: number
    altitudeMeters: number | null
    bearing: number
    pitch: number
    roll: number
    hfov: number
  }
  evidence: {
    skyColumns?: number
    skySpanShare?: number
    agreeShare?: number
    settled?: boolean
    runnerUpBearing?: number | null
    modelScore?: number | null
    runnerUpModelScore?: number | null
    sunNote?: string | null
    heldOutMeters?: number | null
    worstPairPixels?: number | null
    overlapBasis?: 'terrain' | 'image'
    overlapP90Px?: number
    overlapMatches?: number
    neighbourId?: string | null
    neighbourAgreesDegrees?: number | null
    /** Whether the check images had been drawn for this exact camera when it was accepted. */
    checksDrawn?: boolean
    /** The heading had an actual source or was explicitly set, rather than inherited as preview geometry. */
    directionKnown?: true
  }
  /** The reviewer's own words on why this camera, when they wrote any. */
  note: string
}

export type AcceptancePose = PhotoAcceptance['pose']
export type AcceptanceEvidence = PhotoAcceptance['evidence']

/** Angles (heading, pitch, roll, lens) within this many degrees are the same camera: `ownPhotoSteps`' tolerance. */
export const ACCEPTANCE_ANGLE_DEGREES = 0.5
/** Positions within this many metres across the ground are the same camera: inside a phone's GPS scatter. */
export const ACCEPTANCE_POSITION_METERS = 5
/** Altitudes within this many metres are the same camera. */
export const ACCEPTANCE_ALTITUDE_METERS = 1

/**
 * The worst held-out pair a point-solved camera may have, in pixels of a frame `POINTS_REFERENCE_WIDTH` wide. The
 * photo-matching bench's held-out groups landed 2–9 px off at that width on right cameras (`docs/research/
 * landscape-photo-matching-2026-11-14.md`, stage 4), with 2 px of placing error per click (`controlPose.ts`). A pair
 * four times the worst of those is a mis-paired spot or a wrong camera, not a person's placing: refuse it, as
 * Smapshot refuses validation over its residual.
 */
export const POINTS_MAX_HELD_OUT_PX = 40
/** The frame width `POINTS_MAX_HELD_OUT_PX` is measured at: the bench's and the skyline reader's working width. */
export const POINTS_REFERENCE_WIDTH = 1050

/** The longest initials kept; anything longer is a name, which the record does not want. */
const MAX_INITIALS = 12
const MAX_NOTE = 2000
const MAX_TEXT = 300

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const plain = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
const angleGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)
/** A heading in [0, 360), left exactly as given when already there (a round trip must not move it). */
export const wrapHeading = (degrees: number) =>
  degrees >= 0 && degrees < 360 ? degrees : ((degrees % 360) + 360) % 360

/** Metres across the ground between two cameras (equirectangular: they are metres apart, not kilometres). */
function groundGap(a: { lng: number; lat: number }, b: { lng: number; lat: number }): number {
  const east = (b.lng - a.lng) * 111320 * Math.cos(((a.lat + b.lat) / 2) * RAD)
  const north = (b.lat - a.lat) * 110574
  return Math.hypot(east, north)
}

/** Whether `pose` is no longer the camera that was accepted: 0.5° in any angle, 5 m across or 1 m up. */
export function acceptanceLapsed(a: PhotoAcceptance, pose: AcceptancePose): boolean {
  return !sameCamera(a.pose, pose)
}

/** Two poses are the same camera within the acceptance tolerances. */
export function sameCamera(a: AcceptancePose, b: AcceptancePose): boolean {
  if (angleGap(a.bearing, b.bearing) > ACCEPTANCE_ANGLE_DEGREES) return false
  if (Math.abs(a.pitch - b.pitch) > ACCEPTANCE_ANGLE_DEGREES) return false
  // Roll compared round the circle: −179.9° and 180° are one camera.
  if (angleGap(a.roll, b.roll) > ACCEPTANCE_ANGLE_DEGREES) return false
  if (Math.abs(a.hfov - b.hfov) > ACCEPTANCE_ANGLE_DEGREES) return false
  if (groundGap(a, b) > ACCEPTANCE_POSITION_METERS) return false
  // An eye at an altitude and one standing over the ground are different cameras.
  if ((a.altitudeMeters === null) !== (b.altitudeMeters === null)) return false
  if (
    a.altitudeMeters !== null &&
    b.altitudeMeters !== null &&
    Math.abs(a.altitudeMeters - b.altitudeMeters) > ACCEPTANCE_ALTITUDE_METERS
  )
    return false
  return true
}

/** Historic typed 0° could have been real north or an unlabelled preview default. Retain it, but ask before reuse. */
export function legacyHeadingNeedsReview(acceptance: PhotoAcceptance | null | undefined): boolean {
  return (
    !!acceptance &&
    acceptance.method === 'typed' &&
    acceptance.pose.bearing === 0 &&
    acceptance.evidence.directionKnown !== true
  )
}

export function photoHeadingIssue(source: PoseSource, acceptance?: PhotoAcceptance | null): string | null {
  if (source === 'default') return 'Direction unknown. Set the heading in Adjust or pair a landmark.'
  if (source === 'texture')
    return 'This direction is a texture-match starting value. Confirm it in Adjust or pair a landmark.'
  if (source === 'road-view')
    return 'This direction is a road-view starting value. Confirm it in Adjust or pair a landmark.'
  if (source === 'record' && legacyHeadingNeedsReview(acceptance))
    return 'This older record lists 0° without saying how it was set. Confirm the direction in Adjust.'
  return null
}

export interface AcceptGateInput {
  /** The current direction's provenance. Pass it before reducing it to a camera method. */
  headingSource?: PoseSource
  previous?: PhotoAcceptance | null
  /** The camera as it stands. */
  pose: AcceptancePose
  /** The camera the check images (skyline and layers on the photo) were last drawn for; null when never drawn. */
  checkedPose: AcceptancePose | null
  method: PhotoCameraMethod
  evidence: AcceptanceEvidence
  note: string
  initials: string
  /** The photo's width in the pixels `evidence.worstPairPixels` is measured in; the reference width when absent. */
  photoWidth?: number
}

export type AcceptGateResult = { ok: true } | { ok: false; reason: string }

/** The largest held-out pair a points camera may have, in the photo's own pixels. */
export function pointsHeldOutLimit(photoWidth?: number): number {
  return POINTS_MAX_HELD_OUT_PX * (photoWidth && photoWidth > 0 ? photoWidth / POINTS_REFERENCE_WIDTH : 1)
}

/**
 * Whether *Accept* may be pressed. A placeholder direction and a measured held-out failure cannot be accepted.
 * Initials, check images and notes are still optional.
 */
export function acceptGate(input: AcceptGateInput): AcceptGateResult {
  const direction = input.headingSource ? photoHeadingIssue(input.headingSource, input.previous) : null
  if (direction) return { ok: false, reason: direction }
  if (input.method === 'points') {
    const worst = input.evidence.worstPairPixels
    const limit = pointsHeldOutLimit(input.photoWidth)
    if (worst !== null && worst !== undefined && Number.isFinite(worst) && worst > limit)
      return {
        ok: false,
        reason: `A held-out pair lands ${Math.round(worst)} px off (over ${Math.round(limit)} px): check or remove it.`,
      }
  }
  if (input.initials.trim().length > MAX_INITIALS) return { ok: false, reason: 'Initials only, please.' }
  return { ok: true }
}

/** The acceptance record for a camera that passes the gate, or the gate's reason. */
export function makePhotoAcceptance(
  input: AcceptGateInput,
  now: Date,
): { ok: true; acceptance: PhotoAcceptance } | { ok: false; reason: string } {
  const gate = acceptGate(input)
  if (!gate.ok) return gate
  const acceptance = parsePhotoAcceptance({
    acceptedBy: input.initials.trim(),
    acceptedAt: now.toISOString(),
    method: input.method,
    pose: input.pose,
    evidence: {
      ...input.evidence,
      checksDrawn: !!input.checkedPose && sameCamera(input.checkedPose, input.pose),
      ...(input.headingSource ? { directionKnown: true } : {}),
    },
    note: input.note.trim(),
  })
  return acceptance ? { ok: true, acceptance } : { ok: false, reason: 'The camera’s values are out of range.' }
}

function parsePose(raw: unknown): AcceptancePose | null {
  const p = plain(raw)
  if (!p) return null
  const { lng, lat, bearing, pitch, roll, hfov } = p
  if (!finite(lng) || !finite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) return null
  if (!finite(bearing) || !finite(pitch) || !finite(roll) || !finite(hfov)) return null
  if (Math.abs(pitch) > 90 || Math.abs(roll) > 180 || hfov < 3 || hfov > 150) return null
  let altitudeMeters: number | null = null
  if (p.altitudeMeters !== null && p.altitudeMeters !== undefined) {
    // The same range a matched camera and a surveyed eye accept.
    if (!finite(p.altitudeMeters) || p.altitudeMeters < -500 || p.altitudeMeters > 9000) return null
    altitudeMeters = p.altitudeMeters
  }
  return { lng, lat, altitudeMeters, bearing: wrapHeading(bearing), pitch, roll, hfov }
}

/** Evidence fields are each kept only when well formed: a bad one is dropped, never the acceptance with it. */
function parseEvidence(raw: unknown): AcceptanceEvidence {
  const e = plain(raw) ?? {}
  const out: AcceptanceEvidence = {}
  const count = (key: 'skyColumns' | 'overlapMatches') => {
    const v = e[key]
    if (finite(v) && v >= 0) out[key] = Math.round(v)
  }
  const share = (key: 'skySpanShare' | 'agreeShare') => {
    const v = e[key]
    if (finite(v) && v >= 0 && v <= 1) out[key] = v
  }
  const maybeNumber = (
    key:
      | 'runnerUpBearing'
      | 'modelScore'
      | 'runnerUpModelScore'
      | 'heldOutMeters'
      | 'worstPairPixels'
      | 'neighbourAgreesDegrees',
  ) => {
    const v = e[key]
    if (v === null) out[key] = null
    else if (finite(v)) out[key] = v
  }
  const maybeText = (key: 'sunNote' | 'neighbourId') => {
    const v = e[key]
    if (v === null) out[key] = null
    else if (typeof v === 'string') out[key] = v.slice(0, MAX_TEXT)
  }
  count('skyColumns')
  count('overlapMatches')
  if (e.overlapBasis === 'terrain' || e.overlapBasis === 'image') out.overlapBasis = e.overlapBasis
  if (finite(e.overlapP90Px) && e.overlapP90Px >= 0) out.overlapP90Px = e.overlapP90Px
  share('skySpanShare')
  share('agreeShare')
  if (typeof e.settled === 'boolean') out.settled = e.settled
  if (typeof e.checksDrawn === 'boolean') out.checksDrawn = e.checksDrawn
  if (e.directionKnown === true) out.directionKnown = true
  maybeNumber('runnerUpBearing')
  maybeNumber('modelScore')
  maybeNumber('runnerUpModelScore')
  maybeText('sunNote')
  maybeNumber('heldOutMeters')
  maybeNumber('worstPairPixels')
  maybeText('neighbourId')
  maybeNumber('neighbourAgreesDegrees')
  return out
}

/**
 * Reads a stored acceptance; null when it is not one. When, how and the pose must all be there: an acceptance missing
 * any of them is no acceptance. Initials and a note are kept when given.
 */
export function parsePhotoAcceptance(raw: unknown): PhotoAcceptance | null {
  const a = plain(raw)
  if (!a) return null
  const acceptedBy = typeof a.acceptedBy === 'string' ? a.acceptedBy.trim() : ''
  if (acceptedBy.length > MAX_INITIALS) return null
  if (typeof a.acceptedAt !== 'string' || !Number.isFinite(Date.parse(a.acceptedAt))) return null
  if (typeof a.method !== 'string' || !PHOTO_CAMERA_METHODS.includes(a.method as PhotoCameraMethod)) return null
  const pose = parsePose(a.pose)
  if (!pose) return null
  const evidence = parseEvidence(a.evidence)
  const note = typeof a.note === 'string' ? a.note.slice(0, MAX_NOTE) : ''
  return { acceptedBy, acceptedAt: a.acceptedAt, method: a.method as PhotoCameraMethod, pose, evidence, note }
}
