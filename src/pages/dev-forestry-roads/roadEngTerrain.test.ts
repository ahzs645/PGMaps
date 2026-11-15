import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { parseRoadEngDesign } from './roadEngImport'
import {
  classifyRoadEngFeature,
  isRoadEngTerrain,
  parseRoadEngCoordSys,
  parseRoadEngTer,
  readRoadEngTerrainArchive,
  roadEngLayerMatches,
} from './roadEngTerrain'

import {
  buildTer,
  chunk,
  planLength,
  Writer,
  type SynthFeature,
  type SynthTin,
  type XYZ,
} from './roadEngTerrain.testkit'

const square: XYZ[] = [
  [1000, 2000, 500],
  [1010, 2000, 500.2],
  [1010, 2010, 500.2],
  [1000, 2010, 500],
]
const synthFeatures: SynthFeature[] = [
  { name: 'Lidar', points: square, flags: 0x09, subId: 7 },
  {
    name: 'CNTR',
    points: [
      [1001, 2000, 500.02],
      [1001, 2010, 500.02],
    ],
    flags: 0x40,
    colorRef: 0xcccccc,
    kind: 2,
  },
  {
    name: 'bound',
    points: [...square, square[0]].map(([x, y, z]) => [x, y, z] as XYZ),
    flags: 0xc2,
    colorRef: 0x000080,
  },
  {
    name: 'C-Line',
    points: [
      [1002, 2001, 500.04],
      [1003, 2005, 500.06],
      [1004, 2009, 500.08],
    ],
    flags: 0x40,
    origin: -25,
    colorRef: 0x0000ff,
  },
  { name: 'Landing', points: [[1005, 2005, 500.1]] },
  {
    name: 'contours',
    points: [
      [1000, 2004, 500],
      [1006, 2004, 500],
      [1006, 2008, 500],
      [1000, 2004, 500],
    ],
  },
]
// Stored clockwise (x east, y north): (0, 3, 2) and (0, 2, 1) of the square, as RoadEng writes them.
const synthTin: SynthTin = {
  vertices: [
    [0, 0],
    [0, 1],
    [0, 2],
    [0, 3],
  ],
  triangles: [
    [0, 3, 2],
    [0, 2, 1],
  ],
}
const schema = strToU8(
  '7000|1|0|4|General|General|0|0|Features Tot.|Features Tot.|_UNITS_UDF|7|0\n' +
    '10000|2|0|1|contours|contours|1|1|XCONTOUR__|XCONTOUR__|_UNITS_UDF|0|0|XLENGTH___|XLENGTH___|_UNITS_UDF|0|0\0',
  true,
)
const group = (index: number, name: string) => {
  const w = new Writer()
  w.i32(index)
  w.str(name, 256)
  w.u32(0)
  w.u32(0)
  return w.bytes
}
const synthAttributes = [
  ...chunk(100, -1, schema),
  ...chunk(52, -1, group(-1, '%$^**&@')),
  ...chunk(52, 5, group(5, 'contours from the 1:5000 sheet')),
  ...chunk(10000, -1, strToU8('-3.40282e+038|3.40282e+038\n2|500|20.94\0', true)),
]
const synthTer = () => buildTer({ features: synthFeatures, tin: synthTin, attributes: synthAttributes })

const signedArea = (xy: Float64Array, t: Uint32Array, k: number) => {
  const [a, b, c] = [t[3 * k], t[3 * k + 1], t[3 * k + 2]]
  return (
    (xy[2 * b] - xy[2 * a]) * (xy[2 * c + 1] - xy[2 * a + 1]) -
    (xy[2 * b + 1] - xy[2 * a + 1]) * (xy[2 * c] - xy[2 * a])
  )
}

