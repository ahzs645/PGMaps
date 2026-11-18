import { describe, expect, it } from 'vitest'
import type { AcceptancePose, PhotoAcceptance } from './photoAcceptance'
import {
  compareFlightProposals,
  currentFlightProposal,
  planFlightMatches,
  type FlightCameraProposal,
  type FlightMatchFrame,
} from './photoFlightMatching'

const pose: AcceptancePose = { lng: -123, lat: 54, altitudeMeters: 1200, bearing: 15, pitch: -25, roll: 0, hfov: 50 }
const accepted: PhotoAcceptance = {
  acceptedAt: '2026-01-01T00:00:00Z',
  acceptedBy: 'QA',
  method: 'matched',
  pose,
  evidence: {},
  note: '',
}
const frame = (id: string, seconds: number, props?: Partial<FlightMatchFrame>): FlightMatchFrame => ({
  id,
  name: id,
  flightId: 'one',
  takenAtUtc: new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString(),
  acceptance: accepted,
  eyeHeightMeters: 1.7,
  pose,
  ...props,
})

describe('flight camera planning', () => {
  it('tries several nearby anchors in capture order without linking other flights or lapsed acceptances', () => {
    const list = [
      frame('target', 12, { acceptance: null }),
      frame('closest', 15),
      frame('next', 23),
      frame('moved', 13, { pose: { ...pose, bearing: 37 } }),
      frame('too far', 15, { pose: { ...pose, lat: 55 }, acceptance: { ...accepted, pose: { ...pose, lat: 55 } } }),
      frame('other flight', 12, { flightId: 'two' }),
      frame('too late', 110),
    ]
    const plan = planFlightMatches(list, 'one')
    expect(plan.pairs.filter((pair) => pair.targetId === 'target').map((pair) => pair.referenceId)).toEqual([
      'closest',
      'next',
    ])
    expect(plan.anchors.some((entry) => entry.id === 'moved')).toBe(false)
  })

  it('prefers a terrain check and withdraws suggestions when their reference changes', () => {
    const proposal: FlightCameraProposal = {
      pose,
      referencePose: pose,
      referenceEyeHeight: 1.7,
      referenceId: 'a',
      referenceName: 'A',
      acceptedAt: accepted.acceptedAt,
      basis: 'image',
      p90Px: 4,
      medianPx: 2,
      controls: 50,
      matches: 50,
    }
    expect(compareFlightProposals(proposal, { ...proposal, basis: 'terrain', p90Px: 14 })).toBeGreaterThan(0)
    expect(currentFlightProposal(proposal, frame('a', 0), 'one')).toBe(true)
    expect(currentFlightProposal(proposal, frame('a', 0, { pose: { ...pose, roll: 12 } }), 'one')).toBe(false)
    expect(currentFlightProposal(proposal, frame('a', 0), 'two')).toBe(false)
  })
})
