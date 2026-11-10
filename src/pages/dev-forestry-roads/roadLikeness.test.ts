import { describe, expect, it } from 'vitest'
import { benchCentreline, benchEvidence, benchTerrain } from './roadBenchFixture'
import { cumulativeLength, resampleLine } from './roadGrid'
import {
  canopyActivation,
  combineRoadConductivity,
  edgeActivation,
  lowVegetationActivation,
  risingActivation,
  ROAD_FIND_MAX_CELL_M,
  roadFindingTerrainProblem,
  roadLikeness,
  roughnessActivation,
  slopeActivation,
  type RoadConductivityTerms,
} from './roadLikeness'
import { evidenceOnFrame } from './vegetationEvidence'
import type { SurfaceGrid } from './surfaceGrid'

const plane = (rise: number, cellM = 1, size = 20): SurfaceGrid => ({
  origin: [0.5, size - 0.5],
  cellM,
  width: size,
  height: size,
  values: Float64Array.from({ length: size * size }, (_, i) => 500 + rise * (i % size) * cellM),
})
const at = (grid: SurfaceGrid, col: number, row: number) => grid.values[row * grid.width + col]

describe('road-likeness', () => {
  it('scores a 30 % plane by its slope alone', () => {
    const like = roadLikeness(plane(0.3))
    // 16.7°: (20 − 16.7) / (20 − 5)
    expect(at(like, 10, 10)).toBeCloseTo((20 - (Math.atan(0.3) * 180) / Math.PI) / 15, 3)
    expect(at(like, 10, 10)).toBeCloseTo(0.22, 2)
  })

  it('scores flat smooth ground as fully road-like', () => {
    const like = roadLikeness(plane(0))
    expect(Math.min(...like.values)).toBe(1)
  })

  it('floors steep ground at 0.1 rather than 0', () => {
    const like = roadLikeness(plane(1))
    expect(at(like, 10, 10)).toBe(0.1)
  })

  it('refuses ground coarser than the limit and names the regional DEM', () => {
    expect(roadFindingTerrainProblem(ROAD_FIND_MAX_CELL_M)).toBeNull()
    expect(roadFindingTerrainProblem(1)).toBeNull()
    expect(roadFindingTerrainProblem(22)).toMatch(/regional DEM/)
    expect(roadFindingTerrainProblem(Number.NaN)).toMatch(/no known cell size/)
    expect(() => roadLikeness(plane(0, 2.5))).toThrow(/2 m or finer/)
  })

  it('keeps missing ground unknown, with no floor, around the gap', () => {
    const grid = plane(0, 1, 30)
    grid.values[15 * 30 + 15] = Number.NaN
    const like = roadLikeness(grid)
    expect(Number.isNaN(at(like, 15, 15))).toBe(true)
    // The 5×5 mean then the 3×3 spread reach three cells.
    expect(Number.isNaN(at(like, 18, 15))).toBe(true)
    expect(Number.isNaN(at(like, 15, 12))).toBe(true)
    expect(at(like, 19, 15)).toBe(1)
    expect(at(like, 2, 2)).toBe(1)
  })

  it('reads a road bench as road-like and the hillside beside it as not', () => {
    const dtm = benchTerrain()
    const like = roadLikeness(dtm)
    const sample = (p: [number, number]) =>
      like.values[
        Math.round((like.origin[1] - p[1]) / like.cellM) * like.width + Math.round((p[0] - like.origin[0]) / like.cellM)
      ]
    const line = benchCentreline()
    expect(cumulativeLength(line).at(-1)).toBeGreaterThan(560)
    const onRoad = resampleLine(line, 2).slice(5, -5).map(sample)
    const offRoad = resampleLine(line, 2)
      .slice(5, -5)
      .map(([x, y]) => sample([x + 25, y]))
    const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length
    expect(mean(onRoad)).toBeGreaterThan(0.5)
    expect(mean(offRoad)).toBeLessThan(0.3)
  })
})

