import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  evaluateRoadEngExpression,
  readRoadEngFragments,
  roadEngParameterRef,
  roadEngParameterValues,
  roadEngRoadwayConstruction,
} from './roadEngConstruction'
import {
  parseRoadEngSettings,
  readRoadEngIni,
  readRoadEngSettings,
  roadEngTemplateToPgmaps,
} from './roadEngDesignSettings'
import { validateTemplate } from './templates'
import type { RoadTemplate } from './types'

const fallback: RoadTemplate = {
  leftWidth: 3,
  rightWidth: 3,
  crossfallPercent: 2,
  cutSlope: 1,
  fillSlope: 1.5,
  ditchWidth: 0,
  ditchDepth: 0,
  surfaceDepth: 0,
}

/** A parameter word: bit 15 + its U number, plus 1 for a depth below the attachment point. */
const word = (u: number, below = false) => String(2 ** (15 + u) + (below ? 1 : 0))

type Param = [name: string, value: number, flags?: number, formula?: string]
type Leg = {
  distance?: number
  slope?: number
  vertical?: boolean
  /** Bit 53, the leg falls; a vertical leg falls unless this says otherwise. */
  falls?: boolean
  /** Bit 6, its distance is along the leg. */
  along?: boolean
  code?: string
  terms?: [number, number][]
  slopeParam?: number
  distanceParam?: number
}
type Fragment = { type: string; name: string; surface: number; height?: string; attach?: string; legs: Leg[] }

/** One roadway component's records, written the way a design's template table holds them (generated here). */
function component(
  prefix: string,
  name: string,
  side: 'left' | 'right',
  params: Param[],
  fragments: Fragment[],
  className = 'RDWY',
) {
  const lines = [`${prefix}=${fragments.length},${className},${name}!^!Generated,${params.length},0,146,0,0,0,0,,0,`]
  params.forEach(([p, v, flags = 0, formula], u) => {
    lines.push(`${prefix}-U${u}=${p}~generated|${flags}|${v}|-1|0|1000|`)
    if (formula) lines.push(`${prefix}-U${u}-1=${formula}`)
  })
  fragments.forEach((f, k) => {
    const bits = side === 'left' ? 131073 : 131072
    lines.push(
      `${prefix}-F${k}=${f.legs.length},${f.type},${f.name},${bits},${f.surface},0,0,${f.attach ?? '-'},0,0,--,0,${f.height ?? 0},0,0`,
    )
    f.legs.forEach((l, j) => {
      const flags =
        l.vertical || l.falls || l.along
          ? String(
              (l.vertical ? 2n ** 7n : 0n) +
                ((l.falls ?? l.vertical) ? 2n ** 53n : 0n) +
                (l.along ? 2n ** 6n : 0n) +
                12n,
            )
          : '69148'
      const terms = (l.terms ?? []).flatMap(([a, b]) => ['0', '-0', word(a), word(b)])
      lines.push(
        `${prefix}-F${k}-L${j}=${[l.distance ?? 1, l.slope ?? 0, flags, -1, l.code ?? '--', (l.terms ?? []).length, ...terms, 0, l.slopeParam ?? -1, l.distanceParam ?? -1].join(',')}`,
      )
    })
  })
  return lines
}

