import { describe, expect, it } from 'vitest'
import { analyzeRoad, offsetCoordinate, validateRoadInputs } from './engine'
import { createEngineeringDesign } from './engineeringTypes'
import { parseEngineering } from './engineeringProject'
import { EngineeringInputError } from './inputErrors'
import { rockIntervals, horizonTopDepth, resolveHorizons } from './groundHorizons'
import {
  blendRockCut,
  overbreakSwell,
  parseRockCut,
  ROCK_CUT_DEFAULTS,
  rockSection,
  type RockSectionInput,
} from './rockExcavation'
import { availableStationColumns, reportingRows, stationReportCsv } from './stationReport'
import { templateAt } from './templates'
import type { Alignment, Coordinate, GroundMaterial, RoadSettings, RoadTemplate, SectionSample } from './types'

// Worked cases T4, T5 and T9 are the Lima VVA specification's hand-derived vectors (§11): Lima could
// not be run, so they are checked against standard formulae, not oracle output.

const flatTemplate: RoadTemplate = {
  leftWidth: 3,
  rightWidth: 3,
  crossfallPercent: 0,
  cutSlope: 1,
  fillSlope: 1,
  ditchWidth: 0,
  ditchDepth: 0,
  surfaceDepth: 0,
}
const noDitch = { left: { widthM: 0, bottomWidthM: 0 }, right: { widthM: 0, bottomWidthM: 0 } }
const sample = (offset: number, ground: number | null, design: number | null): SectionSample => ({
  offset,
  ground,
  design,
})

describe('shallow rock (T5)', () => {
  // Formation flat at 100.00 from −3 to +3 m; rock surface 100.60 on the left and 101.50 on the
  // right, soil above it. A 1 mm ramp joins the two grounds at the centreline.
  const input = (shallowDepthM?: number): RockSectionInput => ({
    section: [sample(-3, 101, 100), sample(-0.0005, 101, 100), sample(0.0005, 101.9, 100), sample(3, 101.9, 100)],
    pieces: [{ materialId: 'rock', topDepthM: 0.4, bottomDepthM: null }],
    template: { ...flatTemplate, ...(shallowDepthM === undefined ? {} : { rockCut: { shallowDepthM } }) },
    leftWidth: 3,
    rightWidth: 3,
    ditch: noDitch,
    complete: true,
  })
  it('splits 6.30 m² of rock cut into 1.80 m² shallow over a 3.0 m width', () => {
    const { rock, section } = rockSection(input(1))
    const area = rock!.areas[0]
    expect(area.cutAreaM2).toBeCloseTo(6.3, 3)
    expect(area.shallowAreaM2).toBeCloseTo(1.8, 3)
    expect(rock!.shallowWidthM).toBeCloseTo(3, 3)
    expect(area.deepAreaM2).toBe(0)
    // The rock line is drawn on every sample with ground: 0.4 m below it.
    expect(section.map((p) => p.rockTop)).toEqual([100.6, 100.6, 101.5, 101.5].map((v) => expect.closeTo(v, 9)))
    // No blasting level is entered, so none is drawn.
    expect(section.every((p) => p.blastLevel === undefined)).toBe(true)
  })
  it('gives 63.0 m³ of rock, 18.0 m³ of it shallow over 30.0 m², on a 10 m straight strip', () => {
    const { rock } = rockSection(input(1))
    expect(rock!.areas[0].cutAreaM2 * 10).toBeCloseTo(63, 1)
    expect(rock!.areas[0].shallowAreaM2 * 10).toBeCloseTo(18, 1)
    expect(rock!.shallowWidthM * 10).toBeCloseTo(30, 1)
  })
  it('reports no shallow rock without a shallow depth, and nothing for an incomplete section', () => {
    expect(rockSection(input()).rock!.areas[0].shallowAreaM2).toBe(0)
    expect(rockSection({ ...input(1), complete: false }).rock).toBeUndefined()
  })
  it('leaves the section alone where no rock is entered', () => {
    const plain = input(1)
    expect(rockSection({ ...plain, pieces: [] }).section).toEqual(plain.section)
  })
})

