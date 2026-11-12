import { describe, expect, it } from 'vitest'

import { offsetPosition } from './driveMath'
import {
  fovFrom35mmEquivalent,
  fovFromFocalLength,
  horizontalFovFromVertical,
  offsetFrom,
  ownPhotoPose,
  readExif,
  sensorSizeFromExif,
  startingPose,
  trueHeadingFromMagnetic,
  verticalFovFromHorizontal,
} from './exifPose'
import { projectToPhoto } from './photoPose'

const LANDSCAPE = { width: 4032, height: 3024 }

describe('field of view from a lens', () => {
  it('splits the 35 mm equivalent along the frame’s own diagonal', () => {
    // An iPhone main camera: 26 mm equivalent on a 4:3 frame.
    const fov = fovFrom35mmEquivalent(26, LANDSCAPE.width, LANDSCAPE.height)!
    expect(fov.horizontal).toBeCloseTo(67.3, 1)
    expect(fov.vertical).toBeCloseTo(53.1, 1)
    // Turning the frame swaps the two, because the equivalent is defined by the diagonal.
    const portrait = fovFrom35mmEquivalent(26, LANDSCAPE.height, LANDSCAPE.width)!
    expect(portrait.horizontal).toBeCloseTo(fov.vertical, 6)
    expect(portrait.vertical).toBeCloseTo(fov.horizontal, 6)
  })

  it('reads the sensor from the focal-plane resolution', () => {
    // 5.6 × 4.2 mm sensor written as pixels per inch.
    const tags = {
      FocalPlaneXResolution: 4032 / (5.6 / 25.4),
      FocalPlaneYResolution: 3024 / (4.2 / 25.4),
      FocalPlaneResolutionUnit: 2,
      ExifImageWidth: 4032,
      ExifImageHeight: 3024,
    }
    const sensor = sensorSizeFromExif(tags)!
    expect(sensor.widthMm).toBeCloseTo(5.6, 6)
    expect(sensor.heightMm).toBeCloseTo(4.2, 6)
    expect(fovFromFocalLength(4.25, sensor.widthMm, sensor.heightMm)!.horizontal).toBeCloseTo(66.8, 1)
    expect(sensorSizeFromExif({ ...tags, FocalPlaneResolutionUnit: 3 })!.widthMm).toBeCloseTo(5.6 / 2.54, 6)
  })

  it('refuses lenses no ordinary photo has', () => {
    expect(fovFrom35mmEquivalent(0, 100, 100)).toBeNull()
    expect(fovFrom35mmEquivalent(2000, 4000, 3000)).toBeNull()
    expect(fovFromFocalLength(1, 40, 30)).toBeNull()
  })

  it('converts between horizontal and vertical fields of view', () => {
    const vertical = verticalFovFromHorizontal(67.3, 4032, 3024)
    expect(vertical).toBeCloseTo(53.1, 1)
    expect(horizontalFovFromVertical(vertical, 4032, 3024)).toBeCloseTo(67.3, 9)
  })
})

describe('reading EXIF as suggestions', () => {
  it('takes position, true heading, lens, camera clock and camera', () => {
    const reading = readExif(
      {
        latitude: 53.917,
        longitude: -122.75,
        GPSImgDirection: 271.5,
        GPSImgDirectionRef: 'T',
        FocalLengthIn35mmFormat: 26,
        DateTimeOriginal: new Date(2026, 8, 30, 14, 5, 9),
        Make: 'Apple',
        Model: 'iPhone 15',
        GPSAltitude: 712.4,
        GPSAltitudeRef: 0,
      },
      LANDSCAPE,
    )
    expect(reading.position).toEqual({ lng: -122.75, lat: 53.917 })
    expect(reading.heading).toEqual({ degrees: 271.5, reference: 'true' })
    expect(reading.fov?.from).toBe('35mm')
    expect(reading.fov?.horizontal).toBeCloseTo(67.3, 1)
    expect(reading.takenAt).toBe('2026-09-30 14:05')
    expect(reading.camera).toBe('Apple iPhone 15')
    expect(reading.altitudeMeters).toBe(712.4)
  })

  it('marks a magnetic or unreferenced heading rather than calling it true', () => {
    expect(readExif({ GPSImgDirection: 10, GPSImgDirectionRef: 'M' }, LANDSCAPE).heading).toEqual({
      degrees: 10,
      reference: 'magnetic',
    })
    expect(readExif({ GPSImgDirection: 10, GPSImgDirectionRef: 'Magnetic North' }, LANDSCAPE).heading?.reference).toBe(
      'magnetic',
    )
    expect(readExif({ GPSImgDirection: 10 }, LANDSCAPE).heading?.reference).toBe('unknown')
    expect(trueHeadingFromMagnetic(350, 16.5)).toBeCloseTo(6.5, 9)
  })

  it('reads degrees, minutes and seconds with their hemisphere', () => {
    const reading = readExif(
      { GPSLatitude: [53, 55, 1.2], GPSLatitudeRef: 'N', GPSLongitude: [122, 45, 0], GPSLongitudeRef: 'W' },
      LANDSCAPE,
    )
    expect(reading.position!.lat).toBeCloseTo(53 + 55 / 60 + 1.2 / 3600, 9)
    expect(reading.position!.lng).toBeCloseTo(-122.75, 9)
  })

  it('ignores a GPS fix written as 0, 0 and a below-sea-level reference flips altitude', () => {
    const reading = readExif({ latitude: 0, longitude: 0, GPSAltitude: 12, GPSAltitudeRef: 1 }, LANDSCAPE)
    expect(reading.position).toBeNull()
    expect(reading.altitudeMeters).toBe(-12)
    expect(readExif({ GPSAltitude: 12, GPSAltitudeRef: Uint8Array.of(1) }, LANDSCAPE).altitudeMeters).toBe(-12)
  })

  it('turns the real-lens field of view with a quarter-turned photo', () => {
    const tags = {
      FocalLength: 4.25,
      FocalPlaneXResolution: 4032 / (5.6 / 25.4),
      FocalPlaneYResolution: 3024 / (4.2 / 25.4),
      FocalPlaneResolutionUnit: 2,
      ExifImageWidth: 4032,
      ExifImageHeight: 3024,
    }
    const upright = readExif(tags, LANDSCAPE).fov!
    const turned = readExif({ ...tags, Orientation: 6 }, { width: 3024, height: 4032 }).fov!
    expect(upright.from).toBe('focal-plane')
    expect(turned.horizontal).toBeCloseTo(upright.vertical, 9)
    expect(turned.vertical).toBeCloseTo(upright.horizontal, 9)
  })

  it('reads a camera-clock string', () => {
    expect(readExif({ DateTimeOriginal: '2025:07:14 09:30:00' }, LANDSCAPE).takenAt).toBe('2025-07-14 09:30')
    expect(readExif({ DateTimeOriginal: '0000:00:00 00:00:00' }, LANDSCAPE).takenAt).toBeNull()
    expect(readExif(null, LANDSCAPE).position).toBeNull()
  })
})

