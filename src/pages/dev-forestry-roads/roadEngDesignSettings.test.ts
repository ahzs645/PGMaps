import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { parseEngineering } from './engineeringProject'
import { parseProject } from './project'
import {
  parseRoadEngSettings,
  parseRoadEngTbl,
  readRoadEngSettings,
  ROADENG_STEP_EPSILON,
  roadEngCurveDesignFor,
  roadEngEngineeringFor,
  roadEngMaterialsFor,
  roadEngTableValue,
  roadEngTemplateFor,
  roadEngTemplateToPgmaps,
  roadEngWideningFor,
  roadEngWideningRows,
  type RoadEngSuperelevationTable,
} from './roadEngDesignSettings'
import { evaluateCurveCriteria } from './roadCriteria'
import { parseRoadEngDesign, roadEngRoads } from './roadEngImport'
import { createDemoProject, DEFAULT_TEMPLATE } from './terrain'
import { validateEngineering, validateTemplate } from './templates'
import type { AlignmentEngineering, RoadProject, RoadTemplate } from './types'

// A synthetic design laid out as RoadEng 11 writes its `[TemplatesSct]`: one library folder, a
// gravel road (PGR), the same road with a rock bench (RCK), a bridge deck (BRG), station ranges
// that use all three and a ground type table, worked out by hand.
type Param = [name: string, flags: number, value: number, feature?: number]
function component(t: number, c: number, head: string, side: 'left' | 'right' | 'both', params: Param[]) {
  const lines = [`T${t}-C${c}=${head}`]
  const sides = side === 'both' ? [1, 0] : [side === 'left' ? 1 : 0]
  sides.forEach((bit, f) => lines.push(`T${t}-C${c}-F${f}=1,SGL,Fragment,${131072 + bit},1,0,0,-`))
  params.forEach(([name, flags, value, feature = -1], u) => {
    lines.push(`T${t}-C${c}-U${u}=${name}~${name} description, with a comma.|${flags}|${value}|${feature}|0|1000|`)
    lines.push(`T${t}-C${c}-U${u}-1=`)
  })
  return lines
}
const ruralI = (width = 4.2): Param[] => [
  ['AcpThick', 0, 0],
  ['AcpWidth', 256, width],
  ['BaseThick', 0, 0.15],
  ['BaseFillSlope', 1, 0.25],
  ['SubbaseThick', 0, 0.35],
  ['ShoulderGravWidth', 0, 0],
  ['_SUPER', 37, -0.04],
  ['SG_DEPTH', 0, 0.5],
]
const ditchI: Param[] = [
  ['DitchProbeDepth', 0, 0.6],
  ['bDitchInclude', 0, 1],
  ['DitchDepth', 0, 0.6],
  ['DitchInSlp', 1, 0.25],
  ['DitchBotWd', 0, 1],
  ['DitchBotSlp', 1, 0],
  ['DitchBackSlpHt', 0, 0],
  ['DitchBackSlp', 1, 0.5],
]
const slopeI = (cut: number, fill: number, inCut = 1): Param[] => [
  ['FinalCutSlp', 1, cut],
  ['FinalFillSlp', 1, fill],
  ['bApplyInCut', 0, inCut],
  ['bApplyInFill', 0, 1],
]
const RURAL = '4,RDWY,Rural I!^!Up to three layer template~ with shoulders.,8,0,146'
const DITCH = '3,DTCHS,Ditch I Standard!^!Conditionally creates a ditch.,8,0,145'
const SLOPE = '2,SLPS,Slope I - Standard Cut/Fill!^!Standard closing slopes.,4,0,145'
function templates({ pgrWidth = 4.2, ditch = ditchI }: { pgrWidth?: number; ditch?: Param[] } = {}) {
  return [
    '[TemplatesSct]',
    'RoadOptions=111,16.6666666667,0.31,2.5,2,3,0.09,1000,1000,50,0.1,-0.1,forest two lane,0.06,1,0,100',
    'LTable-00-Desc-00= Superelevation table, radius in meters, speed in km/hr, Emax = 0.06',
    'LTable-00-Row-000=,40,60',
    'LTable-00-Row-001=200,0.03,0.05',
    'T0=1,FF1,Roadway Components,-0.02,-0.02,1,2,2,2',
    ...component(0, 0, RURAL, 'left', ruralI(9)),
    'T1=6,PGR,Pioneer Gravel Road,-0.04,-0.04,1,0,2,2',
    ...component(1, 0, RURAL, 'left', ruralI(pgrWidth)),
    ...component(1, 1, RURAL, 'right', ruralI(pgrWidth)),
    ...component(1, 2, DITCH, 'left', ditch),
    ...component(1, 3, DITCH, 'right', ditch),
    ...component(1, 4, SLOPE, 'left', slopeI(2, 0.666667)),
    ...component(1, 5, SLOPE, 'right', slopeI(2, 0.666667)),
    'T2=6,RCK,Gravel Road w/ Rockcut,-0.04,-0.04,1,0,2,2',
    ...component(2, 0, RURAL, 'left', ruralI()),
    ...component(2, 1, RURAL, 'right', ruralI()),
    ...component(2, 2, '2,SLPS,Slope VII - Bench at Subsurface.,6,0,145', 'left', [
      ['Subsurface', 192, 0, 2],
      ['SlopeBelowSubsurf', 1, 4],
      ['BenchWidth', 0, 2],
      ['BenchSlope', 1, 0],
      ['FinalCutSlp', 1, 1],
    ]),
    ...component(2, 3, '2,SLPS,Slope VII - Bench at Subsurface.,6,0,145', 'right', [
      ['Subsurface', 192, 0, 2],
      ['SlopeBelowSubsurf', 1, 4],
      ['BenchWidth', 0, 2],
      ['BenchSlope', 1, 0],
      ['FinalCutSlp', 1, 1],
    ]),
    ...component(2, 4, SLOPE, 'left', slopeI(2, 0.5, 0)),
    ...component(2, 5, SLOPE, 'right', slopeI(2, 0.5, 0)),
    'T3=2,BRG,Bridge,0,0,1,0,2,2',
    ...component(3, 0, '4,BRDG,Bridge I - Deck,2,0,130', 'left', [
      ['DeckWidth', 0, 4],
      ['DeckDepth', 0, 1],
    ]),
    ...component(3, 1, '4,BRDG,Bridge I - Deck,2,0,130', 'right', [
      ['DeckWidth', 0, 4],
      ['DeckDepth', 0, 1],
    ]),
    ...component(3, 2, '4,Guard Rail,Barrier I - Guard Rail,1,0,146', 'both', [['PostHeight', 0, 0.7]]),
  ]
}
const range = (end: number | string, left: string, right = left, depth = '999999', below = '-') =>
  `${end},0,0,0,0,0,0,0,0,0,-,*1,${depth},${below},999999,-,OB,${left},${right},RE,RE,0,0,-1,-1,0,0,0,0,RE,RE,9999,999999000,1`
