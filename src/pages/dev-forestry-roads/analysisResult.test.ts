import { describe, expect, it } from 'vitest'
import { calculatedAlignment, designInputsOf, safeAnalyzeRoad } from './analysisResult'
import { analyzeRoad, offsetCoordinate } from './engine'
import { createEngineeringDesign } from './engineeringTypes'
import { invalidInputNotice } from './inputErrors'
import type { Alignment, Coordinate, Culvert, RoadSettings, TerrainSource } from './types'

const origin: Coordinate = [-122.8, 53.9]
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
  shrinkFactor: 0.8,
}
function road(): Alignment {
  return {
    id: 'road',
    name: 'Road',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: offsetCoordinate(origin, 0, 100), radiusM: 0 },
    ],
    vertical: [
      { id: 's', chainage: 0, elevation: 798, curveLength: 0 },
      { id: 'e', chainage: 100, elevation: 798, curveLength: 0 },
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
    engineering: {
      ...createEngineeringDesign(),
      materials: [
        {
          id: 'strip',
          name: 'Topsoil',
          color: '#553311',
          cutRate: 0,
          reusableFraction: 0,
          compactionFactor: 1,
          purpose: 'stripping',
        },
      ],
    },
  }
}
const stripping = (start: number, end: number) => ({
  id: 's1',
  start,
  end,
  depthM: 0.2,
  leftInsideM: 0,
  rightInsideM: 0,
  leftOutsideM: 0.3,
  rightOutsideM: 0.3,
  materialId: 'strip',
})

describe('an invalid engineering input does not blank the road', () => {
  it('keeps the last valid results, says what was left out and where to fix it', () => {
    const valid = road()
    const before = safeAnalyzeRoad(valid, flat, settings)
    expect(before.invalidInput).toBeUndefined()
    expect(before.cutVolumeM3).toBeCloseTo(1600, 6)
    // The tester's case: a stripping start typed past the end of the range.
    const edited: Alignment = {
      ...valid,
      engineering: { ...valid.engineering!, sitePreparation: [stripping(2000, 100)] },
    }
    const kept = safeAnalyzeRoad(edited, flat, settings, [], {}, designInputsOf(valid))
    expect(kept.length).toBeCloseTo(100, 6)
    expect(kept.stations.length).toBe(before.stations.length)
    expect(kept.cutVolumeM3).toBeCloseTo(before.cutVolumeM3, 9)
    expect(kept.estimatedCost).toBeCloseTo(before.estimatedCost, 9)
    expect(kept.invalidInput).toEqual({
      message: 'Stripping 1: the end station (100 m) must be greater than the start station (2,000 m).',
      target: { list: 'sitePreparation', id: 's1', field: 'end' },
      leftOut: 'input',
    })
    // The results say so themselves, for the report's model flags and anything else that prints them.
    expect(kept.warnings[0]).toBe(
      'These results leave out one invalid input and use its last valid value: Stripping 1: the end station (100 m) must be greater than the start station (2,000 m).',
    )
    expect(before.warnings.some((warning) => warning.startsWith('These results leave out'))).toBe(false)
  })
  it('follows the current line and grade, so only the invalid input is left out', () => {
    const valid = road()
    const moved: Alignment = {
      ...valid,
      vertical: valid.vertical.map((p) => ({ ...p, elevation: 797 })),
      engineering: { ...valid.engineering!, sitePreparation: [stripping(50, 10)] },
    }
    const kept = safeAnalyzeRoad(moved, flat, settings, [], {}, designInputsOf(valid))
    // A 3 m cut, 6 m wide at formation with 1:1 batters: 27 m² over 100 m.
    expect(kept.cutVolumeM3).toBeCloseTo(2700, 6)
    expect(kept.invalidInput?.target?.list).toBe('sitePreparation')
  })
  it('reports an empty result when nothing valid is known or the line itself is wrong', () => {
    const edited = road()
    edited.engineering!.sitePreparation = [stripping(2000, 100)]
    const none = safeAnalyzeRoad(edited, flat, settings)
    expect(none.stations).toEqual([])
    expect(none.warnings[0]).toMatch(/^Correct this input before calculating: Stripping 1: /)
    const line = road()
    line.points[1].coordinate = [NaN, 53.9]
    const broken = safeAnalyzeRoad(line, flat, settings, [], {}, designInputsOf(road()))
    expect(broken.stations).toEqual([])
    expect(broken.warnings[0]).toMatch(/^Correct this alignment before calculating: /)
    expect(broken.invalidInput?.target).toBeUndefined()
  })
})

