import { describe, expect, it } from 'vitest'
import { analyzeRoad, offsetCoordinate } from './engine'
import { createEngineeringDesign, type HaulSite } from './engineeringTypes'
import { massHaulDiagram, ordinateAt, spanLengthWithin, unknownEarthworkSpans } from './massHaul'
import type { Alignment, Coordinate, RoadSettings, TerrainSource } from './types'

const origin: Coordinate = [-122.8, 53.9]
const north = (m: number) => offsetCoordinate(origin, 0, m)
const northing = (p: Coordinate) => (((p[1] - origin[1]) * Math.PI) / 180) * 6371008.8
const flat: TerrainSource = { elevationAt: () => 800 }
const settings: RoadSettings = {
  stationInterval: 10,
  crossSectionHalfWidth: 30,
  maxGradePercent: 12,
  minRadius: 25,
  cutRate: 2,
  fillRate: 3,
  surfacingRate: 4,
  clearingRate: 0.5,
  shrinkFactor: 0.9,
}
/** A 200 m road in fill at its start and in cut at its end, on level ground. */
function road(startElevation: number, endElevation: number): Alignment {
  return {
    id: 'road',
    name: 'Road',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: north(200), radiusM: 0 },
    ],
    vertical: [
      { id: 's', chainage: 0, elevation: startElevation, curveLength: 0 },
      { id: 'e', chainage: 200, elevation: endElevation, curveLength: 0 },
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
}
const site = (id: string, kind: HaulSite['kind'], chainage: number, capacityM3: number | null = null): HaulSite => ({
  id,
  name: id,
  kind,
  chainage,
  accessDistanceM: 140,
  capacityM3,
  unitRate: 0,
  fixedCost: 0,
})
const hole: TerrainSource = {
  elevationAt: (lng, lat) => {
    const s = northing([lng, lat])
    return (s > 95 && s < 105) || (s > 155 && s < 165) ? NaN : 800
  },
}

describe('unknown earthwork on the mass-haul diagram', () => {
  it('joins touching unknown intervals and measures them inside a range', () => {
    const r = analyzeRoad(road(801, 798.9), hole, settings)
    const spans = unknownEarthworkSpans(r.stations)
    expect(spans).toEqual([
      { start: 90, end: 110 },
      { start: 150, end: 170 },
    ])
    expect(spanLengthWithin(spans, 0, 200)).toBeCloseTo(r.length - r.completeLength, 6)
    expect(spanLengthWithin(spans, 0, 100)).toBe(10)
    expect(spanLengthWithin(spans, 110, 150)).toBe(0)
  })

  it('draws the balance through the unknown lengths and ends on the covered balance', () => {
    const r = analyzeRoad(road(801, 798.9), hole, settings)
    const d = massHaulDiagram(r)
    expect(d.balance).toHaveLength(r.stations.length)
    expect(d.unknownLengthM).toBe(40)
    expect(d.endBalanceM3).toBeCloseTo(r.cutVolumeM3 * 0.9 - r.fillVolumeM3, 6)
    const at = (chainage: number) => d.balance.find((p) => p[0] === chainage)![1]
    expect(at(110)).toBe(at(90))
    expect(at(170)).toBe(at(150))
    expect(d.haul).toBeNull()
  })
})

