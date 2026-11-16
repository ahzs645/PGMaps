import { describe, expect, it } from 'vitest'
import { haulUnitCost } from './engineering'
import { createEngineeringDesign, type AlignmentEngineering, type HaulSite } from './engineeringTypes'
import { lastResortSites, LAST_RESORT_OVERFLOW_ID } from './lastResortPits'
import { solveDenseMaterialAllocation, solveMaterialAllocation, type AllocationParcel } from './materialAllocation'
import { networkAllocationApplies, solveNetworkMaterialAllocation } from './networkMaterialAllocation'
import { solveSparseMaterialAllocation } from './sparseMaterialAllocation'

const MATERIALS = [
  { id: 'rock', factor: 1.25, quality: 100 },
  { id: 'gravel', factor: 1.1, quality: 67 },
  { id: 'soil', factor: 0.9, quality: 0 },
]

function design(): AlignmentEngineering {
  const e = createEngineeringDesign()
  e.haul = {
    ...e.haul,
    enabled: true,
    allocation: 'economic',
    // RoadEng's default classes (`roadEngHaul.ts`): loading + hauling × distance, cheapest wins.
    freeHaulDistanceM: 150,
    overhaulDistanceM: 1000,
    freeHaulRate: 8,
    overhaulRate: 4,
    endHaulRate: 2,
    overhaulLoadingRate: 1.2,
    endHaulLoadingRate: 2.9,
  }
  e.materials = MATERIALS.map((m) => ({
    id: m.id,
    name: m.id,
    color: '#888888',
    cutRate: 10,
    reusableFraction: 1,
    compactionFactor: m.factor,
    quality: m.quality,
  }))
  return e
}
const site = (id: string, kind: HaulSite['kind'], chainage: number, extra: Partial<HaulSite> = {}): HaulSite => ({
  id,
  name: id,
  kind,
  chainage,
  accessDistanceM: 0,
  capacityM3: null,
  unitRate: 0,
  fixedCost: 0,
  ...extra,
})

/** A random road of `n` 20 m intervals: each cuts one or two materials and fills, some of it unusable. */
function randomRoad(seed: number, n: number) {
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  const parcels: AllocationParcel[] = Array.from({ length: n }, (_, i) => {
    const cut: AllocationParcel['cut'] = []
    for (const m of MATERIALS)
      if (random() < 0.45) {
        const bank = random() * 300
        const unusable = random() < 0.2 ? bank * random() * 0.5 : 0
        cut.push({ materialId: m.id, bank, usable: (bank - unusable) * m.factor, unusable, factor: m.factor })
      }
    return {
      id: `p${i}`,
      start: i * 20,
      end: i * 20 + 20,
      chainage: i * 20 + 10,
      fill: random() < 0.6 ? random() * 350 : 0,
      cut,
    }
  })
  return { parcels, random }
}

const unit = (e: AlignmentEngineering) => (d: number) => haulUnitCost(e.haul, d)

