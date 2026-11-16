import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { alignmentLength } from './engine'
import { localPlaneProjection } from './localPlane'
import { parseProject } from './project'
import { parseRoadEngSettings, roadEngMaterialsFor } from './roadEngDesignSettings'
import { roadEngDesign } from './roadEngExport'
import { parseRoadEngSource } from './roadEngImport'
import {
  isPLineStratum,
  parseRoadEngPLineSource,
  pLineGroundStations,
  pLineStrataPieces,
  pLineSummary,
  roadEngPLineDsnOverrides,
  roadEngPLineFiles,
  roadEngPLineReference,
  roadEngPStations,
  type RoadEngPLineSource,
} from './roadEngPLine'
import { refreshPLineStrata } from './roadEngPLineStrata'
import { collectRoadEngFiles, roadEngProject } from './roadEngProject'
import { roadEngProjectExport } from './roadEngProjectExport'
import {
  isForesightShot,
  isNativeTraverse,
  isNativeTraverseSettings,
  nativeTraverseToFieldBook,
  parseNativeTraverse,
} from './softreeNativeTraverse'
import { reduceTraverse } from './surveyInterchange'
import { createDemoProject, DEFAULT_TEMPLATE } from './terrain'
import { detectTraverseFile, readTraverseFile, traverseFileDetails } from './traverseFiles'
import type { Alignment } from './types'

// A made-up P-line in RoadEng's own traverse format: four stations due north 100 m apart, the
// third given its own layers, side shots at the first, a culvert at the second.
const station = (
  i: number,
  st: number,
  y: number,
  z: number,
  ground = ',,,,',
  creek = '',
  slopes = '-10,12',
  label = '',
) => `101,${i},${st},0,0,100,100,0,${label},,0,${y},${z},${i ? 0 : 7},${creek},${ground},0,0,${slopes},0`
const TR1 = [
  '100,100,7.001, Made-up traverse data file',
  '116,10000',
  '117,1,9,1',
  station(0, 0, 0, 500, 'OB,0.5,FR,,'),
  '102,0,5.0990195136,-20,0.5,,16,,,5,-10,,,16,,,-1,-30,,,16,,',
  '103,0,10,0,,,16,,,-1,15,,,16,,',
  station(1, 100, 100, 502, ',,,,', '600.000x x10.000x x2x10.000x'),
  station(2, 200, 200, 504, 'HP,1,SR,2,FR', '', '-10,12', 'creek'),
  station(3, 300, 300, 506, '**,,,,'),
  '104,OB,Overburden (Default),66.7,400,1,1',
  '104,HP,Hard Pan,66.7,100,1,0.9',
  '104,SR,Solid Rock,100,400,1,0.8',
  '104,FR,Fractured Rock,100,200,1,0.8',
].join('\r\n')
const TR2 = ['[ControlBars-Bar0]', 'BarID=59393', '[Traverse]', 'Description=Made-up', 'StnEqns='].join('\r\n')

