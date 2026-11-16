import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { alignmentLength, analyzeRoad, distance, offsetCoordinate } from './engine'
import proj4 from 'proj4'
import { projectedCrsDefinition } from '@/lib/geo/projectedCrs'
import { centreSurfacingM, latin1Bytes, mergeRoadEngIni, roadEngDesign } from './roadEngExport'
import {
  base64ToBytes,
  isRoadEngDesign,
  parseRoadEngDesign,
  roadEngCurvesByPoint,
  roadEngRoads,
  stationEvents,
  type RoadEngSource,
} from './roadEngImport'
import { roadEngProject } from './roadEngProject'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE, localMetricGrid } from './terrain'
import type { Alignment, Coordinate, TerrainSource } from './types'

const origin: Coordinate = [-122.75, 53.917]
const at = (east: number, north: number) =>
  offsetCoordinate(origin, (Math.atan2(east, north) * 180) / Math.PI, Math.hypot(east, north))
const plan: Alignment = {
  id: 'r',
  name: 'Spur 7',
  color: '#000000',
  points: [
    { id: 'a', coordinate: at(0, 0), radiusM: 0 },
    { id: 'b', coordinate: at(0, 150), radiusM: 60 },
    { id: 'c', coordinate: at(120, 220), radiusM: 50 },
    { id: 'd', coordinate: at(120, 380), radiusM: 0 },
  ],
  vertical: [],
  template: { ...DEFAULT_TEMPLATE },
  overrides: [],
}
// The profile runs the road's whole length, as a designed road's does.
const road: Alignment = {
  ...plan,
  vertical: [
    { id: 'v0', chainage: 0, elevation: 800, curveLength: 0 },
    { id: 'v1', chainage: 180, elevation: 809, curveLength: 40 },
    { id: 'v2', chainage: 300, elevation: 805, curveLength: 30 },
    { id: 'v3', chainage: alignmentLength(plan), elevation: 806, curveLength: 0 },
  ],
}
const flat: TerrainSource = { elevationAt: () => 800 }
const grid = localMetricGrid(origin)
const options = {
  fileName: 'Spur 7.dsnx',
  newId: () => 'back',
  color: () => '#123456',
  template: { ...DEFAULT_TEMPLATE },
}

