import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { alignmentLength, analyzeRoad, distance, offsetCoordinate } from './engine'
import proj4 from 'proj4'
import { projectedCrsDefinition } from '@/lib/geo/projectedCrs'
import { centreSurfacingM, roadEngDesign } from './roadEngExport'
import { isRoadEngDesign, parseRoadEngDesign, roadEngRoads } from './roadEngImport'
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

  it('writes a spiralled curve through the same tangent points, and says so', () => {
    const spiralled = { ...road, points: road.points.map((p, k) => (k === 2 ? { ...p, spiralM: 20 } : p)) }
    const out = roadEngDesign([{ alignment: spiralled }], grid.toGrid)
    expect(out.notes.join(' ')).toMatch(
      /1 spiralled curve is written as a simple curve through the same tangent points/,
    )
    const [a] = parseRoadEngDesign(out.bytes).alignments
    expect(a.pis[1].radiusM).toBeGreaterThan(50)
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
})
