import { describe, expect, it } from 'vitest'
import type { Polygon } from 'geojson'
import { albersToLngLat, lngLatToAlbers } from '../../dev-avast/projection'
import { drawingDisagrees, type DrawnKind } from './drawing'
import { DEFAULT_OLD_FOREST_SETTINGS, prepareUnit, unitFigures, unitYears, type OldForestSettings } from './oldForest'
import type { ExcludedArea } from './landBase'
import type { CountedArea, Corridor, Stand } from './reads'
import {
  ageClass,
  pineSplit,
  REPRESENTATION_BREAKDOWNS,
  shares,
  siteClass,
  speciesGroup,
  type RepresentationYear,
} from './representation'
import { oldForestUnit } from './units'

// A made-up unit near Prince George, in BC Albers metres so areas are exact (as oldForest.test.ts).
const [X0, Y0] = lngLatToAlbers(-122.5, 54)
function rect(x: number, y: number, w: number, h: number): Polygon {
  const c = [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
    [x, y],
  ].map(([px, py]) => albersToLngLat(X0 + px, Y0 + py))
  return { type: 'Polygon', coordinates: [c] }
}
const stand = (id: string, geometry: Polygon, age: number | null, extra: Partial<Stand> = {}): Stand => ({
  id,
  projectedAge: age,
  projectedYear: 2025,
  harvestYear: null,
  treed: true,
  forestLandBase: true,
  leading: 'SX',
  bec: 'SBS wk1',
  siteIndex: 17,
  geometry,
  ...extra,
})
const A5 = oldForestUnit('Prince George', 'A5')! // old from 141, 29% old, 40% of that interior
const unitShape = rect(0, 0, 3000, 2000)
const settings = (s: Partial<OldForestSettings> = {}) => ({ ...DEFAULT_OLD_FOREST_SETTINGS, ...s })
const near = (a: number, b: number, tolerance = 0.02) =>
  b === 0 ? expect(Math.abs(a)).toBeLessThan(0.01) : expect(Math.abs(a - b) / b).toBeLessThan(tolerance)

// 3 km × 2 km, five 600 m columns, each 120 ha:
//  0: old spruce, SBS wk1, site 17       1: old pine, SBS wk1, site 22
//  2: old fir, ESSF mv1, site 8          3: young pine (makes an edge), ESSF mv1
//  4: mature spruce, no BEC or site, with a legal OGMA over its eastern half
const stands = [
  stand('s', rect(0, 0, 600, 2000), 200),
  stand('p', rect(600, 0, 600, 2000), 160, { leading: 'PLI', siteIndex: 22 }),
  stand('b', rect(1200, 0, 600, 2000), 300, { leading: 'BL', bec: 'ESSF mv1', siteIndex: 8 }),
  stand('y', rect(1800, 0, 600, 2000), 30, { leading: 'PLI', bec: 'ESSF mv1' }),
  stand('m', rect(2400, 0, 600, 2000), 100, { bec: null, siteIndex: null }),
]
const ogma: CountedArea = { kind: 'ogma-legal', id: 'o', name: 'o', date: null, geometry: rect(2700, 0, 300, 2000) }
const prep = (extra: { excluded?: ExcludedArea[]; corridors?: Corridor[] } = {}) =>
  prepareUnit({ unit: A5, shape: unitShape, stands, counted: [ogma], corridors: extra.corridors ?? [], ...extra })
const rowOf = (y: RepresentationYear, b: keyof RepresentationYear['by'], key: string) =>
  y.by[b].find((r) => r.key === key)

describe('classes', () => {
  it('groups species, ages and sites as stated', () => {
    expect(speciesGroup('PLI')).toBe('pine')
    expect(speciesGroup('BL')).toBe('fir')
    expect(speciesGroup('FDI')).toBe('douglas-fir')
    expect(speciesGroup('CW')).toBe('cedar')
    expect(speciesGroup('AT')).toBe('deciduous')
    expect(speciesGroup(null)).toBe('none')
    expect(ageClass(0)).toBe('1')
    expect(ageClass(140)).toBe('7')
    expect(ageClass(141)).toBe('8')
    expect(ageClass(251)).toBe('9')
    expect(ageClass(null)).toBe('none')
    expect(siteClass(9.99)).toBe('under-10')
    expect(siteClass(10)).toBe('10-15')
    expect(siteClass(25)).toBe('25-up')
    expect(siteClass(null)).toBe('none')
  })
})