describe('blasting level (T9)', () => {
  // Right side: formation 100.00 to 4.5 m, a ditch whose bottom runs from its inner edge at 5.0 m
  // to the rock face at 6.0 m, the face nearly vertical, then the rock batter.
  const section: SectionSample[] = [
    sample(-6, 106, null),
    sample(-4.5, 106, 100),
    sample(0, 106, 100),
    sample(4.5, 106, 100),
    sample(5, 106, 99.5),
    sample(6, 106, 99.5),
    sample(6.0001, 106, 100),
    sample(7, 106, 106),
    sample(8, 106, null),
  ]
  const base: RockSectionInput = {
    section,
    pieces: [{ materialId: 'rock', topDepthM: 1, bottomDepthM: null }],
    template: {
      ...flatTemplate,
      rightRockCut: { blastDepthM: 0.75, blastCrossfallPercent: 10, drainageCrossfallPercent: -25 },
    },
    leftWidth: 4.5,
    rightWidth: 4.5,
    ditch: { left: { widthM: 0, bottomWidthM: 0 }, right: { widthM: 2, bottomWidthM: 1 } },
    complete: true,
  }
  const result = rockSection(base)
  const level = (offset: number) => {
    const p = result.section.find((q) => Math.abs(q.offset - offset) < 1e-6)
    return p?.blastLevel
  }
  it('lies 0.75 m below the centreline, falls 10 % to the ditch and rises 25 % to the rock face', () => {
    // On the right side only: the left side has no blasting level of its own.
    expect(level(4.5)).toBeCloseTo(98.8, 9)
    expect(level(5)).toBeCloseTo(98.75, 9)
    // The face is met just inside 6.0 m, where the rising surface reaches 99.00.
    const face = result.section.filter((p) => p.offset > 5.9 && p.offset < 6 && p.blastLevel != null)
    expect(face).toHaveLength(1)
    expect(face[0].blastLevel).toBeCloseTo(99.0, 3)
    // The lowest point lies under the ditch's inner bottom edge.
    const levels = result.section.filter((p) => p.blastLevel != null)
    expect(Math.min(...levels.map((p) => p.blastLevel!))).toBeCloseTo(98.75, 9)
    expect(result.section.filter((p) => p.offset < 0).every((p) => p.blastLevel == null)).toBe(true)
  })
  it('measures the overbreak in rock between the design line and the blasting level', () => {
    // 0–4.5 m: 0.75 + 0.1u deep; 4.5–5 m under the inslope; 5–6 m above the rising surface.
    const expected = 0.75 * 4.5 + 0.05 * 4.5 ** 2 + ((1.2 + 0.75) / 2) * 0.5 + ((0.75 + 0.5) / 2) * 1
    expect(result.rock!.areas[0].deepAreaM2).toBeCloseTo(expected, 3)
    // Every bit of it is on the right: the moment is positive.
    expect(result.rock!.areas[0].deepMomentM3).toBeGreaterThan(0)
  })
  it('blasts nothing where rock lies below the blasting level', () => {
    const deepRock = rockSection({ ...base, pieces: [{ materialId: 'rock', topDepthM: 7.5, bottomDepthM: null }] })
    expect(deepRock.rock!.areas[0].deepAreaM2).toBe(0)
    expect(deepRock.section.every((p) => p.blastLevel == null)).toBe(true)
  })
  it('keeps every area the section had: breakpoints are interpolated samples', () => {
    const inserted = result.section.filter((p) => !section.some((q) => q.offset === p.offset))
    expect(inserted.length).toBeGreaterThan(0)
    for (const p of inserted) expect(p.design).not.toBeNull()
  })
})