describe('RoadEng traverse (.tr1)', () => {
  it('tells a traverse and its settings file from other files by their content', () => {
    expect(isNativeTraverse(TR1)).toBe(true)
    expect(isNativeTraverse(TR2)).toBe(false)
    expect(isNativeTraverseSettings(TR2)).toBe(true)
    expect(isNativeTraverseSettings('[3dwindow]\r\nX=1')).toBe(false)
    expect(detectTraverseFile(TR1)).toBe('tr1')
  })
  it('reads stations, side shots, ground types, the unit and the projection as written', () => {
    const t = parseNativeTraverse(TR1)
    expect(t.version).toBe('7.001')
    expect(t.unitM).toBe(1)
    expect(t.projection).toEqual(['1', '9', '1'])
    expect(t.stations.map((s) => [s.station, s.y, s.z])).toEqual([
      [0, 0, 500],
      [100, 100, 502],
      [200, 200, 504],
      [300, 300, 506],
    ])
    expect(t.stations[0].ground).toEqual([
      { type: 'OB', depth: 0.5 },
      { type: 'FR', depth: null },
      { type: '', depth: null },
    ])
    expect(t.stations[0].left.map((s) => [s.sd, s.slope, s.depth1])).toEqual([
      [5.0990195136, -20, 0.5],
      [5, -10, null],
      [-1, -30, null],
    ])
    expect(t.stations[1].creek).toMatchObject({ sizeY: 600, sizeX: null, gradientPercent: 10, flag: 2, sd: 10 })
    expect(t.groundTypes.map((g) => g.code)).toEqual(['OB', 'HP', 'SR', 'FR'])
  })
  it('makes a field book from the stations’ own coordinates, its side shots measured each from the one before', () => {
    const book = nativeTraverseToFieldBook(parseNativeTraverse(TR1), { unitM: 0.3048 })
    // The file states metres (116,10000), which wins over the unit given.
    expect(book.fileUnitM).toBe(1)
    expect(book.input.start).toEqual([0, 0, 500])
    expect(book.input.legs.map((l) => [l.bearingDegrees, l.horizontalDistanceM, l.gradePercent])).toEqual([
      [0, 100, 2],
      [0, 100, 2],
      [0, 100, 2],
    ])
    expect(book.equations).toEqual([])
    const left = book.input.sideShots!.filter((s) => s.station === 0 && s.offsetM < 0)
    expect(left[0].offsetM).toBeCloseTo(-5, 6)
    expect(left[0].heightDifferenceM).toBeCloseTo(-1, 6)
    expect(left[1].offsetM).toBeCloseTo(-5 - 5 / Math.sqrt(1.01), 6)
    const first = book.extras.find((e) => e.station === 0)!
    // Past the last shot on the left, and the station's own slope where it has no shot (right side's
    // end marker gives 15).
    expect(first.extensionSlope).toEqual({ left: -30, right: 15 })
    expect(book.extras.find((e) => e.station === 1)!.extensionSlope).toEqual({ left: -10, right: 12 })
    expect(book.extras.find((e) => e.station === 2)!.label).toBe('creek')
    expect(reduceTraverse(book.input).stations[3].raw).toEqual([0, 300, 506])
  })
  it('reads a jump in the station column as a station equation, and rounding as none', () => {
    const jumped = TR1.replace('101,3,300,', '101,3,350,').replace('101,2,200,', '101,2,200.0004,')
    const book = nativeTraverseToFieldBook(parseNativeTraverse(jumped), { unitM: 1 })
    expect(book.equations).toEqual([{ back: 300, ahead: 350 }])
  })
  it('opens in the survey field book, its details kept as an ASCII traverse’s', () => {
    const read = readTraverseFile(TR1, 'tr1', { unitM: 0.3048 })
    const { details } = traverseFileDetails(read, 0.3048)
    expect(details.sourceFormat).toBe('asc')
    expect(details.unitM).toBe(1)
    expect(details.extras.find((e) => e.station === 1)?.culvert?.sizeY).toBe(600)
  })
})

