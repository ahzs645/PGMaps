import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { alignmentLength, offsetCoordinate } from './engine'
import { createEngineeringDesign, type Culvert } from './engineeringTypes'
import { parseEngineering } from './engineeringProject'
import { roadEngDesign } from './roadEngExport'
import { roadEngProject } from './roadEngProject'
import { parseRoadEngDesign, roadEngRoads } from './roadEngImport'
import {
  carryWrittenCulvertFields,
  culvertsFromDesign,
  emptyRoadEngIndex,
  parseRoadEngPlacedCulvertRecord,
  readPlacedCulvert,
  readRoadEngCulvertRecords,
  roadEngNumber,
  withDesignCulverts,
  writeDesignCulverts,
} from './roadEngPlacedCulverts'
import { LOCAL_PLANE_EPSG, localPlaneProjection } from './localPlane'
import { DEFAULT_TEMPLATE, localMetricGrid } from './terrain'
import type { Alignment, Coordinate } from './types'

// Records written in RoadEng's layout with this file's own values (never copied from Softree's samples).
const STREAM =
  'Creek A%#%|1,1234.5,3.40282346639e+38,900,80,1.5,7.25,6.5,0,412,2,0, 0, 0, 2, 1.5, 3, 2, 0, 3.40282346639e+38'
const DRAIN = '%#%|0,1400,3.40282346639e+038,450,95,2,6,6,1.2,272,2,0,0,0,0,0,3,2,0,3.40282346639e+038'
const FAR = 'Past the end%#%|0,9000,3.40282346639e+38,600,90,2,5,5,1,272,2,0,0,0,0,0,3,2,0,3.40282346639e+38'

/** A `.ds1` as RoadEng lays one out: three chunks, junk in each header's last 8 bytes, a section 3 payload. */
function ds1(records: string[], section3: number[] = []): Uint8Array {
  const text = records.map((r) => [r.length & 0xff, r.length >> 8, ...[...r].map((c) => c.charCodeAt(0))])
  const payload2 = text.flat()
  const header = (section: number, count: number, size: number) => {
    const h = new Uint8Array(24)
    const v = new DataView(h.buffer)
    v.setUint16(0, 12, true)
    v.setUint16(2, section, true)
    v.setUint32(4, count, true)
    v.setUint32(8, size, true)
    h.set([0x3b, 0x28, 0x2a, 0x76, 0xfa, 0x7f, 0, 0], 16)
    return [...h]
  }
  return new Uint8Array([
    ...header(1, 0, 0),
    ...header(2, records.length, payload2.length),
    ...payload2,
    ...header(3, section3.length ? 1 : 0, section3.length),
    ...section3,
  ])
}
const SECTION3 = [0xff, 0xff, 0xff, 0xff, 0x3b, 0, 0, 0, 3, 0, 0x34, 0x31, 0x2c]
const frame = { startStation: 1000, endStation: 2000, stationScale: 1.0005 }
let id = 0
const newId = () => `c${id++}`
const source = (bytes: Uint8Array, unitM = 1) => ({ ds1: bytes, unitM, frame, read: true })
const target = { unitM: 1, startStation: frame.startStation, stationScale: frame.stationScale }

