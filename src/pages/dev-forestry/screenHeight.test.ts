import { describe, expect, it } from 'vitest'

import {
  SCREEN_HEIGHT_MAX_METERS,
  SCREEN_HEIGHT_NEAR_EYE_METERS,
  hiddenShareAt,
  screenHeightForShare,
  screenHeightReading,
  screenHeightSteps,
  type ScreenHeightInput,
  type ScreenHeightSample,
} from './screenHeight'
import type { ElevationSource } from '@/lib/forestry/terrain/terrain'
import { earthCurvatureDropMeters, metersPerDegree, pointInPolygon } from './visibility'

const LNG = -122.75
const LAT = 53.9
const scale = metersPerDegree(LAT)
/** Local metres east/north of the eye, to longitude/latitude. */
const at = (east: number, north: number): [number, number] => [LNG + east / scale.lng, LAT + north / scale.lat]
const east = (lng: number) => (lng - LNG) * scale.lng

/** Ground as a function of metres east of the eye. */
const terrain = (height: (east: number) => number): ElevationSource => ({
  elevationAt: (lng) => height(east(lng)),
})

const square = (west: number, eastEdge: number, south: number, north: number): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [[at(west, south), at(eastEdge, south), at(eastEdge, north), at(west, north), at(west, south)]],
})

/** A block 200 m deep, 1000–1200 m east of the eye. */
const BLOCK = square(1000, 1200, -100, 100)
const EYE = { lng: LNG, lat: LAT, heightAboveGroundMeters: 1.6 }

const input = (patch: Partial<ScreenHeightInput> = {}): ScreenHeightInput => ({
  eye: EYE,
  block: BLOCK,
  elevation: terrain(() => 500),
  sampleSpacingMeters: 40,
  stepMeters: 2,
  ...patch,
})

/**
 * The run's sightline (`testSightline`): the screen a sample at `distance` needs at `d` along its line over ground
 * `ground`, with the 0.5 m clearance, the eye at `eye` and the target ground at `target`.
 */
function expectedClearance(eye: number, target: number, distance: number, d: number, ground: number, k = 0.13) {
  const slope = (target - earthCurvatureDropMeters(distance, k) - eye) / distance
  return eye + slope * d + earthCurvatureDropMeters(d, k) + 0.5 - ground
}

