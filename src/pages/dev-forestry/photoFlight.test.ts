import { describe, expect, it } from 'vitest'

import {
  cameraClockTime,
  burstNeighbour,
  groupFlights,
  instantOf,
  lensCheck,
  neighbourPriors,
  takenAtUtc,
  type FlightPhoto,
} from './photoFlight'

// Made-up EXIF modelled on an iPhone 15: a 26 mm main camera writing 5712×4284, its 2× crop (52 mm, 4032×3024), and
// digital zoom on the main camera (33 mm at ×1.26, 37 mm at ×1.43), whose pixel size stays the full sensor's.
const iphone = {
  Make: 'Apple',
  Model: 'iPhone 15',
  FocalLength: 5.96,
  FocalLengthIn35mmFormat: 26,
  ExifImageWidth: 5712,
  ExifImageHeight: 4284,
  Orientation: 6,
  DateTimeOriginal: '2026:09:14 10:22:33',
  SubSecTimeOriginal: '834',
  OffsetTimeOriginal: '-07:00',
  GPSDateStamp: '2026:09:14',
  GPSTimeStamp: [17, 22, 31.5],
}

describe('takenAtUtc', () => {
  it('takes the zoned camera clock first, and says how far the GPS stamp trails it', () => {
    expect(takenAtUtc(iphone)).toEqual({
      iso: '2026-09-14T17:22:33.834Z',
      source: 'clock-offset',
      zoneKnown: true,
      gpsBehindSeconds: expect.closeTo(2.334, 3),
    })
  })

  it('falls back to the GPS stamp without a zoned clock', () => {
    const noOffset = { ...iphone, OffsetTimeOriginal: undefined }
    expect(takenAtUtc(noOffset)).toEqual({
      iso: '2026-09-14T17:22:31.500Z',
      source: 'gps',
      zoneKnown: true,
      gpsBehindSeconds: null,
    })
  })

  it('orders a burst by the shutter, not by GPS fixes that lag it by different amounts', () => {
    // Two frames 3 s apart by the clock; the first frame's fix lags 12 s, the second's 1 s.
    const first = { ...iphone, DateTimeOriginal: '2026:09:14 10:22:30', GPSTimeStamp: [17, 22, 42] }
    const second = { ...iphone, DateTimeOriginal: '2026:09:14 10:22:33', GPSTimeStamp: [17, 22, 34] }
    const a = takenAtUtc(first)!.iso,
      b = takenAtUtc(second)!.iso
    expect(instantOf(a)! < instantOf(b)!).toBe(true)
  })

  it('flags the camera clock alone, which has no zone', () => {
    const clockOnly = { DateTimeOriginal: '2026:09:14 10:22:33', SubSecTimeOriginal: '03' }
    expect(takenAtUtc(clockOnly)).toEqual({
      iso: '2026-09-14T10:22:33.030',
      source: 'camera-clock',
      zoneKnown: false,
      gpsBehindSeconds: null,
    })
    // exifr's revived Date: its local fields are the clock, whatever the machine's zone.
    expect(takenAtUtc({ DateTimeOriginal: new Date(2026, 8, 14, 10, 22, 33) })?.iso).toBe('2026-09-14T10:22:33.000')
  })

  it('returns null with no time at all', () => {
    expect(takenAtUtc(null)).toBeNull()
    expect(takenAtUtc({ DateTimeOriginal: '0000:00:00 00:00:00' })).toBeNull()
  })

  it('reads a zone-less ISO time as UTC, so the order never depends on the machine', () => {
    expect(instantOf('2026-09-14T10:22:33.030')).toBe(Date.parse('2026-09-14T10:22:33.030Z'))
    expect(instantOf('2026-09-14T10:22:33-07:00')).toBe(Date.parse('2026-09-14T17:22:33Z'))
    expect(instantOf(null)).toBeNull()
    expect(instantOf('not a time')).toBeNull()
  })
})

describe('cameraClockTime', () => {
  it('gives the time of day where the photo was taken, not the UTC instant', () => {
    expect(cameraClockTime(iphone)).toBe('10:22:33')
    expect(takenAtUtc(iphone)!.iso).toContain('T17:22:33')
  })

  it('reads a revived Date by its own fields, and gives nothing without a clock', () => {
    expect(cameraClockTime({ DateTimeOriginal: new Date(2026, 8, 14, 9, 4, 29) })).toBe('09:04:29')
    expect(cameraClockTime({ GPSDateStamp: '2026:09:14', GPSTimeStamp: [17, 22, 31.5] })).toBeNull()
    expect(cameraClockTime(null)).toBeNull()
  })
})