function dsn({
  units = '10000',
  ranges = [range(100, 'PGR'), range(200, 'RCK', 'RCK', '-0.5', 'SR'), range(250, 'BRG'), range(999999999, 'PGR')],
  ...rest
}: { units?: string; ranges?: string[]; pgrWidth?: number; ditch?: Param[] } = {}) {
  return [
    '[Culvert]',
    'DefDrainCulvert=%#%|0,3.40282346639e+38,3.40282346639e+38,500,90,2,3,3,0,440',
    '[design]',
    `units=${units}`,
    'ParmOverrides-1=0',
    '[LocationParms]',
    ...ranges.map((r, k) => `${k}=${r}`),
    `nparams=${ranges.length}`,
    ...templates(rest),
  ].join('\r\n')
}
// Two curves at 60 km/h (16.667 m/s) whose superelevation follows e = V²/(127 R) − 0.12, held at
// e max 0.06; their side friction field is v²/(gR) − e.
const v = 60 / 3.6
const pi = (index: number, signedRadius: number, transition = 40) => {
  const radius = Math.abs(signedRadius)
  const e = Math.min(0.06, (60 * 60) / (127 * radius) - 0.12)
  return `108,${index},2,${signedRadius},0,0,0,-1,${v},5585,0.06,0.1,${transition},${transition},0.667,${e},${(v * v) / (9.81 * radius) - e},0,0,0`
}
const ds2 = [
  '100,103,11,11.0.673.0, Softree Technical Systems Inc. - Location Line data file',
  '104,OB,Overburden (Default),100,400,1,1.25,12,4,0,8,0.6,4,2.6,2,0,0,0,0,',
  '104,SR,Solid Rock,100,400,1,0.8,48,4,0,8,0.6,4,2.6,2,3,0,0,0,',
  pi(1, 200),
  pi(2, -100),
  '110,5,0,0,900,0,-1,0,0,,,256',
].join('\r\n')

const fallback: RoadTemplate = { ...DEFAULT_TEMPLATE }
const along = { startStation: 0, endStation: 400, fallback }

