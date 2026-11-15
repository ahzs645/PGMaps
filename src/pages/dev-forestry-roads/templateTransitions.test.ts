import { describe, expect, it } from 'vitest'
import { analyzeRoad, offsetCoordinate } from './engine'
import { createEngineeringDesign } from './engineeringTypes'
import { sideValue, templateAt, templateTransitions, validateEngineering } from './templates'
import type { Alignment, Coordinate, RoadSettings, RoadTemplate, SectionComponent, TerrainSource } from './types'

const origin: Coordinate = [-122.8, 53.9]
const north = (m: number) => offsetCoordinate(origin, 0, m)
// A cross slope, so batters and ditches cut and fill differently at every width.
const sloped: TerrainSource = { elevationAt: (lon) => 800 + (lon - origin[0]) * 3000 }
const settings: RoadSettings = {
  stationInterval: 10,
  crossSectionHalfWidth: 40,
  maxGradePercent: 12,
  minRadius: 25,
  cutRate: 2,
  fillRate: 3,
  surfacingRate: 4,
  clearingRate: 0.5,
  shrinkFactor: 0.8,
}
const base: RoadTemplate = {
  leftWidth: 3,
  rightWidth: 3,
  crossfallPercent: 2,
  cutSlope: 1,
  fillSlope: 1.5,
  ditchWidth: 2,
  ditchDepth: 0.5,
  surfaceDepth: 0.3,
}
const wide: RoadTemplate = { ...base, leftWidth: 5, rightWidth: 7, cutSlope: 0.5, ditchDepth: 1, surfaceDepth: 0.5 }
const bench: RoadTemplate = { ...base, leftWidth: 9, rightWidth: 9 }

function road(): Alignment {
  const engineering = createEngineeringDesign()
  engineering.templates.push(
    { id: 'wide', name: 'Wide', template: wide },
    { id: 'bench', name: 'Bench', template: bench },
  )
  engineering.assignments.push(
    { id: 'a', start: 0, end: 100, templateId: 'bench', side: 'both', transitionM: 0 },
    { id: 'b', start: 100, end: 300, templateId: 'wide', side: 'both', transitionM: 0 },
  )
  return {
    id: 'road',
    name: 'Road',
    color: '#16817a',
    points: [
      { id: 'p0', coordinate: origin, radiusM: 0 },
      { id: 'p1', coordinate: north(400), radiusM: 0 },
    ],
    vertical: [
      { id: 's', chainage: 0, elevation: 800, curveLength: 0 },
      { id: 'e', chainage: 400, elevation: 806, curveLength: 0 },
    ],
    template: { ...base },
    overrides: [],
    engineering,
  }
}
const withTransitions = (a: Alignment, id: string, patch: { transitionInM?: number; transitionOutM?: number }) => ({
  ...a,
  engineering: {
    ...a.engineering!,
    assignments: a.engineering!.assignments.map((x) => (x.id === id ? { ...x, ...patch } : x)),
  },
})

