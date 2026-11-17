import { describe, expect, it } from 'vitest'

import {
  acceptGate,
  acceptanceLapsed,
  makePhotoAcceptance,
  parsePhotoAcceptance,
  pointsHeldOutLimit,
  POINTS_MAX_HELD_OUT_PX,
  type AcceptGateInput,
  type AcceptancePose,
  type PhotoAcceptance,
} from './photoAcceptance'

// A made-up camera in the air.
const pose: AcceptancePose = {
  lng: -123.1,
  lat: 54.2,
  altitudeMeters: 1250,
  bearing: 212.4,
  pitch: -6.5,
  roll: 1.25,
  hfov: 65.5,
}

const accepted: PhotoAcceptance = {
  acceptedBy: 'AJ',
  acceptedAt: '2026-11-17T18:00:00.000Z',
  method: 'skyline',
  pose,
  evidence: { skyColumns: 140, skySpanShare: 0.8, agreeShare: 0.92, settled: true, runnerUpBearing: 61 },
  note: '',
}

const gate: AcceptGateInput = {
  pose,
  checkedPose: pose,
  method: 'skyline',
  evidence: { settled: true },
  note: '',
  initials: 'AJ',
}

describe('acceptanceLapsed', () => {
  it('holds while the camera stays within half a degree, 5 m and 1 m up', () => {
    expect(acceptanceLapsed(accepted, pose)).toBe(false)
    expect(acceptanceLapsed(accepted, { ...pose, bearing: 212.8, pitch: -6.2, hfov: 65.1 })).toBe(false)
    // About 3.6 m east.
    expect(acceptanceLapsed(accepted, { ...pose, lng: pose.lng + 0.000055 })).toBe(false)
    expect(acceptanceLapsed(accepted, { ...pose, altitudeMeters: 1250.8 })).toBe(false)
  })

  it('lapses when any part of the camera moves past its tolerance', () => {
    expect(acceptanceLapsed(accepted, { ...pose, bearing: 213 })).toBe(true)
    expect(acceptanceLapsed(accepted, { ...pose, roll: 0.5 })).toBe(true)
    expect(acceptanceLapsed(accepted, { ...pose, hfov: 52 })).toBe(true)
    expect(acceptanceLapsed(accepted, { ...pose, lat: pose.lat + 0.0001 })).toBe(true)
    expect(acceptanceLapsed(accepted, { ...pose, altitudeMeters: 1252 })).toBe(true)
    expect(acceptanceLapsed(accepted, { ...pose, altitudeMeters: null })).toBe(true)
  })

  it('reads headings across north as close', () => {
    const north = { ...accepted, pose: { ...pose, bearing: 359.9 } }
    expect(acceptanceLapsed(north, { ...pose, bearing: 0.2 })).toBe(false)
  })

  it('reads rolls across ±180° as close', () => {
    const over = { ...accepted, pose: { ...pose, roll: 179.9 } }
    expect(acceptanceLapsed(over, { ...pose, roll: -179.8 })).toBe(false)
  })
})

