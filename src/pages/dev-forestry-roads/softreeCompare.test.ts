import { describe, expect, it } from 'vitest'
import { analyzeRoad, offsetCoordinate } from './engine'
import { createEngineeringDesign, type HaulSite } from './engineeringTypes'
import {
  COMPARE_ABSOLUTE_TOLERANCE,
  compareSoftreeFile,
  comparisonCsv,
  detectSoftreeCompareKind,
  NOT_A_SOFTREE_FILE,
  sortByDifference,
  uniqueAreaRecords,
  valuesAgree,
  type CompareRow,
  type RoadResults,
} from './softreeCompare'
import {
  massHaulItemsFromAnalysis,
  optimalAreasFromAnalysis,
  optimalHaulFromAnalysis,
  writeMassHaulCsv,
  writeOptimalAreasCsv,
  writeOptimalHaulCsv,
  type SoftreeUnits,
} from './softreeHaulCsv'
import type { Alignment, Coordinate, RoadSettings, TerrainSource } from './types'

const origin: Coordinate = [-122.8, 53.9]
const north = (m: number) => offsetCoordinate(origin, 0, m)
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
  shrinkFactor: 0.9,
}
const site = (id: string, kind: HaulSite['kind'], chainage: number, extra: Partial<HaulSite> = {}): HaulSite => ({
  id,
  name: `Pit ${id}`,
  kind,
  chainage,
  accessDistanceM: 120,
  capacityM3: null,
  unitRate: 7,
  fixedCost: 500,
  ...extra,
})
/** A 300 m road on level ground: fill in its first half and cut in its second, soil over rock. */
function road(haul = true): Alignment {
  const engineering = createEngineeringDesign()
  engineering.materials = [
    {
      id: 'roadeng-OB',
      name: 'OB · Overburden',
      color: '#987',
      cutRate: 5,
      reusableFraction: 0.6,
      compactionFactor: 0.85,
      quality: 20,
    },
    {
      id: 'rock',
      name: 'Shot rock',
      color: '#678',
      cutRate: 18,
      reusableFraction: 1,
      compactionFactor: 1.25,
      quality: 90,
    },
  ]
  engineering.strata = [
    { id: 'top', materialId: 'roadeng-OB', start: 0, end: 300, topDepthM: 0, bottomDepthM: 1 },
    { id: 'bottom', materialId: 'rock', start: 0, end: 300, topDepthM: 1, bottomDepthM: null },
  ]
  Object.assign(engineering.haul, {
    enabled: haul,
    freeHaulDistanceM: 60,
    overhaulDistanceM: 200,
    freeHaulRate: 1,
    overhaulRate: 4,
    endHaulRate: 2,
  })
  engineering.sites = [site('b', 'borrow', 290, { materialId: 'rock' }), site('w', 'waste', 10, { unitRate: 2 })]
  return {
    id: 'road',
    name: 'Road',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: north(300), radiusM: 0 },
    ],
    vertical: [
      { id: 's', chainage: 0, elevation: 803, curveLength: 0 },
      { id: 'm', chainage: 150, elevation: 800, curveLength: 0 },
      { id: 'e', chainage: 300, elevation: 798.5, curveLength: 0 },
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
    engineering,
  }
}
function results(haul = true): RoadResults {
  const a = road(haul)
  return { analysis: analyzeRoad(a, flat, settings), engineering: a.engineering }
}
const r = results()
const files = (units: SoftreeUnits = 'metric') => ({
  mass: writeMassHaulCsv(massHaulItemsFromAnalysis(r.analysis, r.engineering?.haul), { units }),
  haul: writeOptimalHaulCsv(optimalHaulFromAnalysis(r.analysis, r.engineering!), { units }),
  areas: writeOptimalAreasCsv(optimalAreasFromAnalysis(r.analysis, r.engineering, { toGrid: (c) => [c[0], c[1]] }), {
    units,
  }),
})
/** The file with one cell changed: line `line` (0-based), cell `cell`, through `change`. */
function edit(text: string, line: number, cell: number, change: (value: number) => number) {
  const lines = text.split('\r\n')
  const cells = lines[line].split(',')
  cells[cell] = String(change(Number(cells[cell])))
  lines[line] = cells.join(',')
  return lines.join('\r\n')
}

