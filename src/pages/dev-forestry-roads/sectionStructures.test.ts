import { describe, expect, it } from 'vitest'
import { analyzeRoad, offsetCoordinate, validateRoadInputs } from './engine'
import { sectionCodePoints } from './sectionGeometry'
import { surfaceLayerAreas } from './sectionAssembly'
import {
  blendSectionStructures,
  courseSideRunM,
  ditchRuns,
  parseSectionStructures,
  structureQuantities,
} from './sectionStructures'
import { copyTemplateSide, templateAt, validateTemplate } from './templates'
import { EngineeringInputError } from './inputErrors'
import { createEngineeringDesign } from './engineeringTypes'
import type { Alignment, Coordinate, RoadSettings, RoadTemplate } from './types'
import { roadEngTemplateToPgmaps, type RoadEngComponent, type RoadEngTemplate } from './roadEngDesignSettings'

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
// 3 m half-widths, level, 1:1 batters, no ditch, no surfacing: every area below is by hand.
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
function road(template: Partial<RoadTemplate>, level = 100, length = 10): Alignment {
  return {
    id: 'r',
    name: 'Road',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: offsetCoordinate(origin, 0, length), radiusM: 0 },
    ],
    vertical: [
      { id: 'a', chainage: 0, elevation: level, curveLength: 0 },
      { id: 'b', chainage: length, elevation: level, curveLength: 0 },
    ],
    template: { ...flat, ...template },
    overrides: [],
  }
}
const at = (ground: number) => ({ elevationAt: () => ground })
const station = (template: Partial<RoadTemplate>, ground: number) =>
  analyzeRoad(road(template), at(ground), settings).stations[0]

describe('ditch with its own inslope', () => {
  const ditch = { ditchWidth: 4, ditchDepth: 0.5, ditchBottomWidth: 1 }
  it('runs the inslope its depth × slope and gives the backslope the rest of the top width', () => {
    expect(ditchRuns(4, 0.5, 1, 2)).toEqual({ inRun: 1, bottom: 1, backRun: 2 })
    // Without an inslope both sides share it, as before.
    expect(ditchRuns(4, 0.5, 1, undefined)).toEqual({ inRun: 1.5, bottom: 1, backRun: 1.5 })
    // An inslope wider than the room left is held to it: a vertical backslope.
    expect(ditchRuns(4, 0.5, 1, 10)).toEqual({ inRun: 3, bottom: 1, backRun: 0 })
  })
  it('keeps the area and daylight of the same ditch with equal slopes and moves its bottom', () => {
    const even = station(ditch, 101),
      uneven = station({ ...ditch, ditchInslope: 2 }, 101)
    // Per side: 3 under the lane, 4 + 1.25 over the ditch, 0.5 under the 1:1 batter.
    expect(even.cutAreaM2).toBeCloseTo(17.5, 6)
    expect(uneven.cutAreaM2).toBeCloseTo(17.5, 6)
    expect(uneven.rightDaylightM).toBeCloseTo(8, 6)
    const bottom = (s: typeof even) =>
      sectionCodePoints(s, s === even ? road(ditch).template : road({ ...ditch, ditchInslope: 2 }).template)
    expect(bottom(even).find((p) => p.code === 'right-ditch-bottom')!.offset).toBeCloseTo(5, 6)
    expect(bottom(uneven).find((p) => p.code === 'right-ditch-bottom')!.offset).toBeCloseTo(4.5, 6)
    // The design line runs 2:1 down to the bottom and 4:1 back up.
    const design = (x: number) => uneven.section.find((p) => Math.abs(p.offset - x) < 1e-6)?.design
    expect(design(4)).toBeCloseTo(99.5, 6)
    expect(design(5)).toBeCloseTo(99.5, 6)
  })
  it('takes a ditch up to 30 m wide and 10 m deep, and no larger', () => {
    expect(() => validateTemplate({ ...flat, ditchWidth: 24, ditchDepth: 6, ditchBottomWidth: 4 })).not.toThrow()
    expect(() => validateTemplate({ ...flat, ditchWidth: 31, ditchDepth: 1 })).toThrow(EngineeringInputError)
    expect(() => validateTemplate({ ...flat, ditchWidth: 4, ditchDepth: 11 })).toThrow(EngineeringInputError)
  })
})

