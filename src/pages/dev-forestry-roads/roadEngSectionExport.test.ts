import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { horizontalCurveFits, offsetCoordinate } from './engine'
import { parseEngineering } from './engineeringProject'
import { evaluateCurveCriteria } from './roadCriteria'
import {
  parseRoadEngSettings,
  parseRoadEngTbl,
  readRoadEngSettings,
  roadEngCurveDesignFor,
  roadEngEngineeringFor,
  roadEngFittedCurveDesignFor,
  roadEngTemplateFor,
  roadEngWideningRows,
  withRoadEngCurveSettings,
  type RoadEngSuperelevationTable,
} from './roadEngDesignSettings'
import { roadEngCurvesByPoint, roadEngRoads } from './roadEngImport'
import { mergeRoadEngIni } from './roadEngExport'
import {
  evaluateRoadEngFormula,
  mergeRoadEngOverrides,
  roadEngCurveChanges,
  roadEngCurveFromRule,
  roadEngCurveFromTables,
  roadEngCurveInputs,
  roadEngNumber,
  roadEngSectionOverrides,
  roadEngTableKeys,
  roadEngWideningTableFrom,
  superelevationTableFor,
  writeRoadEngTbl,
  type RoadEngOriginal,
} from './roadEngSectionExport'
import { DEFAULT_TEMPLATE } from './terrain'
import { validateEngineering, validateTemplate } from './templates'
import type { Alignment, AlignmentEngineering, Coordinate, CurveDesign, RoadTemplate } from './types'

// A synthetic design laid out as RoadEng 11 writes its `[TemplatesSct]` (see
// `roadEngDesignSettings.test.ts`): a gravel road (PGR) whose ditch backslope runs 2 m above the road
// edge, the same road with a rock bench (RCK), and station ranges using both.
type Param = [name: string, flags: number, value: number, formula?: string]
function component(t: number, c: number, head: string, side: 'left' | 'right', params: Param[]) {
  const lines = [`T${t}-C${c}=${head}`, `T${t}-C${c}-F0=1,SGL,Fragment,${131072 + (side === 'left' ? 1 : 0)},1,0,0,-`]
  params.forEach(([name, flags, value, formula = ''], u) => {
    lines.push(`T${t}-C${c}-U${u}=${name}~${name} description, with a comma.|${flags}|${value}|-1|0|1000|`)
    lines.push(`T${t}-C${c}-U${u}-1=${formula}`)
    lines.push(`T${t}-C${c}-U${u}-2=~|~|0`)
  })
  return lines
}
const rural: Param[] = [
  ['AcpThick', 0, 0],
  ['AcpWidth', 256, 4.2],
  ['BaseThick', 0, 0.15],
  ['SubbaseThick', 0, 0.35],
  ['ShoulderGravWidth', 0, 0.5],
  ['_SUPER', 37, -0.04],
  ['ROAD_WIDTH', 0, 4.7, 'AcpWidth+ShoulderGravWidth'],
  ['SG_DEPTH', 0, 0.5, 'AcpThick + BaseThick + SubbaseThick'],
]
const ditch: Param[] = [
  ['DitchProbeDepth', 0, 99],
  ['bDitchInclude', 0, 1],
  ['DitchDepth', 0, 0.6],
  ['DitchInSlp', 1, 0.25],
  ['DitchBotWd', 0, 1],
  ['DitchBackSlpHt', 0, 2.6],
  ['DitchBackSlp', 1, 0.333333333333],
]
const slope: Param[] = [
  ['FinalCutSlp', 1, 0.5],
  ['FinalFillSlp', 1, 0.666667],
  ['bApplyInCut', 0, 1],
  ['bApplyInFill', 0, 1],
]
const bench: Param[] = [
  ['Subsurface', 192, 0],
  ['SlopeBelowSubsurf', 1, 4],
  ['BenchWidth', 0, 2],
  ['BenchSlope', 1, 0],
  ['FinalCutSlp', 1, 1],
]
const RURAL = '4,RDWY,Rural I!^!Up to three layer template~ with shoulders.,8,0,146'
const DITCH = '3,DTCHS,Ditch I Standard!^!Conditionally creates a ditch.,7,0,145'
const SLOPE = '2,SLPS,Slope I - Standard Cut/Fill!^!Standard closing slopes.,4,0,145'
const BENCH = '2,SLPS,Slope VII - Bench at Subsurface.,5,0,145'
const tables = [
  'RoadOptions=111,16.6666666667,0.31,2.5,2,3,0.09,1000,1000,50,0.1,-0.1,forest two lane,0.06,1,0,100',
  'CurveHorizontal=108,,2,-340,0,0,0,-1,16.6666666667,5585,0.06,0.1,40,40,0.667,0.06,0.0880563532089,0,0,0',
  'LTable-00-Desc-00= Superelevation table, radius in meters, speed in km/hr, Emax = 0.06',
  'LTable-00-Desc-01=#',
  'LTable-00-Options=0',
  'LTable-00-Row-000=,40,60',
  'LTable-00-Row-001=400,0.02,0.04',
  'LTable-00-Row-002=200,0.03,0.05',
  'LTable-00-Row-003=100,0.04,',
  'LTable-02-Desc-00= Superelevation Runoff table',
  'LTable-02-Options=0',
  'LTable-02-Row-000=,40,60',
  'LTable-02-Row-001=400,30,40',
  'LTable-02-Row-002=200,30,40',
  'LTable-02-Row-003=100,30,',
  'LTable-03-Desc-00=Widening Table - meters',
  'LTable-03-Options=0',
  'LTable-03-Row-000=,0,20,40,60,80,180',
  'LTable-03-Row-001=30,0,0.5,1,1.5,2,3',
  'LTable-03-Row-002=80,0,0,0,0,0.5,1',
  'LTable-03-Row-003=20000,0,0,0,0,0,0',
]
function designDsn(ranges = [range(100, 'PGR'), range(200, 'RCK', 'RCK', '-0.5', 'SR'), range(999999999, 'PGR')]) {
  return [
    '[design]',
    'units=10000',
    '[LocationParms]',
    ...ranges.map((r, k) => `${k}=${r}`),
    `nparams=${ranges.length}`,
    '[TemplatesSct]',
    ...tables,
    'T0=1,FF1,Roadway Components,-0.02,-0.02,1,2,2,2',
    ...component(0, 0, RURAL, 'left', rural),
    'T1=6,PGR,Pioneer Gravel Road,-0.04,-0.04,1,0,2,2',
    'T1-V=11,11,11.0.673.0,11.0.0.0',
    ...component(1, 0, RURAL, 'left', rural),
    ...component(1, 1, RURAL, 'right', rural),
    ...component(1, 2, DITCH, 'left', ditch),
    ...component(1, 3, DITCH, 'right', ditch),
    ...component(1, 4, SLOPE, 'left', slope),
    ...component(1, 5, SLOPE, 'right', slope),
    'T2=6,RCK,Gravel Road w~ Rockcut,-0.04,-0.04,1,0,2,2',
    ...component(2, 0, RURAL, 'left', rural),
    ...component(2, 1, RURAL, 'right', rural),
    ...component(2, 2, BENCH, 'left', bench),
    ...component(2, 3, BENCH, 'right', bench),
    ...component(2, 4, SLOPE, 'left', slope),
    ...component(2, 5, SLOPE, 'right', slope),
    '[Culvert]',
    'size=0',
    '',
  ].join('\r\n')
}
function range(end: number, left: string, right = left, depth = '999999', below = '-') {
  return `${end},0,0,0,0,0,0,0,0,0,-,*1,${depth},${below},999999,-,OB,${left},${right},RE,RE,0,0,-1,-1,0,0,0,0,RE,RE,9999,999999000,1`
}
// Curves at 60 km/h following e = V²/(127 R) − 0.12 at e max 0.06, each widened as the table
// (stepped) gives at its deflection.
const v = 60 / 3.6
const pi = (index: number, signedRadius: number, x: number, y: number, widening: number) => {
  const radius = Math.abs(signedRadius)
  const e = Math.min(0.06, (60 * 60) / (127 * radius) - 0.12)
  return `108,${index},2,${signedRadius},${x},${y},0,-1,${v},5585,0.06,0.1,40,40,0.667,${e},${(v * v) / (9.81 * radius) - e},${widening},${widening},0`
}
const ds2 = [
  '100,103,11,11.0.673.0, Softree Technical Systems Inc. - Location Line data file',
  '104,OB,Overburden (Default),100,400,1,1.25,12,4,0,8,0.6,4,2.6,2,0,0,0,0,',
  '104,SR,Solid Rock,100,400,1,0.8,48,4,0,8,0.6,4,2.6,2,3,0,0,0,',
  pi(1, 200, 100, 0, 0),
  pi(2, -60, 200, 100, 1),
  '110,5,0,0,900,0,-1,0,0,,,256',
  '110,5,300,100,900,400,-1,0,0,,,256',
].join('\r\n')
const fallback: RoadTemplate = { ...DEFAULT_TEMPLATE }
const original = (dsnText = designDsn(), extra: Partial<RoadEngOriginal> = {}): RoadEngOriginal => ({
  dsnText,
  ds2Text: ds2,
  unitM: 1,
  startStation: 0,
  endStation: 400,
  fallback,
  ...extra,
})