describe('RoadEng placed culverts (.ds1)', () => {
  it('reads every field a record holds, FLT_MAX as no value', () => {
    const f = readPlacedCulvert(STREAM, 1)!
    expect(f).toMatchObject({
      description: 'Creek A',
      kind: 'stream',
      stationM: 1234.5,
      pStationM: null,
      diameterM: 0.9,
      skewFromLineDeg: 80,
      gradientPercent: 1.5,
      leftM: 7.25,
      rightM: 6.5,
      depthM: 0,
      flags: 412,
    })
    expect(f.fields).toHaveLength(20)
    // A feet design: thousandths of a foot, and the station in feet.
    expect(readPlacedCulvert(STREAM, 0.3048)!.diameterM).toBeCloseTo(0.27432, 9)
    expect(readPlacedCulvert('no delimiter', 1)).toBeNull()
  })

  it('places each record on the road at the chainage of its station, keeping it', () => {
    const { culverts, notes } = culvertsFromDesign(ds1([STREAM, DRAIN, FAR]), { unitM: 1, frame, newId })
    expect(culverts).toHaveLength(2)
    expect(culverts[0]).toMatchObject({
      name: 'Creek A',
      kind: 'stream',
      chainage: Math.round(234.5 * 1.0005 * 1000) / 1000,
      diameterM: 0.9,
      // Clockwise from the L-line ahead, 90 square: 80 turns the right end 10° up-station.
      skewDegrees: -10,
      lengthM: 13.75,
      inletInvertM: null,
      roadEngDesign: { index: 0, raw: STREAM, unitM: 1 },
    })
    expect(culverts[1]).toMatchObject({ name: 'Cross-drain 2', kind: 'cross-drain', skewDegrees: 5, diameterM: 0.45 })
    expect(notes.join(' ')).toMatch(/1 of the design's 3 placed culverts is off the road/)
    // The culverts and their records parse as a project's.
    const e = parseEngineering({ ...createEngineeringDesign(), culverts }, (t) => t as typeof DEFAULT_TEMPLATE)
    expect(e.culverts[0].roadEngDesign).toEqual({ index: 0, raw: STREAM, unitM: 1 })
  })

  it('writes an unedited .ds1 back byte for byte, unread records and section 3 included', () => {
    const bytes = ds1([STREAM, DRAIN, FAR], SECTION3)
    const { culverts } = culvertsFromDesign(bytes, { unitM: 1, frame, newId })
    const out = writeDesignCulverts(source(bytes), culverts, target)
    expect(out.ds1).toEqual(bytes)
    expect(out.notes).toEqual([])
    expect(out.culverts.map((c) => c.roadEngDesign)).toEqual(culverts.map((c) => c.roadEngDesign))
  })

  it('changes only the fields an edit changes, each keeping its spacing', () => {
    const bytes = ds1([STREAM, DRAIN, FAR], SECTION3)
    const { culverts } = culvertsFromDesign(bytes, { unitM: 1, frame, newId })
    const edited = culverts.map((c, k) => (k === 0 ? { ...c, diameterM: 1.2, lengthM: 27.5 } : c))
    const out = writeDesignCulverts(source(bytes), edited, target)
    const records = readRoadEngCulvertRecords(out.ds1)!
    // The lengths were RoadEng's to compute (bit 7 of 412): written with Length Auto off (284).
    expect(records[0]).toBe(
      'Creek A%#%|1,1234.5,3.40282346639e+38,1200,80,1.5,14.5,13,0,284,2,0, 0, 0, 2, 1.5, 3, 2, 0, 3.40282346639e+38',
    )
    expect(records.slice(1)).toEqual([DRAIN, FAR])
    // Section 1 and 3 and every header's junk bytes are as read.
    expect(out.ds1.slice(0, 24)).toEqual(bytes.slice(0, 24))
    expect(out.ds1.slice(-SECTION3.length - 24)).toEqual(bytes.slice(-SECTION3.length - 24))
    expect(out.ds1.slice(40, 48)).toEqual(bytes.slice(40, 48))
    expect(out.culverts[0].roadEngDesign).toEqual({ index: 0, raw: records[0], unitM: 1 })
    expect(out.notes).toEqual(['Culverts written to the design: 1 changed, 1 as read.'])
    // Moved, renamed, turned and made a cross drain: station, description, skew and class.
    const moved = writeDesignCulverts(
      source(bytes),
      [{ ...culverts[0], chainage: 300, name: 'Creek B', skewDegrees: 12.5, kind: 'cross-drain' }, culverts[1]],
      target,
    )
    expect(readRoadEngCulvertRecords(moved.ds1)![0]).toBe(
      `Creek B%#%|0,${roadEngNumber(1000 + 300 / 1.0005)},3.40282346639e+38,900,102.5,1.5,7.25,6.5,0,412,2,0, 0, 0, 2, 1.5, 3, 2, 0, 3.40282346639e+38`,
    )
    // A typed RoadEng gradient.
    const graded = writeDesignCulverts(
      source(bytes),
      [{ ...culverts[0], roadEngDesign: { ...culverts[0].roadEngDesign!, gradientPercent: -3 } }, culverts[1]],
      target,
    )
    expect(readRoadEngCulvertRecords(graded.ds1)![0].split(',')[5]).toBe('-3')
    // Gradient Auto (bit 2 of 412) goes off with it, so RoadEng keeps −3 %.
    expect(readRoadEngCulvertRecords(graded.ds1)![0].split(',')[9]).toBe('408')
  })

  it('reads which values RoadEng computes and the template override, and turns Auto off for a value set here', () => {
    // Skew and length Auto on (2 + 128), override on (4096) with a 1.2 m by 0.5 m ditch held 4 m, tapered over 2.5 m.
    const own =
      'Inlet%#%|1,1500,3.40282346639e+38,750,96.5,-1.25,8.125,7.5,0,4506,2,0, 0, 1, 1.2, 0.5, 4, 2.5, 0, 3.40282346639e+38'
    const f = readPlacedCulvert(own, 1)!
    expect(f.auto).toEqual({ skew: true, gradient: false, length: true })
    expect(f.override).toEqual({ on: true, ditchWidthM: 1.2, ditchDepthM: 0.5, offsetM: 4, taperM: 2.5 })
    expect(readPlacedCulvert(STREAM, 1)!.auto).toEqual({ skew: false, gradient: true, length: true })
    expect(readPlacedCulvert(DRAIN, 1)!.override).toEqual({
      on: false,
      ditchWidthM: 0,
      ditchDepthM: 0,
      offsetM: 3,
      taperM: 2,
    })
    const bytes = ds1([own])
    const { culverts } = culvertsFromDesign(bytes, { unitM: 1, frame, newId })
    // Unedited: as read.
    expect(writeDesignCulverts(source(bytes), culverts, target).ds1).toEqual(bytes)
    // A new skew: Skew Auto off (4506 − 2), nothing else.
    const turned = readRoadEngCulvertRecords(
      writeDesignCulverts(source(bytes), [{ ...culverts[0], skewDegrees: 0 }], target).ds1,
    )![0].split(',')
    expect([turned[4], turned[9], turned[6], turned[7]]).toEqual(['90', '4504', '8.125', '7.5'])
    // A new diameter only: the Auto bits stay.
    const wider = readRoadEngCulvertRecords(
      writeDesignCulverts(source(bytes), [{ ...culverts[0], diameterM: 0.9 }], target).ds1,
    )![0].split(',')
    expect([wider[3], wider[9]]).toEqual(['900', '4506'])
    // Written in feet, the override's four lengths convert with the rest.
    const feet = readPlacedCulvert(
      readRoadEngCulvertRecords(writeDesignCulverts(source(bytes), culverts, { ...target, unitM: 0.3048 }).ds1)![0],
      0.3048,
    )!
    expect(feet.override!.ditchWidthM).toBeCloseTo(1.2, 9)
    expect(feet.override!.ditchDepthM).toBeCloseTo(0.5, 9)
    expect(feet.override!.offsetM).toBeCloseTo(4, 9)
    expect(feet.override!.taperM).toBeCloseTo(2.5, 9)
    expect(feet.flags).toBe(4506)
  })

  it('drops a deleted culvert’s record, adds a new one in station order, and keeps unread records', () => {
    const bytes = ds1([STREAM, DRAIN, FAR])
    const { culverts } = culvertsFromDesign(bytes, { unitM: 1, frame, newId })
    const added: Culvert = {
      id: 'new',
      name: 'Ditch relief',
      kind: 'cross-drain',
      chainage: 100,
      skewDegrees: 0,
      lengthM: 12,
      diameterM: 0.6,
      inletInvertM: null,
      outletInvertM: null,
      minCoverM: 0.6,
      unitCost: 0,
      fixedCost: 0,
    }
    const out = writeDesignCulverts(source(bytes), [added, culverts[1]], target)
    const records = readRoadEngCulvertRecords(out.ds1)!
    expect(records).toHaveLength(3)
    expect(records[0]).toBe(
      `Ditch relief%#%|0,${roadEngNumber(1000 + 100 / 1.0005)},3.40282346639e+38,600,90,2,6,6,0,440,2,0, 0, 0, 0, 0, 3, 2, 0, 3.40282346639e+38`,
    )
    expect(records.slice(1)).toEqual([DRAIN, FAR])
    expect(out.notes).toEqual(['Culverts written to the design: 1 new, 1 removed, 1 as read.'])
    expect(out.culverts.find((c) => c.id === 'new')!.roadEngDesign).toEqual({ index: 0, raw: records[0], unitM: 1 })
    // From the design's own default culvert of its kind when it has one.
    const own = writeDesignCulverts(source(bytes), [added], {
      ...target,
      defaults: { 'cross-drain': '%#%|0,77,3.40282e+038,500,90,-1,3,3,0.5,442,2,0,0,0,0,0,5,2,0,3.40282346639e+038' },
    })
    expect(readRoadEngCulvertRecords(own.ds1)![0]).toMatch(
      /^Ditch relief%#%\|0,[\d.]+,3\.40282e\+038,600,90,-1,6,6,0\.5,442,/,
    )
  })

  it('keeps every record of a source whose culverts were never read, and writes a road with none from scratch', () => {
    const bytes = ds1([STREAM, DRAIN])
    const kept = writeDesignCulverts({ ...source(bytes), read: false }, [], target)
    expect(kept.ds1).toEqual(bytes)
    const fresh = writeDesignCulverts(null, [], target)
    expect(fresh.ds1).toEqual(emptyRoadEngIndex())
    const one = writeDesignCulverts(
      null,
      [{ ...culvertsFromDesign(bytes, { unitM: 1, frame, newId }).culverts[0], roadEngDesign: undefined }],
      target,
    )
    expect(readRoadEngCulvertRecords(one.ds1)).toHaveLength(1)
    expect(one.ds1.length).toBe(72 + 2 + readRoadEngCulvertRecords(one.ds1)![0].length)
  })

  it('converts every length of a record written in other units', () => {
    const bytes = ds1([STREAM])
    const { culverts } = culvertsFromDesign(bytes, { unitM: 1, frame, newId })
    const out = writeDesignCulverts(source(bytes), culverts, { ...target, unitM: 0.3048 })
    const f = readPlacedCulvert(readRoadEngCulvertRecords(out.ds1)![0], 0.3048)!
    expect(f.diameterM).toBeCloseTo(0.9, 9)
    expect(f.leftM).toBeCloseTo(7.25, 6)
    expect(f.rightM).toBeCloseTo(6.5, 6)
    expect(f.stationM).toBeCloseTo(1234.5, 3)
  })

  it('finds the culverts after floating labels whose section states the wrong byte count', () => {
    // Section 1: one label (u16 length, text, a 60-byte format), its header stating 3 bytes fewer.
    const label = 'Tie-in%#%\n12.5,-3.25,2,-1'
    const note = [label.length, 0, ...[...label].map((c) => c.charCodeAt(0)), ...new Array(60).fill(7)]
    const plain = ds1([STREAM])
    const head = new Uint8Array(24)
    const v = new DataView(head.buffer)
    v.setUint16(0, 12, true)
    v.setUint16(2, 1, true)
    v.setUint32(4, 1, true)
    v.setUint32(8, note.length - 3, true)
    const bytes = new Uint8Array([...head, ...note, ...plain.slice(24)])
    expect(readRoadEngCulvertRecords(bytes)).toEqual([STREAM])
    const { culverts } = culvertsFromDesign(bytes, { unitM: 1, frame, newId })
    expect(culverts).toHaveLength(1)
    expect(writeDesignCulverts(source(bytes), culverts, target).ds1).toEqual(bytes)
    const moved = writeDesignCulverts(source(bytes), [{ ...culverts[0], diameterM: 1 }], target).ds1
    expect(moved.slice(0, 24 + note.length)).toEqual(bytes.slice(0, 24 + note.length))
    expect(readPlacedCulvert(readRoadEngCulvertRecords(moved)![0], 1)!.diameterM).toBe(1)
  })

  it('keeps a design that does not read as it was', () => {
    const broken = new Uint8Array([12, 0, 2, 0, 9])
    expect(culvertsFromDesign(broken, { unitM: 1, frame, newId }).notes[0]).toMatch(/could not be read/)
    expect(writeDesignCulverts(source(broken), [], target).ds1).toBe(broken)
  })

  it('adds a culvert only the .ds1 holds, and carries what PGMaps wrote across a RoadEng save', () => {
    const bytes = ds1([STREAM, DRAIN])
    const { culverts } = culvertsFromDesign(bytes, { unitM: 1, frame, newId })
    expect(withDesignCulverts([culverts[0]], culverts)).toEqual(culverts)
    const carried = carryWrittenCulvertFields(culverts, {
      culverts: [{ ...culverts[1], id: 'mine', unitCost: 410, minCoverM: 0.9, inletInvertM: 700, outletInvertM: 699 }],
    })
    expect(carried[1]).toMatchObject({
      id: 'mine',
      unitCost: 410,
      minCoverM: 0.9,
      inletInvertM: 700,
      outletInvertM: 699,
    })
    expect(carried[0]).toEqual(culverts[0])
  })

  it('refuses a malformed kept record', () => {
    expect(() => parseRoadEngPlacedCulvertRecord({ index: -1, raw: STREAM, unitM: 1 })).toThrow(/place/)
    expect(() => parseRoadEngPlacedCulvertRecord({ index: 0, raw: 'x', unitM: 1 })).toThrow(/as read/)
    expect(() => parseRoadEngPlacedCulvertRecord({ index: 0, raw: STREAM, unitM: 0 })).toThrow(/unit/)
    expect(() => parseRoadEngPlacedCulvertRecord({ index: 0, raw: STREAM, unitM: 1, gradientPercent: 'x' })).toThrow(
      /gradient/,
    )
  })
})

describe('placed culverts through a RoadEng design', () => {
  const origin: Coordinate = [-122.75, 53.917]
  const at = (east: number, north: number) =>
    offsetCoordinate(origin, (Math.atan2(east, north) * 180) / Math.PI, Math.hypot(east, north))
  const road: Alignment = {
    id: 'r',
    name: 'Spur 7',
    color: '#000000',
    points: [
      { id: 'a', coordinate: at(0, 0), radiusM: 0 },
      { id: 'b', coordinate: at(0, 150), radiusM: 60 },
      { id: 'c', coordinate: at(120, 300), radiusM: 0 },
    ],
    vertical: [
      { id: 'v0', chainage: 0, elevation: 800, curveLength: 0 },
      { id: 'v1', chainage: 340, elevation: 812, curveLength: 0 },
    ],
    template: { ...DEFAULT_TEMPLATE },
    overrides: [],
  }
  road.vertical[1].chainage = alignmentLength(road)
  const grid = localMetricGrid(origin)
  const culvert = (name: string, chainage: number, extra: Partial<Culvert> = {}): Culvert => ({
    id: name,
    name,
    kind: 'stream',
    chainage,
    skewDegrees: 20,
    lengthM: 14,
    diameterM: 0.8,
    inletInvertM: null,
    outletInvertM: null,
    minCoverM: 0.6,
    unitCost: 120,
    fixedCost: 0,
    ...extra,
  })
  it('writes a road’s culverts, reads them back where they were, and writes them back unchanged', () => {
    const withCulverts: Alignment = {
      ...road,
      engineering: {
        ...createEngineeringDesign(),
        culverts: [culvert('Creek', 120), culvert('Relief', 40, { kind: 'cross-drain', skewDegrees: -5 })],
      },
    }
    const out = roadEngDesign([{ alignment: withCulverts }], grid.toGrid)
    expect(out.notes.join(' ')).toMatch(/2 new/)
    const { roads } = roadEngRoads(out.bytes, {
      fileName: 'Spur 7.dsnx',
      newId,
      color: () => '#123456',
      template: { ...DEFAULT_TEMPLATE },
      epsg: grid.epsg,
    })
    const back = roads[0].culverts
    expect(back.map((c) => c.name)).toEqual(['Relief', 'Creek'])
    expect(back[0]).toMatchObject({ kind: 'cross-drain', skewDegrees: -5, diameterM: 0.8, lengthM: 14 })
    expect(back[1].chainage).toBeCloseTo(120, 2)
    expect(back[1].skewDegrees).toBe(20)
    expect(roads[0].alignment.engineering?.culverts).toHaveLength(2)
    // [PGMaps] keeps the culverts with the records written, so the design opens back onto them.
    const dsn = strFromU8(unzipSync(out.bytes)['Location1.dsn'], true)
    const engineering = JSON.parse(/^Engineering=(.*)$/m.exec(dsn)![1])
    expect(engineering.culverts.map((c: Culvert) => c.roadEngDesign?.index)).toEqual([1, 0])
    // Unedited, the .ds1 goes back as read.
    const again = roadEngDesign([{ alignment: roads[0].alignment, source: roads[0].source.source }], grid.toGrid)
    expect(unzipSync(again.bytes)['Location1.ds1']).toEqual(unzipSync(out.bytes)['Location1.ds1'])
    expect(alignmentLength(roads[0].alignment)).toBeGreaterThan(300)
  })
})

// Softree's published sample pack, read from a local copy and never committed.
const pack = process.env.ROADENG_SAMPLE_PACK
describe.skipIf(!pack || !existsSync(pack ?? ''))(
  'placed culverts in the RoadEng sample pack',
  { timeout: 120_000 },
  () => {
    const designs: [string, number, { station: number; diameterM: number; skewDegrees: number }[]][] = [
      [
        // Its first culvert, at 15228.516 m, lies before the road's start (15500 m): kept in the file, unread.
        'widening-only/Widening only/Widening only.dsnx',
        2,
        [
          { station: 15658.806, diameterM: 0.6, skewDegrees: 1 },
          { station: 16427.205, diameterM: 0.75, skewDegrees: 2 },
        ],
      ],
      [
        'tutorial-v10/RoadEngCivil/Location/Align stage 8.dsnx',
        1,
        [{ station: 1391.181 * 0.3048, diameterM: 1.524, skewDegrees: 0 }],
      ],
      ['tutorial-v10/SoftreeOptimal/Hart Rd.dsnx', 1, [{ station: 399.9999998, diameterM: 1, skewDegrees: 0 }]],
      [
        'tutorial-v11/RoadEngResource/Location/Location 18_1.dsnx',
        2,
        [
          { station: 338, diameterM: 0.6, skewDegrees: -15 },
          { station: 573.2, diameterM: 0.6, skewDegrees: 42.637523 },
        ],
      ],
      ['tutorial-v11/RoadEngResource/Location/Location 18_3.dsnx', 2, []],
      ['guardrails/GuardRail.dsnx', 0, []],
    ]
    for (const [path, count, expected] of designs)
      it(`reads ${path.split('/').pop()}'s culverts and writes them back byte for byte`, () => {
        const bytes = new Uint8Array(readFileSync(join(pack!, path)))
        const design = parseRoadEngDesign(bytes)
        const unitM = design.unitM
        const plane = localPlaneProjection([0, 0])
        const placement = { epsg: LOCAL_PLANE_EPSG, toLonLat: (xy: [number, number]) => plane.toLonLat([xy[0], xy[1]]) }
        const { roads } = roadEngRoads(bytes, {
          fileName: path.split('/').pop()!,
          newId,
          color: () => '#123456',
          template: { ...DEFAULT_TEMPLATE },
          placement,
        })
        const [road] = roads
        expect(road.culverts).toHaveLength(count)
        expected.forEach((e, k) => {
          const c = road.culverts[k]
          expect(c.chainage).toBeCloseTo((e.station - road.source.startStation) * road.stationScale, 2)
          expect(c.diameterM).toBeCloseTo(e.diameterM, 6)
          expect(c.skewDegrees).toBeCloseTo(e.skewDegrees, 5)
        })
        const original = unzipSync(bytes)['Location1.ds1']
        const toGrid = (c: Coordinate) => plane.toFile(c)
        const written = unzipSync(
          roadEngDesign([{ alignment: road.alignment, source: road.source.source }], toGrid).bytes,
        )['Location1.ds1']
        expect(written).toEqual(original)
        if (!count) return
        // One edit changes one field of one record.
        const edited = road.alignment.engineering!.culverts.map((c, k) =>
          k === 0 ? { ...c, diameterM: c.diameterM + 0.1 } : c,
        )
        const changed = readRoadEngCulvertRecords(
          unzipSync(
            roadEngDesign(
              [
                {
                  alignment: { ...road.alignment, engineering: { ...road.alignment.engineering!, culverts: edited } },
                  source: road.source.source,
                },
              ],
              toGrid,
            ).bytes,
          )['Location1.ds1'],
        )!
        const before = readRoadEngCulvertRecords(original)!
        const k = road.culverts[0].roadEngDesign!.index
        expect(changed.filter((_, i) => i !== k)).toEqual(before.filter((_, i) => i !== k))
        const a = before[k].split(','),
          b = changed[k].split(',')
        expect(a.map((v, i) => (v === b[i] ? null : i)).filter((i) => i !== null)).toEqual([3])
        expect(Number(b[3])).toBeCloseTo((edited[0].diameterM / unitM) * 1000, 6)
      })
    it('opens Location 18_1 as a project with its culverts, and they survive a write and reopen once each', () => {
      const name = 'Location 18_1.dsnx'
      const bytes = new Uint8Array(readFileSync(join(pack!, 'tutorial-v11/RoadEngResource/Location', name)))
      const opts = { newId, color: () => '#123456', template: { ...DEFAULT_TEMPLATE }, verticalReference: '' }
      const r = roadEngProject([{ name, bytes }], opts)
      const alignment = r.roads[0].alignment
      expect(alignment.engineering!.culverts.map((c) => c.name)).toEqual([
        'Grade stream channel through ditch to match inlet',
        'Stream culvert 2',
      ])
      expect(r.notes.join(' ')).toMatch(/2 placed culverts read from its \.ds1/)
      const toGrid = localPlaneProjection(r.localPlane!.offsetM).toFile
      const write = (a: Alignment) => roadEngDesign([{ alignment: a, source: a.roadEngSource }], toGrid).bytes
      const once = write(alignment)
      expect(unzipSync(once)['Location1.ds1']).toEqual(unzipSync(bytes)['Location1.ds1'])
      // Opened again, the culverts come back from [PGMaps] with their records, once each.
      const again = roadEngProject([{ name, bytes: once }], { ...opts, noCrs: r.localPlane! })
      const back = again.roads[0].alignment.engineering!.culverts
      expect(back).toHaveLength(2)
      expect(back.map((c) => c.roadEngDesign)).toEqual(alignment.engineering!.culverts.map((c) => c.roadEngDesign))
      // One deleted and written: the .ds1 holds the other alone, and the design opens with it alone.
      const fewer = write({
        ...alignment,
        engineering: { ...alignment.engineering!, culverts: [alignment.engineering!.culverts[1]] },
      })
      expect(readRoadEngCulvertRecords(unzipSync(fewer)['Location1.ds1'])).toEqual([
        readRoadEngCulvertRecords(unzipSync(bytes)['Location1.ds1'])![1],
      ])
      const reopened = roadEngProject([{ name, bytes: fewer }], { ...opts, noCrs: r.localPlane! })
      expect(reopened.roads[0].alignment.engineering!.culverts.map((c) => c.name)).toEqual(['Stream culvert 2'])
    })
  },
)