describe('rock values', () => {
  it('starts from Lima VVA’s new-project values', () => {
    expect(ROCK_CUT_DEFAULTS).toEqual({
      cutSlope: 0.1,
      ledgeWidthM: 0.5,
      blastDepthM: 0.75,
      blastCrossfallPercent: 10,
      drainageCrossfallPercent: -25,
      shallowDepthM: 1,
    })
  })
  it('reads a file block within its limits and refuses one outside them', () => {
    expect(parseRockCut({ blastDepthM: 0.75, unknown: 3 }, 'Rock')).toEqual({ blastDepthM: 0.75 })
    expect(() => parseRockCut({ blastDepthM: 6 }, 'Rock')).toThrow(/between 0 and 5/)
    expect(() => parseRockCut({ drainageCrossfallPercent: 10 }, 'Rock')).toThrow(/between -100 and 0/)
    expect(() => parseRockCut([], 'Rock')).toThrow(/object/)
  })
  it('interpolates through a transition and switches a block one side lacks at halfway', () => {
    expect(blendRockCut({ ledgeWidthM: 0 }, { ledgeWidthM: 1, shallowDepthM: 2 }, 0.25)).toEqual({ ledgeWidthM: 0.25 })
    expect(blendRockCut({ ledgeWidthM: 0 }, { ledgeWidthM: 1, shallowDepthM: 2 }, 0.75)).toEqual({
      ledgeWidthM: 0.75,
      shallowDepthM: 2,
    })
    expect(blendRockCut(undefined, { ledgeWidthM: 1 }, 0.4)).toBeUndefined()
    expect(blendRockCut(undefined, { ledgeWidthM: 1 }, 0.6)).toEqual({ ledgeWidthM: 1 })
  })
  it('counts only the swell of refilled overbreak (T4)', () => {
    // Cut = 1.0 × 1,000 + 1.4 × 500 + 0.4 × 100 = 1,740 m³; topsoil stays out.
    const swell = overbreakSwell({ compactionFactor: 1.4, reusableFraction: 1 }, 100)
    expect(1.0 * 1000 + 1.4 * 500 + swell.usableCompactedM3).toBeCloseTo(1740, 9)
    expect(overbreakSwell({ compactionFactor: 0.9, reusableFraction: 1 }, 100).shortfallCompactedM3).toBeCloseTo(10, 9)
    // A rock wasted in part sends that part of its swell to waste, as bank m³.
    const half = overbreakSwell({ compactionFactor: 1.4, reusableFraction: 0.5 }, 100)
    expect(half.usableCompactedM3).toBeCloseTo(20, 9)
    expect(half.unusableBankM3).toBeCloseTo(20 / 1.4, 9)
  })
  it('finds the top of rock and a material’s top from the resolved horizons', () => {
    const pieces = resolveHorizons([
      { id: 'soil', start: 0, end: 10, materialId: 'soil', topDepthM: 0, bottomDepthM: 2 },
      { id: 'r1', start: 0, end: 10, materialId: 'granite', topDepthM: 2, bottomDepthM: 3 },
      { id: 'r2', start: 0, end: 10, materialId: 'basalt', topDepthM: 3, bottomDepthM: null },
    ])
    expect(rockIntervals(pieces, (id) => id !== 'soil')).toEqual([{ topDepthM: 2, bottomDepthM: null }])
    expect(horizonTopDepth(pieces, 'basalt')).toBe(3)
    expect(horizonTopDepth(pieces, 'clay')).toBeNull()
  })
})

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
const soil: GroundMaterial = {
  id: 'soil',
  name: 'Till',
  color: '#a16207',
  cutRate: 5,
  reusableFraction: 1,
  compactionFactor: 1,
}
const granite: GroundMaterial = {
  id: 'granite',
  name: 'Granite',
  color: '#6b7280',
  cutRate: 30,
  reusableFraction: 1,
  compactionFactor: 1.4,
  rock: true,
}
function road(level: number, template: Partial<RoadTemplate> = {}, length = 10): Alignment {
  const engineering = createEngineeringDesign()
  engineering.materials = [soil, granite]
  engineering.strata = [
    { id: 'h-soil', start: 0, end: length + 1, materialId: 'soil', topDepthM: 0, bottomDepthM: 2 },
    { id: 'h-rock', start: 0, end: length + 1, materialId: 'granite', topDepthM: 2, bottomDepthM: null },
  ]
  return {
    id: 'rock',
    name: 'Rock cut',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: offsetCoordinate(origin, 0, length), radiusM: 0 },
    ],
    vertical: [
      { id: 'a', chainage: 0, elevation: level, curveLength: 0 },
      { id: 'b', chainage: length, elevation: level, curveLength: 0 },
    ],
    template: { ...flatTemplate, ...template },
    overrides: [],
    engineering,
  }
}
// A 10 m deep through cut in flat ground at 110 m, the top of rock 2 m down at 108 m.
const ground110 = { elevationAt: () => 110 }