describe('the pose a lined-up photo starts from', () => {
  const roadView = { lng: -122.7, lat: 53.9, bearing: 95, hfov: 61 }

  it('starts from the road view when the photo has no EXIF, level, at the settings’ eye height', () => {
    const start = startingPose({ exif: readExif({}, LANDSCAPE), roadView, eyeHeightMeters: 1.6 })
    expect(start.pose).toEqual({
      lng: -122.7,
      lat: 53.9,
      bearing: 95,
      pitch: 0,
      roll: 0,
      hfov: 61,
      eyeHeightMeters: 1.6,
    })
    expect(start.sources).toMatchObject({
      position: 'road-view',
      heading: 'road-view',
      fov: 'road-view',
      pitch: 'level',
    })
    expect(start.headingReference).toBeNull()
  })

  it('prefers EXIF to the road view, and keeps a magnetic heading marked', () => {
    const exif = readExif(
      {
        latitude: 53.95,
        longitude: -122.8,
        GPSImgDirection: 200,
        GPSImgDirectionRef: 'M',
        FocalLengthIn35mmFormat: 26,
      },
      LANDSCAPE,
    )
    const start = startingPose({ exif, roadView, eyeHeightMeters: 1.6 })
    expect(start.pose.lng).toBe(-122.8)
    expect(start.pose.bearing).toBe(200)
    expect(start.pose.hfov).toBeCloseTo(67.3, 1)
    expect(start.sources).toMatchObject({ position: 'exif', heading: 'exif', fov: 'exif' })
    expect(start.headingReference).toBe('magnetic')
  })

  it('prefers a field record’s checked camera to EXIF', () => {
    const exif = readExif(
      { latitude: 53.95, longitude: -122.8, GPSImgDirection: 200, GPSImgDirectionRef: 'T' },
      LANDSCAPE,
    )
    const record = { lng: -122.81, lat: 53.951, bearing: 205, pitch: 2, roll: -1, hfov: 70 }
    const start = startingPose({ exif, record, roadView, eyeHeightMeters: 1.6 })
    expect(start.pose).toMatchObject({ lng: -122.81, lat: 53.951, bearing: 205, pitch: 2, roll: -1, hfov: 70 })
    expect(start.sources).toMatchObject({ position: 'record', heading: 'record', pitch: 'record', fov: 'record' })
    expect(start.headingReference).toBe('true')
  })

  it('leaves the position unknown when nothing gives one', () => {
    const start = startingPose({ exif: null, roadView: null, eyeHeightMeters: 1.6 })
    expect(start.pose.lng).toBeNull()
    expect(start.sources.position).toBeNull()
    expect(start.sources.fov).toBe('default')
  })
})

describe('the lined-up camera', () => {
  it('puts the bearing at the photo’s centre and half the field of view at its edge', () => {
    const pose = ownPhotoPose(
      { lng: -122.75, lat: 53.9, bearing: 90, pitch: 0, roll: 0, hfov: 60, eyeHeightMeters: 1.6 },
      700,
      1600,
      1200,
    )
    expect(pose.altitudeMeters).toBeCloseTo(701.6, 9)
    const metresPerLng = 111320 * Math.cos((53.9 * Math.PI) / 180)
    // 1 km due east at eye level: the centre of the frame (curvature drops it a hair).
    const ahead = projectToPhoto(pose, -122.75 + 1000 / metresPerLng, 53.9, 701.6)!
    expect(ahead.x).toBeCloseTo(800, 6)
    expect(ahead.y).toBeGreaterThan(600)
    expect(ahead.y).toBeLessThan(600.2)
    // 30° right of the axis lands on the right edge.
    const right = Math.tan((30 * Math.PI) / 180) * 1000
    const edge = projectToPhoto(pose, -122.75 + 1000 / metresPerLng, 53.9 - right / 110574, 701.6)!
    expect(edge.x).toBeCloseTo(1600, -1)
  })

  it('stands the walker on the photo’s spot', () => {
    const road = { lng: -122.75, lat: 53.9 }
    const photo = { lng: -122.7462, lat: 53.9031 }
    const placed = offsetPosition(road, offsetFrom(road, photo))
    expect(placed.lng).toBeCloseTo(photo.lng, 9)
    expect(placed.lat).toBeCloseTo(photo.lat, 9)
  })
})
