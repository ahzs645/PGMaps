import { describe, expect, it } from 'vitest'

import {
  AIRBORNE_ABOVE_GROUND_METERS,
  HIGH_GROUND_RADIUS_METERS,
  compassPoint,
  groundDistance,
  highGroundNearFix,
  highGroundNote,
} from './highGround'

// A made-up valley: flat floor at 570 m, and a plateau at 680 m from 1,100 m north of the fix.
const fix = { lng: -120, lat: 50 }
const perLat = 111320
const valley = (_lng: number, lat: number) => ((lat - fix.lat) * perLat >= 1100 ? 680 : 570)

describe('highGroundNearFix', () => {
  it('finds the nearest ground at the GPS altitude when the fix lies far below it', () => {
    const high = highGroundNearFix({
      ...fix,
      gpsAltitudeMeters: 685,
      eyeHeightMeters: 1.6,
      horizontalErrorMeters: 125,
      elevationAt: valley,
    })
    expect(high).not.toBeNull()
    expect(high!.distanceMeters).toBeGreaterThanOrEqual(1100)
    expect(high!.distanceMeters).toBeLessThan(1150)
    expect(high!.bearing).toBeCloseTo(0, 0)
    expect(high!.groundMeters).toBe(680)
    expect(high!.aboveFixMeters).toBe(115)
    expect(high!.statedErrorMeters).toBe(125)
    expect((high!.lat - fix.lat) * perLat).toBeCloseTo(high!.distanceMeters, 0)
  })

  it('offers nothing while the altitude is within reach of the ground under the fix', () => {
    const altitude = 570 + AIRBORNE_ABOVE_GROUND_METERS - 1
    expect(highGroundNearFix({ ...fix, gpsAltitudeMeters: altitude, eyeHeightMeters: 1.6, elevationAt: valley })).toBe(
      null,
    )
  })

  it('offers nothing when no ground near enough stands at the altitude: an aircraft', () => {
    expect(highGroundNearFix({ ...fix, gpsAltitudeMeters: 1200, eyeHeightMeters: 1.6, elevationAt: valley })).toBe(null)
    const farPlateau = (_lng: number, lat: number) =>
      (lat - fix.lat) * perLat >= HIGH_GROUND_RADIUS_METERS + 100 ? 680 : 570
    expect(highGroundNearFix({ ...fix, gpsAltitudeMeters: 685, eyeHeightMeters: 1.6, elevationAt: farPlateau })).toBe(
      null,
    )
  })

  it('offers nothing without an altitude or terrain under the fix', () => {
    expect(highGroundNearFix({ ...fix, gpsAltitudeMeters: null, eyeHeightMeters: 1.6, elevationAt: valley })).toBe(null)
    expect(highGroundNearFix({ ...fix, gpsAltitudeMeters: 685, eyeHeightMeters: 1.6, elevationAt: () => NaN })).toBe(
      null,
    )
  })

  it('says what it found in a sentence', () => {
    const high = highGroundNearFix({
      ...fix,
      gpsAltitudeMeters: 685,
      eyeHeightMeters: 1.6,
      horizontalErrorMeters: 125,
      elevationAt: valley,
    })!
    expect(highGroundNote(high, 685)).toBe(
      'Its GPS altitude, 685 m, is 115 m above the ground at its fix (the phone gave its position as good to 125 m). ' +
        'It was taken from the air, or the fix is off: ground at that height lies 1.1 km N, and an option stands a ' +
        'camera there with the phone’s heading.',
    )
  })
})

describe('compassPoint and groundDistance', () => {
  it('names sixteen points and rounds distances for a sentence', () => {
    expect([0, 343, 349, 22.5, 180, 359].map(compassPoint)).toEqual(['N', 'NNW', 'N', 'NNE', 'S', 'N'])
    expect([340, 1123, 1960].map(groundDistance)).toEqual(['340 m', '1.1 km', '2.0 km'])
  })
})
