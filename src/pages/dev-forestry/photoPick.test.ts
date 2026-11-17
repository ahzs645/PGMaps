import { describe, expect, it } from 'vitest'

import { buildHitBuffer, hitAt } from './photoHitBuffer'
import { pixelsInFeature, preparePickLayer, readPhotoPixel } from './photoPick'
import type { PhotoPose } from './photoPose'
import type { PolygonGeometry } from './visibility'

const RAD = Math.PI / 180
// A made-up place; nothing here is a real photo's.
const LNG = -122.5,
  LAT = 53.7
const mx = 111320 * Math.cos(LAT * RAD)
const at = (east: number, north: number): [number, number] => [LNG + east / mx, LAT + north / 110574]
const local = (lng: number, lat: number) => [(lng - LNG) * mx, (lat - LAT) * 110574] as const

// Ground rising 20 % to the east: it faces (falls towards) the west.
const tilted = {
  elevationAt(lng: number, lat: number) {
    const [east] = local(lng, lat)
    return 800 + 0.2 * east
  },
}

const pose: PhotoPose = {
  lng: LNG,
  lat: LAT,
  altitudeMeters: 1400,
  bearing: 90,
  pitch: -15,
  roll: 0,
  width: 600,
  height: 450,
  focalPx: 600 / 2 / Math.tan(30 * RAD),
  k1: 0,
  k2: 0,
}

const square = (east: number, north: number, half: number): PolygonGeometry => ({
  type: 'Polygon',
  coordinates: [
    [
      at(east - half, north - half),
      at(east + half, north - half),
      at(east + half, north + half),
      at(east - half, north + half),
      at(east - half, north - half),
    ],
  ],
})

describe('readPhotoPixel', () => {
  const buf = buildHitBuffer(pose, tilted, { width: 200 })
  const centre = hitAt(buf, pose.width / 2, pose.height / 2)!
  const [ce, cn] = local(centre.lng, centre.lat)

  it('reads distance, elevation, slope and aspect from the hit and its neighbours', () => {
    const reading = readPhotoPixel(buf, pose.width / 2, pose.height / 2)!
    expect(reading.distanceMeters).toBeCloseTo(centre.distanceMeters, 3)
    expect(reading.elevation).toBeCloseTo(centre.elevation, 3)
    expect(reading.slopePercent!).toBeCloseTo(20, 0)
    expect(reading.aspectDegrees!).toBeCloseTo(270, 0)
    expect(reading.features).toEqual([])
  })

  it('names the feature of each layer the ground lies in', () => {
    const blocks = preparePickLayer('proposedBlocks', [
      { id: 'elsewhere', label: 'Elsewhere', geometry: square(ce + 5000, cn, 100) },
      { id: 'block-1', label: 'Block 1', geometry: square(ce, cn, 120) },
    ])
    const units = preparePickLayer('sensitivityUnits', [{ id: 'unit', geometry: square(ce + 9000, cn, 100) }])
    const reading = readPhotoPixel(buf, pose.width / 2, pose.height / 2, [blocks, units])!
    expect(reading.features).toEqual([{ layer: 'proposedBlocks', index: 1, id: 'block-1', label: 'Block 1' }])
  })

  it('reads nothing for sky or off the photo', () => {
    // Looking downhill, the top of the frame is sky.
    const west = buildHitBuffer({ ...pose, bearing: 270 }, tilted, { width: 100 })
    expect(readPhotoPixel(west, pose.width / 2, 1)).toBeNull()
    expect(readPhotoPixel(buf, -5, pose.height / 2)).toBeNull()
  })

  it('leaves the slope unknown where too few neighbours share the surface', () => {
    const nan = Number.NaN
    // One hit with sky all round it.
    const lonely = {
      width: 3,
      height: 3,
      photoWidth: 3,
      photoHeight: 3,
      poseKey: 'made-up',
      lng: new Float64Array([nan, nan, nan, nan, LNG, nan, nan, nan, nan]),
      lat: new Float64Array([nan, nan, nan, nan, LAT, nan, nan, nan, nan]),
      distance: new Float32Array([nan, nan, nan, nan, 900, nan, nan, nan, nan]),
      elevation: new Float32Array([nan, nan, nan, nan, 800, nan, nan, nan, nan]),
    }
    const reading = readPhotoPixel(lonely, 1.5, 1.5)!
    expect(reading.elevation).toBe(800)
    expect(reading.slopePercent).toBeNull()
    expect(reading.aspectDegrees).toBeNull()
  })
})

describe('pixelsInFeature', () => {
  const buf = buildHitBuffer(pose, tilted, { width: 200 })
  const centre = hitAt(buf, pose.width / 2, pose.height / 2)!
  const [ce, cn] = local(centre.lng, centre.lat)
  const blocks = preparePickLayer('proposedBlocks', [
    { id: 'a', geometry: square(ce, cn, 150) },
    { id: 'b', geometry: square(ce, cn + 600, 150) },
  ])

  it('marks exactly the pixels whose ground lies in the polygons', () => {
    const mask = pixelsInFeature(buf, blocks.prepared)
    let inside = 0
    for (let i = 0; i < mask.length; i++) {
      const expected = Number.isFinite(buf.lng[i]) && blocks.prepared.contains(buf.lng[i], buf.lat[i]) ? 1 : 0
      expect(mask[i]).toBe(expected)
      inside += mask[i]
    }
    expect(inside).toBeGreaterThan(50)
  })

  it('marks one polygon alone when given its index', () => {
    const all = pixelsInFeature(buf, blocks.prepared)
    const a = pixelsInFeature(buf, blocks.prepared, 0)
    const b = pixelsInFeature(buf, blocks.prepared, 1)
    let sumA = 0,
      sumB = 0
    for (let i = 0; i < all.length; i++) {
      expect(a[i] + b[i]).toBe(all[i])
      sumA += a[i]
      sumB += b[i]
    }
    expect(sumA).toBeGreaterThan(0)
    expect(sumB).toBeGreaterThan(0)
  })
})