describe('RoadEng design export', () => {
  const analysis = analyzeRoad(road, flat, DEFAULT_ROAD_SETTINGS)
  const written = roadEngDesign([{ alignment: road, analysis }], grid.toGrid)

  it('writes the parts RoadEng 11 writes, in metres, named after the road', () => {
    expect(isRoadEngDesign(written.bytes.subarray(0, 4096))).toBe(true)
    const files = unzipSync(written.bytes)
    expect(Object.keys(files).sort()).toEqual(['Location1.ds1', 'Location1.ds2', 'Location1.dsn'])
    expect([...files['Location1.ds1']].filter((b) => b).length).toBe(6)
    const ds2 = strFromU8(files['Location1.ds2'], true)
    expect(ds2.split('\r\n')[0]).toHaveLength(126)
    expect(ds2).toMatch(/\r\n118,1\r\n$/)
    const read = parseRoadEngDesign(written.bytes)
    expect(read).toMatchObject({ version: '11.0.673.0', unitM: 1, terrain: null })
    expect(read.alignments[0].name).toBe('Spur 7')
    expect(read.alignments[0].pis.map((p) => p.turn)).toEqual(['right', 'left'])
  })

  it('reads back exactly: the reader rebuilds its own stations and levels', () => {
    const [a] = parseRoadEngDesign(written.bytes).alignments
    expect(a.checks.planOffsetM).toBeLessThan(0.001)
    expect(a.checks.profileDifferenceM!).toBeLessThan(0.001)
    expect(a.followsStations).toEqual({ plan: false, profile: false })
  })

  it('writes the finished surface, as RoadEng profiles a road: the subgrade plus its surfacing', () => {
    const [a] = parseRoadEngDesign(written.bytes).alignments
    expect(centreSurfacingM(road)).toBe(DEFAULT_TEMPLATE.surfaceDepth)
    expect(a.profile[1].elevation).toBeCloseTo(road.vertical[1].elevation + DEFAULT_TEMPLATE.surfaceDepth, 6)
    expect(a.pgmaps).toEqual({
      surfacingM: DEFAULT_TEMPLATE.surfaceDepth,
      template: road.template,
      engineering: null,
      curveDesign: null,
      costs: null,
      // Written with its fingerprint and read back unchanged.
      nativeChanged: false,
    })
    expect(written.notes).toContain("Spur 7's levels are its finished surface, 0.25 m of surfacing above the subgrade.")
  })

  it('round-trips the road: points, radii, section and profile within a millimetre', () => {
    const [back] = roadEngProject([{ name: 'Spur 7.dsnx', bytes: written.bytes }], {
      ...options,
      verticalReference: '',
      noCrs: 'ask',
      epsg: grid.epsg,
    }).roads
    expect(back.alignment.name).toBe('Spur 7 · Spur 7')
    expect(back.alignment.template).toEqual(road.template)
    back.alignment.points.forEach((p, k) => {
      expect(distance(p.coordinate, road.points[k].coordinate)).toBeLessThan(0.001)
      expect(p.radiusM).toBeCloseTo(road.points[k].radiusM, 2)
    })
    expect(back.alignment.vertical).toHaveLength(road.vertical.length)
    back.alignment.vertical.forEach((p, k) => {
      expect(p.chainage).toBeCloseTo(road.vertical[k].chainage, 2)
      expect(p.elevation).toBeCloseTo(road.vertical[k].elevation, 3)
      expect(p.curveLength).toBeCloseTo(road.vertical[k].curveLength, 2)
    })
  })

  it('writes a spiralled curve as a RoadEng spiral that reads back with its spiral', () => {
    const spiralled = { ...road, points: road.points.map((p, k) => (k === 2 ? { ...p, spiralM: 20 } : p)) }
    const out = roadEngDesign([{ alignment: spiralled, analysis }], grid.toGrid)
    expect(out.notes.join(' ')).toMatch(/1 spiralled curve is written as RoadEng spiral curves? \(type 3\)/)
    const [a] = parseRoadEngDesign(out.bytes).alignments
    expect(a.pis[1].type).toBe(3)
    expect(a.pis[1].spiral!.inM).toBeCloseTo(20, 1)
    expect(a.checks.planOffsetM).toBeLessThan(0.001)
    // TS, SC, CS and ST are plan stations, the ST marked.
    expect(stationEvents(a).ec).toHaveLength(2)
    expect(a.stations.filter((s) => s.type & 2)).toHaveLength(2 + 2 + 4)
    const [back] = roadEngProject([{ name: 'Spur 7.dsnx', bytes: out.bytes }], {
      ...options,
      verticalReference: '',
      noCrs: 'ask',
      epsg: grid.epsg,
    }).roads
    expect(back.alignment.points[2].spiralM).toBeCloseTo(20, 2)
    back.alignment.points.forEach((p, k) =>
      expect(distance(p.coordinate, road.points[k].coordinate)).toBeLessThan(0.001),
    )
  })

  it('writes ground levels for a road without a profile, and every road of several', () => {
    const level: Alignment = { ...road, id: 'g', name: 'Ground only', vertical: [] }
    const out = roadEngDesign(
      [
        { alignment: road, analysis },
        { alignment: level, analysis: analyzeRoad(level, flat, DEFAULT_ROAD_SETTINGS) },
      ],
      grid.toGrid,
      { terrainName: 'Valley.terx' },
    )
    expect(out.notes).toContain('Ground only has no design profile: its stations carry ground levels.')
    const read = parseRoadEngDesign(out.bytes)
    expect(read.terrain).toBe('Valley.terx')
    expect(read.alignments.map((a) => [a.part, a.name, a.profile.length])).toEqual([
      ['Location1', 'Spur 7', 4],
      ['Location2', 'Ground only', 0],
    ])
    expect(read.alignments[1].stations.every((s) => s.z === 800)).toBe(true)
    expect(() => roadEngDesign([], grid.toGrid)).toThrow(/at least one road/)
  })
})