describe('the economic material plan as a network flow', () => {
  it('finds the tableau optimum on random roads with every rule', () => {
    let solved = 0,
      infeasible = 0
    for (let seed = 1; seed <= 40; seed++) {
      const { parcels, random } = randomRoad(seed, 10 + (seed % 14))
      const e = design()
      const length = parcels.length * 20
      e.sites = [
        site('pit', 'borrow', random() * length, { materialId: 'rock', unitRate: 6, accessDistanceM: 300 }),
        site('dump', 'waste', random() * length, { accessDistanceM: 100, unitRate: 0.5 }),
        ...(seed % 3 === 0 ? [site('spoil', 'waste', length, { fixedCost: 800 })] : []),
        ...(seed % 4 === 0 ? [site('any', 'borrow', 0, { unitRate: 25, fixedCost: 1500, capacityM3: 400 })] : []),
      ]
      if (seed % 2 === 0)
        e.fillRequirements = [
          { id: 'q', start: 0, end: length / 2, layer: 'subgrade', minQuality: 60, replaceable: true },
          { id: 'x', start: length / 2, end: length, layer: 'subgrade', materialId: 'soil', replaceable: false },
        ]
      if (seed % 5 === 0)
        e.haul.directionRanges = [{ id: 'd', start: length * 0.3, end: length * 0.6, direction: 'forward' }]
      if (seed % 7 === 0)
        e.haul.sidecastRanges = [
          { id: 's', start: 0, end: length, capacityBankM3PerM: 5, unitRate: 0.2, materialIds: ['gravel'] },
        ]
      const network = solveNetworkMaterialAllocation(e, parcels, unit(e))
      expect(network, `seed ${seed}: ${networkAllocationApplies(e, parcels)}`).not.toBeNull()
      const tableau = solveDenseMaterialAllocation(e, parcels, unit(e))
      expect(network!.status, `seed ${seed}`).toBe(tableau.status)
      if (tableau.status === 'optimal') {
        solved++
        expect(network!.objectiveCost!, `seed ${seed}`).toBeCloseTo(tableau.objectiveCost!, 3)
      } else infeasible++
    }
    expect(solved).toBeGreaterThan(20)
    expect(infeasible).toBeGreaterThan(0)
  })

  it('conserves every source, fill and capacity in the movements it returns', () => {
    const { parcels } = randomRoad(99, 30)
    const e = design()
    e.sites = [site('pit', 'borrow', 0, { unitRate: 3 }), site('dump', 'waste', 600, { unitRate: 1, capacityM3: 1e9 })]
    const result = solveNetworkMaterialAllocation(e, parcels, unit(e))!
    expect(result.status).toBe('optimal')
    expect(result.method).toBe('network')
    for (const p of parcels) {
      const out = result.movements.filter((m) => m.sourceId === p.id).reduce((sum, m) => sum + (m.bankVolumeM3 ?? 0), 0)
      expect(out).toBeCloseTo(
        p.cut.reduce((sum, m) => sum + m.bank, 0),
        6,
      )
      const into = result.movements.filter((m) => m.targetId === p.id).reduce((sum, m) => sum + m.compactedVolumeM3!, 0)
      expect(into).toBeCloseTo(p.fill, 6)
    }
  })

  it('solves a road of 3,000 stations that is past every tableau limit', () => {
    const { parcels } = randomRoad(5, 3000)
    const e = design()
    e.sites = [
      site('pit-a', 'borrow', 9000, { materialId: 'rock', unitRate: 36, accessDistanceM: 7000 }),
      site('pit-b', 'borrow', 45000, { materialId: 'rock', unitRate: 36, accessDistanceM: 7000 }),
      site('dump-a', 'waste', 20000, { accessDistanceM: 7000 }),
      site('dump-b', 'waste', 50000, { accessDistanceM: 7000 }),
    ]
    // The chain model takes only a linear haul curve; this one has three classes.
    expect(solveSparseMaterialAllocation(e, parcels, unit(e))).toBeNull()
    expect(() => solveDenseMaterialAllocation(e, parcels, unit(e))).toThrow(/browser budget|variables/)
    const started = performance.now()
    const result = solveMaterialAllocation(e, parcels, unit(e))
    const seconds = (performance.now() - started) / 1000
    expect(result.status).toBe('optimal')
    expect(result.method).toBe('network')
    expect(seconds).toBeLessThan(30)
    // Every movement is priced at the haul curve, and the cost adds up to it.
    const priced = result.movements.reduce(
      (sum, m) => sum + m.transportedVolumeM3 * (haulUnitCost(e.haul, m.distanceM) + m.supplyCost + m.disposalCost),
      0,
    )
    expect(priced).toBeCloseTo(result.objectiveCost!, 0)
  })

  it('leaves a capacity shared by material of different swell to the tableau, and says why', () => {
    const e = design()
    const parcels: AllocationParcel[] = [
      {
        id: 'a',
        start: 0,
        end: 10,
        chainage: 5,
        fill: 0,
        cut: [
          { materialId: 'rock', bank: 10, usable: 12.5, unusable: 0, factor: 1.25 },
          { materialId: 'soil', bank: 10, usable: 9, unusable: 0, factor: 0.9 },
        ],
      },
    ]
    e.sites = [site('small', 'waste', 50, { capacityM3: 15 }), site('big', 'waste', 900)]
    expect(networkAllocationApplies(e, parcels)).toMatch(/waste site small can fill up/)
    expect(solveNetworkMaterialAllocation(e, parcels, unit(e))).toBeNull()
    const result = solveMaterialAllocation(e, parcels, unit(e))
    expect(result.method).toBeUndefined()
    expect(result.status).toBe('optimal')
    // Not binding: the same site with room for everything is a network again.
    e.sites[0].capacityM3 = 25
    expect(networkAllocationApplies(e, parcels)).toBeNull()
  })

  it('keeps material on the road when every plan costs the same', () => {
    const e = design()
    Object.assign(e.haul, {
      freeHaulRate: 0,
      overhaulRate: 0,
      endHaulRate: 0,
      overhaulLoadingRate: 0,
      endHaulLoadingRate: 0,
    })
    e.sites = [site('pit', 'borrow', 0), site('dump', 'waste', 0)]
    const parcels: AllocationParcel[] = [
      {
        id: 'cut',
        start: 0,
        end: 20,
        chainage: 10,
        fill: 0,
        cut: [{ materialId: 'soil', bank: 100, usable: 90, unusable: 0, factor: 0.9 }],
      },
      { id: 'fill', start: 400, end: 420, chainage: 410, fill: 50, cut: [] },
    ]
    const result = solveNetworkMaterialAllocation(e, parcels, unit(e))!
    expect(result.objectiveCost).toBe(0)
    expect(result.movements.filter((m) => m.kind === 'borrow')).toEqual([])
    expect(result.movements.find((m) => m.kind === 'cut-to-fill')!.compactedVolumeM3).toBeCloseTo(50, 9)
  })
})