describe('template range transitions', () => {
  it('changes nothing when no transition is set, or when it is 0', () => {
    const plain = road()
    const zero = withTransitions(withTransitions(road(), 'a', { transitionOutM: 0 }), 'b', {
      transitionInM: 0,
      transitionOutM: 0,
    })
    const one = analyzeRoad(plain, sloped, settings),
      other = analyzeRoad(zero, sloped, settings)
    expect(other.stations.map((s) => s.chainage)).toEqual(one.stations.map((s) => s.chainage))
    expect(other.cutVolumeM3).toBe(one.cutVolumeM3)
    expect(other.fillVolumeM3).toBe(one.fillVolumeM3)
    expect(other.estimatedCost).toBe(one.estimatedCost)
    for (const c of [0, 50, 99.9, 100, 150, 299, 300, 350]) expect(templateAt(zero, c)).toEqual(templateAt(plain, c))
    expect(templateTransitions(plain)).toEqual([])
  })

  it('interpolates every numeric value linearly by chainage between the two templates', () => {
    const a = withTransitions(road(), 'b', { transitionInM: 20 })
    // At the midpoint of 100–120 the section is half Bench, half Wide.
    const mid = templateAt(a, 110)
    expect(mid.template.leftWidth).toBeCloseTo((9 + 5) / 2, 9)
    expect(mid.template.rightWidth).toBeCloseTo((9 + 7) / 2, 9)
    expect(sideValue(mid.template, 'left', 'CutSlope')).toBeCloseTo(0.75, 9)
    expect(sideValue(mid.template, 'right', 'DitchDepth')).toBeCloseTo(0.75, 9)
    expect(mid.leftName).toBe('Bench → Wide · transition')
    // A quarter of the way, and at either end, it is linear and continuous.
    expect(templateAt(a, 105).template.leftWidth).toBeCloseTo(9 + (5 - 9) * 0.25, 9)
    expect(templateAt(a, 100).template.leftWidth).toBeCloseTo(9, 9)
    expect(templateAt(a, 99.999).template.leftWidth).toBe(9)
    expect(templateAt(a, 120).template.leftWidth).toBe(5)
    expect(templateAt(a, 120).leftName).toBe('Wide')
    // The surfacing follows: half of each template's.
    expect(sideValue(mid.template, 'left', 'SurfaceDepth')).toBeCloseTo((0.3 + 0.5) / 2, 9)
    // Out to the base section after the range: halfway through 280–300.
    const out = withTransitions(road(), 'b', { transitionOutM: 20 })
    expect(templateAt(out, 290).template.rightWidth).toBeCloseTo((7 + 3) / 2, 9)
    expect(templateAt(out, 290).rightName).toBe('Wide → Base section · transition')
    // The engine samples where the transition ends and its areas follow the section.
    const result = analyzeRoad(a, sloped, settings)
    expect(result.stations.some((s) => Math.abs(s.chainage - 120) < 1e-6)).toBe(true)
    const station = result.stations.find((s) => Math.abs(s.chainage - 110) < 1e-6)!
    expect(station.leftWidth).toBeCloseTo(7, 9)
    const stepped = analyzeRoad(road(), sloped, settings).stations.find((s) => Math.abs(s.chainage - 110) < 1e-6)!
    expect(stepped.leftWidth).toBe(5)
    expect(station.cutAreaM2! + station.fillAreaM2!).not.toBeCloseTo(stepped.cutAreaM2! + stepped.fillAreaM2!, 3)
    expect(templateTransitions(a)).toEqual([
      expect.objectContaining({ side: 'left', edge: 'in', start: 100, end: 120, fromName: 'Bench', toName: 'Wide' }),
      expect.objectContaining({ side: 'right', edge: 'in', start: 100, end: 120, steppedBecause: null }),
    ])
  })

  it('steps at the midpoint where the two templates differ in structure, and says so', () => {
    const key = (kind: SectionComponent['kind']): SectionComponent => ({
      id: 'key',
      name: 'Toe',
      side: 'left',
      kind,
      condition: 'fill',
      widthM: 1,
      riseM: kind === 'key' ? 0 : 1,
      ...(kind === 'key' ? { depthM: 0.5 } : {}),
    })
    const a = withTransitions(road(), 'b', { transitionInM: 20 })
    a.engineering!.templates = a.engineering!.templates.map((t) => ({
      ...t,
      template: { ...t.template, components: [key(t.id === 'wide' ? 'slope' : 'key')] },
    }))
    const before = templateAt(a, 109.99),
      after = templateAt(a, 110.01)
    // Left: no interpolation, a step from Bench to Wide at 110.
    expect(before.template.leftWidth).toBe(9)
    expect(after.template.leftWidth).toBe(5)
    expect(before.template.components?.find((c) => c.side === 'left')?.kind).toBe('key')
    expect(after.template.components?.find((c) => c.side === 'left')?.kind).toBe('slope')
    expect(before.leftName).toBe('Bench → Wide · transition, stepped at its midpoint')
    // Right holds no components, so it still interpolates.
    expect(before.template.rightWidth).toBeCloseTo(9 + (7 - 9) * (9.99 / 20), 6)
    const [left] = templateTransitions(a)
    expect(left).toMatchObject({ side: 'left', start: 100, end: 120 })
    expect(left.steppedBecause).toBe('changing component type, condition, material or reference')
    // The step is sampled on both sides.
    const result = analyzeRoad(a, sloped, settings)
    expect(result.stations.filter((s) => Math.abs(s.chainage - 110) < 1e-4).length).toBeGreaterThanOrEqual(2)
  })

  it('refuses transitions that overrun the range, meet head on, or mix with a base transition', () => {
    const over = withTransitions(road(), 'b', { transitionInM: 150, transitionOutM: 60 })
    expect(() => validateEngineering(over.engineering!)).toThrow(/longer than the range/)
    const meet = withTransitions(withTransitions(road(), 'a', { transitionOutM: 10 }), 'b', { transitionInM: 10 })
    expect(() => validateEngineering(meet.engineering!)).toThrow(/both transition at 100 m/)
    const mixed = road()
    mixed.engineering!.assignments[1] = { ...mixed.engineering!.assignments[1], transitionM: 10, transitionInM: 10 }
    expect(() => validateEngineering(mixed.engineering!)).toThrow(/not both/)
    // One side's transition does not meet the other side's.
    const sides = road()
    sides.engineering!.assignments = [
      { id: 'a', start: 0, end: 100, templateId: 'bench', side: 'left', transitionM: 0, transitionOutM: 10 },
      { id: 'b', start: 100, end: 300, templateId: 'wide', side: 'right', transitionM: 0, transitionInM: 10 },
    ]
    expect(() => validateEngineering(sides.engineering!)).not.toThrow()
  })
})
