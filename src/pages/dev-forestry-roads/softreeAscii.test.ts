import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { analyzeRoad, offsetCoordinate } from './engine'
import { classifyRoadEngFeature, readRoadEngTerrainArchive } from './roadEngTerrain'
import {
  inferSoftreeLocationLayout,
  isSoftreeLocationAscii,
  isSoftreeTerrainAscii,
  parseSoftreeLocationAscii,
  parseSoftreeTerrainAscii,
  pgmapsPointCode,
  SOFTREE_LOCATION_DEFAULT_LAYOUT,
  softreeLocationCentreline,
  softreeLocationStationsFromAnalysis,
  softreeTerrainAsciiTerrain,
  writeSoftreeLocationAscii,
  writeSoftreeTerrainAscii,
  type SoftreeLocationLayout,
  type SoftreeTerrainAsciiWriteFeature,
} from './softreeAscii'
import type { Alignment, Coordinate, RoadSettings } from './types'

const crlf = (lines: string[]) => lines.join('\r\n') + '\r\n'

// Lines in the layout of the help's "All Surfaces Export" example (values as printed there).
const allSurfaces = [
  '0.00,0.00,SG,15.60,-6.85,100.00,SSL,-15.84,0.35',
  '0.00,0.00,SG,12.99,-5.70,97.15,DIL,-12.99,-2.50',
  '0.00,0.00,SG,10.26,-4.50,99.15,REL,-10.00,-0.50',
  '0.00,0.00,SG,1.11,-0.47,99.65,CL,0.00,0.00',
  '0.00,0.00,SG,-8.05,3.56,99.15,RER,10.00,-0.50',
  '0.00,0.00,SG,-10.78,4.76,97.15,-,12.99,-2.50',
  '0.00,0.00,SG,-13.39,5.91,100.00,SSR,15.84,0.35',
  '0.00,0.00,SRF1,10.26,-4.50,99.15,SB1L,-10.00,-0.50',
  '0.00,0.00,SRF1,8.73,-3.82,99.98,ST1L,-8.32,0.33',
  '0.00,0.00,SRF1,1.11,-0.47,100.40,CL,0.00,0.75',
  '0.00,0.00,SRF1,-6.51,2.88,99.98,ST1R,8.32,0.33',
]
// The help's topo (B.C. MOT, MTS) example layout: static text, sequence number, flag, three numbers.
const mts = ['X,1,OG,0.00,-66.20,496.08', 'X,2,OG,0.00,-66.16,496.05', 'X,3,OG,0.00,-64.85,495.22']
const terrainLines = [
  'Creek-21,0.000,1000.000,2000.000,500.000,culvert here',
  'Creek-21,10.000,1006.000,2008.000,499.000,',
  'Creek-21,20.000,1012.000,2016.000,498.500,',
  'Spot-1,0.000,1100.000,2100.000,510.250,benchmark',
]

