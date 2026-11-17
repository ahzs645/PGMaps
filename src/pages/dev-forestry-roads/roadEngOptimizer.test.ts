import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { createEngineeringDesign } from './engineeringTypes'
import { LOCAL_PLANE_EPSG, localPlaneOffset, localPlaneProjection } from './localPlane'
import { parseProject, serializeProject } from './project'
import { createTotalCostPlanningDefaults } from './fullCostPlanning'
import { parseRoadEngDesign, roadEngRoads } from './roadEngImport'
import { mergeRoadEngIni } from './roadEngExport'
import {
  applyRoadEngOptimizer,
  parseRoadEngOptimizer,
  roadEngCurveTypeFor,
  roadEngMinLengths,
  roadEngOptimizerFor,
  roadEngOptimizerOverrides,
  type RoadEngOptimizerFrame,
} from './roadEngOptimizer'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, RoadProject, VerticalStandards } from './types'
import {
  activateVerticalAlternative,
  addVerticalAlternative,
  removeVerticalAlternative,
  snapshotActiveVerticalAlternative,
} from './verticalAlternatives'
import { curvatureRuleAt, gradeWindowAt } from './verticalStandards'

const NEW = '-,0,0,80,0,-10,10,0,0,902.6,2437,23,0,0,32,2275,131071,0,0,0,0,0,0,0,66,0,-9999,-9999,10,0,0'
/** Three vertical alignments in the layout of Softree's cul-de-sac and LongRoad samples. */
const DSN = [
  '[design]',
  'units=10000',
  '[HorOpt]',
  'DlgHorOptParameters=-9999,-9999,-9999,0,0,0,-9999,0,0.1,10,0,0,0,0,5',
  '[OptAlignCost-0]',
  'OptParms_Constraintv7-0=-10,10,10,3.40282346639e+038,10',
  'OptParms_CostSolution_v3=0,0,0,-9999,-9999,-9999,-9999,-9999,0,-9999,0,-1,-1,0',
  'OptParms_CtrlPnt-0=95,574.6,0,-2.6,0,9, ,0',
  'OptParms_CtrlPnt-1=600,568.5,0,-9999,-9999,33, ,0',
  'OptParms_Pit-0=3224.87074544,0,12,0,3200,1, ,OB,1,0,567.291133,0',
  'OptParmsDesc=-',
  `OptParmsNew=${NEW},V-align 1,1,0,-9999,1`,
  'OptParmsRefAlign=opt 3,opt 3,Ground',
  'OptParmsVIP-000=95,575,0',
  'OptParmsVIP-001=500,570,0',
  'OptParmsVIP-002=1050,566,0',
  '[OptAlignCost-1]',
  'OptParms_Constraintv7-0=-8,8,35,400,35',
  'OptParms_Constraintv7-1=-1,1,Linear,500',
  'OptParms_Constraintv7-2=-8,8,20,3.40282346639e+038,15',
  'OptParms_CostSolution_v3=2,0,0,0,1000,1,2,3,0,0,0.596,1716396832,-1,1',
  'OptParms_CtrlPnt-0=100,310,0.5,0,4,9, ,0',
  'OptParms_CtrlPnt-1=900,320,0,-9999,-9999,1,bridge deck,0',
  'OptParmsDesc=entire alignment',
  `OptParmsNew=${NEW},opt 3,1,0,-9999,1`,
  'OptParmsRefAlign=opt 3,opt 3,Ground',
  'OptParmsRegularization=0,0,0',
  '[OptAlignCost-2]',
  'OptParms_Constraintv7-0=-12,12,0,3.40282346639e+038,0',
  `OptParmsNew=${NEW},opt 4,1,0,-9999,1`,
  'OptParmsRefAlign=opt 3,opt 3,Ground',
  '[OptAlignCost]',
  'nOptCostParameters=3,1',
  'OptCostSpacing=-0.1,2275,458751',
  '[OtherCostParms]',
  'NOtherCosts=0',
  '',
].join('\r\n')

const FRAME: RoadEngOptimizerFrame = { startStationM: 100, endStationM: 1100, surfaceDepthM: 0.3 }