describe('parseRoadEngTer framing', () => {
  it('reads a well-framed file', () => {
    expect(parseRoadEngTer(synthTer()).features).toHaveLength(6)
  })
  it('refuses a truncated file', () => {
    const bytes = synthTer()
    expect(() => parseRoadEngTer(bytes.subarray(0, bytes.length - 10))).toThrow(/truncated or damaged/)
    expect(() => parseRoadEngTer(bytes.subarray(0, 100))).toThrow(/too short/)
  })
  it('refuses a version it has not been checked against', () => {
    expect(() => parseRoadEngTer(buildTer({ features: synthFeatures, version: 11 }))).toThrow(/format version is 11/)
  })
  it('refuses a feature table that does not fill its section', () => {
    const bytes = synthTer()
    new DataView(bytes.buffer).setUint32(0x26, 5, true)
    expect(() => parseRoadEngTer(bytes)).toThrow(/lists 5 features/)
  })
  it('refuses a TIN that points outside the features', () => {
    const bad = buildTer({
      features: synthFeatures,
      tin: {
        ...synthTin,
        vertices: [
          [0, 0],
          [0, 1],
          [0, 9],
          [0, 3],
        ],
      },
    })
    expect(() => parseRoadEngTer(bad)).toThrow(/TIN vertex 5/)
  })
})

describe('parseRoadEngTer content', () => {
  const terrain = parseRoadEngTer(synthTer())
  const [lidar, cntr, bound, cLine, landing, contours] = terrain.features
  it('reads names, types, points and stated figures', () => {
    expect(terrain.version).toBe(12)
    expect(terrain.codes).toEqual(['Sml Stream', 'Road CL', 'Landing'])
    expect(terrain.bbox).toEqual([1000, 1010, 2000, 2010, 500, 500.2])
    expect(terrain.features.map((f) => f.type)).toEqual(['points', 'line', 'polygon', 'line', 'point', 'closed-line'])
    expect([...lidar.points]).toEqual(square.flat())
    expect(lidar.subId).toBe(7)
    expect(cLine.stationOrigin).toBe(-25)
    expect(cLine.lengthM).toBeCloseTo(
      planLength([
        [1002, 2001, 0],
        [1003, 2005, 0],
        [1004, 2009, 0],
      ]),
      9,
    )
    expect(cntr.kind).toBe(2)
    expect(terrain.warnings).toEqual([])
  })
  it('turns Windows colours into 0xRRGGBB and leaves an unset colour null', () => {
    expect(cLine.color).toBe(0xff0000)
    expect(bound.color).toBe(0x800000)
    expect(cntr.color).toBe(0xcccccc)
    expect(landing.color).toBeNull()
  })
  it('reads the user-table attributes and long name of the feature that has them', () => {
    expect(contours.name).toBe('contours from the 1:5000 sheet')
    expect(contours.attributes).toEqual({ XCONTOUR__: '500', XLENGTH___: '20.94' })
    expect(lidar.attributes).toBeUndefined()
  })
  it('resolves the TIN to its points and writes it counter-clockwise', () => {
    const tin = terrain.tin!
    expect(tin.z.length).toBe(4)
    expect([...tin.coords]).toEqual(square.flatMap(([x, y]) => [x, y]))
    expect([...tin.z]).toEqual(square.map((p) => p[2]))
    expect(tin.triangles.length).toBe(6)
    for (let k = 0; k < 2; k++) expect(signedArea(tin.coords, tin.triangles, k)).toBeGreaterThan(0)
    expect(tin.maxSideM).toBe(150)
    expect(terrain.features.map((f) => f.inTin)).toEqual([true, false, false, false, false, false])
  })
  it('reads a terrain with no TIN', () => {
    expect(parseRoadEngTer(buildTer({ features: synthFeatures })).tin).toBeNull()
  })
})

const tlt = (coordSys: string) =>
  [
    '[main]',
    `CoordSys=${coordSys}`,
    'units=10000',
    '[TerLayers]',
    'Layer1=ROAD????,Roads,',
    'Layer0=CNTR*,Contours from model,',
    'Layer2=BOUND*,Boundary,',
    'Layer3=CONTOURS,contours,',
  ].join('\r\n')
const archive = (coordSys: string) =>
  zipSync({ 'Terrain1.ter': synthTer(), 'Terrain1.te1': strToU8('AC1014'), 'Terrain1.tlt': strToU8(tlt(coordSys)) })

