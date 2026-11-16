import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import proj4 from 'proj4'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { projectedCrsDefinition } from '@/lib/geo/projectedCrs'
import { alignmentLength, curveDesignAt, horizontalCurveSummary } from './engine'
import type { XY } from './landXmlImport'
import { parseProject } from './project'
import { evaluateCurveCriteria } from './roadCriteria'
import {
  parseRoadEngSettings,
  readRoadEngSettings,
  roadEngAutoWideningInside,
  roadEngAutoWideningOutside,
  roadEngCurveWidening,
  roadEngWideningFor,
  roadEngWideningRows,
  ROADENG_AUTO_WIDENING_INSIDE_BIT,
} from './roadEngDesignSettings'
import { roadEngProject, withRoadEngOriginal } from './roadEngProject'
import { sha256Hex } from './roadEngTerrainOriginal'
import { roadEngExportGrid, roadEngProjectExport } from './roadEngProjectExport'
import { roadEngCurveChanges, roadEngOutsideAutoNote } from './roadEngSectionExport'
import { createDemoProject, DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE, exportGrid, terrainFromMetadata } from './terrain'
import type { Alignment, Coordinate, CurveDesign, RoadProject } from './types'

// RoadEng's example widening table (radius m down, deflection ° across, widening m), as PGMaps rows.
const roadEngTable = {
  index: 3,
  description: ['Widening Table - meters'],
  speeds: [0, 20, 30, 40, 60, 80, 100, 180],
  rows: [
    { radius: 20, e: [0, 0.5, 1, 1.5, 2, 3, 3.5, 4] },
    { radius: 30, e: [0, 0, 0.5, 1, 1.5, 2, 2.5, 3] },
    { radius: 50, e: [0, 0, 0, 0.5, 1, 1.5, 2, 2.5] },
    { radius: 80, e: [0, 0, 0, 0, 0, 0.5, 0.5, 0.5] },
    { radius: 50000, e: [0, 0, 0, 0, 0, 0, 0, 0] },
  ],
}
const stepped = roadEngWideningRows(roadEngTable, 1)!.rows
const rule: CurveDesign = {
  designSpeedKmh: 40,
  maxSuperelevationPercent: 6,
  sideFrictionFactor: 0.15,
  runoffLengthM: 20,
  wideningVehicleLengthM: null,
  wideningTable: stepped,
}

