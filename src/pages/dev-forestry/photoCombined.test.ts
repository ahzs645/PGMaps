import { describe, expect, it } from 'vitest'

import { cameraCueContributions, cameraCueScore, compareDepthGrids, undecidedHeadings } from './photoCombined'
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

describe('headings the evidence leaves open', () => {
  it('is nothing when one camera leads, or the leaders are neighbours in the sweep', () => {
    expect(
      undecidedHeadings([
        { bearing: 139, score: 1.59 },
        { bearing: 293, score: 0.49 },
      ]),
    ).toBeNull()
    expect(
      undecidedHeadings([
        { bearing: 240, score: 0.8 },
        { bearing: 270, score: 0.78 },
        { bearing: 90, score: 0.1 },
      ]),
    ).toBeNull()
    expect(undecidedHeadings([{ bearing: 10, score: 1 }])).toBeNull()
  })

  it('is the arc holding every camera that fits about as well as the best', () => {
    const scored = [
      { bearing: 270, score: 0.82 },
      { bearing: 240, score: 0.8 },
      { bearing: 330, score: 0.79 },
      { bearing: 0, score: 0.76 },
      { bearing: 120, score: -0.1 },
    ]
    expect(undecidedHeadings(scored)).toEqual({ from: 240, to: 0 })
  })

  it('runs clockwise through north, and leaves out a camera that fits clearly worse', () => {
    expect(
      undecidedHeadings([
        { bearing: 350, score: 1 },
        { bearing: 60, score: 0.95 },
        { bearing: 180, score: 0.5 },
      ]),
    ).toEqual({
      from: 350,
      to: 60,
    })
  })
})