describe('rock cut through the engine', () => {
  it('cuts a ledge where the rock batter rises out of rock, then the soil batter', () => {
    const a = road(100, { rockCut: { cutSlope: 0.25, ledgeWidthM: 0.5 } })
    const analysis = analyzeRoad(a, ground110, settings)
    const s = analysis.stations[0]
    // Rock batter 0.25 H:V from 3 m to 5 m (100 → 108 m), ledge to 5.5 m, soil 1:1 to 7.5 m.
    expect(s.rightDaylightM).toBeCloseTo(7.5, 6)
    expect(s.leftDaylightM).toBeCloseTo(7.5, 6)
    const ledge = s.componentPoints!.find((p) => p.code === 'right-rock-ledge')!
    expect(ledge.offset).toBeCloseTo(5.5, 6)
    expect(ledge.design).toBeCloseTo(108, 6)
    expect(s.componentPoints!.find((p) => p.code === 'left-rock-cut-top')!.offset).toBeCloseTo(-5, 6)
    // Per side: 30 + 12 under the rock batter, 1 under the ledge, 2 under the soil batter.
    expect(s.cutAreaM2).toBeCloseTo(90, 4)
    // Rock: 24 + 8 per side, above the subgrade.
    expect(s.rock!.areas[0].cutAreaM2).toBeCloseTo(64, 4)
    expect(analysis.engineering!.rock!.cutM3).toBeCloseTo(640, 2)
    expect(analysis.engineering!.rock!.commonM3).toBeCloseTo(260, 2)
  })
  it('without a ledge the rock batter meets the soil batter at the top of rock', () => {
    const s = analyzeRoad(road(100, { rockCut: { cutSlope: 0.25 } }), ground110, settings).stations[0]
    expect(s.rightDaylightM).toBeCloseTo(7, 6)
    expect(s.componentPoints!.some((p) => p.code.includes('rock-ledge'))).toBe(false)
  })
  it('splits shallow rock at the batter and blasts the overbreak under the road', () => {
    const a = road(100, {
      rockCut: { cutSlope: 0.25, ledgeWidthM: 0.5, blastDepthM: 0.75, shallowDepthM: 1 },
    })
    const analysis = analyzeRoad(a, ground110, settings)
    const s = analysis.stations[0]
    // Shallow where the rock batter is within 1 m of the rock top: 4.75–5 m each side.
    expect(s.rock!.areas[0].shallowAreaM2).toBeCloseTo(0.25, 4)
    expect(s.rock!.shallowWidthM).toBeCloseTo(0.5, 4)
    // The level falls 10 % from 99.25 m; the 0.25 H:V face, extended down, cuts its corner at
    // u = 11.25 / 4.1 m inside the formation edge.
    const u = 11.25 / 4.1
    const perSide = 0.75 * u + 0.05 * u * u + (4 * (3 - u) ** 2) / 2
    expect(s.rock!.areas[0].deepAreaM2).toBeCloseTo(2 * perSide, 4)
    const e = analysis.engineering!
    expect(e.rock!.deepM3).toBeCloseTo(20 * perSide, 3)
    expect(e.rock!.shallowM3).toBeCloseTo(2.5, 4)
    expect(e.rock!.shallowAreaM2).toBeCloseTo(5, 4)
    // Usable: till 1.0 × bank, granite 1.4 × bank, and the overbreak's swell 0.4 × deep (T4's rule).
    expect(e.usableCutM3).toBeCloseTo(260 + 1.4 * 640 + 0.4 * 20 * perSide, 3)
    expect(e.rock!.swellM3).toBeCloseTo(0.4 * 20 * perSide, 3)
    // The cut volume is unchanged by the overbreak, which lies below the subgrade.
    expect(analysis.cutVolumeM3).toBeCloseTo(900, 2)
    // The drawn level is on the samples, and stops on the batter.
    expect(s.section.some((p) => p.blastLevel != null)).toBe(true)
    // Station rows add up to the totals.
    const rows = reportingRows(analysis, analysis.stations, 0)
    expect(rows.reduce((sum, r) => sum + (r.deepRockVolume ?? 0), 0)).toBeCloseTo(e.rock!.deepM3, 6)
  })
  it('prices shallow rock and overbreak at their own rates, falling back to the cut rate', () => {
    const a = road(100, { rockCut: { cutSlope: 0.25, blastDepthM: 0.75, shallowDepthM: 1 } })
    const priced = structuredClone(a)
    priced.engineering!.materials[1] = { ...granite, shallowCutRate: 10, overbreakRate: 45 }
    const plain = analyzeRoad(a, ground110, settings).engineering!
    const result = analyzeRoad(priced, ground110, settings).engineering!
    const rock = result.materials.find((m) => m.materialId === 'granite')!
    expect(rock.rock!.shallowBankM3).toBeGreaterThan(0)
    expect(rock.excavationCost).toBeCloseTo(
      (rock.bankCutM3 - rock.rock!.shallowBankM3) * 30 +
        rock.rock!.shallowBankM3 * 10 +
        rock.rock!.overbreakBankM3 * 45,
      6,
    )
    const unpriced = plain.materials.find((m) => m.materialId === 'granite')!
    expect(unpriced.excavationCost).toBeCloseTo((unpriced.bankCutM3 + unpriced.rock!.overbreakBankM3) * 30, 6)
    expect(result.costs.cut).toBeCloseTo(
      result.materials.filter((m) => m.purpose !== 'stripping').reduce((s, m) => s + m.excavationCost, 0),
      6,
    )
  })
  it('changes nothing until a material is marked rock or a template cuts rock', () => {
    const unmark = (a: Alignment) => {
      a.engineering!.materials[1] = { ...granite, rock: undefined }
      return a
    }
    const before = analyzeRoad(unmark(road(100)), ground110, settings)
    const unmarked = unmark(road(100, { rockCut: { cutSlope: 0.25, ledgeWidthM: 0.5, blastDepthM: 0.75 } }))
    const after = analyzeRoad(unmarked, ground110, settings)
    expect(after.cutVolumeM3).toBeCloseTo(before.cutVolumeM3, 9)
    expect(after.stations[0].section).toEqual(before.stations[0].section)
    expect(after.engineering!.rock).toBeUndefined()
    expect(after.engineering!.stations[1].rockCutVolumeM3).toBeUndefined()
    expect(availableStationColumns(after).some((c) => c.id === 'rock')).toBe(false)
    // Marked rock without a template rock cut: classified and drawn, geometry as before.
    const marked = analyzeRoad(road(100), ground110, settings)
    expect(marked.stations[0].cutAreaM2).toBeCloseTo(before.stations[0].cutAreaM2!, 9)
    expect(marked.engineering!.rock!.deepM3).toBe(0)
  })
  it('appends rock columns to the station CSV after the existing ones', () => {
    const analysis = analyzeRoad(
      road(100, { rockCut: { cutSlope: 0.25, blastDepthM: 0.75, shallowDepthM: 1 } }),
      ground110,
      settings,
    )
    const header = stationReportCsv(analysis, reportingRows(analysis, analysis.stations, 0)).split('\r\n')[0]
    expect(header).toContain(
      'fill_volume_curvature_corrected_compacted_m3,common_excavation_bank_m3,rock_cut_bank_m3,shallow_rock_bank_m3,shallow_rock_area_m2,overbreak_rock_bank_m3,unknown_earthwork_m',
    )
  })
})