describe('screenHeightReading', () => {
  it('on a flat plain, needs a screen at the block edge as tall as the sightline stands there', () => {
    const reading = screenHeightReading(input())
    expect(reading.counts.total).toBe(25)
    expect(reading.counts.visible).toBe(25)
    expect(reading.counts.terrainHidden + reading.counts.unknown + reading.counts.unscreenable).toBe(0)
    expect(reading.eyeElevationMeters).toBeCloseTo(501.6, 6)
    for (const sample of reading.samples) {
      // The screen stands on the last step outside the block: the edge, where the line is lowest.
      const edge = (1000 / east(sample.lng)) * sample.distanceMeters
      expect(sample.atMeters!).toBeLessThanOrEqual(edge + 1e-6)
      expect(sample.atMeters!).toBeGreaterThan(edge - 2 * 1.01)
      expect(pointInPolygon(BLOCK, sample.atLng!, sample.atLat!)).toBe(false)
      expect(sample.minClearanceMeters!).toBeCloseTo(
        expectedClearance(501.6, 500, sample.distanceMeters, sample.atMeters!, 500),
        6,
      )
      // Without curvature, 2.1 m less the eye's 1.6 m spread over the line: within a centimetre here.
      expect(sample.minClearanceMeters!).toBeCloseTo(2.1 - (1.6 * sample.atMeters!) / sample.distanceMeters, 1)
    }
    // Nearer samples need a taller screen at the edge: 2.1 − 1.6 × 1000/1020 ≈ 0.53 m against ≈ 0.79 m at 1180 m.
    const sorted = [...reading.samples].sort((a, b) => a.distanceMeters - b.distanceMeters)
    expect(sorted[0].minClearanceMeters!).toBeLessThan(sorted[sorted.length - 1].minClearanceMeters!)
    expect(reading.curve).toHaveLength(SCREEN_HEIGHT_MAX_METERS + 1)
    expect(reading.curve[0].hiddenOfVisiblePercent).toBe(0)
    expect(reading.curve[1].hiddenOfVisiblePercent).toBe(100)
    expect(reading.terrainHiddenPercent).toBe(0)
    expect(reading.screenFor.half!).toBeGreaterThan(0.5)
    expect(reading.screenFor.ninety!).toBeLessThan(0.8)
    expect(reading.screenFor.half!).toBeLessThanOrEqual(reading.screenFor.threeQuarters!)
  })

  it('reads the screen off a low ridge between the eye and the block, and calls a taller ridge terrain', () => {
    const ridge = (top: number) => terrain((x) => (x >= 500 && x <= 520 ? 500 + top : 500))
    const low = screenHeightReading(input({ elevation: ridge(1) }))
    expect(low.counts.visible).toBe(25)
    for (const sample of low.samples) {
      // The line crosses the ridge where its east coordinate is 500–520 m: the screen stands on the ridge's far edge.
      const ridgeFar = (520 / east(sample.lng)) * sample.distanceMeters
      expect(sample.atMeters!).toBeGreaterThan(ridgeFar - 2 * 1.01)
      expect(sample.atMeters!).toBeLessThanOrEqual(ridgeFar + 1e-6)
      expect(sample.minClearanceMeters!).toBeCloseTo(
        expectedClearance(501.6, 500, sample.distanceMeters, sample.atMeters!, 501),
        6,
      )
      // 2.1 − 1.6 × 520/1020 − 1 ≈ 0.28 m for the nearest row, below the 0.53 m the block edge would need.
      expect(sample.minClearanceMeters!).toBeLessThan(0.45)
    }
    const tall = screenHeightReading(input({ elevation: ridge(3) }))
    expect(tall.counts.terrainHidden).toBe(25)
    expect(tall.terrainHiddenPercent).toBe(100)
    expect(tall.curve.every((point) => point.hiddenOfVisiblePercent === null)).toBe(true)
    expect(tall.curve.every((point) => point.hiddenOfKnownPercent === 100)).toBe(true)
    expect(tall.screenFor).toEqual({ half: null, threeQuarters: null, ninety: null })
  })

  it('on a slope falling faster than the sightline, needs the screen just past the eye clearing', () => {
    // 700 m at the eye, falling 20% to 500 m at the block; the line to the block falls only about 18%.
    const valley = terrain((x) => (x < 1000 ? 700 - 0.2 * x : 500))
    const reading = screenHeightReading(input({ elevation: valley }))
    expect(reading.counts.visible).toBe(25)
    for (const sample of reading.samples) {
      expect(sample.atMeters!).toBeGreaterThanOrEqual(SCREEN_HEIGHT_NEAR_EYE_METERS)
      expect(sample.atMeters!).toBeLessThan(SCREEN_HEIGHT_NEAR_EYE_METERS + 2 * 1.01)
      const groundThere = 700 - 0.2 * east(sample.atLng!)
      expect(sample.minClearanceMeters!).toBeCloseTo(
        expectedClearance(701.6, 500, sample.distanceMeters, sample.atMeters!, groundThere),
        3,
      )
    }
    // About 2.1 + 0.017 × 50 ≈ 2.9 m on the centre line; a wider road clearing pushes it out and up.
    const wider = screenHeightReading(input({ elevation: valley, nearEyeExclusionMeters: 150 }))
    for (const [i, sample] of wider.samples.entries()) {
      expect(sample.atMeters!).toBeGreaterThanOrEqual(150)
      expect(sample.minClearanceMeters!).toBeGreaterThan(reading.samples[i].minClearanceMeters!)
    }
  })

  it('calls a sightline over missing ground unknown, never hidden or visible', () => {
    const gap = terrain((x) => (x >= 300 && x <= 320 ? Number.NaN : 500))
    const reading = screenHeightReading(input({ elevation: gap }))
    expect(reading.counts.unknown).toBe(25)
    expect(reading.counts.visible + reading.counts.terrainHidden).toBe(0)
    expect(reading.unknownPercent).toBeCloseTo(100, 6)
    expect(reading.terrainHiddenPercent).toBeNull()
    expect(reading.curve.every((p) => p.hiddenOfVisiblePercent === null && p.hiddenOfKnownPercent === null)).toBe(true)
    expect(reading.samples.every((s) => s.minClearanceMeters === null && s.atMeters === null)).toBe(true)
    // A known obstruction settles it even where other ground is missing, as in the run.
    const gapAndRidge = terrain((x) => (x >= 300 && x <= 320 ? Number.NaN : x >= 500 && x <= 520 ? 510 : 500))
    expect(screenHeightReading(input({ elevation: gapAndRidge })).counts.terrainHidden).toBe(25)
    // Missing ground under the eye leaves every sample unknown.
    const noEye = terrain((x) => (Math.abs(x) < 0.5 ? Number.NaN : 500))
    const blind = screenHeightReading(input({ elevation: noEye }))
    expect(blind.eyeElevationMeters).toBeNull()
    expect(blind.counts.unknown).toBe(25)
    // A surveyed eye elevation needs no ground under the eye.
    expect(
      screenHeightReading(input({ elevation: noEye, eye: { ...EYE, eyeElevationMeters: 501.6 } })).counts.visible,
    ).toBe(25)
  })

  it('lets a screen stand inside the block only with screenZone anywhere, and never on the sample itself', () => {
    const outside = screenHeightReading(input())
    const anywhere = screenHeightReading(input({ screenZone: 'anywhere' }))
    expect(anywhere.screenZone).toBe('anywhere')
    let inside = 0
    for (const [i, sample] of anywhere.samples.entries()) {
      expect(sample.minClearanceMeters!).toBeLessThanOrEqual(outside.samples[i].minClearanceMeters!)
      // Half a sample spacing short of the sample: its own cell holds no screen.
      expect(sample.atMeters!).toBeLessThanOrEqual(sample.distanceMeters - 20 + 1e-6)
      expect(sample.atMeters!).toBeGreaterThan(sample.distanceMeters - 20 - 2 * 1.01)
      if (pointInPolygon(BLOCK, sample.atLng!, sample.atLat!)) inside++
    }
    // Every sample past the first row is screened from inside the block.
    expect(inside).toBeGreaterThanOrEqual(20)
    expect(anywhere.screenFor.half!).toBeLessThan(outside.screenFor.half!)
  })

  it('reads the earth falling away: flat ground 10 km off is hidden by the bulge, which a flat earth would show', () => {
    const far = square(10_000, 10_040, -20, 20)
    const flat = terrain(() => 500)
    const curved = screenHeightReading(input({ block: far, elevation: flat, stepMeters: 5, sampleSpacingMeters: 20 }))
    expect(curved.counts.terrainHidden).toBe(curved.counts.total)
    const level = screenHeightReading(
      input({ block: far, elevation: flat, stepMeters: 5, sampleSpacingMeters: 20, refractionCoefficient: 1 }),
    )
    expect(level.counts.visible).toBe(level.counts.total)
    // At 2 km the bulge only lowers the screen needed: drop(d) − (d/D)·drop(D) < 0 at every point of the line.
    const near = square(2_000, 2_040, -20, 20)
    const bent = screenHeightReading(input({ block: near, elevation: flat, sampleSpacingMeters: 20 }))
    const straight = screenHeightReading(
      input({ block: near, elevation: flat, sampleSpacingMeters: 20, refractionCoefficient: 1 }),
    )
    for (const [i, sample] of bent.samples.entries()) {
      expect(sample.status).toBe('visible')
      expect(sample.minClearanceMeters!).toBeLessThan(straight.samples[i].minClearanceMeters!)
      expect(sample.minClearanceMeters!).toBeCloseTo(
        expectedClearance(501.6, 500, sample.distanceMeters, sample.atMeters!, 500),
        6,
      )
    }
  })

  it('counts a block reaching into the eye clearing as unscreenable, never as screened', () => {
    const reaching = square(10, 200, -40, 40)
    const reading = screenHeightReading(input({ block: reaching, sampleSpacingMeters: 40 }))
    expect(reading.counts.visible).toBe(reading.counts.total)
    expect(reading.counts.unscreenable).toBe(reading.counts.total)
    expect(reading.curve[SCREEN_HEIGHT_MAX_METERS].hiddenOfVisiblePercent).toBe(0)
    expect(reading.screenFor.half).toBeNull()
  })

  it('caps the samples by widening the spacing, and yields progress as it goes', () => {
    const big = square(1000, 3000, -1000, 1000)
    const steps = screenHeightSteps(input({ block: big, sampleSpacingMeters: 5, stepMeters: 20, maxSamples: 400 }), {
      yieldEvery: 50,
    })
    const progress: number[] = []
    let next = steps.next()
    while (!next.done) {
      progress.push(next.value.fraction)
      next = steps.next()
    }
    const reading = next.value
    expect(reading.counts.total).toBeLessThanOrEqual(400)
    expect(reading.counts.total).toBeGreaterThan(300)
    expect(reading.sampleSpacingMeters).toBeGreaterThan(5)
    expect(progress.length).toBe(Math.ceil(reading.counts.total / 50) - 1)
    expect(progress.every((value, i) => value > 0 && value < 1 && (i === 0 || value > progress[i - 1]))).toBe(true)
  })

  it('reads a share off the visible ground: a screen reaching the height hides at least that share', () => {
    const samples = [0.5, 1, 2, 3].map(
      (clearance): ScreenHeightSample => ({
        lng: 0,
        lat: 0,
        areaMeters: 100,
        distanceMeters: 1000,
        status: 'visible',
        minClearanceMeters: clearance,
        atMeters: 500,
        atLng: 0,
        atLat: 0,
      }),
    )
    const hidden = { ...samples[0], status: 'terrainHidden' as const, minClearanceMeters: null }
    expect(screenHeightForShare({ samples: [...samples, hidden] }, 50)).toBe(1)
    expect(screenHeightForShare({ samples }, 75)).toBe(2)
    expect(screenHeightForShare({ samples }, 100)).toBe(3)
    expect(screenHeightForShare({ samples: [...samples, { ...samples[0], minClearanceMeters: null }] }, 100)).toBeNull()
    expect(screenHeightForShare({ samples: [hidden] }, 50)).toBeNull()
  })
})

describe('hiddenShareAt', () => {
  it('reads a height between curve steps exactly and agrees with the curve on whole metres', () => {
    const reading = screenHeightReading(input({ elevation: terrain((x) => (x >= 500 && x <= 520 ? 501 : 500)) }))
    const clearances = reading.samples.map((s) => s.minClearanceMeters!).sort((a, b) => a - b)
    const middle = clearances[12]
    expect(hiddenShareAt(reading, middle)).toBeCloseTo((13 / 25) * 100, 6)
    expect(hiddenShareAt(reading, clearances[0] - 1e-6)).toBe(0)
    for (const point of reading.curve)
      expect(hiddenShareAt(reading, point.heightMeters)).toBeCloseTo(point.hiddenOfVisiblePercent!, 9)
  })
})