describe('benched batters', () => {
  it('rises 2 m, runs a 1 m bench, and repeats until the ground', () => {
    const s = station({ benches: { cut: { heightM: 2, widthM: 1 } } }, 106)
    // Faces 3→5, 6→8, 9→11 with benches at 102 and 104: daylight at 11 m.
    expect(s.rightDaylightM).toBeCloseTo(11, 6)
    expect(s.leftDaylightM).toBeCloseTo(11, 6)
    // Per side: 18 under the lane, 10 + 4 + 6 + 2 + 2 above the benched batter.
    expect(s.cutAreaM2).toBeCloseTo(84, 4)
    expect(s.componentPoints!.find((p) => p.code === 'right-bench-1-start')!.offset).toBeCloseTo(5, 6)
    expect(s.componentPoints!.find((p) => p.code === 'right-bench-2-end')!.offset).toBeCloseTo(9, 6)
    // Without benches the 1:1 batter daylights at 9 m and holds 36 m² a side.
    expect(station({}, 106).cutAreaM2).toBeCloseTo(72, 4)
  })
  it('steps a fill down the same way and closes at the batter after its last bench', () => {
    const s = station({ benches: { fill: { heightM: 2, widthM: 1 } } }, 94)
    expect(s.rightDaylightM).toBeCloseTo(11, 6)
    expect(s.fillAreaM2).toBeCloseTo(84, 4)
    // One bench only: 3→5 face, bench to 6, then the 1:1 closing batter to 94 at 10 m.
    const one = station({ benches: { fill: { heightM: 2, widthM: 1, count: 1 } } }, 94)
    expect(one.rightDaylightM).toBeCloseTo(10, 6)
  })
  it('uses its own face slope and daylights on a bench the ground meets', () => {
    // Faces at 0.5:1: 3→4 to 102, bench to 7; ground at 102 meets the bench where it starts.
    const s = station({ benches: { cut: { heightM: 2, widthM: 3, faceSlope: 0.5 } } }, 102)
    expect(s.rightDaylightM).toBeCloseTo(4, 6)
    // A bench that falls 10 % away from the road meets ground at 103 − … only past its width.
    const g = station({ benches: { cut: { heightM: 2, widthM: 3, faceSlope: 0.5, benchFallPercent: 50 } } }, 101.5)
    expect(g.rightDaylightM).toBeCloseTo(3.75, 6)
  })
})

describe('course side slopes', () => {
  it('narrows a course upward and prices its trapezoid', () => {
    const layers = [{ id: 'base', name: 'Base', side: 'both' as const, depthM: 0.3, sideSlope: 2 }]
    // 0.3 × (3 + 2.4) / 2 a side.
    expect(surfaceLayerAreas({ ...flat, layers }, 3, 3)[0].areaM2).toBeCloseTo(1.62, 9)
    expect(courseSideRunM(layers, 'left')).toBeCloseTo(0.6, 9)
    // Square-edged courses are unchanged.
    expect(
      surfaceLayerAreas({ ...flat, layers: [{ ...layers[0], sideSlope: undefined }] }, 3, 3)[0].areaM2,
    ).toBeCloseTo(1.8, 9)
  })
  it('stacks courses from the subgrade up, each on the one below', () => {
    // Listed from the subgrade up.
    const layers = [
      { id: 'base', name: 'Base', side: 'both' as const, depthM: 0.2, sideSlope: 4 },
      { id: 'top', name: 'Top', side: 'both' as const, depthM: 0.1, sideSlope: 4 },
    ]
    const areas = surfaceLayerAreas({ ...flat, layers }, 3, 3)
    // Base 3 → 2.2 wide, top 2.2 → 1.8.
    expect(areas.find((a) => a.id === 'base')!.areaM2).toBeCloseTo(2 * 0.2 * 2.6, 9)
    expect(areas.find((a) => a.id === 'top')!.areaM2).toBeCloseTo(2 * 0.1 * 2, 9)
  })
})

