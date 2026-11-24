import { describe, expect, it } from 'vitest'

import type { HighGround } from './highGround'
import type { PhotoLocationSearch } from './photoLocationSearch'
import {
  PLACE_DOUBT_ERROR_METERS,
  areaPick,
  bearingTo,
  placeFromFix,
  placeSettled,
  placesToSearch,
  searchPlaceName,
} from './photoPlaces'
import type { WideSearchResult } from './wideOrientation'

// Made-up places.
const fix = { lng: -122.75, lat: 53.92 }
const high: HighGround = {
  lng: -122.757,
  lat: 53.93,
  groundMeters: 680,
  distanceMeters: 1180,
  bearing: 337,
  aboveFixMeters: 114,
  statedErrorMeters: 125,
}
const plan = (over: Partial<Parameters<typeof placesToSearch>[0]> = {}) =>
  placesToSearch({
    settled: false,
    positionSource: 'exif',
    fix,
    statedErrorMeters: 10,
    highGround: null,
    airborne: false,
    ...over,
  })

const result = (trustworthy: boolean, bearing = 130) =>
  ({ bearing, pitch: -5, roll: 0, trustworthy, ambiguous: !trustworthy, fit: { trustworthy } }) as WideSearchResult

describe('placesToSearch', () => {
  it('searches nothing more once the skyline settled, or round a place the reviewer set', () => {
    expect(plan({ settled: true, highGround: high })).toEqual({ highGround: null, area: null })
    expect(plan({ positionSource: 'reviewer', highGround: high })).toEqual({ highGround: null, area: null })
    expect(plan({ fix: null, highGround: high })).toEqual({ highGround: null, area: null })
  })

  it('searches the high ground and the area round it', () => {
    expect(plan({ highGround: high })).toEqual({
      highGround: high,
      area: { lng: high.lng, lat: high.lat, on: 'high-ground' },
    })
    // Still while the camera stands on the guess.
    expect(plan({ highGround: high, positionSource: 'gps-altitude' }).highGround).toBe(high)
  })

  it('searches round a fix the phone itself doubts, on the ground only', () => {
    expect(plan({ statedErrorMeters: PLACE_DOUBT_ERROR_METERS })).toEqual({
      highGround: null,
      area: { ...fix, on: 'fix' },
    })
    expect(plan({ statedErrorMeters: PLACE_DOUBT_ERROR_METERS - 1 })).toEqual({ highGround: null, area: null })
    expect(plan({ statedErrorMeters: null })).toEqual({ highGround: null, area: null })
    expect(plan({ statedErrorMeters: 500, airborne: true })).toEqual({ highGround: null, area: null })
  })
})

describe('the places in words', () => {
  it('bears north, east, south and west', () => {
    expect(bearingTo(fix, { lng: fix.lng, lat: fix.lat + 0.01 })).toBeCloseTo(0)
    expect(bearingTo(fix, { lng: fix.lng + 0.01, lat: fix.lat })).toBeCloseTo(90)
    expect(bearingTo(fix, { lng: fix.lng, lat: fix.lat - 0.01 })).toBeCloseTo(180)
    expect(bearingTo(fix, { lng: fix.lng - 0.01, lat: fix.lat })).toBeCloseTo(270)
  })

  it('names a place from the fix', () => {
    expect(placeFromFix(fix, fix)).toBe('the GPS fix')
    expect(placeFromFix({ lng: fix.lng + 0.0076, lat: fix.lat }, fix)).toBe('a place 500 m E of the fix')
    expect(placeFromFix(fix, null)).toBe('a searched place')
  })

  it('names where a search stood only once the camera has left it', () => {
    const name = (searchedAt: { lng: number; lat: number }, standsAt: { lng: number; lat: number }) =>
      searchPlaceName({ searchedAt, standsAt, fix, highGround: high })
    expect(name(fix, fix)).toBeNull()
    expect(name(fix, high)).toBe('the GPS fix')
    expect(name(high, fix)).toBe('the high ground')
    expect(name({ lng: -122.7, lat: 53.9 }, fix)).toBe('where it was first searched')
  })
})

describe('areaPick', () => {
  const done = (
    ambiguous: boolean,
    places: Array<{ lng: number; lat: number; bearing: number }> = [{ lng: -122.76, lat: 53.93, bearing: 130 }],
  ): PhotoLocationSearch => ({
    status: 'done',
    candidates: places.map(({ bearing, ...at }) => ({ ...at, fit: result(true, bearing) })),
    ambiguous,
    spread: null,
    sampled: 9,
    basis: { hfov: 70, eyeHeightMeters: 1.6, altitudeMeters: null },
  })
  const tie = [
    { lng: -122.76, lat: 53.93, bearing: 265 },
    { lng: -122.765, lat: 53.935, bearing: 131 },
    { lng: -122.757, lat: 53.931, bearing: 125 },
  ]

  it('takes a clear best place', () => {
    expect(areaPick(done(false), [], null)).toMatchObject({ place: { lng: -122.76, lat: 53.93 }, by: 'clear' })
    expect(areaPick(null, [], null)).toBeNull()
  })

  it('never takes the top of a tie alone', () => {
    expect(areaPick(done(true, tie), [], null)).toBeNull()
    expect(areaPick(done(true, tie), [], 40)).toBeNull()
  })

  it('breaks a tie by the phone’s heading, taking the best fit that faces it', () => {
    expect(areaPick(done(true, tie), [], 127.5)).toMatchObject({
      place: { lng: -122.765, lat: 53.935, fit: { bearing: 131 } },
      by: 'phone',
    })
  })

  it('leaves out a camera already a row, but not the same place facing another way', () => {
    const searched = [{ lng: high.lng, lat: high.lat, bearings: [252, 205] }]
    expect(areaPick(done(false, [{ ...high, bearing: 250 }]), searched, null)).toBeNull()
    expect(areaPick(done(true, [tie[0], { ...high, bearing: 130 }]), searched, 127.5)).toMatchObject({
      place: { lng: high.lng, lat: high.lat },
      by: 'phone',
    })
  })
})

describe('placeSettled', () => {
  it('is settled only when a search from another place settled', () => {
    const places = (trustworthy: boolean) => ({
      status: 'done' as const,
      tried: [],
      area: null,
      areaCentre: null,
      notes: [],
      searches: [
        {
          id: 'high-ground',
          label: 'x',
          positionSource: 'gps-altitude' as const,
          warning: 'x',
          at: { lng: 0, lat: 0, altitudeMeters: null, hfov: 60 },
          result: result(trustworthy),
          sun: null,
        },
      ],
    })
    expect(placeSettled(places(true))).toBe(true)
    expect(placeSettled(places(false))).toBe(false)
    expect(placeSettled(undefined)).toBe(false)
  })
})