describe('a curve’s own widening', () => {
  it('replaces the rule on its side only and says where each side comes from', () => {
    const plain = evaluateCurveCriteria(rule, 35, 55)
    expect([plain.insideWideningM, plain.outsideWideningM]).toEqual([1.5, 1.5])
    expect(plain.wideningSource).toEqual({ inside: 'rule', outside: 'rule' })
    const own = evaluateCurveCriteria(rule, 35, 55, { outsideWideningM: 0 })
    expect([own.insideWideningM, own.outsideWideningM]).toEqual([1.5, 0])
    expect(own.wideningSource).toEqual({ inside: 'rule', outside: 'stated' })
    // The road's added widths and vehicle length are the rule's: a stated side replaces them too.
    const added = evaluateCurveCriteria({ ...rule, insideWideningM: 0.4, wideningVehicleLengthM: null }, 35, 55, {
      insideWideningM: 0.3,
    })
    expect(added.insideWideningM).toBe(0.3)
  })
  it('is checked and kept in the project file', () => {
    expect(() => evaluateCurveCriteria(rule, 35, 55, { insideWideningM: 51 })).toThrow(/inside widening/)
    expect(() => evaluateCurveCriteria(rule, 35, 55, { outsideWideningM: -1 })).toThrow(/outside widening/)
    const project = createDemoProject()
    const road = project.alignments[0]
    const points = road.points.map((p, k) =>
      k === 1 ? { ...p, curve: { insideWideningM: 0.3048, outsideWideningM: 0 } } : p,
    )
    const read = parseProject({
      ...project,
      alignments: [{ ...road, points, curveDesign: rule }, ...project.alignments.slice(1)],
    })
    expect(read.alignments[0].points[1].curve).toEqual({ insideWideningM: 0.3048, outsideWideningM: 0 })
  })
  it('widens the section through the curve’s transitions', () => {
    const utm = proj4('EPSG:4326', projectedCrsDefinition(26910)!)
    const at = (x: number, y: number) => utm.inverse([515_000 + x, 5_975_000 + y]) as Coordinate
    const road: Alignment = {
      id: 'r',
      name: 'Bluff',
      color: '#000',
      points: [
        { id: 'a', coordinate: at(0, 0), radiusM: 0 },
        { id: 'b', coordinate: at(300, 0), radiusM: 150, curve: { insideWideningM: 0.3048, outsideWideningM: 0 } },
        { id: 'c', coordinate: at(300, 300), radiusM: 0 },
      ],
      vertical: [],
      template: { ...DEFAULT_TEMPLATE },
      overrides: [],
      curveDesign: { ...rule, wideningTable: undefined },
    }
    const [curve] = horizontalCurveSummary(road)
    const middle = curveDesignAt(road, (curve.start + curve.end) / 2)!
    expect(middle.extraWidth).toBeCloseTo(0.3048, 9)
    expect(middle.outsideExtraWidth).toBe(0)
    // Half way along the 20 m runoff before the BC (the whole runoff outside the curve), half the widening.
    expect(curveDesignAt(road, curve.start - 10)!.extraWidth).toBeCloseTo(0.1524, 6)
    expect(curveDesignAt(road, curve.start - 25)).toBeNull()
    expect(alignmentLength(road)).toBeGreaterThan(curve.end)
  })
})

