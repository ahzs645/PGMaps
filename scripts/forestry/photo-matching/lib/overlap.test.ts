import assert from 'node:assert/strict'
import { test } from 'node:test'
import { projectToPhoto } from '../../../../src/pages/dev-forestry/photoPose'
import { castRay } from '../../../../src/pages/dev-forestry/photoViews'
import { transferCamera, type ImageMatch } from './overlap'

const camera = {
  lng: -122.5,
  lat: 54,
  altitudeMeters: 1250,
  bearing: 36,
  pitch: -36,
  roll: 2,
  width: 1050,
  height: 788,
  hfov: 54,
  focalPx: 525 / Math.tan((27 * Math.PI) / 180),
  k1: 0,
  k2: 0,
}
const target = {
  ...camera,
  lng: camera.lng + 0.0004,
  lat: camera.lat + 0.00012,
  altitudeMeters: 1255,
  bearing: 40,
  pitch: -34.5,
  roll: -1,
}
const terrain = {
  elevationAt: (lng: number, lat: number) => 780 + 120 * Math.sin((lng + 122.5) * 60) * Math.cos((lat - 54) * 100),
}
const mapped: ImageMatch[] = Array.from({ length: 40 }, (_, i) => {
  const pixel: [number, number] = [105 + (i % 8) * 121, 115 + Math.floor(i / 8) * 144]
  const hit = castRay(camera, terrain, ...pixel)!
  const q = projectToPhoto(target, hit.lng, hit.lat, hit.elevation)!
  return [pixel, [q.x, q.y]]
})

test('recovers the target camera from overlapping terrain with a wrong baseline heading and bad matches', () => {
  const corrupted = mapped.map((match, i): ImageMatch => (i % 17 === 0 ? [match[0], [15, 760 - i * 13]] : match))
  const fit = transferCamera(camera, { ...target, bearing: 140 }, terrain, corrupted)
  assert.equal(fit.status, 'candidate')
  assert.ok(fit.pose)
  assert.ok(Math.abs(fit.pose.bearing - target.bearing) < 0.1)
  assert.ok(Math.abs(fit.pose.pitch - target.pitch) < 0.1)
  assert.ok(fit.fixed.medianPx < 1)
  assert.ok(fit.regions >= 3)
  assert.ok(fit.baseline.medianPx > 50)
})

test('uses held-out regions to choose a useful adjustment for a biased GPS fix', () => {
  const fit = transferCamera(
    camera,
    { ...target, lng: target.lng + 0.00016, altitudeMeters: target.altitudeMeters + 4 },
    terrain,
    mapped,
  )
  assert.equal(fit.status, 'candidate')
  assert.equal(fit.model, 'adjusted')
  assert.ok(fit.adjusted)
  assert.ok(fit.adjusted.p90Px < fit.fixed.p90Px)
  assert.ok(fit.adjusted.medianPx < 2)
})

test('rejects a strip of matches and a reference facing away from the photographed ground', () => {
  assert.equal(transferCamera(camera, target, terrain, mapped.slice(0, 8)).status, 'insufficient')
  const wrong = transferCamera({ ...camera, bearing: 216 }, target, terrain, mapped)
  // A wrong reference could also be internally consistent. It is never approved by this fit.
  assert.ok(wrong.status !== 'candidate' || Math.abs(wrong.pose!.bearing - target.bearing) > 30)
})

test('rejects a set of geometrically inconsistent ground correspondences', () => {
  const scrambled = mapped.map((match, i): ImageMatch => [match[0], mapped[(i * 7 + 11) % mapped.length][1]])
  assert.notEqual(transferCamera(camera, target, terrain, scrambled).status, 'candidate')
})