// A rural roadway: lane and shoulder, three courses whose edges run out at their fill slopes, the
// shoulder's own fall in an adjustment term, the subgrade the three thicknesses down.
const RURAL: Param[] = [
  ['AcpThick', 0.1],
  ['AcpWidth', 3.5],
  ['BaseThick', 0.2],
  ['BaseFillSlope', 0.5, 1],
  ['SubbaseThick', 0.3],
  ['SubbaseFillSlope', 0.25, 1],
  ['_SUPER', -0.02, 37],
  ['ShoulderWidth', 1],
  ['ShoulderSlope', -0.04, 1],
  // Stored values are stale on purpose: the expressions are what count.
  ['ROAD_WIDTH', 9, 0, 'AcpWidth+ShoulderWidth'],
  ['SG_DEPTH', 9, 0, 'AcpThick + BaseThick + SubbaseThick'],
  ['BASE_DEPTH', 9, 0, 'AcpThick + BaseThick'],
  ['S_ADJ', 9, 64, 'AcpThick + ((ShoulderSlope - _SUPER) / 100) * ShoulderWidth'],
]
const ruralFragments: Fragment[] = [
  {
    type: 'SGL',
    name: 'Subgrade',
    surface: 1,
    height: word(10, true),
    legs: [
      {
        code: 'RE-',
        distanceParam: 9,
        terms: [
          [12, 3],
          [2, 3],
          [4, 5],
        ],
      },
    ],
  },
  {
    type: 'SGL',
    name: 'Sub-base',
    surface: 2,
    height: word(11, true),
    legs: [{ distanceParam: 9, terms: [[2, 3]] }],
  },
  { type: 'SGL', name: 'Base', surface: 3, height: word(0, true), legs: [{ distanceParam: 1 }] },
  { type: '-?-', name: 'Surface', surface: 4, legs: [{ distanceParam: 1 }] },
]
// A paved road whose pavement is set into the crushed course: the subgrade CSTC + base down.
const PAVED: Param[] = [
  ['ACP_THICK', 0.1],
  ['ACP_WIDTH', 3.6],
  ['CSTC_THICK', 0.3],
  ['CSTC_SLOPE', 0.5, 1],
  ['BASE_THICK', 0.6],
  ['BASE_SLOPE', 0.5, 1],
  ['SG_DEPTH', 0, 0, '-(CSTC_THICK + BASE_THICK)'],
  ['SB_DEPTH', 0, 0, '-CSTC_THICK'],
  ['ACP_DEPTH', 0, 0, '-ACP_THICK'],
]
const pavedFragments: Fragment[] = [
  {
    type: 'SGL',
    name: 'Subgrade',
    surface: 1,
    height: word(6),
    legs: [
      {
        code: 'RE-',
        distanceParam: 1,
        terms: [
          [2, 3],
          [4, 5],
        ],
      },
    ],
  },
  { type: 'SGL', name: 'Sub-Base-Bot', surface: 2, height: word(7), legs: [{ distanceParam: 1, terms: [[2, 3]] }] },
  { type: '-?-', name: 'Sub-Base-Top', surface: 3, height: word(8), legs: [{ distanceParam: 1 }] },
  { type: '-?-', name: 'Surface', surface: 4, legs: [{ distanceParam: 1 }] },
]
// A resource road on its subgrade: the profile is the subgrade, the surfacing lies above it.
const RESOURCE: Param[] = [
  ['Width', 2.5],
  ['Srf1Thick', 0.2],
  ['Srf1FillSlope', 0.5, 1],
  ['bAlignAtTop', 0],
  ['SGVOffset', 9, 96, 'if (bAlignAtTop, -Srf1Thick, 0)'],
  ['Srf1VOffset', 9, 96, 'if (bAlignAtTop, 0, Srf1Thick)'],
]
const resourceFragments: Fragment[] = [
  {
    type: 'SGL',
    name: 'Subgrade',
    surface: 1,
    height: word(4),
    legs: [{ code: 'RE-', distanceParam: 0, terms: [[1, 2]] }],
  },
  { type: 'SGL', name: 'Surface 1', surface: 2, height: word(5), legs: [{ distanceParam: 0 }] },
]

function design(code: string, params: Param[], fragments: Fragment[]) {
  return [
    '[TemplatesSct]',
    `T0=2,${code},Generated,-0.02,-0.02,1,0,2,2`,
    ...component('T0-C0', 'Generated roadway', 'left', params, fragments),
    ...component('T0-C1', 'Generated roadway', 'right', params, fragments),
  ].join('\r\n')
}
const read = (code: string, params: Param[], fragments: Fragment[], unitM = 1) =>
  parseRoadEngSettings(design(code, params, fragments), '', unitM).templates[0]