const culvert = (patch: Partial<Culvert>): Culvert => ({
  id: 'c1',
  name: 'Culvert 1',
  kind: 'cross-drain',
  chainage: 30,
  skewDegrees: 0,
  lengthM: 10,
  diameterM: 0.6,
  inletInvertM: null,
  outletInvertM: null,
  minCoverM: 0.3,
  unitCost: 100,
  fixedCost: 500,
  ...patch,
})
const withCulverts = (culverts: Culvert[]): Alignment => {
  const base = road()
  return { ...base, engineering: { ...base.engineering!, culverts } }
}

describe('an invalid input leaves out only itself', () => {
  it('applies a valid edit made after an invalid one, in another input', () => {
    const valid = withCulverts([culvert({})])
    const before = safeAnalyzeRoad(valid, flat, settings)
    expect(before.engineering!.costs.structures).toBeCloseTo(1500, 6)
    // The left half-width is typed as 60 m (the limit is 50), then the culvert's price is doubled.
    const edited: Alignment = {
      ...valid,
      template: { ...valid.template, leftWidth: 60 },
      engineering: { ...valid.engineering!, culverts: [culvert({ unitCost: 200 })] },
    }
    const kept = safeAnalyzeRoad(edited, flat, settings, [], {}, designInputsOf(valid))
    expect(kept.invalidInput).toEqual({
      message: 'Road section: left half-width (m) must be 0.1 to 50.',
      target: { list: 'template', field: 'leftWidth' },
      leftOut: 'input',
    })
    // The new price is in the estimate; the road is still the 6 m one.
    expect(kept.engineering!.costs.structures).toBeCloseTo(2500, 6)
    expect(kept.estimatedCost - before.estimatedCost).toBeCloseTo(1000, 6)
    expect(kept.cutVolumeM3).toBeCloseTo(before.cutVolumeM3, 9)
    expect(kept.calculatedInputs?.template.leftWidth).toBe(3)
    expect(kept.calculatedInputs?.engineering?.culverts[0].unitCost).toBe(200)
    expect(calculatedAlignment(edited, kept).template.leftWidth).toBe(3)
    expect(calculatedAlignment(valid, before)).toBe(valid)
  })

  it('applies a valid edit to another field of the same template', () => {
    const valid = road()
    const edited: Alignment = { ...valid, template: { ...valid.template, leftWidth: 60, rightWidth: 4 } }
    const kept = safeAnalyzeRoad(edited, flat, settings, [], {}, designInputsOf(valid))
    expect(kept.calculatedInputs?.template).toMatchObject({ leftWidth: 3, rightWidth: 4 })
    // A 2 m cut 7 m wide at formation with 1:1 batters: 18 m², against 16 m² at 6 m.
    expect(kept.cutVolumeM3).toBeCloseTo(1800, 6)
  })

  it('leaves out one entry of a list and keeps edits to the others', () => {
    const valid = withCulverts([culvert({}), culvert({ id: 'c2', name: 'Culvert 2', chainage: 60 })])
    const edited = withCulverts([
      culvert({ diameterM: -1 }),
      culvert({ id: 'c2', name: 'Culvert 2', chainage: 60, unitCost: 300 }),
      culvert({ id: 'c3', name: 'Culvert 3', chainage: 80 }),
    ])
    const kept = safeAnalyzeRoad(edited, flat, settings, [], {}, designInputsOf(valid))
    expect(kept.invalidInput?.target).toMatchObject({ list: 'culverts', id: 'c1' })
    expect(kept.invalidInput?.leftOut).toBe('input')
    expect(kept.calculatedInputs?.engineering?.culverts.map((c) => [c.id, c.diameterM, c.unitCost])).toEqual([
      ['c1', 0.6, 100],
      ['c2', 0.6, 300],
      ['c3', 0.6, 100],
    ])
    // 1,500 + (500 + 10 × 300) + 1,500.
    expect(kept.engineering!.costs.structures).toBeCloseTo(6500, 6)
  })

  it('leaves out a new entry that is invalid', () => {
    const valid = road()
    // A stripping range is added with its stations the wrong way round.
    const added: Alignment = {
      ...valid,
      engineering: { ...valid.engineering!, sitePreparation: [stripping(50, 10)] },
    }
    const kept = safeAnalyzeRoad(added, flat, settings, [], {}, designInputsOf(valid))
    expect(kept.calculatedInputs?.engineering?.sitePreparation ?? []).toEqual([])
    expect(kept.invalidInput?.leftOut).toBe('input')
  })

  it('names every input that is invalid at once and leaves each out', () => {
    const valid = withCulverts([culvert({})])
    const edited: Alignment = {
      ...valid,
      template: { ...valid.template, leftWidth: 60, cutSlope: 0, rightWidth: 4 },
      engineering: { ...valid.engineering!, culverts: [culvert({ unitCost: 200 })] },
    }
    const kept = safeAnalyzeRoad(edited, flat, settings, [], {}, designInputsOf(valid))
    expect(kept.invalidInput).toEqual({
      message: 'Road section: left half-width (m) must be 0.1 to 50.',
      target: { list: 'template', field: 'leftWidth' },
      others: ['Road section: cut batter (H:V) must be 0.1 to 10.'],
      leftOut: 'input',
    })
    expect(kept.calculatedInputs?.template).toMatchObject({ leftWidth: 3, cutSlope: 1, rightWidth: 4 })
    expect(kept.engineering!.costs.structures).toBeCloseTo(2500, 6)
    expect(invalidInputNotice(kept.invalidInput!)).toBe(
      'These results leave out 2 invalid inputs and use their last valid values: Road section: left half-width (m) must be 0.1 to 50. Road section: cut batter (H:V) must be 0.1 to 10.',
    )
  })

  it('leaves out one side of a rule that two inputs break together', () => {
    // A 1 m ditch with a 0.5 m bottom, then the top narrowed to 0.3 m: the bottom no longer fits.
    const valid = road()
    valid.template = { ...valid.template, ditchWidth: 1, ditchDepth: 0.3, leftDitchBottomWidth: 0.5 }
    const edited: Alignment = { ...valid, template: { ...valid.template, ditchWidth: 0.3, fillSlope: 2 } }
    const kept = safeAnalyzeRoad(edited, flat, settings, [], {}, designInputsOf(valid))
    expect(kept.invalidInput?.message).toBe(
      'Road section: the left ditch bottom width (0.5 m) must be 0 to the ditch top width (0.3 m).',
    )
    expect(kept.calculatedInputs?.template).toMatchObject({ ditchWidth: 1, fillSlope: 2 })
  })

  it('gives the same results as analysing the calculated inputs directly', () => {
    const valid = withCulverts([culvert({})])
    const edited: Alignment = {
      ...valid,
      template: { ...valid.template, leftWidth: 60, fillSlope: 2 },
    }
    const kept = safeAnalyzeRoad(edited, flat, settings, [], {}, designInputsOf(valid))
    const direct = analyzeRoad(calculatedAlignment(edited, kept), flat, settings)
    expect(kept.cutVolumeM3).toBe(direct.cutVolumeM3)
    expect(kept.estimatedCost).toBe(direct.estimatedCost)
    expect(kept.stations.length).toBe(direct.stations.length)
  })

  it('falls back to the whole last valid set, and says so, when the invalid input cannot be told apart', () => {
    const valid = road()
    // 501 widenings at once: over the limit of 200, and too many differences to try one by one.
    const edited: Alignment = {
      ...valid,
      template: { ...valid.template, rightWidth: 4 },
      overrides: Array.from({ length: 501 }, (_, i) => ({
        id: `w${i}`,
        name: `Turnout ${i + 1}`,
        kind: 'turnout' as const,
        side: 'left' as const,
        start: 10,
        end: 20,
        taper: 2,
        extraWidth: 1,
      })),
    }
    const kept = safeAnalyzeRoad(edited, flat, settings, [], {}, designInputsOf(valid))
    expect(kept.invalidInput?.leftOut).toBe('all')
    expect(kept.calculatedInputs?.template.rightWidth).toBe(3)
    expect(kept.cutVolumeM3).toBeCloseTo(1600, 6)
    expect(kept.warnings[0]).toMatch(
      /^These results leave out every section and engineering edit made since the inputs were last valid, because one cannot be calculated: Widenings need /,
    )
  })
})
