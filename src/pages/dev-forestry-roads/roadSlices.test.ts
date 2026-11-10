import { describe, expect, it } from 'vitest'
import { benchCentreline, benchTerrain } from './roadBenchFixture'
import type { XY } from './roadGrid'
import { measureRoadSlices } from './roadSlices'

describe('road bench slices', () => {
  const dtm = benchTerrain()
  const line = benchCentreline()

  it('measures a 6 m bench with both shoulders on the true line', () => {
    const result = measureRoadSlices(dtm, line)
    expect(result.slices.length).toBeGreaterThan(50)
    expect(result.widthM!.p10).toBeGreaterThanOrEqual(5.5)
    expect(result.widthM!.p50).toBeCloseTo(6, 0)
    expect(result.widthM!.p90).toBeLessThanOrEqual(6.5)
    expect(result.benchShare).toBe(1)
    expect(result.bothShoulderShare).toBeGreaterThanOrEqual(0.95)
  })

  it('puts the left edge at a negative offset looking up the line', () => {
    const slice = measureRoadSlices(dtm, line).slices[20]
    expect(slice.leftEdgeM).toBeLessThan(0)
    expect(slice.rightEdgeM).toBeGreaterThan(0)
  })

  it('finds no bench on a line 10 m off the road', () => {
    const shifted = line.map(([x, y]) => [x + 10, y] as XY)
    expect(measureRoadSlices(dtm, shifted).benchShare).toBeLessThan(0.5)
  })

  it('finds no bench on a plain hillside or on flat ground', () => {
    expect(measureRoadSlices(benchTerrain({ bench: false }), line).benchShare).toBe(0)
    expect(measureRoadSlices(benchTerrain({ bench: false, crossSlope: 0 }), line).benchShare).toBe(0)
  })

  it('excludes slices that cross missing ground', () => {
    const holed = { ...dtm, values: new Float64Array(dtm.values) }
    for (let r = 200; r < 220; r++) for (let c = 0; c < holed.width; c++) holed.values[r * holed.width + c] = Number.NaN
    const result = measureRoadSlices(holed, line)
    const incomplete = result.slices.filter((s) => !s.complete)
    expect(incomplete.length).toBeGreaterThanOrEqual(2)
    expect(incomplete.every((s) => !s.bench)).toBe(true)
    expect(result.complete).toBe(result.slices.length - incomplete.length)
    expect(result.widthM!.p50).toBeCloseTo(6, 0)
  })
})
