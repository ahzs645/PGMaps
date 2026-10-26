import { describe, expect, it } from 'vitest'
import { analyzeRoad, offsetCoordinate } from './engine'
import { createEngineeringDesign } from './engineeringTypes'
import { assessCostReadiness } from './costReadiness'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, RoadAnalysis, RoadSettings } from './types'

function alignment(): Alignment {
  return {
    id: 'road',
    name: 'Road',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: [-122.8, 53.9], radiusM: 0 },
      { id: 'b', coordinate: offsetCoordinate([-122.8, 53.9], 0, 100), radiusM: 0 },
    ],
    vertical: [
      { id: 'a', chainage: 0, elevation: 802, curveLength: 0 },
      { id: 'b', chainage: 100, elevation: 802, curveLength: 0 },
    ],
    template: { ...DEFAULT_TEMPLATE, crossfallPercent: 0 },
    overrides: [],
  }
}

const settings: RoadSettings = { ...DEFAULT_ROAD_SETTINGS }
const suppliedAnalysis = (): RoadAnalysis => ({
  stations: [],
  centerline: [],
  crossings: [],
  length: 1000,
  cutVolumeM3: 50318.6,
  fillVolumeM3: 84061.3,
  balanceM3: 50318.6 * 0.9 - 84061.3,
  surfaceVolumeM3: 1557.9,
  clearingAreaM2: 22914.2,
  estimatedCost: 1372999.81,
  maxGradePercent: 12,
  completeLength: 957,
  coveragePercent: 95.7,
  warnings: [],
})

const ids = (analysis: RoadAnalysis, road: Alignment, rates = settings) =>
  assessCostReadiness(analysis, road, rates).flags.map((flag) => flag.id)