describe('RoadEng’s per-curve widening', () => {
  it('reads the inside Auto widening bit of the 108 flag word', () => {
    expect(ROADENG_AUTO_WIDENING_INSIDE_BIT).toBe(128)
    // Auto on: Location 18 (1521) and LongRoad (5585, 5587, 5590); off: the bluff road (113), 1393.
    expect([1521, 5585, 5587, 5590].map(roadEngAutoWideningInside)).toEqual([true, true, true, true])
    expect([113, 97, 1393, 1395].map(roadEngAutoWideningInside)).toEqual([false, false, false, false])
    expect(roadEngAutoWideningInside(undefined)).toBeNull()
    expect(roadEngAutoWideningInside(NaN)).toBeNull()
  })
  it('keeps a side’s stored value where the rule gives another, and a typed inside value under a table', () => {
    const flat = { insideM: 0, outsideM: 0 }
    expect(
      roadEngCurveWidening({ insideM: 0.3048, outsideM: 0 }, flat, { autoInside: false, ruleVaries: false }),
    ).toEqual({
      insideWideningM: 0.3048,
    })
    expect(roadEngCurveWidening(flat, flat, { autoInside: false, ruleVaries: false })).toBeNull()
    // Auto off under a table: the typed value stays the curve's even where it equals the table's today.
    expect(
      roadEngCurveWidening(
        { insideM: 1, outsideM: 1 },
        { insideM: 1, outsideM: 1 },
        { autoInside: false, ruleVaries: true },
      ),
    ).toEqual({
      insideWideningM: 1,
    })
    expect(
      roadEngCurveWidening(
        { insideM: 1, outsideM: 1 },
        { insideM: 1, outsideM: 1 },
        { autoInside: true, ruleVaries: true },
      ),
    ).toBeNull()
  })

  // A design in RoadEng's layout: three curves of R 35 m, deflections about 25°, 55° and 92°.
  const tableKeys = [
    'LTable-03-Desc-00=Widening Table - meters',
    'LTable-03-Options=0',
    'LTable-03-Row-000=,0,20,30,40,60,80,100,180',
    'LTable-03-Row-001=20,0,0.5,1,1.5,2,3,3.5,4',
    'LTable-03-Row-002=30,0,0,0.5,1,1.5,2,2.5,3',
    'LTable-03-Row-003=50,0,0,0,0.5,1,1.5,2,2.5',
    'LTable-03-Row-004=80,0,0,0,0,0,0.5,0.5,0.5',
    'LTable-03-Row-005=50000,0,0,0,0,0,0,0,0',
  ]
  const dsn = (table: boolean) =>
    [
      '[Software]',
      'Version2=11',
      '[design]',
      'units=10000',
      '[TemplatesSct]',
      ...(table ? tableKeys : ['LTable-03-Options=0']),
      '',
    ].join('\r\n')
  const deg = Math.PI / 180
  const walk = (headings: number[]) => {
    const points: [number, number][] = [[0, 0]]
    for (const h of headings) {
      const [x, y] = points.at(-1)!
      points.push([x + 100 * Math.cos(h * deg), y + 100 * Math.sin(h * deg)])
    }
    return points
  }
  const pts = walk([0, 25, -30, 62])
  const ds2 = (flags: number, widening: [number, number][]) =>
    [
      '100,103,11,11.0.673.0, Softree Technical Systems Inc. - Location Line data file',
      ...widening.map(
        ([inside, outside], k) =>
          `108,${k + 1},2,${k % 2 ? 35 : -35},${pts[k + 1][0]},${pts[k + 1][1]},0,-1,13.8888888889,${flags},0.06,0.1,20,20,0.667,0,0.56,${inside},${outside},0`,
      ),
      `110,5,0,0,900,0,-1,0,0,,,256`,
      `110,5,${pts[4][0]},${pts[4][1]},900,400,-1,0,0,,,256`,
    ].join('\r\n')

  it('takes the table on the inside only where the curves widen only their inside (Location 18)', () => {
    const s = parseRoadEngSettings(
      dsn(true),
      ds2(1521, [
        [0.5, 0],
        [1.5, 0],
        [2.5, 0],
      ]),
      1,
    )
    expect(s.curves.map((c) => Math.round(c.deflectionDegrees!))).toEqual([25, 55, 92])
    const m = roadEngWideningFor(s)
    expect(m.wideningTable!.every((r) => r.outsideM === 0)).toBe(true)
    expect(m.wideningTable!.some((r) => r.insideM > 0)).toBe(true)
    expect(m.comparison.map((c) => [c.tableM, c.pgmapsInsideM, c.pgmapsOutsideM, c.own])).toEqual([
      [0.5, 0.5, 0, null],
      [1.5, 1.5, 0, null],
      [2.5, 2.5, 0, null],
    ])
    expect(m.notes.join()).toMatch(/on the inside of each curve/)
    expect(m.notes.join()).toMatch(/Every curve's widening matches/)
  })
  it('keeps typed widening on each curve of a design with no widening table (the bluff road)', () => {
    const s = parseRoadEngSettings(
      dsn(false),
      ds2(113, [
        [1, 0],
        [1, 0],
        [1, 0],
      ]),
      0.3048,
    )
    const m = roadEngWideningFor(s)
    expect(m.wideningTable).toBeNull()
    expect(m.unmapped).toEqual([])
    expect(m.comparison.map((c) => c.own)).toEqual(Array(3).fill({ insideWideningM: 0.3048 }))
    expect(m.notes.join()).toMatch(
      /3 curves keep their own widening.*Auto widening off on the inside.*no widening table/,
    )
  })
  it('leaves the table off when no curve widens, whatever it would give (the cul-de-sac design)', () => {
    const m = roadEngWideningFor(
      parseRoadEngSettings(
        dsn(true),
        ds2(1393, [
          [0, 0],
          [0, 0],
          [0, 0],
        ]),
        1,
      ),
    )
    expect(m.wideningTable).toBeNull()
    expect(m.comparison.every((c) => c.own === null && c.pgmapsInsideM === 0)).toBe(true)
  })
  it('changes the inside Auto bit only where it writes the widening', () => {
    const record = '108,1,2,-35,0,0,0,-1,13.8888888889,1521,0.06,0.1,20,20,0.667,0,0.56,0.5,0,0'.split(',')
    const same = { widening: { insideM: 0.5, outsideM: 0 } }
    expect(roadEngCurveChanges(same, record, 1, null, false, false)).toBeNull()
    const typed = roadEngCurveChanges({ widening: { insideM: 0.8, outsideM: 0 } }, record, 1, null, false, false)!
    expect(typed.flags).toBe(1521 - 128)
    expect(typed.widening).toEqual({ insideM: 0.8, outsideM: 0 })
    const table = roadEngCurveChanges({ widening: { insideM: 1, outsideM: 0 } }, record, 1, null, false, true)!
    expect(table.flags).toBeUndefined()
  })
  it('reads the outside Auto bit only where its two candidate bits agree, and never writes either', () => {
    // Bit 12 set with bit 5 clear: on (LongRoad's 5585–5590); bit 5 set with bit 12 clear: off (1521, 1393).
    expect(roadEngAutoWideningOutside(5587)).toBe(true)
    expect(roadEngAutoWideningOutside(1521)).toBe(false)
    expect(roadEngAutoWideningOutside(97)).toBe(false)
    expect(roadEngAutoWideningOutside(4096 | 32)).toBeNull()
    expect(roadEngAutoWideningOutside(1)).toBeNull()
    // An outside value typed on a curve whose outside reads Auto: fields 17/18 written, the flag word as read.
    const record = '108,1,2,-35,0,0,0,-1,13.8888888889,5587,0.06,0.1,20,20,0.667,0,0.56,0.5,0.5,0'.split(',')
    const typed = roadEngCurveChanges({ widening: { insideM: 0.5, outsideM: 0.2 } }, record, 1, null, false, true)!
    expect(typed.widening).toEqual({ insideM: 0.5, outsideM: 0.2 })
    // Bits 12 and 5 as read (other bits are the superelevation writer's).
    expect((typed.flags ?? 5587) & (4096 | 32)).toBe(5587 & (4096 | 32))
    // The export says RoadEng recalculates it unless the box is unticked there.
    expect(roadEngOutsideAutoNote(typed, record, 1, false)).toMatch(
      /^PI 1: its outside widening is written as 0\.2 m, but RoadEng recalculates it from its widening table unless the curve's outside Widening Auto box is unticked there\.$/,
    )
    // No line where the value written is the table's, the outside is unchanged, or the outside reads off or unknown.
    expect(roadEngOutsideAutoNote(typed, record, 1, true)).toBeNull()
    expect(roadEngOutsideAutoNote({ widening: { insideM: 0.8, outsideM: 0.5 } }, record, 1, false)).toBeNull()
    const off = [...record]
    off[9] = '1521'
    expect(roadEngOutsideAutoNote(typed, off, 1, false)).toBeNull()
    const odd = [...record]
    odd[9] = String(5587 | 32)
    expect(roadEngOutsideAutoNote(typed, odd, 1, false)).toBeNull()
  })
  it('keeps a typed outside value where the outside Auto is off and the table gives that side', () => {
    const m = roadEngCurveWidening(
      { insideM: 1, outsideM: 1 },
      { insideM: 1, outsideM: 1 },
      {
        autoInside: true,
        autoOutside: false,
        ruleVaries: true,
      },
    )
    expect(m).toEqual({ outsideWideningM: 1 })
    expect(
      roadEngCurveWidening(
        { insideM: 1, outsideM: 1 },
        { insideM: 1, outsideM: 1 },
        { autoInside: true, autoOutside: true, ruleVaries: true },
      ),
    ).toBeNull()
  })
})

// A road written as a RoadEng project and opened again, as the page does.
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
const records108 = (bytes: Uint8Array) =>
  strFromU8(bytes, true)
    .split(/\r?\n/)
    .filter((l) => l.startsWith('108,'))
    .map((l) => l.split(','))
function writeProject(alignment: Alignment) {
  const zip = roadEngProjectExport({
    name: 'Spur 9',
    roads: [{ alignment }],
    grid: roadEngExportGrid(createDemoProject().terrain, utmGrid),
    // A stream, so the project's terrain has something drawn to write.
    context: [
      {
        id: 's',
        name: 'Willow Creek',
        kind: 'stream' as const,
        geometry: { type: 'LineString' as const, coordinates: [lonLat(50, 0), lonLat(60, 300)] },
      },
    ],
    cables: [],
    reference: [],
  })
  for (const [name, bytes] of Object.entries(unzipSync(zip.bytes)))
    if (name.endsWith('.dsnx')) return { zip: zip.bytes, ds2: unzipSync(bytes)['Location1.ds2'] }
  throw Error('no design written')
}

describe('per-curve widening through a RoadEng project', () => {
  const spur: Alignment = {
    id: 'r',
    name: 'Spur 9',
    color: '#000000',
    points: [
      { id: 'a', coordinate: lonLat(0, 0), radiusM: 0 },
      { id: 'b', coordinate: lonLat(200, 0), radiusM: 40 },
      { id: 'c', coordinate: lonLat(260, 150), radiusM: 40, curve: { insideWideningM: 0.9, outsideWideningM: 0 } },
      { id: 'd', coordinate: lonLat(420, 180), radiusM: 0 },
    ],
    vertical: [],
    template: { ...DEFAULT_TEMPLATE },
    overrides: [],
    curveDesign: rule,
  }
  spur.vertical = [
    { id: 'v1', chainage: 0, elevation: 800, curveLength: 0 },
    { id: 'v2', chainage: alignmentLength(spur), elevation: 812, curveLength: 0 },
  ]
  it('writes the table’s curves with Auto on and a curve’s own widening with it off, and reads them back', () => {
    const { zip, ds2 } = writeProject(spur)
    const [b, c] = records108(ds2)
    expect(Number(b[9]) & ROADENG_AUTO_WIDENING_INSIDE_BIT).toBe(ROADENG_AUTO_WIDENING_INSIDE_BIT)
    expect(Number(c[9]) & ROADENG_AUTO_WIDENING_INSIDE_BIT).toBe(0)
    expect([Number(c[17]), Number(c[18])]).toEqual([0.9, 0])
    const opened = roadEngProject([{ name: 'Spur 9.zip', bytes: zip }], options)
    const back = opened.roads[0].alignment
    expect(back.points[2].curve).toMatchObject({ insideWideningM: 0.9, outsideWideningM: 0 })
    expect(back.points[1].curve?.insideWideningM).toBeUndefined()
    // Written again unedited, every curve record is the same.
    const again = writeProject(back)
    expect(records108(again.ds2).map((f) => f.slice(6).join())).toEqual(records108(ds2).map((f) => f.slice(6).join()))
    // One curve's widening edited: only its fields 17 and 18 change (the flag stays: Auto already off).
    const edited = {
      ...back,
      points: back.points.map((p, k) =>
        k === 2 ? { ...p, curve: { ...p.curve, insideWideningM: 1.2, outsideWideningM: 0.3 } } : p,
      ),
    }
    const changed = records108(writeProject(edited).ds2)
    const before = records108(again.ds2)
    expect(changed[0]).toEqual(before[0])
    expect(changed[1].map((v, k) => (v === before[1][k] ? null : k)).filter((k) => k !== null)).toEqual([17, 18])
  })
})

// Softree's samples (support.softree.com tutorials), never committed: ROADENG_SAMPLE_PACK is the
// pack's `samples` folder, ROADENG_SAMPLES the older sample folder.
const pack = process.env.ROADENG_SAMPLE_PACK
const older = process.env.ROADENG_SAMPLES
const read = (root: string, path: string) => new Uint8Array(readFileSync(join(root, path)))

describe.skipIf(!pack || !existsSync(pack))('the sample pack’s per-curve widening', () => {
  it('opens the bluff road with 1 ft of inside widening on each of its five curves', () => {
    const dir = 'tutorial-v10/RoadEngCivil/Location2'
    const bytes = read(pack!, `${dir}/bluff_road.dsnx`)
    const { settings } = readRoadEngSettings(bytes).parts[0]
    expect(settings.curves.map((c) => Number(c.raw[9]))).toEqual([113, 113, 113, 113, 113])
    const m = roadEngWideningFor(settings)
    expect(m.wideningTable).toBeNull()
    expect(m.comparison.every((c) => c.pgmapsInsideM === 0.3048 && c.pgmapsOutsideM === 0)).toBe(true)
    const opened = roadEngProject(
      [
        { name: 'bluff_road.dsnx', bytes },
        { name: 'bluff_road.terx', bytes: read(pack!, `${dir}/bluff_road.terx`) },
      ],
      options,
    )
    const road = opened.roads[0].alignment
    const curves = horizontalCurveSummary(road)
    expect(curves).toHaveLength(5)
    for (const curve of curves) {
      const own = road.points.find((p) => p.id === curve.pointId)!.curve
      expect(own?.insideWideningM).toBe(0.3048)
      const c = evaluateCurveCriteria(road.curveDesign!, curve.radius, curve.deflectionDegrees, own)
      expect([c.insideWideningM, c.outsideWideningM]).toEqual([0.3048, 0])
      expect(curveDesignAt(road, (curve.start + curve.end) / 2)!.extraWidth).toBeCloseTo(0.3048, 9)
    }
  })
  it('reads Location 18’s table widening on the inside only, every curve as RoadEng stored it', () => {
    const bytes = read(pack!, 'tutorial-v11/RoadEngResource/Location/Location 18_1.dsnx')
    const m = roadEngWideningFor(readRoadEngSettings(bytes).parts[0].settings)
    expect(m.wideningTable!.every((r) => r.outsideM === 0)).toBe(true)
    expect(m.comparison.filter((c) => c.roadEngInsideM > 0)).toHaveLength(7)
    for (const c of m.comparison) {
      expect(c.autoInside).toBe(true)
      expect(c.pgmapsInsideM).toBeCloseTo(c.roadEngInsideM, 9)
      expect(c.pgmapsOutsideM).toBe(0)
      expect(c.own).toBeNull()
    }
  })
})

/** A design and its terrain opened as the page opens them, and written back as a project. */
async function openAndWrite(root: string, paths: string[], edit?: (a: Alignment) => Alignment) {
  const files = paths.map((p) => ({ name: p.split('/').pop()!, bytes: read(root, p) }))
  const r = roadEngProject(files, { ...options, verticalReference: 'CGVD2013' })
  const terrain = r.originalTer
    ? withRoadEngOriginal(r.terrain, { record: r.originalTer.record, sha256: await sha256Hex(r.originalTer.bytes) })
    : r.terrain
  const demo = createDemoProject()
  const project: RoadProject = parseProject(
    JSON.parse(
      JSON.stringify({
        ...demo,
        terrain,
        alignments: r.roads.map((x) => (edit ? edit(x.alignment) : x.alignment)),
        activeAlignmentId: r.roads[0].alignment.id,
        context: r.context,
        cables: r.cables,
        reference: r.reference,
        settings: { ...DEFAULT_ROAD_SETTINGS },
      }),
    ),
  )
  const source = terrainFromMetadata(project.terrain)
  const out = roadEngProjectExport({
    name: 'pack',
    roads: project.alignments.map((alignment) => ({ alignment })),
    grid: roadEngExportGrid(project.terrain, exportGrid(project.terrain, project.alignments[0].points[0].coordinate)),
    context: project.context,
    cables: project.cables,
    reference: project.reference ?? [],
    ...(source ? { elevationAt: (c: Coordinate) => source.elevationAt(c[0], c[1]) } : {}),
    terrainSource: project.terrain.roadEngSource ?? null,
    terrain: project.terrain,
    originalTer: r.originalTer?.bytes ?? null,
  })
  for (const [name, bytes] of Object.entries(unzipSync(out.bytes)))
    if (name.endsWith('.dsnx')) return { project, ds2: unzipSync(bytes)['Location1.ds2'] }
  throw Error('no design written')
}
const originalDs2 = (root: string, path: string) => unzipSync(read(root, path))['Location1.ds2']

describe.skipIf(!pack || !existsSync(pack))('the sample pack’s curves written back', { timeout: 120_000 }, () => {
  const bluff = [
    'tutorial-v10/RoadEngCivil/Location2/bluff_road.dsnx',
    'tutorial-v10/RoadEngCivil/Location2/bluff_road.terx',
  ]
  const location18 = [
    'tutorial-v11/RoadEngResource/Location/Location 18_1.dsnx',
    'tutorial-v11/RoadEngResource/Location/Terrain9_1.terx',
  ]
  it.each([[bluff], [location18]])('writes %s’s curve records back as read', async (paths) => {
    const { ds2 } = await openAndWrite(pack!, paths)
    // The flag word and the inside and outside widening are the record's own.
    const widening = (f: string[]) => [f[9], f[17], f[18]].join()
    expect(records108(ds2).map(widening)).toEqual(records108(originalDs2(pack!, paths[0])).map(widening))
  })
  it('writes an edited bluff road curve’s widening into its record alone, Auto still off', async () => {
    const { ds2 } = await openAndWrite(pack!, bluff, (a) => ({
      ...a,
      points: a.points.map((p, k) => (k === 3 ? { ...p, curve: { ...p.curve, insideWideningM: 0.6096 } } : p)),
    }))
    const before = records108(originalDs2(pack!, bluff[0]))
    const after = records108(ds2)
    after.forEach((f, k) => {
      const changed = [9, 17, 18].filter((i) => f[i] !== before[k][i])
      expect(changed).toEqual(k === 2 ? [17] : [])
    })
    expect(Number(after[2][17])).toBeCloseTo(2, 9)
    expect(after[2][9]).toBe('113')
  })
  it('writes a Location 18 curve given its own widening with Auto off', async () => {
    const own = await openAndWrite(pack!, location18, (a) => ({
      ...a,
      points: a.points.map((p, k) => (k === 3 ? { ...p, curve: { ...p.curve, insideWideningM: 1.2 } } : p)),
    }))
    const before = records108(originalDs2(pack!, location18[0]))
    const typed = records108(own.ds2)[2]
    expect(typed[9]).toBe(String(1521 - 128))
    expect(Number(typed[17])).toBeCloseTo(1.2, 9)
    const widening = (f: string[]) => [f[9], f[17], f[18]].join()
    expect(records108(own.ds2).filter((f, k) => widening(f) !== widening(before[k]))).toHaveLength(1)
  })
})

describe.skipIf(!older || !existsSync(older))('the older samples’ per-curve widening', () => {
  it('reads LongRoad’s table widening on both sides, and the cul-de-sac design’s typed zeros', () => {
    const long = roadEngWideningFor(readRoadEngSettings(read(older!, 'LongRoad_1/LongRoad 1.dsnx')).parts[0].settings)
    expect(long.wideningTable!.some((r) => r.outsideM > 0)).toBe(true)
    expect(long.comparison.filter((c) => c.roadEngInsideM > 0)).toHaveLength(5)
    expect(long.comparison.every((c) => c.own === null && c.pgmapsInsideM === c.roadEngInsideM)).toBe(true)
    const cul = readRoadEngSettings(read(older!, 'Cul-de-sac-design/CulDeSacExample/CulDeSacExampleComplete.dsnx'))
    for (const part of cul.parts) {
      const m = roadEngWideningFor(part.settings)
      expect(m.wideningTable).toBeNull()
      // The table gives 2–2.5 m at its R 30 m curves; RoadEng holds 0 with Auto off.
      expect(m.comparison.every((c) => c.autoInside === false && c.pgmapsInsideM === 0)).toBe(true)
    }
  })
})
