import { expect, it } from 'vitest'
import { verifyFeatureOverlap } from './photoFeatureGeometry'
import type { ImageMatch, OverlapCamera } from './photoOverlap'
import { projectToPhoto } from './photoPose'
import { relativePhotoPose } from './photoRelativePose'

const reference: OverlapCamera = {
  lng: -123,
  lat: 54,
  altitudeMeters: 1150,
  bearing: 12,
  pitch: -22,
  roll: 5,
  width: 1050,
  height: 788,
  hfov: 52,
  focalPx: 1076,
  k1: 0,
  k2: 0,
}
const target = {
  ...reference,
  lng: reference.lng + 0.003,
  lat: reference.lat + 0.001,
  altitudeMeters: 1175,
  bearing: 5,
  pitch: -19,
  roll: -2,
}
function correspondences() {
  const matches: ImageMatch[] = []
  for (let y = 0; y < 10; y++)
    for (let x = 0; x < 11; x++) {
      const lng = reference.lng + (x - 4) * 0.003
      const lat = reference.lat + 0.012 + y * 0.002
      const height = 400 + 170 * Math.sin(x * 1.7 + y * 0.9)
      const a = projectToPhoto(reference, lng, lat, height)
      const b = projectToPhoto(target, lng, lat, height)
      if (a && b && [a, b].every(({ x, y }) => x >= 0 && x < reference.width && y >= 0 && y < reference.height))
        matches.push([
          [a.x, a.y],
          [b.x, b.y],
        ])
    }
  return matches
}

it('uses spatially held-out image geometry to recover a camera orientation while retaining its GPS', () => {
  const points = correspondences()
  expect(points.length).toBeGreaterThan(40)
  const overlap = verifyFeatureOverlap(points, reference, target)
  expect(overlap.matches.length).toBeGreaterThan(35)
  const proposal = relativePhotoPose(reference, { ...target, bearing: 170, pitch: -5, roll: 20 }, overlap.matches)
  expect(proposal?.pose.bearing).toBeCloseTo(target.bearing, 1)
  expect(proposal?.pose.pitch).toBeCloseTo(target.pitch, 1)
  expect(proposal?.pose.roll).toBeCloseTo(target.roll, 1)
  expect(proposal?.pose.lng).toBe(target.lng)
  expect(proposal?.p90Px).toBeLessThan(1)
})

it('does not return an orientation from features confined to a row', () => {
  const thin: ImageMatch[] = correspondences().map(([[x], [u]]) => [
    [x, 100],
    [u, 120],
  ])
  expect(verifyFeatureOverlap(thin, reference, target).matches).toEqual([])
  expect(relativePhotoPose(reference, target, thin)).toBeNull()
})
