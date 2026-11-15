import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import proj4 from 'proj4'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { projectedCrsDefinition } from '@/lib/geo/projectedCrs'
import type { LocalRaster } from '../dev-forestry/types'
import { alignmentLength, analyzeRoad } from './engine'
import type { XY } from './landXmlImport'
import { roadEngDesign } from './roadEngExport'
import { roadEngProject } from './roadEngProject'
import { roadEngDLineCable, roadEngDLineFor } from './roadEngDLines'
import { encodeRoadEngLoggingSystems, newRoadEngLoggingSystem } from './roadEngLoggingSystems'
import { encodeRoadEngMapNotes, newRoadEngMapNote } from './roadEngMapNotes'
import {
  classifyRoadEngFeature,
  readRoadEngTerrainArchive,
  roadEngLayerMatches,
  ROADENG_FLAG_POINT_SET,
} from './roadEngTerrain'
import { buildTer, chunk, Writer } from './roadEngTerrain.testkit'
import { roadEngIniValue } from './roadEngText'
import {
  ROADENG_DEFAULT_CODES,
  ROADENG_EXPORT_LAYERS,
  roadEngCoordSys,
  roadEngProjectFileNames,
  roadEngProjectZip,
  roadEngTerrainArchive,
  type RoadEngExportFeature,
} from './roadEngTerrainExport'
import { rasterizeTin } from './tinSurface'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE, terrainFromMetadata } from './terrain'
import type { Alignment, Coordinate } from './types'

// A 600 m square of ground in UTM zone 10 on 2 m cells: a 5 % slope east with a gentle valley
// across it, and a hole of missing cells.
const E0 = 515_000,
  N0 = 5_975_000
const CELL = 2,
  SIDE = 300
const utm10 = proj4('EPSG:4326', projectedCrsDefinition(26910)!)
const lonLat = (x: number, y: number) => utm10.inverse([x, y]) as Coordinate
const toGrid = (c: Coordinate) => utm10.forward([...c]) as XY
const groundAt = (x: number, y: number) =>
  Math.round((800 + 0.05 * (x - E0) + 0.0001 * (y - N0 - 300) ** 2) * 1000) / 1000
const hole = (c: number, r: number) => c >= 100 && c < 110 && r >= 40 && r < 46
function makeRaster(): LocalRaster {
  const values: (number | null)[] = []
  for (let r = 0; r < SIDE; r++)
    for (let c = 0; c < SIDE; c++)
      values.push(hole(c, r) ? null : groundAt(E0 + CELL / 2 + c * CELL, N0 + 600 - CELL / 2 - r * CELL))
  return {
    id: 'terrain-test',
    name: 'Test ground',
    kind: 'terrain',
    epsg: 26910,
    origin: [E0 + CELL / 2, N0 + 600 - CELL / 2],
    pixelSize: [CELL, -CELL],
    width: SIDE,
    height: SIDE,
    values,
    acquired: '',
    verticalReference: 'CGVD2013',
    sha256: '0'.repeat(64),
  }
}
const raster = makeRaster()
const cellCentre = (c: number, r: number): XY => [raster.origin[0] + c * CELL, raster.origin[1] - r * CELL]

/** The `.ter` inside an archive, with its sections located. */
function terSections(archive: Uint8Array) {
  const ter = unzipSync(archive)['Terrain1.ter']
  const view = new DataView(ter.buffer, ter.byteOffset, ter.byteLength)
  const sizes: number[] = [],
    offsets: number[] = []
  let at = 38
  for (let i = 0; i < 9; i++) {
    sizes.push(view.getUint32(2 + 4 * i, true))
    offsets.push(at)
    at += sizes[i]
  }
  return { ter, view, sizes, offsets }
}

const line = (pts: [number, number][], z?: number): RoadEngExportFeature['points'] =>
  pts.map(([x, y]) => (z === undefined ? ([E0 + x, N0 + y] as const) : ([E0 + x, N0 + y, z] as const)))
const features: RoadEngExportFeature[] = [
  {
    name: 'Willow Creek',
    kind: 'stream',
    points: line(
      [
        [50, 0],
        [60, 200],
        [80, 600],
      ],
      790,
    ),
  },
  {
    name: 'Old haul road',
    kind: 'road',
    points: line([
      [500, 0],
      [520, 600],
    ]),
  },
  {
    name: 'DL 4',
    kind: 'd-line',
    points: line([
      [300, 450],
      [380, 520],
    ]),
    // A D-line is one by its cable settings; without them it reads back as a reference line.
    dLine: roadEngDLineFor({ lengthM: Math.hypot(80, 70), yarderHeight: 18, tailholdHeight: 8, deflectionPercent: 5 }),
  },
  {
    name: 'Block 12',
    kind: 'falling-boundary',
    closed: true,
    points: line([
      [250, 50],
      [350, 50],
      [350, 150],
      [250, 150],
    ]),
  },
  {
    name: 'Riparian reserve',
    kind: 'boundary',
    closed: true,
    points: line([
      [20, 300],
      [120, 300],
      [120, 360],
      [20, 360],
      [20, 300],
    ]),
  },
  { name: 'L1', kind: 'landing', points: line([[200, 580]], 812.5) },
  {
    name: 'Fence',
    kind: 'other',
    points: line([
      [400, 300],
      [450, 320],
    ]),
  },
]

