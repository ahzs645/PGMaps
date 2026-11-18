/**
 * A reviewer's acceptance of an own photo's camera, stored on the photo's field record (doc proposal
 * `forestry-visual-quality-own-photo-redesign-2026-11-17.md`, §2.6). Nothing before it is a verdict: the skyline
 * search, the point solve and a matched file each say what the camera rests on, and the reviewer, having looked at the
 * check images drawn for that exact camera, says it is right.
 *
 * The record keeps who (typed initials, never the preparer profile printed directly), when, how the camera was found,
 * the pose, and the evidence the reviewer saw. Moving the pose afterwards lapses it (`acceptanceLapsed`), and the
 * page says so rather than carrying an acceptance over to a camera nobody looked at.
 *
 * The gate (`acceptGate`) follows Smapshot's validation: an automatic residual test first, then a person's check.
 *
 * Free of DOM and network access: records are validated by hand, with no schema library.
 */

const RAD = Math.PI / 180

export type PhotoCameraMethod = 'skyline' | 'points' | 'matched' | 'neighbour' | 'phone' | 'typed'

export const PHOTO_CAMERA_METHODS: readonly PhotoCameraMethod[] = [
  'skyline',
  'points',
  'matched',
  'neighbour',
  'phone',
  'typed',
]

export type PhotoAcceptance = {
  /** Typed initials. */
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
  }
  /** Required when `evidence.settled === false`. */
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

export interface AcceptGateInput {
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
 * Whether *Accept* may be pressed, and the one thing to do first when not: draw the checks for this camera, fix a
 * point solve whose held-out pair misses, write why a camera that is not settled is right, and type initials.
 */
export function acceptGate(input: AcceptGateInput): AcceptGateResult {
  if (!input.checkedPose) return { ok: false, reason: 'Draw the checks over the photo first, then compare them.' }
  if (!sameCamera(input.checkedPose, input.pose))
    return { ok: false, reason: 'The camera has changed since the checks were drawn: draw them again.' }
  if (input.method === 'points') {
    const worst = input.evidence.worstPairPixels
    if (worst === null || worst === undefined || !Number.isFinite(worst))
      return {
        ok: false,
        reason: 'Pair one more point: with no pair held out, the solve cannot be checked.',
      }
    const limit = pointsHeldOutLimit(input.photoWidth)
    if (worst > limit)
      return {
        ok: false,
        reason: `A held-out pair lands ${Math.round(worst)} px off (over ${Math.round(limit)} px): check or remove it.`,
      }
  }
  if (input.evidence.settled === false && !input.note.trim())
    return { ok: false, reason: 'The fit is not settled: write why this camera is the right one.' }
  if (!input.initials.trim()) return { ok: false, reason: 'Type your initials.' }
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
    evidence: input.evidence,
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
 * Reads a stored acceptance; null when it is not one. Who, when, how and the pose must all be there: an acceptance
 * missing any of them is no acceptance. One of a fit that was not settled must carry its note.
 */
export function parsePhotoAcceptance(raw: unknown): PhotoAcceptance | null {
  const a = plain(raw)
  if (!a) return null
  const acceptedBy = typeof a.acceptedBy === 'string' ? a.acceptedBy.trim() : ''
  if (!acceptedBy || acceptedBy.length > MAX_INITIALS) return null
  if (typeof a.acceptedAt !== 'string' || !Number.isFinite(Date.parse(a.acceptedAt))) return null
  if (typeof a.method !== 'string' || !PHOTO_CAMERA_METHODS.includes(a.method as PhotoCameraMethod)) return null
  const pose = parsePose(a.pose)
  if (!pose) return null
  const evidence = parseEvidence(a.evidence)
  const note = typeof a.note === 'string' ? a.note.slice(0, MAX_NOTE) : ''
  if (evidence.settled === false && !note.trim()) return null
  return { acceptedBy, acceptedAt: a.acceptedAt, method: a.method as PhotoCameraMethod, pose, evidence, note }
}
