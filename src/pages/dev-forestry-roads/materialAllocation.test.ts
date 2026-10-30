import { describe, expect, it } from 'vitest'
import { acceptsFill, haulDirectionAllowed, parseAllocationPolicy, validateAllocationPolicy } from './allocationPolicy'
import { solveMaterialAllocation, type AllocationParcel } from './materialAllocation'
import { createEngineeringDesign, type AlignmentEngineering, type HaulSite } from './engineeringTypes'

function design(): AlignmentEngineering {
  const e = createEngineeringDesign()
  e.haul.enabled = true
  e.haul.allocation = 'economic'
  e.materials = [
    { id: 'rock', name: 'Rock', color: '#888888', cutRate: 0, reusableFraction: 1, compactionFactor: 1, quality: 90 },
    { id: 'soil', name: 'Soil', color: '#806040', cutRate: 0, reusableFraction: 1, compactionFactor: 1, quality: 20 },
  ]
  return e
}
function parcel(id: string, chainage: number, fill = 0, bank = 0, materialId = 'rock', factor = 1): AllocationParcel {
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
): HaulSite {
  return { id, name: id, kind, chainage, accessDistanceM: 0, capacityM3, unitRate, fixedCost }
}

describe('economic material flow', () => {
  it('solves a 40-interval construction model including tiny event parcels without exhausting phase pivots', () => {
    const e = design()
    e.haul.directionRanges = [{ id: 'forward', start: 0, end: 400, direction: 'forward' }]
    e.sites = [{ ...site('borrow', 'borrow', 0, 10, 100), materialId: 'rock' }, site('waste', 'waste', 400, 2, 50)]
    e.fillRequirements = [
      { id: 'rock-fill', start: 0, end: 400, layer: 'subgrade', materialId: 'rock', replaceable: false },
    ]
    const parcels = Array.from({ length: 40 }, (_, i) => {
      const p = parcel(`interval-${i}`, 5 + i * 10, 2 + (i % 3), 3 + (i % 5), 'rock', 0.9)
      p.cut.push({
        materialId: 'soil',
        bank: i % 2 ? 0.00001 : 0.1,
        usable: 0,
        unusable: i % 2 ? 0.00001 : 0.1,
        factor: 1,
      })
      p.demands = [{ layer: 'course', materialId: 'rock', volumeM3: 0.5 }]
      return p
    })
    const result = solveMaterialAllocation(e, parcels, (d) => d / 1000)
    expect(result.status).toBe('optimal')
    expect(result.variables).toBeGreaterThan(1500)
    expect(result.movements.length).toBeGreaterThan(40)
  })
  it('beats chainage-order nearest allocation on an independently worked transport case', () => {
    const e = design()
    const result = solveMaterialAllocation(
      e,
      [parcel('left', 0, 0, 1), parcel('right', 10, 0, 1), parcel('first-fill', 6, 1), parcel('second-fill', 9, 1)],
      (d) => d,
    )
    expect(result.status).toBe('optimal')
    // Nearest-first costs |10-6|+|0-9|=13; optimum |0-6|+|10-9|=7.
    expect(result.objectiveCost).toBeCloseTo(7)
    expect(result.movements.find((m) => m.targetId === 'first-fill')?.sourceId).toBe('left')
  })

  it('matches exhaustive assignment oracles on twelve distinct three-source cases', () => {
    const permutations = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ]
    for (let seed = 1; seed <= 12; seed++) {
      const sources = [seed % 4, 6 + (seed % 3), 15 + (seed % 5)]
      const fills = [3 + (seed % 7), 8 + (seed % 4), 11 + (seed % 9)]
      const oracle = Math.min(
        ...permutations.map((p) => fills.reduce((sum, c, i) => sum + Math.abs(c - sources[p[i]]), 0)),
      )
      const result = solveMaterialAllocation(
        design(),
        [...sources.map((s, i) => parcel(`s${i}`, s, 0, 1)), ...fills.map((s, i) => parcel(`d${i}`, s, 1))],
        (d) => d,
      )
      expect(result.status).toBe('optimal')
      expect(result.objectiveCost).toBeCloseTo(oracle, 6)
    }
  })

  it('opens one shared fixed-charge pit when two individually cheaper batches cost more together', () => {
    const e = design()
    e.sites = [site('open-once', 'borrow', 5, 0, 5), site('per-cube', 'borrow', 5, 3)]
    const result = solveMaterialAllocation(e, [parcel('a', 1, 1), parcel('b', 9, 1)], () => 0)
    expect(result.status).toBe('optimal')
    expect(result.objectiveCost).toBeCloseTo(5)
    expect(result.usedSiteIds).toEqual(['open-once'])
  })

  it('reserves scarce high-quality material for its range and rejects unknown borrow quality', () => {
    const e = design()
    e.fillRequirements = [
      { id: 'common', start: 5, end: 15, layer: 'subgrade', minQuality: 0, replaceable: true },
      { id: 'high', start: 15, end: 25, layer: 'subgrade', minQuality: 80, replaceable: true },
    ]
    const result = solveMaterialAllocation(
      e,
      [
        parcel('high-cut', 1, 0, 1),
        parcel('soil-cut', 2, 0, 1, 'soil'),
        parcel('low-fill', 10, 1),
        parcel('high-fill', 20, 1),
      ],
      () => 0,
    )
    expect(result.status).toBe('optimal')
    expect(result.movements.find((m) => m.targetId === 'high-fill')?.materialId).toBe('rock')
    const missing = design()
    missing.fillRequirements = [e.fillRequirements[1]]
    missing.sites = [site('unknown', 'borrow', 20, 0)]
    expect(solveMaterialAllocation(missing, [parcel('fill', 20, 1)], () => 0).status).toBe('infeasible')
    missing.sites[0].materialId = 'rock'
    expect(solveMaterialAllocation(missing, [parcel('fill', 20, 1)], () => 0).status).toBe('optimal')
  })

  it('retains bank/compacted conservation and finite waste capacity with a 0.5 conversion', () => {
    const e = design()
    e.sites = [site('spoil', 'waste', 5, 2, 7, 4)]
    const result = solveMaterialAllocation(e, [parcel('cut', 0, 0, 10, 'rock', 0.5), parcel('fill', 10, 3)], () => 0)
    expect(result.status).toBe('optimal')
    const used = result.movements.filter((m) => m.kind === 'cut-to-fill').reduce((s, m) => s + m.bankVolumeM3!, 0)
    const waste = result.movements.filter((m) => m.kind === 'waste').reduce((s, m) => s + m.bankVolumeM3!, 0)
    expect(used).toBeCloseTo(6)
    expect(waste).toBeCloseTo(4)
    expect(result.objectiveCost).toBeCloseTo(15)
    e.sites[0].capacityM3 = 3.9
    expect(
      solveMaterialAllocation(e, [parcel('cut', 0, 0, 10, 'rock', 0.5), parcel('fill', 10, 3)], () => 0).status,
    ).toBe('infeasible')
  })

  it('shares pit capacity between a required surface layer and subgrade demand', () => {
    const e = design()
    e.sites = [{ ...site('rock-pit', 'borrow', 5, 1, 0, 3), materialId: 'rock' }]
    const p = parcel('fill', 5, 2)
    p.demands = [{ layer: 'surfacing', volumeM3: 1, materialId: 'rock' }]
    const result = solveMaterialAllocation(e, [p], () => 0)
    expect(result.status).toBe('optimal')
    expect(result.movements.reduce((s, m) => s + m.compactedVolumeM3!, 0)).toBeCloseTo(3)
    expect(new Set(result.movements.map((m) => m.demandLayer))).toEqual(new Set(['subgrade', 'surfacing']))
    e.sites[0].capacityM3 = 2.9
    expect(solveMaterialAllocation(e, [p], () => 0).status).toBe('infeasible')
  })

  it('does not duplicate a component material demand already in subgrade fill', () => {
    const e = design()
    e.sites = [{ ...site('pit', 'borrow', 5, 1, 0, 2), materialId: 'rock' }]
    const p = parcel('fill', 5, 2)
    p.demands = [{ layer: 'rock-key', volumeM3: 0.5, materialId: 'rock', subgrade: true }]
    const result = solveMaterialAllocation(e, [p], () => 0)
    expect(result.status).toBe('optimal')
    expect(result.movements.reduce((s, m) => s + m.compactedVolumeM3!, 0)).toBeCloseTo(2)
  })

  it('enforces up/down-chain construction constraints and never transfers across a coverage gap', () => {
    const e = design()
    e.haul.directionRanges = [{ id: 'forward', start: 0, end: 20, direction: 'forward' }]
    const p = [parcel('cut', 15, 0, 1), parcel('fill', 5, 1)]
    expect(solveMaterialAllocation(e, p, () => 0).status).toBe('infeasible')
    e.haul.directionRanges = []
    p[1].run = 2
    expect(solveMaterialAllocation(e, p, () => 0).status).toBe('infeasible')
    expect(
      haulDirectionAllowed(
        { ...e.haul, directionRanges: [{ id: 'barrier', start: 4, end: 6, direction: 'blocked' }] },
        0,
        10,
      ),
    ).toBe(false)
  })

  it('limits sidecast per metre locally and prices the remaining bank waste separately', () => {
    const e = design()
    e.haul.sidecastRanges = [{ id: 'permitted', start: 0, end: 10, capacityBankM3PerM: 0.2, unitRate: 1 }]
    e.sites = [site('spoil', 'waste', 5, 10, 0, 1)]
    const result = solveMaterialAllocation(e, [parcel('cut', 5, 0, 3)], () => 0)
    expect(result.status).toBe('optimal')
    expect(
      result.movements.filter((m) => m.disposalMethod === 'sidecast').reduce((s, m) => s + m.bankVolumeM3!, 0),
    ).toBeCloseTo(2)
    expect(result.objectiveCost).toBeCloseTo(12)
    e.haul.sidecastRanges[0].materialIds = ['soil']
    expect(solveMaterialAllocation(e, [parcel('cut', 5, 0, 3)], () => 0).status).toBe('infeasible')
  })
})

describe('allocation policy inputs', () => {
  it('round-trips explicit policy fields and rejects ambiguous/invalid requirements', () => {
    const e = design()
    e.fillRequirements = [{ id: 'exact', start: 0, end: 10, layer: 'subgrade', materialId: 'rock', replaceable: false }]
    expect(parseAllocationPolicy(e).fillRequirements).toEqual(e.fillRequirements)
    expect(acceptsFill('soil', e.fillRequirements[0], e.materials)).toBe(false)
    e.fillRequirements.push({ ...e.fillRequirements[0], id: 'overlap', start: 5 })
    expect(() => validateAllocationPolicy(e)).toThrow(/overlap/)
    expect(() => parseAllocationPolicy({ ...e, haul: { ...e.haul, allocation: 'pretend' } })).toThrow(
      /nearest or economic/,
    )
  })
})
