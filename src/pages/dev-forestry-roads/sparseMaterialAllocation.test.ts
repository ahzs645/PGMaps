import { describe, expect, it } from 'vitest'
import { linearHaulSlope, solveSparseMaterialAllocation } from './sparseMaterialAllocation'
import { solveDenseMaterialAllocation, type AllocationParcel } from './materialAllocation'
import { createEngineeringDesign, type AlignmentEngineering, type HaulSite } from './engineeringTypes'

function design(rate = 1000): AlignmentEngineering {
  const e = createEngineeringDesign()
  Object.assign(e.haul, {
    enabled: true,
    allocation: 'economic',
    freeHaulDistanceM: 0,
    overhaulDistanceM: 0,
    freeHaulRate: rate,
    overhaulRate: rate,
    endHaulRate: rate,
    freeHaulLoadingRate: 0,
    overhaulLoadingRate: 0,
    endHaulLoadingRate: 0,
  })
  e.materials = [
    { id: 'rock', name: 'Rock', color: '#555555', cutRate: 0, reusableFraction: 1, compactionFactor: 1, quality: 90 },
    { id: 'soil', name: 'Soil', color: '#805030', cutRate: 0, reusableFraction: 1, compactionFactor: 1, quality: 20 },
  ]
  return e
}
function parcel(id: string, chainage: number, fill = 0, bank = 0, factor = 1, materialId = 'rock'): AllocationParcel {
  return {
    id,
    start: chainage - 5,
    end: chainage + 5,
    chainage,
    run: 1,
    fill,
    cut: bank ? [{ materialId, bank, usable: bank * factor, unusable: 0, factor }] : [],
  }
}
function site(
  id: string,
  kind: 'borrow' | 'waste',
  chainage: number,
  unitRate: number,
  fixedCost = 0,
  capacityM3: number | null = null,
  materialId?: string,
): HaulSite {
  return {
    id,
    name: id,
    kind,
    chainage,
    unitRate,
    fixedCost,
    capacityM3,
    accessDistanceM: 0,
    ...(materialId ? { materialId } : {}),
  }
}

