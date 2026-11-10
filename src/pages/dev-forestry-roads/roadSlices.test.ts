import { describe, expect, it } from 'vitest'
import { benchCentreline, benchTerrain } from './roadBenchFixture'
import type { XY } from './roadGrid'
import { measureRoadSlices, summarizeSlices, type RoadSlice } from './roadSlices'
import type { SurfaceGrid } from './surfaceGrid'
import type { VegetationEvidence } from './vegetationEvidence'

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

/**
 * A 6 m flat bed running north along x = 0 with 1.5H:1V cut batters rising 2 m on both sides, and
 * point-cloud evidence with brush (40 % of returns below 5 m) from 2 m east of the centre outward:
 * the spec's hand-derived slice case.
 */
function benchedCorridor(): { dtm: SurfaceGrid; evidence: VegetationEvidence } {
  const cellM = 0.25,
    width = 161,
    height = 401
  const values = new Float64Array(width * height)
  for (let r = 0; r < height; r++)
    for (let c = 0; c < width; c++) {
      const off = Math.abs(-20 + c * cellM)
      values[r * width + c] = off <= 3 ? 0 : off <= 6 ? (off - 3) / 1.5 : 2
    }
  const dtm: SurfaceGrid = { origin: [-20, 100], cellM, width, height, values }
  const ew = 40,
    eh = 101,
    n = ew * eh
  const evidence: VegetationEvidence = {
    origin: [-19.5, 100.5],
    cellM: 1,
    width: ew,
    height: eh,
    returns: new Uint16Array(n).fill(10),
    ground: new Uint16Array(n).fill(6),
    groundSdM: new Float32Array(n).fill(0.02),
    canopyM: new Float32Array(n).fill(0.05),
    low: new Uint16Array(n),
    brush: new Uint16Array(n),
    under5: new Uint16Array(n).fill(10),
    intensityRange: null,
    info: {
      points: n * 10,
      pointsPerM2: 10,
      groundPerM2: 6,
      coveredCells: n,
      intensity: 'none',
      flightLines: null,
      lowDensity: false,
      sources: 1,
    },
  }
  for (let r = 0; r < eh; r++) for (let c = 0; c < ew; c++) if (-19.5 + c >= 2) evidence.brush[r * ew + c] = 4
  return { dtm, evidence }
}

describe('road slices with point-cloud evidence', () => {
  const { dtm, evidence } = benchedCorridor()
  const line: XY[] = [
    [0, 5],
    [0, 95],
  ]

  it('measures the road between the batters and the drivable bed inside it', () => {
    const summary = measureRoadSlices(dtm, line, {}, evidence)
    const slice = summary.slices[3]
    expect(slice.leftEdgeM).toBeCloseTo(-3, 0)
    expect(slice.rightEdgeM).toBeCloseTo(3, 0)
    expect(slice.widthM).toBeCloseTo(6, 0)
    expect(slice.shoulders).toBe(2)
    expect(slice.drivableLeftM).toBeCloseTo(-3, 0)
    expect(slice.drivableRightM).toBeCloseTo(2, 0)
    expect(slice.drivableWidthM).toBeGreaterThanOrEqual(4.5)
    expect(slice.drivableWidthM).toBeLessThanOrEqual(5.5)
    // Brush over the bed east of +2 m: 40 % of a sixth to a fifth of the bed.
    expect(slice.vegetationPercent).toBeGreaterThan(5)
    expect(slice.vegetationPercent).toBeLessThan(12)
    expect(summary.shoulderPercent).toBe(100)
    expect(summary.drivableWidthM!.p50).toBeCloseTo(slice.drivableWidthM!, 6)
  })

  it('leaves the drivable figures out without evidence, and the bench as before', () => {
    const plain = measureRoadSlices(dtm, line)
    expect(plain.slices[3].drivableWidthM).toBeUndefined()
    expect(plain.drivableWidthM).toBeNull()
    expect(plain.vegetationPercent).toBeNull()
    expect(plain.slices[3].widthM).toBeCloseTo(measureRoadSlices(dtm, line, {}, evidence).slices[3].widthM, 6)
  })

  it('ends a side without a batter where the ground returns spread, given a point cloud', () => {
    const flat: SurfaceGrid = { ...dtm, values: new Float64Array(dtm.values.length) }
    const spread = { ...evidence, groundSdM: evidence.groundSdM.slice() }
    for (let r = 0; r < spread.height; r++)
      for (let c = 0; c < spread.width; c++) if (Math.abs(-19.5 + c) >= 4) spread.groundSdM[r * spread.width + c] = 0.3
    const slice = measureRoadSlices(flat, line, {}, spread).slices[3]
    expect(slice.shoulders).toBe(0)
    expect(slice.widthM).toBeGreaterThanOrEqual(6)
    expect(slice.widthM).toBeLessThanOrEqual(8.5)
    // Terrain alone sees no edge on flat ground: the whole slice.
    expect(measureRoadSlices(flat, line).slices[3].widthM).toBe(30)
  })
})

describe('road slice summary', () => {
  const slice = (shoulders: 0 | 1 | 2, widthM = 6, drivableWidthM?: number): RoadSlice => ({
    chainage: 0,
    centreShiftM: 0,
    leftEdgeM: -widthM / 2,
    rightEdgeM: widthM / 2,
    widthM,
    shoulders,
    centreSlopeDeg: 1,
    complete: true,
    bench: shoulders > 0,
    ...(drivableWidthM === undefined ? {} : { drivableWidthM, vegetationPercent: 5 }),
  })

  it('counts shoulders as a share of the two possible per section', () => {
    // 10 sections: both found in 6, one in 3, none in 1 → (12 + 3) / 20 = 75 %.
    const slices = [...Array(6).fill(2), ...Array(3).fill(1), 0].map((n) => slice(n))
    expect(summarizeSlices(slices).shoulderPercent).toBe(75)
  })

  it('averages the drivable width from each section, never from the road width', () => {
    // The reference implementation re-joined pieces of a long road with the mean road width as
    // the drivable width; a summary over every section's own drivable width cannot.
    const summary = summarizeSlices([slice(2, 8, 4), slice(2, 8, 3), slice(2, 10, 5)])
    expect(summary.drivableWidthM!.mean).toBeCloseTo(4, 10)
    expect(summary.roadWidthMeanM).toBeCloseTo(26 / 3, 10)
  })
})