describe('P-line ground', () => {
  const t = parseNativeTraverse(TR1)
  const stations = pLineGroundStations(t, 1, 'OB')
  it('carries a station’s layers to the next without its own; ** and a first without any are OB', () => {
    expect(stations.map((s) => [s.station, s.given, s.layers.map((l) => `${l.code}${l.bottomDepthM ?? ''}`)])).toEqual([
      [0, true, ['OB0.5', 'FR']],
      [100, false, ['OB0.5', 'FR']],
      [200, true, ['HP1', 'SR2', 'FR']],
      [300, true, ['OB']],
    ])
    const blank = parseNativeTraverse(TR1.replace(station(0, 0, 0, 500, 'OB,0.5,FR,,'), station(0, 0, 0, 500)))
    expect(pLineGroundStations(blank, 1, 'OB')[0].layers).toEqual([{ code: 'OB', topDepthM: 0, bottomDepthM: null }])
  })
  it('places each station Between (nearest cross sections) or Ahead (to the next), along the road', () => {
    const pairs: Array<[number, number]> = [
      [1000, 0],
      [1300, 300],
    ]
    const frame = { startStation: 1000 }
    const between = pLineStrataPieces({ stations, pairs, apply: 'between' }, { start: 0, end: 300 }, frame)
    expect(between.map((p) => [p.start, p.end, p.layers[0].code])).toEqual([
      [0, 150, 'OB'],
      [150, 250, 'HP'],
      [250, 300, 'OB'],
    ])
    expect(between[0].layers).toHaveLength(2)
    const ahead = pLineStrataPieces({ stations, pairs, apply: 'ahead' }, { start: 0, end: 300 }, frame)
    expect(ahead.map((p) => [p.start, p.end, p.layers[0].code])).toEqual([
      [0, 200, 'OB'],
      [200, 300, 'HP'],
    ])
    // The P-line runs 20 m ahead of the road's stations, and the stretch is clipped.
    const shifted = pLineStrataPieces(
      { stations, pairs: pairs.map(([l, p]) => [l, p + 20]), apply: 'ahead' },
      { start: 50, end: 250 },
      frame,
    )
    expect(shifted.map((p) => [p.start, p.end])).toEqual([
      [50, 180],
      [180, 250],
    ])
  })
  it('takes design-to-P-line stations from the calculated stations, else by projection, thinned where linear', () => {
    const ds2 = (p: (l: number) => number) =>
      [0, 50, 100, 150, 200].map((l) => `110,4,3,${l},500,${l},${p(l)},0,0,,,0`).join('\r\n')
    expect(
      roadEngPStations(
        ds2((l) => l + 10),
        1,
        null,
      ),
    ).toEqual({
      pairs: [
        [0, 10],
        [200, 210],
      ],
      from: 'design',
    })
    // No P-line stations in the design (-1): each design station is projected onto the P-line.
    const projected = roadEngPStations(
      ds2(() => -1),
      1,
      { traverse: t, unitM: 1 },
    )
    expect(projected.from).toBe('projection')
    expect(projected.pairs).toEqual([
      [0, 0],
      [200, 200],
    ])
    expect(
      roadEngPStations(
        ds2(() => -1),
        1,
        null,
      ),
    ).toEqual({ pairs: [], from: null })
  })
})

// RoadEng settings with a `**` range over most of the road and a named range after it.
const range = (end: number, top: string, depth = '999999', below = '-') =>
  `${end},0,0,0,0,0,0,0,0,0,-,*1,${depth},${below},999999,-,${top},RUR,RUR,RE,RE,0,0,-1,-1,0,0,0,0,RE,RE,9999,999999000,1`
const DSN = (pLine: string | null, gnd = '0') =>
  [
    '[design]',
    ...(pLine ? [`GndRange=${gnd}`, `roadname=${pLine}`] : []),
    'units=10000',
    '[LocationParms]',
    `0=${range(250, '**')}`,
    `1=${range(999999999, 'SR')}`,
    'nparams=2',
  ].join('\r\n')
const DS2 = [
  '100,103,9.099,9.0.469.0, Softree Technical Systems Inc. - Location Line data file',
  '104,OB,Overburden (Default),10,400,1,1,12,4,0,8,0.6,4,2.6,2,0,0,0,',
  '104,HP,Hard Pan,66.67,100,1,0.9,12,4,0,8,0.6,4,2.6,2,1,0,0,',
  '104,SR,Solid Rock,100,400,1,0.8,48,4,0,8,0.6,4,2.6,2,3,0,0,',
  '104,FR,Fractured Rock,100,200,1,0.8,24,4,0,8,0.6,4,2.6,2,3,0,0,',
  '110,7,0,0,500,0,0,0,0,,,0',
  '110,6,0,300,506,300,300,0,0,,,0',
].join('\r\n')