describe('RoadEng design export: records as RoadEng writes them', () => {
  const analysis = analyzeRoad(road, flat, DEFAULT_ROAD_SETTINGS)
  const crowned: Alignment = { ...road, template: { ...road.template, crossfallPercent: 3 } }
  const curves = {
    b: {
      designSpeedMs: 60 / 3.6,
      emax: 0.08,
      e: 0.06,
      runoffIn: 30,
      runoffOut: 40,
      transitionFraction: 0.667,
      widening: 0.5,
    },
    c: { designSpeedMs: 50 / 3.6, e: 0.05, runoffIn: 25, runoffOut: 25, widening: { insideM: 0.6, outsideM: 0.2 } },
  }
  const written = roadEngDesign(
    [
      {
        alignment: crowned,
        analysis,
        curves,
        reportEvents: [
          { chainageM: 100, kind: 'template-range' },
          { chainageM: 100, kind: 'ground-layer-range' },
          { chainageM: 250, kind: 'template-range' },
          { chainageM: 200, kind: 'pit' },
        ],
      },
    ],
    grid.toGrid,
  )
  const lines = written.parts['Location1.ds2'].split('\r\n')
  const [a] = parseRoadEngDesign(written.bytes).alignments

  it('writes the records in RoadEng’s order, the ends as RoadEng 11 does', () => {
    const order = lines.map((l) => l.split(',', 1)[0]).filter((t, k, all) => t && t !== all[k - 1])
    expect(order).toEqual(['100', '110', '108', '109', '104', '118'])
    const rows = lines.filter((l) => l.startsWith('110,')).map((l) => l.split(','))
    // Start: a plan point, then the report station with the profile's start (bits 256, 1024, 4096, 65536).
    expect(rows.slice(0, 2).map((f) => [f[1], f[5], f[11]])).toEqual([
      ['2', '0', '0'],
      ['5', '0', '70912'],
    ])
    expect(rows.slice(-2).map((f) => [f[1], f[11]])).toEqual([
      ['5', '69888'],
      ['2', '0'],
    ])
    // Every 10 m a report station (256, with 4096 every 50 m), on cost points (65536).
    expect(rows.find((f) => f[5] === '50')![11]).toBe('69888')
    expect(rows.find((f) => f[5] === '40')![11]).toBe('65792')
  })

  it('marks curve ends and vertical curve ends', () => {
    const events = stationEvents(a)
    expect(events.ec).toHaveLength(2)
    expect(events.bc).toHaveLength(2)
    expect(events.evc).toHaveLength(2)
    expect(events.bvc).toHaveLength(2)
    // Each VIP's curve: BVC and EVC half its length either side.
    const vip = a.profile[1]
    expect(events.bvc[0]).toBeCloseTo(vip.station - vip.curveLength / 2, 6)
    expect(events.evc[0]).toBeCloseTo(vip.station + vip.curveLength / 2, 6)
  })

  it('writes each curve’s design into its 108 record and reads it back', () => {
    const [b, c] = a.pis
    expect(b.curve).toMatchObject({ emax: 0.08, e: 0.06, runoffIn: 30, runoffOut: 40, transitionFraction: 0.667 })
    expect(b.curve!.designSpeedMs).toBeCloseTo(60 / 3.6, 5)
    expect(b.curve!.widening).toEqual({ insideM: 0.5, outsideM: 0.5 })
    // Side friction demanded: v²/(gR) − e.
    expect(b.curve!.sideFriction).toBeCloseTo((60 / 3.6) ** 2 / (9.81 * b.radiusM) - 0.06, 5)
    // Values not given keep RoadEng's defaults.
    expect(c.curve).toMatchObject({ emax: 0.06, flags: 5590, fLimit: 0.1, transitionFraction: 0.667 })
    expect(c.curve!.widening).toEqual({ insideM: 0.6, outsideM: 0.2 })
  })

  it('flags superelevation transitions: runout start, level, reverse crown and full super', () => {
    const events = stationEvents(a)
    expect(events.superelevation).toHaveLength(16)
    // The first curve's BC side: level 0.667 × 30 m before the BC, full super 0.333 × 30 m after,
    // a tangent runout of 30 × 0.03 / 0.06 = 15 m before the level point and the reverse crown 15 m after.
    const bc = events.bc[0]
    const level = bc - 0.667 * 30
    for (const s of [level - 15, level, level + 15, bc + 0.333 * 30])
      expect(events.superelevation.some((v) => Math.abs(v - s) < 1e-5)).toBe(true)
  })

  it('flags template-range, ground-layer and pit boundaries a tenth either side', () => {
    const ratio = alignmentLength(road) / (a.endStation - a.startStation)
    const events = stationEvents(a)
    expect(events.templateRanges.map((v) => v * ratio)).toEqual([expect.closeTo(100, 6), expect.closeTo(250, 6)])
    expect(events.groundLayerRanges.map((v) => v * ratio)).toEqual([expect.closeTo(100, 6)])
    expect(events.pits.map((v) => v * ratio)).toEqual([expect.closeTo(200, 6)])
    const pair = a.stations.filter((s) => s.report & 2)
    expect(pair.map((s) => s.report)).toEqual([18, 18, 2, 2])
    expect(pair[1].station - pair[0].station).toBeCloseTo(0.2, 9)
  })

  it('writes a bend without a curve as a plan station, not a 108 record, and reads it back exactly', () => {
    const sharp: Alignment = { ...road, points: road.points.map((p, k) => (k === 1 ? { ...p, radiusM: 0 } : p)) }
    const out = roadEngDesign(
      [{ alignment: sharp, analysis: analyzeRoad(sharp, flat, DEFAULT_ROAD_SETTINGS) }],
      grid.toGrid,
    )
    expect(out.parts['Location1.ds2'].match(/^108,/gm)).toHaveLength(1)
    const [back] = parseRoadEngDesign(out.bytes).alignments
    expect(back.planFrom).toBe('pis-and-plan-stations')
    expect(back.checks.planOffsetM).toBeLessThan(0.001)
    expect(back.pis.map((p) => [p.radiusM > 0, p.from])).toEqual([
      [false, 'plan-station'],
      [true, '108'],
    ])
  })
})