describe('walls', () => {
  const cutWall = {
    id: 'w',
    name: 'Cut wall',
    side: 'right' as const,
    kind: 'cut' as const,
    heightM: 2,
    thicknessM: 0.5,
  }
  it('digs under a cut wall and up its back, and closes the batter from its top', () => {
    const s = station({ walls: [cutWall] }, 104)
    // Heel at 3.5, back to 102 (1 mm run), 1:1 to the ground at 104.
    expect(s.rightDaylightM).toBeCloseTo(5.501, 6)
    expect(s.leftDaylightM).toBeCloseTo(7, 6)
    // Right: 12 + 2 + 0.003 + 2; left: 12 + 8.
    expect(s.cutAreaM2).toBeCloseTo(36.003, 4)
    const wall = s.structures!.find((x) => x.id === 'w')!
    expect(wall.kind).toBe('cut-wall')
    expect(wall.areaM2).toBeCloseTo(1, 9)
    expect(wall.heightM).toBeCloseTo(2, 9)
  })
  it('stops a cut wall at a lower cut', () => {
    const s = station({ walls: [cutWall] }, 101)
    expect(s.rightDaylightM).toBeCloseTo(3.501, 6)
    expect(s.structures![0].heightM).toBeCloseTo(1, 6)
    expect(s.structures![0].areaM2).toBeCloseTo(0.5, 6)
  })
  it('is not built where its side is in the other condition', () => {
    const s = station({ walls: [cutWall] }, 96)
    expect(s.structures).toBeUndefined()
    expect(s.rightDaylightM).toBeCloseTo(7, 6)
  })
  const fillWall = { ...cutWall, name: 'Fill wall', kind: 'fill' as const, heightM: 6, embedM: 0.5 }
  it('holds a fill with a face to the ground, its body out of the fill and its base in the cut', () => {
    const s = station({ walls: [fillWall] }, 96)
    expect(s.rightDaylightM).toBeCloseTo(3.001, 6)
    // Right: 12 + 0.002 − 2 (body); left: 12 + 8. The embedded base adds 0.25 to the cut.
    expect(s.fillAreaM2).toBeCloseTo(30.002, 4)
    expect(s.cutAreaM2).toBeCloseTo(0.25, 6)
    expect(s.structures![0]).toMatchObject({ kind: 'fill-wall', areaM2: expect.closeTo(2.25, 6) })
  })
  it('continues a fill deeper than the wall at the fill batter from its foot', () => {
    const s = station({ walls: [{ ...fillWall, heightM: 2, embedM: 0 }] }, 96)
    expect(s.rightDaylightM).toBeCloseTo(5.001, 6)
    expect(s.componentPoints!.find((p) => p.code === 'right-wall-foot')!.design).toBeCloseTo(98, 6)
  })
  it("lowers a covered fill wall under the road's fill", () => {
    const s = station({ walls: [{ ...fillWall, coverHeightM: 1 }] }, 96)
    // The body is 3 m of the 4 m drop: 0.5 m less of it comes out of the fill than without a cover.
    expect(s.fillAreaM2).toBeCloseTo(30.502, 4)
    expect(s.structures![0]).toMatchObject({ kind: 'fill-wall', heightM: expect.closeTo(3, 6) })
    expect(s.structures![0].areaM2).toBeCloseTo(1.75, 6)
  })
  it('digs and refills the backfill behind a cut wall', () => {
    const plain = station({ walls: [cutWall] }, 104)
    const s = station({ walls: [{ ...cutWall, backfill: { offsetM: 1, baseSlope: 1, toGround: true } }] }, 104)
    // From the heel at 3.5: level to 4.5, then up 1:1 until it meets the ground at 8.5, under the
    // wall's back (3.5–3.501), its 1:1 batter (to 5.501) and the ground: 9.997 m².
    const backfill = s.structures!.find((x) => x.kind === 'wall-backfill')!
    expect(backfill.areaM2).toBeCloseTo(9.997, 3)
    expect(s.cutAreaM2! - plain.cutAreaM2!).toBeCloseTo(backfill.areaM2, 9)
    expect(s.fillAreaM2! - plain.fillAreaM2!).toBeCloseTo(backfill.areaM2, 9)
    // Refilled to a level top from the wall's top (102): only what lies below it.
    const level = station(
      { walls: [{ ...cutWall, backfill: { offsetM: 1, baseSlope: 1, toGround: false, topSlopePercent: 0 } }] },
      104,
    )
    // Below 102: 3.5–3.501 (0.001), 3.501–4.5 (2 m deep), 4.5–6.5 (2 m falling to 0).
    expect(level.fillAreaM2! - plain.fillAreaM2!).toBeCloseTo(0.001 + 2 * 0.999 + 2, 3)
  })
  it('measures walls along the road by average end areas', () => {
    const a = analyzeRoad(road({ walls: [cutWall] }), at(104), settings)
    const q = a.structures!.find((x) => x.id === 'w')!
    expect(q.lengthM).toBeCloseTo(10, 6)
    expect(q.volumeM3).toBeCloseTo(10, 6)
  })
})