describe('parseRoadEngSettings', () => {
  const s = parseRoadEngSettings(dsn(), ds2, 1)
  it('reads templates, their components, sides and named parameters', () => {
    expect(s.templates.map((t) => [t.code, t.folder])).toEqual([
      ['FF1', true],
      ['PGR', false],
      ['RCK', false],
      ['BRG', false],
    ])
    const pgr = s.templates[1]
    expect(pgr.crossfallLeft).toBe(-0.04)
    expect(pgr.components.map((c) => [c.className, c.name, c.side])).toEqual([
      ['RDWY', 'Rural I', 'left'],
      ['RDWY', 'Rural I', 'right'],
      ['DTCHS', 'Ditch I Standard', 'left'],
      ['DTCHS', 'Ditch I Standard', 'right'],
      ['SLPS', 'Slope I - Standard Cut/Fill', 'left'],
      ['SLPS', 'Slope I - Standard Cut/Fill', 'right'],
    ])
    expect(pgr.components[0].description).toBe('Up to three layer template, with shoulders.')
    const width = pgr.components[0].parameters.find((p) => p.name === 'AcpWidth')!
    expect(width).toMatchObject({ kind: 'length', value: 4.2, flags: 256, featureIndex: null })
    expect(width.description).toBe('AcpWidth description, with a comma.')
    expect(pgr.components[0].parameters.find((p) => p.name === 'BaseFillSlope')).toMatchObject({ kind: 'slope' })
    expect(s.templates[3].components[2].side).toBe('both')
  })
  it('reads station ranges as ending at their station, with their ground layers', () => {
    expect(s.stationRanges.map((r) => [r.fromStation, r.toStation, r.leftTemplate, r.rightTemplate, r.ground])).toEqual(
      [
        [null, 100, 'PGR', 'PGR', [{ code: 'OB', topDepthM: 0, bottomDepthM: null }]],
        [
          100,
          200,
          'RCK',
          'RCK',
          [
            { code: 'OB', topDepthM: 0, bottomDepthM: 0.5 },
            { code: 'SR', topDepthM: 0.5, bottomDepthM: null },
          ],
        ],
        [200, 250, 'BRG', 'BRG', [{ code: 'OB', topDepthM: 0, bottomDepthM: null }]],
        [250, null, 'PGR', 'PGR', [{ code: 'OB', topDepthM: 0, bottomDepthM: null }]],
      ],
    )
  })
  it('reads each curve, the ground types, culvert defaults, tables and road options', () => {
    expect(s.curves).toHaveLength(2)
    expect(s.curves[1]).toMatchObject({ pi: 2, radiusM: 100, eMax: 0.06, e: 0.06, transitionAtBcM: 40 })
    expect(s.curves[0].designSpeedKmh).toBeCloseTo(60, 6)
    expect(s.curves[0].transitionFraction).toBe(0.667)
    expect(
      s.materials.map((m) => [m.code, m.fillSlopePercent, m.cutSlopePercent, m.cutExpansion, m.fillExpansion]),
    ).toEqual([
      ['OB', 100, 400, 1, 1.25],
      ['SR', 100, 400, 1, 0.8],
    ])
    expect(s.culvertDefaults).toEqual([expect.objectContaining({ kind: 'drain', diameterM: 0.5, skewDegrees: 90 })])
    expect(s.superelevationTables[0]).toMatchObject({ speeds: [40, 60], rows: [{ radius: 200, e: [0.03, 0.05] }] })
    expect(s.roadOptions).toMatchObject({ criteriaName: 'forest two lane', eMax: 0.06 })
    expect(s.roadOptions!.designSpeedKmh).toBeCloseTo(60, 6)
    expect(s.parameterOverrides).toBe(0)
    expect(s.warnings).toEqual([])
  })
  it('converts a foot design to metres', () => {
    const feet = parseRoadEngSettings(dsn({ units: '3048', pgrWidth: 10 }), ds2, 0.3048)
    expect(feet.templates[1].components[0].parameters.find((p) => p.name === 'AcpWidth')!.value).toBeCloseTo(3.048, 9)
    expect(feet.stationRanges[0].toStation).toBeCloseTo(30.48, 9)
    expect(feet.stationRanges[1].ground[1].topDepthM).toBeCloseTo(0.1524, 9)
    expect(feet.curves[1].radiusM).toBeCloseTo(30.48, 9)
    // A slope is a ratio and does not scale.
    expect(feet.templates[1].components[2].parameters.find((p) => p.name === 'DitchInSlp')!.value).toBe(0.25)
    const cost = roadEngMaterialsFor(feet, { startStation: 0, endStation: 121.92 }).materials[0].cutRate
    expect(cost).toBeCloseTo(12 / 0.764554857984, 9)
  })
  it('takes templates from the first alignment when a later one has none', () => {
    const later = ['[design]', '[LocationParms]', `0=${range(999999999, 'RCK')}`].join('\r\n')
    expect(parseRoadEngSettings(later, ds2, 1).templates).toEqual([])
    const read = parseRoadEngSettings(later, ds2, 1, { projectDsnText: dsn() })
    expect(read.templates.map((t) => t.code)).toEqual(['FF1', 'PGR', 'RCK', 'BRG'])
  })
  it('refuses units that are not a length', () => {
    expect(() => parseRoadEngSettings(dsn(), ds2, 0)).toThrow(/positive number of metres/)
  })
  it('reads every alignment of a .dsnx archive', () => {
    const later = ['[design]', '[LocationParms]', `0=${range(999999999, 'RCK')}`].join('\r\n')
    const bytes = zipSync({
      'Location1.dsn': strToU8(dsn(), true),
      'Location1.ds2': strToU8(ds2, true),
      'Location2.dsn': strToU8(later, true),
      'Location2.ds2': strToU8(ds2, true),
    })
    const read = readRoadEngSettings(bytes)
    expect(read.unitM).toBe(1)
    expect(
      read.parts.map((p) => [p.part, p.settings.templates.length, p.settings.stationRanges[0].leftTemplate]),
    ).toEqual([
      ['Location1', 4, 'PGR'],
      ['Location2', 4, 'RCK'],
    ])
  })
})