/** What PGMaps holds after importing `o`. */
function imported(o: RoadEngOriginal) {
  const settings = parseRoadEngSettings(o.dsnText, o.ds2Text, o.unitM, {
    ...(o.projectDsnText !== undefined ? { projectDsnText: o.projectDsnText } : {}),
  })
  const mapped = roadEngEngineeringFor(settings, {
    startStation: o.startStation,
    endStation: o.endStation,
    ...(o.stationScale !== undefined ? { stationScale: o.stationScale } : {}),
    fallback: o.fallback,
    ...o.templateOptions,
  })
  return {
    settings,
    road: {
      name: 'Road',
      template: mapped.template!,
      engineering: mapped.engineering,
      ...(mapped.curveDesign ? { curveDesign: mapped.curveDesign } : {}),
    },
  }
}
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

/** Write `road` back into `o`, read the result again, and return what PGMaps then holds. */
function roundTrip(road: ReturnType<typeof imported>['road'], o: RoadEngOriginal) {
  const out = roadEngSectionOverrides(road, o)
  const { overrides } = mergeRoadEngOverrides(out.templates, out.alignment)
  const written = mergeRoadEngIni(o.dsnText, overrides)
  return { out, again: imported({ ...o, dsnText: written }), written }
}

function expectValid(template: RoadTemplate, engineering: AlignmentEngineering, curveDesign?: CurveDesign) {
  validateTemplate(template)
  validateEngineering(engineering)
  const asParsed = (raw: unknown) => {
    validateTemplate(raw as RoadTemplate)
    return raw as RoadTemplate
  }
  expect(parseEngineering(clone(engineering), asParsed)).toEqual(engineering)
  if (curveDesign) evaluateCurveCriteria(curveDesign, 100, 30)
}

