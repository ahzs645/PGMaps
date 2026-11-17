import { describe, expect, it } from 'vitest'

import { buildHitBuffer } from './photoHitBuffer'
import { hitBufferElevation, planPointToPhoto } from './photoLinkedCursor'
import { projectToPhoto, type PhotoPose } from './photoPose'

const RAD = Math.PI / 180
// A made-up place; nothing here is a real photo's.
const LNG = -122.5,
  LAT = 53.7
const mx = 111320 * Math.cos(LAT * RAD)
const at = (east: number, north: number) => ({ lng: LNG + east / mx, lat: LAT + north / 110574 })
const north = (lat: number) => (lat - LAT) * 110574

const plane = { elevationAt: () => 800 }
// Level ground at 800 m with an east–west ridge 400 m high 3 km north.
const ridge = { elevationAt: (_lng: number, lat: number) => 800 + 400 * Math.exp(-(((north(lat) - 3000) / 300) ** 2)) }

const camera: PhotoPose = {
  lng: LNG,
  lat: LAT,
  altitudeMeters: 1500,
  bearing: 0,
  pitch: -20,
  roll: 0,
  width: 600,
  height: 450,
  focalPx: 600 / 2 / Math.tan(30 * RAD),
  k1: 0,
  k2: 0,
}

describe('the linked cursor', () => {
  it('puts a ground point where the camera sees it', () => {
    const point = at(200, 2000)
    const expected = projectToPhoto(camera, point.lng, point.lat, 800)!
    const found = planPointToPhoto(camera, point.lng, point.lat, plane, null)!
    expect(found.x).toBeCloseTo(expected.x, 6)
    expect(found.y).toBeCloseTo(expected.y, 6)
    expect(found.inSight).toBe(true)
  })

  it('says when nearer terrain hides the point', () => {
    const buf = buildHitBuffer(camera, ridge, { width: 150 })
    const front = at(0, 1500),
      behind = at(0, 4500)
    expect(planPointToPhoto(camera, front.lng, front.lat, ridge, buf)?.inSight).toBe(true)
    expect(planPointToPhoto(camera, behind.lng, behind.lat, ridge, buf)?.inSight).toBe(false)
  })

  it('reads the ground from the hit buffer when no terrain is given', () => {
    const buf = buildHitBuffer(camera, plane, { width: 150 })
    const point = at(100, 2500)
    expect(hitBufferElevation(buf, point.lng, point.lat)).toBeCloseTo(800, 3)
    const found = planPointToPhoto(camera, point.lng, point.lat, null, buf)!
    const expected = projectToPhoto(camera, point.lng, point.lat, 800)!
    expect(found.x).toBeCloseTo(expected.x, 3)
    // Behind the camera, and with nothing to stand it on, there is no cursor.
    const behindCamera = at(0, -2000)
    expect(planPointToPhoto(camera, behindCamera.lng, behindCamera.lat, plane, null)).toBeNull()
    const far = at(0, 60_000)
    expect(planPointToPhoto(camera, far.lng, far.lat, null, buf)).toBeNull()
  })
})
