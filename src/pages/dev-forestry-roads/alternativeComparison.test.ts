import { describe, expect, it } from 'vitest'
import { alternativeMetricComparison } from './alternativeComparison'
import { analyzeRoad, offsetCoordinate } from './engine'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, Coordinate } from './types'

function analyses() {
  const origin: Coordinate = [-122.8, 53.9]
  const end = offsetCoordinate(origin, 0, 100)
  const road: Alignment = {
    id: 'r',
    name: 'Fill on flat ground',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: end, radiusM: 0 },
    ],
    vertical: [
      { id: 'v0', chainage: 0, elevation: 802, curveLength: 0 },
      { id: 'v1', chainage: 100, elevation: 802, curveLength: 0 },
    ],
    template: { ...DEFAULT_TEMPLATE, crossfallPercent: 0, ditchWidth: 0, ditchDepth: 0 },
    overrides: [],
  }
  const complete = analyzeRoad(road, { elevationAt: () => 800 }, DEFAULT_ROAD_SETTINGS)
  const partial = analyzeRoad(
    road,
    {
      elevationAt: (_lng, lat) => (lat < (origin[1] + end[1]) / 2 ? 800 : Number.NaN),
    },
    DEFAULT_ROAD_SETTINGS,
  )
  return { complete, partial }
}

describe('alternative comparison coverage and grade bases', () => {
  it('does not rank smaller earthwork and disturbance subtotals created by missing terrain', () => {
    const { complete, partial } = analyses()
    expect(complete.coveragePercent).toBeCloseTo(100, 5)
    expect(partial.coveragePercent).toBeGreaterThan(0)
    expect(partial.coveragePercent).toBeLessThan(100)
    expect(partial.fillVolumeM3).toBeLessThan(complete.fillVolumeM3)
    expect(partial.clearingAreaM2).toBeLessThan(complete.clearingAreaM2)
    for (const metric of ['earthworks', 'disturbance', 'cost']) {
      expect(alternativeMetricComparison(complete, partial, metric).comparable).toBe(false)
      expect(alternativeMetricComparison(partial, complete, metric).comparable).toBe(false)
    }
    expect(alternativeMetricComparison(partial, complete, 'length').comparable).toBe(true)
    expect(alternativeMetricComparison(complete, complete, 'earthworks').comparable).toBe(true)
  })

  it('requires a known, matching grade basis and never compares against unavailable calculations', () => {
    const { complete } = analyses()
    expect(
      alternativeMetricComparison(complete, complete, 'grade', { baseHasProfile: false, otherHasProfile: true })
        .comparable,
    ).toBe(false)
    expect(
      alternativeMetricComparison(complete, complete, 'grade', { baseHasProfile: true, otherHasProfile: true })
        .comparable,
    ).toBe(true)
    const unknownGrade = structuredClone(complete)
    unknownGrade.stations[2].gradePercent = null
    expect(
      alternativeMetricComparison(complete, unknownGrade, 'grade', { baseHasProfile: true, otherHasProfile: true })
        .comparable,
    ).toBe(false)
    const failed = { ...complete, stations: [] }
    for (const metric of ['grade', 'earthworks', 'disturbance', 'length', 'cost'])
      expect(alternativeMetricComparison(failed, complete, metric).comparable).toBe(false)
  })
})
