import { describe, expect, it } from 'vitest'
import type { HaulMovement } from './engineeringTypes'
import { HAUL_DIAGRAM_MAX_LANES, haulDiagram, haulDirectionRuns, haulShading } from './haulDiagram'

const move = (
  over: Partial<HaulMovement> & Pick<HaulMovement, 'id' | 'fromChainage' | 'toChainage'>,
): HaulMovement => ({
  kind: 'cut-to-fill',
  sourceId: 's',
  targetId: 't',
  materialId: 'common',
  distanceM: Math.abs(over.toChainage - over.fromChainage),
  bankVolumeM3: null,
  compactedVolumeM3: over.transportedVolumeM3 ?? 100,
  transportedVolumeM3: 100,
  volumeBasis: 'compacted',
  category: 'freehaul',
  haulCost: 0,
  ...over,
})

describe('haulShading', () => {
  it('splits each stretch of the curve between the classes crossing it, in proportion to volume', () => {
    const movements = [
      move({ id: 'a', fromChainage: 0, toChainage: 200, transportedVolumeM3: 300, category: 'freehaul' }),
      move({ id: 'b', fromChainage: 0, toChainage: 400, transportedVolumeM3: 100, category: 'overhaul' }),
    ]
    const line: [number, number][] = [
      [0, 0],
      [100, 400],
      [300, 100],
      [400, 0],
    ]
    const segments = haulShading(line, movements)
    expect(segments).toHaveLength(3)
    // 0–100: both cross, 3:1.
    expect(segments[0].parts).toEqual([
      { category: 'freehaul', from: 0, to: 0.75 },
      { category: 'overhaul', from: 0.75, to: 1 },
    ])
    // 300–400: only the overhaul still crosses.
    expect(segments[2].parts).toEqual([{ category: 'overhaul', from: 0, to: 1 }])
  })

  it('splits at zero and reads down-station movements under the line', () => {
    const movements = [
      move({ id: 'up', fromChainage: 0, toChainage: 100, category: 'freehaul' }),
      move({ id: 'down', fromChainage: 200, toChainage: 100, category: 'endhaul' }),
    ]
    const segments = haulShading(
      [
        [0, 0],
        [50, 100],
        [150, -100],
        [200, 0],
      ],
      movements,
    )
    // 50–150 crosses zero at 100 and becomes two stretches.
    expect(segments.map((s) => [s.x0, s.x1])).toEqual([
      [0, 50],
      [50, 100],
      [100, 150],
      [150, 200],
    ])
    expect(segments[1].parts[0].category).toBe('freehaul')
    expect(segments[2].parts[0].category).toBe('endhaul')
  })

  it('gives a class only its own volume of a larger ordinate, the rest unassigned', () => {
    const segments = haulShading(
      [
        [0, 1000],
        [100, 1000],
      ],
      [move({ id: 'a', fromChainage: 0, toChainage: 200, transportedVolumeM3: 250, category: 'overhaul' })],
    )
    expect(segments[0].parts).toEqual([
      { category: 'overhaul', from: 0, to: 0.25 },
      { category: 'unassigned', from: 0.25, to: 1 },
    ])
  })

  it('marks a stretch no movement crosses as unassigned, and ignores sidecast', () => {
    const segments = haulShading(
      [
        [0, 0],
        [100, 50],
      ],
      [move({ id: 'side', fromChainage: 40, toChainage: 60, kind: 'waste', disposalMethod: 'sidecast' })],
    )
    expect(segments[0].parts).toEqual([{ category: 'unassigned', from: 0, to: 1 }])
  })
})

describe('haulDirectionRuns', () => {
  it('finds each run on one side of zero, its direction and its peak', () => {
    const runs = haulDirectionRuns([
      [0, 0],
      [100, 300],
      [200, -100],
      [300, -400],
      [400, 0],
    ])
    expect(runs).toHaveLength(2)
    expect(runs[0]).toMatchObject({ start: 0, end: 175, sign: 1, peakChainage: 100, peakM3: 300 })
    expect(runs[1]).toMatchObject({ start: 175, end: 400, sign: -1, peakChainage: 300, peakM3: -400 })
  })

  it('leaves out runs under the minimum peak', () => {
    expect(
      haulDirectionRuns(
        [
          [0, 0],
          [10, 2],
          [20, 0],
        ],
        5,
      ),
    ).toEqual([])
  })
})

describe('haulDiagram', () => {
  it('rows by haul class, packs lanes without overlap and weights by volume', () => {
    const diagram = haulDiagram([
      move({ id: 'a', fromChainage: 0, toChainage: 100, transportedVolumeM3: 400 }),
      move({ id: 'b', fromChainage: 50, toChainage: 150, transportedVolumeM3: 200 }),
      move({ id: 'c', fromChainage: 120, toChainage: 300, transportedVolumeM3: 100 }),
      move({ id: 'd', fromChainage: 500, toChainage: 0, transportedVolumeM3: 100, category: 'endhaul' }),
    ])
    expect(diagram.rows.map((r) => r.key)).toEqual(['freehaul', 'endhaul'])
    const free = diagram.rows[0]
    expect(free.lanes).toBe(2)
    expect(free.bands.map((b) => [b.movement.id, b.lane])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 0],
    ])
    expect(free.bands[0].weight).toBe(1)
    expect(free.bands[2].weight).toBe(0.25)
    expect(diagram.rows[1].bands[0].direction).toBe(-1)
    expect(free.compactedM3).toBe(700)
  })

  it('names borrow and waste sites as pits and keeps sidecast in its own row', () => {
    const diagram = haulDiagram(
      [
        move({ id: 'b', kind: 'borrow', sourceId: 'pit1', fromChainage: 300, toChainage: 100 }),
        move({ id: 'w', kind: 'waste', targetId: 'dump', fromChainage: 50, toChainage: 400, volumeBasis: 'bank' }),
        move({
          id: 's',
          kind: 'waste',
          fromChainage: 220,
          toChainage: 220,
          disposalMethod: 'sidecast',
          volumeBasis: 'bank',
        }),
      ],
      { minLengthM: 10 },
    )
    expect(diagram.pits).toEqual([
      { siteId: 'pit1', kind: 'borrow', chainage: 300 },
      { siteId: 'dump', kind: 'waste', chainage: 400 },
    ])
    const sidecast = diagram.rows.find((r) => r.key === 'sidecast')!
    expect(sidecast.bands[0]).toMatchObject({ start: 215, end: 225 })
    expect(sidecast.bankM3).toBe(100)
  })

  it('filters by material and lists the materials present', () => {
    const movements = [
      move({ id: 'a', fromChainage: 0, toChainage: 100, materialId: 'rock' }),
      move({ id: 'b', fromChainage: 0, toChainage: 100, materialId: null }),
    ]
    expect(haulDiagram(movements).materials).toEqual(['rock', null])
    expect(haulDiagram(movements, { materialId: 'rock' }).rows[0].bands.map((b) => b.movement.id)).toEqual(['a'])
    expect(haulDiagram(movements, { materialId: null }).rows[0].bands.map((b) => b.movement.id)).toEqual(['b'])
  })

  it('folds movements past the lane limit into the last lane and counts them', () => {
    const movements = Array.from({ length: HAUL_DIAGRAM_MAX_LANES + 2 }, (_, i) =>
      move({ id: `m${i}`, fromChainage: 0, toChainage: 100 + i }),
    )
    const diagram = haulDiagram(movements)
    expect(diagram.rows[0].lanes).toBe(HAUL_DIAGRAM_MAX_LANES)
    expect(diagram.folded).toBe(2)
  })
})
