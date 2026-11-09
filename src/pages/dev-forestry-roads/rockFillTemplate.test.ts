import { describe, expect, it } from 'vitest'
import { analyzeRoad, offsetCoordinate } from './engine'
import { createEngineeringDesign } from './engineeringTypes'
import { incompleteReasonSummary, incompleteReasonText } from './sectionCompleteness'
import { keyedRockFillTemplate, ROCK_FILL_DEFAULTS } from './templates'
import { templateConditionCases } from './TemplateSandbox'
import type { Alignment, Coordinate, RoadSettings, RoadTemplate } from './types'

const origin: Coordinate = [-122.8, 53.9]
const settings: RoadSettings = {
  stationInterval: 10,
  crossSectionHalfWidth: 30,
  maxGradePercent: 12,
  minRadius: 25,
  cutRate: 2,
  fillRate: 3,
  surfacingRate: 4,
  clearingRate: 0.5,
  shrinkFactor: 1,
}
const base: RoadTemplate = {
  leftWidth: 3,
  rightWidth: 3,
  crossfallPercent: 3,
  cutSlope: 0.75,
  fillSlope: 1.5,
  ditchWidth: 1,
  ditchDepth: 0.5,
  surfaceDepth: 0.25,
  leftFillSlope: 2,
}
/** Ground at 800 m; a formation `height` m above it is a fill `height` deep at the centreline. */
function road(height: number): Alignment {
  return {
    id: 'road',
    name: 'Road',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: offsetCoordinate(origin, 0, 100), radiusM: 0 },
    ],
    vertical: [
      { id: 's', chainage: 0, elevation: 800 + height, curveLength: 0 },
      { id: 'e', chainage: 100, elevation: 800 + height, curveLength: 0 },
    ],
    template: structuredClone(base),
    overrides: [],
    engineering: createEngineeringDesign(),
  }
}
const flat = { elevationAt: () => 800 }
let next = 0
const newId = () => `key-${++next}`

describe('a keyed rock fill is a new template, not an edit of the road', () => {
  it('leaves the section it starts from untouched and keeps its ditches and cut batter', () => {
    const before = structuredClone(base)
    const rockFill = keyedRockFillTemplate(base, newId)
    expect(base).toEqual(before)
    expect(rockFill.ditchWidth).toBe(1)
    expect(rockFill.ditchDepth).toBe(0.5)
    expect(rockFill.cutSlope).toBe(0.75)
    // The rock slope is the fill batter on both sides, replacing any side value.
    expect(rockFill.fillSlope).toBe(ROCK_FILL_DEFAULTS.rockSlope)
    expect(rockFill.leftFillSlope).toBeUndefined()
    expect(rockFill.components?.map((c) => [c.side, c.kind, c.condition, c.widthM, c.depthM])).toEqual([
      ['left', 'key', 'fill', 2, 1],
      ['right', 'key', 'fill', 2, 1],
    ])
  })
  it('takes the rock slope, key size and subgrade width it is given', () => {
    const rockFill = keyedRockFillTemplate(base, newId, {
      rockSlope: 1.25,
      keyWidthM: 1.5,
      keyDepthM: 0.5,
      subgradeWidthM: 3.25,
    })
    expect([rockFill.leftWidth, rockFill.rightWidth, rockFill.fillSlope]).toEqual([3.25, 3.25, 1.25])
    expect(rockFill.components?.map((c) => [c.widthM, c.depthM])).toEqual([
      [1.5, 0.5],
      [1.5, 0.5],
    ])
    expect(() => keyedRockFillTemplate(base, newId, { rockSlope: 0 })).toThrow(/fill batter \(H:V\) must be 0\.1 to 10/)
  })
  it('does not change the road until it is assigned, then only over its range and side', () => {
    const a = road(3)
    const plain = analyzeRoad(a, flat, settings)
    a.engineering!.templates = [
      { id: 'rf', name: 'Keyed rock fill 1', template: keyedRockFillTemplate(a.template, newId) },
    ]
    const unassigned = analyzeRoad(a, flat, settings)
    expect(unassigned.fillVolumeM3).toBeCloseTo(plain.fillVolumeM3, 9)
    expect(unassigned.coveragePercent).toBeCloseTo(100, 5)
    a.engineering!.assignments = [{ id: 'r1', templateId: 'rf', side: 'right', start: 40, end: 60, transitionM: 0 }]
    const assigned = analyzeRoad(a, flat, settings)
    expect(assigned.coveragePercent).toBeCloseTo(100, 5)
    const at = (chainage: number, r = assigned) => r.stations.find((s) => Math.abs(s.chainage - chainage) < 1e-6)!
    // A 3 m fill on a 3 % crown: the right toe moves in from 1.5H:1V to the 1:1 rock slope, the left stays at 2:1.
    expect(at(50).rightDaylightM).toBeCloseTo(3 + (3 - 0.09) * 1, 3)
    expect(at(50).leftDaylightM).toBeCloseTo(at(50, plain).leftDaylightM!, 6)
    expect(at(20).rightDaylightM).toBeCloseTo(at(20, plain).rightDaylightM!, 6)
    // The key's excavation is counted as cut and its refill as fill inside the range.
    expect(at(50).componentAreas?.map((c) => c.name)).toEqual(['Right keyed rock fill'])
    expect(assigned.cutVolumeM3).toBeGreaterThan(plain.cutVolumeM3)
  })
})