describe('exact sparse chain material allocation', () => {
  it('matches the independently worked assignment optimum instead of nearest-first', () => {
    const result = solveSparseMaterialAllocation(
      design(),
      [parcel('s0', 0, 0, 1), parcel('s1', 10, 0, 1), parcel('d0', 6, 1), parcel('d1', 9, 1)],
      (d) => d,
    )!
    expect(result.status).toBe('optimal')
    expect(result.objectiveCost).toBeCloseTo(7)
    expect(result.movements.find((m) => m.targetId === 'd0')?.sourceId).toBe('s0')
  })
  it('matches exhaustive three-source transport oracles with zero or positive linear haul', () => {
    const permutations = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ]
    for (const rate of [0, 1])
      for (let seed = 1; seed <= 12; seed++) {
        const sources = [seed % 4, 6 + (seed % 3), 15 + (seed % 5)],
          fills = [3 + (seed % 7), 8 + (seed % 4), 11 + (seed % 9)]
        const optimum = Math.min(
          ...permutations.map((p) => fills.reduce((sum, c, i) => sum + Math.abs(c - sources[p[i]]) * rate, 0)),
        )
        const parcels = [
          ...sources.map((s, i) => parcel(`s${i}`, s, 0, 1)),
          ...fills.map((s, i) => parcel(`d${i}`, s, 1)),
        ]
        const result = solveSparseMaterialAllocation(design(rate * 1000), parcels, (d) => d * rate)!
        expect(result.status).toBe('optimal')
        expect(result.objectiveCost).toBeCloseTo(optimum, 6)
        expect(result.movements.reduce((sum, m) => sum + (m.bankVolumeM3 ?? 0), 0)).toBeCloseTo(3)
      }
  })
  it('keeps bank/compacted transport costs separate through a 0.5 conversion', () => {
    const e = design()
    e.sites = [site('spoil', 'waste', 5, 2, 7, 4)]
    const result = solveSparseMaterialAllocation(e, [parcel('cut', 0, 0, 10, 0.5), parcel('fill', 10, 3)], (d) => d)!
    expect(result.status).toBe('optimal')
    const fill = result.movements.filter((m) => m.kind === 'cut-to-fill'),
      waste = result.movements.filter((m) => m.kind === 'waste')
    expect(fill.reduce((s, m) => s + m.bankVolumeM3!, 0)).toBeCloseTo(6)
    expect(fill.reduce((s, m) => s + m.compactedVolumeM3!, 0)).toBeCloseTo(3)
    expect(waste.reduce((s, m) => s + m.bankVolumeM3!, 0)).toBeCloseTo(4)
    // 3 compacted m³×10m +4 bank m³×5m +4bank×$2 disposal +$7 fixed.
    expect(result.objectiveCost).toBeCloseTo(65)
    e.sites[0].capacityM3 = 3.99
    expect(
      solveSparseMaterialAllocation(e, [parcel('cut', 0, 0, 10, 0.5), parcel('fill', 10, 3)], (d) => d)!.status,
    ).toBe('infeasible')
  })
  it('shares finite source capacity across fill and distinct course demands and opens the cheapest combined pit', () => {
    const e = design(0)
    e.sites = [site('fixed', 'borrow', 5, 0, 5, 3, 'rock'), site('variable', 'borrow', 5, 3, 0, 3, 'rock')]
    const p = parcel('fill', 5, 2)
    p.demands = [{ layer: 'course', volumeM3: 1, materialId: 'rock', key: 'surface-course' }]
    const result = solveSparseMaterialAllocation(e, [p], () => 0)!
    expect(result.status).toBe('optimal')
    expect(result.objectiveCost).toBeCloseTo(5)
    expect(result.usedSiteIds).toEqual(['fixed'])
    expect(result.movements.reduce((s, m) => s + m.compactedVolumeM3!, 0)).toBeCloseTo(3)
    expect(new Set(result.movements.map((m) => m.demandKey))).toEqual(new Set(['subgrade', 'surface-course']))
    e.sites.forEach((s) => {
      s.capacityM3 = 1
    })
    expect(solveSparseMaterialAllocation(e, [p], () => 0)!.status).toBe('infeasible')
  })
  it('reserves high-quality cut and respects construction directions and coverage gaps', () => {
    const e = design()
    e.fillRequirements = [
      { id: 'low', start: 5, end: 15, layer: 'subgrade', minQuality: 0, replaceable: true },
      { id: 'high', start: 15, end: 25, layer: 'subgrade', minQuality: 80, replaceable: true },
    ]
    const p = [
      parcel('rock-cut', 1, 0, 1),
      parcel('soil-cut', 2, 0, 1, 1, 'soil'),
      parcel('low-fill', 10, 1),
      parcel('high-fill', 20, 1),
    ]
    const result = solveSparseMaterialAllocation(e, p, (d) => d)!
    expect(result.status).toBe('optimal')
    expect(result.movements.find((m) => m.targetId === 'high-fill')?.materialId).toBe('rock')
    const backwards = [parcel('cut', 15, 0, 1), parcel('fill', 5, 1)]
    e.fillRequirements = []
    e.haul.directionRanges = [{ id: 'forward', start: 0, end: 25, direction: 'forward' }]
    expect(solveSparseMaterialAllocation(e, backwards, (d) => d)!.status).toBe('infeasible')
    e.haul.directionRanges = []
    backwards[1].run = 2
    expect(solveSparseMaterialAllocation(e, backwards, (d) => d)!.status).toBe('infeasible')
  })
  it('keeps sidecast local to original excavation and shares its limit across suitable and unsuitable material', () => {
    const e = design(0)
    e.haul.sidecastRanges = [{ id: 'local', start: 0, end: 10, capacityBankM3PerM: 0.2, unitRate: 1 }]
    e.sites = [site('spoil', 'waste', 5, 3)]
    const p = parcel('cut', 5, 0, 2)
    p.cut.push({ materialId: 'soil', bank: 2, usable: 0, unusable: 2, factor: 0.5 })
    const result = solveSparseMaterialAllocation(e, [p], () => 0)!
    expect(result.status).toBe('optimal')
    expect(result.objectiveCost).toBeCloseTo(8)
    expect(
      result.movements.filter((m) => m.disposalMethod === 'sidecast').reduce((s, m) => s + m.bankVolumeM3!, 0),
    ).toBeCloseTo(2)
    // No material excavated elsewhere can be sent down a chain and then sidecast in this range.
    e.sites = []
    expect(solveSparseMaterialAllocation(e, [parcel('outside', 20, 0, 1), parcel('inside', 5)], () => 0)!.status).toBe(
      'infeasible',
    )
  })
  it('refuses sparse shortcuts for loading steps, discontinuous free/excess tariffs and deferred network supply', () => {
    const e = design()
    expect(linearHaulSlope(e, 100, (d) => d)).toBe(1)
    e.haul.freeHaulLoadingRate = 1
    expect(linearHaulSlope(e, 100, (d) => d)).toBe(null)
    e.haul.freeHaulLoadingRate = 0
    e.haul.freeHaulDistanceM = 24
    e.haul.overhaulDistanceM = 150
    expect(linearHaulSlope(e, 100, (d) => (d <= 24 ? d : d - 24))).toBe(null)
    e.haul.freeHaulDistanceM = 0
    e.haul.overhaulRate = 1000
    e.haul.endHaulRate = 2000
    e.haul.overhaulDistanceM = 50
    expect(linearHaulSlope(e, 100, (d) => (d <= 50 ? d : 2 * d))).toBe(null)
    expect(solveSparseMaterialAllocation(design(), [], (d) => d, { deferExternal: true })).toBe(null)
    const epsilonStep = design()
    epsilonStep.haul.freeHaulRate = 0
    expect(linearHaulSlope(epsilonStep, 100, (d) => (d <= 1e-7 ? 0 : d))).toBe(null)
  })
  it('solves a 100-parcel forward construction chain without creating the all-pairs source matrix', () => {
    const e = design(1)
    e.fillRequirements = [
      { id: 'rock', start: 0, end: 1000, layer: 'subgrade', materialId: 'rock', replaceable: false },
    ]
    e.haul.directionRanges = [{ id: 'forward', start: 0, end: 1000, direction: 'forward' }]
    e.sites = [site('borrow', 'borrow', 0, 10, 100, null, 'rock'), site('spoil', 'waste', 1000, 2, 50)]
    const p = Array.from({ length: 100 }, (_, i) => {
      const row = parcel(`p${i}`, i * 10 + 5, 3, 3 + (i % 3), 0.9)
      row.demands = [{ layer: 'course', volumeM3: 0.5, materialId: 'rock' }]
      return row
    })
    const result = solveSparseMaterialAllocation(e, p, (d) => d / 1000)!
    expect(result.status).toBe('optimal')
    expect(result.variables).toBeLessThan(1500)
    expect(result.movements.length).toBeGreaterThan(100)
  })
  it('matches the independent dense formulation for mixed materials, access distances, sidecast and fixed openings', () => {
    for (let seed = 0; seed < 12; seed++) {
      const e = design(2)
      if (seed % 2) e.haul.directionRanges = [{ id: 'forward', start: 0, end: 30, direction: 'forward' }]
      e.haul.sidecastRanges = [
        {
          id: 'local',
          start: 0,
          end: 10,
          capacityBankM3PerM: 0.1,
          unitRate: 0.3,
          materialIds: seed % 3 ? ['soil'] : undefined,
        },
      ]
      e.sites = [
        site('rock-pit', 'borrow', 0, 3, 2, 4, 'rock'),
        site('soil-pit', 'borrow', 30, 1, 0, 20, 'soil'),
        site('waste', 'waste', 30, 0.5, 1, 50),
      ]
      e.sites[0].accessDistanceM = 7
      e.sites[2].accessDistanceM = 3
      e.fillRequirements = [
        { id: 'common', start: 0, end: 30, layer: 'subgrade', minQuality: 0, replaceable: true },
        { id: 'course', start: 0, end: 30, layer: 'course', minQuality: 80, replaceable: true },
      ]
      const p = [
        parcel('rock-cut', 5, 0, 3 + (seed % 3), 0.5),
        parcel('soil-cut', 15, 0, 2 + (seed % 2), 1, 'soil'),
        parcel('fill', 25, 4 + (seed % 2)),
      ]
      p[1].cut.push({ materialId: 'rock', bank: 0.5, usable: 0, unusable: 0.5, factor: 0.5 })
      p[2].demands = [{ layer: 'course', volumeM3: 1, materialId: 'rock', key: 'course-material' }]
      const sparse = solveSparseMaterialAllocation(e, p, (d) => 0.002 * d)!
      const dense = solveDenseMaterialAllocation(e, p, (d) => 0.002 * d)
      expect(sparse.status, `seed ${seed}`).toBe(dense.status)
      if (sparse.status === 'optimal') expect(sparse.objectiveCost, `seed ${seed}`).toBeCloseTo(dense.objectiveCost!, 5)
    }
  })
  it('rejects malformed bank conversion, impossible component quantities and oversized models before adopting any movements', () => {
    const e = design(),
      bad = parcel('bad', 5, 0, 1)
    bad.cut[0].usable = 2
    expect(() => solveSparseMaterialAllocation(e, [bad], (d) => d)).toThrow(/conserve bank/)
    const fill = parcel('fill', 5, 1)
    fill.demands = [{ layer: 'key', subgrade: true, materialId: 'rock', volumeM3: 2 }]
    expect(() => solveSparseMaterialAllocation(e, [fill], (d) => d)).toThrow(/exceeds.*subgrade/)
    expect(() => solveSparseMaterialAllocation(e, [{ ...fill, fill: NaN }], (d) => d)).toThrow(/invalid interval/)
    const many = Array.from({ length: 601 }, (_, i) => parcel(`p${i}`, i * 10 + 5, 1, 1))
    expect(() => solveSparseMaterialAllocation(e, many, (d) => d)).toThrow(/constraint budget/)
  })
})
