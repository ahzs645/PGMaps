import proj4 from 'proj4'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { projectedCrsDefinition } from '@/lib/geo/projectedCrs'
import { alignmentLength, analyzeRoad, curveDesignAt, horizontalCurveSummary, offsetCoordinate } from './engine'
import type { XY } from './landXmlImport'
import { parseProject } from './project'
import { superelevationRow } from './readiness'
import {
  curveTableColumnTop,
  curveTableMinimumRadius,
  curveTableValue,
  evaluateCurveCriteria,
  SIDE_FRICTION_GRAVITY,
  validateCurveCriteria,
} from './roadCriteria'
import { roadEngDesign } from './roadEngExport'
import { roadEngProject } from './roadEngProject'
import { roadEngExportGrid, roadEngProjectExport } from './roadEngProjectExport'
import {
  curveTableFromFormula,
  curveTableFromText,
  curveTableText,
  sideFrictionFromText,
  sideFrictionText,
} from './superelevationTables'
import { sectionCrossfall, templateAt } from './templates'
import { createDemoProject, DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, Coordinate, CurveDesign, CurveLookupTable } from './types'

// A small table in RoadEng's shape: radius down, speed across, blanks where the speed is unsafe.
const table: CurveLookupTable = {
  speedsKmh: [40, 60],
  rows: [
    { radiusM: 100, values: [5, null] },
    { radiusM: 200, values: [3, 5] },
    { radiusM: 400, values: [2, 4] },
  ],
}
const runoff: CurveLookupTable = {
  speedsKmh: [40, 60],
  rows: [
    { radiusM: 100, values: [30, null] },
    { radiusM: 400, values: [30, 50] },
  ],
}
const formula: CurveDesign = {
  designSpeedKmh: 60,
  maxSuperelevationPercent: 6,
  sideFrictionFactor: 0.12,
  runoffLengthM: 40,
  wideningVehicleLengthM: null,
}
const tabled: CurveDesign = { ...formula, superelevationMode: 'table', superelevationTable: table, runoffTable: runoff }
// RoadEng's side friction method: e max 10 %, f max 0.16.
const friction: CurveDesign = {
  ...formula,
  maxSuperelevationPercent: 10,
  sideFrictionFactor: 0.16,
  superelevationMode: 'sideFriction',
}

describe('RoadEng’s side friction method', () => {
  it('shares V²/(g R) between e and f in the ratio e max : f max, held at e max below the smallest radius', () => {
    const lateral = (60 / 3.6) ** 2 / (SIDE_FRICTION_GRAVITY * 300)
    const c = evaluateCurveCriteria(friction, 300, 30)
    expect(c.superelevationSource).toBe('sideFriction')
    expect(c.appliedSuperelevationPercent).toBeCloseTo((100 * 0.1 * lateral) / 0.26, 12)
    // e / e max = f / f max, and the two make up the lateral acceleration.
    expect(c.appliedSuperelevationPercent / 100 / 0.1).toBeCloseTo(c.sideFrictionDemand / 0.16, 12)
    expect(c.appliedSuperelevationPercent / 100 + c.sideFrictionDemand).toBeCloseTo(lateral, 12)
    expect(c).toMatchObject({ sideFrictionLimit: 0.16, tableStatus: null, runoffInM: 40, warnings: [] })
    const smallest = (60 / 3.6) ** 2 / (SIDE_FRICTION_GRAVITY * 0.26)
    expect(c.minimumSpeedRadiusM).toBeCloseTo(smallest, 9)
    const tight = evaluateCurveCriteria(friction, smallest / 2, 30)
    expect(tight.appliedSuperelevationPercent).toBe(10)
    expect(tight.sideFrictionDemand).toBeCloseTo(0.42, 9)
    expect(tight.warnings.join()).toMatch(/requires 20.00% superelevation; maximum is 10.00%.*its largest is 0.160/)
    // A table's f max at the curve's speed, else the road's; a curve's own over both.
    const tabledFriction: CurveDesign = {
      ...friction,
      sideFrictionTable: { speedsKmh: [40, 80], values: [0.18, 0.14] },
    }
    expect(evaluateCurveCriteria(tabledFriction, 300, 30).sideFrictionLimit).toBeCloseTo(0.16, 12)
    expect(evaluateCurveCriteria(tabledFriction, 300, 30, { designSpeedKmh: 40 }).sideFrictionLimit).toBe(0.18)
    const own = evaluateCurveCriteria(friction, 300, 30, { maxSideFriction: 0.1 })
    expect(own.appliedSuperelevationPercent).toBeCloseTo((100 * 0.1 * lateral) / 0.2, 12)
    // Read at the curve's radius in its design's grid, as RoadEng reads it.
    expect(
      evaluateCurveCriteria(friction, 200, 30, { tableRadiusScale: 1.5 }).appliedSuperelevationPercent,
    ).toBeCloseTo(c.appliedSuperelevationPercent, 12)
    // e max 0 gives none.
    expect(evaluateCurveCriteria(friction, 300, 30, { maxSuperelevationPercent: 0 }).appliedSuperelevationPercent).toBe(
      0,
    )
  })
  it('is kept in a project file, with a curve’s own f max, and checks it', () => {
    const r = road(friction)
    r.points[1] = { ...r.points[1], curve: { maxSideFriction: 0.12 } }
    const read = parseProject({ ...createDemoProject(), alignments: [r], activeAlignmentId: 'r' })
    expect(read.alignments[0].curveDesign?.superelevationMode).toBe('sideFriction')
    expect(read.alignments[0].points[1].curve).toEqual({ maxSideFriction: 0.12 })
    r.points[1] = { ...r.points[1], curve: { maxSideFriction: 1.5 } }
    expect(() => parseProject({ ...createDemoProject(), alignments: [r], activeAlignmentId: 'r' })).toThrow(
      /largest side friction/,
    )
  })
})