describe('RoadEng INI merge', () => {
  const text = '[A]\r\nx=1\r\ny=2\r\n\r\n[B]\r\nName=Pont à 30°\r\nz=3\r\n[a]\r\nw=4\r\n'
  it('changes only the keys named, keeping order, line endings and Latin-1 text', () => {
    expect(mergeRoadEngIni(text, {})).toBe(text)
    expect(mergeRoadEngIni(text, { b: { Z: '9' } })).toBe(text.replace('z=3', 'z=9'))
    // A removed key, a key added to the section's last occurrence, a new section at the end.
    expect(mergeRoadEngIni(text, { A: { y: null, v: '5' }, C: { k: 'a\r\nb' } })).toBe(
      '[A]\r\nx=1\r\n\r\n[B]\r\nName=Pont à 30°\r\nz=3\r\n[a]\r\nw=4\r\nv=5\r\n[C]\r\nk=a b\r\n',
    )
    // A new key goes before the blank lines that end a section.
    expect(mergeRoadEngIni('[A]\nx=1\n\n[B]\n', { A: { y: '2' } })).toBe('[A]\nx=1\ny=2\n\n[B]\n')
    expect(mergeRoadEngIni('', { S: { k: 'v' } })).toBe('[S]\r\nk=v\r\n')
    expect(() => mergeRoadEngIni(text, { A: { 'a=b': '1' } })).toThrow(/cannot be an INI key/)
    expect([...latin1Bytes('à°€')]).toEqual([0xe0, 0xb0, 0x3f])
  })
})

/**
 * A design laid out as RoadEng writes one, with parts this workspace does not model: built from this
 * writer's own records, its stations moved to start at 902.5, a second ground type, an unknown
 * record, a `.ds3`, and a `.dsn` with settings of its own.
 */
