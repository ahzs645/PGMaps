import { describe, expect, it } from 'vitest'
import {
  DRIVE_LIMITS,
  TOUR_FILE_TYPE,
  TOUR_LIMITS,
  TourFileError,
  driveTimeline,
  easeInOut,
  interpolatePose,
  normalizeBearing,
  parseTour,
  pathLengthMeters,
  sequenceTimelines,
  serializeTour,
  tourDurationMs,
  tourPhaseAt,
  tourPoseAt,
  tourTimeline,
  type Tour,
} from './tourTimeline'

const tour: Tour = {
  stops: [
    { pose: { lng: -122.8, lat: 53.9, bearing: 170, pitch: 60, zoom: 14 }, holdMs: 1000, transitionMs: 2000 },
    { pose: { lng: -122.7, lat: 54.0, bearing: -170, pitch: 80, zoom: 16 }, holdMs: 500, transitionMs: 3000 },
    { pose: { lng: -122.6, lat: 54.1, bearing: 0, pitch: 85 }, holdMs: 1500, transitionMs: 9999 },
  ],
}

describe('tour timeline', () => {
  it('adds every hold and every transition but the last', () => {
    expect(tourDurationMs(tour)).toBe(1000 + 2000 + 500 + 3000 + 1500)
    expect(tourDurationMs({ stops: [tour.stops[0]] })).toBe(1000)
    expect(tourDurationMs({ stops: [] })).toBe(0)
  })

  it('finds the stop and phase for a time', () => {
    expect(tourPhaseAt(tour, -5)).toEqual({ stopIndex: 0, phase: 'hold', progress: 0 })
    expect(tourPhaseAt(tour, 500)).toEqual({ stopIndex: 0, phase: 'hold', progress: 0.5 })
    expect(tourPhaseAt(tour, 2000)).toEqual({ stopIndex: 0, phase: 'transition', progress: 0.5 })
    expect(tourPhaseAt(tour, 3200)).toEqual({ stopIndex: 1, phase: 'hold', progress: 0.4 })
    expect(tourPhaseAt(tour, 1e9)).toEqual({ stopIndex: 2, phase: 'hold', progress: 1 })
    expect(tourPhaseAt({ stops: [] }, 0)).toBeNull()
  })

  it('holds a stop exactly and eases the transition', () => {
    expect(tourPoseAt(tour, 999)).toEqual(tour.stops[0].pose)
    expect(tourPoseAt(tour, 3000)).toEqual(tour.stops[1].pose)
    const mid = tourPoseAt(tour, 2000)!
    expect(mid.lng).toBeCloseTo(-122.75, 9)
    expect(mid.zoom).toBeCloseTo(15, 9)
    // Bearing 170 → -170 goes through 180, the shorter way, not through 0.
    expect(Math.abs(mid.bearing)).toBeCloseTo(180, 9)
    const early = tourPoseAt(tour, 1000 + 2000 * 0.25)!
    expect(early.lng - -122.8).toBeLessThan(0.1 * 0.25) // eased: slower than linear at the start
    expect(tourPoseAt(tour, 1e9)).toEqual(tour.stops[2].pose)
  })

  it('holds a field one stop lacks at the other stop’s value', () => {
    const pose = tourPoseAt(tour, 1000 + 2000 + 500 + 1500)!
    expect(pose.zoom).toBe(16)
  })

  it('crosses the antimeridian the short way', () => {
    const pose = interpolatePose(
      { lng: 179, lat: 0, bearing: 0, pitch: 0 },
      { lng: -179, lat: 0, bearing: 0, pitch: 0 },
      0.5,
    )
    expect(Math.abs(pose.lng)).toBeCloseTo(180, 9)
  })

  it('eases from rest to rest', () => {
    expect(easeInOut(0)).toBe(0)
    expect(easeInOut(0.5)).toBe(0.5)
    expect(easeInOut(1)).toBe(1)
    expect(easeInOut(2)).toBe(1)
    expect(normalizeBearing(270)).toBe(-90)
    expect(normalizeBearing(-180)).toBe(180)
  })

  it('refuses an empty tour as a timeline', () => {
    expect(() => tourTimeline({ stops: [] })).toThrow(/at least one stop/)
    expect(tourTimeline(tour).durationMs).toBe(8000)
  })
})