describe('overbreak on a curve', () => {
  // Overbreak on the right side only, round a right-hand 60 m curve: inside the curve it travels
  // less than the centreline, so the corrected volume is smaller.
  function curved() {
    const a = road(100, { rightRockCut: { cutSlope: 0.25, blastDepthM: 0.75 } }, 100)
    const b = offsetCoordinate(origin, 0, 100)
    a.points = [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: b, radiusM: 60 },
      { id: 'c', coordinate: offsetCoordinate(b, 90, 100), radiusM: 0 },
    ]
    a.vertical = [
      { id: 'a', chainage: 0, elevation: 100, curveLength: 0 },
      { id: 'b', chainage: 300, elevation: 100, curveLength: 0 },
    ]
    a.engineering!.strata.forEach((h) => (h.end = 400))
    return a
  }
  it('is corrected by its own centroid only when the correction is applied', () => {
    const reported = analyzeRoad(curved(), ground110, settings).engineering!
    const applied = analyzeRoad(curved(), ground110, { ...settings, curvatureCorrection: 'apply' }).engineering!
    expect(reported.rock!.deepM3).toBeGreaterThan(0)
    expect(applied.rock!.deepM3).toBeLessThan(reported.rock!.deepM3 - 1)
    // The rock cut takes the cut's own correction.
    expect(applied.rock!.cutM3).not.toBeCloseTo(reported.rock!.cutM3, 3)
  })
})

