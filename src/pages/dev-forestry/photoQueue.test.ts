import { describe, expect, it } from 'vitest'

import type { AcceptancePose, PhotoAcceptance } from './photoAcceptance'
import {
  airborneAltitude,
  checkedPoseFor,
  controlSolveSuspect,
  horizonKey,
  lensRangeFor,
  methodForOption,
  methodForSource,
  narrowSearchSettles,
  nextInQueue,
  photoFlights,
  photoQueueStatus,
  pitchRangeFor,
  queueMaySetPose,
  queueOrder,
  queueReasons,
  searchKey,
  withCheckedPose,
  withPhotoUse,
} from './photoQueue'

// Made-up frames: two bursts of one flight and a photo with no time.
const photos = [
  { id: 'c', name: 'IMG_3.HEIC', takenAtUtc: '2026-09-14T17:25:05.000Z' },
  { id: 'a', name: 'IMG_1.HEIC', takenAtUtc: '2026-09-14T17:22:30.000Z' },
  { id: 'x', name: 'IMG_0.HEIC', takenAtUtc: null },
  { id: 'b', name: 'IMG_2.HEIC', takenAtUtc: '2026-09-14T17:22:33.000Z' },
  { id: 'd', name: 'IMG_4.HEIC', takenAtUtc: '2026-09-14T18:40:00.000Z' },
]

const pose = (bearing: number, patch: Partial<AcceptancePose> = {}): AcceptancePose => ({
  lng: -122.5,
  lat: 53.7,
  altitudeMeters: 1200,
  bearing,
  pitch: -6,
  roll: 1,
  hfov: 60,
  ...patch,
})

describe('the queue’s order', () => {
  it('runs photos in time order, whatever order they were added in, and those with no time last', () => {
    expect(queueOrder(photos)).toEqual(['a', 'b', 'c', 'd', 'x'])
    expect(nextInQueue(['d', 'x', 'b'], photos)).toBe('b')
    expect(nextInQueue([], photos)).toBeNull()
  })

  it('numbers each frame in its flight, and leaves a photo with no time in none', () => {
    const flights = photoFlights(photos)
    expect(flights.get('a')?.frameIndex).toBe(0)
    expect(flights.get('c')).toEqual({ flightId: flights.get('a')!.flightId, frameIndex: 2 })
    // 70 minutes later: a flight of its own.
    expect(flights.get('d')?.flightId).not.toBe(flights.get('a')!.flightId)
    expect(flights.has('x')).toBe(false)
  })
})

describe('cache keys and ranges', () => {
  it('shares a horizon between eyes within about 10 m and a metre', () => {
    expect(horizonKey({ lng: -122.50001, lat: 53.70002, altitudeMeters: 1200.3 })).toBe(
      horizonKey({ lng: -122.50003, lat: 53.70004, altitudeMeters: 1199.8 }),
    )
    expect(horizonKey({ lng: -122.5, lat: 53.7, altitudeMeters: 1200 })).not.toBe(
      horizonKey({ lng: -122.5, lat: 53.7, altitudeMeters: 1260 }),
    )
  })

  it('keys a search on its photo, camera start, ranges and priors', () => {
    const base = {
      photoId: 'a',
      pose: { lng: -122.5, lat: 53.7, altitudeMeters: 1200, width: 1050, height: 788, focalPx: 909.3 },
      pitchRange: [-50, 10] as const,
    }
    expect(searchKey(base)).toBe(searchKey({ ...base }))
    expect(searchKey(base)).not.toBe(searchKey({ ...base, photoId: 'b' }))
    expect(searchKey(base)).not.toBe(searchKey({ ...base, priors: { heading: { value: 40, tolerance: 15 } } }))
    expect(searchKey(base)).not.toBe(searchKey({ ...base, hfovRange: [20, 50] }))
  })

  it('takes the tilt sensor’s pitch only while it reads gravity alone', () => {
    expect(pitchRangeFor({ tilt: { pitch: -8, g: 1.01 }, airborne: true })).toEqual([-14, -2])
    expect(pitchRangeFor({ tilt: { pitch: -8, g: 1.3 }, airborne: true })).toEqual([-50, 10])
    expect(pitchRangeFor({ tilt: null, airborne: false })).toEqual([-20, 15])
  })

  it('gives a cropped photo a range of lenses up to the tagged one, and a whole one none', () => {
    expect(lensRangeFor({ cropped: true, hfov: 60 })).toEqual([24, 60])
    expect(lensRangeFor({ cropped: false, hfov: 60 })).toBeNull()
    expect(lensRangeFor({ cropped: true, hfov: null })).toBeNull()
  })
})