function roadEngLike(): { bytes: Uint8Array; dsn: string; ds3: Uint8Array; kept: string[] } {
  const analysis = analyzeRoad(road, flat, DEFAULT_ROAD_SETTINGS)
  const base = roadEngDesign([{ alignment: road, analysis }], grid.toGrid).parts['Location1.ds2'].split('\r\n')
  const shifted = base.map((line) => {
    const f = line.split(',')
    if (f[0] === '110') f[5] = String(Number(f[5]) + 902.5)
    if (f[0] === '109') f[4] = String(Number(f[4]) + 902.5)
    return f.join(',')
  })
  const sr = '104,SR,Solid Rock,100,400.000013884,1,0.8,48,4,0,8,0.6,4,2.6,2,3,0,0,0,'
  const ds2 = [...shifted.slice(0, -2), sr, '118,1', '777,an unknown record', ''].join('\r\n')
  const kept = [shifted[0], shifted[shifted.length - 3], sr, '118,1', '777,an unknown record']
  const dsn = [
    '[AreasExport]',
    'Opt=1,2,3',
    '[design]',
    'InitialIndex=12',
    'nAlignments=1,0',
    'surface=Valley.terx',
    'units=10000',
    'Version=11',
    'Version2=11.0.673.0',
    '[HAlignOptions]',
    'Option, 1=H-align1',
    'Option, 2=1',
    '[LocationParms]',
    '0=1100,0,0,0,0,0,0,0,0,0,-,*1,999999,-,999999,-,OB,PGR,PGR,RE,RE',
    'nparams=1',
    '[ReportPointProperties]',
    'Item09=256,0,0,,20,255,255,1',
    'Item13=4096,0,0,,100,255,255,1',
    '[Notes]',
    'Text=Pont à 30°',
    '[Software]',
    'Version=11.000',
    'Version2=11.0.673.0',
    '',
  ].join('\r\n')
  const ds3 = new Uint8Array(Array.from({ length: 5000 }, (_, k) => (k * 89 + 7) & 255))
  return {
    bytes: zipSync({
      'Location1.dsn': strToU8(dsn, true),
      'Location1.ds2': strToU8(ds2, true),
      'Location1.ds1': new Uint8Array([12, 0, 1, 0, 9, 9, 9, 9]),
      'Location1.ds3': ds3,
    }),
    dsn,
    ds3,
    kept,
  }
}

