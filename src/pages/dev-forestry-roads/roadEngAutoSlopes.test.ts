import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  parseRoadEngSettings,
  readRoadEngSettings,
  roadEngDefaultGroundType,
  roadEngEngineeringFor,
  roadEngTemplateFor,
} from './roadEngDesignSettings'
import { mergeRoadEngIni } from './roadEngExport'
import { roadEngDesignWriteBack } from './roadEngParameterOverrides'
import { DEFAULT_TEMPLATE } from './terrain'
import { validateEngineering, validateTemplate } from './templates'
import type { TemplateParameterOverride } from './templateParameterOverrides'
import type { Alignment, RoadTemplate } from './types'

// A generated design laid out as RoadEng 11 writes it (no Softree sample uses an override): a gravel
// road whose closing slopes are on AUTO (flag 2 beside the slope flag, as in Softree's tutorial
// design), ground given as the default type `**`, and a landing widening the right lane between
// 110 and 190 m, entered as RoadEng's Parameter Overrides.
type Param = [name: string, flags: number, value: number]
function component(t: number, c: number, head: string, side: 'left' | 'right' | 'both', params: Param[]) {
  const lines = [`T${t}-C${c}=${head}`]
  const sides = side === 'both' ? [1, 0] : [side === 'left' ? 1 : 0]
  sides.forEach((bit, f) => lines.push(`T${t}-C${c}-F${f}=1,SGL,Fragment,${131072 + bit},1,0,0,-`))
  params.forEach(([name, flags, value], u) =>
    lines.push(`T${t}-C${c}-U${u}=${name}~${name}.|${flags}|${value}|-1|0|1000|`),
  )
  return lines
}
const rural: Param[] = [
  ['AcpThick', 0, 0],
  ['AcpWidth', 256, 4],
  ['_SUPER', 37, -0.03],
]
const RURAL = '4,RDWY,Rural I!^!Lane.,3,0,146'
const SLOPES = '2,SLPS,Slopes Default!^!Closing slopes.,2,0,129'
const range = (end: number, fill = '*1', ground = '**', depth = '999999', below = '-') =>
  `${end},0,0,0,0,0,0,0,0,0,-,${fill},${depth},${below},999999,-,${ground},LLB,LLB,RE,RE,0,0,-1,-1,0,0,0,0,RE,RE,9999,999999000,1`
const OVERRIDES = [
  '100|8193|AcpWidth|**|Alignment Start',
  '110|8193|AcpWidth|8|Alignment Start',
  '190|8193|AcpWidth|8|Alignment Start',
  '200|8193|AcpWidth|**|Alignment End',
]
function dsn({ auto = 3, ranges = [range(999999999)], overrides = OVERRIDES } = {}) {
  return [
    '[design]',
    `ParmOverrides-1=${overrides.length}`,
    ...overrides.map((o, k) => `ParmOverrides-${k + 2}=${o}`),
    'units=10000',
    '[LocationParms]',
    ...ranges.map((r, k) => `${k}=${r}`),
    `nparams=${ranges.length}`,
    '[TemplatesSct]',
    'T0=3,LLB,Rural 8m Gravel,-0.03,-0.03,1,0,2,2',
    ...component(0, 0, RURAL, 'left', rural),
    ...component(0, 1, RURAL, 'right', rural),
    ...component(0, 2, SLOPES, 'both', [
      ['FinalSlpL', auto, 1],
      ['FinalSlpR', auto, 1],
    ]),
    '',
  ].join('\r\n')
}
// The cul-de-sac's ground types: OB cuts at 2.5:1 (40 %) and fills at 4:1 (25 %).
const ds2 = [
  '100,103,11,11.0.673.0, Softree Technical Systems Inc. - Location Line data file',
  '104,OB,Overburden (Default),25,40,1,1.25,12,4,0,8,0.6,4,2.6,2,0,0,0,8,',
  '104,SR,Solid Rock,100,400,1,0.8,48,4,0,8,0.6,4,2.6,2,3,0,0,8,',
].join('\r\n')
const fallback: RoadTemplate = { ...DEFAULT_TEMPLATE }
const frame = { startStation: 0, endStation: 300, fallback }