describe('D.3 summary', () => {
  const run = unitYears(prep(), [], [2026], [2026], settings(), { representation: true })
  const [figures] = run.figures
  const [year] = run.representation!

  it('adds up to the figures in every breakdown', () => {
    for (const b of REPRESENTATION_BREAKDOWNS) {
      const sum = (f: (r: (typeof year.by)[typeof b][number]) => number) => year.by[b].reduce((s, r) => s + f(r), 0)
      near(
        sum((r) => r.cflbHa),
        figures.cflbHa,
        1e-9,
      )
      near(
        sum((r) => r.oldHa),
        figures.oldHa,
        1e-9,
      )
      near(
        sum((r) => r.nonPineOldHa),
        figures.nonPineOldHa,
        1e-9,
      )
    }
  })

  it('puts each stand’s old ground in its own rows', () => {
    near(rowOf(year, 'species', 'pine')!.cflbHa, 240)
    near(rowOf(year, 'species', 'pine')!.oldHa, 120)
    near(rowOf(year, 'species', 'pine')!.nonPineOldHa, 0)
    near(rowOf(year, 'species', 'fir')!.oldHa, 120)
    // The OGMA's 60 ha counts whole: old forest of a stand in age class 6 (101 in 2026).
    near(rowOf(year, 'species', 'spruce')!.oldHa, 180)
    near(rowOf(year, 'age', '6')!.oldHa, 60)
    near(rowOf(year, 'age', '6')!.nonPineOldHa, 0)
    near(rowOf(year, 'age', '9')!.oldHa, 120)
    near(rowOf(year, 'bec', 'SBS wk1')!.cflbHa, 240)
    near(rowOf(year, 'bec', 'none')!.oldHa, 60)
    near(rowOf(year, 'site', 'under-10')!.oldHa, 120)
    near(rowOf(year, 'site', 'none')!.cflbHa, 120)
    // BEC variants print largest first, the unlabelled last.
    expect(year.by.bec.map((r) => r.key)).toEqual(['ESSF mv1', 'SBS wk1', 'none'])
  })

  it('splits interior by pine and non-pine, and states shares as figures', () => {
    expect(year.interiorHa).toBeCloseTo(figures.interiorHa!, 6)
    expect(year.interiorNonPineHa).not.toBeNull()
    expect(year.interiorNonPineHa!).toBeLessThanOrEqual(year.interiorHa! + 1e-6)
    const split = pineSplit(year)
    near(split.nonPineCflbShare!, 360 / 600)
    near(split.nonPineOldShare!, figures.nonPineOldHa / figures.oldHa)
    const rows = shares(year.by.species)
    near(rows.find((r) => r.key === 'pine')!.oldOfCflb!, 0.5)
  })

  it('puts ground a block reset in its own age row', () => {
    const block = { year: 2030, geometry: rect(0, 0, 300, 2000) }
    const r = unitYears(prep(), [block], [2031], [2031], settings(), { representation: true })
    const [y] = r.representation!
    near(rowOf(y, 'age', 'reset')!.cflbHa, 60)
    near(rowOf(y, 'age', '8')!.oldHa, 60 + 120)
    near(
      y.by.age.reduce((s, x) => s + x.cflbHa, 0),
      r.figures[0].cflbHa,
      1e-9,
    )
  })

  it('scales by a stated CFLB as the figures are', () => {
    const r = unitYears(prep(), [], [2026], [2026], settings({ cflbEnteredHa: 1200 }), { representation: true })
    near(
      r.representation![0].by.species.reduce((s, x) => s + x.cflbHa, 0),
      1200,
      1e-9,
    )
    near(rowOf(r.representation![0], 'species', 'pine')!.oldHa, 240)
  })
})