describe('numbers, formulas and tables', () => {
  it('writes numbers as RoadEng does', () => {
    expect(roadEngNumber(0.333333333333333)).toBe('0.333333333333')
    expect(roadEngNumber(22.22222222222222)).toBe('22.2222222222')
    expect(roadEngNumber(-0)).toBe('0')
    expect(roadEngNumber(1e-20)).toBe('0')
    expect(roadEngNumber(999999999)).toBe('999999999')
  })
  it('evaluates RoadEng formulas and leaves what it cannot read to RoadEng', () => {
    const values = new Map([
      ['ACPWIDTH', 4.2],
      ['SHOULDERGRAVWIDTH', 0.5],
      ['_SUPER', -0.04],
      ['BSHOULDERPAVESUPER', 0],
    ])
    expect(evaluateRoadEngFormula('AcpWidth+ShoulderGravWidth', values)).toBeCloseTo(4.7, 12)
    expect(evaluateRoadEngFormula('_SUPER * (bShoulderPaveSuper > 0) + 2 - _SUPER', values)).toBeCloseTo(2.04, 12)
    expect(evaluateRoadEngFormula('-(AcpWidth - 1) / 2', values)).toBeCloseTo(-1.6, 12)
    expect(evaluateRoadEngFormula('max(AcpWidth, 2)', values)).toBeCloseTo(4.2, 12)
    expect(evaluateRoadEngFormula('_FRAG_DY + 1', values)).toBeNull()
    expect(evaluateRoadEngFormula('Unknown + 1', values)).toBeNull()
    expect(evaluateRoadEngFormula('AcpWidth +', values)).toBeNull()
  })
  it('writes a .tbl that reads back the same', () => {
    const table: RoadEngSuperelevationTable = {
      index: 0,
      description: [' Superelevation table, radius in meters, speed in km/hr, Emax = 0.06', '#'],
      speeds: [40, 50, 60],
      rows: [
        { radius: 200, e: [0.036, 0.045, 0.053] },
        { radius: 190, e: [0.037, 0.046, null] },
      ],
    }
    const text = writeRoadEngTbl(table)
    expect(text.split('\r\n').slice(0, 4)).toEqual([
      '# Superelevation table, radius in meters, speed in km/hr, Emax = 0.06',
      '#',
      ',40,50,60',
      '200,0.036,0.045,0.053',
    ])
    expect(parseRoadEngTbl(text)).toEqual(table)
  })
  it('writes a table as design keys that the settings reader reads back', () => {
    const settings = parseRoadEngSettings(designDsn(), ds2, 1)
    for (const table of settings.superelevationTables) {
      const keys = roadEngTableKeys(table)
      const text = ['[TemplatesSct]', ...Object.entries(keys).map(([k, v]) => `${k}=${v}`)].join('\r\n')
      expect(parseRoadEngSettings(text, '', 1).superelevationTables).toEqual([table])
    }
  })
  it('gives back the RoadEng widening table PGMaps’ stepped table was made from', () => {
    const settings = parseRoadEngSettings(designDsn(), ds2, 1)
    const table = settings.superelevationTables.find((t) => t.index === 3)!
    const rows = roadEngWideningRows(table, 1)!.rows
    const back = roadEngWideningTableFrom(rows, 1, table.description)
    expect(back.stepped).toBe(true)
    // The 20,000 m row is held at PGMaps' 10,000 m.
    expect(back.table).toEqual({
      ...table,
      rows: table.rows.map((r) => (r.radius === 20000 ? { ...r, radius: 10000 } : r)),
    })
    const plain = roadEngWideningTableFrom(
      [
        { radiusM: 50, deflectionDegrees: 0, insideM: 0, outsideM: 0 },
        { radiusM: 50, deflectionDegrees: 90, insideM: 1, outsideM: 0.5 },
        { radiusM: 100, deflectionDegrees: 0, insideM: 0, outsideM: 0 },
        { radiusM: 100, deflectionDegrees: 90, insideM: 0.5, outsideM: 0.5 },
      ],
      1,
    )
    expect(plain).toMatchObject({ stepped: false, sidesDiffer: true })
    expect(plain.table.rows).toEqual([
      { radius: 50, e: [0, 1] },
      { radius: 100, e: [0, 0.5] },
    ])
  })
  it('writes PGMaps’ superelevation rule as a table, blank where it needs more than e max', () => {
    const grid = parseRoadEngSettings(designDsn(), ds2, 1).superelevationTables[0]
    const t = superelevationTableFor(
      {
        designSpeedKmh: 60,
        maxSuperelevationPercent: 6,
        sideFrictionFactor: 0.12,
        runoffLengthM: 40,
        wideningVehicleLengthM: null,
      },
      grid,
      1,
      1,
    )
    expect(t.rows[0].e).toEqual([0, 0])
    expect(t.rows[2].e[0]).toBeCloseTo(1600 / 12700 - 0.12, 6)
    expect(t.rows[2].e[1]).toBeNull()
  })
})

describe('mergeRoadEngOverrides', () => {
  it('says when two overrides disagree', () => {
    expect(mergeRoadEngOverrides({ a: { x: '1' } }, { a: { x: '2', y: '3' } })).toEqual({
      overrides: { a: { x: '2', y: '3' } },
      conflicts: ['[a] x'],
    })
  })
})