describe('RoadEng expressions', () => {
  const values: Record<string, number> = { A: 2, B: 3, BFLAG: 1, ZERO: 0 }
  const ev = (text: string) => evaluateRoadEngExpression(text, (n) => values[n.toUpperCase()])
  it('reads arithmetic, comparisons, & and |, and the library functions', () => {
    expect(ev('A + B * 2 - (A - 1) / 2')).toBeCloseTo(7.5, 12)
    expect(ev('-A + +B')).toBe(1)
    expect(ev('(A = 2) & (B > 2)')).toBe(1)
    expect(ev('(A < 1) | ZERO')).toBe(0)
    expect(ev('(A <> 2) | (B >= 3)')).toBe(1)
    expect(ev('if (bFlag, A, B)')).toBe(2)
    expect(ev('if (ZERO, A, B)')).toBe(3)
    expect(ev('max(A, B, 1) + min(A, B) + abs(-A) + floor(2.7) + sqrt(16)')).toBe(3 + 2 + 2 + 2 + 4)
    expect(ev('2*A*sin(3.1415926/2)')).toBeCloseTo(4, 6)
    expect(ev('atan(1) * (180 / 3.14159265358979)')).toBeCloseTo(45, 6)
  })
  it('leaves what it cannot evaluate', () => {
    expect(ev('_FRAG_DY + A')).toBeNull()
    expect(ev('unknown(A)')).toBeNull()
    expect(ev('if (A, B)')).toBeNull()
    expect(ev('A +')).toBeNull()
    expect(ev('A / ZERO')).toBeNull()
  })
  it('evaluates parameters through one another with slopes in percent', () => {
    const t = read('RU', RURAL, ruralFragments)
    const v = roadEngParameterValues(t.components[0])
    expect(v.get('ROAD_WIDTH')).toEqual({ expression: 4.5, stored: false })
    // −4 % shoulder less the −2 % crown, over 1 m, below a 0.1 m pavement.
    expect(v.get('S_ADJ')!.expression).toBeCloseTo(0.08, 12)
    expect(v.get('_SUPER')!.expression).toBeCloseTo(-2, 12)
  })
})

describe('RoadEng parameter words, fragments and legs', () => {
  it('names one parameter by its bit and keeps the low bit', () => {
    expect(roadEngParameterRef('8589934593')).toEqual({ index: 18, low: true })
    expect(roadEngParameterRef('33554432')).toEqual({ index: 10, low: false })
    expect(roadEngParameterRef('0')).toBeNull()
    expect(roadEngParameterRef('3')).toBeNull()
    expect(roadEngParameterRef('6291456')).toBeNull()
  })
  it('reads fragments, legs and their terms', () => {
    const section = readRoadEngIni(design('RU', RURAL, ruralFragments)).get('TemplatesSct')!
    const [subgrade, , , surface] = readRoadEngFragments(section, 'T0-C0-')
    expect(subgrade).toMatchObject({ surfaceType: 'SGL', name: 'Subgrade', side: 'left', surface: 1 })
    expect(subgrade.height).toEqual({ index: 10, low: true })
    expect(subgrade.legs[0]).toMatchObject({
      code: 'RE-',
      distanceParameter: 9,
      slopeParameter: null,
      vertical: false,
      terms: [
        { numerator: 12, denominator: 3 },
        { numerator: 2, denominator: 3 },
        { numerator: 4, denominator: 5 },
      ],
    })
    expect(surface).toMatchObject({ surfaceType: '-?-', height: null })
  })
})

