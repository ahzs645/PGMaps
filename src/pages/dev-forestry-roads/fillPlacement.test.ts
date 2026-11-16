import { describe, expect, it } from 'vitest'
import type { GroundMaterial, HaulMovement } from './engineeringTypes'
import { fillPlacementCost } from './fillPlacement'

const material = (id: string, compactionFactor: number, fillRate?: number): GroundMaterial => ({
  id,
  name: id.toUpperCase(),
  color: '#888888',
  cutRate: 4,
  reusableFraction: 1,
  compactionFactor,
  ...(fillRate === undefined ? {} : { fillRate }),
})
const move = (input: Partial<HaulMovement> & Pick<HaulMovement, 'kind' | 'targetId'>): HaulMovement => ({
  id: 'm',
  sourceId: 'p0',
  materialId: null,
  fromChainage: 0,
  toChainage: 0,
  distanceM: 0,
  bankVolumeM3: null,
  compactedVolumeM3: null,
  transportedVolumeM3: 0,
  volumeBasis: 'compacted',
  category: 'freehaul',
  haulCost: 0,
  ...input,
})

describe('fill placement priced by the material it is made of', () => {
  it('keeps the project fill rate for every fill when no material has its own', () => {
    const result = fillPlacementCost({
      intervals: [{ id: 'p1', chainage: 10, fill: 100 }],
      fillVolumeM3: 100,
      movements: [],
      materials: [material('gr', 1.1)],
      sites: [],
      fillRate: 8,
    })
    expect(result.cost).toBe(800)
    expect(result.lines).toEqual([{ materialId: null, compactedM3: 100, bankM3: null, rate: 8, amount: 800 }])
  })

  it("prices cut and borrow per bank m³ of the material placed, as RoadEng's embankment cost", () => {
    // Hart Rd's ground types: gravel places at 2 and rock at 1.8 per bank m³.
    const gr = material('gr', 1 / 0.9, 2),
      sr = material('sr', 1.25, 1.8)
    const result = fillPlacementCost({
      intervals: [
        { id: 'p1', chainage: 10, fill: 111.1 },
        { id: 'p2', chainage: 30, fill: 50 },
      ],
      fillVolumeM3: 161.1,
      movements: [
        // 100 bank m³ of gravel cut makes 111.1 compacted m³ of fill.
        move({
          kind: 'cut-to-fill',
          targetId: 'p1',
          materialId: 'gr',
          bankVolumeM3: 99.99,
          compactedVolumeM3: 111.1,
          transportedVolumeM3: 111.1,
          demandKey: 'subgrade',
        }),
        // 50 compacted m³ of rock from a pit (40 bank m³).
        move({ kind: 'borrow', sourceId: 'pit', targetId: 'p2', compactedVolumeM3: 50, transportedVolumeM3: 50 }),
        // A surface course is not fill here.
        move({
          kind: 'cut-to-fill',
          targetId: 'p2',
          materialId: 'gr',
          bankVolumeM3: 9,
          compactedVolumeM3: 10,
          transportedVolumeM3: 10,
          demandKey: '["surface","course","gr"]',
        }),
      ],
      materials: [gr, sr],
      sites: [
        {
          id: 'pit',
          name: 'Pit',
          kind: 'borrow',
          chainage: 0,
          accessDistanceM: 0,
          capacityM3: null,
          unitRate: 6,
          fixedCost: 0,
          materialId: 'sr',
        },
      ],
      fillRate: 8,
    })
    expect(result.lines.map((l) => [l.materialId, l.bankM3, l.amount])).toEqual([
      ['gr', 99.99, 99.99 * 2],
      ['sr', 40, 40 * 1.8],
    ])
    expect(result.cost).toBeCloseTo(99.99 * 2 + 72, 9)
  })

  it('prices fill no movement accounts for by its required material, else at the project rate', () => {
    const result = fillPlacementCost({
      intervals: [
        { id: 'p1', chainage: 10, fill: 30 },
        { id: 'p2', chainage: 600, fill: 20 },
      ],
      fillVolumeM3: 50,
      movements: [],
      materials: [material('co', 0.8, 4)],
      sites: [],
      fillRequirements: [{ id: 'r', start: 0, end: 100, layer: 'subgrade', materialId: 'co', replaceable: true }],
      fillRate: 5,
    })
    expect(result.lines).toEqual([
      { materialId: 'co', compactedM3: 30, bankM3: 37.5, rate: 4, amount: 150 },
      { materialId: null, compactedM3: 20, bankM3: null, rate: 5, amount: 100 },
    ])
    expect(result.cost).toBe(250)
  })
})
