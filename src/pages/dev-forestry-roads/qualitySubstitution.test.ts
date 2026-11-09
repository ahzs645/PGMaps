import { describe, expect, it } from 'vitest'
import { assessCostReadiness } from './costReadiness'
import { analyzeRoad, offsetCoordinate } from './engine'
import { createEngineeringDesign, type AlignmentEngineering, type HaulSite } from './engineeringTypes'
import {
  allocationPivotLimit,
  solveDenseMaterialAllocation,
  solveMaterialAllocation,
  type AllocationParcel,
} from './materialAllocation'
import { solveSparseMaterialAllocation } from './sparseMaterialAllocation'
import type { Alignment, Coordinate, RoadSettings } from './types'

/** A linear haul quote of `ratePerM` dollars per transported m³ per metre, with no free-haul step. */
function design(ratePerM: number): AlignmentEngineering {
  const e = createEngineeringDesign()
  Object.assign(e.haul, {
    enabled: true,
    allocation: 'economic',
    freeHaulDistanceM: 0,
    overhaulDistanceM: 0,
    freeHaulRate: ratePerM * 1000,
    overhaulRate: ratePerM * 1000,
    endHaulRate: ratePerM * 1000,
  })
  return e
}
const material = (id: string, quality: number | undefined, compactionFactor = 1) => ({
  id,
  name: id,
  color: '#777777',
  cutRate: 0,
  reusableFraction: 1,
  compactionFactor,
  ...(quality === undefined ? {} : { quality }),
})
const waste = (chainage: number, unitRate: number): HaulSite => ({
  id: 'spoil',
  name: 'Spoil',
  kind: 'waste',
  chainage,
  accessDistanceM: 0,
  capacityM3: null,
  unitRate,
  fixedCost: 0,
})
const cut = (materialId: string, bank: number, factor = 1) => ({
  materialId,
  bank,
  usable: bank * factor,
  unusable: 0,
  factor,
})
const parcel = (id: string, chainage: number, fill: number, cuts: AllocationParcel['cut']): AllocationParcel => ({
  id,
  start: chainage - 5,
  end: chainage + 5,
  chainage,
  fill,
  cut: cuts,
})