describe('superelevation lookup tables, read as RoadEng reads them', () => {
  it('interpolates between rows and columns, takes the last row past it, and names blanks and edges', () => {
    expect(curveTableValue(table, 200, 60)).toEqual({ value: 5, status: 'ok' })
    expect(curveTableValue(table, 300, 60).value).toBeCloseTo(4.5, 12)
    expect(curveTableValue(table, 300, 50).value).toBeCloseTo(3.5, 12)
    expect(curveTableValue(table, 1000, 40)).toEqual({ value: 2, status: 'ok' })
    expect(curveTableValue(table, 150, 60).status).toBe('unsafe')
    expect(curveTableValue(table, 80, 40).status).toBe('outside')
    expect(curveTableValue(table, 200, 70).status).toBe('outside')
    expect(curveTableColumnTop(table, 60)).toBe(5)
    expect(curveTableMinimumRadius(table, 60)).toBe(200)
  })
  it('gives each curve the table’s e and runoff in table mode, and leaves formula mode as it was', () => {
    const c = evaluateCurveCriteria(tabled, 300, 30)
    expect(c).toMatchObject({ superelevationSource: 'table', tableStatus: 'ok', runoffInM: 40, runoffOutM: 40 })
    expect(c.appliedSuperelevationPercent).toBeCloseTo(4.5, 12)
    expect(c.minimumSpeedRadiusM).toBe(200)
    // Formula mode: the same figures with no curve settings as with none given.
    const f = evaluateCurveCriteria(formula, 300, 30)
    expect(f.requiredSuperelevationPercent).toBeCloseTo(100 * (3600 / (127 * 300) - 0.12), 12)
    expect(evaluateCurveCriteria(formula, 300, 30, undefined)).toEqual(f)
    expect(f).toMatchObject({ superelevationSource: 'formula', tableStatus: null, transitionFraction: 1 })
  })
  it('flags a blank cell with the column’s largest e, and gives a curve outside the table none', () => {
    const unsafe = evaluateCurveCriteria(tabled, 150, 30)
    expect(unsafe.appliedSuperelevationPercent).toBe(5)
    expect(unsafe.warnings.join()).toMatch(/blank \(unsafe\) combination/)
    // Its runoff table is blank too: the road's runoff, since the curve is superelevated.
    expect(unsafe.runoffInM).toBe(40)
    const outside = evaluateCurveCriteria(tabled, 50, 30)
    expect(outside).toMatchObject({ appliedSuperelevationPercent: 0, runoffInM: 0, tableStatus: 'outside' })
    expect(outside.warnings.join()).toMatch(/outside the superelevation table/)
  })
  it('takes a curve’s own speed, e max, stated e, runoff, share outside the curve and table radius', () => {
    const own = evaluateCurveCriteria(tabled, 300, 30, { designSpeedKmh: 40, runoffInM: 25, transitionFraction: 0.5 })
    expect(own.appliedSuperelevationPercent).toBeCloseTo(2.5, 12)
    expect(own).toMatchObject({ designSpeedKmh: 40, runoffInM: 25, runoffOutM: 30, transitionFraction: 0.5 })
    const stated = evaluateCurveCriteria(tabled, 300, 30, { superelevationPercent: 6, maxSuperelevationPercent: 5 })
    expect(stated).toMatchObject({ appliedSuperelevationPercent: 6, superelevationSource: 'stated' })
    expect(stated.warnings.join()).toMatch(/stated 6.00% superelevation is above its 5.00% maximum/)
    // Read at 400 m, the radius the curve has in its design's grid.
    expect(evaluateCurveCriteria(tabled, 300, 30, { tableRadiusScale: 4 / 3 }).appliedSuperelevationPercent).toBe(4)
  })
  it('compares each curve’s side friction with the side friction table', () => {
    const limited: CurveDesign = { ...tabled, sideFrictionTable: { speedsKmh: [40, 60], values: [0.17, 0.15] } }
    const c = evaluateCurveCriteria(limited, 120, 0, { designSpeedKmh: 60, superelevationPercent: 5 })
    expect(c.sideFrictionDemand).toBeCloseTo(3600 / (127 * 120) - 0.05, 12)
    expect(c.sideFrictionLimit).toBe(0.15)
    expect(c.warnings.join()).toMatch(/needs side friction 0.186 at 60.0 km\/h; the table allows 0.150/)
  })
  it('refuses a table mode with no table, repeated radii and rows of the wrong length', () => {
    expect(() => validateCurveCriteria({ ...formula, superelevationMode: 'table' })).toThrow(
      /needs a superelevation table/,
    )
    const twice = {
      speedsKmh: [40],
      rows: [
        { radiusM: 100, values: [3] },
        { radiusM: 100, values: [2] },
      ],
    }
    expect(() => validateCurveCriteria({ ...tabled, superelevationTable: twice })).toThrow(/repeats the radius/)
    const short = { speedsKmh: [40, 60], rows: [{ radiusM: 100, values: [3] }] }
    expect(() => validateCurveCriteria({ ...tabled, superelevationTable: short })).toThrow(/one value per speed/)
  })
})