describe('roadEngSectionOverrides', () => {
  const o = original()
  it('writes nothing for a road as it was read', () => {
    const { road } = imported(o)
    const out = roadEngSectionOverrides(clone(road), o)
    expect(out.templates).toEqual({})
    expect(out.alignment).toEqual({})
    expect(out.notWritten).toEqual([])
    expect(out.codes).toEqual({ base: 'PGR', 'roadeng-RCK': 'RCK' })
  })
  it('puts edited widths, crossfall, batters, ditch and courses back into their parameters', () => {
    const { road } = imported(o)
    const edited = clone(road)
    const t = edited.template
    t.leftWidth = 5.5
    t.rightWidth = 5.5
    t.crossfallPercent = 3
    t.fillSlope = 2
    // The cut batter here is the ditch backslope: a 6 m ditch 0.8 m deep with a 2.5:1 backslope has
    // a 3.5:1 inslope.
    t.cutSlope = 2.5
    t.ditchDepth = 0.8
    t.ditchBottomWidth = 1.2
    t.ditchWidth = 6
    t.ditchInslope = 3.5
    t.layers = t.layers!.map((l) => (l.id === 'roadeng-basethick' ? { ...l, depthM: 0.2 } : l))
    const rock = edited.engineering.templates.find((x) => x.id === 'roadeng-RCK')!.template
    rock.rockCut = { cutSlope: 0.5, ledgeWidthM: 3 }
    const { out, again, written } = roundTrip(edited, o)
    expect(out.notWritten).toEqual([])
    expect(again.road.template).toEqual(edited.template)
    expect(again.road.engineering.templates).toEqual(edited.engineering.templates)
    expect(again.road.engineering.assignments).toEqual(edited.engineering.assignments)
    // Formulas follow: the road width and the subgrade depth RoadEng stores.
    expect(written).toMatch(/T1-C0-U6=ROAD_WIDTH~[^|]*\|0\|5.5\|/)
    expect(written).toMatch(/T1-C0-U7=SG_DEPTH~[^|]*\|0\|0.55\|/)
    expect(written).toMatch(/^T1=6,PGR,Pioneer Gravel Road,-0.03,-0.03,1,0,2,2$/m)
    // Untouched lines stay as they were.
    expect(written).toContain('T1-V=11,11,11.0.673.0,11.0.0.0')
    expect(written.split('\r\n').length).toBe(o.dsnText.split('\r\n').length)
    expectValid(again.road.template, again.road.engineering, again.road.curveDesign)
  })
  it('writes moved and one-sided template ranges, keeping each row’s ground layers', () => {
    const { road } = imported(o)
    const edited = clone(road)
    edited.engineering.assignments = [
      { id: 'a', start: 120, end: 180, templateId: 'roadeng-RCK', side: 'both', transitionM: 0 },
      { id: 'b', start: 300, end: 350, templateId: 'roadeng-RCK', side: 'left', transitionM: 5 },
    ]
    const { out, again, written } = roundTrip(edited, o)
    expect(again.road.engineering.assignments.map((a) => [a.start, a.end, a.templateId, a.side])).toEqual([
      [120, 180, 'roadeng-RCK', 'both'],
      [300, 350, 'roadeng-RCK', 'left'],
    ])
    // A transition to the base section, which is the neighbour at both ends, goes as two Taper ranges
    // and reads back as the same section: transitions in and out to the base section.
    expect(out.notWritten).toEqual([])
    expect(again.road.engineering.assignments[1]).toMatchObject({ transitionM: 0, transitionInM: 5, transitionOutM: 5 })
    // The rock layer stays on 100–200, as RoadEng had it.
    const rows = written.split('\r\n').filter((l) => /^\d+=/.test(l))
    expect(
      rows.map((r) =>
        r
          .split(',')
          .filter((_, k) => [0, 12, 13, 17, 18].includes(k))
          .join(' '),
      ),
    ).toEqual([
      '0=100 999999 - PGR PGR',
      '1=120 -0.5 SR PGR PGR',
      '2=180 -0.5 SR RCK RCK',
      '3=200 -0.5 SR PGR PGR',
      '4=300 999999 - PGR PGR',
      '5=305 999999 - TP PGR',
      '6=345 999999 - RCK PGR',
      '7=350 999999 - TP PGR',
      '8=999999999 999999 - PGR PGR',
    ])
    expect(written).toMatch(/^nparams=9$/m)
    const strata = imported({ ...o, dsnText: written }).road.engineering.strata
    expect(strata).toEqual(imported(o).road.engineering.strata)
  })
  it('reads a Taper range as a transition between the ranges either side, and writes it back', () => {
    // PGR, a 20 m Taper into RCK, RCK, a 10 m Taper back to PGR (the base), PGR.
    const tapered = original(
      designDsn([
        range(100, 'PGR'),
        range(120, 'TP'),
        range(190, 'RCK', 'RCK', '-0.5', 'SR'),
        range(200, 'TP', 'TP', '-0.5', 'SR'),
        range(999999999, 'PGR'),
      ]),
    )
    const { road } = imported(tapered)
    expect(road.engineering.assignments).toEqual([
      {
        id: 'roadeng-range-1',
        start: 100,
        end: 200,
        templateId: 'roadeng-RCK',
        side: 'both',
        transitionM: 0,
        transitionInM: 20,
        transitionOutM: 10,
      },
    ])
    // Read as it was, nothing is written; the ranges stay as RoadEng holds them.
    expect(roadEngSectionOverrides(clone(road), tapered).alignment).toEqual({})
    // A longer transition in, and a one-sided Taper on the left only, read back the same.
    const edited = clone(road)
    edited.engineering.assignments = [
      { ...edited.engineering.assignments[0], transitionInM: 30 },
      { id: 'c', start: 300, end: 360, templateId: 'roadeng-RCK', side: 'left', transitionM: 0, transitionInM: 15 },
    ]
    const { out, again, written } = roundTrip(edited, tapered)
    expect(out.notWritten).toEqual([])
    expect(again.road.engineering.assignments.map(({ id: _id, ...a }) => a)).toEqual(
      edited.engineering.assignments.map(({ id: _id, ...a }) => a),
    )
    const rows = written.split('\r\n').filter((l) => /^\d+=/.test(l))
    expect(
      rows.map((r) =>
        r
          .split(',')
          .filter((_, k) => [0, 17, 18].includes(k))
          .join(' '),
      ),
    ).toEqual([
      '0=100 PGR PGR',
      // Split at the old 120 boundary: the row beyond it keeps RCK's rock layer, as RoadEng had it.
      '1=120 TP TP',
      '2=130 TP TP',
      '3=190 RCK RCK',
      '4=200 TP TP',
      '5=300 PGR PGR',
      '6=315 TP PGR',
      '7=360 RCK PGR',
      '8=999999999 PGR PGR',
    ])
    expectValid(again.road.template, again.road.engineering, again.road.curveDesign)
  })

  it('reads a Taper between two named templates onto the range after it', () => {
    const tapered = original(
      designDsn([
        range(100, 'PGR'),
        range(150, 'RCK'),
        range(160, 'TP'),
        range(200, 'PGR'),
        range(210, 'TP'),
        range(999999999, 'RCK'),
      ]),
    )
    const { road } = imported(tapered)
    // RCK covers more of the road, so it is the base; PGR is the assignment, with both tapers.
    expect(road.engineering.assignments.map((a) => [a.start, a.end, a.transitionInM, a.transitionOutM])).toEqual([
      [0, 100, undefined, undefined],
      [150, 210, 10, 10],
    ])
  })

  it('says a base transition beside another range is not written, and writes the rest', () => {
    const { road } = imported(o)
    const edited = clone(road)
    edited.engineering.assignments = [
      { id: 'a', start: 120, end: 180, templateId: 'roadeng-RCK', side: 'both', transitionM: 0 },
      { id: 'b', start: 180, end: 240, templateId: 'roadeng-RCK', side: 'both', transitionM: 5 },
    ]
    const out = roadEngSectionOverrides(edited, o)
    expect(out.notWritten.join()).toMatch(/transition to the base section of 1 template range beside another range/)
  })

  it('writes a library template with no RoadEng original as a copy of the base template', () => {
    const { road } = imported(o)
    const edited = clone(road)
    const wide = { ...clone(edited.template), leftWidth: 7, rightWidth: 7, fillSlope: 3 }
    edited.engineering.templates.push({ id: 'landing', name: 'Landing, wide', template: wide })
    edited.engineering.assignments.push({
      id: 'l',
      start: 250,
      end: 300,
      templateId: 'landing',
      side: 'both',
      transitionM: 0,
    })
    const { out, again, written } = roundTrip(edited, o)
    expect(out.codes.landing).toBe('LANDIN')
    expect(written).toMatch(/^T3=6,LANDIN,Landing~ wide,-0.04,-0.04,1,0,2,2$/m)
    const made = again.road.engineering.templates.find((t) => t.id === 'roadeng-LANDIN')!
    expect(made.template).toEqual(wide)
    expect(again.road.engineering.assignments.at(-1)).toMatchObject({
      start: 250,
      end: 300,
      templateId: 'roadeng-LANDIN',
      side: 'both',
    })
    expectValid(again.road.template, again.road.engineering)
  })
  it('lists what has no RoadEng parameter to go into', () => {
    const { road } = imported(o)
    const edited = clone(road)
    edited.template.layers!.push({ id: 'gravel', name: 'Gravel', side: 'both', depthM: 0.1 })
    edited.template.components = [
      { id: 'k', name: 'Key', side: 'left', kind: 'bench', condition: 'fill', widthM: 1, riseM: 0 },
    ]
    const out = roadEngSectionOverrides(edited, o)
    expect(out.notWritten.join('\n')).toMatch(/the course Gravel \(0.1 m, both\)/)
    expect(out.notWritten.join('\n')).toMatch(/the left bench component Key/)
  })
  it('rewrites the curve tables only when PGMaps’ curve rule changed', () => {
    const { road } = imported(o)
    expect(road.curveDesign!.wideningTable).toBeDefined()
    const edited = clone(road)
    // Back to the formula: RoadEng's tables are written from it.
    edited.curveDesign = {
      ...edited.curveDesign!,
      superelevationMode: 'formula',
      designSpeedKmh: 40,
      runoffLengthM: 30,
      wideningTable: roadEngWideningRows(
        {
          index: 3,
          description: [],
          speeds: [0, 45, 180],
          rows: [
            { radius: 25, e: [0, 1, 2] },
            { radius: 90, e: [0, 0.25, 0.5] },
          ],
        },
        1,
      )!.rows,
    }
    const { out, again, written } = roundTrip(edited, o)
    expect(out.written.join('\n')).toMatch(/superelevation table/)
    expect(again.road.curveDesign!.wideningTable).toEqual(edited.curveDesign.wideningTable)
    expect(written).toMatch(/^LTable-03-Row-001=25,0,1,2$/m)
    expect(written).not.toMatch(/^LTable-03-Row-003=/m)
    expect(written).toMatch(/^LTable-03-Desc-00=Widening Table - meters$/m)
    expect(written).toMatch(/^RoadOptions=111,11.1111111111,/m)
    expect(written).toMatch(/^LTable-02-Row-001=400,0,0$/m)
    expect(parseRoadEngSettings(written, ds2, 1).superelevationTables[0].rows[2].e[0]).toBeCloseTo(
      1600 / 12700 - 0.12,
      6,
    )
  })
  it('says why nothing is written for a road not read from RoadEng', () => {
    const out = roadEngSectionOverrides({ name: 'New road', template: fallback }, null)
    expect(out.templates).toEqual({})
    expect(out.notWritten.join()).toMatch(/not read from a RoadEng design/)
  })
  it('writes a backslope carried as a component back into the ditch', () => {
    const c = original(designDsn(), { templateOptions: { ditchBackslope: 'component' } })
    const { road } = imported(c)
    const edited = clone(road)
    edited.template.components = edited.template.components!.map((x) => ({ ...x, widthM: 8, riseM: 2 }))
    // The ditch's backslope is the component's 4:1 too: its top width follows, the inslope kept.
    const t = edited.template
    t.ditchWidth = (t.ditchBottomWidth ?? 0) + t.ditchDepth * (t.ditchInslope! + 4)
    const { out, again } = roundTrip(edited, c)
    expect(out.notWritten).toEqual([])
    // Equal slopes read back as a ditch without an inslope of its own: the same section.
    const same: RoadTemplate = { ...edited.template }
    delete same.ditchInslope
    expect(again.road.template).toEqual(same)
  })
  it('says when a ditch backslope cannot differ from the slope RoadEng shares it with', () => {
    const c = original(designDsn(), { templateOptions: { ditchBackslope: 'component' } })
    const edited = clone(imported(c).road)
    edited.template.components = edited.template.components!.map((x) => ({ ...x, widthM: 8, riseM: 2 }))
    const { out } = roundTrip(edited, c)
    expect(out.notWritten.join('\n')).toMatch(
      /the left ditch's 4:1 inslope with a 3:1 backslope; RoadEng's backslope on this side is the 4:1 slope above the ditch, so the inslope is written 3:1/,
    )
  })
})

