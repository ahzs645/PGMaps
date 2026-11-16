import { describe, expect, it } from 'vitest'
import { analyzeRoad, offsetCoordinate } from './engine'
import { createEngineeringDesign, type FillRequirement } from './engineeringTypes'
import { batterSource, withBatterSource } from './groundBatters'
import { parseProject, serializeProject } from './project'
import { createDemoProject } from './terrain'
import type { Alignment, Coordinate, GroundMaterial, RoadSettings, RoadTemplate } from './types'

const origin: Coordinate = [-122.8, 53.9]
const settings: RoadSettings = {
  stationInterval: 10,
  crossSectionHalfWidth: 60,
  maxGradePercent: 12,
  minRadius: 25,
  cutRate: 2,
  fillRate: 3,
  surfacingRate: 4,
  clearingRate: 0.5,
  shrinkFactor: 1,
}
const flat: RoadTemplate = {
  leftWidth: 3,
  rightWidth: 3,
  crossfallPercent: 0,
  cutSlope: 1,
  fillSlope: 1,
  ditchWidth: 0,
  ditchDepth: 0,
  surfaceDepth: 0,
}
// Soil over gravel, each with its own batters, as RoadEng ground types: soil 2:1 cut and 3:1 fill
// for the top 2 m, gravel 0.5:1 cut and 1.5:1 fill below.
const soil: GroundMaterial = {
  id: 'soil',
  name: 'Soil',
  color: '#a16207',
  cutRate: 5,
  reusableFraction: 1,
  compactionFactor: 1,
  cutSlope: 2,
  fillSlope: 3,
}
const gravel: GroundMaterial = { ...soil, id: 'gravel', name: 'Gravel', cutSlope: 0.5, fillSlope: 1.5 }
function road(level: number, template: Partial<RoadTemplate> = {}, fill?: FillRequirement): Alignment {
  const engineering = createEngineeringDesign()
  engineering.materials = [soil, gravel]
  engineering.strata = [
    { id: 'h-soil', start: 0, end: 11, materialId: 'soil', topDepthM: 0, bottomDepthM: 2 },
    { id: 'h-gravel', start: 0, end: 11, materialId: 'gravel', topDepthM: 2, bottomDepthM: null },
  ]
  if (fill) engineering.fillRequirements = [fill]
  return {
    id: 'auto',
    name: 'AUTO slopes',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: offsetCoordinate(origin, 0, 10), radiusM: 0 },
    ],
    vertical: [
      { id: 'a', chainage: 0, elevation: level, curveLength: 0 },
      { id: 'b', chainage: 10, elevation: level, curveLength: 0 },
    ],
    template: { ...flat, ...template },
    overrides: [],
    engineering,
  }
}
// Flat ground at 110 m: a road at 100 m is a 10 m cut, one at 120 m a 10 m fill.
const ground110 = { elevationAt: () => 110 }
const station = (a: Alignment) => analyzeRoad(a, ground110, settings).stations[0]