describe('tables as RoadEng .tbl text', () => {
  it('reads and writes superelevation as rise over run, runoff in metres and side friction as one row', () => {
    const text = '# Superelevation\n,40,60\n100,0.05,\n200,0.03,0.05\n400,0.02,0.04\n'
    const read = curveTableFromText(text, 'superelevation')
    expect(read.rows.map((r) => r.values)).toEqual([
      [5, null],
      [3, 5],
      [2, 4],
    ])
    expect(read.description).toEqual([' Superelevation'])
    expect(curveTableFromText(curveTableText(read, 'superelevation'), 'superelevation')).toEqual(read)
    expect(curveTableFromText(curveTableText(runoff, 'runoff'), 'runoff')).toEqual(runoff)
    const friction = { speedsKmh: [40, 60, 80], values: [0.17, 0.15, null] }
    expect(sideFrictionFromText(sideFrictionText(friction))).toEqual(friction)
    expect(() => curveTableFromText(',40\n100,0.9\n', 'superelevation')).toThrow(/between 0 and 50/)
  })
  it('starts a table from the formula, blank where it needs more than e max', () => {
    const t = curveTableFromFormula(formula)
    validateCurveCriteria({ ...formula, superelevationMode: 'table', superelevationTable: t })
    const at = (radius: number, speed: number) =>
      t.rows.find((r) => r.radiusM === radius)!.values[t.speedsKmh.indexOf(speed)]
    expect(at(200, 60)).toBeCloseTo(100 * (3600 / 25400 - 0.12), 3)
    expect(at(50, 60)).toBeNull()
    expect(at(5000, 20)).toBe(0)
  })
})