describe('pits and haul classes on the mass-haul diagram', () => {
  it('steps up at the borrow pit and closes on zero', () => {
    const a = road(802, 801)
    a.engineering!.haul.enabled = true
    a.engineering!.sites = [site('pit', 'borrow', 85)]
    const r = analyzeRoad(a, flat, settings)
    const d = massHaulDiagram(r, a.engineering)
    expect(d.endBalanceM3).toBeCloseTo(-r.fillVolumeM3, 6)
    expect(d.haul!.pits).toEqual([
      expect.objectContaining({ siteId: 'pit', name: 'pit', kind: 'borrow', chainage: 85, volumeBasis: 'compacted' }),
    ])
    expect(d.haul!.pits[0].volumeM3).toBeCloseTo(r.fillVolumeM3, 6)
    expect(d.haul!.pits[0].stepM3).toBeCloseTo(r.fillVolumeM3, 6)
    // One vertical step, at the pit's station, as high as the pit's volume.
    const at85 = d.haul!.afterSites.filter((p) => p[0] === 85)
    expect(at85).toHaveLength(2)
    expect(at85[1][1] - at85[0][1]).toBeCloseTo(r.fillVolumeM3, 6)
    expect(d.haul!.afterSites.filter((p, i, all) => i > 0 && all[i - 1][0] === p[0])).toHaveLength(1)
    expect(d.haul!.closingM3).toBeCloseTo(0, 6)
    // Read at any station: straight between calculation stations, and on either side of the step.
    expect(ordinateAt(d.haul!.afterSites, 85, 'before')).toBe(at85[0][1])
    expect(ordinateAt(d.haul!.afterSites, 85)).toBe(at85[1][1])
    // The pit made 85 a calculation station, so 81 lies a fifth of the way from 80 to 85.
    const [b80, b85] = [80, 85].map((x) => d.balance.find((p) => p[0] === x)![1])
    expect(ordinateAt(d.balance, 81)).toBeCloseTo(b80 + (b85 - b80) * 0.2, 9)
    expect(ordinateAt(d.balance, -5)).toBe(0)
    expect(ordinateAt(d.balance, 999)).toBe(d.endBalanceM3)
    expect(ordinateAt([], 10)).toBeNull()
  })

  it('steps down by the reusable cut a waste site removes, reported in bank m³', () => {
    const a = road(798, 799)
    a.engineering!.haul.enabled = true
    a.engineering!.sites = [site('spoil', 'waste', 84)]
    const r = analyzeRoad(a, flat, settings)
    const d = massHaulDiagram(r, a.engineering)
    const pit = d.haul!.pits[0]
    expect(pit.volumeBasis).toBe('bank')
    expect(pit.volumeM3).toBeCloseTo(r.cutVolumeM3, 6)
    expect(pit.stepM3).toBeCloseTo(-r.cutVolumeM3 * 0.9, 6)
    expect(d.endBalanceM3).toBeCloseTo(r.cutVolumeM3 * 0.9, 6)
    expect(d.haul!.closingM3).toBeCloseTo(0, 6)
  })

  it('draws no line after sites for a plan that was not solved', () => {
    const a = road(802, 798)
    Object.assign(a.engineering!.haul, { enabled: true, allocation: 'economic' })
    // Thirteen priced sites are one over what the economic model opens.
    a.engineering!.sites = Array.from({ length: 13 }, (_, i) => ({
      ...site(`s${i}`, i % 2 ? 'borrow' : 'waste', 5 + i * 7),
      fixedCost: 100,
    }))
    const r = analyzeRoad(a, flat, settings)
    expect(r.engineering!.haul.optimizationStatus).toBe('unsolved')
    const d = massHaulDiagram(r, a.engineering)
    expect(d.haul).toBeNull()
    expect(d.endBalanceM3).not.toBeNull()
  })

  it('leaves the line open by what no site could take', () => {
    const a = road(802, 801)
    a.engineering!.haul.enabled = true
    a.engineering!.sites = [site('pit', 'borrow', 85, 100)]
    const r = analyzeRoad(a, flat, settings)
    const d = massHaulDiagram(r, a.engineering)
    expect(r.engineering!.haul.unallocatedBorrowM3).toBeCloseTo(r.fillVolumeM3 - 100, 6)
    expect(d.haul!.closingM3).toBeCloseTo(-(r.fillVolumeM3 - 100), 6)
  })

  it('closes a road hauled across unknown ground with one pit, never a borrow and a waste together', () => {
    const a = road(801, 798.9)
    a.engineering!.haul.enabled = true
    a.engineering!.sites = [site('pit', 'borrow', 20), site('spoil', 'waste', 30)]
    const r = analyzeRoad(a, hole, settings)
    const d = massHaulDiagram(r, a.engineering)
    // Less cut is known with the second hole, so this road is short of fill: the pit makes it up.
    expect(d.endBalanceM3).toBeLessThan(0)
    expect(d.haul!.pits.map((p) => p.siteId)).toEqual(['pit'])
    expect(d.haul!.pits[0].stepM3).toBeCloseTo(-d.endBalanceM3!, 6)
    expect(d.haul!.closingM3).toBeCloseTo(0, 6)
  })

  it('reports each haul class with its distance range, volumes and the road it works over', () => {
    const a = road(801, 798.9)
    Object.assign(a.engineering!.haul, { enabled: true, freeHaulDistanceM: 24, overhaulDistanceM: 150 })
    a.engineering!.sites = [site('spoil', 'waste', 30)]
    const r = analyzeRoad(a, flat, settings),
      h = r.engineering!.haul
    const [free, over, end] = massHaulDiagram(r, a.engineering).haul!.classes
    expect([free.fromM, free.toM, over.fromM, over.toM, end.fromM, end.toM]).toEqual([0, 24, 24, 150, 150, null])
    expect(free.compactedM3).toBeCloseTo(h.freeHaulM3, 6)
    expect(over.compactedM3).toBeCloseTo(h.overhaulM3, 6)
    expect(end.compactedM3).toBeCloseTo(h.endHaulM3, 6)
    expect(free.bankM3 + over.bankM3 + end.bankM3).toBeCloseTo(h.wasteBankM3, 6)
    expect(over.compactedM3 + end.compactedM3).toBeGreaterThan(0)
    // Every span of a class is covered by a movement of that class, and none is longer than the road.
    for (const band of [free, over, end])
      for (const span of band.spans) {
        expect(span.end).toBeGreaterThan(span.start)
        expect(span.start).toBeGreaterThanOrEqual(0)
        expect(span.end).toBeLessThanOrEqual(200)
        expect(
          r.engineering!.movements.some(
            (m) =>
              m.category === band.category &&
              Math.min(m.fromChainage, m.toChainage) <= span.start + 1e-6 &&
              Math.max(m.fromChainage, m.toChainage) >= span.start - 1e-6,
          ),
        ).toBe(true)
      }
    // Free haul moves at most 24 m at a time, so no single movement makes a longer span on its own.
    expect(end.spans.some((s) => s.end - s.start > 150 - 140)).toBe(true)
  })
})