/**
 * The point-cloud form against a reference run of ALSroads 0.2.0, 10 November 2026 (its activation
 * and combination code run unmodified on these inputs), and the spec's hand-derived cases.
 */
describe('road conductivity with point-cloud terms', () => {
  it.each([
    ['slope 5–20°', slopeActivation, [0, 5, 8, 10, 12.5, 15, 20, 30], [1, 1, 0.8, 0.667, 0.5, 0.333, 0, 0]],
    [
      'roughness 0.05–0.10 m',
      roughnessActivation,
      [0.02, 0.05, 0.06, 0.075, 0.09, 0.1, 0.2],
      [1, 1, 0.8, 0.5, 0.2, 0, 0],
    ],
    ['slope edge 40', edgeActivation, [0, 39.9, 40, 80], [1, 1, 0, 0]],
    ['low vegetation, 2 returns', lowVegetationActivation, [0, 1, 2, 5], [1, 1, 0, 0]],
    ['canopy 0.1–0.2 m', canopyActivation, [0, 0.1, 0.15, 0.2, 3], [1, 1, 0.5, 0, 0]],
  ] as const)('activates %s as the reference run', (_, activation, inputs, outputs) => {
    expect(inputs.map((v) => (activation as (x: number) => number)(v))).toEqual(outputs)
  })

  it('ramps density up between the corridor percentiles', () => {
    // P25 = 4, P95 = 12 points per cell.
    expect([2, 4, 6, 8, 12, 20].map((d) => risingActivation(d, 4, 12))).toEqual([0, 0, 0.25, 0.5, 1, 1])
  })

  const ones: RoadConductivityTerms = { slope: 1, roughness: 1, edge: 1, low: 1, canopy: 1, density: 1, intensity: 1 }
  it.each([
    ['all seven terms 1', {}, 1],
    ['slope term 0.5', { slope: 0.5 }, 0.5],
    ['brush on the bed (low-vegetation gate closed)', { low: 0 }, 0.1],
    ['canopy over the bed, density 0.5', { canopy: 0, density: 0.5 }, 0.6],
    ['no intensity in the cloud, roughness 0.5', { intensity: null, roughness: 0.5 }, 0.875],
  ] as const)('combines %s as equation 1', (_, terms, sigma) => {
    expect(combineRoadConductivity({ ...ones, ...terms })).toBeCloseTo(sigma, 10)
  })

  it('makes roughness a vote, not a gate, unlike the terrain-only product', () => {
    expect(combineRoadConductivity({ ...ones, slope: 0.8, roughness: 0.8 })).toBeCloseTo(0.768, 10)
    // Terrain only on the same cell: 0.8 × 0.8 × 1.
    expect(slopeActivation(8) * roughnessActivation(0.06)).toBeCloseTo(0.64, 10)
  })

  it('scores an open bed above the forest beside it, and a brushed-in bed down to the floor', () => {
    const dtm = benchTerrain()
    const frame = { origin: dtm.origin, cellM: 1, width: dtm.width, height: dtm.height }
    const population = new Uint8Array(dtm.width * dtm.height).fill(1)
    const sample = (grid: typeof dtm, p: [number, number]) =>
      grid.values[
        Math.round((grid.origin[1] - p[1]) / grid.cellM) * grid.width + Math.round((p[0] - grid.origin[0]) / grid.cellM)
      ]
    const along = resampleLine(benchCentreline(), 2).slice(5, -5)
    const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length
    const open = roadLikeness(dtm, {}, { layers: evidenceOnFrame(benchEvidence(), frame), population })
    expect(mean(along.map((p) => sample(open, p)))).toBeGreaterThan(0.7)
    expect(mean(along.map(([x, y]) => sample(open, [x + 25, y])))).toBeLessThan(0.2)
    const brushed = roadLikeness(
      dtm,
      {},
      { layers: evidenceOnFrame(benchEvidence({ overgrown: true }), frame), population },
    )
    expect(mean(along.map((p) => sample(brushed, p)))).toBeLessThan(0.15)
  })
})
