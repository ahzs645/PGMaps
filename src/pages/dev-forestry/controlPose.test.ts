import { describe, expect, it } from 'vitest'
import { landmarkAngles, orientationFromPairs, pairsNeeded, solveFromControls, type ControlPair } from './controlPose'
import { cameraAxes, projectToPhoto, type PhotoPose } from './photoPose'

const RAD = Math.PI / 180
const camera = (bearing: number, pitch: number, roll: number, extra: Partial<PhotoPose> = {}) => {
  const hfov = 60
  return {
    lng: -122.5,
    lat: 53.7,
    altitudeMeters: 1500,
    bearing,
    pitch,
    roll,
    width: 1050,
    height: 788,
    focalPx: 1050 / 2 / Math.tan((hfov * RAD) / 2),
    k1: 0,
    k2: 0,
    hfov,
    ...extra,
  }
}
const truth = camera(118, -18, 4)
// Invented ground spots: rays through pixels spread over the frame, ending on ground at 760–1010 m.
const ground = [
  [150, 500, 820],
  [880, 450, 900],
  [500, 700, 760],
  [300, 350, 1010],
  [950, 720, 790],
  [600, 300, 950],
].map(([u, v, elevation]) => {
  const { right, down, forward } = cameraAxes(truth)
  const nx = (u - truth.width / 2) / truth.focalPx,
    ny = (v - truth.height / 2) / truth.focalPx
  const ray = [0, 1, 2].map((k) => forward[k] + nx * right[k] + ny * down[k])
  const t = (elevation - truth.altitudeMeters) / ray[2]
  return [truth.lng + (t * ray[0]) / (111320 * Math.cos(truth.lat * RAD)), truth.lat + (t * ray[1]) / 110574, elevation]
})
const pairsFor = (pose: PhotoPose, noise = 0): ControlPair[] =>
  ground.map(([lng, lat, elevation], i) => {
    const q = projectToPhoto(pose, lng, lat, elevation)!
    const jitter = noise ? [Math.sin(i * 7.1) * noise, Math.cos(i * 3.3) * noise] : [0, 0]
    return { id: `p${i}`, pixel: [q.x + jitter[0], q.y + jitter[1]], lng, lat, elevation }
  })

describe('camera from paired points', () => {
  it('every spot is in the frame of the true camera', () => {
    for (const pair of pairsFor(truth)) {
      expect(pair.pixel[0]).toBeGreaterThan(0)
      expect(pair.pixel[0]).toBeLessThan(truth.width)
      expect(pair.pixel[1]).toBeGreaterThan(0)
      expect(pair.pixel[1]).toBeLessThan(truth.height)
    }
  })

  it('gets heading, pitch and roll in closed form from two pairs, with no skyline and no starting heading', () => {
    const angles = orientationFromPairs(truth, pairsFor(truth).slice(0, 2))!
    expect(angles.bearing).toBeCloseTo(118, 6)
    expect(angles.pitch).toBeCloseTo(-18, 6)
    expect(angles.roll).toBeCloseTo(4, 6)
  })

  it('solves from a start 120° out, with pixel noise and a 40 m GPS error, and measures each pair held out', () => {
    const start = camera(238, 0, 0, { lng: -122.5 + 40 / (111320 * Math.cos(53.7 * RAD)) })
    const result = solveFromControls({ start, pairs: pairsFor(truth, 1.5) })!
    expect(result.start).toBe('closed-form')
    expect(Math.abs(((result.pose.bearing - 118 + 540) % 360) - 180)).toBeLessThan(0.3)
    expect(result.pose.pitch).toBeCloseTo(-18, 0)
    expect(result.pose.roll).toBeCloseTo(4, 0)
    expect(result.rmsPx).toBeLessThan(3)
    expect(result.pairs.every((pair) => pair.heldOutPx !== null && pair.heldOutPx < 10)).toBe(true)
    expect(result.heldOutMetresMax).toBeGreaterThan(0)
    expect(result.heldOutMetresMax).toBeLessThan(60)
  })

  it('keeps a fixed unknown and a prior, and refuses too few pairs for the free unknowns', () => {
    const start = camera(118, -18, 0)
    const rollFixed = solveFromControls({ start, pairs: pairsFor(truth), unknowns: { roll: { mode: 'fixed' } } })!
    expect(rollFixed.pose.roll).toBe(0)
    const lensFree = solveFromControls({ start, pairs: pairsFor(truth), unknowns: { hfov: { mode: 'free' } } })!
    expect(lensFree.pose.hfov).toBeCloseTo(60, 1)
    expect(pairsNeeded()).toBe(2)
    expect(
      pairsNeeded({ east: { mode: 'free' }, north: { mode: 'free' }, up: { mode: 'free' }, hfov: { mode: 'free' } }),
    ).toBe(4)
    expect(solveFromControls({ start, pairs: pairsFor(truth).slice(0, 1) })).toBeNull()
  })

  it('turns a landmark at the photo centre into the heading and pitch that look at it', () => {
    const centre = { lng: -122.46, lat: 53.69, elevation: 850 }
    const look = landmarkAngles(truth, centre)
    const q = projectToPhoto(
      { ...truth, bearing: look.bearing, pitch: look.pitch, roll: 0 },
      centre.lng,
      centre.lat,
      centre.elevation,
    )!
    expect(q.x).toBeCloseTo(truth.width / 2, 3)
    expect(q.y).toBeCloseTo(truth.height / 2, 3)
    expect(look.pitch).toBeLessThan(0)
    expect(look.distanceMeters).toBeGreaterThan(1000)
  })
})