describe('roadEngTemplateFor', () => {
  const s = parseRoadEngSettings(dsn(), ds2, 1)
  const mapped = roadEngTemplateFor(s, along)
  it('makes the template over most of the road the base section', () => {
    expect(mapped.baseCode).toBe('PGR')
    expect(mapped.template).toEqual({
      leftWidth: 4.2,
      rightWidth: 4.2,
      crossfallPercent: 4,
      cutSlope: 0.5,
      fillSlope: 1.499999,
      // Bottom 1 m + 0.6 m at 4:1 + 0.6 m at 2:1: the same top width and area as RoadEng's ditch.
      ditchWidth: 4.6,
      ditchDepth: 0.6,
      ditchBottomWidth: 1,
      surfaceDepth: 0,
      layers: [
        { id: 'roadeng-basethick', name: 'Base', side: 'both', depthM: 0.15 },
        { id: 'roadeng-subbasethick', name: 'Sub-base', side: 'both', depthM: 0.35 },
      ],
    })
    expect(mapped.subgradeDepthM).toEqual({ left: 0.5, right: 0.5 })
    validateTemplate(mapped.template!)
  })
  it('assigns the other templates to their ranges as steps', () => {
    expect(mapped.assignments).toEqual([
      { id: 'roadeng-range-1', start: 100, end: 200, templateId: 'roadeng-RCK', side: 'both', transitionM: 0 },
      { id: 'roadeng-range-2', start: 200, end: 250, templateId: 'roadeng-BRG', side: 'both', transitionM: 0 },
    ])
    const rock = mapped.templates.find((t) => t.id === 'roadeng-RCK')!.template
    // Above the rock 1:1 (the bench component's closing slope); the fill-only Slope I gives 2:1 fill.
    expect(rock).toMatchObject({ cutSlope: 1, fillSlope: 2, rockCut: { cutSlope: 0.25, ledgeWidthM: 2 } })
    expect(rock.ditchWidth).toBe(0)
    const bridge = mapped.templates.find((t) => t.id === 'roadeng-BRG')!.template
    expect(bridge).toMatchObject({ leftWidth: 4, rightWidth: 4, crossfallPercent: 0, cutSlope: fallback.cutSlope })
    for (const t of mapped.templates) validateTemplate(t.template)
  })
  it('lists what it leaves behind and how it differs', () => {
    const text = mapped.unmapped.join('\n')
    expect(text).toMatch(/side slopes of the surfacing layers.*BaseFillSlope 4:1/)
    expect(text).toMatch(/BRG \(Bridge\): Bridge I - Deck is a bridge deck/)
    expect(text).toMatch(/BRG \(Bridge\): component Barrier I - Guard Rail \(Guard Rail, both\) is not one/)
    expect(text).toMatch(/no value PGMaps reads for the left cut batter \(kept from the road's current section\)/)
    expect(text).toMatch(/default drain culvert \(500 mm\)/)
    const notes = mapped.notes.join('\n')
    expect(notes).toMatch(/each ditch's 4:1 inslope and 2:1 backslope become one 3:1 slope/)
    expect(notes).toMatch(/subgrade 0.5 m \(left\) and 0.5 m \(right\) below it/)
    expect(notes).toMatch(/0.6 m probe/)
    expect(notes).toMatch(/rock cut \(0.25:1 below the rock, a 2 m ledge, 1:1 above\)/)
  })
  it('maps road chainage from the alignment start and the station scale', () => {
    const shifted = roadEngTemplateFor(s, { startStation: 50, endStation: 450, stationScale: 1.01, fallback })
    const expected = [
      [50.5, 151.5],
      [151.5, 202],
    ]
    expect(shifted.assignments).toHaveLength(2)
    shifted.assignments.forEach((a, k) => {
      expect(a.start).toBeCloseTo(expected[k][0], 9)
      expect(a.end).toBeCloseTo(expected[k][1], 9)
    })
  })
  it('assigns one side where the sides differ, and names a template the design lacks', () => {
    const odd = parseRoadEngSettings(
      dsn({ ranges: [range(100, 'PGR'), range(200, 'RCK', 'PGR'), range(300, 'XX'), range(999999999, 'PGR')] }),
      ds2,
      1,
    )
    const m = roadEngTemplateFor(odd, along)
    expect(m.assignments.map((a) => [a.start, a.end, a.templateId, a.side])).toEqual([
      [100, 200, 'roadeng-RCK', 'left'],
    ])
    expect(m.unmapped).toContain(
      'Template XX on the left from station 200 to 300 m, which the design does not hold; the base section applies there.',
    )
  })
  it('leaves out a ditch the template switches off, and one PGMaps cannot draw', () => {
    const off = ditchI.map((p): Param => (p[0] === 'bDitchInclude' ? [p[0], p[1], 0] : p))
    const t = roadEngTemplateFor(parseRoadEngSettings(dsn({ ditch: off }), ds2, 1), along).template!
    expect([t.ditchWidth, t.ditchDepth]).toEqual([0, 0])
    const wide = ditchI.map((p): Param => (p[0] === 'DitchBotWd' ? [p[0], p[1], 9] : p))
    const m = roadEngTemplateFor(parseRoadEngSettings(dsn({ ditch: wide }), ds2, 1), along)
    expect(m.template!.ditchWidth).toBe(0)
    expect(m.unmapped.join('\n')).toMatch(/each ditch \(12.6 m wide, 0.6 m deep\) is past PGMaps' 10 m by 5 m ditch/)
  })
  it('says when a template has no roadway it can read', () => {
    const t = { ...parseRoadEngSettings(dsn(), ds2, 1).templates[1] }
    t.components = t.components.filter((c) => c.className !== 'RDWY')
    const m = roadEngTemplateToPgmaps(t, fallback)
    expect(m.template).toBeNull()
    expect(m.unmapped.join()).toMatch(/no roadway component PGMaps reads/)
  })
})

describe('roadEngCurveDesignFor', () => {
  it('fits PGMaps’ one rule to RoadEng’s curves and shows both', () => {
    const { curveDesign, comparison, notes } = roadEngCurveDesignFor(parseRoadEngSettings(dsn(), ds2, 1))
    expect(curveDesign).toMatchObject({
      criteriaName: 'RoadEng: forest two lane',
      designSpeedKmh: 60,
      maxSuperelevationPercent: 6,
      sideFrictionFactor: 0.12,
      runoffLengthM: 40,
      wideningVehicleLengthM: null,
    })
    for (const c of comparison) expect(c.pgmapsPercent).toBeCloseTo(c.roadEngPercent, 6)
    expect(notes.join()).toMatch(/66.7 % of each transition before the curve/)
  })
  it('makes no rule from a design without curves', () => {
    const none = roadEngCurveDesignFor(parseRoadEngSettings(dsn(), '', 1))
    expect(none.curveDesign).toBeNull()
  })
})

describe('roadEngMaterialsFor', () => {
  const s = parseRoadEngSettings(dsn(), ds2, 1)
  const { materials, strata, notes } = roadEngMaterialsFor(s, { startStation: 0, endStation: 400 })
  it('carries slopes, the compacted/bank factor and the excavation cost, never rock', () => {
    expect(materials).toEqual([
      {
        id: 'roadeng-OB',
        name: 'OB · Overburden (Default)',
        color: expect.stringMatching(/^#[0-9a-f]{6}$/),
        cutRate: 12,
        reusableFraction: 1,
        compactionFactor: 0.8,
        volumeFactorProvenance: {
          convention: 'bank-per-compacted',
          enteredFactor: 1.25,
          canonicalFactor: 0.8,
          source: 'RoadEng ground type OB: fill expansion factor 1.25 (cut 1).',
        },
        cutSlope: 0.25,
        fillSlope: 1,
      },
      expect.objectContaining({ id: 'roadeng-SR', compactionFactor: 1.25, cutRate: 48, cutSlope: 0.25 }),
    ])
    expect(materials.some((m) => m.rock)).toBe(false)
    expect(notes.join()).toMatch(/No material is marked rock/)
  })
  it('keeps the templates’ batters when asked, listing the ground types’ slopes', () => {
    const m = roadEngMaterialsFor(s, { startStation: 0, endStation: 400, materialBatters: false })
    expect(m.materials.some((x) => x.cutSlope !== undefined || x.fillSlope !== undefined)).toBe(false)
    expect(m.notes.join()).toMatch(/only for a template slope set to AUTO.*OB cut 0.25:1, fill 1:1; SR cut 0.25:1/)
  })
  it('turns ground layers into horizons over their ranges', () => {
    expect(strata.map((h) => [h.start, h.end, h.materialId, h.topDepthM, h.bottomDepthM])).toEqual([
      [0, 100, 'roadeng-OB', 0, null],
      [100, 200, 'roadeng-OB', 0, 0.5],
      [100, 200, 'roadeng-SR', 0.5, null],
      [200, 400, 'roadeng-OB', 0, null],
    ])
  })
})

describe('roadEngEngineeringFor', () => {
  it('passes the project’s own validation', () => {
    const result = roadEngEngineeringFor(parseRoadEngSettings(dsn(), ds2, 1), along)
    expectValidProject(result.template!, result.engineering, result.curveDesign)
  })
})

describe('ditch backslope above the road edge', () => {
  // Ditch I with a 3:1 backslope running 2.6 m above its bottom (2 m above the road edge).
  const tall = ditchI.map(
    (p): Param => (p[0] === 'DitchBackSlpHt' ? [p[0], p[1], 2.6] : p[0] === 'DitchBackSlp' ? [p[0], p[1], 1 / 3] : p),
  )
  const s = parseRoadEngSettings(dsn({ ditch: tall }), ds2, 1)
  it('becomes the cut batter by default, with what lies above it listed', () => {
    const m = roadEngTemplateFor(s, along)
    expect(m.template).toMatchObject({ cutSlope: 3, ditchDepth: 0.6, ditchBottomWidth: 1 })
    // The ditch keeps RoadEng's top width: 1 m + 0.6 m at 4:1 + 0.6 m at 3:1.
    expect(m.template!.ditchWidth).toBeCloseTo(5.2, 6)
    expect(m.template!.components).toBeUndefined()
    expect(m.unmapped.join('\n')).toMatch(
      /above 2 m over the road edge RoadEng turns its ditch backslope \(3:1\) into a 0.5:1 closing cut slope/,
    )
    validateTemplate(m.template!)
  })
  it('becomes a cut-side slope component when asked, with the closing slope as the cut batter', () => {
    const m = roadEngTemplateFor(s, { ...along, ditchBackslope: 'component' })
    expect(m.template!.cutSlope).toBe(0.5)
    expect(m.template!.components).toEqual([
      expect.objectContaining({ side: 'left', kind: 'slope', condition: 'cut', riseM: 2, widthM: 6 }),
      expect.objectContaining({ side: 'right', kind: 'slope', condition: 'cut', riseM: 2, widthM: 6 }),
    ])
    expect(m.notes.join('\n')).toMatch(/ditch backslope runs at 3:1 for 2 m above the road edge as a slope component/)
    validateTemplate(m.template!)
  })
  it('records where each value came from', () => {
    const { sources } = roadEngTemplateToPgmaps(s.templates[1], fallback)
    expect(sources.left.width).toEqual([
      { kind: 'parameter', template: 1, component: 0, parameter: 1, name: 'AcpWidth' },
      { kind: 'parameter', template: 1, component: 0, parameter: 5, name: 'ShoulderGravWidth' },
    ])
    expect(sources.right.crossfall).toEqual([
      { kind: 'header', template: 1, field: 4 },
      { kind: 'parameter', template: 1, component: 1, parameter: 6, name: '_SUPER' },
    ])
    expect(sources.left.cutSlope).toMatchObject({ component: 2, name: 'DitchBackSlp' })
    expect(sources.left.fillSlope).toMatchObject({ component: 4, name: 'FinalFillSlp' })
    expect(sources.left.ditch).toMatchObject({ depth: { name: 'DitchDepth' }, inslope: { name: 'DitchInSlp' } })
    expect(sources.left.backslope).toEqual({ mode: 'batter', heightM: 2.6, depthM: 0.6 })
    expect(Object.keys(sources.left.layers!)).toEqual(['acpthick', 'basethick', 'subbasethick'])
  })
})

describe('Slope VI benches', () => {
  const BENCHES = '11,SLPS,Slope VI - Benches!^!Up to 5 benches.,8,0,145'
  const benches: Param[] = [
    ['bApplyInCut', 0, 1],
    ['bApplyInFill', 0, 0],
    ['FinalCutSlp', 1, 1],
    ['FinalFillSlp', 1, 0.5],
    ['BenchSlope', 1, 2],
    ['BenchHeight', 0, 3],
    ['BenchBaseWidth', 0, 1.5],
    ['BenchBaseSlope', 1, 0],
  ]
  const text = dsn().replace('T1-C4=', `${component(1, 6, BENCHES, 'left', benches).join('\r\n')}\r\nT1-C4=`)
  const s = parseRoadEngSettings(text, ds2, 1)
  it('takes only the closing slopes by default and lists the benches', () => {
    const m = roadEngTemplateFor(s, along)
    expect(m.template!.components).toBeUndefined()
    // Slope I, before it in the template, gives the closing slopes.
    expect(m.template!.cutSlope).toBe(0.5)
    expect(m.unmapped.join('\n')).toMatch(
      /the benches of Slope VI - Benches \(3 m slopes at 0.5:1 with 1.5 m benches\)/,
    )
  })
  it('becomes slope and bench pairs in component mode', () => {
    const m = roadEngTemplateFor(s, { ...along, ditchBackslope: 'component' })
    const left = m.template!.components!.filter((c) => c.side === 'left')
    expect(left).toHaveLength(10)
    expect(left.slice(0, 2)).toEqual([
      expect.objectContaining({ kind: 'slope', condition: 'cut', widthM: 1.5, riseM: 3 }),
      expect.objectContaining({ kind: 'bench', condition: 'cut', widthM: 1.5, riseM: 0 }),
    ])
    validateTemplate(m.template!)
  })
})

// A widening table laid out as RoadEng keeps one (radius in metres down, deflection across), with
// values worked out for this test.
const wideningTable: RoadEngSuperelevationTable = {
  index: 3,
  description: ['Widening Table - meters', '#'],
  speeds: [0, 20, 40, 60, 80, 180],
  rows: [
    { radius: 30, e: [0, 0.5, 1, 1.5, 2, 3] },
    { radius: 80, e: [0, 0, 0, 0, 0.5, 1] },
    { radius: 20000, e: [0, 0, 0, 0, 0, 0] },
  ],
}

describe('lookup tables', () => {
  // Softree's documented example: 190 m at 50 km/h reads 0.046 from its e max 0.06 table.
  const tbl = [
    '# Superelevation table, radius in meters, speed in km/hr, Emax = 0.06',
    '#',
    ',40,50,60',
    '200,0.036,0.045,0.053',
    '190,0.037,0.046,0.054',
    '180,0.038,0.047,0.055',
    '170,0.039,0.048,',
  ].join('\r\n')
  it('reads a .tbl file: comments, headings, radius rows, blank cells', () => {
    const t = parseRoadEngTbl(tbl)
    expect(t.description).toEqual([' Superelevation table, radius in meters, speed in km/hr, Emax = 0.06', '#'])
    expect(t.speeds).toEqual([40, 50, 60])
    expect(t.rows.at(-1)).toEqual({ radius: 170, e: [0.039, 0.048, null] })
    expect(parseRoadEngTbl(tbl.replace(/,/g, '\t')).rows).toEqual(t.rows)
  })
  it('interpolates superelevation linearly and refuses unsafe combinations', () => {
    const t = parseRoadEngTbl(tbl)
    expect(roadEngTableValue(t, 190, 50, 'interpolate')).toBeCloseTo(0.046, 9)
    expect(roadEngTableValue(t, 195, 55, 'interpolate')).toBeCloseTo((0.0455 + 0.0535) / 2, 9)
    expect(roadEngTableValue(t, 175, 55, 'interpolate')).toBeNull()
    expect(roadEngTableValue(t, 160, 40, 'interpolate')).toBeNull()
    expect(roadEngTableValue(t, 900, 40, 'interpolate')).toBeCloseTo(0.036, 9)
  })
  it('refuses a file that is not a table', () => {
    expect(() => parseRoadEngTbl('# only comments')).toThrow(/no table/)
    expect(() => parseRoadEngTbl(',40,50\nradius,0.1,0.2')).toThrow(/no radius/)
  })
  it('reads widening as RoadEng steps through it: row at or below, nearest column', () => {
    expect(roadEngTableValue(wideningTable, 250, 72, 'step')).toBe(0.5)
    expect(roadEngTableValue(wideningTable, 250, 65.4, 'step')).toBe(0)
    expect(roadEngTableValue(wideningTable, 79, 72, 'step')).toBe(2)
    expect(roadEngTableValue(wideningTable, 10, 20, 'step')).toBe(0.5)
  })
  it('writes the steps into PGMaps’ interpolated table so it gives the same values', () => {
    const written = roadEngWideningRows(wideningTable, 1)!
    expect(written.heldRadius).toBe(true)
    expect(written.rows.length).toBeLessThanOrEqual(400)
    const design = {
      designSpeedKmh: 50,
      maxSuperelevationPercent: 0,
      sideFrictionFactor: 0,
      runoffLengthM: 0,
      wideningVehicleLengthM: null,
      wideningTable: written.rows,
    }
    for (const radius of [25, 30, 55, 79.9, 80, 250, 5000, 9999])
      for (const deflection of [0, 9.9, 10, 31, 49, 51, 69.9, 70.1, 72, 129.9, 130.1, 180]) {
        const v = evaluateCurveCriteria(design, radius, deflection)
        const step = roadEngTableValue(wideningTable, radius, deflection, 'step')!
        expect(v.insideWideningM).toBeCloseTo(step, 9)
        expect(v.outsideWideningM).toBeCloseTo(step, 9)
      }
    expect(written.rows.some((r) => r.radiusM === 80 - ROADENG_STEP_EPSILON)).toBe(true)
  })
})

describe('roadEngWideningFor', () => {
  // Three curves: R 200 and 60 turning 75° and 30°, then R 300 with no widening.
  const widenedPi = (index: number, r: number, x: number, y: number, w: number) =>
    `108,${index},2,${r},${x},${y},0,-1,${v},5585,0.06,0.1,40,40,0.667,0.05,0.01,${w},${w},0`
  const deg = Math.PI / 180
  const p1: [number, number] = [100, 0]
  const p2: [number, number] = [p1[0] + 100 * Math.cos(75 * deg), 100 * Math.sin(75 * deg)]
  const p3: [number, number] = [p2[0] + 100 * Math.cos(105 * deg), p2[1] + 100 * Math.sin(105 * deg)]
  const end: [number, number] = [p3[0] + 100 * Math.cos(105 * deg), p3[1] + 100 * Math.sin(105 * deg)]
  const ds2W = (w1: number, w2: number) =>
    [
      widenedPi(1, 200, ...p1, w1),
      widenedPi(2, -60, ...p2, w2),
      widenedPi(3, 300, ...p3, 0),
      '110,5,0,0,900,0,-1,0,0,,,256',
      `110,5,${end[0]},${end[1]},900,400,-1,0,0,,,256`,
    ].join('\r\n')
  const table = [
    'LTable-03-Desc-00=Widening Table - meters',
    'LTable-03-Options=0',
    'LTable-03-Row-000=,0,20,40,60,80,180',
    'LTable-03-Row-001=30,0,0.5,1,1.5,2,3',
    'LTable-03-Row-002=80,0,0,0,0,0.5,1',
    'LTable-03-Row-003=20000,0,0,0,0,0,0',
  ]
  const withTable = dsn().replace('[TemplatesSct]', ['[TemplatesSct]', ...table].join('\r\n'))
  it('reads each curve’s deflection from its neighbours and the road’s ends', () => {
    const s = parseRoadEngSettings(withTable, ds2W(0.5, 1), 1)
    expect(s.curves.map((c) => Math.round(c.deflectionDegrees!))).toEqual([75, 30, 0])
  })
  it('maps the table when the curves carry widening, and compares each curve', () => {
    const s = parseRoadEngSettings(withTable, ds2W(0.5, 1), 1)
    const m = roadEngWideningFor(s)
    expect(m.wideningTable).not.toBeNull()
    expect(m.comparison.map((c) => [c.tableM, c.pgmapsInsideM])).toEqual([
      [0.5, 0.5],
      [1, 1],
      [0, 0],
    ])
    expect(m.notes.join()).toMatch(/Every curve's widening matches/)
    expect(roadEngCurveDesignFor(s).curveDesign!.wideningTable).toEqual(m.wideningTable)
  })
  it('says which curves RoadEng widened differently', () => {
    const m = roadEngWideningFor(parseRoadEngSettings(withTable, ds2W(0.5, 0.25), 1))
    expect(m.unmapped.join()).toMatch(/PI 2: 0.25\/0.25 m in RoadEng, 1\/1 m here/)
  })
  it('leaves the table off when no curve carries widening', () => {
    const m = roadEngWideningFor(parseRoadEngSettings(withTable, ds2W(0, 0), 1))
    expect(m.wideningTable).toBeNull()
    expect(m.unmapped.join()).toMatch(/none of the design's curves carries widening/)
  })
  it('reads a table whose heading row starts with 0, as older designs write it', () => {
    const old = withTable.replace('LTable-03-Row-000=,0,20', 'LTable-03-Row-000=0,0,20')
    const t = parseRoadEngSettings(old, ds2W(0.5, 1), 1).superelevationTables.find((x) => x.index === 3)!
    expect(t.speeds).toEqual([0, 20, 40, 60, 80, 180])
    expect(t.rows).toHaveLength(3)
  })
})

function expectValidProject(
  template: RoadTemplate,
  engineering: AlignmentEngineering,
  curveDesign: ReturnType<typeof roadEngCurveDesignFor>['curveDesign'],
) {
  validateTemplate(template)
  validateEngineering(engineering)
  const asParsed = (raw: unknown) => {
    validateTemplate(raw as RoadTemplate)
    return raw as RoadTemplate
  }
  expect(parseEngineering(JSON.parse(JSON.stringify(engineering)), asParsed)).toEqual(engineering)
  const project: RoadProject = createDemoProject()
  const [first, ...rest] = project.alignments
  const road = { ...first, template, engineering, ...(curveDesign ? { curveDesign } : {}) }
  const read = parseProject(JSON.parse(JSON.stringify({ ...project, alignments: [road, ...rest] })))
  expect(read.alignments[0].template).toEqual(template)
  expect(read.alignments[0].engineering?.assignments).toEqual(engineering.assignments)
  expect(read.alignments[0].curveDesign).toEqual(curveDesign ?? undefined)
}

// Softree's published sample projects (support.softree.com), read from a local copy and never
// committed: set ROADENG_SAMPLES to the folder holding the extracted archives.
const samples = process.env.ROADENG_SAMPLES
const sample = (path: string) => new Uint8Array(readFileSync(join(samples!, path)))
describe.skipIf(!samples || !existsSync(samples))('Softree sample designs', () => {
  it('maps the 27.8 km road: gravel road, rock-cut and bridge ranges, 73 curves', () => {
    const bytes = sample('LongRoad_1/LongRoad 1.dsnx')
    const [{ settings }] = readRoadEngSettings(bytes).parts
    const [road] = roadEngRoads(bytes, {
      fileName: 'LongRoad 1.dsnx',
      newId: () => 'r',
      color: () => '#123456',
      template: fallback,
      epsg: 26910,
    }).roads
    const options = {
      startStation: road.source.startStation,
      endStation: road.source.endStation,
      stationScale: road.stationScale,
      fallback,
    }
    const result = roadEngEngineeringFor(settings, options)
    // Ditch I's 3:1 backslope runs 9.4 m above the road edge before Slope I's 4:1: the cut batter.
    expect(result.template).toMatchObject({
      leftWidth: 4.2,
      rightWidth: 4.2,
      crossfallPercent: 4,
      cutSlope: 3,
      fillSlope: 4,
      ditchWidth: 8.2,
      ditchDepth: 0.6,
      ditchBottomWidth: 4,
    })
    expect(result.subgradeDepthM).toEqual({ left: 0.5, right: 0.5 })
    // RoadEng's ranges end at their station: rock cut from 1,200 to 3,600, a bridge from 18,838 to
    // 18,942.8 (the profile optimizer's ±1 % "Linear" constraint covers the same span).
    const ranges: [string, number, number][] = [
      ['roadeng-PRC', 1200, 3600],
      ['roadeng-PRC', 18600, 18838],
      ['roadeng-PGRB', 18838, 18942.8],
      ['roadeng-PRC', 18942.8, 20100],
      ['roadeng-PRC', 25250, 25900],
      ['roadeng-PGRB', 27656.7, 27678.6],
    ]
    const chainage = (s: number) => (s - road.source.startStation) * road.stationScale
    expect(result.engineering.assignments.map((a) => a.templateId)).toEqual(ranges.map((r) => r[0]))
    result.engineering.assignments.forEach((a, k) => {
      expect(a.start).toBeCloseTo(chainage(ranges[k][1]), 6)
      expect(a.end).toBeCloseTo(chainage(ranges[k][2]), 6)
      expect(a.side).toBe('both')
    })
    expect(result.engineering.templates.find((t) => t.id === 'roadeng-PRC')!.template.rockCut).toEqual({
      cutSlope: 0.25,
      ledgeWidthM: 2,
    })
    expect(result.curveDesign).toMatchObject({ designSpeedKmh: 80, maxSuperelevationPercent: 6, runoffLengthM: 60 })
    expect(result.unmapped.join('\n')).toMatch(
      /above 9.4 m over the road edge RoadEng turns its ditch backslope \(3:1\) into a 4:1 closing cut slope/,
    )
    const curves = roadEngCurveDesignFor(settings)
    expect(curves.comparison).toHaveLength(73)
    for (const c of curves.comparison) expect(Math.abs(c.pgmapsPercent - c.roadEngPercent)).toBeLessThan(0.5)
    // The widening table, read as steps, gives every curve the widening RoadEng stored for it
    // (0.5 m a side on the five tight, sharp curves, none elsewhere).
    expect(result.curveDesign!.wideningTable!.length).toBeLessThanOrEqual(400)
    expect(curves.widening.filter((c) => c.roadEngInsideM > 0)).toHaveLength(5)
    for (const c of curves.widening) {
      expect(c.tableM).toBeCloseTo(c.roadEngInsideM, 6)
      expect(c.pgmapsInsideM).toBeCloseTo(c.roadEngInsideM, 6)
      expect(c.pgmapsOutsideM).toBeCloseTo(c.roadEngOutsideM, 6)
    }
    expect(result.notes.join()).toMatch(/Every curve's widening matches what RoadEng stored for it/)
    expect(result.engineering.materials.map((m) => m.id)).toEqual([
      'roadeng-OB',
      'roadeng-GR',
      'roadeng-HP',
      'roadeng-SR',
      'roadeng-FR',
    ])
    expect(result.engineering.strata.filter((h) => h.materialId === 'roadeng-SR').map((h) => h.topDepthM)).toEqual([
      0.25, 0.25, 0.25,
    ])
    expectValidProject(result.template!, result.engineering, result.curveDesign)
    const project = createDemoProject()
    const read = parseProject(
      JSON.parse(
        JSON.stringify({
          ...project,
          activeAlignmentId: road.alignment.id,
          alignments: [
            {
              ...road.alignment,
              template: result.template,
              engineering: result.engineering,
              curveDesign: result.curveDesign,
            },
          ],
        }),
      ),
    )
    expect(read.alignments[0].engineering?.templates).toHaveLength(2)
  })
  it('maps the cul-de-sac road and names the template the design does not hold', () => {
    const bytes = sample('Cul-de-sac-design/CulDeSacExample/CulDeSacExampleComplete.dsnx')
    const design = parseRoadEngDesign(bytes)
    const parts = readRoadEngSettings(bytes).parts
    const at = (k: number) => ({
      startStation: design.alignments[k].startStation,
      endStation: design.alignments[k].endStation,
      fallback,
    })
    const main = roadEngEngineeringFor(parts[0].settings, at(0))
    expect(main.template).toMatchObject({ leftWidth: 5.1, rightWidth: 5.1, crossfallPercent: 3, ditchDepth: 1 })
    expect(main.notes.join()).toMatch(/along reference feature 2/)
    expectValidProject(main.template!, main.engineering, main.curveDesign)
    const branchCurves = roadEngCurveDesignFor(parts[1].settings)
    expect(branchCurves.curveDesign!.wideningTable).toBeUndefined()
    expect(branchCurves.unmapped.join()).toMatch(/none of the design's curves carries widening/)
    const branch = roadEngTemplateFor(parts[1].settings, at(1))
    expect(branch.template).toBeNull()
    expect(branch.unmapped.join()).toMatch(/Template BR on the left .* which the design does not hold/)
  })
  it('maps a foot design to metres', () => {
    const bytes = sample('RoadEng-LandXML-Civil-3D/Align stage 1.dsnx')
    const [a] = parseRoadEngDesign(bytes).alignments
    const [{ settings }] = readRoadEngSettings(bytes).parts
    expect(settings.unitM).toBe(0.3048)
    const result = roadEngEngineeringFor(settings, {
      startStation: a.startStation,
      endStation: a.endStation,
      fallback,
    })
    // 12 ft of pavement and a 6 ft shoulder a side.
    expect(result.template!.leftWidth).toBeCloseTo(18 * 0.3048, 6)
    expect(result.curveDesign!.designSpeedKmh).toBeCloseTo(64.37, 2)
    expectValidProject(result.template!, result.engineering, result.curveDesign)
  })
})
