import { describe, expect, it } from 'vitest'
import { analyzeRoad, offsetCoordinate } from './engine'
import { createEngineeringDesign } from './engineeringTypes'
import { BENCH_MARGIN_M, BENCH_TAPER_GRADE, fullBenchProfile, PROFILE_TOLERANCE_M } from './fullBench'
import { incompleteStretches } from './sectionFixes'
import type { Alignment, Coordinate, RoadSettings } from './types'

const origin: Coordinate = [-121.55, 54.07]
const settings: RoadSettings = {
  stationInterval: 10,
  crossSectionHalfWidth: 35,
  maxGradePercent: 12,
  minRadius: 25,
  cutRate: 12,
  fillRate: 8,
  surfacingRate: 40,
  clearingRate: 1.5,
  shrinkFactor: 0.9,
}
const metresPerDegree = 111_320 * Math.cos((origin[1] * Math.PI) / 180)
/** Gentle (30 %) everywhere but a 69 % sidehill falling to the road's right between 100 and 200 m. */
const terrain = {
  elevationAt: (lon: number, lat: number) => {
    const north = (lat - origin[1]) * 110_540
    const fall = north >= 95 && north <= 205 ? 0.69 : 0.3
    return 900 + 0.05 * north - fall * (lon - origin[0]) * metresPerDegree
  },
}
function road(vertical: Alignment['vertical'] = []): Alignment {
  return {
    id: 'road',
    name: 'Sidehill',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: offsetCoordinate(origin, 0, 300), radiusM: 0 },
    ],
    vertical,
    template: {
      leftWidth: 3,
      rightWidth: 3,
      crossfallPercent: 3,
      cutSlope: 0.75,
      fillSlope: 1.5,
      ditchWidth: 1,
      ditchDepth: 0.5,
      surfaceDepth: 0.25,
    },
    overrides: [],
    engineering: createEngineeringDesign(),
  }
}
let n = 0
const newId = () => `pvi-${++n}`

describe('a full bench over steep fill stretches', () => {
  it('cuts the road into the hill there and leaves the rest where it was', () => {
    const before = analyzeRoad(road(), terrain, settings)
    const stretches = incompleteStretches(before.stations, road())
    expect(stretches.map((s) => [s.side, s.batter])).toEqual([['right', 'fill']])
    const plan = fullBenchProfile(road(), before.stations, stretches, newId)
    if ('error' in plan) throw Error(plan.error)
    expect(plan.createdProfile).toBe(true)
    // The ditch's outer top, 3 + 1 m out on 69 % ground, stands 2.76 m above it; less the 3 % crossfall
    // over the 3 m lane, plus the 0.1 m margin.
    expect(plan.maxLoweringM).toBeCloseTo(4 * 0.69 - 0.09 + 0.1, 1)

    const after = analyzeRoad(road(plan.vertical), terrain, settings)
    expect(after.stations.filter((s) => !s.complete)).toEqual([])
    const at = (chainage: number, analysis = after) =>
      analysis.stations.find((s) => Math.abs(s.chainage - chainage) < 1e-6)!
    // In the bench the downhill edge is at least the margin below the ground: no fill there.
    for (const chainage of [110, 150, 190]) expect(at(chainage).fillAreaM2).toBeCloseTo(0, 6)
    // Far from it the formation is where the ground-following road had it.
    for (const chainage of [0, 20, 280, 300])
      expect(at(chainage).designElevation).toBeCloseTo(at(chainage, before).designElevation!, 6)
  })

  it('eases into the bench at no more than the taper grade', () => {
    const before = analyzeRoad(road(), terrain, settings)
    const plan = fullBenchProfile(road(), before.stations, incompleteStretches(before.stations, road()), newId)
    if ('error' in plan) throw Error(plan.error)
    const levels = new Map(before.stations.map((s) => [s.chainage, s.designElevation!]))
    const lowering = plan.vertical.map((p) => ({ s: p.chainage, d: levels.get(p.chainage)! - p.elevation }))
    for (let i = 1; i < lowering.length; i++) {
      const change = Math.abs(lowering[i].d - lowering[i - 1].d) / (lowering[i].s - lowering[i - 1].s)
      expect(change).toBeLessThanOrEqual(BENCH_TAPER_GRADE + 1e-9)
    }
    expect(BENCH_MARGIN_M).toBe(0.1)
  })

  it('draws the bench with the PVIs it needs, not one per station', () => {
    // Uneven ground along the road, as 22 m terrain reads it: gentle waves on the same sidehill.
    const wavy = {
      elevationAt: (lon: number, lat: number) =>
        terrain.elevationAt(lon, lat) + 1.5 * Math.sin(((lat - origin[1]) * 110_540) / 37),
    }
    const before = analyzeRoad(road(), wavy, settings)
    const stretches = incompleteStretches(before.stations, road())
    const plan = fullBenchProfile(road(), before.stations, stretches, newId)
    if ('error' in plan) throw Error(plan.error)
    expect(plan.vertical.length).toBeLessThan(before.stations.length * 0.8)
    const after = analyzeRoad(road(plan.vertical), wavy, settings)
    expect(after.stations.filter((s) => !s.complete)).toEqual([])
    // Away from the bench the grade line stays within the tolerance of the ground it followed.
    for (const s of after.stations.filter((s) => s.chainage < 40 || s.chainage > 260)) {
      const was = before.stations.find((b) => Math.abs(b.chainage - s.chainage) < 1e-6)
      if (was)
        expect(Math.abs(s.designElevation! - was.designElevation!)).toBeLessThanOrEqual(PROFILE_TOLERANCE_M + 1e-6)
    }
  })

  it('keeps a designed road’s own PVIs outside the bench', () => {
    const designed = road([
      { id: 'start', chainage: 0, elevation: 900, curveLength: 0 },
      { id: 'end', chainage: 300, elevation: 915, curveLength: 0 },
    ])
    const before = analyzeRoad(designed, terrain, settings)
    const stretches = incompleteStretches(before.stations, designed)
    expect(stretches.length).toBeGreaterThan(0)
    const plan = fullBenchProfile(designed, before.stations, stretches, newId)
    if ('error' in plan) throw Error(plan.error)
    expect(plan.createdProfile).toBe(false)
    expect(plan.vertical.filter((p) => p.id === 'start' || p.id === 'end').map((p) => p.chainage)).toEqual([0, 300])
  })

  it('says so when the edge is already in cut', () => {
    const before = analyzeRoad(road(), terrain, settings)
    expect(fullBenchProfile(road(), before.stations, [{ side: 'left', rangeFrom: 100, rangeTo: 200 }], newId)).toEqual({
      error: 'The formation edge is already in cut on these stretches.',
    })
  })
})
