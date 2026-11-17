import { describe, expect, it } from 'vitest'

import type { ControlPair, ControlSolveResult } from './controlPose'
import { pairResiduals, worstCheckPoint } from './pairResiduals'
import { cameraDistance } from './photoHitBuffer'
import { projectToPhoto, type PhotoPose } from './photoPose'

// A made-up camera and made-up spots.
const pose: PhotoPose & { hfov: number } = {
  lng: -121,
  lat: 51,
  altitudeMeters: 1000,
  bearing: 90,
  pitch: -5,
  roll: 0,
  width: 1000,
  height: 750,
  focalPx: 900,
  k1: 0,
  k2: 0,
  hfov: 58,
}
const spots = [
  { lng: -120.98, lat: 51.002, elevation: 800 },
  { lng: -120.97, lat: 50.998, elevation: 760 },
  { lng: -120.975, lat: 51.004, elevation: 820 },
]
const pairs: ControlPair[] = spots.map((spot, i) => {
  const at = projectToPhoto(pose, spot.lng, spot.lat, spot.elevation)!
  // The third click lands 10 px right of the spot.
  return { id: `p${i}`, pixel: [at.x + (i === 2 ? 10 : 0), at.y], ...spot }
})
const solve: ControlSolveResult = {
  pose,
  start: 'given',
  shift: { east: 0, north: 0, up: 0 },
  pairs: [
    { id: 'p0', fittedPx: 0, heldOutPx: 3, metresPerPx: 2 },
    { id: 'p1', fittedPx: 0, heldOutPx: null, metresPerPx: 2.5 },
  ],
  rmsPx: 0,
  heldOutMetresMax: 6,
  freeUnknowns: 3,
}

describe('pairResiduals', () => {
  it('numbers the pairs and measures each against the solved camera', () => {
    const rows = pairResiduals(pairs, ['p2'], solve)
    expect(rows.map((row) => row.n)).toEqual([1, 2, 3])
    expect(rows[0].residualPx).toBeCloseTo(0, 6)
    expect(rows[0].residualMeters).toBeCloseTo(0, 6)
    expect(rows[0].heldOutPx).toBe(3)
    expect(rows[0].heldOutMeters).toBe(6)
    expect(rows[1].heldOutMeters).toBeNull()
  })

  it('measures an off pair as a check point, in metres from its range', () => {
    const rows = pairResiduals(pairs, ['p2'], solve)
    const check = rows[2]
    expect(check.on).toBe(false)
    expect(check.stale).toBe(false)
    expect(check.residualPx).toBeCloseTo(10, 6)
    const range = cameraDistance(pose, spots[2].lng, spots[2].lat, spots[2].elevation)
    expect(check.residualMeters).toBeCloseTo((10 * range) / pose.focalPx, 6)
    expect(worstCheckPoint(rows)?.px).toBeCloseTo(10, 6)
  })

  it('flags an on pair the last solve did not use, and measures nothing without a solve', () => {
    expect(pairResiduals(pairs, [], solve)[2].stale).toBe(true)
    const rows = pairResiduals(pairs, [], null)
    expect(rows.every((row) => row.residualPx === null && row.solvedPixel === null && !row.stale)).toBe(true)
    expect(worstCheckPoint(rows)).toBeNull()
  })
})