describe('drive timeline', () => {
  // About 1.11 km due north, then 1.11 km due east at 54°N... east legs are shorter in degrees.
  const road = [
    [-122.7, 54.0],
    [-122.7, 54.01],
    [-122.7, 54.01], // a repeated point is skipped
    [-122.68, 54.01],
  ] as const

  it('travels along the road at the speed given', () => {
    const length = pathLengthMeters(road)
    const drive = driveTimeline(road, { speedMetersPerSecond: 10, pitch: 88, eyeHeightMeters: 1.6 })
    expect(drive.durationMs).toBeCloseTo((length / 10) * 1000, 6)
    const start = drive.poseAt(0)
    expect(start).toMatchObject({ lng: -122.7, lat: 54.0, pitch: 88, eyeHeightMeters: 1.6 })
    expect(start.bearing).toBeCloseTo(0, 6)
    const end = drive.poseAt(drive.durationMs + 1000)
    expect(end.lng).toBeCloseTo(-122.68, 9)
    expect(end.bearing).toBeCloseTo(90, 0)
  })

  it('turns the view smoothly through a bend', () => {
    const drive = driveTimeline(road, { speedMetersPerSecond: 10, pitch: 88, lookAheadMeters: 100 })
    const northLeg = 0.01 * 111_195
    const atBend = drive.poseAt(((northLeg - 20) / 10) * 1000)
    expect(atBend.bearing).toBeGreaterThan(10)
    expect(atBend.bearing).toBeLessThan(80)
  })

  it('drives part of the road and clamps the speed', () => {
    const drive = driveTimeline(road, { speedMetersPerSecond: 1e6, pitch: 80, startMeters: 100, endMeters: 600 })
    expect(drive.durationMs).toBeCloseTo((500 / DRIVE_LIMITS.maxSpeedMetersPerSecond) * 1000, 6)
    expect(() => driveTimeline([[0, 0]], { speedMetersPerSecond: 5, pitch: 0 })).toThrow(/two distinct points/)
    expect(() => driveTimeline(road, { speedMetersPerSecond: 5, pitch: 0, startMeters: 50, endMeters: 50 })).toThrow(
      /empty/,
    )
  })

  it('plays timelines one after another', () => {
    const drive = driveTimeline(road, { speedMetersPerSecond: 10, pitch: 88 })
    const all = sequenceTimelines([tourTimeline(tour), drive])
    expect(all.durationMs).toBeCloseTo(8000 + drive.durationMs, 6)
    expect(all.poseAt(500)).toEqual(tour.stops[0].pose)
    expect(all.poseAt(8000)).toEqual(drive.poseAt(0))
    expect(all.poseAt(1e12).lng).toBeCloseTo(-122.68, 9)
  })
})

describe('tour files', () => {
  it('round-trips a tour', () => {
    const text = serializeTour({ ...tour, name: 'Tabor road' })
    const read = parseTour(text)
    expect(read.name).toBe('Tabor road')
    expect(read.stops).toHaveLength(3)
    expect(read.stops[0]).toEqual(tour.stops[0])
    // The last stop's transition is clamped like every other.
    expect(read.stops[2].transitionMs).toBe(9999)
    expect(parseTour(serializeTour(read))).toEqual(read)
  })

  it('clamps values to the limits the controls hold', () => {
    const text = JSON.stringify({
      type: TOUR_FILE_TYPE,
      version: 1,
      stops: [
        {
          pose: { lng: 190, lat: 54, bearing: 270, pitch: 500, zoom: 99, eyeHeightMeters: -3, fieldOfViewDegrees: 400 },
          holdMs: -10,
          transitionMs: 1e9,
          label: '  Viewpoint   A ',
        },
      ],
    })
    const [stop] = parseTour(text).stops
    expect(stop.pose).toEqual({
      lng: -170,
      lat: 54,
      bearing: -90,
      pitch: TOUR_LIMITS.maxPitch,
      zoom: TOUR_LIMITS.maxZoom,
      eyeHeightMeters: 0,
      fieldOfViewDegrees: TOUR_LIMITS.maxFieldOfViewDegrees,
    })
    expect(stop.holdMs).toBe(0)
    expect(stop.transitionMs).toBe(TOUR_LIMITS.maxTransitionMs)
    expect(stop.label).toBe('Viewpoint A')
  })

  it('names what is wrong with a file it cannot read', () => {
    const file = (body: object) => JSON.stringify({ type: TOUR_FILE_TYPE, version: 1, ...body })
    expect(() => parseTour('{')).toThrow(TourFileError)
    expect(() => parseTour(JSON.stringify({ type: 'other', version: 1, stops: [] }))).toThrow(/not a PGMaps tour/)
    expect(() => parseTour(JSON.stringify({ type: TOUR_FILE_TYPE, version: 2, stops: [] }))).toThrow(/newer PGMaps/)
    expect(() => parseTour(JSON.stringify({ type: TOUR_FILE_TYPE, stops: [] }))).toThrow(/no valid version/)
    expect(() => parseTour(file({ stops: [] }))).toThrow(/no stops/)
    expect(() => parseTour(file({ stops: [{ pose: { lng: 0, lat: 95 } }] }))).toThrow(/Stop 1 has no valid position/)
    const many = Array.from({ length: TOUR_LIMITS.maxStops + 1 }, () => ({ pose: { lng: 0, lat: 0 } }))
    expect(() => parseTour(file({ stops: many }))).toThrow(/too many stops/)
    expect(() => parseTour(' '.repeat(TOUR_LIMITS.maxFileLength + 1))).toThrow(/too large/)
  })

  it('fills missing timings with the defaults', () => {
    const [stop] = parseTour(
      JSON.stringify({ type: TOUR_FILE_TYPE, version: 1, stops: [{ pose: { lng: 1, lat: 2 } }] }),
    ).stops
    expect(stop).toEqual({
      pose: { lng: 1, lat: 2, bearing: 0, pitch: 0 },
      holdMs: TOUR_LIMITS.defaultHoldMs,
      transitionMs: TOUR_LIMITS.defaultTransitionMs,
    })
  })
})