describe('fill substitution by quality: a case worked by hand', () => {
  // Fill must be "common fill" or anything of quality 2 or better. Rock (quality 5) and hard pan
  // (quality 3, 0.5 compacted per bank) qualify; silt (quality 1) does not. Haul costs $1 per m³
  // per metre, and the one waste site, at station 100, charges $2 per bank m³.
  //
  //   A, station 0:   10 bank m³ of rock
  //   B, station 100: 10 bank m³ of silt, needs 4 m³ of fill
  //   C, station 200:  6 bank m³ of hard pan (3 m³ compacted), needs 5 m³ of fill
  //
  // All silt is wasted on the spot: 10 × $2 = $20. Let p be the hard pan placed at C and q the
  // hard pan hauled to B (compacted, p + q ≤ 3); rock supplies the rest. Then
  //   cost = 100(4 − q) + 200(5 − p) + 100q            haul of fill
  //        + 102(1 + p + q) + 102(6 − 2p − 2q) + 20     leftover rock, leftover pan, silt
  //        = 2134 − 200p − 102(p + q),
  // least at p = 3, q = 0: $1,228. Rock: 4 m³ to B ($400) and 2 m³ to C ($400), 4 m³ wasted
  // (4 × $102 = $408); all hard pan stays at C; silt $20.
  const parcels = [
    parcel('A', 0, 0, [cut('rock', 10)]),
    parcel('B', 100, 4, [cut('silt', 10)]),
    parcel('C', 200, 5, [cut('pan', 6, 0.5)]),
  ]
  const rules = (replaceable: boolean) => {
    const e = design(1)
    e.materials = [material('rock', 5), material('pan', 3, 0.5), material('silt', 1), material('common', 2)]
    e.sites = [waste(100, 2)]
    e.fillRequirements = [
      { id: 'q', start: 0, end: 1000, layer: 'subgrade', materialId: 'common', minQuality: 2, replaceable },
    ]
    return e
  }
  it('reaches the hand-computed optimum of $1,228 with the right material in each fill', () => {
    const e = rules(true)
    for (const solve of [solveMaterialAllocation, solveDenseMaterialAllocation]) {
      const result = solve(e, parcels, (d) => d)
      expect(result.status).toBe('optimal')
      expect(result.objectiveCost).toBeCloseTo(1228, 6)
      const moved = (kind: string, materialId: string, targetId?: string) =>
        result.movements
          .filter(
            (m) =>
              m.kind === kind && m.materialId === materialId && (targetId === undefined || m.targetId === targetId),
          )
          .reduce((sum, m) => sum + m.transportedVolumeM3, 0)
      expect(moved('cut-to-fill', 'rock', 'B')).toBeCloseTo(4, 6)
      expect(moved('cut-to-fill', 'rock', 'C')).toBeCloseTo(2, 6)
      expect(moved('cut-to-fill', 'pan', 'C')).toBeCloseTo(3, 6)
      expect(moved('cut-to-fill', 'pan', 'B')).toBeCloseTo(0, 6)
      // Poorer material is never placed, only wasted; waste is in bank m³.
      expect(moved('cut-to-fill', 'silt')).toBe(0)
      expect(moved('waste', 'silt')).toBeCloseTo(10, 6)
      expect(moved('waste', 'rock')).toBeCloseTo(4, 6)
      expect(moved('waste', 'pan')).toBeCloseTo(0, 6)
    }
  })
  it('keeps the exact-material rule distinct: no cut qualifies, so only a named pit can supply it', () => {
    const e = rules(false)
    expect(solveMaterialAllocation(e, parcels, (d) => d).status).toBe('infeasible')
    // A pit of common fill at station 100: 4 m³ at 0 m and 5 m³ at 100 m, all cut wasted.
    e.sites.push({ ...waste(100, 0), id: 'pit', name: 'Pit', kind: 'borrow', materialId: 'common', unitRate: 10 })
    const result = solveMaterialAllocation(e, parcels, (d) => d)
    expect(result.status).toBe('optimal')
    // Borrow 9 × $10 + 5 × 100 haul; waste 26 bank m³ × $2 + (10 + 6) × 100 haul.
    expect(result.objectiveCost).toBeCloseTo(90 + 500 + 52 + 1600, 6)
    expect(result.movements.some((m) => m.kind === 'cut-to-fill')).toBe(false)
  })
})

describe('fill substitution by quality at the size of a real road', () => {
  /** A 930 m road at 10 m stations: three interchangeable materials, like the walkthrough's. */
  function roadParcels(): AllocationParcel[] {
    let seed = 7
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    return Array.from({ length: 93 }, (_, i) => {
      const cuts: AllocationParcel['cut'] = []
      // Gravel over the first quarter, hard pan beyond, fractured rock where the cut is deep.
      cuts.push(cut(i < 24 ? 'gravel' : 'pan', 20 + random() * 60))
      if (random() < 0.3) cuts.push(cut('rock', random() * 30))
      return parcel(`p${i}`, i * 10 + 5, random() < 0.6 ? random() * 15 : 0, cuts)
    })
  }
  function rules(ratePerM: number) {
    const e = design(ratePerM)
    e.materials = [material('pan', 3), material('rock', 5), material('gravel', 4), material('common', 2)]
    e.sites = [waste(465, 0)]
    e.fillRequirements = [
      { id: 'q', start: 0, end: 930, layer: 'subgrade', materialId: 'common', minQuality: 2, replaceable: true },
    ]
    return e
  }
  it('solves with every rate at zero, where the old pivot limit reported a cycle', () => {
    const parcels = roadParcels()
    const result = solveMaterialAllocation(rules(0), parcels, () => 0)
    expect(result.status).toBe('optimal')
    expect(result.objectiveCost).toBe(0)
    // The limit that failed: 500 million updates over this tableau allowed fewer pivots than rows.
    const rows = result.constraints * 2 + 1
    expect(Math.floor(500_000_000 / ((result.variables + 1) * rows))).toBeLessThan(rows / 2)
    expect(allocationPivotLimit(rows)).toBeGreaterThanOrEqual(4 * rows)
    const fill = parcels.reduce((sum, p) => sum + p.fill, 0),
      bank = parcels.reduce((sum, p) => sum + p.cut.reduce((s, m) => s + m.bank, 0), 0)
    const placed = result.movements.filter((m) => m.kind === 'cut-to-fill'),
      wasted = result.movements.filter((m) => m.kind === 'waste')
    expect(placed.reduce((sum, m) => sum + m.compactedVolumeM3!, 0)).toBeCloseTo(fill, 5)
    expect(wasted.reduce((sum, m) => sum + m.bankVolumeM3!, 0)).toBeCloseTo(bank - fill, 5)
  })
  it('matches the closed-form optimum with a haul rate', () => {
    // Every material converts 1:1 and each interval cuts more than it fills, so the cheapest plan
    // fills each interval from its own cut and hauls only the surplus to the waste site:
    // cost = Σ (cut − fill) × distance to the site × rate.
    const parcels = roadParcels()
    const expected = parcels.reduce(
      (sum, p) => sum + (p.cut.reduce((s, m) => s + m.bank, 0) - p.fill) * Math.abs(p.chainage - 465) * 0.003,
      0,
    )
    expect(parcels.every((p) => p.cut.reduce((s, m) => s + m.bank, 0) >= p.fill)).toBe(true)
    const result = solveSparseMaterialAllocation(rules(0.003), parcels, (d) => d * 0.003)!
    expect(result.status).toBe('optimal')
    expect(result.objectiveCost).toBeCloseTo(expected, 4)
  })
})