describe('an incomplete section says why', () => {
  it('names the key that does not fit, with the room there is, at the station and along the road', () => {
    // A 1 m fill at 1:1 reaches ground 0.91 m past the formation edge: less than the 2 m key.
    const a = road(1)
    a.template = keyedRockFillTemplate(a.template, newId)
    const result = analyzeRoad(a, flat, settings)
    expect(result.coveragePercent).toBe(0)
    const station = result.stations[5]
    expect(station.complete).toBe(false)
    expect(station.incompleteReasons).toEqual([
      'Left keyed rock fill: the key reaches 2.00 m past the formation edge but the slope meets ground at 0.91 m; narrow the key or end its range before here',
      'Right keyed rock fill: the key reaches 2.00 m past the formation edge but the slope meets ground at 0.91 m; narrow the key or end its range before here',
    ])
    const reasons = incompleteReasonSummary(result.stations)
    expect(reasons.map((r) => [r.stations, r.firstChainage])).toEqual([
      [result.stations.length, 0],
      [result.stations.length, 0],
    ])
    expect(result.warnings.join(' ')).toContain(`Incomplete sections: ${incompleteReasonText(reasons)}`)
    // A complete section carries no reasons.
    const deep = road(3)
    deep.template = keyedRockFillTemplate(deep.template, newId)
    const complete = analyzeRoad(deep, flat, settings)
    expect(complete.coveragePercent).toBeCloseTo(100, 5)
    expect(complete.stations.every((s) => s.incompleteReasons === undefined)).toBe(true)
    expect(incompleteReasonSummary(complete.stations)).toEqual([])
  })
  it('counts each reason once per station and lists the most frequent first', () => {
    const reasons = incompleteReasonSummary([
      { chainage: 0, complete: true },
      { chainage: 10, complete: false, incompleteReasons: ['A'] },
      { chainage: 20, complete: false, incompleteReasons: ['B', 'A'] },
      { chainage: 30, complete: false, incompleteReasons: ['B'] },
      { chainage: 40, complete: false, incompleteReasons: ['B'] },
    ])
    expect(reasons).toEqual([
      { reason: 'B', stations: 3, firstChainage: 20 },
      { reason: 'A', stations: 2, firstChainage: 10 },
    ])
    expect(incompleteReasonText(reasons, 1)).toBe('B (3 stations, first at 20.0 m); and 1 other reason.')
  })
})

describe('the four condition previews', () => {
  it('draw a template whose component names one of the road materials', () => {
    const materials = [
      { id: 'rock', name: 'Rock', color: '#666666', cutRate: 25, reusableFraction: 1, compactionFactor: 1.2 },
    ]
    const template = keyedRockFillTemplate(base, newId)
    template.components = template.components!.map((c) => ({ ...c, materialId: 'rock' }))
    const cases = templateConditionCases(template, materials)
    expect(cases).toHaveLength(4)
    expect(cases.every((c) => c.station !== undefined)).toBe(true)
    // Without the road's materials the template cannot be calculated, and the preview says so.
    const missing = templateConditionCases(template)
    expect(missing.every((c) => c.station === undefined)).toBe(true)
    expect(missing[0].analysis.invalidInput?.message).toMatch(/unknown material/)
  })
})