describe('figures are the same with the summary and the map on or off', () => {
  const excluded: ExcludedArea[] = [{ kind: 'woodlot', id: 'w', name: 'w', geometry: rect(0, 0, 200, 2000) }]
  const corridors: Corridor[] = [
    {
      kind: 'fsr',
      geometry: {
        type: 'LineString',
        coordinates: [albersToLngLat(X0 + 900, Y0 - 100), albersToLngLat(X0 + 900, Y0 + 2100)],
      },
    },
  ]
  const blocks = [{ year: 2031, geometry: rect(1300, 0, 300, 800) }]
  const years = [2026, 2031, 2036]
  for (const s of [
    settings(),
    settings({ interiorMethod: '2004', countParks: true }),
    settings({ cflbEnteredHa: 900, younger: { fromAge: 90 } }),
  ])
    it(`with ${JSON.stringify(s)}`, () => {
      const p = prep({ excluded, corridors })
      const plain = unitFigures(p, blocks, years, years, s)
      expect(unitYears(p, blocks, years, years, s, { representation: true }).figures).toEqual(plain)
      expect(unitYears(p, blocks, years, years, s, { drawYear: 2031 }).figures).toEqual(plain)
      expect(unitYears(p, blocks, years, [2026], s, { representation: true }).figures).toEqual(
        unitFigures(p, blocks, years, [2026], s),
      )
    })
})

describe('the map’s shapes', () => {
  const run = unitYears(prep(), [], [2026], [2026], settings(), { drawYear: 2026 })
  const drawing = run.drawing!
  const [figures] = run.figures
  const kinds = new Set(drawing.features.map((f) => f.kind))

  it('draws the old forest the figures count, split by why it is or is not interior', () => {
    expect(drawing.year).toBe(2026)
    near(drawing.drawnHa.interior!, figures.interiorHa!)
    const old = (['old-edge', 'old-narrow', 'interior'] as DrawnKind[]).reduce(
      (s, k) => s + (drawing.drawnHa[k] ?? 0),
      0,
    )
    near(old, figures.oldHa)
    near(drawing.drawnHa.counted!, figures.countedNotOldHa)
    for (const k of ['interior', 'old-edge', 'edge-band', 'counted'] as DrawnKind[]) expect(kinds.has(k)).toBe(true)
    // The edge band stays inside the unit.
    expect(drawing.drawnHa['edge-band']!).toBeLessThanOrEqual(600 + 1e-6)
  })

  it('hands the map WGS84 shapes near the unit', () => {
    for (const f of drawing.features) {
      const flat = JSON.stringify(f.geometry.coordinates)
        .match(/-?\d+(\.\d+)?/g)!
        .map(Number)
      for (let i = 0; i < flat.length; i += 2) {
        expect(flat[i]).toBeGreaterThan(-123)
        expect(flat[i]).toBeLessThan(-122)
        expect(flat[i + 1]).toBeGreaterThan(53.9)
        expect(flat[i + 1]).toBeLessThan(54.1)
      }
    }
  })

  it('draws the excluded ground, corridors and D.4’s younger stands when there are any', () => {
    const excluded: ExcludedArea[] = [{ kind: 'tfl', id: 't', name: 't', geometry: rect(0, 0, 200, 2000) }]
    const corridors: Corridor[] = [
      {
        kind: 'railway',
        geometry: {
          type: 'LineString',
          coordinates: [albersToLngLat(X0 + 300, Y0 - 100), albersToLngLat(X0 + 300, Y0 + 2100)],
        },
      },
    ]
    const r = unitYears(prep({ excluded, corridors }), [], [2026], [2026], settings({ younger: { fromAge: 90 } }), {
      drawYear: 2026,
    })
    const drawn = new Set(r.drawing!.features.map((f) => f.kind))
    expect(drawn.has('excluded')).toBe(true)
    expect(drawn.has('corridor')).toBe(true)
    expect(drawn.has('younger')).toBe(true)
    near(r.drawing!.drawnHa.excluded!, 40)
  })

  it('says when the drawing’s figures differ from the record’s', () => {
    const units = [{ unit: 'A5', figures, drawnHa: {} }]
    expect(drawingDisagrees({ readOn: '2026-11-24', units }, '2026-11-24', () => figures)).toBeNull()
    expect(
      drawingDisagrees({ readOn: '2026-11-25', units }, '2026-11-24', () => ({ ...figures, oldHa: figures.oldHa + 5 })),
    ).toMatch(/A5 old/)
  })
})