describe('stripping to a ground layer (fill termination)', () => {
  // Flat ground at 800 m, a 2 m fill to 802 m. Topsoil 0–0.5 m over rock.
  const flat = { elevationAt: () => 800 }
  function fillRoad(rockEnd = 101) {
    const a = road(802, {}, 100)
    a.engineering!.materials = [
      {
        id: 'strip',
        name: 'Topsoil',
        color: '#876543',
        purpose: 'stripping',
        cutRate: 5,
        reusableFraction: 0,
        compactionFactor: 1,
      },
      granite,
    ]
    a.engineering!.strata = [
      { id: 'top', start: 0, end: 101, materialId: 'strip', topDepthM: 0, bottomDepthM: 0.5 },
      { id: 'rock', start: 0, end: rockEnd, materialId: 'granite', topDepthM: 0.5, bottomDepthM: null },
    ]
    a.engineering!.sitePreparation = [
      {
        id: 'prep',
        start: 0,
        end: 101,
        depthM: 0.2,
        removeToMaterialId: 'granite',
        leftInsideM: 0,
        rightInsideM: 0,
        leftOutsideM: 0.3,
        rightOutsideM: 0.3,
        materialId: 'strip',
      },
    ]
    return a
  }
  it('founds the fill on rock: removes the 0.5 m above it and fills the hole', () => {
    const analysis = analyzeRoad(fillRoad(), flat, settings)
    // Per side 3 × 2.5 + 2.5² / 2 = 10.625 m² of fill; stripping 2 × 5.8 m × 0.5 m.
    expect(analysis.fillVolumeM3).toBeCloseTo(2125, 3)
    expect(analysis.engineering!.strippingCutM3).toBeCloseTo(580, 3)
    expect(analysis.stations[0].rightDaylightM).toBeCloseTo(5.5, 6)
  })
  it('leaves a station without that horizon incomplete rather than stripping it to zero', () => {
    const analysis = analyzeRoad(fillRoad(60), flat, settings)
    const late = analysis.stations.find((s) => s.chainage > 61)!
    expect(late.complete).toBe(false)
    expect(late.flags.some((f) => /Stripping to Granite: no Granite horizon/.test(f))).toBe(true)
    expect(analysis.coveragePercent).toBeLessThan(70)
    // Unknown, never zero: the rock and stripping of those intervals are left out.
    const index = analysis.stations.indexOf(late)
    expect(analysis.engineering!.stations[index].rockCutVolumeM3).toBeNull()
    expect(analysis.engineering!.stations[index].strippingCutVolumeM3).toBeNull()
  })
  it('refuses a removal material that does not exist', () => {
    const a = fillRoad()
    a.engineering!.sitePreparation![0].removeToMaterialId = 'missing'
    expect(() => validateRoadInputs(a, settings)).toThrow(EngineeringInputError)
  })
})

