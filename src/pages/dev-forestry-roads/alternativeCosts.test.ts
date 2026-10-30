import { describe, expect, it } from 'vitest'
import { alternativeCostLabel, alternativeCostStatus } from './alternativeCosts'
import { analyzeRoad, offsetCoordinate } from './engine'
import { createEngineeringDesign } from './engineeringTypes'
import type { Alignment } from './types'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'

function result() {
  const origin: [number, number] = [-122.8, 53.9]
  const road: Alignment = {
    id: 'r',
    name: 'Flat fill',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: offsetCoordinate(origin, 0, 100), radiusM: 0 },
    ],
    vertical: [
      { id: 'a', chainage: 0, elevation: 802, curveLength: 0 },
      { id: 'b', chainage: 100, elevation: 802, curveLength: 0 },
    ],
    template: { ...DEFAULT_TEMPLATE },
    overrides: [],
    engineering: createEngineeringDesign(),
  }
  return analyzeRoad(road, { elevationAt: () => 800 }, DEFAULT_ROAD_SETTINGS)
}
describe('alternative cost eligibility', () => {
  it('does not present a material-infeasible subtotal as a complete cost on fully covered terrain', () => {
    const analysis = result()
    expect(alternativeCostStatus(analysis)).toBe('complete')
    expect(analysis.coveragePercent).toBeCloseTo(100, 5)
    analysis.engineering!.haul.optimizationStatus = 'infeasible'
    analysis.engineering!.complete = false
    expect(analysis.estimatedCost).toBeGreaterThan(0)
    expect(alternativeCostStatus(analysis)).toBe('infeasible')
    expect(alternativeCostLabel(analysis)).toBe('Material plan infeasible')
  })
  it('keeps incomplete quantities distinguishable from a complete cost', () => {
    const analysis = result()
    analysis.coveragePercent = 95
    expect(alternativeCostLabel(analysis)).toBe('Incomplete cost')
    analysis.stations = []
    expect(alternativeCostStatus(analysis)).toBe('unavailable')
  })
})
