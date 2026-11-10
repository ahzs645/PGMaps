import { describe, expect, it } from 'vitest'
import { benchCentreline, benchTerrain } from './roadBenchFixture'
import { cumulativeLength, resampleLine } from './roadGrid'
import { ROAD_FIND_MAX_CELL_M, roadFindingTerrainProblem, roadLikeness } from './roadLikeness'
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