function road(): Alignment {
  return {
    id: 'r',
    name: 'Synthetic',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: [-122.8, 53.9], radiusM: 0 },
      { id: 'b', coordinate: [-122.8, 53.909], radiusM: 0 },
    ],
    vertical: [
      { id: 's', chainage: 0, elevation: 309.7, curveLength: 0 },
      { id: 'm', chainage: 500, elevation: 316.7, curveLength: 40 },
      { id: 'e', chainage: 1000, elevation: 319.7, curveLength: 0 },
    ],
    template: { ...DEFAULT_TEMPLATE },
    overrides: [],
    engineering: createEngineeringDesign(),
  }
}
function projectFor(alignment: Alignment): RoadProject {
  return {
    schema: 'pgmaps-road-project-v1',
    name: 'Optimizer settings',
    activeAlignmentId: alignment.id,
    alignments: [alignment],
    settings: { ...DEFAULT_ROAD_SETTINGS },
    terrain: { kind: 'demo', name: 'Synthetic ground', resolutionM: 1, verticalReference: 'Synthetic metres' },
    context: [],
    cables: [],
    totalCostPlanning: createTotalCostPlanningDefaults('2026-11-14'),
  }
}
const imported = (dsn = DSN, base = road(), frame = FRAME) =>
  applyRoadEngOptimizer(
    base,
    roadEngOptimizerFor(parseRoadEngOptimizer(dsn, frame.unitM ?? 1), { ...frame, activeVertical: base.vertical }),
  )
const written = (alignment: Alignment, original?: string, frame = FRAME) => {
  const { overrides } = roadEngOptimizerOverrides(alignment, frame, original)
  return mergeRoadEngIni(original ?? '[design]\r\nunits=10000\r\n', overrides)
}
/** The limits PGMaps checks, sampled along the road, to compare standards however they are split. */
const limits = (standards: VerticalStandards | undefined, length = 1000) =>
  Array.from({ length: 201 }, (_, k) => {
    const c = (k * length) / 200 + (k < 200 ? 0.37 : -0.37)
    const g = gradeWindowAt(standards, c, length)
    const r = curvatureRuleAt(standards, c - 0.1, c + 0.1, length)
    // K means nothing where only a straight grade is allowed.
    return [g.low, g.high, ...(r.linear ? ['linear'] : [r.minSagK, r.minCrestK])]
  })
/** A road's optimizer content without ids and with the active profile's ids, for comparisons. */
const content = (road: Alignment) => {
  const a = road.verticalAlternatives?.length ? snapshotActiveVerticalAlternative(road) : road
  return {
    standards: limits(a.verticalStandards),
    controls: (a.verticalControls ?? []).map(({ id: _id, ...c }) => c),
    alternatives: (a.verticalAlternatives ?? []).map((v) => ({
      name: v.name,
      active: v.id === a.activeVerticalAlternativeId,
      vertical: v.vertical.map(({ id: _id, ...p }) => p),
      standards: limits(v.verticalStandards),
      controls: (v.verticalControls ?? []).map(({ id: _id, ...c }) => c),
    })),
  }
}