describe('groupFlights', () => {
  const at = (id: string, iso: string | null, flightId?: string): FlightPhoto => ({
    id,
    takenAtUtc: iso,
    name: id,
    flightId,
  })
  const photos = [
    at('c', '2026-09-14T17:30:10Z'),
    at('a', '2026-09-14T17:22:31Z'),
    at('x', null),
    at('b', '2026-09-14T17:26:00Z'),
    // Over half an hour after c: a new flight.
    at('d', '2026-09-14T18:00:11Z'),
    at('e', '2026-09-14T18:00:11Z'),
  ]

  it('sorts by time and starts a flight after a gap over half an hour', () => {
    const flights = groupFlights(photos)
    expect(flights.map((f) => f.photos.map((p) => p.id))).toEqual([['a', 'b', 'c'], ['d', 'e'], ['x']])
    expect(flights[0]).toMatchObject({
      id: 'flight:20260914T172231Z',
      start: '2026-09-14T17:22:31.000Z',
      end: '2026-09-14T17:30:10.000Z',
      timed: true,
    })
    expect(flights[2]).toMatchObject({ id: 'untimed:x', timed: false, start: null })
  })

  it('keeps bursts of one flight together across quiet stretches of many minutes', () => {
    // A burst, 16 minutes of flying, two frames, 20 minutes, a last burst: one flight, as it was flown.
    const flown = [
      at('p', '2026-09-14T16:04:29Z'),
      at('q', '2026-09-14T16:20:22Z'),
      at('r', '2026-09-14T16:20:32Z'),
      at('s', '2026-09-14T16:40:17Z'),
      at('t', '2026-09-14T16:46:44Z'),
    ]
    expect(groupFlights(flown).map((f) => f.photos.map((p) => p.id))).toEqual([['p', 'q', 'r', 's', 't']])
  })

  it('gives the same flights whatever order the photos come in', () => {
    expect(groupFlights([...photos].reverse())).toEqual(groupFlights(photos))
  })

  it('keeps a flight’s id when an earlier photo joins it', () => {
    const named = photos.map((p) => (['a', 'b', 'c'].includes(p.id) ? { ...p, flightId: 'flight:kept' } : p))
    const flights = groupFlights([...named, at('z', '2026-09-14T17:20:00Z')])
    expect(flights[0].id).toBe('flight:kept')
    expect(flights[0].photos[0].id).toBe('z')
  })

  it('never gives two flights the same id when one splits', () => {
    const split = [at('a', '2026-09-14T17:00:00Z', 'flight:one'), at('b', '2026-09-14T17:30:00Z', 'flight:one')]
    const ids = groupFlights(split).map((f) => f.id)
    expect(ids[0]).toBe('flight:one')
    expect(ids[1]).not.toBe('flight:one')
  })
})

describe('burstNeighbour', () => {
  const here = { id: 'p2', takenAtUtc: '2026-09-14T17:22:40Z', lng: -123.1, lat: 54.2 }
  const accepted = [
    // 9 s before, about 200 m away.
    { id: 'p1', takenAtUtc: '2026-09-14T17:22:31Z', lng: -123.1, lat: 54.2018 },
    // 4 s after but 1.1 km away.
    { id: 'p3', takenAtUtc: '2026-09-14T17:22:44Z', lng: -123.1, lat: 54.21 },
    // 30 s after.
    { id: 'p4', takenAtUtc: '2026-09-14T17:23:10Z', lng: -123.1, lat: 54.2 },
  ]

  it('finds the nearest accepted frame within 20 s and 500 m', () => {
    const found = burstNeighbour(here, accepted)
    expect(found?.photo.id).toBe('p1')
    expect(found?.gapSeconds).toBe(-9)
    expect(found?.distanceMeters).toBeCloseTo(200, -1)
  })

  it('finds none without a time or a place, or past the limits', () => {
    expect(burstNeighbour({ ...here, takenAtUtc: null }, accepted)).toBeNull()
    expect(burstNeighbour({ ...here, lng: null }, accepted)).toBeNull()
    expect(burstNeighbour(here, accepted.slice(1))).toBeNull()
    expect(burstNeighbour(accepted[0], accepted)).toBeNull()
  })
})

describe('neighbourPriors', () => {
  it('holds heading ±15° and pitch ±10° round the neighbour, roll free', () => {
    expect(neighbourPriors({ bearing: -5, pitch: -7 })).toEqual({
      heading: { value: 355, tolerance: 15 },
      pitch: { value: -7, tolerance: 10 },
    })
  })
})