describe('sub-cuts and barriers', () => {
  const subCut = { id: 'sc', name: 'Sub-cut', reference: 'subgrade' as const, depthM: 0.5, widthM: 3 }
  it('digs below the subgrade and refills it', () => {
    const s = station({ subCut }, 101)
    // 7 of ordinary cut, 1.5 a side dug below the subgrade.
    expect(s.cutAreaM2).toBeCloseTo(10, 6)
    expect(s.fillAreaM2).toBeCloseTo(3, 6)
    expect(s.componentAreas!.find((c) => c.id === 'sc')!.areaM2).toBeCloseTo(1.5, 6)
    expect(s.structures!.filter((x) => x.kind === 'sub-cut')).toHaveLength(2)
  })
  it('in a fill, digs only the ground the sub-cut reaches', () => {
    // Subgrade at 100, ground at 99.8: 0.3 m of ground above the bottom at 99.5.
    const s = station({ subCut }, 99.8)
    expect(s.componentAreas!.find((c) => c.id === 'sc')!.areaM2).toBeCloseTo(0.9, 6)
    // Below the merged surface it digs the full depth into the ground.
    const merged = station({ subCut: { ...subCut, reference: 'merged' } }, 99.8)
    expect(merged.componentAreas!.find((c) => c.id === 'sc')!.areaM2).toBeCloseTo(1.5, 6)
  })
  it('lays a straight bottom at its own slope, its inside slope and its own crossfall', () => {
    // Falling 10 % from 99.5 at the centreline: 0.5 to 0.8 m deep over 3 m.
    const sloped = station({ subCut: { ...subCut, bottomSlopePercent: -10 } }, 101)
    expect(sloped.componentAreas!.find((c) => c.id === 'sc')!.areaM2).toBeCloseTo(1.95, 6)
    // Down a 2:1 inside slope to the bottom 1 m out.
    const inside = station({ subCut: { ...subCut, insideSlope: 2 } }, 101)
    expect(inside.componentAreas!.find((c) => c.id === 'sc')!.areaM2).toBeCloseTo(1.25, 6)
    // A 4 % crown: following it keeps 0.5 m under the subgrade; a level bottom is shallower outward.
    const crown = { crossfallPercent: 4 }
    expect(station({ ...crown, subCut }, 101).componentAreas!.find((c) => c.id === 'sc')!.areaM2).toBeCloseTo(1.5, 6)
    const level = station({ ...crown, subCut: { ...subCut, followsCrossfall: false } }, 101)
    expect(level.componentAreas!.find((c) => c.id === 'sc')!.areaM2).toBeCloseTo(1.32, 6)
  })
  it('adds the outside slope wedge', () => {
    const s = station({ subCut: { ...subCut, outsideSlope: 2 } }, 101)
    // 1.5 + ½ × 1 × 0.5 a side.
    expect(s.componentAreas!.find((c) => c.id === 'sc')!.areaM2).toBeCloseTo(1.75, 3)
  })
  it('stands a barrier on the running surface and measures its length', () => {
    const barrier = {
      id: 'gr',
      name: 'Guard rail',
      side: 'right' as const,
      kind: 'guard-rail' as const,
      offsetM: 2.5,
      widthM: 0.2,
      heightM: 0.8,
    }
    const layers = [{ id: 'base', name: 'Base', side: 'both' as const, depthM: 0.3 }]
    const a = analyzeRoad(road({ barriers: [barrier], layers }), at(100), settings)
    const s = a.stations[0]
    const b = s.structures!.find((x) => x.id === 'gr')!
    expect(b.outline[0]).toEqual([2.5, expect.closeTo(100.3, 9)])
    expect(b.outline[2][1]).toBeCloseTo(101.1, 9)
    // No earthwork from a barrier.
    expect(s.cutAreaM2).toBeCloseTo(0, 9)
    expect(a.structures!.find((x) => x.id === 'gr')).toMatchObject({ lengthM: expect.closeTo(10, 6), volumeM3: 0 })
  })
})

