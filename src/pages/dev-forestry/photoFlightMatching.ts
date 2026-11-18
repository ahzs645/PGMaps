/** Shortlist nearby accepted cameras. Actual overlap and terrain holdouts decide which camera to offer. */
import { acceptanceLapsed, type AcceptancePose, type PhotoAcceptance } from './photoAcceptance'
import { instantOf, metresBetween } from './photoFlight'

export type FlightMatchFrame = {
  id: string
  name: string
  flightId: string | null
  takenAtUtc: string | null
  pose: AcceptancePose | null
  acceptance: PhotoAcceptance | null
  eyeHeightMeters: number
}

export type FlightMatchPair = {
  referenceId: string
  targetId: string
  seconds: number
  meters: number
}

export type FlightCameraProposal = {
  referenceId: string
  referenceName: string
  acceptedAt: string
  referencePose: AcceptancePose
  referenceEyeHeight: number
  pose: AcceptancePose
  basis: 'terrain' | 'image'
  matches: number
  controls: number
  medianPx: number
  p90Px: number
}

export const flightAnchor = (frame: Pick<FlightMatchFrame, 'acceptance' | 'pose'>) =>
  frame.acceptance && frame.pose && !acceptanceLapsed(frame.acceptance, frame.pose) ? frame.acceptance : null

const MAX_REFERENCE_SECONDS = 90
const MAX_REFERENCE_METERS = 1500
const MAX_REFERENCES = 6

export function planFlightMatches(frames: readonly FlightMatchFrame[], flightId: string) {
  const group = frames.filter((frame) => frame.flightId === flightId)
  const anchors = group.filter(flightAnchor)
  const targets = group.filter((frame) => !flightAnchor(frame))
  const pairs = targets.flatMap((target) => {
    const recorded = instantOf(target.takenAtUtc)
    if (!target.pose || recorded === null) return []
    const place = target.pose
    return anchors
      .flatMap((reference): FlightMatchPair[] => {
        const accepted = flightAnchor(reference)!
        const time = instantOf(reference.takenAtUtc)
        if (time === null) return []
        const seconds = Math.abs(recorded - time) / 1000
        const meters = metresBetween(place, accepted.pose)
        return seconds <= MAX_REFERENCE_SECONDS && meters <= MAX_REFERENCE_METERS
          ? [{ referenceId: reference.id, targetId: target.id, seconds, meters }]
          : []
      })
      .sort((a, b) => a.seconds - b.seconds || a.meters - b.meters)
      .slice(0, MAX_REFERENCES)
  })
  return { anchors, targets, pairs }
}

/** Use held-out errors first. Closeness in time only controls which pairs are attempted. */
export function compareFlightProposals(a: FlightCameraProposal, b: FlightCameraProposal): number {
  return (
    Number(b.basis === 'terrain') - Number(a.basis === 'terrain') ||
    a.p90Px - b.p90Px ||
    a.medianPx - b.medianPx ||
    b.controls - a.controls ||
    b.matches - a.matches
  )
}

export type FlightMatchProgress = {
  flightId: string
  phase: 'matching' | 'done' | 'cancelled' | 'failed'
  total: number
  attempted: number
  overlapping: number
  failed: number
  targetName?: string
  message?: string
}

export function currentFlightProposal(
  proposal: FlightCameraProposal,
  reference: FlightMatchFrame | undefined,
  flightId: string | null,
): boolean {
  if (!reference || reference.flightId !== flightId) return false
  const accepted = flightAnchor(reference)
  return (
    !!accepted &&
    accepted.acceptedAt === proposal.acceptedAt &&
    !acceptanceLapsed(accepted, proposal.referencePose) &&
    (accepted.pose.altitudeMeters !== null || reference.eyeHeightMeters === proposal.referenceEyeHeight)
  )
}