describe('a material plan that cannot be solved leaves the road standing', () => {
  const origin: Coordinate = [-122.8, 53.9]
  const settings: RoadSettings = {
    stationInterval: 2,
    crossSectionHalfWidth: 30,
    maxGradePercent: 12,
    minRadius: 25,
    cutRate: 2,
    fillRate: 3,
    surfacingRate: 4,
    clearingRate: 0.5,
    shrinkFactor: 1,
  }
  it('keeps geometry and quantities and marks only the plan when the model is over its limit', () => {
    // Alternating cut and fill every 2 m over 600 m with a stepped tariff needs the dense model,
    // which is far larger than its tableau limit.
    const road: Alignment = {
      id: 'road',
      name: 'Road',
      color: '#16817a',
      points: [
        { id: 'a', coordinate: origin, radiusM: 0 },
        { id: 'b', coordinate: offsetCoordinate(origin, 0, 600), radiusM: 0 },
      ],
      vertical: [
        { id: 's', chainage: 0, elevation: 800, curveLength: 0 },
        { id: 'e', chainage: 600, elevation: 800, curveLength: 0 },
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
      engineering: createEngineeringDesign(),
    }
    Object.assign(road.engineering!.haul, { enabled: true, allocation: 'economic', overhaulRate: 3, endHaulRate: 4 })
    const terrain = {
      elevationAt: (_: number, latitude: number) =>
        800 + Math.sin((((latitude - origin[1]) * Math.PI) / 180) * 6371008.8 * 0.5),
    }
    const result = analyzeRoad(road, terrain, settings)
    expect(result.length).toBeCloseTo(600, 3)
    expect(result.coveragePercent).toBeCloseTo(100, 5)
    expect(result.cutVolumeM3).toBeGreaterThan(100)
    expect(result.fillVolumeM3).toBeGreaterThan(100)
    const e = result.engineering!
    expect(e.haul.optimizationStatus).toBe('unsolved')
    expect(e.complete).toBe(false)
    expect(e.movements).toEqual([])
    expect(e.costs.haul + e.costs.borrow + e.costs.waste).toBe(0)
    expect(e.costs.cut).toBeCloseTo(result.cutVolumeM3 * 2, 6)
    expect(result.warnings.join(' ')).toMatch(/Material plan not solved: Economic allocation exceeds/)
    expect(assessCostReadiness(result, road, settings).flags.map((flag) => flag.id)).toContain('unsolved-material-plan')
  })
})