describe('a roadway from its construction', () => {
  it('puts the subgrade edge at the road width plus each course over its fill slope', () => {
    const t = read('RU', RURAL, ruralFragments)
    const b = roadEngRoadwayConstruction(t.components[0], 'left', 1)!
    // 4.5 + 0.08 / 0.5 + 0.2 / 0.5 + 0.3 / 0.25.
    expect(b.subgradeEdgeM).toBeCloseTo(6.26, 12)
    expect(b.width).toEqual({ parameter: 'ROAD_WIDTH', valueM: 4.5, calculated: true })
    expect(b.subgradeDepthM).toBeCloseTo(0.6, 12)
    expect(b.surfaceDepthsM).toEqual([0, 0.1, 0.3, 0.6])
    expect(roadEngRoadwayConstruction(t.components[0], 'right', 1)).toBeNull()
    expect(roadEngRoadwayConstruction(t.components[1], 'right', 1)!.subgradeEdgeM).toBeCloseTo(6.26, 12)
  })
  it('maps it: formation, courses and the depth the profile is lowered', () => {
    const m = roadEngTemplateToPgmaps(read('RU', RURAL, ruralFragments), fallback)
    expect(m.template).toMatchObject({ leftWidth: 6.26, rightWidth: 6.26 })
    expect(m.template!.layers!.map((l) => [l.name, l.depthM, l.sideSlope])).toEqual([
      ['Sub-base', 0.3, 4],
      ['Base', 0.2, 2],
      // The 0.08 m adjustment term's run (0.16 m) on the pavement: the courses close at the 4.5 m lane.
      ['Pavement', 0.1, 1.6],
    ])
    expect(m.subgradeDepthM).toEqual({ left: 0.6, right: 0.6 })
    expect(m.notes.join('\n')).toMatch(
      /subgrade edge, where the ditch and the batters start, is 6.26 m from the centreline on each side, as Generated roadway builds it: ROAD_WIDTH 4.5 m \+ S_ADJ ÷ BaseFillSlope 0.16 m \+ BaseThick ÷ BaseFillSlope 0.4 m \+ SubbaseThick ÷ SubbaseFillSlope 1.2 m/,
    )
    expect(() => validateTemplate(m.template!)).not.toThrow()
  })
  it('keeps a pavement set into the course under it', () => {
    const m = roadEngTemplateToPgmaps(read('PV', PAVED, pavedFragments, 0.3048), fallback)
    // 3.6 + 0.3 / 0.5 + 0.6 / 0.5 = 5.4 project units; the subgrade 0.9 down, not 1.0.
    expect(m.template!.leftWidth).toBeCloseTo(5.4 * 0.3048, 6)
    expect(m.subgradeDepthM.left).toBeCloseTo(0.9 * 0.3048, 9)
    expect(m.template!.layers!.map((l) => l.depthM)).toEqual(
      [0.6 * 0.3048, 0.2 * 0.3048, 0.1 * 0.3048].map((v) => Math.round(v * 1e6) / 1e6),
    )
    expect(m.notes.join()).toMatch(/crushed top course is 0.061 m thick at the centreline on each side/)
  })
  it('keeps a profile that is already the subgrade', () => {
    const m = roadEngTemplateToPgmaps(read('RS', RESOURCE, resourceFragments), fallback)
    expect(m.template).toMatchObject({ leftWidth: 2.9, rightWidth: 2.9 })
    expect(m.template!.layers).toBeUndefined()
    expect(m.subgradeDepthM).toEqual({ left: 0, right: 0 })
    expect(m.notes.join()).toMatch(/0.2 m surface 1 above RoadEng's profile on each side, which is the subgrade/)
    // Aligned at the top, the subgrade lies the surfacing down and the course is drawn.
    const top = RESOURCE.map((p): Param => (p[0] === 'bAlignAtTop' ? ['bAlignAtTop', 1] : p))
    const atTop = roadEngTemplateToPgmaps(read('RS', top, resourceFragments), fallback)
    expect(atTop.subgradeDepthM).toEqual({ left: 0.2, right: 0.2 })
    expect(atTop.template!.layers!.map((l) => [l.name, l.depthM, l.sideSlope])).toEqual([['Surface 1', 0.2, 2]])
  })
  it('falls back to the named widths where the subgrade leg runs to what it meets', () => {
    const open = ruralFragments.map((f, k) =>
      k === 0 ? { ...f, legs: [{ distanceParam: 9 }, { distance: 1000, code: 'RE-' }] } : f,
    )
    const t = read('RU', RURAL, open)
    expect(roadEngRoadwayConstruction(t.components[0], 'left', 1)).toBeNull()
  })
})

describe('leg flags, sub-cuts a roadway builds, and the components around it', () => {
  it('reads bit 7 as a vertical distance, bit 6 as a distance along the leg and bit 53 as a falling leg', () => {
    const t = read('FL', RESOURCE, [
      {
        type: 'SGL',
        name: 'Subgrade',
        surface: 1,
        legs: [
          // A horizontal width at a falling crossfall (Rural VIII's SubgradeWidth: bit 53 alone).
          { distanceParam: 0, slope: 0.02, falls: true },
          // A slope distance (Daylight I's DaylightDist: bit 6).
          { distance: 1.25, slope: 0.5, along: true },
          // A course thickness down its fill slope (bits 7 and 53).
          { code: 'RE-', terms: [], distance: 0.2, slope: 0.5, vertical: true },
        ],
      },
    ])
    const legs = t.components[0].fragments![0].legs
    expect(legs.map((l) => [l.vertical, l.alongSlope, l.falls])).toEqual([
      [false, false, true],
      [false, true, false],
      [true, false, true],
    ])
    // 2.5 m wide, then 1.25 m along a 1:2 leg (1.118 m out), then 0.2 m down a 2:1 run (0.4 m out).
    const b = roadEngRoadwayConstruction(t.components[0], 'left', 1)!
    expect(b.subgradeEdgeM).toBeCloseTo(2.5 + 1.25 / Math.sqrt(1.25) + 0.4, 9)
    expect(b.width.parameter).toBe('Width')
  })

  // A roadway that digs its own sub-cut under the subgrade, built as the V9 As-Built tutorial's
  // `Rural w. Sub-cut` builds it (generated here).
  const SUBCUT: Param[] = [
    ['ROAD_WIDTH', 4.4],
    ['CSTC_THICK', 0.3],
    ['CSTC_SLOPE', 0.333333333333, 1],
    ['CZ_THICK', 0.5],
    ['CZ_WIDTH', 4.5],
    ['CZ_EXT_SLOPE', 9999.99, 1],
    ['SG_DEPTH', 0, 0, '-CSTC_THICK'],
    ['CZ_DEPTH', 0, 0, '-(CSTC_THICK + CZ_THICK)'],
  ]
  const subcutFragments = (up: Leg): Fragment[] => [
    {
      type: 'SGL',
      name: 'SC-Bot',
      surface: 2,
      height: word(7),
      legs: [{ distanceParam: 4, terms: [[1, 2]] }, up],
    },
    { type: 'SGL', name: 'Base-Bottom', surface: 1, height: word(6), legs: [{ code: 'RE-', distanceParam: 0 }] },
  ]
  it("reads a sub-cut the roadway builds under its subgrade as the side's sub-cut", () => {
    const t = read('SC', SUBCUT, subcutFragments({ slopeParam: 5, distance: 0 }))
    const b = roadEngRoadwayConstruction(t.components[0], 'left', 1)!
    expect(b.subgradeDepthM).toBeCloseTo(0.3, 12)
    expect(b.subCut).toMatchObject({ fragment: 'SC-Bot', outsideSlope: 0, widthParameter: null })
    expect(b.subCut!.depthM).toBeCloseTo(0.5, 12)
    // CZ_WIDTH 4.5 plus CSTC_THICK over CSTC_SLOPE, 0.9.
    expect(b.subCut!.widthM).toBeCloseTo(5.4, 9)
    const m = roadEngTemplateToPgmaps(t, fallback)
    expect(m.template!.subCut).toEqual({
      id: 'roadeng-SC-subcut-roadway',
      name: 'Generated roadway SC-Bot',
      reference: 'subgrade',
      depthM: 0.5,
      widthM: 5.4,
    })
    expect(() => validateTemplate(m.template!)).not.toThrow()
    // A 1:1 outside face; and a surface below the subgrade that falls again is listed, not drawn.
    expect(
      roadEngRoadwayConstruction(read('SC', SUBCUT, subcutFragments({ slope: 1 })).components[0], 'left', 1)!.subCut!
        .outsideSlope,
    ).toBe(1)
    const falling = roadEngTemplateToPgmaps(read('SC', SUBCUT, subcutFragments({ slope: 1, falls: true })), fallback)
    expect(falling.template!.subCut).toBeUndefined()
    expect(falling.unmapped.join()).toMatch(/SC-Bot surface below its subgrade; it does not run out level/)
  })

  /** A template: a roadway each side, then the given components (each written for one side). */
  const withComponents = (...extra: [name: string, className: string, params: Param[], fragments: Fragment[]][]) =>
    parseRoadEngSettings(
      [
        '[TemplatesSct]',
        `T0=${2 + extra.length * 2},TS,Generated,-0.02,-0.02,1,0,2,2`,
        ...component('T0-C0', 'Generated roadway', 'left', RESOURCE, resourceFragments),
        ...component('T0-C1', 'Generated roadway', 'right', RESOURCE, resourceFragments),
        ...extra.flatMap(([name, className, params, fragments], k) => [
          ...component(`T0-C${2 + 2 * k}`, name, 'left', params, fragments, className),
          ...component(`T0-C${3 + 2 * k}`, name, 'right', params, fragments, className),
        ]),
      ].join('\r\n'),
      '',
      1,
    ).templates[0]

  it('counts Slope VI benches from the fragments it draws, at most MaxNumberBenches', () => {
    const benchParams: Param[] = [
      ['bApplyInCut', 1],
      ['bApplyInFill', 1],
      ['FinalCutSlp', 1, 1],
      ['FinalFillSlp', 0.5, 1],
      ['BenchSlope', 2, 1],
      ['BenchHeight', 4],
      ['BenchBaseWidth', 3],
      ['BenchBaseSlope', 0, 1],
    ]
    const drawn = (cut: number, fill: number): Fragment[] => [
      ...Array.from({ length: cut }, (): Fragment => ({ type: 'SLPL', name: 'Cut Slope', surface: 1, legs: [{}] })),
      { type: 'SLPL', name: 'CutClose', surface: 1, legs: [{}] },
      ...Array.from({ length: fill }, (): Fragment => ({ type: 'SLPL', name: 'Fill Slope', surface: 1, legs: [{}] })),
      { type: 'SLPL', name: 'FillClose', surface: 1, legs: [{}] },
    ]
    // Road6's older Slope VI: five cut benches, four fill benches, no MaxNumberBenches.
    const old = roadEngTemplateToPgmaps(
      withComponents(['Slope VI - Benches', 'SLPS', benchParams, drawn(5, 4)]),
      fallback,
    )
    expect(old.template!.benches).toMatchObject({ cut: { count: 5 }, fill: { count: 4 } })
    // The library's: six of each, MaxNumberBenches 3.
    const most = roadEngTemplateToPgmaps(
      withComponents(['Slope VI - Benches', 'SLPS', [...benchParams, ['MaxNumberBenches', 3]], drawn(6, 6)]),
      fallback,
    )
    expect(most.template!.benches).toMatchObject({ cut: { count: 3 }, fill: { count: 3 } })
  })

  it('places a guard rail from the centreline, or from the road edge where it draws its posts from RE', () => {
    const rail: Param[] = [
      ['POST_THICKNESS', 0.3],
      ['POST_HEIGHT', 0.5],
      ['POST_OFFSET', 1],
    ]
    const posts = (attach: string): Fragment[] => [
      { type: 'SLPR', name: 'Post', surface: 3, attach, legs: [{ distance: 1, slope: 999999 }] },
    ]
    const fromCl = roadEngTemplateToPgmaps(withComponents(['Guard Rail', 'Guard Rail', rail, posts('-')]), fallback)
    const fromEdge = roadEngTemplateToPgmaps(withComponents(['Guard Rail', 'Guard Rail', rail, posts('RE-')]), fallback)
    expect(fromCl.template!.barriers!.map((b) => b.offsetM)).toEqual([1, 1])
    // The resource roadway's subgrade edge is 2.9 m out.
    expect(fromEdge.template!.barriers!.map((b) => b.offsetM)).toEqual([3.9, 3.9])
    expect(fromEdge.notes.join()).toMatch(/3\.9 m from the centreline on the left, 1 m past the road edge/)
  })

  it('reads a roadway that draws blocks under its deck (Bridge IV) as no wall', () => {
    const t = parseRoadEngSettings(
      [
        '[TemplatesSct]',
        'T0=1,BR,Generated,0,0,1,0,2,2',
        ...component(
          'T0-C0',
          'Roadway',
          'left',
          [
            ['BLOCK_HEIGHT', 0.76],
            ['BLOCK_WIDTH', 0.37],
          ],
          [{ type: '-?-', name: 'Block', surface: 1, legs: [{ distanceParam: 0, slope: 999999, vertical: true }] }],
        ),
      ].join('\r\n'),
      '',
      1,
    ).templates[0]
    const m = roadEngTemplateToPgmaps(t, fallback)
    expect(m.template?.walls).toBeUndefined()
    expect(m.notes.join()).not.toMatch(/wall/)
  })
})

// Softree's native component library and sample designs (read in place, never committed).
const pack = process.env.ROADENG_SAMPLE_PACK
const samples = process.env.ROADENG_SAMPLES
describe.skipIf(!pack || !existsSync(pack ?? ''))('Softree component library and sample pack', () => {
  const design = (p: string) => readRoadEngSettings(new Uint8Array(readFileSync(join(pack!, p))))
  it('closes every roadway in the library whose subgrade is a sum, and evaluates their expressions', () => {
    const library = parseRoadEngSettings(
      readFileSync(join(pack!, 'templates/WebTemplateComponents.tpl'), 'latin1'),
      '',
      1,
    )
    const components = library.templates.flatMap((t) => t.components)
    expect(components).toHaveLength(124)
    const byName = (name: string) => components.find((c) => c.name === name)!
    // Rural X: the road width plus the shoulder adjustment, base and sub-base runs.
    const ruralX = roadEngRoadwayConstruction(byName('Rural X'), 'left', 1)!
    expect(ruralX.runs.map((r) => `${r.thickness}/${r.slope}`)).toEqual([
      'S_THICK_ADJ1/BaseFillSlope',
      'BaseThick/BaseFillSlope',
      'SubbaseThick/SubbaseFillSlope',
    ])
    // Resource I: the width plus each surfacing over its fill slope; the library aligns its profile
    // at the top (bAlignAtTop 1), so the subgrade lies both surfacings down.
    const resource = roadEngRoadwayConstruction(byName('Resource I'), 'left', 1)!
    expect(resource.width.parameter).toBe('Width')
    expect(resource.subgradeEdgeM).toBeCloseTo(4 + 0.15 / 0.5 + 0.3 / 0.5, 12)
    expect(resource.subgradeDepthM).toBeCloseTo(0.45, 12)
    // Every calculated parameter in the library either evaluates or names a value RoadEng has only
    // while building a section (`_FRAG_…`, `_CLZ`, …).
    for (const c of components)
      for (const [name, v] of roadEngParameterValues(c)) {
        const p = c.parameters.find((x) => x.name.toUpperCase() === name)!
        if (v.stored) expect(p.formula, `${c.name} ${p.name}`).toMatch(/\b_[A-Z_]+\b|\bSG_surf\b|\bTopo\b/i)
      }
  })
  it("reads the sample designs' subgrade edges and depths from their construction", () => {
    const edge = (p: string, code: string) => {
      const { parts } = design(p)
      const t = parts[0].settings.templates.find((x) => x.code === code)!
      return roadEngTemplateToPgmaps(t, fallback)
    }
    const hart = edge('tutorial-v10/SoftreeOptimal/Hart Rd.dsnx', 'RUR')
    // ROAD_WIDTH 5.5 + 0.071 / ⅓ + 0.15 / ⅓ + 0.45 / ⅓.
    expect(hart.template!.leftWidth).toBeCloseTo(7.513, 6)
    expect(hart.subgradeDepthM.left).toBeCloseTo(0.75, 9)
    const bluff = edge('tutorial-v10/RoadEngCivil/Location2/bluff_road.dsnx', 'RUR')
    expect(bluff.template!.leftWidth).toBeCloseTo((18 + 0.76 / 0.33 + 2 / 0.33) * 0.3048, 5)
    expect(bluff.subgradeDepthM.left).toBeCloseTo(0.9144, 9)
    const loc18 = edge('tutorial-v11/RoadEngResource/Location/Location 18_1.dsnx', 'DF')
    expect(loc18.template!.leftWidth).toBeCloseTo(3.1, 9)
    expect(loc18.subgradeDepthM.left).toBe(0)
  })
})
describe.skipIf(!samples || !existsSync(samples ?? ''))('Softree samples', () => {
  it("reads LongRoad's Rural I subgrade edge from its construction", () => {
    const { parts } = readRoadEngSettings(new Uint8Array(readFileSync(join(samples!, 'LongRoad_1/LongRoad 1.dsnx'))))
    const t = parts[0].settings.templates.find((x) => x.code === 'PGR')!
    const m = roadEngTemplateToPgmaps(t, fallback)
    // 4.2 + 0.001 / 0.25 + 0.15 / 0.25 + 0.35 / 0.25.
    expect(m.template!.leftWidth).toBeCloseTo(6.204, 9)
  })
})
