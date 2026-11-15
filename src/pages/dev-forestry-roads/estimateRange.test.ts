import { describe, expect, it } from 'vitest'
import { crossDrainCount, rangeTotals, roadEstimateRange, type RangeAssumptions } from './estimateRange'
import { analyzeRoad } from './engine'
import { incompleteStretches } from './sectionFixes'
import { createDemoProject, demoTerrain } from './terrain'
import { createEngineeringDesign } from './engineeringTypes'

// The training hillside with sections only 8 m wide: the fill batters run out before they meet the
// ground, so the road has stretches for every fix to close.
const project = createDemoProject()
const alignment = project.alignments[0]
const settings = { ...project.settings, crossSectionHalfWidth: 8 }
const none: RangeAssumptions = { crossDrainSpacingM: null, crossDrainCost: null, endHaulRate: null }
let n = 0
const range = (assumptions: RangeAssumptions = none, road = alignment) =>
  roadEstimateRange(road, {
    source: demoTerrain,
    settings,
    context: [],
    analysisOptions: {},
    assumptions,
    contingency: true,
    id: () => `id-${n++}`,
  })

describe('the estimate range of a road', () => {
  it('starts from a road with sections that do not close', () => {
    const analysis = analyzeRoad(alignment, demoTerrain, settings)
    expect(incompleteStretches(analysis.stations, alignment).length).toBeGreaterThan(0)
  })
  it('prices low, medium and high on copies, closing more sections than the road as imported', () => {
    const before = JSON.stringify(alignment)
    const r = range()
    expect(JSON.stringify(alignment)).toBe(before)
    for (const level of ['low', 'medium', 'high'] as const) {
      expect(r[level].error).toBeUndefined()
      expect(r[level].estimate).not.toBeNull()
      expect(r[level].changes.length).toBeGreaterThan(0)
      expect(r[level].completePercent!).toBeGreaterThanOrEqual(r.asIs.completePercent)
    }
    expect(r.asIs.completePercent).toBeLessThan(100)
    expect(r.high.changes[0]).toMatch(/^Full bench on \d+ fill stretch/)
    // Nothing is guessed: without allowances each estimate is the copy's own.
    expect(r.medium.estimate).toBe(r.medium.roadEstimate)
    expect(r.medium.crossDrains).toBeNull()
  })
  it('adds the entered allowances and only those', () => {
    const counted = range({ crossDrainSpacingM: 50, crossDrainCost: null, endHaulRate: null })
    const length = analyzeRoad(alignment, demoTerrain, settings).length
    expect(counted.medium.crossDrains).toMatchObject({ count: Math.ceil(length / 50), cost: null })
    expect(counted.low.crossDrains).toBeNull()
    const priced = range({ crossDrainSpacingM: 50, crossDrainCost: 4000, endHaulRate: 12 })
    expect(priced.high.crossDrains!.cost).toBe(priced.high.crossDrains!.count * 4000)
    if (priced.high.endHaul) {
      expect(priced.high.endHaul.cost).toBeCloseTo(priced.high.endHaul.m3 * 12, 6)
      expect(priced.high.estimate).toBeCloseTo(
        priced.high.roadEstimate! + priced.high.crossDrains!.cost! + priced.high.endHaul.cost!,
        6,
      )
    }
  })
  it('leaves a surplus to the road’s own haul when it prices haul', () => {
    const engineering = createEngineeringDesign()
    const road = { ...alignment, engineering: { ...engineering, haul: { ...engineering.haul, enabled: true } } }
    const r = range({ ...none, endHaulRate: 12 }, road)
    for (const level of ['low', 'medium', 'high'] as const) expect(r[level].endHaul).toBeNull()
  })
  it('counts cross-drains past the culverts already entered, and sums levels only where every road has one', () => {
    expect(crossDrainCount({}, 1000, 200)).toBe(5)
    expect(crossDrainCount({}, 1000, null)).toBe(0)
    const engineering = createEngineeringDesign()
    const culvert = { kind: 'cross-drain' } as never
    expect(crossDrainCount({ engineering: { ...engineering, culverts: [culvert, culvert] } }, 1000, 200)).toBe(3)
    const r = range()
    expect(rangeTotals([r, r]).low).toBe(2 * r.low.estimate!)
    expect(rangeTotals([r, { ...r, medium: { ...r.medium, estimate: null } }]).medium).toBeNull()
  })
})