describe('RoadEng terrain export', () => {
  const written = roadEngTerrainArchive({ raster, features, coordSys: { epsg: 26910 } })
  const back = readRoadEngTerrainArchive(written.bytes)

  it('writes a terrain the reader takes without a doubt', () => {
    expect(Object.keys(unzipSync(written.bytes))).toEqual(['Terrain1.ter', 'Terrain1.tlt'])
    expect(back.warnings).toHaveLength(1)
    expect(back.warnings[0]).toMatch(/^Read 97 features with 89,960 points and a TIN of 89,940 vertices/)
    expect(back.terrain.codes).toEqual([...ROADENG_DEFAULT_CODES])
    expect(back.coordSys).toMatchObject({ epsg: 26910, source: 'wkt' })
    // Ground in point sets of at most 1,000, as RoadEng holds a gridded DEM.
    const ground = back.terrain.features.filter((f) => f.inTin)
    expect(ground).toHaveLength(90)
    expect(ground.every((f) => f.type === 'points' && f.points.length <= 3000 && f.flags === 0x09)).toBe(true)
  })

  it('stores a TIN of two clockwise triangles per complete cell, reproducing the grid at every cell centre', () => {
    const tin = back.terrain.tin!
    // Two to a cell with a level at all four corners, one to a cell with three.
    let expected = 0
    for (let r = 0; r < SIDE - 1; r++)
      for (let c = 0; c < SIDE - 1; c++) {
        const corners = [hole(c, r), hole(c + 1, r), hole(c, r + 1), hole(c + 1, r + 1)].filter((h) => !h).length
        expected += corners === 4 ? 2 : corners === 3 ? 1 : 0
      }
    expect(tin.triangles.length / 3).toBe(expected)
    expect(written.notes).toContain(
      `The ground is 89,940 mass points and a TIN of ${expected.toLocaleString('en-CA')} triangles: two to each cell ` +
        'with a level at all four corners, one to each of 4 cells with three; the longest side is 2.829 m.',
    )
    expect(tin.maxSideM).toBe(2.829)
    // The reader turns them counter-clockwise; every one must come out that way.
    for (let t = 0; t < tin.triangles.length; t += 3) {
      const [a, b, c] = [tin.triangles[t], tin.triangles[t + 1], tin.triangles[t + 2]]
      const area =
        (tin.coords[2 * b] - tin.coords[2 * a]) * (tin.coords[2 * c + 1] - tin.coords[2 * a + 1]) -
        (tin.coords[2 * c] - tin.coords[2 * a]) * (tin.coords[2 * b + 1] - tin.coords[2 * a + 1])
      expect(area).toBeGreaterThan(0)
    }
    // Rasterized on cells centred on its vertices, the TIN gives back the grid exactly.
    const grid = rasterizeTin(
      { coords: tin.coords, z: tin.z, triangles: tin.triangles, cloudPoints: 0, totalPoints: 0 },
      {
        cellM: CELL,
        maxEdgeM: 3,
        bounds: [E0, N0, E0 + 600, N0 + 600],
      },
    )
    expect(grid.origin).toEqual(raster.origin)
    let compared = 0
    for (let r = 0; r < SIDE; r++)
      for (let c = 0; c < SIDE; c++) {
        const value = raster.values[r * SIDE + c]
        const got = grid.values[r * grid.width + c]
        if (value === null || got === null) continue
        expect(got).toBeCloseTo(value, 6)
        compared++
      }
    expect(compared).toBeGreaterThan(89_000)
  })

  it('stores each neighbour across the edge it names, and −1 only on the hull', () => {
    const { view, sizes, offsets } = terSections(written.bytes)
    const count = sizes[6] / 16
    const tri = (t: number) => [0, 1, 2].map((j) => view.getInt32(offsets[6] + 16 * t + 4 * j, true))
    const edgeUse = new Map<string, number>()
    for (let t = 0; t < count; t++) {
      const v = tri(t)
      for (let j = 0; j < 3; j++) {
        const key = [v[j], v[(j + 1) % 3]].sort((p, q) => p - q).join()
        edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1)
      }
    }
    let hull = 0
    for (let t = 0; t < count; t++) {
      const v = tri(t)
      for (let j = 0; j < 3; j++) {
        const n = view.getInt32(offsets[7] + 16 * t + 4 * j, true)
        const key = [v[j], v[(j + 1) % 3]].sort((p, q) => p - q).join()
        if (n < 0) {
          hull++
          expect(edgeUse.get(key)).toBe(1)
          continue
        }
        const w = tri(n)
        // The neighbour runs the shared edge the other way.
        const k = w.indexOf(v[(j + 1) % 3])
        expect(w[(k + 1) % 3]).toBe(v[j])
      }
    }
    expect(hull).toBe([...edgeUse.values()].filter((u) => u === 1).length)
  })

  it('reads every drawn feature back as its kind, named for its code, at its own levels', () => {
    const drawn = back.terrain.features.filter((f) => !f.inTin)
    expect(drawn.map((f) => [f.name, classifyRoadEngFeature(f, back.layers)])).toEqual([
      ['Sml Stream - Willow Creek', 'stream'],
      ['Road CL - Old haul road', 'road'],
      ['DL 4', 'd-line'],
      ['Falling BDY - Block 12', 'boundary'],
      ['Boundary - Riparian reserve', 'boundary'],
      ['Landing - L1', 'landing'],
      ['Fence', 'other'],
    ])
    expect(drawn.every((f) => f.flags === 0x40)).toBe(true)
    expect(drawn[0].points[2]).toBe(790)
    expect(drawn[1].points[2]).toBe(0)
    expect(drawn[5]).toMatchObject({ type: 'point', bbox: [E0 + 200, E0 + 200, N0 + 580, N0 + 580, 812.5, 812.5] })
    // A ring is closed as RoadEng closes one, its first point repeated once.
    expect(drawn[3]).toMatchObject({ type: 'closed-line' })
    expect(drawn[3].points.length / 3).toBe(5)
    expect(drawn[4].points.length / 3).toBe(5)
    expect(drawn[0].lengthM).toBeCloseTo(Math.hypot(10, 200) + Math.hypot(20, 400), 9)
    expect(written.notes).toContain(
      'Drawn features, left out of the TIN: 1 stream, 1 road, 1 D-line, 1 felling boundary, 1 boundary, 1 landing, 1 other feature.',
    )
  })

  it('renames a feature whose own name reads as another kind, and says what will not come back', () => {
    const tricky: RoadEngExportFeature[] = [
      { name: 'Streams crossing', kind: 'd-line', points: line([[0, 0]]).concat(line([[10, 10]])) },
      { name: 'Landing access', kind: 'other', points: line([[0, 0]]).concat(line([[10, 0]])) },
      {
        name: 'Fall line',
        kind: 'boundary',
        closed: true,
        points: line([[0, 0]]).concat(
          line([
            [10, 0],
            [10, 10],
          ]),
        ),
      },
      { name: 'Survey pin', kind: 'other', points: line([[5, 5]]) },
      { name: 'Λόφος', kind: 'other', points: line([[0, 0]]).concat(line([[1, 1]])) },
    ]
    const out = roadEngTerrainArchive({ raster: null, features: tricky, coordSys: null })
    const read = readRoadEngTerrainArchive(out.bytes)
    expect(read.terrain.tin).toBeNull()
    expect(read.terrain.features.map((f) => [f.name, classifyRoadEngFeature(f, read.layers)])).toEqual([
      ['D-Line', 'd-line'],
      ['Feature', 'other'],
      ['Boundary', 'boundary'],
      ['Survey pin', 'mass-points'],
      ['?????', 'other'],
    ])
    expect(out.notes).toContain(
      '3 features are written as D-Line, Feature, Boundary: their own names read as another kind.',
    )
    expect(out.notes).toContain(
      '1 single-point feature of no RoadEng code will read back into PG Maps as terrain points.',
    )
    expect(out.notes).toContain('No terrain grid was given, so the terrain holds only the drawn features.')
  })

  it('keeps a long name in an attribute group and numbers repeats by sub ID', () => {
    const repeated: RoadEngExportFeature[] = [1, 2].map(() => ({
      name: 'Tributary to the Willow',
      kind: 'stream',
      points: line([
        [0, 0],
        [10, 10],
      ]),
    }))
    const out = roadEngTerrainArchive({ raster: null, features: repeated, coordSys: null })
    const { ter, view, offsets, sizes } = terSections(out.bytes)
    expect(sizes[3]).toBe(2 * 284)
    // The header's count of attribute chunks, as in every sample.
    expect(view.getUint32(offsets[0] + 12, true)).toBe(2)
    expect(new TextDecoder('latin1').decode(ter.subarray(offsets[1] + 86, offsets[1] + 104))).toBe(
      'Sml Stream - Trib\0',
    )
    const read = readRoadEngTerrainArchive(out.bytes).terrain.features
    expect(read.map((f) => [f.name, f.subId])).toEqual([
      ['Sml Stream - Tributary to the Willow', 0],
      ['Sml Stream - Tributary to the Willow', 1],
    ])
  })

  it('clips the grid to a corridor and thins it to the vertex budget, as the notes say', () => {
    const road: [number, number][] = [
      [E0 + 20, N0 + 40],
      [E0 + 300, N0 + 320],
      [E0 + 580, N0 + 330],
    ]
    const corridor = roadEngTerrainArchive({
      raster,
      corridor: { lines: [road], halfWidthM: 30 },
      coordSys: { epsg: 26910 },
    })
    const near = (p: XY) => {
      let best = Infinity
      for (let k = 1; k < road.length; k++) {
        const [ax, ay] = road[k - 1],
          [bx, by] = road[k]
        const t = Math.max(
          0,
          Math.min(1, ((p[0] - ax) * (bx - ax) + (p[1] - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)),
        )
        best = Math.min(best, Math.hypot(p[0] - ax - t * (bx - ax), p[1] - ay - t * (by - ay)))
      }
      return best
    }
    let inside = 0
    for (let r = 0; r < SIDE; r++)
      for (let c = 0; c < SIDE; c++) if (!hole(c, r) && near(cellCentre(c, r)) <= 30) inside++
    expect(corridor.ground).toMatchObject({ cells: 89_940, cellsInCorridor: inside, stride: 1, vertices: inside })
    expect(corridor.notes[0]).toBe(
      `${inside.toLocaleString('en-CA')} of the terrain's 89,940 cells lie within 30 m of the corridor line; the rest are left out.`,
    )
    const read = readRoadEngTerrainArchive(corridor.bytes)
    expect(read.warnings).toHaveLength(1)
    const tin = read.terrain.tin!
    expect(tin.z.length).toBe(inside)
    for (let v = 0; v < tin.z.length; v++)
      expect(near([tin.coords[2 * v], tin.coords[2 * v + 1]])).toBeLessThanOrEqual(30)

    const thinned = roadEngTerrainArchive({ raster, maxVertices: 5000, coordSys: { epsg: 26910 } })
    expect(thinned.ground).toMatchObject({ stride: 5, maxSideM: 14.143 })
    expect(thinned.notes[0]).toMatch(
      /^To stay within 5,000 points, every 5th cell each way is kept \(10 m by 10 m\): 3,5\d\d of 89,940 cells, at their own levels\.$/,
    )
    const sparse = readRoadEngTerrainArchive(thinned.bytes).terrain.tin!
    expect(sparse.z.length).toBe(thinned.ground!.vertices)
    expect(sparse.z.length).toBeLessThanOrEqual(5000)
    for (let v = 0; v < sparse.z.length; v++) {
      const c = (sparse.coords[2 * v] - raster.origin[0]) / CELL,
        r = (raster.origin[1] - sparse.coords[2 * v + 1]) / CELL
      expect([c % 5, r % 5]).toEqual([0, 0])
      expect(sparse.z[v]).toBe(raster.values[r * SIDE + c])
    }
  })

  it('refuses a grid it cannot place and an export with nothing in it', () => {
    expect(() => roadEngTerrainArchive({ raster: { ...raster, pixelSize: [2, 2] }, coordSys: null })).toThrow(
      /north-up/,
    )
    expect(() => roadEngTerrainArchive({ raster: null, coordSys: null })).toThrow(/nothing to write/)
  })
})

