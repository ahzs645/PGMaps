import proj4 from 'proj4'
import { describe, expect, it } from 'vitest'
import { projectedCrsDefinition } from '@/lib/geo/projectedCrs'
import { alignmentLength, analyzeRoad } from './engine'
import { gridToLonLat, type XY } from './landXmlImport'
import { LOCAL_PLANE_EPSG, localPlaneProjection } from './localPlane'
import { parseSoftreeLocationAscii, writeSoftreeTerrainAscii } from './softreeAscii'
import { locationAsciiFile } from './softreeExports'
import { softreeLocationExtent, softreeLocationRoad, softreeTerrainAsciiGround } from './softreeImport'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE, terrainFromMetadata } from './terrain'
import type { Alignment, Coordinate } from './types'

const utm = proj4('EPSG:4326', projectedCrsDefinition(3157)!)
const lonLat = (x: number, y: number) => utm.inverse([515_000 + x, 5_975_000 + y]) as Coordinate
const toGrid = (c: Coordinate) => utm.forward([...c]) as XY
const flat = { elevationAt: () => 800 }
const road: Alignment = {
  id: 'r',
  name: 'Spur 7',
  color: '#000000',
  points: [
    { id: 'a', coordinate: lonLat(0, 0), radiusM: 0 },
    { id: 'b', coordinate: lonLat(200, 150), radiusM: 60 },
    { id: 'c', coordinate: lonLat(380, 160), radiusM: 0 },
  ],
  vertical: [
    { id: 's', chainage: 0, elevation: 801, curveLength: 0 },
    { id: 'm', chainage: 200, elevation: 810, curveLength: 0 },
    { id: 'e', chainage: 400, elevation: 806, curveLength: 0 },
  ],
  template: { ...DEFAULT_TEMPLATE },
  overrides: [],
}

describe('a Softree location ASCII file as a road', () => {
  const analysis = analyzeRoad(road, flat, DEFAULT_ROAD_SETTINGS)
  const options = { fileName: 'Spur 7.txt', id: 'n', color: '#123456', template: { ...DEFAULT_TEMPLATE } }

  it('comes back as the road written, with its subgrade profile and recorded ground', () => {
    const text = locationAsciiFile(road, analysis, toGrid, {
      unitM: 1,
      startStationM: 1000,
      delimiter: ',',
      singleLine: false,
    })
    const { alignment, notes } = softreeLocationRoad(text, {
      ...options,
      unitM: 1,
      placement: { epsg: 3157, toLonLat: gridToLonLat(3157) },
    })
    expect(alignment.name).toBe('Spur 7')
    expect(alignmentLength(alignment)).toBeCloseTo(alignmentLength(road), -0.5)
    // Each station's design level is found again within the profile's thinning and the station spacing.
    const back = analyzeRoad(alignment, flat, DEFAULT_ROAD_SETTINGS)
    for (const s of analysis.stations) {
      const near = back.stations.reduce((a, b) =>
        Math.abs(b.chainage - s.chainage) < Math.abs(a.chainage - s.chainage) ? b : a,
      )
      expect(Math.abs(near.designElevation! - s.designElevation!)).toBeLessThan(0.3)
    }
    expect(alignment.fileGround?.points.every(([, z]) => z === 800)).toBe(true)
    expect(notes.join(' ')).toMatch(/Stations 1000\.000 to/)
  })

  it('reads feet, and places on the project’s flat plane', () => {
    const text = locationAsciiFile(road, analysis, toGrid, {
      unitM: 0.3048,
      startStationM: 0,
      delimiter: ',',
      singleLine: false,
    })
    const extent = softreeLocationExtent(parseSoftreeLocationAscii(text))
    expect(extent[0] * 0.3048).toBeCloseTo(515_000, 0)
    const plane = { offsetM: [515_000, 5_975_000] as [number, number], unitM: 0.3048, source: 'Spur 7.dsnx' }
    const { alignment } = softreeLocationRoad(text, {
      ...options,
      unitM: 0.3048,
      placement: { plane, toLonLat: localPlaneProjection(plane.offsetM).toLonLat },
    })
    const first = localPlaneProjection(plane.offsetM).toFile(alignment.points[0].coordinate)
    expect(first[0]).toBeCloseTo(515_000, 1)
    expect(first[1]).toBeCloseTo(5_975_000, 1)
    expect(alignment.vertical[0].elevation).toBeCloseTo(801, 2)
  })

  it('needs a stated unit', () => {
    const text = locationAsciiFile(road, analysis, toGrid, {
      unitM: 1,
      startStationM: 0,
      delimiter: ',',
      singleLine: false,
    })
    expect(() =>
      softreeLocationRoad(text, { ...options, unitM: 0, placement: { epsg: 3157, toLonLat: gridToLonLat(3157) } }),
    ).toThrow(/unit/)
  })
})

describe('a Softree terrain ASCII file as the terrain', () => {
  // A 100 m square of ground rising 10 % to the east, a contour, and a stream drawn with no levels.
  const grid: number[] = []
  for (let y = 0; y <= 100; y += 5)
    for (let x = 0; x <= 100; x += 5) grid.push(515_000 + x, 5_975_000 + y, 700 + 0.1 * x)
  const file = writeSoftreeTerrainAscii([
    { name: 'Ground', subId: 1, points: grid, type: 'points' },
    { name: 'Contour 705', subId: 1, points: [515_050, 5_975_000, 705, 515_050, 5_975_100, 705] },
    { name: 'Willow Creek', subId: 1, points: [515_010, 5_975_010, 0, 515_090, 5_975_090, 0] },
  ]).text
  const options = { fileName: 'ground.txt', verticalReference: 'CGVD2013', sha256: 'ab'.repeat(32) }

  it('is a grid from the TIN of its levelled points, leaving out a feature with no levels', () => {
    const { metadata, notes } = softreeTerrainAsciiGround(file, {
      ...options,
      unitM: 1,
      placement: { epsg: 3157, toLonLat: gridToLonLat(3157) },
    })
    expect(metadata).toMatchObject({ kind: 'geotiff', epsg: 3157, verticalReference: 'CGVD2013' })
    const source = terrainFromMetadata(metadata)!
    const at = (x: number, y: number) => source.elevationAt(...lonLat(x, y))
    expect(at(30, 40)).toBeCloseTo(703, 1)
    expect(at(80, 70)).toBeCloseTo(708, 1)
    expect(notes.join(' ')).toMatch(/1 feature has no levels/)
  })

  it('reads feet onto the project’s flat plane', () => {
    const feet = writeSoftreeTerrainAscii([
      { name: 'Ground', subId: 1, points: grid.map((v) => v / 0.3048), type: 'points' },
    ]).text
    const plane = { offsetM: [515_000, 5_975_000] as [number, number], unitM: 0.3048, source: 'Spur 7.dsnx' }
    const { metadata } = softreeTerrainAsciiGround(feet, {
      ...options,
      unitM: 0.3048,
      placement: { plane, toLonLat: localPlaneProjection(plane.offsetM).toLonLat },
    })
    expect(metadata.epsg).toBe(LOCAL_PLANE_EPSG)
    expect(metadata.localPlane).toEqual(plane)
    const source = terrainFromMetadata(metadata)!
    const c = localPlaneProjection(plane.offsetM).toLonLat([515_050, 5_975_050])
    expect(source.elevationAt(c[0], c[1])).toBeCloseTo(705, 1)
  })
})