describe('readRoadEngTerrainArchive', () => {
  it('knows a terrain archive by its content', () => {
    expect(isRoadEngTerrain(archive('1|51|10010').subarray(0, 64))).toBe(true)
    expect(isRoadEngTerrain(zipSync({ 'Location1.dsn': strToU8('[design]') }).subarray(0, 64))).toBe(false)
    expect(isRoadEngTerrain(synthTer().subarray(0, 64))).toBe(false)
  })
  it('reads the terrain, its coordinate system and its layers in order', () => {
    const read = readRoadEngTerrainArchive(archive('1|51|10010'))
    expect(read.terrain.features).toHaveLength(6)
    expect(read.coordSys).toMatchObject({ epsg: 26910, source: 'code' })
    expect(read.layers).toEqual([
      { pattern: 'CNTR*', description: 'Contours from model' },
      { pattern: 'ROAD????', description: 'Roads' },
      { pattern: 'BOUND*', description: 'Boundary' },
      { pattern: 'CONTOURS', description: 'contours' },
    ])
    expect(read.warnings[0]).toMatch(
      /^Read 6 features with 19 points and a TIN of 4 vertices and 2 triangles from 1 feature\./,
    )
    expect(read.warnings.join(' ')).toMatch(/UTM zone 10N \(EPSG 26910\), from RoadEng code 1\|51\|10010\./)
  })
  it('asks for a coordinate system when the terrain names none', () => {
    expect(readRoadEngTerrainArchive(archive('1|-1|-1')).warnings.join(' ')).toMatch(/names no coordinate system/)
  })
  it('refuses an archive with no terrain in it', () => {
    expect(() => readRoadEngTerrainArchive(zipSync({ 'Terrain1.tlt': strToU8(tlt('1|-1|-1')) }))).toThrow(
      /no Terrain1.ter/,
    )
    expect(() => readRoadEngTerrainArchive(new Uint8Array([1, 2, 3]))).toThrow(/could not be unpacked/)
  })
  it('classifies features by flags, names and layer patterns', () => {
    const { terrain, layers } = readRoadEngTerrainArchive(archive('1|-1|-1'))
    expect(terrain.features.map((f) => classifyRoadEngFeature(f, layers))).toEqual([
      'mass-points',
      'contour',
      'tin-boundary',
      'road',
      'landing',
      'other', // 'contours' is renamed by its group and supplies no TIN vertex here
    ])
    const base = terrain.features[0]
    const as = (name: string, extra: Partial<typeof base> = {}) =>
      classifyRoadEngFeature({ ...base, name, flags: 0, type: 'line', ...extra }, layers)
    expect(as('Med Stream')).toBe('stream')
    expect(as('ROAD12')).toBe('road')
    expect(as('Falling BDY')).toBe('boundary')
    expect(as('BOUND')).toBe('boundary')
    expect(as('D-Line')).toBe('d-line')
    expect(as('Rock Bluff')).toBe('rock-bluff')
    expect(as('contours', { bbox: [0, 1, 0, 1, 300, 300], inTin: true })).toBe('source-contour')
  })
  it('matches RoadEng layer wildcards', () => {
    expect(roadEngLayerMatches('ROAD????', 'ROAD')).toBe(true)
    expect(roadEngLayerMatches('ROAD????', 'road12')).toBe(true)
    expect(roadEngLayerMatches('ROAD????', 'ROAD12345')).toBe(false)
    expect(roadEngLayerMatches('CNTR*', 'CNTRM')).toBe(true)
    expect(roadEngLayerMatches('CNTR', 'CNTRM')).toBe(false)
  })
})