// One right-hand curve between two 300 m tangents, on flat ground.
const start: Coordinate = [-122.8, 53.9]
const corner = offsetCoordinate(start, 0, 300)
const crown = 2
const road = (curveDesign: CurveDesign, curve?: Alignment['points'][number]['curve']): Alignment => ({
  id: 'r',
  name: 'Road',
  color: '#16817a',
  points: [
    { id: 'a', coordinate: start, radiusM: 0 },
    { id: 'b', coordinate: corner, radiusM: 200, ...(curve ? { curve } : {}) },
    { id: 'c', coordinate: offsetCoordinate(corner, 60, 300), radiusM: 0 },
  ],
  vertical: [],
  overrides: [],
  curveDesign,
  template: { ...DEFAULT_TEMPLATE, crossfallPercent: crown },
})
const crossfalls = (a: Alignment, s: number) => {
  const d = curveDesignAt(a, s)
  const t = templateAt(a, s).template
  return { inside: sectionCrossfall(t, 'right', d), outside: sectionCrossfall(t, 'left', d) }
}

describe('superelevation along the road', () => {
  it('keeps the old rotation without a transition fraction or tangent runout', () => {
    const a = road(tabled)
    const arc = horizontalCurveSummary(a)[0]
    expect(arc.pointId).toBe('b')
    expect(crossfalls(a, arc.start)).toEqual({ inside: 5, outside: -5 })
    expect(crossfalls(a, arc.start - 20).outside).toBeCloseTo(crown + (-5 - crown) * 0.5, 9)
    expect(crossfalls(a, arc.start - 40)).toEqual({ inside: crown, outside: crown })
  })
  it('turns the outside lane first through a tangent runout, with a share of the runoff inside the curve', () => {
    const a = road({ ...tabled, transitionFraction: 0.75, tangentRunout: true })
    const arc = horizontalCurveSummary(a)[0]
    // Runoff 40 m (table), e 5 %: level 30 m before the BC, full 10 m into the curve, and a
    // tangent runout of 40 × 2 / 5 = 16 m before the level point.
    const level = arc.start - 30
    expect(crossfalls(a, level - 16 - 1)).toEqual({ inside: crown, outside: crown })
    expect(crossfalls(a, level - 8).outside).toBeCloseTo(1, 9)
    expect(crossfalls(a, level).outside).toBeCloseTo(0, 9)
    expect(crossfalls(a, level).inside).toBeCloseTo(crown, 9)
    const reverse = level + 16
    expect(crossfalls(a, reverse).outside).toBeCloseTo(-crown, 9)
    expect(crossfalls(a, reverse).inside).toBeCloseTo(crown, 9)
    expect(crossfalls(a, arc.start).inside).toBeCloseTo(crown + (5 - crown) * (14 / 24), 9)
    const full = crossfalls(a, arc.start + 10)
    expect(full.inside).toBeCloseTo(5, 9)
    expect(full.outside).toBeCloseTo(-5, 9)
    // Widening and the runoff ratio start at the level point, not at normal crown.
    expect(curveDesignAt(a, level - 8)!.ratio).toBe(0)
    expect(curveDesignAt(a, level - 8)!.rotationRatio).toBeCloseTo(0.5 * (16 / 56), 9)
  })
  it('uses a curve’s own superelevation and runoff in the sections and the analysis', () => {
    const a = road(tabled, { superelevationPercent: 3, runoffInM: 20 })
    const arc = horizontalCurveSummary(a)[0]
    expect(crossfalls(a, (arc.start + arc.end) / 2).inside).toBe(3)
    expect(crossfalls(a, arc.start - 10).outside).toBeCloseTo(crown + (-3 - crown) * 0.5, 9)
    expect(crossfalls(a, arc.end + 30).outside).toBeCloseTo(crown + (-3 - crown) * 0.25, 9)
    const analysis = analyzeRoad(a, { elevationAt: () => 800 }, DEFAULT_ROAD_SETTINGS)
    expect(analysis.stations.length).toBeGreaterThan(10)
  })
  it('judges each curve in Review: outside the table, a blank cell, above e max', () => {
    const a = road(tabled)
    const curves = horizontalCurveSummary(a)
    expect(superelevationRow(a, curves)).toMatchObject({ id: 'superelevation', state: 'met' })
    const blank = superelevationRow(road(tabled, { tableRadiusScale: 0.75 }), curves)
    expect(blank).toMatchObject({ state: 'attention', severity: 'limit' })
    expect(blank!.measured).toMatch(/a blank \(unsafe\) table cell/)
    const outside = superelevationRow(road(tabled, { designSpeedKmh: 80 }), curves)
    expect(outside!.measured).toMatch(/outside the superelevation table/)
    // No curve rule: no row, so other roads keep their Review list.
    const { curveDesign: _none, ...plain } = a
    void _none
    expect(superelevationRow(plain as Alignment, curves)).toBeNull()
  })
  it('keeps the table mode and each curve’s own values in the project file', () => {
    const a = road(
      {
        ...tabled,
        transitionFraction: 0.667,
        tangentRunout: true,
        sideFrictionTable: { speedsKmh: [40], values: [0.17] },
      },
      { designSpeedKmh: 50, superelevationPercent: 4, tableRadiusScale: 1.002 },
    )
    const project = parseProject({ ...createDemoProject(), alignments: [a], activeAlignmentId: 'r' })
    expect(project.alignments[0].curveDesign).toEqual(a.curveDesign)
    expect(project.alignments[0].points[1].curve).toEqual(a.points[1].curve)
    expect(() =>
      parseProject({
        ...createDemoProject(),
        alignments: [road(tabled, { transitionFraction: 2 })],
        activeAlignmentId: 'r',
      }),
    ).toThrow(/outside its range/)
  })
})