describe('inputs', () => {
  it('names the template field of an out-of-range rock value', () => {
    const a = road(100, { rockCut: { blastDepthM: 9 } })
    try {
      validateRoadInputs(a, settings)
      throw Error('accepted')
    } catch (cause) {
      expect(cause).toBeInstanceOf(EngineeringInputError)
      expect((cause as EngineeringInputError).target).toEqual({ list: 'template', field: 'rockCut.blastDepthM' })
    }
  })
  it('refuses a stripping material marked rock and rates out of range', () => {
    const a = road(100)
    a.engineering!.materials[1] = { ...granite, overbreakRate: -1 }
    expect(() => validateRoadInputs(a, settings)).toThrow(/overbreak rate/)
    a.engineering!.materials[1] = { ...granite, purpose: 'stripping', reusableFraction: 0 }
    expect(() => validateRoadInputs(a, settings)).toThrow(/cannot also be rock/)
  })
  it('reads rock materials and stripping-to ranges from a file, and old files without them', () => {
    const raw = {
      ...createEngineeringDesign(),
      materials: [
        { ...granite, shallowCutRate: 12, overbreakRate: 40 },
        {
          id: 'strip',
          name: 'Topsoil',
          color: '#876543',
          purpose: 'stripping',
          cutRate: 0,
          reusableFraction: 0,
          compactionFactor: 1,
        },
      ],
      sitePreparation: [
        {
          id: 'p',
          start: 0,
          end: 10,
          depthM: 0,
          removeToMaterialId: 'granite',
          leftInsideM: 0,
          rightInsideM: 0,
          leftOutsideM: 0,
          rightOutsideM: 0,
          materialId: 'strip',
        },
      ],
    }
    const parsed = parseEngineering(raw, (t) => t as RoadTemplate)
    expect(parsed.materials[0]).toMatchObject({ rock: true, shallowCutRate: 12, overbreakRate: 40 })
    expect(parsed.sitePreparation![0].removeToMaterialId).toBe('granite')
    const old = parseEngineering({ ...createEngineeringDesign(), materials: [soil] }, (t) => t as RoadTemplate)
    expect(old.materials[0]).not.toHaveProperty('rock')
    expect(() =>
      parseEngineering(
        { ...raw, materials: [{ ...granite, overbreakRate: 20000 }, raw.materials[1]] },
        (t) => t as RoadTemplate,
      ),
    ).toThrow(/Overbreak rate/)
  })
  it('resolves a one-sided rock template on its own side only', () => {
    const a = road(100, { rockCut: { ledgeWidthM: 0.5 } })
    a.engineering!.templates = [
      { id: 'deep', name: 'Deep rock', template: { ...flatTemplate, rockCut: { ledgeWidthM: 2 } } },
    ]
    a.engineering!.assignments = [{ id: 'x', start: 0, end: 10, templateId: 'deep', side: 'left', transitionM: 0 }]
    const resolved = templateAt(a, 5).template
    expect(resolved.leftRockCut).toEqual({ ledgeWidthM: 2 })
    expect(resolved.rightRockCut).toEqual({ ledgeWidthM: 0.5 })
    expect(resolved.rockCut).toBeUndefined()
  })
})