describe('parseRoadEngCoordSys', () => {
  it('takes the EPSG code from a WKT projection, not from its datum', () => {
    const wkt =
      'PROJCS["NAD_1983_UTM_Zone_15N",GEOGCS["GCS_North_American_1983",DATUM["North_American_Datum_1983",' +
      'SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433],' +
      'AUTHORITY["EPSG","4269"]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],' +
      'PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-93.0],PARAMETER["Scale_Factor",0.9996],' +
      'PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0],AUTHORITY["EPSG","26915"]]'
    expect(parseRoadEngCoordSys(`CoordSys=10000|51|10015|${wkt}|0`)).toEqual({
      raw: `10000|51|10015|${wkt}|0`,
      epsg: 26915,
      wkt,
      source: 'wkt',
    })
  })
  it('reads a RoadEng UTM code without WKT', () => {
    expect(parseRoadEngCoordSys('1|51|10010')).toEqual({ raw: '1|51|10010', epsg: 26910, wkt: null, source: 'code' })
  })
  it('names nothing for an unset system or a code it does not know', () => {
    expect(parseRoadEngCoordSys('1|-1|-1')).toEqual({ raw: '1|-1|-1', epsg: null, wkt: null, source: 'none' })
    expect(parseRoadEngCoordSys('1|52|10010').source).toBe('none')
    expect(parseRoadEngCoordSys('1|51|10099').source).toBe('none')
    expect(parseRoadEngCoordSys('').source).toBe('none')
  })
})

// Softree's published sample projects (support.softree.com), read from a local copy and never
// committed: set ROADENG_SAMPLES to the folder holding the extracted archives.
const samples = process.env.ROADENG_SAMPLES
const sample = (path: string) => new Uint8Array(readFileSync(join(samples!, path)))

/** contours.SHP: PolyLine records (type 3), one part each in this sample. */
function shpVertexCounts(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const records: { xy: number[] }[] = []
  for (let o = 100; o < bytes.length; ) {
    const length = view.getInt32(o + 4, false) * 2
    const body = o + 8
    const parts = view.getInt32(body + 36, true)
    const n = view.getInt32(body + 40, true)
    const p0 = body + 44 + 4 * parts
    const xy: number[] = []
    for (let k = 0; k < 2 * n; k++) xy.push(view.getFloat64(p0 + 8 * k, true))
    records.push({ xy })
    o = body + length
  }
  return records
}
function dbfColumn(bytes: Uint8Array, column: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint32(4, true)
  const headerLength = view.getUint16(8, true)
  const recordLength = view.getUint16(10, true)
  let offset = 1
  let width = 0
  for (let o = 32; bytes[o] !== 0x0d; o += 32) {
    const name = new TextDecoder('latin1').decode(bytes.subarray(o, o + 11)).replace(/\0.*$/, '')
    if (name === column) {
      width = bytes[o + 16]
      break
    }
    offset += bytes[o + 16]
  }
  return Array.from({ length: count }, (_, i) => {
    const at = headerLength + i * recordLength + offset
    return new TextDecoder('latin1').decode(bytes.subarray(at, at + width)).trim()
  })
}