describe('RoadEng CoordSys', () => {
  // LongRoad_1's line, which the NAD83 / UTM form follows.
  const longRoad =
    '10000|51|10015|PROJCS["NAD_1983_UTM_Zone_15N",GEOGCS["GCS_North_American_1983",DATUM["North_American_Datum_1983",' +
    'SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433],' +
    'AUTHORITY["EPSG","4269"]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],' +
    'PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-93.0],PARAMETER["Scale_Factor",0.9996],' +
    'PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0],AUTHORITY["EPSG","26915"]]|0'
  it('writes NAD83 / UTM as RoadEng wrote LongRoad', () => {
    expect(roadEngCoordSys(26915)).toEqual({ value: longRoad, written: true })
    expect(roadEngCoordSys(26910).value).toMatch(/^10000\|51\|10010\|PROJCS\["NAD_1983_UTM_Zone_10N"/)
  })

  const point = (x: number, y: number) => [{ name: 'Landing', kind: 'landing' as const, points: [[x, y] as const] }]
  it.each([
    [26910, [-122.75, 53.9]],
    [3157, [-122.75, 53.9]],
    [32611, [-117.2, 49.5]],
    [32711, [-117.2, -33.5]],
    [3005, [-122.75, 53.9]],
  ] as const)('round-trips EPSG:%i, its WKT placing points where this workspace does', (epsg, at) => {
    const out = roadEngTerrainArchive({ raster: null, features: point(1, 2), coordSys: { epsg } })
    const read = readRoadEngTerrainArchive(out.bytes)
    expect(read.coordSys.epsg).toBe(epsg)
    expect(read.warnings).toHaveLength(1)
    // The WKT's parameters, read by proj4, agree with the workspace's own definition. NAD83(CSRS)
    // differs by its datum shift, which the WKT names only by its datum.
    const fromWkt = proj4('EPSG:4326', read.coordSys.wkt!).forward([...at])
    const ours = proj4('EPSG:4326', projectedCrsDefinition(epsg)!).forward([...at])
    expect(Math.hypot(fromWkt[0] - ours[0], fromWkt[1] - ours[1])).toBeLessThan(epsg === 3157 ? 3 : 0.001)
  })

  it('writes RoadEng\'s "not set" for no CRS, or one it has no form for, and says so', () => {
    const none = roadEngTerrainArchive({ raster: null, features: point(1, 2), coordSys: null })
    const read = readRoadEngTerrainArchive(none.bytes)
    expect(read.coordSys).toMatchObject({ raw: '1|-1|-1', epsg: null, source: 'none' })
    expect(read.warnings.slice(1)).toEqual([
      'The terrain names no coordinate system (CoordSys 1|-1|-1); say which one its grid is in.',
    ])
    expect(none.notes).toContain('The terrain states no coordinate system: RoadEng will show it as not set.')
    const plane = roadEngTerrainArchive({ raster: null, features: point(1, 2), coordSys: { epsg: 59999 } })
    expect(readRoadEngTerrainArchive(plane.bytes).coordSys.raw).toBe('1|-1|-1')
    expect(plane.notes).toContain('EPSG:59999 has no RoadEng form here, so the terrain states no coordinate system.')
  })
})

describe('RoadEng terrain written back with what PG Maps does not model', () => {
  // A RoadEng terrain as RoadEng saves one: display settings, a symbol library, two logging
  // systems, a map note, an attribute schema and a defaults entry.
  const lb = 0.45359237,
    ft = 0.3048,
    lbf = lb * 9.80665e-3
  const rope = (tension: number, weight: number, length: number) => ({
    maxTensionKN: tension * lbf,
    weightKgPerM: (weight * lb) / ft,
    maxLengthM: length * ft,
  })
  const madill = newRoadEngLoggingSystem({
    id: '1',
    name: 'Highlead',
    configuration: 'Highlead with butt rigging',
    carriageKg: 300 * lb,
    equipment: {
      name: '90 ft Madill',
      sparHeightM: 90 * ft,
      skyline: rope(48300, 2.89, 1200),
      mainline: rope(48300, 2.89, 1200),
      haulback: rope(22900, 1.34, 2600),
      fourth: rope(0, 0, 0),
      machineCode: 3,
    },
  })
  const systems = [madill, { ...madill, id: '2', name: 'Shotgun' }]
  const section8 = encodeRoadEngLoggingSystems(systems)
  section8.set([0x5a, 0x5a], 132) // stale padding, as RoadEng leaves it
  const tail = encodeRoadEngMapNotes([newRoadEngMapNote('Access Road', E0 + 100, N0 + 200)])
  tail.set([0xb9, 0x8a, 0x01, 0x57], 16)
  const schema = strToU8('7000|1|0|4|General|General|0|0|Features Tot.|Features Tot.|_UNITS_UDF|7|0\0', true)
  const groupPayload = (index: number, name: string) => {
    const w = new Writer()
    w.i32(index)
    w.str(name, 256)
    w.u32(0)
    w.u32(0)
    return w.bytes
  }
  const keptChunks = [
    ...chunk(100, -1, schema),
    ...chunk(52, -1, groupPayload(-1, '%$^**&@')),
    ...chunk(58, -1, [0, 0, 0, 0, 1, 2, 3, 4]),
  ]
  const sourceTlt = [
    '[AUTO_TAIL]',
    'AutoTailParms=0,20',
    '[EQUIP1]',
    'Desc=90 ft Madill',
    'Lengths=1200.000000,1200.000000,2600.000000,0.000000',
    'Machine=90.0,3',
    'Tensions=48300.000000,48300.000000,22900.000000,0.000000',
    'UnitWts=2.890000,2.890000,1.340000,0.000000',
    '[main]',
    'AzimuthFormat=0,0,0,0,0',
    `CoordSys=${roadEngCoordSys(26910).value}`,
    'TriCalcParms=1,1,1,1,0,500,1,0,5172.56600813,20,80,0.1,-1e+030,1e+030,-1e+030,1e+030,1,1,10,0,500,1,20,80,30',
    'units=10000',
    '[Software]',
    'Version=9.099',
    '[TerLayers]',
    'Layer0=CNTR*,Contours from model,',
    'Layer1=ROAD*,Roads,',
    '',
  ].join('\r\n')
  const te1 = new Uint8Array([0x41, 0x43, 0x31, 0x30, 0x31, 0x34, 0, 1, 2, 3])
  const sourceTer = buildTer({
    features: [
      {
        name: 'Lidar',
        points: [
          [E0, N0, 800],
          [E0 + 10, N0, 801],
        ],
        flags: 0x09,
      },
    ],
    codes: ['Sml Stream', 'Road CL', 'D-Line', 'Landing'],
    attributes: keptChunks,
    section8,
    tail,
  })
  const source = readRoadEngTerrainArchive(
    zipSync({ 'Terrain1.ter': sourceTer, 'Terrain1.tlt': strToU8(sourceTlt, true), 'Terrain1.te1': te1 }),
  ).source
  const small = {
    origin: [E0 + 1, N0 + 59] as [number, number],
    pixelSize: [2, -2] as [number, number],
    width: 30,
    height: 30,
    values: Array.from({ length: 900 }, (_, i) => groundAt(E0 + 1 + 2 * (i % 30), N0 + 59 - 2 * Math.floor(i / 30))),
  }
  const input = { raster: small, features, coordSys: { epsg: 26910 } }
  const plain = roadEngTerrainArchive(input)
  const kept = roadEngTerrainArchive({ ...input, source })

  it('keeps every kept part byte for byte', () => {
    const files = unzipSync(kept.bytes)
    expect(Object.keys(files)).toEqual(['Terrain1.ter', 'Terrain1.tlt', 'Terrain1.te1'])
    expect(files['Terrain1.te1']).toEqual(te1)
    // The .tlt as it was, with only the writer's layers a written feature is named for added to
    // [TerLayers], its last section.
    const tlt = strFromU8(files['Terrain1.tlt'], true)
    expect(tlt.startsWith(sourceTlt)).toBe(true)
    // The ground's point sets are terrain, not drawn features: their layer is not added to a kept .tlt.
    const names = readRoadEngTerrainArchive(kept.bytes)
      .terrain.features.filter((f) => !(f.flags & ROADENG_FLAG_POINT_SET))
      .map((f) => f.name)
    expect(tlt.slice(sourceTlt.length).split('\r\n').slice(0, -1)).toEqual(
      ROADENG_EXPORT_LAYERS.filter((l) => !['CNTR*', 'ROAD*'].includes(l.pattern))
        .filter((l) => names.some((n) => roadEngLayerMatches(l.pattern, n)))
        .map((l, k) => `Layer${k + 2}=${l.pattern},${l.description},`),
    )
    const out = terSections(kept.bytes)
    const original = new DataView(sourceTer.buffer)
    const sizes = Array.from({ length: 9 }, (_, i) => original.getUint32(2 + 4 * i, true))
    const end = 38 + sizes.reduce((s, x) => s + x, 0)
    const h = out.offsets[0]
    expect(out.ter.subarray(h + 16, h + 16 + 4 + 32 * 258)).toEqual(sourceTer.subarray(38 + 16, 38 + 16 + 4 + 32 * 258))
    expect(out.ter.subarray(out.offsets[3], out.offsets[3] + keptChunks.length)).toEqual(new Uint8Array(keptChunks))
    expect(out.ter.subarray(out.offsets[8], out.offsets[8] + out.sizes[8])).toEqual(section8)
    expect(out.ter.subarray(out.offsets[8] + out.sizes[8])).toEqual(sourceTer.subarray(end))
    expect(kept.notes).toContain('The terrain holds 2 logging systems and 1 map note.')
  })

  it('reads back to the same features and TIN as without the source', () => {
    const a = readRoadEngTerrainArchive(plain.bytes),
      b = readRoadEngTerrainArchive(kept.bytes)
    const shape = (r: typeof a) =>
      r.terrain.features.map((f) => [f.name, f.subId, f.flags, f.kind, [...f.points], f.inTin, f.color])
    expect(shape(b)).toEqual(shape(a))
    expect([...b.terrain.tin!.triangles]).toEqual([...a.terrain.tin!.triangles])
    expect([...b.terrain.tin!.z]).toEqual([...a.terrain.tin!.z])
    expect(b.coordSys.epsg).toBe(26910)
    expect(b.terrain.loggingSystems!.map((s) => s.name)).toEqual(['Highlead', 'Shotgun'])
    expect(b.terrain.mapNotes).toMatchObject([{ text: 'Access Road', x: E0 + 100, y: N0 + 200 }])
    expect(b.terrain.codes).toEqual(['Sml Stream', 'Road CL', 'D-Line', 'Landing'])
    expect(b.warnings).toHaveLength(1)
    // And the source read back from the written terrain keeps the same parts.
    expect(b.source.loggingSystems).toBe(source.loggingSystems)
    expect(b.source.tail).toBe(source.tail)
    expect(b.source.te1).toBe(source.te1)
  })

  it('writes the decoded systems and notes back as they were read', () => {
    const back = readRoadEngTerrainArchive(kept.bytes)
    const again = roadEngTerrainArchive({
      ...input,
      source,
      loggingSystems: back.terrain.loggingSystems,
      mapNotes: back.terrain.mapNotes,
    })
    expect(unzipSync(again.bytes)).toEqual(unzipSync(kept.bytes))
  })

  it('writes an edited library and moved note, keeping the .tlt equipment in step', () => {
    const [first, second] = readRoadEngTerrainArchive(kept.bytes).terrain.loggingSystems!
    const edited = { ...first, equipment: { ...first.equipment, sparHeightM: 100 * ft } }
    const added = newRoadEngLoggingSystem({
      id: '3',
      name: 'Grapple',
      configuration: 'Running Skyline - grapple',
      carriageKg: second.carriageKg,
      equipment: { ...second.equipment, name: 'Thunderbird TY-90' },
    })
    const out = roadEngTerrainArchive({
      ...input,
      source,
      loggingSystems: [edited, second, added],
      mapNotes: [{ ...newRoadEngMapNote('Landing 4', E0 + 5, N0 + 6) }],
    })
    const back = readRoadEngTerrainArchive(out.bytes)
    expect(back.terrain.loggingSystems!.map((s) => [s.id, s.name, s.configurationCode])).toEqual([
      ['1', 'Highlead', 1],
      ['2', 'Shotgun', 1],
      ['3', 'Grapple', 3],
    ])
    expect(back.terrain.loggingSystems![0].equipment.sparHeightM).toBeCloseTo(100 * ft, 9)
    // Only the spar height changed in the first record; its stale padding stayed.
    const { ter, offsets } = terSections(out.bytes)
    const record = ter.subarray(offsets[8], offsets[8] + 312)
    const changed = [...record].flatMap((v, i) => (v === section8[i] ? [] : [i]))
    expect(changed.every((i) => i >= 200 && i < 208)).toBe(true)
    expect(record[132]).toBe(0x5a)
    const tlt = strFromU8(unzipSync(out.bytes)['Terrain1.tlt'], true)
    expect(roadEngIniValue(tlt, 'EQUIP1', 'Machine')).toBe('100.0,3')
    expect(roadEngIniValue(tlt, 'EQUIP1', 'Tensions')).toBe('48300.000000,48300.000000,22900.000000,0.000000')
    expect(roadEngIniValue(tlt, 'EQUIP2', 'Desc')).toBe('Thunderbird TY-90')
    expect(roadEngIniValue(tlt, 'AUTO_TAIL', 'AutoTailParms')).toBe('0,20')
    expect(back.terrain.mapNotes!.map((n) => [n.text, n.x, n.y])).toEqual([['Landing 4', E0 + 5, N0 + 6]])
  })

  it('writes a D-line with its cable settings, which reads back as the same D-line', () => {
    const dLine = roadEngDLineFor({
      lengthM: Math.hypot(80, 70),
      yarderHeight: 15.24,
      tailholdHeight: 4,
      deflectionPercent: 10,
      systemId: '1',
      payloadKg: 4000,
      clearanceM: 2,
    })
    const out = roadEngTerrainArchive({
      raster: null,
      features: [
        {
          name: 'DL 4',
          kind: 'd-line',
          points: line([
            [300, 450],
            [380, 520],
          ]),
          dLine,
        },
      ],
      coordSys: { epsg: 26910 },
      source,
    })
    const back = readRoadEngTerrainArchive(out.bytes)
    const [f] = back.terrain.features
    // With cable settings it reads back as a D-line whatever its name, so it keeps its own.
    expect(f.name).toBe('DL 4')
    expect(classifyRoadEngFeature(f, back.layers)).toBe('d-line')
    expect(f.dLine).toMatchObject({ deflectionPercent: 10, systemId: '1', spars: dLine.spars })
    expect(f.dLine!.analysis!.payloadKg).toBeCloseTo(4000, 6)
    expect(f.dLine!.analysis!.clearanceM).toBeCloseTo(2, 9)
    const cable = roadEngDLineCable(f)!
    expect(cable.start).toEqual([E0 + 300, N0 + 450])
    expect(Math.hypot(cable.end[0] - E0 - 380, cable.end[1] - N0 - 520)).toBeLessThan(1e-9)
    expect(out.notes).toContain('1 D-line carries RoadEng cable settings.')
    // The header counts every chunk: the kept three, the group and four D-line chunks.
    const { view, offsets } = terSections(out.bytes)
    expect(view.getUint32(offsets[0] + 12, true)).toBe(8)
  })

  it('writes no logging systems and a bare tail without a source', () => {
    const { sizes, ter, offsets } = terSections(plain.bytes)
    expect(sizes[8]).toBe(0)
    expect(ter.length - offsets[8]).toBe(24)
    expect(readRoadEngTerrainArchive(plain.bytes).terrain.loggingSystems).toEqual([])
    // Systems given without a source: section 8 holds them and the .tlt lists their equipment.
    const out = roadEngTerrainArchive({ ...input, loggingSystems: [madill] })
    expect(terSections(out.bytes).sizes[8]).toBe(312)
    const tlt = strFromU8(unzipSync(out.bytes)['Terrain1.tlt'], true)
    expect(roadEngIniValue(tlt, 'EQUIP1', 'Desc')).toBe('90 ft Madill')
    expect(roadEngIniValue(tlt, 'EQUIP1', 'UnitWts')).toBe('2.890000,2.890000,1.340000,0.000000')
  })
})

describe('Zipped RoadEng project', () => {
  const at = (x: number, y: number) => lonLat(E0 + x, N0 + y)
  const plan: Alignment = {
    id: 'r',
    name: 'Spur 7',
    color: '#000000',
    points: [
      { id: 'a', coordinate: at(40, 60), radiusM: 0 },
      { id: 'b', coordinate: at(220, 260), radiusM: 60 },
      { id: 'c', coordinate: at(560, 300), radiusM: 0 },
    ],
    vertical: [],
    template: { ...DEFAULT_TEMPLATE },
    overrides: [],
  }
  const road: Alignment = {
    ...plan,
    vertical: [
      { id: 'v0', chainage: 0, elevation: 802, curveLength: 0 },
      { id: 'v1', chainage: alignmentLength(plan), elevation: 827, curveLength: 0 },
    ],
  }
  const files = roadEngProjectFileNames('Spur 7')
  const design = roadEngDesign([{ alignment: road }], toGrid, { terrainName: files.terrain }).bytes
  const terrain = roadEngTerrainArchive({
    raster,
    corridor: { lines: [road.points.map((p) => toGrid(p.coordinate))], halfWidthM: 60 },
    features,
    coordSys: { epsg: 26910 },
  })
  let n = 0
  const options = {
    newId: () => `id${n++}`,
    color: () => '#123456',
    template: { ...DEFAULT_TEMPLATE },
    verticalReference: 'CGVD2013',
  }

  it('holds the design and its terrain under one name, the design naming the terrain', () => {
    expect(files).toEqual({ stem: 'Spur 7', design: 'Spur 7.dsnx', terrain: 'Spur 7.terx', zip: 'Spur 7.zip' })
    const zip = roadEngProjectZip({ name: 'Spur 7', design, terrain: terrain.bytes })
    expect(Object.keys(unzipSync(zip))).toEqual(['Spur 7.dsnx', 'Spur 7.terx'])
    expect(() => roadEngProjectZip({ name: 'Spur 8', design, terrain: terrain.bytes })).toThrow(
      /The design names its terrain Spur 7\.terx; write it with the terrain name Spur 8\.terx\./,
    )
    expect(Object.keys(unzipSync(roadEngProjectZip({ name: 'Spur 8', design, terrain: null })))).toEqual([
      'Spur 8.dsnx',
    ])
    expect(roadEngProjectFileNames('a/b: c*').stem).toBe('a b c')
  })

  it('opens back in its CRS, on its ground, with what was drawn as the same project objects', () => {
    const zip = roadEngProjectZip({ name: 'Spur 7', design, terrain: terrain.bytes })
    const p = roadEngProject([{ name: files.zip, bytes: zip }], options)
    expect(p.epsg).toBe(26910)
    expect(p.localPlane).toBeNull()
    expect(p.notes.join(' ')).toMatch(/Its ground is RoadEng's TIN/)
    const source = terrainFromMetadata(p.terrain)!
    const analysis = analyzeRoad(p.roads[0].alignment, source, DEFAULT_ROAD_SETTINGS)
    expect(analysis.completeLength / analysis.length).toBeGreaterThan(0.99)
    let worst = 0
    for (const s of analysis.stations) {
      if (s.groundElevation === null) continue
      const [x, y] = toGrid(s.coordinate)
      worst = Math.max(worst, Math.abs(s.groundElevation - groundAt(x, y)))
    }
    expect(worst).toBeLessThan(0.03)

    const near = (c: Coordinate, x: number, y: number) => {
      const [gx, gy] = toGrid(c)
      return Math.hypot(gx - E0 - x, gy - N0 - y)
    }
    expect(p.context.map((f) => [f.kind, f.name])).toEqual([
      ['stream', 'Sml Stream - Willow Creek'],
      ['existing-road', 'Road CL - Old haul road'],
      ['harvest', 'Falling BDY - Block 12'],
    ])
    expect(p.context[2]).toMatchObject({ harvestEvidence: { source: 'user', status: 'proposed' } })
    expect(p.cables.map((c) => c.name)).toEqual(['DL 4'])
    expect(near(p.cables[0].start, 300, 450)).toBeLessThan(0.001)
    expect(near(p.cables[0].end, 380, 520)).toBeLessThan(0.001)
    expect(p.reference.map((f) => [f.name, f.geometry.type])).toEqual([
      ['Boundary - Riparian reserve', 'Polygon'],
      ['Landing - L1', 'Point'],
      ['Fence', 'LineString'],
    ])
    expect(near(p.reference[1].geometry.coordinates as Coordinate, 200, 580)).toBeLessThan(0.001)
    // The ground point sets are the terrain itself.
    expect(p.notes.join(' ')).toMatch(/\d+ contours, point sets and boundaries make up its terrain/)
  })
})

// Softree's published samples, read from a local copy and never committed (see roadEngImport.test.ts).
const samples = process.env.ROADENG_SAMPLES
const sample = (path: string) => ({
  name: path.split('/').pop()!,
  bytes: new Uint8Array(readFileSync(join(samples!, path))),
})
const sampleOptions = {
  newId: () => 'id',
  color: () => '#123456',
  template: { ...DEFAULT_TEMPLATE },
  verticalReference: 'CGVD2013',
}
describe.skipIf(!samples || !existsSync(samples ?? ''))(
  'Softree sample terrains written back',
  { timeout: 120_000 },
  () => {
    it('writes a cable tutorial terrain back keeping its RoadEng parts byte for byte, and its D-line', () => {
      const path = join(samples!, 'Terrain_cables/CableAnalysis - 4.terx')
      if (!existsSync(path)) return
      const bytes = new Uint8Array(readFileSync(path))
      const original = readRoadEngTerrainArchive(bytes)
      const files = unzipSync(bytes)
      const proposed = original.terrain.features.find((f) => f.dLine)!
      const points: [number, number, number][] = []
      for (let k = 0; k < proposed.points.length; k += 3)
        points.push([proposed.points[k], proposed.points[k + 1], proposed.points[k + 2]])
      const write = (extra: Partial<Parameters<typeof roadEngTerrainArchive>[0]> = {}) =>
        roadEngTerrainArchive({
          raster: null,
          features: [{ name: proposed.name, kind: 'd-line', points, dLine: proposed.dLine }],
          coordSys: { epsg: 26909 },
          source: original.source,
          ...extra,
        })
      const out = write()
      const written = unzipSync(out.bytes)
      expect(written['Terrain1.te1']).toEqual(files['Terrain1.te1'])
      // The .tlt as RoadEng saved it, CoordSys included: its D-line keeps its own name, which reads
      // back as a D-line by its settings, so no layer is added.
      expect(strFromU8(written['Terrain1.tlt'], true)).toBe(strFromU8(files['Terrain1.tlt'], true))
      const sections = (ter: Uint8Array) => {
        const view = new DataView(ter.buffer, ter.byteOffset, ter.byteLength)
        const sizes = Array.from({ length: 9 }, (_, i) => view.getUint32(2 + 4 * i, true))
        const offsets = sizes.map((_, i) => 38 + sizes.slice(0, i).reduce((s, x) => s + x, 0))
        return { sizes, offsets, end: offsets[8] + sizes[8] }
      }
      const [a, b] = [files['Terrain1.ter'], written['Terrain1.ter']]
      const [sa, sb] = [sections(a), sections(b)]
      expect(b.subarray(sb.offsets[8], sb.end)).toEqual(a.subarray(sa.offsets[8], sa.end))
      expect(b.subarray(sb.end)).toEqual(a.subarray(sa.end))
      expect(b.subarray(54, 54 + 4 + 32 * 258)).toEqual(a.subarray(54, 54 + 4 + 32 * 258))
      // Its D-line reads back with the same cable settings and chunks.
      const back = readRoadEngTerrainArchive(out.bytes)
      expect(back.coordSys).toMatchObject({ epsg: 26909, raw: original.coordSys.raw })
      const [dLine] = back.terrain.features
      expect(dLine.name).toBe('Proposed_Multispan_DLine')
      expect(dLine.dLine!.chunks).toEqual(proposed.dLine!.chunks)
      expect(back.terrain.loggingSystems).toEqual(original.terrain.loggingSystems)
      expect(back.terrain.mapNotes).toEqual(original.terrain.mapNotes)
      // Written from the decoded library and notes, everything is the same again.
      const again = write({ loggingSystems: original.terrain.loggingSystems, mapNotes: original.terrain.mapNotes })
      expect(unzipSync(again.bytes)).toEqual(written)
    })

    it('writes RangeRoadTopo back with its ground within a few centimetres of RoadEng TIN', () => {
      const opened = roadEngProject([sample('Cul-de-sac-design/CulDeSacExample/RangeRoadTopo.terx')], sampleOptions)
      expect(opened.epsg).toBe(26910)
      const out = roadEngTerrainArchive({ raster: opened.terrain.raster!, coordSys: { epsg: opened.epsg } })
      const read = readRoadEngTerrainArchive(out.bytes)
      expect(read.warnings).toHaveLength(1)
      expect(read.coordSys.epsg).toBe(26910)
      const again = roadEngProject([{ name: 'Topo.terx', bytes: out.bytes }], sampleOptions)
      const first = terrainFromMetadata(opened.terrain)!,
        second = terrainFromMetadata(again.terrain)!
      // At RoadEng's own TIN vertices.
      const original = readRoadEngTerrainArchive(sample('Cul-de-sac-design/CulDeSacExample/RangeRoadTopo.terx').bytes)
        .terrain.tin!
      const toLonLat = proj4('EPSG:4326', projectedCrsDefinition(26910)!)
      const diffs: number[] = []
      for (let v = 0; v < original.z.length; v += 7) {
        const c = toLonLat.inverse([original.coords[2 * v], original.coords[2 * v + 1]]) as Coordinate
        const a = first.elevationAt(...c),
          b = second.elevationAt(...c)
        if (a !== null && b !== null && Number.isFinite(a) && Number.isFinite(b)) diffs.push(Math.abs(a - b))
      }
      diffs.sort((x, y) => x - y)
      console.info(
        `RangeRoadTopo written back: ${out.ground!.vertices} points, ${out.ground!.triangles} triangles; ` +
          `|dz| median ${diffs[diffs.length >> 1].toFixed(3)} m, p99 ${diffs[Math.floor(diffs.length * 0.99)].toFixed(3)} m over ${diffs.length} vertices`,
      )
      expect(diffs.length).toBeGreaterThan(1000)
      expect(diffs[diffs.length >> 1]).toBeLessThan(0.05)
    })

    it('writes LongRoad, a 4-million-cell terrain clipped to its 27.8 km road, as a project RoadEng-sized', () => {
      const opened = roadEngProject(
        [sample('LongRoad_1/LongRoad 1.dsnx'), sample('LongRoad_1/LongRoad 1.terx')],
        sampleOptions,
      )
      const grid = proj4('EPSG:4326', projectedCrsDefinition(opened.epsg)!)
      const road = opened.roads[0].alignment
      const raster = opened.terrain.raster!
      expect(raster.width * raster.height).toBeGreaterThan(3_000_000)
      const started = performance.now()
      const out = roadEngTerrainArchive({
        raster,
        corridor: { lines: [road.points.map((p) => grid.forward([...p.coordinate]) as XY)], halfWidthM: 100 },
        coordSys: { epsg: opened.epsg },
      })
      const elapsed = performance.now() - started
      console.info(
        `LongRoad terrain: ${(raster.width * raster.height).toLocaleString('en-CA')} cells of ` +
          `${raster.pixelSize[0].toFixed(2)} m -> ${out.ground!.vertices.toLocaleString('en-CA')} points, ` +
          `${out.ground!.triangles.toLocaleString('en-CA')} triangles (stride ${out.ground!.stride}) in ` +
          `${elapsed.toFixed(0)} ms, ${(out.bytes.length / 1e6).toFixed(1)} MB zipped. ${out.notes.join(' ')}`,
      )
      expect(out.ground!.vertices).toBeLessThanOrEqual(250_000)
      const read = readRoadEngTerrainArchive(out.bytes)
      expect(read.warnings).toHaveLength(1)
      expect(read.coordSys.epsg).toBe(26915)

      // A full 4,194,304-cell grid over the road's extent (LongRoad's own holds levels only near the
      // road), clipped to corridors of two widths: the export's cost at the workspace's cell limit.
      const xs = road.points.map((pt) => grid.forward([...pt.coordinate])[0]),
        ys = road.points.map((pt) => grid.forward([...pt.coordinate])[1])
      const [x0, x1, y0, y1] = [
        Math.min(...xs) - 500,
        Math.max(...xs) + 500,
        Math.min(...ys) - 500,
        Math.max(...ys) + 500,
      ]
      const cell = Math.sqrt(((x1 - x0) * (y1 - y0)) / 4_194_304)
      const width = Math.floor((x1 - x0) / cell),
        height = Math.floor(4_194_304 / width)
      const values: number[] = new Array(width * height)
      for (let r = 0; r < height; r++)
        for (let c = 0; c < width; c++)
          values[r * width + c] = Math.round((300 + 20 * Math.sin(c / 70) * Math.cos(r / 90)) * 1000) / 1000
      const full = {
        origin: [x0 + cell / 2, y1 - cell / 2] as [number, number],
        pixelSize: [cell, -cell] as [number, number],
        width,
        height,
        values,
      }
      for (const halfWidthM of [100, 500]) {
        const t0 = performance.now()
        const big = roadEngTerrainArchive({
          raster: full,
          corridor: { lines: [road.points.map((pt) => grid.forward([...pt.coordinate]) as XY)], halfWidthM },
          coordSys: { epsg: opened.epsg },
        })
        const ms = performance.now() - t0
        const ter = unzipSync(big.bytes)['Terrain1.ter'].length
        console.info(
          `${(width * height).toLocaleString('en-CA')} cells of ${cell.toFixed(2)} m, ${halfWidthM} m either side of ${(alignmentLength(road) / 1000).toFixed(1)} km: ` +
            `${ms.toFixed(0)} ms, ${(big.bytes.length / 1e6).toFixed(1)} MB zipped (${(ter / 1e6).toFixed(1)} MB .ter). ${big.notes.join(' ')}`,
        )
        expect(big.ground!.vertices).toBeLessThanOrEqual(250_000)
        expect(readRoadEngTerrainArchive(big.bytes).warnings).toHaveLength(1)
      }

      // And back as a project: the road on its ground.
      const files = roadEngProjectFileNames('LongRoad 1')
      const design = roadEngDesign([{ alignment: road }], (c) => grid.forward([...c]) as XY, {
        terrainName: files.terrain,
      }).bytes
      const p = roadEngProject(
        [{ name: files.zip, bytes: roadEngProjectZip({ name: 'LongRoad 1', design, terrain: out.bytes }) }],
        sampleOptions,
      )
      expect(p.epsg).toBe(26915)
      expect(p.roads).toHaveLength(1)
      // The road as RoadEng designed it, on the ground written back: as complete as on RoadEng's TIN.
      const complete = (terrain: typeof p.terrain) => {
        const analysis = analyzeRoad(road, terrainFromMetadata(terrain)!, DEFAULT_ROAD_SETTINGS)
        return analysis.completeLength / analysis.length
      }
      expect(complete(p.terrain)).toBeGreaterThanOrEqual(complete(opened.terrain) - 0.001)
      expect(complete(p.terrain)).toBeGreaterThan(0.99)
    })
  },
)