describe('what the queue may do', () => {
  it('sets the angles only while they are a stand-in or the phone’s', () => {
    expect(queueMaySetPose('exif')).toBe(true)
    expect(queueMaySetPose('road-view')).toBe(true)
    expect(queueMaySetPose('reviewer')).toBe(false)
    expect(queueMaySetPose('record')).toBe(false)
    expect(queueMaySetPose('skyline')).toBe(false)
  })

  it('lets a narrow search stand alone only when it is trustworthy', () => {
    expect(narrowSearchSettles({ trustworthy: true })).toBe(true)
    expect(narrowSearchSettles({ trustworthy: false })).toBe(false)
    expect(narrowSearchSettles(null)).toBe(false)
  })

  it('names the method from the row used, else from where the heading came', () => {
    expect(methodForOption('runner-up')).toBe('skyline')
    expect(methodForOption('neighbour')).toBe('neighbour')
    expect(methodForSource('controls')).toBe('points')
    expect(methodForSource('exif')).toBe('phone')
    expect(methodForSource('reviewer')).toBe('typed')
  })

  it('flags a point solve that rolled over or moved far', () => {
    expect(controlSolveSuspect({ pose: { roll: 2 }, shift: { east: 10, north: 5, up: 3 } })).toBe(false)
    expect(controlSolveSuspect({ pose: { roll: 45 }, shift: { east: 0, north: 0, up: 0 } })).toBe(true)
    expect(controlSolveSuspect({ pose: { roll: 0 }, shift: { east: 120, north: 120, up: 0 } })).toBe(true)
  })
})

describe('checks and status', () => {
  it('finds the check drawn for the camera as it stands, else the last drawn', () => {
    const drawn = [pose(40), pose(212)]
    expect(checkedPoseFor(drawn, pose(212.3))?.bearing).toBe(212)
    expect(checkedPoseFor(drawn, pose(100))?.bearing).toBe(212)
    expect(checkedPoseFor([], pose(40))).toBeNull()
    // Drawing the same camera again moves it to the end rather than repeating it.
    expect(withCheckedPose(drawn, pose(40.2)).map((p) => p.bearing)).toEqual([212, 40.2])
  })

  it('reads accepted only while the camera is still the one accepted', () => {
    const acceptance = { pose: pose(40) } as PhotoAcceptance
    const base = {
      running: false,
      queued: false,
      acceptance,
      pose: pose(40),
      checked: [pose(40)],
      search: 'done' as const,
      found: null,
    }
    expect(photoQueueStatus(base)).toBe('accepted')
    expect(photoQueueStatus({ ...base, pose: pose(41) })).toBe('options')
    expect(photoQueueStatus({ ...base, acceptance: null })).toBe('checked')
    expect(photoQueueStatus({ ...base, running: true })).toBe('searching')
    expect(photoQueueStatus({ ...base, acceptance: null, checked: [], queued: true })).toBe('queued')
    expect(
      photoQueueStatus({ ...base, acceptance: null, checked: [], search: 'idle', found: { skyline: false } }),
    ).toBe('failed')
    // A photo the queue never reached (cancelled, or back from a file) has no options to choose yet.
    expect(photoQueueStatus({ ...base, acceptance: null, checked: [], search: 'idle', found: null })).toBe('unsearched')
  })

  it('gives the reviewer reasons, never far-from-the-road', () => {
    expect(
      queueReasons({
        found: { lens: { cropped: true }, skyline: true, terrain: true },
        search: { trustworthy: false, ambiguous: true },
        otherOptions: 2,
        neighbourGap: 40,
      }),
    ).toEqual(['cropped-lens', 'not-settled', 'disagrees-with-neighbour'])
    expect(queueReasons({ found: null, search: null, otherOptions: 0, neighbourGap: null })).toEqual([
      'phone-heading-only',
    ])
  })

  it('links and unlinks a job as the record does', () => {
    const uses = withPhotoUse([], 'viewpoint', true, 'voi-1')
    expect(uses).toEqual([{ job: 'viewpoint', targetId: 'voi-1' }])
    expect(withPhotoUse(uses, 'viewpoint', true, 'voi-1')).toHaveLength(1)
    expect(withPhotoUse(uses, 'viewpoint', false, 'voi-1')).toEqual([])
    expect(withPhotoUse(uses, 'ground', true)).toEqual([...uses, { job: 'ground' }])
  })
})

describe('airborneAltitude', () => {
  it('stands the eye at the GPS altitude only when it is clearly above the ground', () => {
    expect(airborneAltitude({ gpsAltitudeMeters: 912, groundMeters: 670, eyeSource: 'default' })).toBe(912)
    // Phone altitude is good to some tens of metres: that is not an aircraft.
    expect(airborneAltitude({ gpsAltitudeMeters: 700, groundMeters: 670, eyeSource: 'default' })).toBeNull()
    expect(airborneAltitude({ gpsAltitudeMeters: null, groundMeters: 670, eyeSource: 'default' })).toBeNull()
    expect(airborneAltitude({ gpsAltitudeMeters: 912, groundMeters: Number.NaN, eyeSource: 'default' })).toBeNull()
  })

  it('never overrides a reviewer who stood the eye on the ground or anywhere else', () => {
    expect(airborneAltitude({ gpsAltitudeMeters: 912, groundMeters: 670, eyeSource: 'reviewer' })).toBeNull()
    expect(airborneAltitude({ gpsAltitudeMeters: 912, groundMeters: 670, eyeSource: 'exif' })).toBeNull()
  })
})