describe('acceptGate', () => {
  it('passes a checked, settled camera with initials', () => {
    expect(acceptGate(gate)).toEqual({ ok: true })
  })

  it('wants the checks drawn for this exact camera', () => {
    expect(acceptGate({ ...gate, checkedPose: null })).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/Draw the checks/),
    })
    expect(acceptGate({ ...gate, checkedPose: { ...pose, bearing: pose.bearing - 1 } })).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/changed since/),
    })
  })

  it('refuses a point solve whose worst held-out pair misses, scaled to the photo’s width', () => {
    const points = { ...gate, method: 'points' as const }
    expect(acceptGate({ ...points, evidence: { worstPairPixels: 12 } })).toEqual({ ok: true })
    expect(acceptGate({ ...points, evidence: { worstPairPixels: POINTS_MAX_HELD_OUT_PX + 1 } }).ok).toBe(false)
    // At 4,284 px wide the limit is about 163 px.
    expect(pointsHeldOutLimit(4284)).toBeCloseTo(163.2, 1)
    expect(acceptGate({ ...points, photoWidth: 4284, evidence: { worstPairPixels: 120 } })).toEqual({ ok: true })
    expect(acceptGate({ ...points, evidence: { worstPairPixels: null } })).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/Pair one more point/),
    })
  })

  it('wants a note for a fit that is not settled', () => {
    const unsettled = { ...gate, evidence: { settled: false } }
    expect(acceptGate(unsettled)).toMatchObject({ ok: false, reason: expect.stringMatching(/not settled/) })
    expect(acceptGate({ ...unsettled, note: 'Runner-up puts the lake on a ridge.' })).toEqual({ ok: true })
  })

  it('wants initials, not a name', () => {
    expect(acceptGate({ ...gate, initials: '  ' })).toMatchObject({ ok: false, reason: 'Type your initials.' })
    expect(acceptGate({ ...gate, initials: 'A reviewer with a long name' }).ok).toBe(false)
  })
})

describe('makePhotoAcceptance', () => {
  it('records who, when, how and the evidence once the gate passes', () => {
    const made = makePhotoAcceptance(
      { ...gate, initials: ' AJ ', evidence: { skyColumns: 140, settled: true, modelScore: 0.3 } },
      new Date('2026-11-17T18:00:00Z'),
    )
    expect(made).toEqual({
      ok: true,
      acceptance: {
        acceptedBy: 'AJ',
        acceptedAt: '2026-11-17T18:00:00.000Z',
        method: 'skyline',
        pose,
        evidence: { skyColumns: 140, settled: true, modelScore: 0.3 },
        note: '',
      },
    })
  })

  it('returns the gate’s reason when it does not pass', () => {
    expect(makePhotoAcceptance({ ...gate, initials: '' }, new Date())).toEqual({
      ok: false,
      reason: 'Type your initials.',
    })
  })
})

describe('parsePhotoAcceptance', () => {
  it('round-trips a record through JSON', () => {
    expect(parsePhotoAcceptance(JSON.parse(JSON.stringify(accepted)))).toEqual(accepted)
  })

  it('refuses a record missing who, when, how or a sound pose', () => {
    expect(parsePhotoAcceptance(null)).toBeNull()
    expect(parsePhotoAcceptance([])).toBeNull()
    expect(parsePhotoAcceptance({ ...accepted, acceptedBy: '' })).toBeNull()
    expect(parsePhotoAcceptance({ ...accepted, acceptedAt: 'yesterday' })).toBeNull()
    expect(parsePhotoAcceptance({ ...accepted, method: 'guess' })).toBeNull()
    expect(parsePhotoAcceptance({ ...accepted, pose: { ...pose, lat: 95 } })).toBeNull()
    expect(parsePhotoAcceptance({ ...accepted, pose: { ...pose, hfov: 200 } })).toBeNull()
    expect(parsePhotoAcceptance({ ...accepted, pose: { ...pose, altitudeMeters: 20000 } })).toBeNull()
  })

  it('refuses an unsettled acceptance without its note', () => {
    const unsettled = { ...accepted, evidence: { settled: false } }
    expect(parsePhotoAcceptance(unsettled)).toBeNull()
    expect(parsePhotoAcceptance({ ...unsettled, note: 'Sun glare matches.' })?.note).toBe('Sun glare matches.')
  })

  it('keeps a ground camera’s missing altitude and drops malformed evidence fields', () => {
    const parsed = parsePhotoAcceptance({
      ...accepted,
      pose: { ...pose, altitudeMeters: undefined, bearing: 372 },
      evidence: { skyColumns: 'many', agreeShare: 1.4, modelScore: null, sunNote: 'sun in frame', extra: 1 },
    })
    expect(parsed?.pose.altitudeMeters).toBeNull()
    expect(parsed?.pose.bearing).toBe(12)
    expect(parsed?.evidence).toEqual({ modelScore: null, sunNote: 'sun in frame' })
  })
})