describe('RoadEng design export: writing back what was read', () => {
  const original = roadEngLike()
  const { roads } = roadEngRoads(original.bytes, { ...options, epsg: grid.epsg })
  const [read] = roads
  const source = read.source.source!
  const write = (extra: Partial<Parameters<typeof roadEngDesign>[0][number]> = {}, terrainName?: string) =>
    roadEngDesign(
      [{ alignment: read.alignment, source, curves: roadEngCurvesByPoint(read), ...extra }],
      grid.toGrid,
      terrainName ? { terrainName } : {},
    )

  it('gives back every .dsn key and every kept record unchanged, the .ds1 and .ds3 byte for byte', () => {
    const out = write()
    const files = unzipSync(out.bytes)
    const dsn = strFromU8(files['Location1.dsn'], true)
    // The original, then this workspace's own section.
    expect(dsn.startsWith(original.dsn)).toBe(true)
    expect(dsn.slice(original.dsn.length)).toMatch(
      /^\[PGMaps\]\r\nSurfacingM=[\d.]+\r\nTemplate=\{.*\}\r\nNative=[0-9a-z]+-[0-9a-f]{8}\r\n$/,
    )
    expect(files['Location1.ds1']).toEqual(new Uint8Array([12, 0, 1, 0, 9, 9, 9, 9]))
    expect(files['Location1.ds3']).toEqual(original.ds3)
    const ds2 = strFromU8(files['Location1.ds2'], true).split('\r\n')
    expect(ds2.filter((l) => l && !/^1(08|09|10),/.test(l))).toEqual(original.kept)
    expect(ds2[0]).toBe(original.kept[0])
  })

  it("keeps a VIP's stated curve length that its radius and grades put a few centimetres off", () => {
    // Road6 - 16 (Softree's V10 tutorials) states 412 ft at a VIP whose radius gives 412.05 ft; the
    // import reads the radius, and the unedited curve goes back with the record's own text.
    const parts = unzipSync(original.bytes)
    const lines = strFromU8(parts['Location1.ds2'], true).split('\r\n')
    const lengths = read.alignment.vertical.map((v) => v.curveLength).filter((l) => l > 0)
    let k = 0
    const stated = lines.map((line) => {
      const f = line.split(',')
      if (f[0] !== '109' || Number(f[3]) === 0) return line
      f[11] = (lengths[k++] + 0.03).toFixed(3)
      return f.join(',')
    })
    expect(k).toBeGreaterThan(0)
    const bytes = zipSync({ ...parts, 'Location1.ds2': strToU8(stated.join('\r\n'), true) })
    const [read2] = roadEngRoads(bytes, { ...options, epsg: grid.epsg }).roads
    // This design holds no template: written over a bare subgrade, its levels go back as read.
    const again = {
      ...read2,
      alignment: { ...read2.alignment, template: { ...read2.alignment.template, surfaceDepth: 0 } },
    }
    const kept = (text: string) => text.split('\r\n').filter((l) => l.startsWith('109,'))
    const written = roadEngDesign(
      [{ alignment: again.alignment, source: again.source.source!, curves: roadEngCurvesByPoint(again) }],
      grid.toGrid,
    ).parts['Location1.ds2']
    // Field 11 as stated wherever the VIP goes back where it was read (its station and level).
    const at = (l: string) => l.split(',').slice(4, 6).join()
    const field11 = (l: string) => l.split(',')[11]
    const before = kept(stated.join('\r\n'))
    const unmoved = kept(written).filter((l) => before.some((b) => at(b) === at(l)))
    expect(unmoved.length).toBeGreaterThan(0)
    for (const l of unmoved) expect(field11(l)).toBe(field11(before.find((b) => at(b) === at(l))!))
    // A curve made longer takes its new length there.
    const longer = {
      ...again.alignment,
      vertical: again.alignment.vertical.map((v) => (v.curveLength > 0 ? { ...v, curveLength: v.curveLength + 5 } : v)),
    }
    const edited = kept(
      roadEngDesign(
        [{ alignment: longer, source: again.source.source!, curves: roadEngCurvesByPoint(again) }],
        grid.toGrid,
      ).parts['Location1.ds2'],
    )
    for (const l of edited.filter((x) => unmoved.some((u) => at(u) === at(x))))
      expect(field11(l)).not.toBe(field11(before.find((b) => at(b) === at(l))!))
  })

  it('keeps the design’s stationing and report intervals, so its ranges still apply', () => {
    const [back] = parseRoadEngDesign(write().bytes).alignments
    expect(back.startStation).toBeCloseTo(902.5, 6)
    expect(back.endStation).toBeCloseTo(read.source.endStation, 3)
    expect(back.checks.planOffsetM).toBeLessThan(0.001)
    expect(back.checks.profileDifferenceM!).toBeLessThan(0.001)
    // Item09 every 20, Item13 every 100, on the design's own station numbers.
    const at = (station: number) => back.stations.find((s) => Math.abs(s.station - station) < 1e-6)
    expect(at(920)!.report & 256).toBe(256)
    expect(at(1000)!.report & 4096).toBe(4096)
    expect(at(910)).toBeUndefined()
    // The curve design read goes back with its curve.
    back.pis.forEach((p, k) => expect(p.curve).toEqual(read.source.pis[k].curve))
  })

  it('replaces only the keys it owns, then the caller’s, and the record types the caller gives', () => {
    const renamed = { ...read.alignment, name: 'Main line' }
    const out = write(
      {
        alignment: renamed,
        dsnOverrides: { design: { InitialIndex: null }, Notes: { Extra: 'yes' } },
        recordOverrides: { '104': ['104,GR,Gravel,100,100,1,0.9,12,4,0,8,0.6,4,2.6,2,2,0,0,0,'] },
      },
      'New.terx',
    )
    const dsn = out.parts['Location1.dsn']
    expect(dsn).toContain('\r\nsurface=New.terx\r\n')
    expect(dsn).toContain('\r\nOption, 1=Main line\r\n')
    expect(dsn).not.toContain('InitialIndex')
    expect(dsn).toContain('Text=Pont à 30°\r\nExtra=yes\r\n[Software]')
    const ds2 = out.parts['Location1.ds2'].split('\r\n').filter((l) => l && !/^1(08|09|10),/.test(l))
    expect(ds2).toEqual([
      original.kept[0],
      '104,GR,Gravel,100,100,1,0.9,12,4,0,8,0.6,4,2.6,2,2,0,0,0,',
      '118,1',
      '777,an unknown record',
    ])
    expect(() => write({ recordOverrides: { '110': [] } })).toThrow(/written from the road/)
  })

  it('writes in the design’s own units', () => {
    const feet: RoadEngSource = { ...source, dsn: '[design]\r\nunits=3048\r\n', unitCode: '3048', startStation: 0 }
    const out = roadEngDesign([{ alignment: read.alignment, source: feet }], grid.toGrid)
    const back = parseRoadEngDesign(out.bytes)
    expect(back.unitM).toBe(0.3048)
    expect(back.alignments[0].checks.planOffsetM).toBeLessThan(0.001)
    expect(back.alignments[0].endStation).toBeCloseTo(read.source.endStation - read.source.startStation, 3)
    expect(base64ToBytes(feet.ds3!)).toEqual(unzipSync(out.bytes)['Location1.ds3'])
  })
})