describe('curve fields for the design writer', () => {
  const origin: Coordinate = [-122.8, 53.9]
  const at = (east: number, north: number) => offsetCoordinate(offsetCoordinate(origin, 90, east), 0, north)
  const road = (curveDesign?: CurveDesign): Pick<Alignment, 'points' | 'curveDesign'> => ({
    points: [
      { id: 'a', coordinate: at(0, 0), radiusM: 0 },
      { id: 'b', coordinate: at(100, 0), radiusM: 200 },
      { id: 'c', coordinate: at(200, 100), radiusM: 60 },
      { id: 'd', coordinate: at(300, 100), radiusM: 0 },
    ],
    ...(curveDesign ? { curveDesign } : {}),
  })
  const rule: CurveDesign = {
    designSpeedKmh: 60,
    maxSuperelevationPercent: 6,
    sideFrictionFactor: 0.12,
    runoffLengthM: 40,
    wideningVehicleLengthM: null,
    insideWideningM: 0.25,
  }
  it('gives each curve PGMaps’ superelevation, side friction, runoff and widening, by point id', () => {
    const { curves, kept } = roadEngCurveInputs(road(rule))
    expect(kept).toBe(false)
    expect(Object.keys(curves)).toEqual(['b', 'c'])
    const fits = horizontalCurveFits(road(rule) as Alignment)
    for (const [id, f] of Object.entries(curves)) {
      const fit = fits.find((x) => x.pointId === id)!
      const c = evaluateCurveCriteria(rule, fit.radiusM, fit.deflectionDegrees)
      expect(f).toMatchObject({ transitionFraction: 1, runoffIn: 40, runoffOut: 40, emax: 0.06 })
      expect(f.designSpeedMs).toBeCloseTo(v, 12)
      expect(f.e).toBeCloseTo(c.appliedSuperelevationPercent / 100, 12)
      expect(f.sideFriction).toBeCloseTo((v * v) / (9.81 * fit.radiusM) - f.e!, 12)
      expect(f.widening!.insideM).toBeCloseTo(c.insideWideningM, 12)
      expect(f.widening!.outsideM).toBeCloseTo(0, 12)
    }
  })
  it('leaves each curve to its own record while a project opened before table mode keeps its fitted rule', () => {
    const settings = parseRoadEngSettings(designDsn(), ds2, 1)
    const fitted = roadEngFittedCurveDesignFor(settings).curveDesign!
    expect(roadEngCurveInputs(road(fitted), { original: settings })).toEqual({
      curves: {},
      kept: true,
      from: {},
      insideWideningFromTable: {},
      outsideWideningFromTable: {},
    })
    const changed = roadEngCurveInputs(road({ ...fitted, runoffLengthM: 10 }), { original: settings })
    expect(Object.keys(changed.curves)).toEqual(['b', 'c'])
    // The table rule gives every curve, and the writer keeps only what differs from each record.
    const table = roadEngCurveInputs(road(roadEngCurveDesignFor(settings).curveDesign!), { original: settings })
    expect(table.kept).toBe(false)
    expect(table.from).toEqual({ b: 'table', c: 'table' })
  })
  it('writes only the fields that differ from the record, and RoadEng’s flag bits only where an edit changes them', () => {
    const record = '108,1,2,-200,0,0,0,-1,16.6666666667,5585,0.06,0.1,40,40,0.667,0.05,0.0916,0,0,0'.split(',')
    const same = {
      designSpeedMs: 60 / 3.6,
      emax: 0.06,
      runoffIn: 40,
      runoffOut: 40,
      transitionFraction: 0.667,
      e: 0.05,
    }
    expect(roadEngCurveChanges(same, record, 1, 'table')).toBeNull()
    // A typed e is written as a value: the bit for RoadEng's superelevation Auto box is not known.
    expect(roadEngCurveChanges({ ...same, e: 0.06 }, record, 1, 'stated')).toEqual({ e: 0.06 })
    expect(roadEngCurveChanges({ ...same, runoffIn: 50 }, record, 1, 'table')).toEqual({ runoffIn: 50 })
    // A spiral's transitions are its spirals, which the writer writes itself.
    expect(roadEngCurveChanges({ ...same, runoffIn: 50 }, record, 1, 'table', true)).toBeNull()
    // Use Minimum Radius (bit 1, 5587 here) stays as read, and is never set: a curve at its e max
    // keeps it, and an edit that takes it off its minimum radius (another e, speed or radius) clears it.
    const minimum = [...record]
    minimum[9] = '5587'
    minimum[15] = '0.06'
    const atMax = { ...same, e: 0.06 }
    expect(roadEngCurveChanges(atMax, minimum, 1, 'minimumRadius')).toBeNull()
    expect(roadEngCurveChanges(atMax, minimum, 1, 'stated')).toBeNull()
    expect(roadEngCurveChanges({ ...same, e: 0.056 }, minimum, 1, 'table')).toEqual({ e: 0.056, flags: 5585 })
    expect(roadEngCurveChanges({ ...atMax, designSpeedMs: 50 / 3.6 }, minimum, 1, 'minimumRadius')).toEqual({
      designSpeedMs: 50 / 3.6,
      flags: 5585,
    })
    expect(roadEngCurveChanges(atMax, minimum, 1, 'minimumRadius', false, null, true)).toEqual({ flags: 5585 })
    expect(roadEngCurveChanges({ ...same, e: 0.06 }, record, 1, 'minimumRadius')).toEqual({ e: 0.06 })
    // RoadEng's side friction method: Auto on with the table bit (256) clear, and the curve's f max.
    expect(roadEngCurveChanges({ ...same, fLimit: 0.1 }, record, 1, 'sideFriction')).toEqual({ flags: 5329 })
    expect(roadEngCurveChanges({ ...same, fLimit: 0.16 }, record, 1, 'sideFriction')).toEqual({
      fLimit: 0.16,
      flags: 5329,
    })
    const bluff = '108,1,2,-500,0,0,0,-1,44,113,0.1,0.16,20,20,1,0.0462709009645,0.0740334415432,1,0,0'.split(',')
    expect(roadEngCurveChanges({ e: 0.0462709009645, fLimit: 0.16 }, bluff, 0.3048, 'sideFriction')).toBeNull()
    expect(roadEngCurveChanges({ e: 0.051 }, bluff, 0.3048, 'table')).toEqual({ e: 0.051, flags: 369 })
  })
  it('takes each curve’s own design speed, e max, runoff and stated superelevation', () => {
    const own = { designSpeedKmh: 40, maxSuperelevationPercent: 8, superelevationPercent: 7, runoffInM: 55 }
    const f = roadEngCurveFromRule(rule, 200, 30, 0, 50, own)
    expect(f.designSpeedMs).toBeCloseTo(40 / 3.6, 12)
    expect(f).toMatchObject({ emax: 0.08, e: 0.07, runoffIn: 55, runoffOut: 40, transitionFraction: 1 })
  })
  it('reads an edited curve from the design’s own tables, as RoadEng’s Auto does', () => {
    const settings = parseRoadEngSettings(designDsn(), ds2, 1)
    // Halfway between the 200 m and 400 m rows at 60 km/h; for widening, the 80 m row (at or below
    // 300 m) and the 80° column (nearest 72°).
    expect(roadEngCurveFromTables(settings, 300, 72, 60)).toEqual({
      designSpeedMs: v,
      e: 0.045,
      sideFriction: (v * v) / (9.81 * 300) - 0.045,
      runoffIn: 40,
      runoffOut: 40,
      widening: { insideM: 0.5, outsideM: 0.5 },
    })
    expect(roadEngCurveFromTables(settings, 60, 72, 40).widening).toEqual({ insideM: 2, outsideM: 2 })
    // 100 m at 60 km/h is blank in the table: no e, so the writer keeps the read one.
    expect(roadEngCurveFromTables(settings, 100, 10, 60).e).toBeUndefined()
  })
  it('writes zeros at a curve without a rule, at RoadEng’s default speed', () => {
    const f = roadEngCurveFromRule(null, 150, 20)
    expect(f).toMatchObject({ e: 0, runoffIn: 0, widening: { insideM: 0, outsideM: 0 } })
    expect(f.designSpeedMs).toBeCloseTo(50 / 3.6, 12)
  })
})

