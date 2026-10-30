/** Independent adversarial review cases for material-flow and section-demand integration. */
import { describe, expect, it } from 'vitest'
import { analyzeRoad, offsetCoordinate } from './engine'
import { haulCostLines } from './engineering'
import { solveMaterialAllocation, type AllocationParcel } from './materialAllocation'
import { createEngineeringDesign, type AlignmentEngineering, type HaulSite } from './engineeringTypes'
import type { Alignment, RoadSettings } from './types'

const settings: RoadSettings = {
  stationInterval: 10,
  crossSectionHalfWidth: 30,
  maxGradePercent: 12,
  minRadius: 25,
  cutRate: 2,
  fillRate: 3,
  surfacingRate: 100,
  clearingRate: 0,
  shrinkFactor: 1,
}
const origin: [number, number] = [-122.8, 53.9]
function engineering(): AlignmentEngineering {
  const e = createEngineeringDesign()
  e.haul.enabled = true
  e.haul.allocation = 'economic'
  e.materials = [
    { id: 'rock', name: 'Rock', color: '#555555', cutRate: 2, reusableFraction: 1, compactionFactor: 1, quality: 90 },
    { id: 'soil', name: 'Soil', color: '#805030', cutRate: 1, reusableFraction: 1, compactionFactor: 1, quality: 20 },
  ]
  return e
}
function site(
  id: string,
  kind: 'borrow' | 'waste',
  materialId?: string,
  unitRate = 0,
  fixedCost = 0,
  capacityM3: number | null = null,
): HaulSite {
  return {
    id,
    name: id,
    kind,
    chainage: 50,
    accessDistanceM: 0,
    unitRate,
    fixedCost,
    capacityM3,
    ...(materialId ? { materialId } : {}),
  }
}
function parcel(id = 'p', fill = 0, bank = 0): AllocationParcel {
  return {
    id,
    start: 0,
    end: 100,
    chainage: 50,
    run: 1,
    fill,
    cut: bank ? [{ materialId: 'rock', bank, usable: bank, unusable: 0, factor: 1 }] : [],
  }
}
function road(): Alignment {
  return {
    id: 'review',
    name: 'Review',
    color: '#123456',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: offsetCoordinate(origin, 0, 100), radiusM: 0 },
    ],
    vertical: [
      { id: 'v0', chainage: 0, elevation: 800, curveLength: 0 },
      { id: 'v1', chainage: 100, elevation: 800, curveLength: 0 },
    ],
    template: {
      leftWidth: 3,
      rightWidth: 3,
      crossfallPercent: 0,
      cutSlope: 1,
      fillSlope: 1,
      ditchWidth: 0,
      ditchDepth: 0,
      surfaceDepth: 0,
    },
    overrides: [],
    engineering: engineering(),
  }
}

describe('independent allocation integration review', () => {
  it('does not activate a physical waste site whose imported ID happens to equal a synthetic sidecast target', () => {
    const e = engineering()
    e.haul.sidecastRanges = [{ id: 'permitted', start: 0, end: 100, capacityBankM3PerM: 1, unitRate: 1 }]
    e.sites = [site('sidecast:permitted', 'waste', undefined, 100, 50)]
    const result = solveMaterialAllocation(e, [parcel('cut', 0, 1)], () => 0)
    expect(result.status).toBe('optimal')
    expect(result.objectiveCost).toBeCloseTo(1)
    expect(result.usedSiteIds).toEqual([])
  })

  it('keeps separately assigned left/right courses with copied layer IDs and different material specifications', () => {
    const a = road(),
      e = a.engineering!
    e.templates = [
      {
        id: 'left',
        name: 'Rock course',
        template: {
          ...a.template,
          layers: [{ id: 'base', name: 'Base', side: 'both', depthM: 0.2, materialId: 'rock' }],
        },
      },
      {
        id: 'right',
        name: 'Soil course',
        template: {
          ...a.template,
          layers: [{ id: 'base', name: 'Base', side: 'both', depthM: 0.2, materialId: 'soil' }],
        },
      },
    ]
    e.assignments = [
      { id: 'left-side', start: 0, end: 101, side: 'left', templateId: 'left', transitionM: 0 },
      { id: 'right-side', start: 0, end: 101, side: 'right', templateId: 'right', transitionM: 0 },
    ]
    e.sites = [site('rock-pit', 'borrow', 'rock', 10), site('soil-pit', 'borrow', 'soil', 1)]
    const result = analyzeRoad(a, { elevationAt: () => 800 }, settings)
    expect(result.surfaceVolumeM3).toBeCloseTo(120, 5)
    const rows = result.engineering!.movements.filter((m) => m.kind === 'borrow')
    expect(rows.filter((m) => m.materialId === 'rock').reduce((s, m) => s + m.compactedVolumeM3!, 0)).toBeCloseTo(60, 4)
    expect(rows.filter((m) => m.materialId === 'soil').reduce((s, m) => s + m.compactedVolumeM3!, 0)).toBeCloseTo(60, 4)
    expect(result.engineering!.costs.borrow).toBeCloseTo(660, 3)
    expect(result.engineering!.costs.surfacing).toBeCloseTo(120 * settings.fillRate, 4)
    const lines = haulCostLines(e, result.engineering!)
    for (const group of ['haul', 'borrow', 'waste', 'sitePreparation'] as const)
      expect(lines.filter((line) => line.group === group).reduce((s, line) => s + line.amount, 0)).toBeCloseTo(
        result.engineering!.costs[group],
        5,
      )
  })

  it('does not spend capacity on an unsuitable material when a lower cost eligible pit is available', () => {
    const e = engineering()
    e.fillRequirements = [{ id: 'fill', start: 0, end: 100, layer: 'subgrade', minQuality: 80, replaceable: true }]
    e.sites = [site('cheap-soil', 'borrow', 'soil', 0), site('rock', 'borrow', 'rock', 4, 2, 3)]
    const result = solveMaterialAllocation(e, [parcel('fill', 3)], () => 0)
    expect(result.status).toBe('optimal')
    expect(result.movements.every((m) => m.materialId === 'rock')).toBe(true)
    expect(result.objectiveCost).toBeCloseTo(14)
    e.sites[1].capacityM3 = 2.999
    expect(solveMaterialAllocation(e, [parcel('fill', 3)], () => 0).status).toBe('infeasible')
  })

  it('shares sidecast capacity across reusable and unsuitable cuts at the same parcel', () => {
    const e = engineering()
    e.haul.sidecastRanges = [{ id: 'local', start: 0, end: 100, capacityBankM3PerM: 0.02, unitRate: 1 }]
    e.sites = [site('waste', 'waste', undefined, 3)]
    const p = parcel('mixed', 0, 2)
    p.cut.push({ materialId: 'soil', bank: 2, usable: 0, unusable: 2, factor: 0.5 })
    const result = solveMaterialAllocation(e, [p], () => 0)
    expect(result.status).toBe('optimal')
    expect(
      result.movements.filter((m) => m.disposalMethod === 'sidecast').reduce((s, m) => s + m.bankVolumeM3!, 0),
    ).toBeCloseTo(2)
    expect(
      result.movements.filter((m) => m.disposalMethod !== 'sidecast').reduce((s, m) => s + m.bankVolumeM3!, 0),
    ).toBeCloseTo(2)
    expect(result.objectiveCost).toBeCloseTo(8)
  })
})