describe('AUTO slopes: batters from the ground materials', () => {
  it('cuts each horizon at its material’s batter, bending where the cut crosses the boundary', () => {
    const s = station(road(100, { cutSlopeFrom: 'material' }))
    // Gravel 0.5:1 for 8 m (3 → 7 m), then soil 2:1 for the top 2 m (7 → 11 m).
    expect(s.rightDaylightM).toBeCloseTo(11, 6)
    expect(s.leftDaylightM).toBeCloseTo(11, 6)
    // Per side: 30 m² under the road half, 16 under the gravel leg, 8 + 4 under the soil leg.
    expect(s.cutAreaM2).toBeCloseTo(2 * (30 + 16 + 8 + 4), 4)
  })
  it('keeps the stated batter whatever the material where the template says so', () => {
    const s = station(road(100, { cutSlopeFrom: 'template' }))
    expect(s.rightDaylightM).toBeCloseTo(13, 6)
  })
  it('builds the section as before where the template says nothing', () => {
    expect(station(road(100)).rightDaylightM).toBeCloseTo(
      station(road(100, { cutSlopeFrom: 'material' })).rightDaylightM!,
      9,
    )
    // Fill without a requirement stays the template's.
    expect(station(road(120)).rightDaylightM).toBeCloseTo(13, 6)
  })
  it('takes one side’s source over the template’s', () => {
    const s = station(road(100, { cutSlopeFrom: 'material', leftCutSlopeFrom: 'template' }))
    expect(s.leftDaylightM).toBeCloseTo(13, 6)
    expect(s.rightDaylightM).toBeCloseTo(11, 6)
  })
  it('fills at stratum layer 1’s fill batter when no fill material is assigned', () => {
    // Soil 3:1 for the 10 m fill: 3 + 30 m.
    expect(station(road(120, { fillSlopeFrom: 'material' })).rightDaylightM).toBeCloseTo(33, 6)
    expect(station(road(120, { fillSlopeFrom: 'template' })).rightDaylightM).toBeCloseTo(13, 6)
  })
  it('fills at the assigned fill material’s batter', () => {
    const fill: FillRequirement = {
      id: 'f',
      start: 0,
      end: 11,
      layer: 'subgrade',
      materialId: 'gravel',
      replaceable: false,
    }
    expect(station(road(120, { fillSlopeFrom: 'material' }, fill)).rightDaylightM).toBeCloseTo(18, 6)
    // A stated fill slope ignores the assignment.
    expect(station(road(120, { fillSlopeFrom: 'template' }, fill)).rightDaylightM).toBeCloseTo(13, 6)
  })
  it('follows a template range’s own sources on its side only', () => {
    const a = road(100, { cutSlopeFrom: 'template' })
    a.engineering!.templates = [{ id: 'auto', name: 'AUTO', template: { ...flat, cutSlopeFrom: 'material' } }]
    a.engineering!.assignments = [{ id: 'r', start: 0, end: 10, templateId: 'auto', side: 'right', transitionM: 0 }]
    const s = station(a)
    expect(s.leftDaylightM).toBeCloseTo(13, 6)
    expect(s.rightDaylightM).toBeCloseTo(11, 6)
  })
})

describe('batter source values', () => {
  it('reads a side’s own value before the template’s', () => {
    const t: RoadTemplate = { ...flat, cutSlopeFrom: 'material', rightCutSlopeFrom: 'template' }
    expect(batterSource(t, 'left', 'cut')).toBe('material')
    expect(batterSource(t, 'right', 'cut')).toBe('template')
    expect(batterSource(t, 'left', 'fill')).toBeUndefined()
  })
  it('writes the base value when both sides agree', () => {
    const one = withBatterSource(flat, 'left', 'cut', 'material')
    expect(one).toMatchObject({ leftCutSlopeFrom: 'material' })
    expect(one.cutSlopeFrom).toBeUndefined()
    const both = withBatterSource(one, 'right', 'cut', 'material')
    expect(both.cutSlopeFrom).toBe('material')
    expect(both.leftCutSlopeFrom).toBeUndefined()
    expect(withBatterSource(both, 'right', 'cut', undefined)).toMatchObject({ leftCutSlopeFrom: 'material' })
  })
  it('round-trips through a project file and refuses an unknown source', () => {
    const project = createDemoProject()
    project.alignments[0].template = {
      ...project.alignments[0].template,
      cutSlopeFrom: 'material',
      rightFillSlopeFrom: 'template',
    }
    const back = parseProject(serializeProject(project))
    expect(back.alignments[0].template).toMatchObject({ cutSlopeFrom: 'material', rightFillSlopeFrom: 'template' })
    const bad = JSON.parse(serializeProject(project))
    bad.alignments[0].template.cutSlopeFrom = 'auto'
    expect(() => parseProject(JSON.stringify(bad))).toThrow(/material or template/)
  })
})