// Softree's published sample projects, read from a local copy and never committed: set
// ROADENG_SAMPLES to the folder holding the extracted archives.
const samples = process.env.ROADENG_SAMPLES
describe.skipIf(!samples || !existsSync(samples))('Softree sample designs', () => {
  const load = (path: string) => {
    const bytes = new Uint8Array(readFileSync(join(samples!, path)))
    const files = unzipSync(bytes, { filter: (f) => /^Location\d+\.ds[n2]$/i.test(f.name) })
    const text = (name: string) => strFromU8(files[name], true)
    const roads = roadEngRoads(bytes, {
      fileName: path,
      newId: () => 'r',
      color: () => '#123456',
      template: fallback,
      epsg: 26910,
    }).roads
    return { bytes, text, roads, settings: readRoadEngSettings(bytes) }
  }
  const originalOf = (s: ReturnType<typeof load>, k: number): RoadEngOriginal => {
    const road = s.roads[k]
    const part = road.source.part
    return {
      dsnText: s.text(`${part}.dsn`),
      ds2Text: s.text(`${part}.ds2`),
      ...(part !== 'Location1' ? { projectDsnText: s.text('Location1.dsn') } : {}),
      unitM: s.settings.unitM,
      startStation: road.source.startStation,
      endStation: road.source.endStation,
      stationScale: road.stationScale,
      fallback,
    }
  }
  it('writes LongRoad back unchanged, and its edits read back the same', () => {
    const s = load('LongRoad_1/LongRoad 1.dsnx')
    const o = originalOf(s, 0)
    const { road } = imported(o)
    const unchanged = roadEngSectionOverrides(clone(road), o)
    expect(unchanged.templates).toEqual({})
    expect(unchanged.alignment).toEqual({})
    // Narrower road, shallower ditch, thicker courses, a bridge 5 m shorter and a rock-cut range ended early.
    const edited = clone(road)
    edited.template.leftWidth = 4
    edited.template.ditchDepth = 0.5
    edited.template.ditchWidth = 7.5
    edited.template.layers = edited.template.layers!.map((l) => ({
      ...l,
      depthM: Math.round((l.depthM + 0.05) * 1000) / 1000,
    }))
    const bridge = edited.engineering.assignments.find((a) => a.templateId === 'roadeng-PGRB')!
    bridge.start += 5
    edited.engineering.assignments[0].end -= 100
    const { out, again } = roundTrip(edited, o)
    expect(out.notWritten).toEqual([])
    expect(again.road.template).toEqual(edited.template)
    expect(again.road.engineering.templates).toEqual(edited.engineering.templates)
    expect(again.road.engineering.assignments.map((a) => [a.templateId, a.side])).toEqual(
      edited.engineering.assignments.map((a) => [a.templateId, a.side]),
    )
    again.road.engineering.assignments.forEach((a, k) => {
      expect(a.start).toBeCloseTo(edited.engineering.assignments[k].start, 6)
      expect(a.end).toBeCloseTo(edited.engineering.assignments[k].end, 6)
    })
    expect(again.road.engineering.strata).toHaveLength(road.engineering.strata.length)
    expect(again.road.curveDesign).toEqual(road.curveDesign)
    expectValid(again.road.template, again.road.engineering, again.road.curveDesign)
  })
  it('reproduces every LongRoad curve’s own record while its curve rule is unchanged', () => {
    const s = load('LongRoad_1/LongRoad 1.dsnx')
    const o = originalOf(s, 0)
    const { road, settings } = imported(o)
    const alignment = withRoadEngCurveSettings(
      { ...s.roads[0].alignment, curveDesign: road.curveDesign },
      s.roads[0].source,
    )
    const given = roadEngCurveInputs(alignment, { original: settings })
    expect(given.kept).toBe(false)
    // Each curve's figures are its record's: nothing to write back.
    const records = s.roads[0].source.source!.piRecords.map((line) => line.split(','))
    alignment.points.slice(1, -1).forEach((point, k) => {
      expect(roadEngCurveChanges(given.curves[point.id], records[k], 1, given.from[point.id])).toBeNull()
    })
    const own = alignment.points.filter((p) => p.curve)
    // Eight curves at their own speed (70, 60, 50 and 90 km/h); 24 with RoadEng's Use Minimum
    // Radius, each at e max (four of them where the table reads less).
    expect(own.filter((p) => p.curve!.designSpeedKmh !== undefined)).toHaveLength(8)
    expect(own.filter((p) => p.curve!.useMinimumRadius)).toHaveLength(24)
    expect(own.filter((p) => p.curve!.superelevationPercent !== undefined)).toHaveLength(0)
    expect(Object.values(given.from).filter((f) => f === 'minimumRadius')).toHaveLength(24)
    // A project opened before table mode keeps its records while its fitted rule is unedited.
    const fitted = { ...s.roads[0].alignment, curveDesign: roadEngFittedCurveDesignFor(settings).curveDesign! }
    expect(roadEngCurveInputs(fitted, { original: settings })).toEqual({
      curves: {},
      kept: true,
      from: {},
      insideWideningFromTable: {},
      outsideWideningFromTable: {},
    })
    // With the rule edited, PGMaps' own figures go out; its widening is RoadEng's on every curve.
    const ownRule = roadEngCurveInputs({ ...alignment, curveDesign: { ...road.curveDesign!, criteriaName: 'x' } })
    const read = roadEngCurvesByPoint(s.roads[0])
    expect(Object.keys(ownRule.curves)).toEqual(Object.keys(read))
    for (const [id, f] of Object.entries(ownRule.curves))
      expect(f.widening!.insideM).toBeCloseTo(read[id].widening!.insideM, 6)
    // RoadEng's own tables give back each curve's stored widening, and its e on all but four curves
    // (R 230 at 70 km/h and R 170 at 60 km/h carry e max, 0.06, where the table reads 0.056).
    let sameE = 0
    for (const c of settings.curves) {
      const t = roadEngCurveFromTables(settings, c.radiusM, c.deflectionDegrees!, c.designSpeedKmh)
      if (Math.abs(t.e! - c.e) < 1e-9) sameE++
      else expect([t.e, c.e]).toEqual([0.056, 0.06])
      expect(t.widening!.insideM).toBeCloseTo(c.wideningInsideM, 6)
    }
    expect(sameE).toBe(69)
  })
  it('writes the cul-de-sac roads back and reads its edits the same', () => {
    const s = load('Cul-de-sac-design/CulDeSacExample/CulDeSacExampleComplete.dsnx')
    const o = originalOf(s, 0)
    const { road } = imported(o)
    expect(roadEngSectionOverrides(clone(road), o).templates).toEqual({})
    const edited = clone(road)
    edited.template.crossfallPercent = 2
    edited.template.cutSlope = 1.5
    edited.template.fillSlope = 1.5
    const { out, again } = roundTrip(edited, o)
    expect(out.notWritten).toEqual([])
    expect(again.road.template).toEqual(edited.template)
    // Its basic slopes are one closing slope for cut and fill: a cut-only edit says the fill follows.
    const cutOnly = clone(road)
    cutOnly.template.cutSlope = 2
    expect(roadEngSectionOverrides(cutOnly, o).notWritten.join()).toMatch(
      /one closing slope for cut and fill on this side, which takes the cut batter \(2:1\)/,
    )
    expectValid(again.road.template, again.road.engineering, again.road.curveDesign)
    // The branch names a template the design lacks: nothing to write into, and it says so.
    const branch = originalOf(s, 1)
    const b = imported(branch)
    const out2 = roadEngSectionOverrides({ ...b.road, template: fallback }, branch)
    expect(out2.notWritten.join()).toMatch(/no RoadEng template it was read from/)
    const tSettings = roadEngTemplateFor(b.settings, { ...branch, fallback })
    expect(tSettings.template).toBeNull()
  })
})