describe('file kind', () => {
  it('tells the three files apart by their content', () => {
    const f = files()
    expect(detectSoftreeCompareKind(f.mass)).toBe('mass-haul')
    expect(detectSoftreeCompareKind(f.haul)).toBe('optimal-haul')
    expect(detectSoftreeCompareKind(f.areas)).toBe('optimal-areas')
    expect(detectSoftreeCompareKind('\uFEFF"Cut Vol",Cut Stn1\r\n')).toBe('mass-haul')
    expect(detectSoftreeCompareKind('Station,Easting,Northing\n0,1,2\n')).toBeNull()
    expect(detectSoftreeCompareKind('')).toBeNull()
    // A header that never reaches "data start:" is not an Areas file.
    expect(detectSoftreeCompareKind('version\n2\nno. station\n4\n')).toBeNull()
  })

  it('refuses a file that is none of them, and says what it looked for', () => {
    expect(() => compareSoftreeFile('a,b\n1,2\n', r, { units: 'metric' })).toThrow(NOT_A_SOFTREE_FILE)
  })
})

describe('the road’s own export compared with itself', () => {
  for (const units of ['metric', 'imperial'] as const)
    it(`shows no difference in any of the three files (${units})`, () => {
      const f = files(units)
      for (const text of [f.mass, f.haul, f.areas]) {
        const c = compareSoftreeFile(text, r, { units })
        expect(c.differing).toBe(0)
        expect(c.rows.length).toBeGreaterThan(0)
        expect(c.totals.length).toBeGreaterThan(0)
        expect([...c.totals, ...c.rows].every((x) => x.agrees && x.difference === 0)).toBe(true)
        expect(c.onlyTheirs).toEqual([])
        expect(c.onlyOurs).toEqual([])
        expect(c.warnings).toEqual([])
      }
    })

  it('reads a file in the wrong units as different', () => {
    const c = compareSoftreeFile(files('imperial').mass, r, { units: 'metric' })
    expect(c.differing).toBeGreaterThan(0)
  })
})

describe('one value changed in the file', () => {
  it('Mass Haul: the changed item leads, at its station, and its type’s total differs', () => {
    const text = files().mass
    // The first item with a cut volume.
    const at = text.split('\r\n').findIndex((l, i) => i > 0 && /^\d/.test(l))
    const c = compareSoftreeFile(
      edit(text, at, 0, (v) => v + 25),
      r,
      { units: 'metric' },
    )
    const first = c.rows[0]
    expect(first.agrees).toBe(false)
    expect(first.field).toBe('Volume')
    expect(first.difference).toBeCloseTo(-25, 6)
    expect(first.station).not.toBeNull()
    expect(c.rows.filter((x) => !x.agrees)).toHaveLength(1)
    const ours = massHaulItemsFromAnalysis(r.analysis, r.engineering?.haul)[at - 1]
    expect(first.item.startsWith(ours.type)).toBe(true)
    expect(c.totals.filter((x) => !x.agrees).map((x) => x.item)).toEqual([`${ours.type}, all items`])
  })

  it('Optimal Haul: the changed cost leads', () => {
    const text = files().haul
    const lines = text.split('\r\n')
    // The cost summary's second material row.
    const at = lines.findIndex((l) => l.startsWith('Total')) + 1
    const c = compareSoftreeFile(
      edit(text, at, 1, (v) => v + 100),
      r,
      { units: 'metric' },
    )
    expect(c.rows[0].agrees).toBe(false)
    expect(c.rows[0].unit).toBe('$')
    expect(c.rows[0].item).toBe(`Cost · ${lines[at].split(',')[0].toUpperCase()}`)
    expect(c.rows[0].difference).toBeCloseTo(-100, 6)
    expect(c.rows.filter((x) => !x.agrees)).toHaveLength(1)
  })

  it('Areas: the changed station and material lead, with the station’s cut total', () => {
    const text = files().areas
    const lines = text.split('\r\n')
    const at = lines.findIndex((l) => l.startsWith('h-offset')) + 6
    const cells = lines[at].split(',')
    const code = cells[7]
    const c = compareSoftreeFile(
      edit(text, at, 8, (v) => v * 2),
      r,
      { units: 'metric' },
    )
    const station = Number(cells[1])
    const differing = c.rows.filter((x) => !x.agrees)
    expect(differing.map((x) => x.field).sort()).toEqual(
      [code.toUpperCase(), Number(cells[8]) > 0 ? 'Cut, all materials' : 'Fill, all materials'].sort(),
    )
    expect(differing.every((x) => x.station === station && x.item === `Station ${station.toFixed(3)}`)).toBe(true)
    expect(c.totals.some((x) => !x.agrees)).toBe(true)
  })
})

describe('refusals', () => {
  it('an Optimal Haul export needs the road’s haul allocation', () => {
    expect(() => compareSoftreeFile(files().haul, results(false), { units: 'metric' })).toThrow(
      "This is a RoadEng Optimal Haul export, and the road's side cannot be made: Turn on haul allocation first.",
    )
  })
  it('a road with no results', () => {
    const empty = { ...r, analysis: { ...r.analysis, stations: [] } }
    for (const text of Object.values(files()))
      expect(() => compareSoftreeFile(text, empty, { units: 'metric' })).toThrow('no calculated results')
  })
})