describe('road cost review', () => {
  it('screens the supplied borrow deficit without extrapolating missing length or adding cost', () => {
    const analysis = suppliedAnalysis()
    const before = structuredClone(analysis)
    const review = assessCostReadiness(analysis, alignment(), settings)
    expect(review.minimumBorrowCompactedM3).toBeCloseTo(38774.56, 6)
    expect(review.quantityCoverageComplete).toBe(false)
    expect(review.flags.find((flag) => flag.id === 'borrow-screening')?.detail).toContain('lower bound')
    expect(analysis).toEqual(before)
  })

  it('does not let a single edited rate hide the remaining placeholders', () => {
    const review = assessCostReadiness(suppliedAnalysis(), alignment(), { ...settings, cutRate: 22 })
    expect(review.placeholderRates).toEqual(['fillRate', 'surfacingRate', 'clearingRate'])
    expect(review.flags.map((flag) => flag.id)).toContain('placeholder-rates')
  })

  it('does not round the reuse factor to the quantity display precision', () => {
    const review = assessCostReadiness(suppliedAnalysis(), alignment(), { ...settings, shrinkFactor: 0.85 })
    expect(review.flags.find((flag) => flag.id === 'unclassified-ground')?.detail).toContain(
      '0.85 compacted m³ per bank m³',
    )
  })

  it('does not treat complete geometry as a complete construction budget', () => {
    const analysis = { ...suppliedAnalysis(), coveragePercent: 100, completeLength: 1000 }
    const review = assessCostReadiness(analysis, alignment(), settings)
    expect(review.quantityCoverageComplete).toBe(true)
    expect(review.flags.map((flag) => flag.id)).toEqual(
      expect.arrayContaining(['haul-disabled', 'unclassified-ground', 'drainage-inventory', 'project-scope']),
    )
    expect(review.flags.map((flag) => flag.id)).not.toContain('partial-sections')
  })

  it('flags a zero rate for positive quantities but not an unused zero rate', () => {
    const road = alignment()
    const analysis = suppliedAnalysis()
    const review = assessCostReadiness(analysis, road, { ...settings, fillRate: 0 })
    expect(review.flags.find((flag) => flag.id === 'zero-work-rates')?.detail).toContain('fill placement')
    expect(ids({ ...analysis, fillVolumeM3: 0 }, road, { ...settings, fillRate: 0 })).not.toContain('zero-work-rates')
  })

  it('uses material-aware reusable volume instead of the base shrink factor', () => {
    const road = alignment()
    road.engineering = createEngineeringDesign()
    const analysis = analyzeRoad(road, { elevationAt: () => 800 }, settings)
    analysis.cutVolumeM3 = 100
    analysis.fillVolumeM3 = 200
    analysis.engineering!.usableCutM3 = 50
    expect(assessCostReadiness(analysis, road, settings).minimumBorrowCompactedM3).toBe(150)
  })

  it('reports positive unallocated borrow with zero supply rate in the actual engine result', () => {
    const road = alignment()
    road.engineering = createEngineeringDesign()
    road.engineering.haul.enabled = true
    const analysis = analyzeRoad(road, { elevationAt: () => 800 }, settings)
    expect(analysis.engineering!.haul.unallocatedBorrowM3).toBeGreaterThan(0)
    expect(ids(analysis, road)).toEqual(expect.arrayContaining(['unallocated-haul', 'zero-supply-rates']))
    expect(ids(analysis, road)).not.toContain('borrow-screening')
  })

  it('flags priced-volume endhaul at zero cost, while allowing intentionally free haul', () => {
    const road = alignment()
    road.engineering = createEngineeringDesign()
    road.engineering.haul.enabled = true
    road.engineering.sites = [
      {
        id: 'borrow',
        name: 'Pit',
        kind: 'borrow',
        chainage: 50,
        accessDistanceM: 1000,
        capacityM3: null,
        unitRate: 10,
        fixedCost: 0,
      },
    ]
    const distant = analyzeRoad(road, { elevationAt: () => 800 }, settings)
    expect(ids(distant, road)).toContain('zero-haul-rates')
    road.engineering.haul.freeHaulDistanceM = 100
    road.engineering.sites[0].accessDistanceM = 0
    const nearby = analyzeRoad(road, { elevationAt: () => 800 }, settings)
    expect(nearby.engineering!.movements.every((movement) => movement.category === 'freehaul')).toBe(true)
    expect(ids(nearby, road)).not.toContain('zero-haul-rates')
  })

  it('keeps material and structure zero-price flags even if other items are priced', () => {
    const road = alignment()
    road.engineering = createEngineeringDesign()
    road.engineering.materials = [
      { id: 'soil', name: 'Soil', color: '#987', cutRate: 0, reusableFraction: 1, compactionFactor: 0.9 },
    ]
    road.engineering.strata = [
      { id: 'layer', start: 0, end: 100, materialId: 'soil', topDepthM: 0, bottomDepthM: null },
    ]
    road.engineering.culverts = [
      {
        id: 'culvert',
        name: 'Cross drain',
        chainage: 50,
        skewDegrees: 0,
        lengthM: 12,
        diameterM: 0.6,
        inletInvertM: null,
        outletInvertM: null,
        minCoverM: 0.5,
        unitCost: 0,
        fixedCost: 0,
      },
    ]
    const analysis = analyzeRoad(road, { elevationAt: () => 804 }, settings)
    expect(ids(analysis, road)).toEqual(
      expect.arrayContaining(['zero-work-rates', 'zero-culvert-rates', 'incomplete-culverts']),
    )
    expect(assessCostReadiness(analysis, road, settings).placeholderRates).not.toContain('cutRate')
  })

  it('requires an associated crossing at the right station, not just any entered culvert', () => {
    const road = alignment()
    const analysis = suppliedAnalysis()
    analysis.crossings = [
      {
        id: 'crossing',
        featureId: 'stream-1',
        name: 'Creek',
        kind: 'stream',
        chainage: 50,
        coordinate: [-122.8, 53.9],
      },
    ]
    road.engineering = createEngineeringDesign()
    road.engineering.culverts = [
      {
        id: 'c',
        name: 'Pipe',
        sourceFeatureId: 'stream-1',
        chainage: 52,
        skewDegrees: 0,
        lengthM: 12,
        diameterM: 0.6,
        inletInvertM: 800,
        outletInvertM: 799.8,
        minCoverM: 0.5,
        unitCost: 100,
        fixedCost: 500,
      },
    ]
    expect(ids(analysis, road)).toContain('unassigned-crossings')
    road.engineering.culverts[0].chainage = 51
    expect(ids(analysis, road)).not.toContain('unassigned-crossings')
  })
})