describe('lensCheck', () => {
  it('reads the 26 mm main camera, shown upright, across its narrow side', () => {
    const lens = lensCheck({ exif: iphone, decodedWidth: 4284, decodedHeight: 5712 })
    expect(lens.source).toBe('exif35')
    expect(lens.cropped).toBe(false)
    expect(lens.focal35Mm).toBe(26)
    expect(lens.hfov).toBeCloseTo(53.1, 1)
    expect(lens.vfov).toBeCloseTo(67.3, 1)
    expect(lens.note).toBe('26 mm equivalent')
  })

  it('reads the 2× camera’s 52 mm, with its own smaller pixel size', () => {
    const tele = { ...iphone, FocalLengthIn35mmFormat: 52, ExifImageWidth: 4032, ExifImageHeight: 3024, Orientation: 1 }
    const lens = lensCheck({ exif: tele, decodedWidth: 4032, decodedHeight: 3024 })
    expect(lens.cropped).toBe(false)
    expect(lens.hfov).toBeCloseTo(36.8, 1)
  })

  it('applies digital zoom once: the 33 and 37 mm already include it', () => {
    const zoomed = (focal: number, ratio: number) =>
      lensCheck({
        exif: { ...iphone, FocalLengthIn35mmFormat: focal, DigitalZoomRatio: ratio, Orientation: 1 },
        decodedWidth: 5712,
        decodedHeight: 4284,
      })
    const z33 = zoomed(33, 1.2614840989399294)
    const z37 = zoomed(37, 1.428)
    expect(z33.hfov).toBeCloseTo((2 * Math.atan(34.62 / 2 / 33) * 180) / Math.PI, 0)
    expect(z33.note).toBe('33 mm equivalent; digital zoom ×1.3 already included')
    expect(z37.hfov).toBeCloseTo(50.1, 1)
    expect(z37.digitalZoom).toBe(1.428)
    // Not the 26 mm's field narrowed again by the ratio.
    const twice = (2 * Math.atan(Math.tan((z33.hfov! * Math.PI) / 360) / 1.26) * 180) / Math.PI
    expect(z33.hfov).not.toBeCloseTo(twice, 0)
  })

  it('narrows a focal-plane lens by its digital zoom, which the sensor size does not know', () => {
    // A 6.86 × 5.14 mm sensor at 5712 × 4284 px.
    const sensorOnly = {
      FocalLength: 5.96,
      FocalPlaneXResolution: 5712 / 6.86,
      FocalPlaneYResolution: 4284 / 5.14,
      FocalPlaneResolutionUnit: 4,
      ExifImageWidth: 5712,
      ExifImageHeight: 4284,
      Orientation: 1,
    }
    const plain = lensCheck({ exif: sensorOnly, decodedWidth: 5712, decodedHeight: 4284 })
    const zoomed = lensCheck({ exif: { ...sensorOnly, DigitalZoomRatio: 2 }, decodedWidth: 5712, decodedHeight: 4284 })
    expect(plain.source).toBe('focal+sensor')
    expect(plain.hfov).toBeCloseTo(59.8, 1)
    expect(Math.tan((zoomed.hfov! * Math.PI) / 360)).toBeCloseTo(Math.tan((plain.hfov! * Math.PI) / 360) / 2, 6)
  })

  it('flags a photo cropped after it was taken, giving the uncropped lens as an upper bound', () => {
    const lens = lensCheck({ exif: iphone, decodedWidth: 3000, decodedHeight: 3000 })
    expect(lens.cropped).toBe(true)
    expect(lens.hfov).toBeCloseTo(53.1, 1)
    expect(lens.note).toMatch(/cropped: lens unknown \(3000×3000 against 4284×5712 taken; at most the tagged lens\)/)
    const resized = lensCheck({ exif: iphone, decodedWidth: 1071, decodedHeight: 1428 })
    // The same shape at a quarter the size: resized, its lens as tagged, never searched as a crop.
    expect(resized.cropped).toBe(false)
    expect(resized.resized).toBe(true)
    expect(resized.hfov).toBeCloseTo(lens.hfov!, 9)
    expect(resized.note).toMatch(/resized to 1071×1428 from 4284×5712: the lens is as tagged/)
  })

  it('says when the tags give no lens', () => {
    const lens = lensCheck({ exif: {}, decodedWidth: 4000, decodedHeight: 3000 })
    expect(lens).toMatchObject({ hfov: null, vfov: null, source: 'unknown', cropped: false })
    expect(lens.note).toBe('no lens in the photo’s tags')
  })
})