// RoadEng components PGMaps reads into section structures, generated from the parameter names and
// descriptions in Softree's component library (no sample road uses them): Slope VI benches, a Wall IV
// retaining wall, a guard rail, a SubCut II and the base course's fill slope.
describe('section structures written back', () => {
  const structures = [
    ...component(1, 6, '11,SLPS,Slope VI - Benches!^!Up to 5 benches.,8,0,145', 'left', [
      ['bApplyInCut', 0, 1],
      ['bApplyInFill', 0, 0],
      ['FinalCutSlp', 1, 1],
      ['FinalFillSlp', 1, 0.5],
      ['BenchSlope', 1, 2],
      ['BenchHeight', 0, 3],
      ['BenchBaseWidth', 0, 1.5],
      ['BenchBaseSlope', 1, 0.02],
    ]),
    ...component(1, 7, '7,Retain,Wall IV - Retaining Wall!^!Retaining wall.,3,0,145', 'right', [
      ['WallThick', 0, 0.3],
      ['WallHeight', 576, 2],
      ['WallFactor', 0, 0.7],
    ]),
    ...component(1, 8, '5,Guard Rail,Barrier I - Guard Rail!^!Guard rail.,5,0,146', 'left', [
      ['bIncludeBarrier', 0, 1],
      ['BarrierCL_Offset', 256, 5],
      ['PostThickness', 0, 0.3],
      ['PostHeight', 0, 1],
      ['RailThickness', 0, 0.2],
    ]),
    ...component(1, 9, '4,SC,SubCut II - Under SG!^!Subcut below subgrade.,6,0,145', 'left', [
      ['SubCutDepth', 0, 0.6],
      ['SubCutWidthL', 0, 5],
      ['SubCutWidthR', 0, 5],
      ['SubCutBotSlope', 1, 0],
      ['SubCutSlopeOut', 1, 1],
      ['SubCutSlopeIn', 1, 9999.99],
    ]),
    'T1-C0-U8=BaseFillSlope~Fill slope for base layer.|1|0.25|-1|0|1000|',
    'T1-C1-U8=BaseFillSlope~Fill slope for base layer.|1|0.25|-1|0|1000|',
  ]
  const o = original(designDsn().replace('T2=6,RCK', [...structures, 'T2=6,RCK'].join('\r\n')))
  const { road } = imported(o)
  it('reads them into the section', () => {
    const t = road.template
    // 4.2 m lane and 0.5 m shoulder over 0.15 m of base at 4:1.
    expect(t.leftWidth).toBeCloseTo(5.3, 9)
    expect(t.layers!.find((l) => l.id === 'roadeng-basethick')!.sideSlope).toBe(4)
    expect(t.leftBenches).toEqual({
      cut: { heightM: 3, widthM: 1.5, faceSlope: 0.5, benchFallPercent: 2, count: 5 },
    })
    expect(t.walls).toEqual([
      expect.objectContaining({
        side: 'right',
        kind: 'cut',
        heightM: 2,
        thicknessM: 0.3,
        name: 'Wall IV - Retaining Wall',
      }),
    ])
    expect(t.barriers).toEqual([
      expect.objectContaining({ side: 'left', kind: 'guard-rail', offsetM: 5, widthM: 0.5, heightM: 1 }),
    ])
    expect(t.leftSubCut).toMatchObject({ reference: 'subgrade', depthM: 0.6, widthM: 5, outsideSlope: 1 })
    expect(t.rightSubCut).toBeUndefined()
    expectValid(t, road.engineering, road.curveDesign)
  })
  it('writes nothing for them as read', () => {
    const out = roadEngSectionOverrides(clone(road), o)
    expect(out.templates).toEqual({})
    expect(out.notWritten).toEqual([])
  })
  it('writes each edit into the parameter it came from', () => {
    const edited = clone(road)
    const t = edited.template
    t.leftBenches = { cut: { heightM: 4, widthM: 2, faceSlope: 0.25, benchFallPercent: 5, count: 5 } }
    t.walls = t.walls!.map((w) => ({ ...w, heightM: 3.5, thicknessM: 0.4 }))
    t.barriers = t.barriers!.map((b) => ({ ...b, offsetM: 4.5, heightM: 1.1 }))
    t.leftSubCut = { ...t.leftSubCut!, depthM: 0.9, widthM: 4, outsideSlope: 2 }
    t.layers = t.layers!.map((l) => (l.id === 'roadeng-basethick' ? { ...l, sideSlope: 2 } : l))
    const { out, again, written } = roundTrip(edited, o)
    expect(out.notWritten).toEqual([])
    expect(again.road.template).toEqual(edited.template)
    expect(written).toMatch(/^T1-C6-U5=BenchHeight~[^|]*\|0\|4\|/m)
    expect(written).toMatch(/^T1-C6-U4=BenchSlope~[^|]*\|1\|4\|/m)
    expect(written).toMatch(/^T1-C7-U1=WallHeight~[^|]*\|576\|3.5\|/m)
    expect(written).toMatch(/^T1-C8-U1=BarrierCL_Offset~[^|]*\|256\|4.5\|/m)
    expect(written).toMatch(/^T1-C9-U0=SubCutDepth~[^|]*\|0\|0.9\|/m)
    expect(written).toMatch(/^T1-C9-U4=SubCutSlopeOut~[^|]*\|1\|0.5\|/m)
    // The base's side slope halves its run, so the lane keeps the 5.3 m formation: 4.2 + 0.3 m wider.
    expect(written).toMatch(/^T1-C0-U8=BaseFillSlope~[^|]*\|1\|0.5\|/m)
    expect(written).toMatch(/^T1-C0-U1=AcpWidth~[^|]*\|256\|4.5\|/m)
    expectValid(again.road.template, again.road.engineering, again.road.curveDesign)
  })
  it('writes a sub-cut bottom slope and inside slope back, and says its crossfall has no home here', () => {
    const edited = clone(road)
    edited.template.leftSubCut = { ...edited.template.leftSubCut!, bottomSlopePercent: -3, insideSlope: 1 }
    const { out, again, written } = roundTrip(edited, o)
    expect(out.notWritten).toEqual([])
    expect(written).toMatch(/^T1-C9-U3=SubCutBotSlope~[^|]*\|1\|-0.03\|/m)
    expect(written).toMatch(/^T1-C9-U5=SubCutSlopeIn~[^|]*\|1\|1\|/m)
    expect(again.road.template).toEqual(edited.template)
    edited.template.leftSubCut = { ...edited.template.leftSubCut, followsCrossfall: false }
    expect(roadEngSectionOverrides(edited, o).notWritten.join()).toMatch(/left sub-cut crossfall/)
  })
  it('says what has no RoadEng home', () => {
    const edited = clone(road)
    edited.template.walls = [
      ...(edited.template.walls ?? []),
      { id: 'new', name: 'New fill wall', side: 'left', kind: 'fill', heightM: 4, thicknessM: 0.5 },
    ]
    const { out } = roundTrip(edited, o)
    expect(out.notWritten.join('\n')).toMatch(/the left fill wall New fill wall/)
  })
})