// Softree's published samples, read from a local copy and never committed (see roadEngImport.test.ts).
const samples = process.env.ROADENG_SAMPLES
describe.skipIf(!samples || !existsSync(samples ?? ''))('Softree sample designs written back', () => {
  it('writes a 27.8 km RoadEng 11 design back with its PIs, radii and profile', () => {
    const bytes = new Uint8Array(readFileSync(join(samples!, 'LongRoad_1/LongRoad 1.dsnx')))
    const original = parseRoadEngDesign(bytes).alignments[0]
    const { roads } = roadEngRoads(bytes, { ...options, fileName: 'LongRoad 1.dsnx', epsg: 26915 })
    // Written in the grid it was read in.
    const projection = proj4('EPSG:4326', projectedCrsDefinition(26915)!)
    const toGrid = (c: Coordinate) => projection.forward([...c]) as [number, number]
    const [back] = parseRoadEngDesign(roadEngDesign([{ alignment: roads[0].alignment }], toGrid).bytes).alignments
    expect(back.pis).toHaveLength(original.pis.length)
    back.pis.forEach((p, k) => {
      expect(Math.hypot(p.xy[0] - original.pis[k].xy[0], p.xy[1] - original.pis[k].xy[1])).toBeLessThan(0.01)
      expect(Math.abs(p.radiusM - original.pis[k].radiusM)).toBeLessThan(0.01)
    })
    expect(back.endStation).toBeCloseTo(original.endStation, 1)
    expect(back.checks.profileDifferenceM!).toBeLessThan(0.001)
    expect(back.followsStations).toEqual({ plan: false, profile: false })
  })
  it('writes LongRoad back with its .dsn, kept records, ranges, pits and curve design', () => {
    const bytes = new Uint8Array(readFileSync(join(samples!, 'LongRoad_1/LongRoad 1.dsnx')))
    const files = unzipSync(bytes)
    const { roads } = roadEngRoads(bytes, { ...options, fileName: 'LongRoad 1.dsnx', epsg: 26915 })
    const [road] = roads
    const projection = proj4('EPSG:4326', projectedCrsDefinition(26915)!)
    const toGrid = (c: Coordinate) => projection.forward([...c]) as [number, number]
    const read = stationEvents(road.source)
    const chainage = (station: number) => (station - road.source.startStation) * road.stationScale
    const out = roadEngDesign(
      [
        {
          // LongRoad's template has a 4 % crown.
          alignment: { ...road.alignment, template: { ...road.alignment.template, crossfallPercent: 4 } },
          source: road.source.source,
          curves: roadEngCurvesByPoint(road),
          reportEvents: [
            ...read.templateRanges.map((s) => ({ chainageM: chainage(s), kind: 'template-range' as const })),
            ...read.groundLayerRanges.map((s) => ({ chainageM: chainage(s), kind: 'ground-layer-range' as const })),
            ...read.pits.map((s) => ({ chainageM: chainage(s), kind: 'pit' as const })),
          ],
        },
      ],
      toGrid,
    )
    const written = unzipSync(out.bytes)
    expectKept(files, written, 'Location1')
    const [back] = parseRoadEngDesign(out.bytes).alignments
    expect(back.checks.planOffsetM).toBeLessThan(0.001)
    const events = stationEvents(back)
    expect([events.bc.length, events.ec.length, events.bvc.length, events.evc.length]).toEqual([73, 73, 234, 234])
    const near = (a: number[], b: number[], tolerance: number) => {
      expect(a).toHaveLength(b.length)
      a.forEach((v, k) => expect(Math.abs(v - b[k])).toBeLessThan(tolerance))
    }
    near(events.templateRanges, read.templateRanges, 0.01)
    near(events.groundLayerRanges, read.groundLayerRanges, 0.01)
    near(events.pits, read.pits, 0.01)
    near(events.ec, read.ec, 0.01)
    near(events.superelevation, read.superelevation, 0.01)
    back.pis.forEach((p, k) => {
      const { designSpeedMs, flags, emax, fLimit, runoffIn, runoffOut, transitionFraction, e, widening } =
        road.source.pis[k].curve!
      expect(p.curve).toMatchObject({ flags, emax, fLimit, runoffIn, runoffOut, transitionFraction, e, widening })
      expect(p.curve!.designSpeedMs).toBeCloseTo(designSpeedMs!, 5)
    })
  })

  it('writes the cul-de-sac’s two alignments back with their .dsn and kept records', () => {
    const bytes = new Uint8Array(
      readFileSync(join(samples!, 'Cul-de-sac-design/CulDeSacExample/CulDeSacExampleComplete.dsnx')),
    )
    const files = unzipSync(bytes)
    const { roads } = roadEngRoads(bytes, { ...options, fileName: 'CulDeSacExampleComplete.dsnx', epsg: 26910 })
    const projection = proj4('EPSG:4326', projectedCrsDefinition(26910)!)
    const toGrid = (c: Coordinate) => projection.forward([...c]) as [number, number]
    const out = roadEngDesign(
      roads.map((road) => ({
        alignment: road.alignment,
        source: road.source.source,
        curves: roadEngCurvesByPoint(road),
      })),
      toGrid,
    )
    const written = unzipSync(out.bytes)
    for (const part of ['Location1', 'Location2']) expectKept(files, written, part)
    const back = parseRoadEngDesign(out.bytes).alignments
    expect(back.map((a) => a.planFrom)).toEqual(['pis-and-plan-stations', 'pis'])
    back.forEach((a, k) => {
      expect(a.checks.planOffsetM).toBeLessThan(0.001)
      expect(a.startStation).toBeCloseTo(roads[k].source.startStation, 3)
    })
  })
})

/** Every .dsn key and kept .ds2 record of a part comes back, and its .ds1 and .ds3 byte for byte. */
function expectKept(files: Record<string, Uint8Array>, written: Record<string, Uint8Array>, part: string) {
  const dsn = strFromU8(files[`${part}.dsn`], true)
  const back = strFromU8(written[`${part}.dsn`], true)
  expect(back.startsWith(dsn)).toBe(true)
  expect(back.slice(dsn.length)).toMatch(/^\[PGMaps\]\r\n/)
  const kept = (bytes: Uint8Array) =>
    strFromU8(bytes, true)
      .split(/\r?\n/)
      .filter((l) => l && !/^1(08|09|10),/.test(l))
  expect(kept(written[`${part}.ds2`])).toEqual(kept(files[`${part}.ds2`]))
  expect(written[`${part}.ds1`]).toEqual(files[`${part}.ds1`])
  expect(written[`${part}.ds3`]).toEqual(files[`${part}.ds3`])
}