describe('templates, files and transitions', () => {
  const rich: RoadTemplate = {
    ...flat,
    ditchWidth: 3,
    ditchDepth: 0.5,
    rightDitchInslope: 2,
    benches: { cut: { heightM: 3, widthM: 1.5, benchFallPercent: 5 } },
    walls: [{ id: 'w', name: 'Wall', side: 'left', kind: 'fill', heightM: 4, thicknessM: 0.6, faceSlope: 0.1 }],
    barriers: [{ id: 'b', name: 'Rail', side: 'left', kind: 'railing', offsetM: 2, widthM: 0.2, heightM: 1 }],
    subCut: { id: 's', name: 'Sub-cut', reference: 'merged', depthM: 0.4, widthM: 2.5, outsideSlope: 1 },
    layers: [{ id: 'c', name: 'Course', side: 'both', depthM: 0.2, sideSlope: 1.5 }],
  }
  it('reads back from a project file as written', () => {
    const parsed = parseSectionStructures(JSON.parse(JSON.stringify(rich)))
    for (const key of ['rightDitchInslope', 'benches', 'walls', 'barriers', 'subCut'] as const)
      expect(parsed[key]).toEqual(rich[key])
    expect(() => parseSectionStructures({ walls: [{ ...rich.walls![0], heightM: 99 }] })).toThrow()
    expect(() => validateTemplate(rich)).not.toThrow()
    expect(() => validateTemplate({ ...rich, benches: { cut: { heightM: 0, widthM: 1 } } })).toThrow(
      EngineeringInputError,
    )
  })
  it('copies one side to the other', () => {
    const copied = copyTemplateSide(rich, 'left', () => 'new')
    expect(copied.walls).toHaveLength(2)
    expect(copied.walls![1]).toMatchObject({ side: 'right', kind: 'fill' })
    expect(copied.barriers).toHaveLength(2)
    expect(copied.rightDitchInslope).toBeUndefined()
  })
  it('interpolates the inslope and steps the rest at a transition midpoint', () => {
    const out: RoadTemplate = { ...flat }
    blendSectionStructures(out, { ...flat, ditchInslope: 1 }, { ...rich, ditchInslope: 3 }, 'left', 0.25)
    expect(out.leftDitchInslope).toBeCloseTo(1.5, 9)
    expect(out.leftBenches).toBeUndefined()
    blendSectionStructures(out, flat, rich, 'left', 0.75)
    expect(out.leftBenches).toEqual(rich.benches)
    expect(out.walls).toEqual(rich.walls)
  })
  it('resolves a one-sided range without touching the other side', () => {
    const engineering = createEngineeringDesign()
    engineering.templates = [{ id: 't', name: 'Walled', template: rich }]
    engineering.assignments = [{ id: 'x', templateId: 't', start: 0, end: 10, side: 'left', transitionM: 0 }]
    const resolved = templateAt({ ...road({}), engineering }, 5).template
    expect(resolved.walls).toEqual(rich.walls?.filter((w) => w.side === 'left'))
    expect(resolved.leftSubCut).toEqual(rich.subCut)
    expect(resolved.rightSubCut).toBeUndefined()
    expect(resolved.subCut).toBeUndefined()
  })
  it('keeps a road without them exactly as before', () => {
    const plain = analyzeRoad(road({ ditchWidth: 1, ditchDepth: 0.5 }), at(101), settings)
    expect(plain.structures).toBeUndefined()
    expect(plain.stations[0].structures).toBeUndefined()
    expect(() => validateRoadInputs(road(rich), settings)).not.toThrow()
  })
  it('sums station structures', () => {
    const outline: [number, number][] = []
    const q = structureQuantities([
      {
        chainage: 0,
        complete: true,
        structures: [{ id: 'w', name: 'W', kind: 'cut-wall', side: 'left', areaM2: 2, heightM: 1, outline }],
      },
      { chainage: 10, complete: true, structures: [] },
    ])
    expect(q[0]).toMatchObject({ lengthM: 5, volumeM3: 10 })
  })
})

