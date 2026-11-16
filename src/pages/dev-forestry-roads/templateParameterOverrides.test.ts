import { describe, expect, it } from 'vitest'
import { analyzeRoad, offsetCoordinate } from './engine'
import { createEngineeringDesign } from './engineeringTypes'
import { parseProject, serializeProject } from './project'
import { createDemoProject } from './terrain'
import { engineeringKnots, templateAt } from './templates'
import {
  describeOverride,
  overrideValueAt,
  parseParameterOverrides,
  type TemplateParameterOverride,
} from './templateParameterOverrides'
import type { Alignment, Coordinate, RoadSettings, RoadTemplate } from './types'

const flat: RoadTemplate = {
  leftWidth: 3,
  rightWidth: 3,
  crossfallPercent: 2,
  cutSlope: 1,
  fillSlope: 1.5,
  ditchWidth: 2,
  ditchDepth: 0.5,
  surfaceDepth: 0,
}
const origin: Coordinate = [-122.8, 53.9]
function road(overrides: TemplateParameterOverride[], length = 100): Alignment {
  const engineering = createEngineeringDesign()
  engineering.parameterOverrides = overrides
  return {
    id: 'o',
    name: 'Landing',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: offsetCoordinate(origin, 0, length), radiusM: 0 },
    ],
    vertical: [
      { id: 'a', chainage: 0, elevation: 100, curveLength: 0 },
      { id: 'b', chainage: length, elevation: 100, curveLength: 0 },
    ],
    template: { ...flat },
    overrides: [],
    engineering,
  }
}
// Softree's landing tutorial: template width to 20, 8 m from 21 to 79, template width again from 80.
const landing: TemplateParameterOverride = {
  id: 'w',
  name: 'Width (right)',
  side: 'right',
  field: 'Width',
  points: [
    { station: 0, value: null },
    { station: 20, value: null },
    { station: 21, value: 8 },
    { station: 79, value: 8 },
    { station: 80, value: null },
    { station: 100, value: null },
  ],
}

describe('parameter overrides', () => {
  it('interpolates between stations and holds the nearest outside them', () => {
    const own = () => 3
    const o = {
      points: [
        { station: 10, value: 5 },
        { station: 20, value: 7 },
      ],
    }
    expect(overrideValueAt(o, 0, own)).toBe(5)
    expect(overrideValueAt(o, 15, own)).toBeCloseTo(6, 9)
    expect(overrideValueAt(o, 25, own)).toBe(7)
  })
  it('reads a blank station as the template’s own value and leaves two blanks alone', () => {
    const own = () => 3
    expect(overrideValueAt(landing, 10, own)).toBeNull()
    expect(overrideValueAt(landing, 20.5, own)).toBeCloseTo(5.5, 9)
    expect(overrideValueAt(landing, 50, own)).toBe(8)
    expect(overrideValueAt(landing, 79.5, own)).toBeCloseTo(5.5, 9)
    expect(overrideValueAt(landing, 90, own)).toBeNull()
  })
  it('changes the section in force, after template ranges', () => {
    const a = road([landing])
    expect(templateAt(a, 10).template.rightWidth).toBe(3)
    expect(templateAt(a, 50).template.rightWidth).toBe(8)
    expect(templateAt(a, 50).template.leftWidth).toBe(3)
    // A wider range from 0 to 50 m: the blank at 20 m is that range's 4 m.
    a.engineering!.templates = [{ id: 'wide', name: 'Wide', template: { ...flat, rightWidth: 4 } }]
    a.engineering!.assignments = [{ id: 'r', start: 0, end: 50, templateId: 'wide', side: 'both', transitionM: 0 }]
    expect(templateAt(a, 10).template.rightWidth).toBe(4)
    expect(templateAt(a, 20.5).template.rightWidth).toBeCloseTo(6, 9)
  })
  it('changes side values with a base value, keeping a ditch bottom within its top', () => {
    const ditch: TemplateParameterOverride = {
      id: 'd',
      name: 'Ditch',
      side: 'left',
      field: 'DitchWidth',
      points: [{ station: 0, value: 0.5 }],
    }
    const t = templateAt(
      road([ditch, { ...ditch, id: 'b', field: 'DitchBottomWidth', points: [{ station: 0, value: 1 }] }]),
      50,
    ).template
    expect(t.leftDitchWidth).toBe(0.5)
    expect(t.leftDitchBottomWidth).toBe(0.5)
    expect(t.rightDitchWidth ?? t.ditchWidth).toBe(2)
  })
  it('gives the engine a station at each override station and widens the section there', () => {
    const a = road([landing])
    const knots = engineeringKnots(a)
    for (const s of [20, 21, 79, 80]) expect(knots).toContain(s)
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
    // Level ground 1 m below the road: the right fill toe moves out by the extra 5 m of width, less
    // the 1.5:1 fill the 2 % crossfall drops the wider edge into (0.1 m × 1.5).
    const stations = analyzeRoad(a, { elevationAt: () => 99 }, settings).stations
    const at = (c: number) => stations.find((s) => Math.abs(s.chainage - c) < 1e-6)!
    expect(at(50).rightDaylightM! - at(10).rightDaylightM!).toBeCloseTo(4.85, 6)
    expect(at(50).leftDaylightM).toBeCloseTo(at(10).leftDaylightM!, 6)
  })
  it('round-trips through a project file and refuses stations out of order', () => {
    const project = createDemoProject()
    project.alignments[0].engineering = { ...createEngineeringDesign(), parameterOverrides: [landing] }
    const back = parseProject(serializeProject(project))
    expect(back.alignments[0].engineering!.parameterOverrides).toEqual([landing])
    expect(() =>
      parseParameterOverrides([
        {
          ...landing,
          points: [
            { station: 10, value: 1 },
            { station: 5, value: 1 },
          ],
        },
      ]),
    ).toThrow(/stations must increase/)
    expect(() => parseParameterOverrides([{ ...landing, field: 'Colour' }])).toThrow(/changes one of/)
    expect(() => parseParameterOverrides([{ ...landing, points: [{ station: 0, value: 80 }] }])).toThrow(
      /between 0.1 and 50/,
    )
  })
  it('describes itself in one line', () => {
    expect(describeOverride(landing)).toBe(
      'Right width: 0 m template, 20 m template, 21 m 8, 79 m 8, 80 m template, 100 m template',
    )
  })
})
