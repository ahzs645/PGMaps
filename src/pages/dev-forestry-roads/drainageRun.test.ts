import { describe, expect, it } from 'vitest'
import { analyzeRoad } from './engine'
import { DEFAULT_DRAINAGE_SETTINGS, runDrainage } from './drainageRun'
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
const run = (resolutionM: number, missing = false) => {
  const terrain = source(missing)
  return runDrainage({
    terrain,
    analysis: analyzeRoad(road, terrain, DEFAULT_ROAD_SETTINGS),
    culverts: [],
    ...grid,
    resolutionM,
    settings: { ...DEFAULT_DRAINAGE_SETTINGS, bufferM: 40 },
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
})