// RoadEng library components (Softree's samples hold them only in template folders), built from
// their parameter names and descriptions.
describe('RoadEng components read as structures', () => {
  let index = 0
  const comp = (
    className: string,
    name: string,
    side: 'left' | 'right' | 'both',
    params: [string, number, ('length' | 'slope' | 'switch')?, string?][],
  ): RoadEngComponent => ({
    index: index++,
    className,
    name,
    description: '',
    side,
    parameters: params.map(([pName, raw, kind = 'length', description = ''], i) => ({
      index: i,
      name: pName,
      description,
      flags: kind === 'slope' ? 1 : 0,
      raw,
      value: raw,
      kind,
      featureIndex: null,
      formula: null,
      calculated: false,
    })),
  })
  const roadway = (side: 'left' | 'right') =>
    comp('RDWY', 'Rural I', side, [
      ['AcpWidth', 4],
      ['BaseThick', 0.2],
      ['_SUPER', -0.03, 'slope'],
    ])
  const template = (...components: RoadEngComponent[]): RoadEngTemplate => ({
    index: 1,
    code: 'TS',
    name: 'Test',
    crossfallLeft: -0.03,
    crossfallRight: -0.03,
    folder: false,
    components: [roadway('left'), roadway('right'), ...components],
  })
  const fallback: RoadTemplate = { ...flat }
  it('maps the four walls', () => {
    const m = roadEngTemplateToPgmaps(
      template(
        comp('SLPS', 'Wall I - SG Fill Wall', 'left', [
          ['WallOffsetX', 2],
          ['WallTopWidth', 6],
          ['WallOutsideSlope', 4, 'slope'],
          ['bHasFlatBase', 1, 'switch'],
          ['WallBaseCutDepth', 1],
        ]),
        comp('Gabion', 'Wall II - Gabion Fill Wall', 'right', [
          ['WallOffsetX', 5.5],
          ['BlockWidth', 1],
          ['BlockHeight', 1],
          ['BlockOffset', 0.2],
        ]),
        comp('Gabion', 'Wall III - Gabion Cut Wall', 'left', [
          ['WallSetback', 6],
          ['BlockWidth', 3],
          ['BlockHeight', 2],
          ['BlockOverlapPct', 80],
        ]),
        comp('Retain', 'Wall IV - Retaining Wall', 'right', [
          ['WallThick', 0.3],
          ['WallHeight', 2],
        ]),
      ),
      fallback,
    )
    const walls = m.template!.walls!
    expect(walls.map((w) => [w.side, w.kind, w.thicknessM, w.faceSlope, w.setbackM, w.embedM])).toEqual([
      // Wall I's face 2 + 6 m out, the formation 4 m: a 4 m setback.
      ['left', 'fill', 6, 0.25, 4, 1],
      ['left', 'cut', 3, 0.3, 6, undefined],
      ['right', 'fill', 1, 0.2, 2.5, undefined],
      ['right', 'cut', 0.3, undefined, undefined, undefined],
    ])
    expect(walls[3].heightM).toBe(2)
    expect(() => validateTemplate(m.template!)).not.toThrow()
    expect(m.unmapped.join()).not.toMatch(/Wall/)
  })
  it('maps the barriers, whichever way their offset is measured', () => {
    const m = roadEngTemplateToPgmaps(
      template(
        comp('Barrier', 'Barrier II - Concrete Barrier', 'left', [
          ['bIncludeBarrier', 1, 'switch'],
          ['BarrierCL_Offset', 3],
          ['TotalHeight', 1],
          ['BaseWidth', 0.8],
        ]),
        comp('Railing', 'Barrier III - Railing', 'right', [
          ['BarrierCL_Offset', 3],
          ['PostHeight', 1],
          ['PostThickness', 0.2],
          ['BaseHeight', 0.2],
          ['BaseWidth', 0.5],
          ['BaseOffset', 0.2],
        ]),
        comp('Guard Rail', 'Guard Rail', 'right', [
          ['POST_THICKNESS', 0.3],
          ['POST_HEIGHT', 0.5],
          ['POST_OFFSET', 0.5, 'length', 'post (inside) offset from edge of shoulder (away from center line)'],
        ]),
        comp('Guard Rail', 'Barrier I - Guard Rail', 'left', [['bIncludeBarrier', 0, 'switch']]),
      ),
      fallback,
    )
    expect(m.template!.barriers!.map((b) => [b.side, b.kind, b.offsetM, b.widthM, b.heightM])).toEqual([
      ['left', 'concrete', 3, 0.8, 1],
      ['right', 'railing', 3, 0.5, 1.2],
      // From the centreline, although its description says the shoulder's edge: Softree's guard-rail
      // article draws POST_OFFSET from the centreline.
      ['right', 'guard-rail', 0.5, 0.3, 0.5],
    ])
  })
  it('maps a wall cover, a retaining wall backfill and a sub-cut bottom', () => {
    const wallIV = comp('Retain', 'Wall IV - Retaining Wall', 'right', [
      ['WallThick', 0.3],
      ['WallHeight', 2],
      ['WallFactor', 0.7],
      ['WallBackSlope', 1, 'slope'],
      ['bBackFillToTopo', 0, 'switch'],
      ['WallBackfillSlope', -0.3, 'slope'],
      ['WallBFillOffset', 1.4],
    ])
    // A calculated offset, evaluated from its expression rather than its stored value.
    wallIV.parameters[6] = { ...wallIV.parameters[6], formula: 'WallHeight*WallFactor', calculated: true, raw: 9 }
    const m = roadEngTemplateToPgmaps(
      template(
        comp('SLPS', 'Wall I - SG Fill Wall', 'left', [
          ['WallOffsetX', 2],
          ['WallTopWidth', 6],
          ['bWallIncludeSG', 1, 'switch'],
          ['WallCoverHt', 0.5],
          ['WallCoverWidth', 4],
          ['WallCoverFillSlope', 0.667, 'slope'],
          ['bWallBaseBackFill', 1, 'switch'],
          ['BackFillSlope', 0, 'slope'],
        ]),
        wallIV,
        comp('SC', 'SubCut II - Under SG', 'both', [
          ['SubCutDepth', 2],
          ['SubCutWidthL', 4],
          ['SubCutWidthR', 4],
          ['SubCutBotSlope', -0.02, 'slope'],
          ['SubCutSlopeOut', 1, 'slope'],
          ['bApplySuper', 0, 'switch'],
          ['SubCutSlopeIn', 0.5, 'slope'],
        ]),
      ),
      fallback,
    )
    const t = m.template!
    expect(t.walls![0]).toMatchObject({ kind: 'fill', coverHeightM: 0.5 })
    expect(t.walls![1]).toMatchObject({
      kind: 'cut',
      backfill: { offsetM: 1.4, baseSlope: 1, toGround: false, topSlopePercent: -30 },
    })
    expect(t.subCut).toMatchObject({ bottomSlopePercent: -2, followsCrossfall: false, insideSlope: 2 })
    expect(m.unmapped.join()).toMatch(/backfill at its toe \(level\)/)
    expect(() => validateTemplate(t)).not.toThrow()
    expect(parseSectionStructures(JSON.parse(JSON.stringify(t)))).toMatchObject({
      walls: t.walls,
      subCut: t.subCut,
    })
  })
  it("reads the library's Slope VI bench count and Wall III face slope", () => {
    const m = roadEngTemplateToPgmaps(
      template(
        comp('SLPS', 'Slope VI - Benches', 'left', [
          ['bApplyInCut', 1, 'switch'],
          ['bApplyInFill', 0, 'switch'],
          ['FinalCutSlp', 1, 'slope'],
          ['BenchSlope', 2, 'slope'],
          ['BenchHeight', 4],
          ['BenchBaseWidth', 3],
          ['BenchBaseSlope', 0, 'slope'],
          ['MaxNumberBenches', 6, 'switch'],
        ]),
        comp('Gabion', 'Wall III - Gabion Cut Wall', 'right', [
          ['WallSetback', 5],
          ['WallSlope', 5, 'slope'],
          ['BlockWidth', 3],
          ['BlockHeight', 1],
        ]),
      ),
      fallback,
    )
    expect(m.template!.leftBenches?.cut?.count).toBe(6)
    // Each 1 m block steps back 1 ÷ 5: a 0.2:1 face.
    expect(m.template!.walls![0]).toMatchObject({ kind: 'cut', faceSlope: 0.2, setbackM: 5 })
  })
  it('maps sub-cuts and benches by height', () => {
    const m = roadEngTemplateToPgmaps(
      template(
        comp('SCS', 'SubCut I', 'both', [
          ['SubCutDepth', 5],
          ['SubCutWidthL', 25],
          ['SubCutWidthR', 5],
          ['SubCutSlopeOut', 1, 'slope'],
        ]),
        comp('SLPS', 'Bench by Cut Height', 'left', [
          ['BenchWidth', 3],
          ['BenchSlope', 0, 'slope'],
          ['MaxCutHeight', 5],
          ['CutSlope', 4, 'slope'],
          ['FinalFillSlp', 1, 'slope'],
        ]),
        comp('SLPS', 'Bench by Fill Height', 'right', [
          ['MinFillHeight', 0.5],
          ['FillHeight', 12],
          ['FillSlope1', 0.25, 'slope'],
          ['BenchWidth', 15],
          ['FillSlope2', 0.25, 'slope'],
          ['BenchSlope', 0, 'slope'],
        ]),
      ),
      fallback,
    )
    const t = m.template!
    expect(t.leftSubCut).toMatchObject({ reference: 'merged', depthM: 5, widthM: 25, outsideSlope: 1 })
    expect(t.rightSubCut).toMatchObject({ reference: 'merged', depthM: 5, widthM: 5 })
    expect(t.leftBenches).toEqual({ cut: { heightM: 5, widthM: 3, faceSlope: 0.25, count: 1 } })
    expect(t.leftCutSlope ?? t.cutSlope).toBe(0.25)
    expect(t.rightBenches).toEqual({ fill: { heightM: 12, widthM: 15, faceSlope: 4, count: 1 } })
    expect(t.rightFillSlope ?? t.fillSlope).toBe(4)
    expect(m.unmapped.join()).toMatch(/0.5 m least fill height/)
    expect(() => validateTemplate(t)).not.toThrow()
  })
})