describe.skipIf(!samples || !existsSync(samples))('Softree sample terrains', () => {
  const read = (path: string) => readRoadEngTerrainArchive(sample(path))
  const counts = (path: string) => {
    const { terrain } = read(path)
    return {
      features: terrain.features.length,
      points: terrain.features.reduce((s, f) => s + f.points.length / 3, 0),
      tinVertices: terrain.tin?.z.length ?? 0,
      tinTriangles: (terrain.tin?.triangles.length ?? 0) / 3,
      inTin: terrain.features.filter((f) => f.inTin).length,
    }
  }
  it('reads all four samples with the counts the format study found', () => {
    expect(counts('Cul-de-sac-design/CulDeSacExample/R_L_Shoulders.terx')).toEqual({
      features: 2,
      points: 72,
      tinVertices: 0,
      tinTriangles: 0,
      inTin: 0,
    })
    expect(counts('Cul-de-sac-design/CulDeSacExample/RangeRoadTopo.terx')).toEqual({
      features: 141,
      points: 33_028,
      tinVertices: 13_636,
      tinTriangles: 26_905,
      inTin: 24,
    })
    expect(counts('Road-location-using-GIS/contour.terx')).toEqual({
      features: 141,
      points: 11_013,
      tinVertices: 11_013,
      tinTriangles: 21_595,
      inTin: 141,
    })
  })
  it('reads the 16 MB LongRoad terrain quickly, with every triangle counter-clockwise', () => {
    const bytes = sample('LongRoad_1/LongRoad 1.terx')
    const started = performance.now()
    const { terrain, coordSys, warnings } = readRoadEngTerrainArchive(bytes)
    const elapsed = performance.now() - started
    console.info(`LongRoad 1.terx read in ${elapsed.toFixed(0)} ms`)
    expect(elapsed).toBeLessThan(2000)
    expect(terrain.features).toHaveLength(18_266)
    expect(terrain.features.reduce((s, f) => s + f.points.length / 3, 0)).toBe(170_321)
    const tin = terrain.tin!
    expect([tin.z.length, tin.triangles.length / 3]).toEqual([100_372, 198_340])
    expect(terrain.features.filter((f) => f.inTin)).toHaveLength(15_874)
    let clockwise = 0
    for (let k = 0; k < tin.triangles.length / 3; k++) if (signedArea(tin.coords, tin.triangles, k) <= 0) clockwise++
    expect(clockwise).toBe(0)
    expect(tin.maxSideM).toBeNull()
    expect(coordSys).toMatchObject({ epsg: 26915, source: 'wkt' })
    expect(warnings.slice(1)).toEqual([])
  })
  it('classifies the LongRoad features', () => {
    const { terrain, layers } = read('LongRoad_1/LongRoad 1.terx')
    const tally: Record<string, number> = {}
    for (const f of terrain.features) {
      const c = classifyRoadEngFeature(f, layers)
      tally[c] = (tally[c] ?? 0) + 1
    }
    expect(tally).toEqual({ 'mass-points': 15_874, contour: 2391, 'tin-boundary': 1 })
  })
  it('repeats contours.SHP vertex for vertex, at the elevation its DBF gives', () => {
    const { terrain, layers, coordSys } = read('Road-location-using-GIS/contour.terx')
    const shp = shpVertexCounts(sample('Road-location-using-GIS/contours.SHP'))
    const dbf = sample('Road-location-using-GIS/contours.DBF')
    const elevations = dbfColumn(dbf, 'XCONTOUR__')
    const lengths = dbfColumn(dbf, 'XLENGTH___')
    expect(terrain.features).toHaveLength(shp.length)
    terrain.features.forEach((f, i) => {
      const n = f.points.length / 3
      expect(n).toBe(shp[i].xy.length / 2)
      for (let k = 0; k < n; k++) {
        expect(f.points[3 * k]).toBe(shp[i].xy[2 * k])
        expect(f.points[3 * k + 1]).toBe(shp[i].xy[2 * k + 1])
        expect(f.points[3 * k + 2]).toBe(Number(elevations[i]))
      }
      expect(f.attributes).toEqual({ XCONTOUR__: elevations[i], XLENGTH___: lengths[i] })
      expect(Math.abs(f.lengthM - Number(lengths[i]))).toBeLessThan(0.006)
      expect(classifyRoadEngFeature(f, layers)).toBe('source-contour')
    })
    expect(coordSys).toMatchObject({ epsg: 26910, source: 'code' })
  })
  it("lays R_L_Shoulders' C-Line on the stations of the cul-de-sac's Location2", () => {
    const { terrain, layers } = read('Cul-de-sac-design/CulDeSacExample/R_L_Shoulders.terx')
    const design = parseRoadEngDesign(sample('Cul-de-sac-design/CulDeSacExample/CulDeSacExampleComplete.dsnx'))
    const location2 = design.alignments.find((a) => a.part === 'Location2')!
    expect(location2.stations).toHaveLength(71)
    const matched = new Set<number>()
    for (const f of terrain.features) {
      expect(f.name).toBe('C-Line')
      expect(f.stationOrigin).toBeCloseTo(location2.startStation, 9)
      expect(classifyRoadEngFeature(f, layers)).toBe('road')
      for (let k = 0; k < f.points.length; k += 3) {
        let best = Infinity,
          at = -1
        location2.stations.forEach((s, j) => {
          const d = Math.hypot(s.xy[0] - f.points[k], s.xy[1] - f.points[k + 1])
          if (d < best) [best, at] = [d, j]
        })
        expect(best).toBeLessThan(1e-5)
        expect(Math.abs(location2.stations[at].z - f.points[k + 2])).toBeLessThan(1e-6)
        matched.add(at)
      }
    }
    expect(matched.size).toBe(71)
  })
})
