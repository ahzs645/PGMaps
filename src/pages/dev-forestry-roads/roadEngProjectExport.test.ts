import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import proj4 from 'proj4'
import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { projectedCrsDefinition } from '@/lib/geo/projectedCrs'
import { analyzeRoad } from './engine'
import type { XY } from './landXmlImport'
import { localPlaneProjection } from './localPlane'
import { roadEngDesign } from './roadEngExport'
import { roadEngProject } from './roadEngProject'
import { roadEngExportGrid, roadEngProjectExport } from './roadEngProjectExport'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE, terrainFromMetadata } from './terrain'
import type { Alignment, Coordinate } from './types'

const utm10 = proj4('EPSG:4326', projectedCrsDefinition(26910)!)
const lonLat = (x: number, y: number) => utm10.inverse([515_000 + x, 5_975_000 + y]) as Coordinate
const road: Alignment = {
  id: 'r',
  name: 'Spur 7',
  color: '#000000',
  points: [
    { id: 'a', coordinate: lonLat(0, 0), radiusM: 0 },
    { id: 'b', coordinate: lonLat(200, 150), radiusM: 60 },
    { id: 'c', coordinate: lonLat(380, 160), radiusM: 0 },
  ],
  vertical: [],
  template: { ...DEFAULT_TEMPLATE },
  overrides: [],
}
let n = 0
const options = {
  newId: () => `id${n++}`,
  color: () => '#123456',
  template: { ...DEFAULT_TEMPLATE },
  verticalReference: '',
}
const utmGrid = { epsg: 26910, toGrid: (c: Coordinate) => utm10.forward([...c]) as XY }

describe('RoadEng project export', () => {
  it('writes a design opened without a CRS back in its own file coordinates, with its layers', () => {
    // A ground-only design with no terrain opens on the flat plane, its station levels its ground.
    const sloped = { elevationAt: (lon: number, lat: number) => 800 + 0.05 * (utm10.forward([lon, lat])[0] - 515_000) }
    const design = roadEngDesign(
      [{ alignment: road, analysis: analyzeRoad(road, sloped, DEFAULT_ROAD_SETTINGS) }],
      utmGrid.toGrid,
    ).bytes
    const opened = roadEngProject([{ name: 'Spur 7.dsnx', bytes: design }], options)
    expect(opened.localPlane).not.toBeNull()
    const terrain = opened.terrain
    const onPlane = opened.roads[0].alignment
    const plane = localPlaneProjection(opened.localPlane!.offsetM)
    const stream = {
      id: 's',
      name: 'Willow Creek',
      kind: 'stream' as const,
      geometry: {
        type: 'LineString' as const,
        coordinates: [plane.toLonLat([515_050, 5_975_000]), plane.toLonLat([515_060, 5_975_300])],
      },
    }
    const cable = {
      id: 'd',
      name: 'Setting 4',
      start: plane.toLonLat([515_300, 5_975_250]),
      end: plane.toLonLat([515_380, 5_975_330]),
      startHeight: 18,
      endHeight: 8,
      deflectionPercent: 5,
    }
    const grid = roadEngExportGrid(terrain, utmGrid)
    expect(grid.epsg).toBeNull()
    const written = roadEngProjectExport({
      name: 'Spur 7',
      roads: [{ alignment: onPlane }],
      grid,
      context: [stream],
      cables: [cable],
      reference: [],
    })
    expect(written.fileName).toBe('Spur 7.zip')
    expect(Object.keys(unzipSync(written.bytes)).sort()).toEqual(['Spur 7.dsnx', 'Spur 7.terx'])
    // Opened again: on the plane at the same file coordinates, its layers the same objects.
    const again = roadEngProject([{ name: 'Spur 7.zip', bytes: written.bytes }], options)
    // The plane centres on everything read, now the layers too; what holds is each file coordinate.
    const planeAgain = localPlaneProjection(again.localPlane!.offsetM)
    again.roads[0].alignment.points.forEach((p, k) => {
      const [x, y] = planeAgain.toFile(p.coordinate),
        [x0, y0] = plane.toFile(onPlane.points[k].coordinate)
      expect(Math.hypot(x - x0, y - y0)).toBeLessThan(0.001)
    })
    // Its ground went out as station levels and came back as the design file's ground.
    expect(onPlane.fileGround!.points.length).toBeGreaterThanOrEqual(2)
    expect(again.roads[0].alignment.fileGround!.points.at(-1)![1]).toBeCloseTo(onPlane.fileGround!.points.at(-1)![1], 2)
    expect(again.context.map((f) => [f.kind, f.name])).toEqual([['stream', 'Sml Stream - Willow Creek']])
    expect(again.cables).toHaveLength(1)
    const [cx, cy] = planeAgain.toFile(again.cables[0].start)
    expect(Math.hypot(cx - 515_300, cy - 5_975_250)).toBeLessThan(0.001)
    expect(written.notes).toContain(
      'This project has no terrain grid with levels to write, so the RoadEng project goes without ground.',
    )
  })
})

// Softree's published samples, read from a local copy and never committed (see roadEngImport.test.ts).
const samples = process.env.ROADENG_SAMPLES
describe.skipIf(!samples || !existsSync(samples ?? ''))(
  'Softree sample written back as a project',
  { timeout: 60_000 },
  () => {
    it('writes LongRoad with its terrain, and it opens on the same ground', () => {
      const file = (p: string) => ({
        name: p.split('/').pop()!,
        bytes: new Uint8Array(readFileSync(join(samples!, p))),
      })
      const opened = roadEngProject([file('LongRoad_1/LongRoad 1.dsnx'), file('LongRoad_1/LongRoad 1.terx')], {
        ...options,
        verticalReference: 'CGVD2013',
      })
      const utm15 = proj4('EPSG:4326', projectedCrsDefinition(26915)!)
      const grid = roadEngExportGrid(opened.terrain, { epsg: 26915, toGrid: (c) => utm15.forward([...c]) as XY })
      expect(grid.raster).not.toBeNull()
      const written = roadEngProjectExport({
        name: 'LongRoad 1',
        roads: [{ alignment: opened.roads[0].alignment }],
        grid,
        context: [],
        cables: [],
        reference: [],
      })
      const again = roadEngProject([{ name: 'LongRoad 1.zip', bytes: written.bytes }], {
        ...options,
        verticalReference: 'CGVD2013',
      })
      expect(again.epsg).toBe(26915)
      const analysis = analyzeRoad(again.roads[0].alignment, terrainFromMetadata(again.terrain)!, DEFAULT_ROAD_SETTINGS)
      expect(analysis.completeLength / analysis.length).toBeGreaterThan(0.95)
    })
  },
)