describe('repeated stations', () => {
  it('compares the first record of a station and level, and says how many repeat', () => {
    const file = optimalAreasFromAnalysis(r.analysis, r.engineering, { toGrid: (c) => [c[0], c[1]] })
    expect(uniqueAreaRecords(file).file.records.length).toBe(
      new Set(file.records.map((x) => x.station.toFixed(4))).size,
    )
    const k = file.records.findIndex((x) => x.entries.length > 0)
    const copy = { ...file.records[k], entries: file.records[k].entries.map((e) => ({ ...e, value: e.value * 3 })) }
    const twice = writeOptimalAreasCsv({
      ...file,
      records: [...file.records.slice(0, k + 1), copy, ...file.records.slice(k + 1)],
    })
    const c = compareSoftreeFile(twice, r, { units: 'metric' })
    expect(c.differing).toBe(0)
    expect(c.notes).toEqual([
      `${file.records.length + 1 - new Set(file.records.map((x) => x.station.toFixed(4))).size} of the file's records repeat a station and level read before them; the first of each is compared.`,
    ])
  })
})

describe('station frame', () => {
  it('moves the file’s stations onto the road’s chainage', () => {
    const file = optimalAreasFromAnalysis(r.analysis, r.engineering, { toGrid: (c) => [c[0], c[1]] })
    const moved = writeOptimalAreasCsv({
      ...file,
      records: file.records.map((x) => ({ ...x, station: x.station + 1000 })),
    })
    const off = compareSoftreeFile(moved, r, { units: 'metric' })
    expect(off.rows).toEqual([])
    expect(off.onlyOurs.length).toBe(new Set(file.records.map((x) => x.station.toFixed(4))).size)
    const on = compareSoftreeFile(moved, r, { units: 'metric', frame: { startStationM: 1000, scale: 1 } })
    expect(on.differing).toBe(0)
    expect(on.onlyOurs).toEqual([])
    expect(() => compareSoftreeFile(moved, r, { units: 'metric', frame: { startStationM: NaN, scale: 1 } })).toThrow(
      'Enter the station',
    )
  })
})

describe('agreement and order', () => {
  const row = (id: string, theirs: number | null, ours: number | null, agrees: boolean): CompareRow => ({
    id,
    item: id,
    field: 'Volume',
    unit: 'm³',
    theirs,
    ours,
    difference: theirs === null || ours === null ? null : ours - theirs,
    percent: null,
    agrees,
    station: null,
  })
  it('agrees within the rounding or the chosen share, whichever is larger', () => {
    expect(valuesAgree(100, 100 + COMPARE_ABSOLUTE_TOLERANCE['m³'], 'm³', 0)).toBe(true)
    expect(valuesAgree(100, 100.06, 'm³', 0)).toBe(false)
    expect(valuesAgree(1000, 1001, 'm³', 0.1)).toBe(true)
    expect(valuesAgree(1000, 1001.5, 'm³', 0.1)).toBe(false)
    expect(valuesAgree(null, 1, 'm³', 50)).toBe(false)
    expect(valuesAgree(null, null, 'm³', 0)).toBe(true)
  })
  it('puts differences first, a missing side first of all, then the largest relative difference', () => {
    const sorted = sortByDifference([
      row('same', 10, 10, true),
      row('small', 1000, 1010, false),
      row('large', 10, 20, false),
      row('missing', null, 5, false),
    ])
    expect(sorted.map((x) => x.id)).toEqual(['missing', 'large', 'small', 'same'])
  })
})

describe('comparison CSV', () => {
  it('names the file and tolerance, then the totals, rows and one-sided items', () => {
    const text = files().mass
    const at = text.split('\r\n').findIndex((l, i) => i > 0 && /^\d/.test(l))
    const c = compareSoftreeFile(
      edit(text, at, 0, (v) => v + 25),
      r,
      { units: 'metric' },
    )
    const csv = comparisonCsv(c, '=road.csv')
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('Compared,RoadEng Mass Haul export =road.csv')
    expect(lines[2]).toMatch(/^Agree within,"0\.1 % of the larger value, or 0\.05 m³/)
    expect(csv).toContain('Part,Item,Value,Unit,File,PGMaps,Difference,Difference %,Station,Agrees')
    expect(lines.filter((l) => l.startsWith('Total,')).length).toBe(c.totals.length)
    expect(lines.filter((l) => l.startsWith('Row,')).length).toBe(c.rows.length)
    expect(lines.find((l) => l.startsWith('Row,'))).toMatch(/,-25\.00,.*,no$/)
    expect(csv.endsWith('\r\n')).toBe(true)
  })
})
