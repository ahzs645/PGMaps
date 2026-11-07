import { describe, expect, it } from 'vitest'
import { analyzeRoad } from './engine'
import { DEFAULT_DRAINAGE_SETTINGS, runDrainage, type DrainageSettings } from './drainageRun'
import type { PourPoint } from './drainageCatchments'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE, localMetricGrid } from './terrain'
import type { Alignment, TerrainSource } from './types'

const grid = localMetricGrid([-120.4, 50.67])
const [x0, y0] = grid.toGrid([-120.4, 50.67])
const road: Alignment = {
  id: 'drainage-test',
  name: 'Drainage test',
  color: '#16817a',
  points: [
    { id: 'start', coordinate: grid.toLonLat([x0 - 50, y0]), radiusM: 0 },
    { id: 'end', coordinate: grid.toLonLat([x0 + 50, y0]), radiusM: 0 },
  ],
  vertical: [
    { id: 'v0', chainage: 0, elevation: 100, curveLength: 0 },
    { id: 'v1', chainage: 100, elevation: 100, curveLength: 0 },
  ],
  template: DEFAULT_TEMPLATE,
  overrides: [],
}
const source = (missing = false): TerrainSource => ({
  elevationAt: (lon, lat) => {
    const [x, y] = grid.toGrid([lon, lat])
    return missing && x > x0 + 70 ? NaN : 100 + 0.02 * (y - y0)
  },
})
const run = (
  resolutionM: number,
  missing = false,
  options: {
    settings?: Partial<DrainageSettings>
    maxCells?: number
    pourPoint?: PourPoint
  } = {},
) => {
  const terrain = source(missing)
  return runDrainage({
    terrain,
    analysis: analyzeRoad(road, terrain, DEFAULT_ROAD_SETTINGS),
    culverts: [],
    ...grid,
    resolutionM,
    settings: { ...DEFAULT_DRAINAGE_SETTINGS, bufferM: 40, ...options.settings },
    maxCells: options.maxCells,
    pourPoint: options.pourPoint,
  })
}

describe('drainage interpretation limits', () => {
  it('keeps the entered source resolution and identifies the bounded catchment', () => {
    const result = run(1)
    expect(result.cellM).toBe(1)
    expect(result.changedCells).toBeGreaterThan(0)
    expect(result.warnings.join(' ')).toMatch(/Increase the upslope buffer/)
    expect(result.warnings.join(' ')).not.toMatch(/no ground|may not resolve/)
  })

  it('flags coarse terrain rather than presenting narrow-channel results without context', () => {
    const result = run(6)
    expect(result.cellM).toBe(6)
    expect(result.warnings.join(' ')).toMatch(/6.00 m cells may not resolve narrow ditches/)
  })

  it('warns when missing source ground truncates the sampled catchment', () => {
    const result = run(1, true)
    expect(result.existing.accumulation.some((value) => value === 0)).toBe(true)
    expect(result.warnings.join(' ')).toMatch(/sampled cells have no ground/)
  })

  it('records the used policy and never samples finer than the terrain source', () => {
    const result = run(6, false, { settings: { workingResolutionM: 2, depressionPolicy: { mode: 'preserve' } } })
    expect(result.cellM).toBe(6)
    expect(result.resolution).toEqual({
      sourceM: 6,
      requestedM: 2,
      minimumM: 6,
      actualM: 6,
      maxCells: 4_194_304,
      coarsenedForBudget: false,
    })
    expect(result.settings.depressionPolicy).toEqual({ mode: 'preserve' })
    expect(result.existing.conditioning.policy).toEqual({ mode: 'preserve' })
    expect(result.design.conditioning.filledCells).toBe(0)
    expect(result.warnings.join(' ')).toMatch(/limited by the source resolution/)
    expect(result.warnings.join(' ')).toMatch(/potential depth to spill/)
    const coarse = run(2, false, { settings: { workingResolutionM: 10 } })
    expect(coarse.cellM).toBe(10)
    expect(coarse.settings.depressionPolicy).toEqual({ mode: 'fill-all' })
  })

  it('records achieved cells and resolution when the requested grid exceeds the budget', () => {
    const result = run(1, false, { settings: { workingResolutionM: 2 }, maxCells: 100 })
    expect(result.cells).toBeLessThanOrEqual(100)
    expect(result.cellM).toBeGreaterThan(2)
    expect(result.resolution).toMatchObject({
      sourceM: 1,
      requestedM: 2,
      minimumM: 2,
      maxCells: 100,
      coarsenedForBudget: true,
    })
    expect(result.resolution.actualM).toBe(result.cellM)
    expect(result.warnings.join(' ')).toMatch(/coarsened/)
  })

  it('retains actual snap details and original surface elevation in a completed run', () => {
    const coordinate = grid.toLonLat([x0, y0 + 15])
    const result = run(2, false, {
      pourPoint: { coordinate, snapRadiusM: 8, surface: 'existing', snapPolicy: 'lowest-elevation' },
    })
    const catchment = result.catchment!
    expect(catchment.snapPolicy).toBe('lowest-elevation')
    expect(catchment.requestedCoordinate).toEqual(coordinate)
    expect(catchment.selectedElevationM).toBeCloseTo(source().elevationAt(...catchment.snappedCoordinate), 9)
    expect(catchment.snappedDistanceM).toBeLessThanOrEqual(8)
    expect(catchment.outletCell).toBeGreaterThanOrEqual(0)
    expect(catchment.outletCell).toBeLessThan(result.cells)
    const point = result.plan.features.find((f) => f.properties?.role === 'pour-point')
    expect(point?.properties).toMatchObject({
      snapPolicy: 'lowest-elevation',
      outletCell: catchment.outletCell,
      selectedElevationM: catchment.selectedElevationM,
    })
  })

  it('keeps ponding evidence under preservation even though no ground is filled', () => {
    const terrain: TerrainSource = {
      elevationAt: (lon, lat) => {
        const [x, y] = grid.toGrid([lon, lat])
        return Math.hypot(x - x0, y - y0 - 20) < 5 ? 95 : 100
      },
    }
    const result = runDrainage({
      terrain,
      analysis: analyzeRoad(road, terrain, DEFAULT_ROAD_SETTINGS),
      culverts: [],
      ...grid,
      resolutionM: 2,
      settings: { ...DEFAULT_DRAINAGE_SETTINGS, bufferM: 40, depressionPolicy: { mode: 'preserve' } },
    })
    expect(result.existing.conditioning.filledCells).toBe(0)
    expect(result.existing.conditioning.retainedDepressionCells).toBeGreaterThan(0)
    expect(result.existing.ponding.maxDepthM).toBe(5)
    expect(result.existing.ponding.volumeM3).toBeGreaterThan(0)
    expect(result.warnings.join(' ')).toMatch(/only part of a closed flat depression/)
  })

  it('rejects invalid resolution and budgets before sampling', () => {
    for (const workingResolutionM of [0, -1, Infinity, NaN, 100_001])
      expect(() => run(1, false, { settings: { workingResolutionM } })).toThrow(/working resolution/)
    expect(() => run(NaN)).toThrow(/source resolution/)
    expect(() => run(1, false, { maxCells: 0 })).toThrow(/budget/)
    expect(() => run(1, false, { maxCells: 4_194_305 })).toThrow(/budget/)
  })
})