// A road written as a RoadEng design and opened again, as the page does.
const utm10 = proj4('EPSG:4326', projectedCrsDefinition(26910)!)
const lonLat = (x: number, y: number) => utm10.inverse([515_000 + x, 5_975_000 + y]) as Coordinate
const utmGrid = { epsg: 26910, toGrid: (c: Coordinate) => utm10.forward([...c]) as XY }
let n = 0
const options = {
  newId: () => `id${n++}`,
  color: () => '#123456',
  template: { ...DEFAULT_TEMPLATE },
  verticalReference: '',
}
const spurPoints: Alignment['points'] = [
  { id: 'a', coordinate: lonLat(0, 0), radiusM: 0 },
  { id: 'b', coordinate: lonLat(250, 200), radiusM: 300 },
  { id: 'c', coordinate: lonLat(500, 180), radiusM: 150, curve: { superelevationPercent: 5.5, designSpeedKmh: 40 } },
  { id: 'd', coordinate: lonLat(800, 400), radiusM: 0 },
]
const spurLength = alignmentLength({ ...road(formula), points: spurPoints })
const spur: Alignment = {
  id: 'r',
  name: 'Spur 7',
  color: '#000000',
  points: spurPoints,
  vertical: [
    { id: 'v1', chainage: 0, elevation: 800, curveLength: 0 },
    { id: 'v2', chainage: spurLength, elevation: 820, curveLength: 0 },
  ],
  template: { ...DEFAULT_TEMPLATE },
  overrides: [],
  curveDesign: { ...tabled, transitionFraction: 0.667, tangentRunout: true },
}
const records108 = (bytes: Uint8Array) =>
  strFromU8(bytes, true)
    .split(/\r?\n/)
    .filter((l) => l.startsWith('108,'))
    .map((l) => l.split(','))
function writeProject(alignment: Alignment) {
  const grid = roadEngExportGrid(createDemoProject().terrain, utmGrid)
  // A stream, so the project's terrain has something drawn to write.
  const stream = {
    id: 's',
    name: 'Willow Creek',
    kind: 'stream' as const,
    geometry: { type: 'LineString' as const, coordinates: [lonLat(50, 0), lonLat(60, 300)] },
  }
  const zip = roadEngProjectExport({
    name: 'Spur 7',
    roads: [{ alignment }],
    grid,
    context: [stream],
    cables: [],
    reference: [],
  })
  for (const [name, bytes] of Object.entries(unzipSync(zip.bytes)))
    if (name.endsWith('.dsnx')) return { zip: zip.bytes, ds2: unzipSync(bytes)['Location1.ds2'] }
  throw Error('no design written')
}

