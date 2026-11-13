import { describe, expect, it } from 'vitest'
import { formatRoadStation } from './Charts'
import { analyzeRoad, offsetCoordinate } from './engine'
import { createEngineeringDesign } from './engineeringTypes'
import { caseSummary, designedGradeCase, terrainCases } from './terrainCases'
import type { Alignment, Coordinate, RoadSettings } from './types'

const origin: Coordinate = [-121.55, 54.07]
const settings: RoadSettings = {
  stationInterval: 10,
  crossSectionHalfWidth: 35,
  maxGradePercent: 12,
  minRadius: 25,
  cutRate: 12,
  fillRate: 8,
  surfacingRate: 40,
  clearingRate: 1.5,
  shrinkFactor: 0.9,
}
const metresPerDegree = 111_320 * Math.cos((origin[1] * Math.PI) / 180)
/** 30 % ground with a 69 % sidehill falling to the road's right between 100 and 200 m, as on the reference block. */
const terrain = {
  elevationAt: (lon: number, lat: number) => {
    const north = (lat - origin[1]) * 110_540
    const fall = north >= 95 && north <= 205 ? 0.69 : 0.3
    return 900 + 0.05 * north - fall * (lon - origin[0]) * metresPerDegree
  },
}
const road: Alignment = {
  id: 'road',
  name: 'Sidehill',
  color: '#16817a',
  points: [
    { id: 'a', coordinate: origin, radiusM: 0 },
    { id: 'b', coordinate: offsetCoordinate(origin, 0, 300), radiusM: 0 },
  ],
  vertical: [],
  template: {
    leftWidth: 3,
    rightWidth: 3,
    crossfallPercent: 3,
    cutSlope: 0.75,
    fillSlope: 1.5,
    ditchWidth: 1,
    ditchDepth: 0.5,
    surfaceDepth: 0.25,
  },
  overrides: [],
  engineering: createEngineeringDesign(),
}
let n = 0
const options = { id: () => `id-${++n}`, stationLabel: formatRoadStation }

describe('best and worst case on terrain the sections do not close on', () => {
  it('brackets the road between a 1:1 fill and a full bench, both complete', () => {
    const asIs = analyzeRoad(road, terrain, settings)
    const cases = terrainCases(road, asIs.stations, settings, asIs.length, options)!
    if ('error' in cases.best || 'error' in cases.worst) throw Error('a case failed')
    expect(cases.best.change).toBe('1:1 fill on 1 stretch')
    expect(cases.worst.change).toMatch(/^Full bench on 1 stretch, up to 2\.\d m lower$/)
    // Neither case touches the road it was made from.
    expect(road.vertical).toEqual([])
    expect(road.engineering!.assignments).toEqual([])

    const best = caseSummary(analyzeRoad(cases.best.alignment, terrain, cases.best.settings))
    const worst = caseSummary(analyzeRoad(cases.worst.alignment, terrain, cases.worst.settings))
    expect(caseSummary(asIs).completePercent).toBeLessThan(100)
    expect(best.completePercent).toBeCloseTo(100, 6)
    expect(worst.completePercent).toBeCloseTo(100, 6)
    // The bench trades fill for cut: more to excavate, less to place, a surplus to haul away.
    expect(worst.cutM3).toBeGreaterThan(best.cutM3)
    expect(worst.fillM3).toBeLessThan(best.fillM3)
    expect(worst.balanceM3).toBeGreaterThan(best.balanceM3)
    // The balance is the road's own: usable cut (cut × the reuse factor here) less fill.
    expect(worst.balanceM3).toBeCloseTo(worst.cutM3 * settings.shrinkFactor - worst.fillM3, 6)
  })

  it('fits a designed grade line inside the grade limit, between the two cases', async () => {
    const asIs = analyzeRoad(road, terrain, settings)
    const designed = await designedGradeCase(road, asIs.length, terrain, settings, [], {}, options)
    if ('error' in designed) throw Error(designed.error)
    expect(designed.change).toMatch(/^Grade line within 12%, \d+ PVIs, up to 5 m from the ground/)
    expect(designed.alignment.vertical.length).toBeGreaterThan(1)
    expect(road.vertical).toEqual([])
    const summary = caseSummary(analyzeRoad(designed.alignment, terrain, designed.settings))
    expect(summary.completePercent).toBeCloseTo(100, 6)
    expect(summary.maxGradePercent).toBeLessThanOrEqual(12.01)
  })

  it("gives the optimizer's reason when no grade line holds the limit", async () => {
    // A 40 % climb cannot be held to 12 % within 20 m of the ground over 300 m.
    const climb = {
      elevationAt: (lon: number, lat: number) => terrain.elevationAt(lon, lat) + 0.35 * (lat - origin[1]) * 110_540,
    }
    const asIs = analyzeRoad(road, climb, settings)
    const designed = await designedGradeCase(road, asIs.length, climb, settings, [], {}, options)
    expect(designed).toEqual({ error: expect.stringMatching(/tried up to 20 m from the ground/) })
  })

  it('has no cases for a road whose sections all close', () => {
    const gentle = { elevationAt: (lon: number) => 900 - 0.3 * (lon - origin[0]) * metresPerDegree }
    const analysis = analyzeRoad(road, gentle, settings)
    expect(terrainCases(road, analysis.stations, settings, analysis.length, options)).toBeNull()
  })

  it('says a disposal is unpriced when a surplus or waste goes away for nothing', () => {
    const asIs = analyzeRoad(road, terrain, settings)
    expect(caseSummary({ ...asIs, balanceM3: -50 }).disposalPriced).toBe(true)
    expect(caseSummary({ ...asIs, balanceM3: 900 }).disposalPriced).toBe(false)
    const summary = caseSummary({
      ...asIs,
      balanceM3: 0,
      engineering: asIs.engineering && {
        ...asIs.engineering,
        haul: { ...asIs.engineering.haul, wasteBankM3: 1200 },
        costs: { ...asIs.engineering.costs, waste: 0, haul: 0 },
      },
    })
    expect(summary.disposalPriced).toBe(false)
    expect(summary.wasteBankM3).toBe(1200)
  })
})
