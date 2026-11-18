import { describe, expect, it } from 'vitest'

import { cameraCueContributions, cameraCueScore, compareDepthGrids } from './photoCombined'
import type { DepthGrid } from './photoDepth'

const grid = (value: (x: number, y: number) => number) =>
  ({
    width: 24,
    height: 24,
    inverse: Float32Array.from({ length: 24 * 24 }, (_, index) => value(index % 24, Math.floor(index / 24))),
  }) satisfies DepthGrid

describe('combined photo evidence', () => {
  it('preserves absent cues and signed contributions in the score breakdown', () => {
    const cues = { depth: { global: 0.5, lateral: -0.5 }, geometry: 0.8, appearance: 0 }
    const terms = cameraCueContributions(cues)
    expect(terms.depth).toBeCloseTo(-0.12)
    expect(terms.geometry).toBeCloseTo(1.2)
    expect(terms.appearance).toBe(0)
    expect(terms.skyline).toBeNull()
    expect(cameraCueScore(cues)).toBeCloseTo(1.08)
  })

  it('compares near-to-far ordering and lateral shape without a skyline', () => {
    const photo = grid((x, y) => 2 + x + 2 * y)
    const aligned = grid((x, y) => 5 + 3 * (x + 2 * y))
    const wrongSlope = grid((x, y) => 25 - x + 2 * y)
    const results = compareDepthGrids(photo, [aligned, wrongSlope])!
    expect(results.depth[0].global).toBeCloseTo(1)
    expect(results.depth[0].lateral).toBeCloseTo(1)
    expect(results.depth[1].lateral).toBeCloseTo(-1)
    expect(cameraCueScore({ depth: results.depth[0] })).toBeGreaterThan(
      cameraCueScore({ depth: results.depth[1], appearance: 0.3 }),
    )
  })

  it('declines a depth score when the poses share too little visible ground', () => {
    const photo = grid((x, y) => 2 + x + y)
    const nearSky = grid((x, y) => (y < 20 ? NaN : 1 + x + y))
    expect(compareDepthGrids(photo, [photo, nearSky])).toBeNull()
  })

  it('allows measured geometry to support a camera when depth and skyline are unavailable', () => {
    expect(cameraCueScore({ geometry: 0.8, appearance: 0.1 })).toBeGreaterThan(cameraCueScore({ appearance: 0.6 }))
  })
})