describe('per-curve superelevation through a RoadEng design', () => {
  it('writes each curve’s own values and flag bits, and reads them back as the same road', () => {
    const { zip, ds2 } = writeProject(spur)
    const [b, c] = records108(ds2)
    // Curve b reads the table (bit 8 set); curve c keeps its stated 5.5 % at 40 km/h, written as a
    // value. Neither takes Use Minimum Radius (bit 1), which RoadEng's default word sets.
    expect(Number(b[9]) & 258).toBe(256)
    expect(Number(c[9]) & 2).toBe(0)
    expect(Number(c[15])).toBeCloseTo(0.055, 12)
    expect(Number(c[8]) * 3.6).toBeCloseTo(40, 6)
    expect(Number(b[14])).toBe(0.667)
    const opened = roadEngProject([{ name: 'Spur 7.zip', bytes: zip }], options)
    const back = opened.roads[0].alignment
    expect(back.curveDesign).toEqual(spur.curveDesign)
    expect(back.points[2].curve).toMatchObject({ superelevationPercent: 5.5, designSpeedKmh: 40 })
    expect(back.points[1].curve?.superelevationPercent).toBeUndefined()
    // Written again unedited, every curve record comes back as it was read.
    const again = writeProject(back)
    expect(records108(again.ds2).map((f) => f.slice(6).join())).toEqual(records108(ds2).map((f) => f.slice(6).join()))
    // One curve's stated e edited: only that record changes, in e, side friction and nothing else.
    const edited = {
      ...back,
      points: back.points.map((p, k) => (k === 2 ? { ...p, curve: { ...p.curve, superelevationPercent: 4 } } : p)),
    }
    const changed = records108(writeProject(edited).ds2)
    const before = records108(again.ds2)
    expect(changed[0]).toEqual(before[0])
    expect(changed[1].map((v, k) => (v === before[1][k] ? null : k)).filter((k) => k !== null)).toEqual([15, 16])
    expect(Number(changed[1][15])).toBeCloseTo(0.04, 12)
  })
  it('writes the side friction method as RoadEng’s, and reads it back the same', () => {
    const friction7: Alignment = {
      ...spur,
      curveDesign: { ...friction, transitionFraction: 0.667, tangentRunout: true },
      points: spur.points.map((p) => (p.id === 'b' ? { ...p, curve: { maxSideFriction: 0.14 } } : p)),
    }
    const { zip, ds2 } = writeProject(friction7)
    const [b, c] = records108(ds2)
    // Curve b: Auto on by the side friction method (bit 1 clear, bit 8 clear), its own f max, and
    // e = e max · V²/(g R) / (e max + f max) with the side friction that leaves.
    expect(Number(b[9]) & 258).toBe(0)
    expect(Number(b[11])).toBe(0.14)
    const v = Number(b[8]),
      radius = Math.abs(Number(b[3]))
    const lateral = (v * v) / (SIDE_FRICTION_GRAVITY * radius)
    // A new record's values are written to six decimals.
    expect(Number(b[15])).toBeCloseTo((0.1 * lateral) / 0.24, 6)
    expect(Number(b[15]) + Number(b[16])).toBeCloseTo(lateral, 6)
    // Curve c keeps its stated 5.5 %, written as a value.
    expect(Number(c[9]) & 2).toBe(0)
    expect(Number(c[15])).toBeCloseTo(0.055, 12)
    const back = roadEngProject([{ name: 'Spur 7.zip', bytes: zip }], options).roads[0].alignment
    expect(back.curveDesign).toEqual(friction7.curveDesign)
    expect(back.points[1].curve).toMatchObject({ maxSideFriction: 0.14 })
    expect(records108(writeProject(back).ds2)).toEqual(records108(ds2))
  })
  it('writes a road not read from RoadEng with a share of the runoff outside the curve', () => {
    const plain = roadEngDesign([{ alignment: spur }], utmGrid.toGrid).bytes
    expect(records108(unzipSync(plain)['Location1.ds2'])).toHaveLength(2)
  })
})