describe('RoadEng AUTO slopes', () => {
  const s = parseRoadEngSettings(dsn(), ds2, 1)
  const mapped = roadEngEngineeringFor(s, frame)
  it('reads a slope on AUTO from its parameter’s flag', () => {
    const slopes = s.templates[0].components[2].parameters
    expect(slopes.map((p) => [p.name, p.auto])).toEqual([
      ['FinalSlpL', true],
      ['FinalSlpR', true],
    ])
    expect(parseRoadEngSettings(dsn({ auto: 1 }), ds2, 1).templates[0].components[2].parameters[0].auto).toBe(false)
  })
  it('makes the template take the ground types’ slopes, and the ground types carry them', () => {
    expect(mapped.template).toMatchObject({
      cutSlope: 1,
      fillSlope: 1,
      cutSlopeFrom: 'material',
      fillSlopeFrom: 'material',
    })
    validateTemplate(mapped.template!)
    expect(mapped.engineering.materials.find((m) => m.id === 'roadeng-OB')).toMatchObject({
      cutSlope: 2.5,
      fillSlope: 4,
    })
    expect(mapped.notes.join('\n')).toMatch(/left cut, left fill, right cut, right fill slopes are AUTO in RoadEng/)
    const stated = roadEngTemplateFor(parseRoadEngSettings(dsn({ auto: 1 }), ds2, 1), frame).template
    expect(stated).toMatchObject({ cutSlopeFrom: 'template', fillSlopeFrom: 'template' })
  })
  it('reads ** as the design’s default ground type, OB', () => {
    expect(roadEngDefaultGroundType(s.materials)?.code).toBe('OB')
    expect(mapped.engineering.strata).toEqual([
      { id: 'roadeng-horizon-1', start: 0, end: 300, materialId: 'roadeng-OB', topDepthM: 0, bottomDepthM: null },
    ])
    expect(mapped.notes.join('\n')).toMatch(/default ground type \(\*\*\) is OB · Overburden/)
    expect(mapped.unmapped.join('\n')).not.toMatch(/\*\*/)
  })
  it('makes a range’s fill material other than layer 1’s a fill requirement', () => {
    const ranges = [range(100), range(150, '*2', 'OB', '-1', 'SR'), range(999999999, 'SR')]
    const m = roadEngEngineeringFor(parseRoadEngSettings(dsn({ ranges }), ds2, 1), frame)
    expect(m.engineering.fillRequirements).toEqual([
      { id: 'roadeng-fill-1', start: 100, end: 300, layer: 'subgrade', materialId: 'roadeng-SR', replaceable: true },
    ])
    validateEngineering(m.engineering)
  })
  it('reads parameter overrides as station values of the side value they move', () => {
    expect(s.parameterOverrides).toBe(4)
    expect(s.parameterOverrideEntries.map((e) => [e.station, e.code, e.parameter, e.raw, e.description])).toEqual([
      [100, 8193, 'AcpWidth', null, 'Alignment Start'],
      [110, 8193, 'AcpWidth', 8, 'Alignment Start'],
      [190, 8193, 'AcpWidth', 8, 'Alignment Start'],
      [200, 8193, 'AcpWidth', null, 'Alignment End'],
    ])
    expect(mapped.engineering.parameterOverrides).toEqual([
      {
        id: 'roadeng-override-1-right-Width',
        name: 'AcpWidth (right)',
        side: 'right',
        field: 'Width',
        points: [
          { station: 100, value: null },
          { station: 110, value: 8 },
          { station: 190, value: 8 },
          { station: 200, value: null },
        ],
        roadEng: { parameter: 'AcpWidth', code: 8193, entries: OVERRIDES },
      },
    ])
    validateEngineering(mapped.engineering)
    expect(mapped.notes.join('\n')).toMatch(
      /override of AcpWidth, right side \(4 stations\) becomes station values of the right width/,
    )
  })
  it('says what an override of a value PGMaps does not draw leaves', () => {
    const m = roadEngEngineeringFor(
      parseRoadEngSettings(dsn({ overrides: ['50|0|AcpThick|0.2|Alignment Start'] }), ds2, 1),
      frame,
    )
    expect(m.engineering.parameterOverrides).toBeUndefined()
    expect(m.unmapped.join('\n')).toMatch(/AcpThick is not a value PGMaps' section reads/)
  })
})

describe('RoadEng AUTO slopes and overrides written back', () => {
  const text = dsn()
  const s = parseRoadEngSettings(text, ds2, 1)
  const mapped = roadEngEngineeringFor(s, frame)
  const original = { dsnText: text, ds2Text: ds2, unitM: 1, ...frame }
  const road = (patch: Partial<Alignment>): Pick<Alignment, 'template' | 'engineering' | 'name'> => ({
    name: 'Spur',
    template: mapped.template!,
    engineering: mapped.engineering,
    ...patch,
  })
  const apply = (w: ReturnType<typeof roadEngDesignWriteBack>) =>
    mergeRoadEngIni(mergeRoadEngIni(text, w.templates), w.alignment)
  it('writes nothing for an unedited road', () => {
    const w = roadEngDesignWriteBack(road({}), original, text)
    expect(w.templates).toEqual({})
    expect(w.alignment).toEqual({})
    expect(apply(w)).toBe(text)
  })
  it('clears AUTO on the slope parameter whose source changed', () => {
    const w = roadEngDesignWriteBack(
      road({ template: { ...mapped.template!, cutSlopeFrom: 'template', fillSlopeFrom: 'template' } }),
      original,
      text,
    )
    expect(w.templates).toEqual({
      TemplatesSct: {
        'T0-C2-U0': 'FinalSlpL~FinalSlpL.|1|1|-1|0|1000|',
        'T0-C2-U1': 'FinalSlpR~FinalSlpR.|1|1|-1|0|1000|',
      },
    })
    const back = roadEngTemplateFor(parseRoadEngSettings(apply(w), ds2, 1), frame).template
    expect(back).toMatchObject({ cutSlopeFrom: 'template', fillSlopeFrom: 'template' })
  })
  it('keeps one closing slope’s AUTO when cut and fill differ, and says so', () => {
    const w = roadEngDesignWriteBack(
      road({ template: { ...mapped.template!, cutSlopeFrom: 'template' } }),
      original,
      text,
    )
    expect(w.templates).toEqual({})
    expect(w.notWritten.join('\n')).toMatch(/RoadEng's one closing slope \(FinalSlpL\) cannot hold/)
  })
  it('writes an edited override from PGMaps’ stations and reads back the same', () => {
    const [o] = mapped.engineering.parameterOverrides!
    const edited: TemplateParameterOverride = {
      ...o,
      points: o.points.map((p) => (p.value === null ? p : { ...p, value: 10 })),
    }
    const w = roadEngDesignWriteBack(
      road({ engineering: { ...mapped.engineering, parameterOverrides: [edited] } }),
      original,
      text,
    )
    expect(w.alignment).toEqual({
      design: {
        'ParmOverrides-3': '110|8193|AcpWidth|10|Alignment Start',
        'ParmOverrides-4': '190|8193|AcpWidth|10|Alignment Start',
      },
    })
    const back = roadEngEngineeringFor(parseRoadEngSettings(apply(w), ds2, 1), frame)
    expect(back.engineering.parameterOverrides![0].points).toEqual(edited.points)
  })
  it('writes an override added here into the parameter the side value came from', () => {
    const added: TemplateParameterOverride = {
      id: 'cut',
      name: 'Left cut',
      side: 'left',
      field: 'CutSlope',
      points: [
        { station: 50, value: null },
        { station: 60, value: 2 },
      ],
    }
    const w = roadEngDesignWriteBack(
      road({
        engineering: { ...mapped.engineering, parameterOverrides: [...mapped.engineering.parameterOverrides!, added] },
      }),
      original,
      text,
    )
    // FinalSlpL, on the left: RoadEng's code for the left side, 4096, and the override's name.
    expect(w.alignment.design).toMatchObject({
      'ParmOverrides-1': '6',
      'ParmOverrides-6': '50|4096|FinalSlpL|**|Left cut',
      'ParmOverrides-7': '60|4096|FinalSlpL|0.5|Left cut',
    })
    const back = roadEngEngineeringFor(parseRoadEngSettings(apply(w), ds2, 1), frame).engineering.parameterOverrides!
    // The closing slope is cut and fill at once in RoadEng, so it reads back on both.
    expect(back.find((x) => x.side === 'left' && x.field === 'CutSlope')!.points).toEqual(added.points)
    expect(back.find((x) => x.side === 'left' && x.field === 'FillSlope')!.points).toEqual(added.points)
  })
  it('drops the entries of an override removed here', () => {
    const w = roadEngDesignWriteBack(
      road({ engineering: { ...mapped.engineering, parameterOverrides: [] } }),
      original,
      text,
    )
    expect(w.alignment.design).toEqual({
      'ParmOverrides-1': '0',
      'ParmOverrides-2': null,
      'ParmOverrides-3': null,
      'ParmOverrides-4': null,
      'ParmOverrides-5': null,
    })
  })
})

const samples = process.env.ROADENG_SAMPLES
describe.skipIf(!samples)('Softree samples: AUTO slopes and the default ground type', () => {
  const read = (path: string) => {
    const file = join(samples!, path)
    return existsSync(file) ? readRoadEngSettings(new Uint8Array(readFileSync(file))) : null
  }
  it('takes the cul-de-sac’s ground on ** as OB and its AUTO closing slopes from it', () => {
    const design = read('Cul-de-sac-design/CulDeSacExample/CulDeSacExampleComplete.dsnx')
    if (!design) return
    const s = design.parts[0].settings
    const m = roadEngEngineeringFor(s, { startStation: 0, endStation: 1500, fallback })
    // LLB (Rural 8m Gravel) closes on Slopes Default, both slopes on AUTO.
    const llb = m.engineering.templates.find((t) => t.id === 'roadeng-LLB')?.template ?? m.template!
    expect(llb).toMatchObject({ cutSlopeFrom: 'material', fillSlopeFrom: 'material' })
    expect(m.engineering.strata.every((h) => h.materialId === 'roadeng-OB')).toBe(true)
    expect(m.engineering.materials.find((x) => x.id === 'roadeng-OB')).toMatchObject({ cutSlope: 2.5, fillSlope: 4 })
  })
  it('keeps LongRoad’s stated slopes: no template it uses is on AUTO', () => {
    const design = read('LongRoad_1/LongRoad 1.dsnx')
    if (!design) return
    const m = roadEngEngineeringFor(design.parts[0].settings, { startStation: 0, endStation: 27_700, fallback })
    for (const t of [m.template!, ...m.engineering.templates.map((x) => x.template)])
      expect(t).toMatchObject({ cutSlopeFrom: 'template', fillSlopeFrom: 'template' })
    expect(design.parts[0].settings.parameterOverrides).toBe(0)
  })
})
