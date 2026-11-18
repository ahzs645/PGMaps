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

it('keeps a pair matched mostly on distant ground, whose points have no parallax to take sides with', () => {
  const from: OverlapCamera = { ...reference, bearing: 12, pitch: -6, roll: 0 }
  const to: OverlapCamera = { ...from, lng: from.lng + 0.0005, lat: from.lat + 0.0003, bearing: 9, pitch: -5, roll: 1 }
  const matches: ImageMatch[] = []
  const add = (lng: number, lat: number, height: number) => {
    const a = projectToPhoto(from, lng, lat, height)
    const b = projectToPhoto(to, lng, lat, height)
    if (a && b && [a, b].every(({ x, y }) => x >= 0 && x < from.width && y >= 0 && y < from.height))
      matches.push([
        [a.x, a.y],
        [b.x, b.y],
      ])
  }
  // A far range 44 km off, then a strip of near ground under it.
  for (let y = 0; y < 8; y++)
    for (let x = -8; x <= 8; x++) add(from.lng + 0.1 + x * 0.03, from.lat + 0.4, 900 + 160 * y + 40 * Math.sin(x))
  for (let y = 0; y < 3; y++)
    for (let x = -4; x <= 4; x++)
      add(from.lng + 0.006 + x * 0.002, from.lat + 0.02 + y * 0.004, 450 + 60 * Math.sin(x * 1.3 + y))
  expect(matches.length).toBeGreaterThan(100)
  const proposal = relativePhotoPose(from, { ...to, bearing: 200, pitch: 0, roll: 0 }, matches)
  expect(proposal?.pose.bearing).toBeCloseTo(to.bearing, 0)
  expect(proposal?.pose.pitch).toBeCloseTo(to.pitch, 0)
  expect(proposal?.pose.roll).toBeCloseTo(to.roll, 0)
})