describe('RoadEng optimizer settings', () => {
  it('reads the ranges, controls, stored profiles and the active alignment', () => {
    const read = parseRoadEngOptimizer(DSN)
    expect(read.options.map((o) => o.name)).toEqual(['V-align 1', 'opt 3', 'opt 4'])
    expect(read.activeIndex).toBe(1)
    const [, active] = read.options
    expect(
      active.constraints.map((c) => [c.minGradePercent, c.maxGradePercent, c.sagK, c.crestK, c.linear, c.endStationM]),
    ).toEqual([
      [-8, 8, 35, 35, false, 400],
      [-1, 1, null, null, true, 500],
      [-8, 8, 20, 15, false, null],
    ])
    expect(active.controls[1]).toMatchObject({
      stationM: 900,
      elevationM: 320,
      gradePercent: null,
      flags: 1,
      description: 'bridge deck',
    })
    expect(read.options[0].vips).toHaveLength(3)
  })

  it('maps them onto the road: chainage, finished surface to subgrade, Linear ranges and alternatives', () => {
    const mapping = roadEngOptimizerFor(parseRoadEngOptimizer(DSN), { ...FRAME, activeVertical: road().vertical })
    expect(mapping.verticalStandards?.gradeRanges).toEqual([
      { id: 'roadeng-grade-0', start: null, end: 300, minGradePercent: -8, maxGradePercent: 8 },
      { id: 'roadeng-grade-1', start: 300, end: 400, minGradePercent: -1, maxGradePercent: 1 },
      { id: 'roadeng-grade-2', start: 400, end: null, minGradePercent: -8, maxGradePercent: 8 },
    ])
    expect(mapping.verticalStandards?.curvatureRanges).toEqual([
      { id: 'roadeng-k-0', start: null, end: 300, minSagK: 35, minCrestK: 35 },
      { id: 'roadeng-k-1', start: 300, end: 400, minSagK: null, minCrestK: null, linear: true },
      { id: 'roadeng-k-2', start: 400, end: null, minSagK: 20, minCrestK: 15 },
    ])
    expect(mapping.verticalControls).toEqual([
      {
        id: 'roadeng-ctl-1-0',
        chainage: 0,
        elevation: 309.7,
        toleranceAboveM: 0.5,
        toleranceBelowM: 0.5,
        gradePercent: 0,
        gradeTolerancePercent: 4,
      },
      {
        id: 'roadeng-ctl-1-1',
        chainage: 800,
        elevation: 319.7,
        toleranceAboveM: 0,
        toleranceBelowM: 0,
        gradePercent: null,
        gradeTolerancePercent: 0,
      },
    ])
    expect(mapping.activeVerticalAlternativeId).toBe('roadeng-valign-1')
    const [stored, active] = mapping.verticalAlternatives!
    expect(active).toMatchObject({ name: 'opt 3', vertical: road().vertical })
    // The stored profile runs from 5 m before the road to 50 m short of its end, on its own grades.
    expect(stored.name).toBe('V-align 1')
    expect(stored.vertical.map((p) => [p.chainage, p.elevation])).toEqual([
      [0, Math.round((575 - (5 * 5) / 405 - 0.3) * 1000) / 1000],
      [400, 569.7],
      [950, 565.7],
      [1000, Math.round((570 - (4 * 600) / 550 - 0.3) * 1000) / 1000],
    ])
    // Its first control lies before the road; the second checks elevation only (flags 33).
    expect(stored.verticalControls).toEqual([
      expect.objectContaining({ id: 'roadeng-ctl-0-1', chainage: 500, elevation: 568.2, gradePercent: null }),
    ])
    expect(mapping.unmapped.join('\n')).toMatch(/V-align 1: the control point at station 95\.000 m is off the road/)
    expect(mapping.unmapped.join('\n')).toMatch(/opt 4 stores no profile/)
    expect(mapping.notes.join('\n')).toMatch(
      /it is cut at the road's start, and its last grade is carried on to the road's end/,
    )
  })

  it('reads a foot design in metres', () => {
    const feet = DSN.replace('units=10000', 'units=3048')
    const frame = { startStationM: 100 * 0.3048, endStationM: 1100 * 0.3048, unitM: 0.3048 }
    const mapping = roadEngOptimizerFor(parseRoadEngOptimizer(feet, 0.3048), { ...frame, activeVertical: [] })
    expect(mapping.verticalStandards?.curvatureRanges?.[2]).toMatchObject({ minSagK: 6.096, minCrestK: 4.572 })
    expect(mapping.verticalStandards?.gradeRanges[1]).toMatchObject({ start: 91.44, end: 121.92 })
    expect(mapping.verticalControls?.[1]).toMatchObject({ chainage: 243.84, elevation: 97.536 })
    const read = imported(feet, road(), frame)
    const edited = {
      ...read,
      verticalControls: read.verticalControls!.map((c, k) => (k === 1 ? { ...c, elevation: 100 } : c)),
    }
    const out = written(edited, feet, frame)
    expect(out).toContain(
      `OptParms_CtrlPnt-1=900,${(100 / 0.3048).toFixed(6).replace(/0+$/, '')},0,-9999,-9999,1,bridge deck,0`,
    )
    expect(content(imported(out, road(), frame))).toEqual(content(edited))
  })

  it('gives the project parser a road it accepts', () => {
    const alignment = imported()
    const loaded = parseProject(JSON.parse(serializeProject(projectFor(alignment)))).alignments[0]
    expect(loaded.verticalAlternatives?.map((v) => v.name)).toEqual(['V-align 1', 'opt 3'])
    expect(loaded.activeVerticalAlternativeId).toBe('roadeng-valign-1')
    expect(content(loaded)).toEqual(content(alignment))
  })

  it('writes an untouched design back unchanged', () => {
    expect(roadEngOptimizerOverrides(imported(), FRAME, DSN).overrides).toEqual({})
    expect(written(imported(), DSN)).toBe(DSN)
  })

  it('leaves a minimum elevation out of the design and names it, since RoadEng has no field for one', () => {
    const base = imported()
    const alignment = {
      ...base,
      verticalControls: [
        ...(base.verticalControls ?? []),
        {
          id: 'minimum',
          chainage: 400,
          elevation: 305.25,
          toleranceAboveM: 0,
          toleranceBelowM: 0,
          gradePercent: null,
          gradeTolerancePercent: 0,
          bound: 'minimum' as const,
          crossing: { id: 'mapped:creek', name: 'Willow Creek' },
        },
      ],
    }
    const { overrides, notes } = roadEngOptimizerOverrides(alignment, FRAME, DSN)
    // Nothing else changed, so nothing is written: the minimum does not reach the control points.
    expect(overrides).toEqual({})
    expect(written(alignment, DSN)).toBe(DSN)
    expect(notes).toEqual([
      "The minimum elevation of 305.25 m at Willow Creek (0+400.0) on the vertical alignment opt 3 is not written: RoadEng's control points hold a level with one tolerance either side and have no field for a minimum.",
    ])
  })

  it('writes edits back, keeping what PGMaps does not model, and reads them as written', () => {
    let alignment = imported()
    alignment = {
      ...alignment,
      verticalStandards: {
        ...alignment.verticalStandards!,
        gradeRanges: alignment.verticalStandards!.gradeRanges.map((r) =>
          r.id === 'roadeng-grade-2' ? { ...r, start: 450, maxGradePercent: 10 } : r,
        ),
        minSagK: 25,
      },
      verticalControls: [
        { ...alignment.verticalControls![0], toleranceAboveM: 1, toleranceBelowM: 0.2 },
        {
          id: 'new',
          chainage: 650,
          elevation: null,
          toleranceAboveM: 0,
          toleranceBelowM: 0,
          gradePercent: -3,
          gradeTolerancePercent: 0.5,
        },
      ],
    }
    const dsn = written(alignment, DSN)
    // Kept: pits, haul, cost solutions, regularization, the horizontal optimizer, flag bits, text.
    for (const line of [
      'OptParms_Pit-0=3224.87074544,0,12,0,3200,1, ,OB,1,0,567.291133,0',
      'OptParmsRegularization=0,0,0',
      'OptParmsDesc=entire alignment',
      'DlgHorOptParameters=-9999,-9999,-9999,0,0,0,-9999,0,0.1,10,0,0,0,0,5',
      'OptParms_CtrlPnt-1=600,568.5,0,-9999,-9999,33, ,0',
      'OptParmsVIP-002=1050,566,0',
      'OptCostSpacing=-0.1,2275,458751',
    ])
      expect(dsn).toContain(line)
    // The unequal band is written centred; the removed control goes.
    expect(dsn).toContain('OptParms_CtrlPnt-0=100,310.4,0.6,0,4,9, ,0')
    expect(dsn).toContain('OptParms_CtrlPnt-1=750,-9999,-9999,-3,0.5,8, ,0')
    expect(dsn).not.toContain('bridge deck')
    expect(dsn).toContain('OptParms_Constraintv7-1=-1,1,Linear,500')
    const again = imported(dsn)
    // RoadEng keeps one tolerance: the same band, centred on its target.
    const centred = { ...alignment.verticalControls![0], elevation: 310.1, toleranceAboveM: 0.6, toleranceBelowM: 0.6 }
    expect(content(again)).toEqual(
      content({ ...alignment, verticalControls: [centred, alignment.verticalControls![1]] }),
    )
    // Read → write → read again changes nothing.
    expect(roadEngOptimizerOverrides(again, FRAME, dsn).overrides).toEqual({})
  })

  it('renames, adds, removes and switches vertical alignments', () => {
    let alignment = imported()
    alignment = addVerticalAlternative(alignment, 'steeper', 'Steeper, PGMaps')
    alignment = {
      ...alignment,
      vertical: alignment.vertical.map((p) => (p.id === 'm' ? { ...p, elevation: p.elevation + 2 } : p)),
    }
    alignment = activateVerticalAlternative(alignment, 'roadeng-valign-0')
    alignment = removeVerticalAlternative(alignment, 'roadeng-valign-1')
    alignment = {
      ...alignment,
      verticalAlternatives: alignment.verticalAlternatives!.map((v) =>
        v.id === 'roadeng-valign-0' ? { ...v, name: 'Field line' } : v,
      ),
    }
    const dsn = written(alignment, DSN)
    // V-align 1 is now the active one: its stored profile moves to the `.ds2`.
    expect(dsn).not.toContain('OptParmsVIP-000=95,575,0')
    expect(dsn).toContain('nOptCostParameters=3,0')
    expect(dsn).toMatch(/OptParmsNew=[^\r\n]*,Field line,1,0,-9999,1/)
    // opt 3 is gone, so the alignments that named it as their reference name the active one.
    expect(dsn).not.toMatch(/OptParmsRefAlign=opt 3/)
    expect(dsn).toContain('OptParmsRefAlign=Field line,Field line,Ground')
    // opt 4, never read, moves down; the new one comes last, from the design's active alignment.
    const sections = [...dsn.matchAll(/^\[(OptAlignCost-\d)\]/gm)].map((m) => m[1])
    expect(sections).toEqual(['OptAlignCost-0', 'OptAlignCost-1', 'OptAlignCost-2'])
    expect(dsn).toMatch(/\[OptAlignCost-1\][^[]*opt 4/)
    expect(dsn).toMatch(/\[OptAlignCost-2\][^[]*Steeper {2}PGMaps[^[]*OptParmsVIP-002/)
    expect(dsn).not.toContain('OptParms_CostSolution_v3=2,0,0,0,1000')
    const again = imported(dsn, { ...road(), vertical: alignment.vertical })
    expect(again.verticalAlternatives?.map((v) => v.name)).toEqual(['Field line', 'Steeper  PGMaps'])
    const named = content({
      ...alignment,
      verticalAlternatives: alignment.verticalAlternatives!.map((v) =>
        v.id === 'steeper' ? { ...v, name: 'Steeper  PGMaps' } : v,
      ),
    })
    expect(content(again)).toEqual(named)
    expect(roadEngOptimizerOverrides(again, FRAME, dsn).overrides).toEqual({})
  })

  it('writes a PGMaps road with no RoadEng original whole, and reads it back', () => {
    let alignment: Alignment = {
      ...road(),
      verticalStandards: {
        gradeRanges: [
          { id: 'g', start: null, end: null, minGradePercent: -12, maxGradePercent: 10 },
          { id: 'b', start: 200, end: 260, minGradePercent: null, maxGradePercent: 2 },
        ],
        minSagK: 8,
        minCrestK: 6,
        minCurveLengthM: null,
        minTangentLengthM: null,
        curvatureRanges: [{ id: 'l', start: 200, end: 260, minSagK: null, minCrestK: null, linear: true }],
      },
      verticalControls: [
        {
          id: 'c',
          chainage: 120,
          elevation: 311,
          toleranceAboveM: 0.25,
          toleranceBelowM: 0.25,
          gradePercent: null,
          gradeTolerancePercent: 0,
        },
      ],
    }
    expect(written(road())).toBe('[design]\r\nunits=10000\r\n')
    const single = written(alignment)
    expect(single).toContain('nOptCostParameters=1,0')
    expect(single).toContain('OptParms_Constraintv7-1=-12,2,Linear,360')
    expect(content(imported(single))).toEqual(content(alignment))
    alignment = addVerticalAlternative(alignment, 'alt', 'Lower')
    alignment = { ...alignment, vertical: alignment.vertical.map((p) => ({ ...p, elevation: p.elevation - 1 })) }
    const dsn = written(alignment)
    const again = imported(dsn, { ...road(), vertical: alignment.vertical })
    expect(content(again)).toEqual(content(alignment))
    expect(
      parseProject(JSON.parse(serializeProject(projectFor(again)))).alignments[0].verticalAlternatives,
    ).toHaveLength(2)
  })

  it('applies overrides in place, adding keys in order and dropping emptied sections', () => {
    const text = '[a]\r\nk1=1\r\nk3=3\r\n[b]\r\nx=1\r\n'
    expect(mergeRoadEngIni(text, { a: { k2: '2', k3: null }, b: { x: null }, c: { y: '1' } })).toBe(
      '[a]\r\nk1=1\r\nk2=2\r\n[c]\r\ny=1\r\n',
    )
  })
})

// Softree's published sample projects (support.softree.com), read from a local copy and never
// committed: set ROADENG_SAMPLES to the folder holding the extracted archives.
const samples = process.env.ROADENG_SAMPLES
const DESIGNS = [
  'LongRoad_1/LongRoad 1.dsnx',
  'Cul-de-sac-design/CulDeSacExample/CulDeSacExample.dsnx',
  'Cul-de-sac-design/CulDeSacExample/CulDeSacExampleComplete.dsnx',
  'RoadEng-LandXML-Civil-3D/Align stage 1.dsnx',
]
function sampleRoads(path: string) {
  const bytes = new Uint8Array(readFileSync(join(samples!, path)))
  const design = parseRoadEngDesign(bytes)
  const offset = localPlaneOffset(design.alignments.flatMap((a) => [a.stations[0].xy, ...a.pis.map((p) => p.xy)]))
  let n = 0
  const { roads } = roadEngRoads(bytes, {
    fileName: path.split('/').pop()!,
    newId: () => `road-${n++}`,
    color: () => '#123456',
    template: { ...DEFAULT_TEMPLATE },
    placement: { epsg: LOCAL_PLANE_EPSG, toLonLat: localPlaneProjection(offset).toLonLat },
  })
  const files = unzipSync(bytes, { filter: (f) => /\.dsn$/i.test(f.name) })
  return roads.map((road) => {
    const dsn = strFromU8(files[`${road.source.part}.dsn`], true)
    const frame: RoadEngOptimizerFrame = {
      startStationM: road.source.startStation,
      endStationM: road.source.endStation,
      stationScale: road.stationScale,
      unitM: design.unitM,
    }
    const mapping = roadEngOptimizerFor(parseRoadEngOptimizer(dsn, design.unitM), {
      ...frame,
      activeVertical: road.alignment.vertical,
    })
    return { road, dsn, frame, mapping, alignment: applyRoadEngOptimizer(road.alignment, mapping) }
  })
}

describe.skipIf(!samples || !existsSync(samples ?? ''))('Softree sample designs', { timeout: 60_000 }, () => {
  it("reads LongRoad's bridge ranges as straight ±1 % grades", () => {
    const [{ mapping, road }] = sampleRoads(DESIGNS[0])
    const s = road.stationScale
    expect(mapping.verticalAlternatives).toBeUndefined()
    const linear = mapping.verticalStandards!.curvatureRanges!.filter((r) => r.linear)
    expect(linear.map((r) => [r.start! / s, r.end! / s])).toEqual([
      [expect.closeTo(18838, 2), expect.closeTo(18943, 2)],
      [expect.closeTo(27657, 2), expect.closeTo(27679, 2)],
    ])
    expect(mapping.verticalStandards!.gradeRanges.filter((r) => r.maxGradePercent === 1)).toHaveLength(2)
    expect(mapping.verticalControls).toEqual([
      expect.objectContaining({ chainage: 0, elevation: 310, gradePercent: 0 }),
    ])
  })

  it("reads the cul-de-sac's two vertical alignments, opt 3 active", () => {
    for (const path of DESIGNS.slice(1, 3)) {
      const [main] = sampleRoads(path)
      expect(main.mapping.verticalAlternatives?.map((v) => v.name)).toEqual(['V-align 1', 'opt 3'])
      expect(main.mapping.activeVerticalAlternativeId).toBe('roadeng-valign-1')
      expect(main.mapping.verticalStandards?.curvatureRanges).toEqual([
        { id: 'roadeng-k-0', start: null, end: null, minSagK: 20, minCrestK: 15 },
      ])
    }
  })

  it('opens every design in the project parser and writes it back unchanged, then edited', () => {
    for (const path of DESIGNS)
      for (const { dsn, frame, alignment } of sampleRoads(path)) {
        const loaded = parseProject(JSON.parse(serializeProject(projectFor(alignment)))).alignments[0]
        expect(content(loaded)).toEqual(content(alignment))
        expect(roadEngOptimizerOverrides(loaded, frame, dsn).overrides).toEqual({})
        const length = (frame.endStationM - frame.startStationM) * (frame.stationScale ?? 1)
        const edited: Alignment = {
          ...loaded,
          verticalStandards: {
            gradeRanges: [{ id: 'g', start: length / 3, end: null, minGradePercent: -6, maxGradePercent: 9 }],
            minSagK: 12,
            minCrestK: null,
            minCurveLengthM: null,
            minTangentLengthM: null,
          },
        }
        const out = written(edited, dsn, frame)
        const again = applyRoadEngOptimizer(
          { ...loaded, verticalStandards: undefined },
          roadEngOptimizerFor(parseRoadEngOptimizer(out, frame.unitM), { ...frame, activeVertical: loaded.vertical }),
        )
        expect(limits(again.verticalStandards, length)).toEqual(limits(edited.verticalStandards, length))
        // The lengths cleared in PGMaps are cleared in RoadEng too.
        expect(again.verticalStandards).toMatchObject({ minCurveLengthM: null, minTangentLengthM: null })
        expect(roadEngOptimizerOverrides(again, frame, out).overrides).toEqual({})
      }
  })

  it("reads each alignment's minimum curve and tangent lengths as its curve type uses them", () => {
    const [long] = sampleRoads(DESIGNS[0])
    // Curves and tangents [Slow]: RoadEng holds one length for both.
    expect(long.mapping.verticalStandards).toMatchObject({ minCurveLengthM: 100, minTangentLengthM: 100 })
    for (const path of DESIGNS.slice(1, 3)) {
      const [main] = sampleRoads(path)
      // Variable curves and tangents [Slowest]: each its own.
      expect(
        main.mapping.verticalAlternatives!.map((v) => [
          v.name,
          v.verticalStandards?.minCurveLengthM,
          v.verticalStandards?.minTangentLengthM,
        ]),
      ).toEqual([
        ['V-align 1', 80, 10],
        ['opt 3', 80, 200],
      ])
    }
  })
})

describe('minimum vertical curve and tangent lengths', () => {
  const withNew = (fields: Record<number, string>) => {
    const f = NEW.split(',')
    for (const [k, v] of Object.entries(fields)) f[Number(k)] = v
    return DSN.split(`OptParmsNew=${NEW},`).join(`OptParmsNew=${f.join(',')},`)
  }

  it('reads them as each curve type uses them', () => {
    const lengths = (curveType: number, curve: number, tangent: number) =>
      roadEngMinLengths({ curveType, storedMinCurveM: curve, storedMinTangentM: tangent })
    expect(lengths(20, 50, 30)).toEqual({ minCurveLengthM: null, minTangentLengthM: 30 })
    expect(lengths(21, 50, 30)).toEqual({ minCurveLengthM: 50, minTangentLengthM: null })
    expect(lengths(22, 50, 50)).toEqual({ minCurveLengthM: 50, minTangentLengthM: 50 })
    expect(lengths(23, 80, 10)).toEqual({ minCurveLengthM: 80, minTangentLengthM: 10 })
    expect(lengths(23, 0, 0)).toEqual({ minCurveLengthM: null, minTangentLengthM: null })
    expect(lengths(24, 80, 10)).toEqual({ minCurveLengthM: null, minTangentLengthM: null })
    // Feet: stored in project units.
    const feet = parseRoadEngOptimizer(withNew({ 3: '100', 28: '50' }), 0.3048)
    expect(roadEngMinLengths(feet.options[1])).toEqual({ minCurveLengthM: 30.48, minTangentLengthM: 15.24 })
    // On the road: the active alignment's standards, and each alternative's own.
    const road = imported()
    expect(road.verticalAlternatives!.find((a) => a.name === 'opt 3')!.verticalStandards).toMatchObject({
      minCurveLengthM: 80,
      minTangentLengthM: 10,
    })
  })

  it('keeps the curve type that holds the lengths, and changes it only when it cannot', () => {
    expect(roadEngCurveTypeFor(23, 80, 10)).toBe(23)
    expect(roadEngCurveTypeFor(22, 60, 60)).toBe(22)
    expect(roadEngCurveTypeFor(22, 60, 30)).toBe(23)
    expect(roadEngCurveTypeFor(22, 60, null)).toBe(21)
    expect(roadEngCurveTypeFor(21, 60, null)).toBe(21)
    expect(roadEngCurveTypeFor(21, 60, 60)).toBe(22)
    expect(roadEngCurveTypeFor(20, null, 40)).toBe(20)
    expect(roadEngCurveTypeFor(21, null, 40)).toBe(23)
    expect(roadEngCurveTypeFor(23, null, null)).toBe(21)
    expect(roadEngCurveTypeFor(null, 50, null)).toBe(21)
  })

  it('writes an edit into the fields read, the curve type with it, and reads back the same', () => {
    const base = imported()
    expect(roadEngOptimizerOverrides(base, FRAME, DSN).overrides).toEqual({})
    // opt 3 is the active alignment: its standards are the road's own.
    const edit = (minCurveLengthM: number | null, minTangentLengthM: number | null): Alignment => ({
      ...base,
      verticalStandards: { ...base.verticalStandards!, minCurveLengthM, minTangentLengthM },
    })
    const field = (dsn: string, section: string, k: number) =>
      new RegExp(`\\[${section}\\][^[]*?OptParmsNew=([^\\r\\n]*)`).exec(dsn)![1].split(',')[k]
    // Variable holds unequal lengths: only fields 3 and 28 change.
    const unequal = written(edit(120, 40), DSN)
    expect([3, 11, 28].map((k) => field(unequal, 'OptAlignCost-1', k))).toEqual(['120', '23', '40'])
    const { notes } = roadEngOptimizerOverrides(edit(120, 40), FRAME, DSN)
    expect(notes.join(' ')).not.toMatch(/curve type/)
    // A curve length alone needs Curves [Fast], and the notice says so.
    const curveOnly = roadEngOptimizerOverrides(edit(60, null), FRAME, DSN)
    const curveText = mergeRoadEngIni(DSN, curveOnly.overrides)
    expect([3, 11, 28].map((k) => field(curveText, 'OptAlignCost-1', k))).toEqual(['60', '21', '0'])
    expect(curveOnly.notes).toContain(
      "opt 3: RoadEng's curve type is now Curves [Fast], in place of Variable curves and tangents [Slowest], the one that holds a minimum curve length alone.",
    )
    // Every other field of the line, and the other alignments, stay as read.
    const before = /\[OptAlignCost-1\][^[]*?OptParmsNew=([^\r\n]*)/.exec(DSN)![1].split(',')
    const after = /\[OptAlignCost-1\][^[]*?OptParmsNew=([^\r\n]*)/.exec(curveText)![1].split(',')
    expect(after.flatMap((v, k) => (v === before[k] ? [] : [k]))).toEqual([3, 11, 28])
    expect(Object.keys(curveOnly.overrides)).toEqual(['OptAlignCost-1'])
    // Read back: the same lengths, and nothing more to write.
    for (const [curve, tangent] of [
      [120, 40],
      [60, null],
      [75, 75],
    ] as const) {
      const out = written(edit(curve, tangent), DSN)
      const again = imported(out)
      const opt3 = again.verticalAlternatives!.find((v) => v.name === 'opt 3')!.verticalStandards!
      expect([opt3.minCurveLengthM, opt3.minTangentLengthM]).toEqual([curve, tangent])
      expect(roadEngOptimizerOverrides(again, FRAME, out).overrides).toEqual({})
    }
  })

  it('writes them on a road with no RoadEng original, on the default curve type', () => {
    const fresh: Alignment = {
      ...road(),
      verticalStandards: {
        gradeRanges: [],
        minSagK: null,
        minCrestK: null,
        minCurveLengthM: 50,
        minTangentLengthM: 30,
      },
    }
    const out = written(fresh)
    const read = parseRoadEngOptimizer(out)
    expect(read.options[0]).toMatchObject({ curveType: 23, storedMinCurveM: 50, storedMinTangentM: 30 })
    expect(imported(out, road()).verticalStandards).toMatchObject({ minCurveLengthM: 50, minTangentLengthM: 30 })
  })
})