describe('Softree terrain ASCII', () => {
  it('reads features by name and sub ID, with stations and comments', () => {
    const file = parseSoftreeTerrainAscii(crlf(terrainLines))
    expect(file.delimiter).toBe(',')
    expect(file.unitM).toBeNull()
    expect(file.epsg).toBeNull()
    expect(file.features.map((f) => [f.name, f.subId, f.type])).toEqual([
      ['Creek', 21, 'line'],
      ['Spot', 1, 'point'],
    ])
    const creek = file.features[0]
    expect([...creek.points]).toEqual([1000, 2000, 500, 1006, 2008, 499, 1012, 2016, 498.5])
    expect(creek.lengthM).toBeCloseTo(20, 9)
    expect(creek.comments).toEqual(['culvert here', '', ''])
    expect(file.bbox).toEqual([1000, 1100, 2000, 2100, 498.5, 510.25])
    expect(file.warnings).toEqual([])
  })

  it('round-trips lines, points, point sets, closed lines, hyphenated names and delimiters in text', () => {
    const features: SoftreeTerrainAsciiWriteFeature[] = [
      { name: 'Road CL - Spur 3', subId: 1, points: [0, 0, 1, 30, 40, 2, 30, 100, 3], stationOrigin: 902.5 },
      { name: 'Sml Stream', subId: 2, points: [5, 5, 10, 15, 5, 9.5], comments: ['a, b', 'c'] },
      { name: 'LiDAR', subId: 1, type: 'points', points: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
      { name: 'Landing', subId: 1, points: [0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 0, 0] },
      { name: 'Peg 4', subId: 7, points: [1.5, 2.5, 3.5] },
    ]
    for (const delimiter of [',', '\t', ';'] as const) {
      const { text } = writeSoftreeTerrainAscii(features, { delimiter })
      expect(isSoftreeTerrainAscii(text)).toBe(true)
      const back = parseSoftreeTerrainAscii(text)
      expect(back.delimiter).toBe(delimiter)
      expect(back.features.map((f) => [f.name, f.subId, f.type])).toEqual([
        ['Road CL - Spur 3', 1, 'line'],
        ['Sml Stream', 2, 'line'],
        ['LiDAR', 1, 'points'],
        ['Landing', 1, 'closed-line'],
        ['Peg 4', 7, 'point'],
      ])
      back.features.forEach((f, i) => expect([...f.points]).toEqual(features[i].points))
      expect(back.features[0].stationOrigin).toBe(902.5)
      expect([...back.features[0].stations]).toEqual([902.5, 952.5, 1012.5])
      expect(back.features[1].comments).toEqual([delimiter === ',' ? 'a~ b' : 'a, b', 'c'])
      // Written again from what was read, the text is the same.
      expect(writeSoftreeTerrainAscii(back.features, { delimiter }).text).toBe(text)
    }
  })

  it('classes features read from ASCII as a .terx would be classed', () => {
    const { text } = writeSoftreeTerrainAscii([
      { name: 'Sml Stream', subId: 1, points: [0, 0, 1, 10, 0, 1] },
      { name: 'LiDAR', subId: 1, type: 'points', points: [1, 2, 3, 4, 5, 6] },
      { name: 'Road CL', subId: 1, points: [0, 0, 1, 10, 10, 1] },
    ])
    const terrain = softreeTerrainAsciiTerrain(parseSoftreeTerrainAscii(text))
    expect(terrain.tin).toBeNull()
    expect(terrain.features.map((f) => classifyRoadEngFeature(f, []))).toEqual(['stream', 'mass-points', 'road'])
  })

  it('keeps a header line and stations that are not plan distances, and says so', () => {
    const file = parseSoftreeTerrainAscii(
      crlf(['Name\tStation\tX\tY\tZ\tComment', 'Edge-1\t0\t0\t0\t0\t', 'Edge-1\t12\t3\t4\t0\t', 'Pt\t0\t9\t9\t9\t']),
    )
    expect(file.header).toBe('Name\tStation\tX\tY\tZ\tComment')
    expect([...file.features[0].stations]).toEqual([0, 12])
    expect(file.warnings.join(' ')).toMatch(/1 features have stations that are not their plan distances/)
    expect(file.warnings.join(' ')).toMatch(/1 lines name no sub ID/)
    expect(file.features[1]).toMatchObject({ name: 'Pt', subId: 0 })
  })

  it('is told apart from the other Softree text files by its content', () => {
    expect(isSoftreeTerrainAscii(crlf(terrainLines))).toBe(true)
    expect(isSoftreeTerrainAscii(crlf(allSurfaces))).toBe(false)
    expect(isSoftreeTerrainAscii(crlf(mts))).toBe(false)
    expect(isSoftreeTerrainAscii('V2.900 Main# T23\r\n0.000,259.000,,16.000,16.051,8.000\r\n')).toBe(false)
    expect(isSoftreeTerrainAscii('TRAV1,SR,1420,2230,1311,BM1\r\n')).toBe(false)
    expect(isSoftreeTerrainAscii('1,2,3\r\n')).toBe(false)
    expect(() => parseSoftreeTerrainAscii('x,y\r\n')).toThrow(/not a Softree terrain ASCII/)
  })
})

describe('Softree location ASCII coordinate file', () => {
  it('recognises the all-surfaces layout and reads the section, offsets negative left', () => {
    const text = crlf(allSurfaces)
    expect(isSoftreeLocationAscii(text)).toBe(true)
    const file = parseSoftreeLocationAscii(text)
    expect(file.inferred).toBe(true)
    expect(file.layout).toEqual(SOFTREE_LOCATION_DEFAULT_LAYOUT)
    expect(file.unitM).toBeNull()
    expect(file.epsg).toBeNull()
    expect(file.stations).toHaveLength(1)
    const [s] = file.stations
    expect(s.lStation).toBe(0)
    expect(s.points).toHaveLength(11)
    expect(s.points[5].code).toBeNull()
    expect(s.points.find((p) => p.code === 'SSL')).toMatchObject({ flag: 'SG', hOffset: -15.84, vOffset: 0.35 })
    // The slope stake lies 15.84 from the centreline, as its offset says.
    expect(Math.hypot(15.6 - 1.11, -6.85 + 0.47)).toBeCloseTo(15.84, 1)
    expect(softreeLocationCentreline(file)).toEqual([{ station: 0, x: 1.11, y: -0.47, z: { SG: 99.65, SRF1: 100.4 } }])
    // Written back at the help's two decimals, it is the same text.
    expect(writeSoftreeLocationAscii(file.stations, file.layout, { decimals: 2 })).toBe(text)
  })

  it('recognises the MTS topo layout (static text, sequence, flag, X, Y, Z)', () => {
    const text = crlf(mts)
    const layout = inferSoftreeLocationLayout(text)
    expect(layout?.fields).toEqual(['static', 'sequence', 'flag', 'x', 'y', 'z'])
    const file = parseSoftreeLocationAscii(text)
    expect(file.stations.map((s) => s.sequence)).toEqual([1, 2, 3])
    expect(file.stations[0]).toMatchObject({ staticText: 'X', points: [{ flag: 'OG', x: 0, y: -66.2, z: 496.08 }] })
    expect(file.warnings.join(' ')).toMatch(/no stations/)
    expect(writeSoftreeLocationAscii(file.stations, file.layout, { decimals: 2 })).toBe(text)
  })

  it('round-trips a single line per station in a given layout', () => {
    const layout: SoftreeLocationLayout = {
      fields: ['lStation', 'code', 'flag', 'hOffset', 'z', 'x', 'y'],
      singleLine: true,
      delimiter: ';',
    }
    const stations = parseSoftreeLocationAscii(crlf(allSurfaces)).stations
    stations.push({ ...stations[0], pStation: 20, lStation: 20 })
    const text = writeSoftreeLocationAscii(stations, layout)
    expect(text.split('\r\n')[0].split(';')).toHaveLength(1 + 11 * 6)
    const back = parseSoftreeLocationAscii(text, layout)
    expect(back.inferred).toBe(false)
    expect(back.stations.map((s) => [s.lStation, s.points.length])).toEqual([
      [0, 11],
      [20, 11],
    ])
    expect(back.stations[1].points[3]).toEqual({ ...stations[0].points[3], vOffset: null })
  })

  it('refuses a layout without a flag and a file whose fields it cannot recognise', () => {
    expect(() => writeSoftreeLocationAscii([], { fields: ['x', 'y', 'z'], singleLine: false, delimiter: ',' })).toThrow(
      /surface flag/,
    )
    expect(() => parseSoftreeLocationAscii('1,2,3\r\n')).toThrow(/choose its fields/)
    expect(isSoftreeLocationAscii(crlf(terrainLines))).toBe(false)
  })

  it('writes a PGMaps road’s stations with RoadEng codes, and reads them back on the same geometry', () => {
    const origin: Coordinate = [-122.8, 53.9]
    const settings: RoadSettings = {
      stationInterval: 10,
      crossSectionHalfWidth: 30,
      maxGradePercent: 12,
      minRadius: 25,
      cutRate: 2,
      fillRate: 3,
      surfacingRate: 4,
      clearingRate: 0.5,
      shrinkFactor: 0.8,
    }
    const alignment: Alignment = {
      id: 'loc',
      name: 'Location',
      color: '#16817a',
      points: [
        { id: 'a', coordinate: origin, radiusM: 0 },
        { id: 'b', coordinate: offsetCoordinate(origin, 60, 100), radiusM: 0 },
      ],
      vertical: [
        { id: 'v0', chainage: 0, elevation: 99, curveLength: 0 },
        { id: 'v1', chainage: 100, elevation: 99, curveLength: 0 },
      ],
      template: {
        leftWidth: 3,
        rightWidth: 4,
        crossfallPercent: 2,
        cutSlope: 1,
        fillSlope: 1.5,
        ditchWidth: 2,
        ditchDepth: 0.5,
        surfaceDepth: 0.2,
      },
      overrides: [],
    }
    const analysis = analyzeRoad(alignment, { elevationAt: () => 100 }, settings)
    const R = 6_371_008.8,
      rad = Math.PI / 180
    const toGrid = (c: Coordinate): [number, number] => [
      500_000 + (c[0] - origin[0]) * rad * R * Math.cos(origin[1] * rad),
      5_970_000 + (c[1] - origin[1]) * rad * R,
    ]
    const stations = softreeLocationStationsFromAnalysis(analysis.stations, alignment.template, {
      toGrid,
      unitM: 1,
      startStation: 1000,
    })
    const text = writeSoftreeLocationAscii(stations)
    expect(isSoftreeLocationAscii(text)).toBe(true)
    const back = parseSoftreeLocationAscii(text)
    expect(back.stations).toHaveLength(analysis.stations.length)
    const mid = back.stations.find((s) => s.lStation === 1050)!
    const sg = mid.points.filter((p) => p.flag === 'SG')
    expect(sg.map((p) => p.code)).toEqual(['SSL', 'DIL', 'REL', 'CL', 'RER', 'DIR', 'SSR'])
    expect(sg.map((p) => pgmapsPointCode(p.code!))).toContain('left-ditch-bottom')
    const cl = sg.find((p) => p.code === 'CL')!,
      rel = sg.find((p) => p.code === 'REL')!
    expect(cl.vOffset).toBe(0)
    expect(rel.hOffset).toBe(-3)
    expect(Math.hypot(rel.x! - cl.x!, rel.y! - cl.y!)).toBeCloseTo(3, 2)
    // Left of a road heading 60° lies towards 330°.
    expect(Math.atan2(rel.x! - cl.x!, rel.y! - cl.y!) / rad + 360).toBeCloseTo(330, 0)
    const og = mid.points.filter((p) => p.flag === 'OG')
    expect(og.every((p) => p.z === 100)).toBe(true)
    const station = analysis.stations.find((s) => s.chainage === 50)!
    const [x, y] = toGrid(station.coordinate)
    expect(softreeLocationCentreline(back).find((c) => c.station === 1050)).toMatchObject({
      x: Number(x.toFixed(3)),
      y: Number(y.toFixed(3)),
      z: { SG: 99, OG: 100 },
    })
  })
})

// Softree's published sample terrains, read from a local copy and never committed.
const samples = process.env.ROADENG_SAMPLES
describe.skipIf(!samples || !existsSync(samples ?? ''))(
  'Softree sample terrains through terrain ASCII',
  { timeout: 60_000 },
  () => {
    it.each([
      'Road-location-using-GIS/contour.terx',
      'Cul-de-sac-design/CulDeSacExample/RangeRoadTopo.terx',
      'Cul-de-sac-design/CulDeSacExample/R_L_Shoulders.terx',
      'Terrain_cables/CableAnalysis.terx',
    ])('%s keeps every feature’s name, sub ID and points', (path) => {
      const { terrain } = readRoadEngTerrainArchive(new Uint8Array(readFileSync(join(samples!, path))))
      const { text } = writeSoftreeTerrainAscii(terrain.features)
      const back = parseSoftreeTerrainAscii(text)
      // Consecutive features with the same name and sub ID whose stations run on are one feature to
      // RoadEng's ASCII: never more features come back than went in.
      expect(back.features.length).toBeLessThanOrEqual(terrain.features.length)
      expect(back.features.length).toBeGreaterThan(0.9 * terrain.features.length)
      const pointsIn = terrain.features.reduce((n, f) => n + f.points.length, 0)
      expect(back.features.reduce((n, f) => n + f.points.length, 0)).toBe(pointsIn)
      let worst = 0,
        k = 0
      const all = terrain.features.flatMap((f) => [...f.points])
      for (const f of back.features) for (const v of f.points) worst = Math.max(worst, Math.abs(v - all[k++]))
      expect(worst).toBeLessThanOrEqual(0.0005 + 1e-9)
      expect(new Set(back.features.map((f) => `${f.name}-${f.subId}`))).toEqual(
        new Set(terrain.features.map((f) => `${f.name}-${f.subId}`)),
      )
    })
  },
)