describe('** with and without a P-line', () => {
  const frame = { startStation: 0, endStation: 300 }
  const ground = {
    stations: pLineGroundStations(parseNativeTraverse(TR1), 1, 'OB'),
    pairs: roadEngPStations(DS2, 1, null).pairs,
  }
  it('reads the P-line a design names, and Between or Ahead from GndRange', () => {
    expect(roadEngPLineReference(DSN('Line.tr1'))).toEqual({ name: 'Line.tr1', apply: 'between', gndRange: '0' })
    expect(roadEngPLineReference(DSN('C:\\jobs\\Line.tr1', '1'))?.apply).toBe('ahead')
    expect(roadEngPLineReference(DSN(null))).toBeNull()
  })
  it('takes the survey’s layers where a range gives **, and keeps a named range’s', () => {
    const s = parseRoadEngSettings(DSN('Line.tr1'), DS2, 1)
    const m = roadEngMaterialsFor(s, { ...frame, pLine: { name: 'Line.tr1', ground: { ...ground, apply: 'between' } } })
    const pl = m.strata.filter(isPLineStratum)
    expect(pl.map((x) => [x.start, x.end, x.materialId, x.topDepthM, x.bottomDepthM])).toEqual([
      [0, 150, 'roadeng-OB', 0, 0.5],
      [0, 150, 'roadeng-FR', 0.5, null],
      [150, 250, 'roadeng-HP', 0, 1],
      [150, 250, 'roadeng-SR', 1, 2],
      [150, 250, 'roadeng-FR', 2, null],
    ])
    expect(m.strata.filter((x) => !isPLineStratum(x)).map((x) => [x.start, x.end, x.materialId])).toEqual([
      [250, 300, 'roadeng-SR'],
    ])
    expect(m.notes.join(' ')).toMatch(/takes the ground layers of its P-line Line.tr1 \(4 surveyed stations\)/)
  })
  it('leaves ** unclassified when the named P-line was not given: never OB', () => {
    const s = parseRoadEngSettings(DSN('Line.tr1'), DS2, 1)
    const m = roadEngMaterialsFor(s, { ...frame, pLine: { name: 'Line.tr1', ground: null } })
    expect(m.strata.map((x) => x.materialId)).toEqual(['roadeng-SR'])
    expect(m.unmapped.join(' ')).toMatch(/from the design's P-line Line.tr1; it was not opened with the design/)
  })
  it('reads ** as OB in a design that names no P-line', () => {
    const m = roadEngMaterialsFor(parseRoadEngSettings(DSN(null), DS2, 1), frame)
    expect(m.strata.map((x) => [x.start, x.end, x.materialId])).toEqual([
      [0, 250, 'roadeng-OB'],
      [250, 300, 'roadeng-SR'],
    ])
    expect(m.strata.some(isPLineStratum)).toBe(false)
  })
})

describe('the kept P-line', () => {
  const source: RoadEngPLineSource = {
    name: 'Line.tr1',
    tr1: TR1,
    tr2: { name: 'Line.tr2', text: TR2 },
    stations: [
      [0, 0],
      [300, 300],
    ],
  }
  it('is checked for shape when a project is read', () => {
    expect(parseRoadEngPLineSource(source)).toEqual(source)
    expect(parseRoadEngPLineSource({ ...source, apply: 'ahead' })?.apply).toBe('ahead')
    expect(parseRoadEngPLineSource({ ...source, tr1: 'not a traverse' })).toBeNull()
    expect(parseRoadEngPLineSource({ ...source, apply: 'sideways' })).toBeNull()
    expect(parseRoadEngPLineSource({ ...source, tr1: null, tr2: null })?.tr1).toBeNull()
  })
  it('goes back as read, writing GndRange only when the choice was changed', () => {
    const files = roadEngPLineFiles(source)
    expect(strFromU8(files['Line.tr1'], true)).toBe(TR1)
    expect(strFromU8(files['Line.tr2'], true)).toBe(TR2)
    expect(roadEngPLineDsnOverrides(source, DSN('Line.tr1'))).toEqual({})
    expect(roadEngPLineDsnOverrides({ ...source, apply: 'between' }, DSN('Line.tr1'))).toEqual({})
    expect(roadEngPLineDsnOverrides({ ...source, apply: 'ahead' }, DSN('Line.tr1'))).toEqual({
      design: { GndRange: '1' },
    })
    expect(roadEngPLineFiles({ ...source, tr1: null })).toEqual({})
  })
  it('summarizes its stations and layers for the panel', () => {
    expect(pLineSummary(TR1, 0.3048)).toEqual({
      stations: 4,
      firstM: 0,
      lastM: 300,
      fileUnitM: 1,
      layers: [
        { text: 'OB 0.5 FR', count: 1 },
        { text: '', count: 1 },
        { text: 'HP 1 SR 2 FR', count: 1 },
        { text: '**', count: 1 },
      ],
    })
  })
})

// A whole design through the project import: written by this workspace, then given a P-line and a
// `**` range as RoadEng would hold them.
const plane = localPlaneProjection([0, 0])
const road: Alignment = {
  id: 'r',
  name: 'Line',
  color: '#000000',
  points: [
    { id: 'a', coordinate: plane.toLonLat([0, 0]), radiusM: 0 },
    { id: 'b', coordinate: plane.toLonLat([0, 300]), radiusM: 0 },
  ],
  vertical: [],
  template: { ...DEFAULT_TEMPLATE },
  overrides: [],
}
road.vertical = [
  { id: 'v0', chainage: 0, elevation: 500, curveLength: 0 },
  { id: 'v1', chainage: alignmentLength(road), elevation: 506, curveLength: 0 },
]
function designWithPLine(gnd = '0'): Uint8Array {
  const written = unzipSync(roadEngDesign([{ alignment: road }], plane.toFile, { terrainName: '' }).bytes)
  let dsn = strFromU8(written['Location1.dsn'], true)
  dsn = dsn.replace('[design]\r\n', `[design]\r\nGndRange=${gnd}\r\nroadname=Line.tr1\r\n`)
  dsn = dsn.replace(/\[LocationParms\][\s\S]*?nparams=\d+\r\n/, '')
  dsn += `\r\n[LocationParms]\r\n0=${range(999999999, '**')}\r\nnparams=1\r\n`
  const ds2 = strFromU8(written['Location1.ds2'], true)
    .replace(/^104,[^\r\n]*\r\n/gm, '')
    .replace(
      /^(100,[^\r\n]*\r\n)/,
      `$1${DS2.split('\r\n')
        .filter((l) => l.startsWith('104'))
        .join('\r\n')}\r\n`,
    )
  return zipSync({ ...written, 'Location1.dsn': strToU8(dsn, true), 'Location1.ds2': strToU8(ds2, true) })
}
let n = 0
const options = {
  newId: () => `id${n++}`,
  color: () => '#123456',
  template: { ...DEFAULT_TEMPLATE },
  verticalReference: 'x',
}
const tr1File = { name: 'Line.tr1', bytes: strToU8(TR1, true) }
const tr2File = { name: 'Line.tr2', bytes: strToU8(TR2, true) }

describe('a design opened with its P-line', () => {
  it('sorts the traverse and its settings file, unzipped or zipped, apart from window layouts', () => {
    const sorted = collectRoadEngFiles([{ name: 'L.dsnx', bytes: designWithPLine() }, tr1File, tr2File])
    expect(sorted.surveys.map((f) => f.name)).toEqual(['Line.tr1', 'Line.tr2'])
    expect(sorted.layouts).toEqual([])
    const zipped = zipSync({ 'L.dsnx': designWithPLine(), 'Line.tr1': tr1File.bytes, 'Line.tr2': tr2File.bytes })
    expect(collectRoadEngFiles([{ name: 'job.zip', bytes: zipped }]).surveys).toHaveLength(2)
  })
  it('takes the survey’s layers along the road, keeps the files and writes them back as read', () => {
    const opened = roadEngProject([{ name: 'L.dsnx', bytes: designWithPLine() }, tr1File, tr2File], options)
    const a = opened.roads[0].alignment
    expect(opened.notes.join(' ')).toMatch(/its P-line Line.tr1 was read: 4 surveyed stations, 3 giving ground layers/)
    const pl = a.engineering!.strata.filter(isPLineStratum)
    expect(pl.map((x) => [Math.round(x.start), Math.round(x.end), x.materialId])).toEqual([
      [0, 150, 'roadeng-OB'],
      [0, 150, 'roadeng-FR'],
      [150, 250, 'roadeng-HP'],
      [150, 250, 'roadeng-SR'],
      [150, 250, 'roadeng-FR'],
      [250, 300, 'roadeng-OB'],
    ])
    expect(a.roadEngSource?.pLine?.tr1).toBe(TR1)
    expect(parseRoadEngSource(a.roadEngSource)?.pLine?.tr2?.name).toBe('Line.tr2')
    const project = parseProject({ ...createDemoProject(), alignments: [a], activeAlignmentId: a.id })
    expect(project.alignments[0].roadEngSource?.pLine?.tr1).toBe(TR1)
    const out = roadEngProjectExport({
      name: 'L',
      roads: [{ alignment: project.alignments[0] }],
      grid: { toGrid: plane.toFile, epsg: null, raster: null },
      context: [],
      cables: [],
      reference: [],
    })
    const zip = unzipSync(out.bytes)
    expect(strFromU8(zip['Line.tr1'], true)).toBe(TR1)
    expect(strFromU8(zip['Line.tr2'], true)).toBe(TR2)
    const dsn = strFromU8(unzipSync(zip['L.dsnx'])['Location1.dsn'], true)
    expect(dsn).toMatch(/GndRange=0\r\n/)
    // Opened again from the export, the P-line comes with it.
    const again = roadEngProject([{ name: 'L.zip', bytes: out.bytes }], options)
    expect(again.roads[0].alignment.engineering!.strata.filter(isPLineStratum)).toHaveLength(6)
  })
  it('without its P-line, leaves ** unclassified, and reads the P-line later or switches to Ahead in one edit', () => {
    const opened = roadEngProject([{ name: 'L.dsnx', bytes: designWithPLine() }], options)
    const a = opened.roads[0].alignment
    expect(a.engineering!.strata).toEqual([])
    expect(opened.notes.join(' ')).toMatch(/its P-line Line.tr1 was not given with the design/)
    const read = refreshPLineStrata(a, { parse: parseNativeTraverse, tr1: { name: 'Line.tr1', text: TR1 } })
    expect(read.horizons).toBe(6)
    const ahead = refreshPLineStrata(read.alignment, { parse: parseNativeTraverse, apply: 'ahead' })
    expect(ahead.alignment.roadEngSource?.pLine?.apply).toBe('ahead')
    expect(
      ahead.alignment
        .engineering!.strata.filter((s) => s.materialId === 'roadeng-HP')
        .map((s) => [Math.round(s.start * 1000) / 1000, Math.round(s.end * 1000) / 1000]),
    ).toEqual([[200, 300]])
    const out = roadEngProjectExport({
      name: 'L',
      roads: [{ alignment: ahead.alignment }],
      grid: { toGrid: plane.toFile, epsg: null, raster: null },
      context: [],
      cables: [],
      reference: [],
    })
    expect(strFromU8(unzipSync(unzipSync(out.bytes)['L.dsnx'])['Location1.dsn'], true)).toMatch(/GndRange=1\r\n/)
    // Back to the design's own choice: nothing is written.
    const back = refreshPLineStrata(ahead.alignment, { parse: parseNativeTraverse, apply: 'between' })
    expect(back.alignment.roadEngSource?.pLine?.apply).toBeUndefined()
  })
})

const pack = process.env.ROADENG_SAMPLE_PACK
const packFile = (path: string) => ({
  name: path.split('/').pop()!,
  bytes: new Uint8Array(readFileSync(join(pack!, path))),
})
describe.skipIf(!pack || !existsSync(join(pack ?? '', 'guardrails/GuardRail.dsnx')))('Softree sample pack', () => {
  it('opens GuardRail with its P-line: OB from the survey, the traverse kept and written back as read', () => {
    const files = ['guardrails/GuardRail.dsnx', 'guardrails/Traverse.tr1', 'guardrails/Traverse.tr2'].map(packFile)
    const opened = roadEngProject(files, options)
    const a = opened.roads[0].alignment
    expect(opened.notes.join(' ')).toMatch(
      /P-line Traverse.tr1 was read: 29 surveyed stations, none giving ground layers/,
    )
    expect(a.engineering!.strata.map((s) => [s.id, s.materialId, s.start, Math.round(s.end)])).toEqual([
      ['roadeng-pline-1', 'roadeng-OB', 0, 2800],
    ])
    // Field 6 of its calculated stations: its L-line is its P-line.
    expect(a.roadEngSource?.pLine?.stations).toEqual([
      [1400, 1400],
      [4200, 4200],
    ])
    const out = roadEngProjectExport({
      name: 'GuardRail',
      roads: [{ alignment: a }],
      grid: { toGrid: localPlaneProjection(opened.localPlane!.offsetM).toFile, epsg: null, raster: null },
      context: [],
      cables: [],
      reference: [],
    })
    const zip = unzipSync(out.bytes)
    expect(zip['Traverse.tr1']).toEqual(files[1].bytes)
    expect(zip['Traverse.tr2']).toEqual(files[2].bytes)
    const dsn = strFromU8(unzipSync(zip['GuardRail.dsnx'] ?? Object.values(zip)[0])['Location1.dsn'], true)
    const read = strFromU8(unzipSync(files[0].bytes)['Location1.dsn'], true)
    expect(dsn.slice(0, read.length)).toBe(read)
  })
  it('opens GuardRail without its P-line: that ground is unclassified, never OB', () => {
    const opened = roadEngProject([packFile('guardrails/GuardRail.dsnx')], options)
    expect(opened.roads[0].alignment.engineering!.strata).toEqual([])
    expect(opened.notes.join(' ')).toMatch(/Traverse.tr1; it was not opened with the design/)
  })
  it('reads every survey traverse in the pack into a field book', () => {
    const expected: Record<string, [number, number | null]> = {
      'guardrails/Traverse.tr1': [29, null],
      'tutorial-v10/RoadEngResource/Traverse/spur.tr1': [43, 0.3048],
      'tutorial-v10/Survey/Adjust/main.tr1': [47, null],
      'tutorial-v10/Survey/Adjust/spur.tr1': [13, null],
      'tutorial-v10/Terrain/Survey/road.tr1': [109, null],
    }
    const foresights: Record<string, number> = {}
    for (const [path, [count, unit]] of Object.entries(expected)) {
      const text = readFileSync(join(pack!, path), 'latin1')
      expect(detectTraverseFile(text)).toBe('tr1')
      const t = parseNativeTraverse(text)
      expect([t.stations.length, t.unitM]).toEqual([count, unit])
      const book = nativeTraverseToFieldBook(t, { unitM: 1 })
      foresights[path] = book.points.length
      expect(book.input.legs).toHaveLength(count - 1 - book.points.length)
      // Every station value is the one before plus the distance between them: no equation.
      expect(book.equations).toEqual([])
      // The reduction lands on every line station's own coordinates.
      const reduced = reduceTraverse(book.input)
      const u = t.unitM ?? 1
      const line = t.stations.filter((_, k) => !(k > 0 && isForesightShot(t.stations[k - 1])))
      line.forEach((s, i) => {
        expect(reduced.stations[i].raw[0]).toBeCloseTo(s.x * u, 6)
        expect(reduced.stations[i].raw[2]).toBeCloseTo(s.z * u, 6)
      })
    }
    // Intermediate foresights (TYPE bit 8 on the station before) are points off the line.
    expect(Object.values(foresights)).toEqual([0, 1, 4, 1, 12])
    // The resource spur's layers are in feet: OB to 0.5 ft, FR below.
    const spur = parseNativeTraverse(
      readFileSync(join(pack!, 'tutorial-v10/RoadEngResource/Traverse/spur.tr1'), 'latin1'),
    )
    expect(pLineGroundStations(spur, 0.3048, 'OB')[0].layers).toEqual([
      { code: 'OB', topDepthM: 0, bottomDepthM: 0.1524 },
      { code: 'FR', topDepthM: 0.1524, bottomDepthM: null },
    ])
  })
})