describe("RoadEng's pit of last resort", () => {
  const surplus: AllocationParcel[] = [
    {
      id: 'cut',
      start: 500,
      end: 520,
      chainage: 510,
      fill: 0,
      cut: [{ materialId: 'soil', bank: 100, usable: 90, unusable: 0, factor: 0.9 }],
    },
    { id: 'fill', start: 600, end: 620, chainage: 610, fill: 30, cut: [] },
  ]

  it('balances a road no site can, at the road start', () => {
    const e = design()
    expect(solveNetworkMaterialAllocation(e, surplus, unit(e))!.status).toBe('infeasible')
    e.haul.lastResort = true
    const result = solveNetworkMaterialAllocation(
      { ...e, sites: [...e.sites, ...lastResortSites(e)] },
      surplus,
      unit(e),
    )!
    expect(result.status).toBe('optimal')
    const overflow = result.movements.filter((m) => m.targetId === LAST_RESORT_OVERFLOW_ID)
    expect(overflow.reduce((sum, m) => sum + m.bankVolumeM3!, 0)).toBeCloseTo(100 - 30 / 0.9, 6)
    expect(overflow.every((m) => m.toChainage === 0 && m.distanceM === 510)).toBe(true)
    // The penalty that keeps it last never reaches the reported cost.
    const priced = result.movements.reduce(
      (sum, m) => sum + m.transportedVolumeM3 * (haulUnitCost(e.haul, m.distanceM) + m.supplyCost + m.disposalCost),
      0,
    )
    expect(result.objectiveCost).toBeCloseTo(priced, 6)
  })

  it('is used only when nothing else can serve, even when it would cost less', () => {
    const e = design()
    e.haul.lastResort = true
    // A real waste site far away at a disposal charge: dearer than the free overflow 510 m off.
    e.sites = [site('far', 'waste', 5000, { unitRate: 20, accessDistanceM: 3000 })]
    const result = solveNetworkMaterialAllocation(
      { ...e, sites: [...e.sites, ...lastResortSites(e)] },
      surplus,
      unit(e),
    )!
    expect(result.status).toBe('optimal')
    expect(result.usedSiteIds).toEqual(['far'])
    // Underflow too: fill no cut can give comes from the pit only when the cut is used up.
    const short: AllocationParcel[] = [{ ...surplus[1], fill: 200 }, surplus[0]]
    const under = solveNetworkMaterialAllocation({ ...e, sites: [...e.sites, ...lastResortSites(e)] }, short, unit(e))!
    const borrowed = under.movements.filter((m) => m.kind === 'borrow')
    expect(borrowed.reduce((sum, m) => sum + m.compactedVolumeM3!, 0)).toBeCloseTo(200 - 90, 6)
    expect(borrowed.every((m) => m.sourceId.startsWith('last-resort-underflow-'))).toBe(true)
  })

  it('makes no sites while the setting is off, and one underflow per earthwork material when on', () => {
    const e = design()
    expect(lastResortSites(e)).toEqual([])
    e.haul.lastResort = true
    e.materials.push({
      id: 'strip',
      name: 'Strip',
      color: '#000000',
      cutRate: 1,
      reusableFraction: 0,
      compactionFactor: 1,
      purpose: 'stripping',
    })
    const sites = lastResortSites(e)
    expect(sites.map((s) => s.id)).toEqual([
      LAST_RESORT_OVERFLOW_ID,
      'last-resort-underflow-rock',
      'last-resort-underflow-gravel',
      'last-resort-underflow-soil',
    ])
    // Underflow is priced at the material's excavation rate per compacted m³ (RoadEng: from the ground type table).
    expect(sites.find((s) => s.materialId === 'rock')!.unitRate).toBeCloseTo(10 / 1.25, 12)
    expect(sites.every((s) => s.lastResort && s.chainage === 0 && s.capacityM3 === null)).toBe(true)
    expect(lastResortSites({ haul: e.haul, materials: [] }).map((s) => s.unitRate)).toEqual([0, e.haul.borrowRate])
  })
})
