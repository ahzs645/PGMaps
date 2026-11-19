import { describe, expect, it } from 'vitest'
import { designSurface } from './designSurfaceExport'
import { analyzeRoad, offsetCoordinate } from './engine'
import { exportGrid, DEFAULT_ROAD_SETTINGS } from './terrain'
import { clipTerrainToDesign, terrainSceneFrame, terrainSceneGeometry } from './terrainSceneGeometry'
import type { TerrainVertex } from './terrainMesh'
import type { Alignment, Coordinate, RoadAnalysis, TerrainMetadata } from './types'

const origin: Coordinate = [-122.7, 53.9]
const metadata: TerrainMetadata = {
  kind: 'geotiff',
  name: 'Test ground',
  resolutionM: 1,
  verticalReference: 'CGVD2013',
  epsg: 3005,
}
const alignment: Alignment = {
  id: 'test-road',
  name: 'Test road',
  color: '#000000',
  points: [
    { id: 'a', coordinate: origin, radiusM: 0 },
    { id: 'b', coordinate: offsetCoordinate(origin, 0, 100), radiusM: 0 },
  ],
  vertical: [
    { id: 'v0', chainage: 0, elevation: 801, curveLength: 0 },
    { id: 'v1', chainage: 100, elevation: 801, curveLength: 0 },
  ],
  template: {
    leftWidth: 3,
    rightWidth: 3,
    crossfallPercent: 2,
    cutSlope: 1,
    fillSlope: 1.5,
    ditchWidth: 0,
    ditchDepth: 0,
    surfaceDepth: 0.3,
  },
  overrides: [],
}
const analysis = () => analyzeRoad(alignment, { elevationAt: () => 800 }, DEFAULT_ROAD_SETTINGS)
const vertex = (x: number, y: number, z = 10): TerrainVertex => ({ x, y, z })
const rectangle = (left: number, bottom: number, right: number, top: number, z = 10) => [
  vertex(left, bottom, z),
  vertex(right, bottom, z),
  vertex(right, top, z),
  vertex(left, top, z),
]
const squareFaces = (left: number, bottom: number, right: number, top: number, z = 10) => {
  const [a, b, c, d] = rectangle(left, bottom, right, top, z)
  return [
    { vertices: [a, b, c], fill: '#abc', estimated: false },
    { vertices: [a, c, d], fill: '#def', estimated: true },
  ]
}
const triangles = (left: number, bottom: number, right: number, top: number, z = 10) =>
  squareFaces(left, bottom, right, top, z).map((face) => face.vertices)
const area = (faces: { vertices: TerrainVertex[] }[]) =>
  faces.reduce((sum, { vertices }) => {
    let twice = 0
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++)
      twice += vertices[j].x * vertices[i].y - vertices[i].x * vertices[j].y
    return sum + Math.abs(twice) / 2
  }, 0)
const centroid = (vertices: TerrainVertex[]) => ({
  x: vertices.reduce((sum, v) => sum + v.x, 0) / vertices.length,
  y: vertices.reduce((sum, v) => sum + v.y, 0) / vertices.length,
})

describe('terrain scene frame and exact design geometry', () => {
  it('uses the export CRS for both directions and keeps source elevations in metres', () => {
    const frame = terrainSceneFrame(metadata, origin)
    const grid = exportGrid(metadata, origin)
    expect(frame.epsg).toBe(3005)
    expect(frame.origin).toEqual(grid.toGrid(origin))
    expect(frame.verticalReference).toBe('CGVD2013')
    expect(frame.point(origin)).toEqual([0, 0])
    const coordinate = offsetCoordinate(origin, 63, 123.4)
    const point = frame.point(coordinate)
    const restored = frame.coordinate(...point)
    expect(restored[0]).toBeCloseTo(coordinate[0], 9)
    expect(restored[1]).toBeCloseTo(coordinate[1], 9)
    const projected = grid.toGrid(coordinate)
    expect(point[0] + frame.origin[0]).toBeCloseTo(projected[0], 8)
    expect(point[1] + frame.origin[1]).toBeCloseTo(projected[1], 8)
  })

  it('keeps each finished/subgrade TIN face and vertex instead of retriangulating the surface', () => {
    const result = analysis()
    const frame = terrainSceneFrame(metadata, origin)
    for (const kind of ['subgrade', 'finished'] as const) {
      const scene = terrainSceneGeometry({ kind, alignment, analysis: result, frame })
      const source = designSurface(kind, alignment, result, exportGrid(metadata, origin).toGrid)
      expect(scene.status).toBe('ready')
      let pointOffset = 0
      let faceOffset = 0
      source.pieces.forEach((piece, p) => {
        expect(scene.pieces[p]).toEqual({
          firstIndex: faceOffset * 3,
          indexCount: piece.faces.length * 3,
          from: piece.from,
          to: piece.to,
          folded: piece.folded,
        })
        piece.points.forEach(([easting, northing, level], i) => {
          const index = (pointOffset + i) * 3
          expect(scene.positions[index] + frame.origin[0]).toBeCloseTo(easting, 4)
          expect(scene.positions[index + 1] + frame.origin[1]).toBeCloseTo(northing, 4)
          expect(scene.positions[index + 2]).toBeCloseTo(level, 4)
        })
        piece.faces.forEach((face, i) => {
          expect(Array.from(scene.indices.slice((faceOffset + i) * 3, (faceOffset + i + 1) * 3))).toEqual(
            face.map((id) => pointOffset + id),
          )
          face.forEach((id, k) => {
            const [easting, northing, level] = piece.points[id]
            const actual = scene.footprint[faceOffset + i][k]
            expect(actual.x + frame.origin[0]).toBeCloseTo(easting, 8)
            expect(actual.y + frame.origin[1]).toBeCloseTo(northing, 8)
            expect(actual.z).toBe(level)
          })
        })
        pointOffset += piece.points.length
        faceOffset += piece.faces.length
      })
      expect(scene.footprint.length * 3).toBe(scene.indices.length)
      expect(scene.bounds).not.toBeNull()
    }
  })

  it('keeps an incomplete interval open and carries its reason and piece ranges', () => {
    const result = analysis()
    const middle = Math.floor(result.stations.length / 2)
    const incomplete: RoadAnalysis = {
      ...result,
      stations: result.stations.map((station, i) =>
        i === middle ? { ...station, complete: false, incompleteReasons: ['ground missing'] } : station,
      ),
    }
    const scene = terrainSceneGeometry({
      kind: 'finished',
      alignment,
      analysis: incomplete,
      frame: terrainSceneFrame(metadata, origin),
    })
    expect(scene.status).toBe('partial')
    expect(scene.pieces).toHaveLength(2)
    expect(scene.gaps).toHaveLength(1)
    expect(scene.gaps[0].reason).toBe('ground missing')
    expect(scene.pieces[0].to).toBeLessThan(scene.pieces[1].from)
    expect(scene.notice).toContain('left open')
    const empty = terrainSceneGeometry({
      kind: 'finished',
      alignment,
      analysis: { ...result, stations: result.stations.map((station) => ({ ...station, complete: false })) },
      frame: terrainSceneFrame(metadata, origin),
    })
    expect(empty.status).toBe('unavailable')
    expect(empty.footprint).toHaveLength(0)
    expect(empty.bounds).toBeNull()
  })

  it('does not erase an invalid-input flag to get an apparently current surface', () => {
    const result = analysis()
    const invalid = {
      ...result,
      invalidInput: { message: 'The entered surface depth is invalid.', leftOut: 'all' },
    } as RoadAnalysis
    const scene = terrainSceneGeometry({
      kind: 'finished',
      alignment,
      analysis: invalid,
      frame: terrainSceneFrame(metadata, origin),
    })
    expect(scene.status).toBe('unavailable')
    expect(scene.reason).toContain('invalid')
    expect(scene.indices).toHaveLength(0)
    expect(invalid.invalidInput).toBeDefined()
  })
})

describe('terrain outside the exact design footprint', () => {
  it('opens a deep cut through coarse terrain, keeping colours, estimated status and outside heights', () => {
    const ground = squareFaces(-1, -1, 11, 11)
    const original = JSON.stringify(ground)
    const clipped = clipTerrainToDesign(ground, triangles(0, 0, 10, 10, -20))
    expect(area(clipped)).toBeCloseTo(44, 8)
    for (const face of clipped) {
      expect(face.fill).toBe(face.estimated ? '#def' : '#abc')
      expect(face.vertices.every((v) => v.z === 10)).toBe(true)
      const { x, y } = centroid(face.vertices)
      expect(x > 0 && x < 10 && y > 0 && y < 10).toBe(false)
    }
    expect(JSON.stringify(ground)).toBe(original)
  })

  it('subtracts overlapping/folded faces as a union without removing their shared area twice', () => {
    const footprint = [...triangles(2, 2, 6, 6), ...triangles(4, 4, 8, 8).map((face) => [...face].reverse())]
    const clipped = clipTerrainToDesign(squareFaces(0, 0, 10, 10), footprint)
    expect(area(clipped)).toBeCloseTo(100 - (16 + 16 - 4), 8)
    for (const { vertices } of clipped) {
      const { x, y } = centroid(vertices)
      expect((x > 2 && x < 6 && y > 2 && y < 6) || (x > 4 && x < 8 && y > 4 && y < 8)).toBe(false)
    }
  })

  it('keeps terrain between separate design pieces and never creates terrain in a source gap', () => {
    const ground = [...squareFaces(0, 0, 4, 10), ...squareFaces(6, 0, 10, 10)]
    const clipped = clipTerrainToDesign(ground, [...triangles(1, 0, 3, 10), ...triangles(7, 0, 9, 10)])
    expect(area(clipped)).toBeCloseTo(40, 8)
    for (const { vertices } of clipped) {
      const { x } = centroid(vertices)
      expect(x > 4 && x < 6).toBe(false)
    }
    const uninterrupted = clipTerrainToDesign(squareFaces(0, 0, 10, 10), [
      ...triangles(1, 0, 3, 10),
      ...triangles(7, 0, 9, 10),
    ])
    expect(area(uninterrupted)).toBeCloseTo(60, 8)
    expect(
      uninterrupted.some(({ vertices }) => {
        const { x } = centroid(vertices)
        return x > 3 && x < 7
      }),
    ).toBe(true)
  })

  it('interpolates cut-edge elevations on the original ground plane and ignores non-finite source faces', () => {
    const ground = squareFaces(0, 0, 10, 10).map((face) => ({
      ...face,
      vertices: face.vertices.map((v) => ({ ...v, z: 2 * v.x + 3 * v.y + 4 })),
    }))
    ground.push({ vertices: [vertex(0, 0, NaN), vertex(10, 0), vertex(10, 10)], fill: 'missing', estimated: false })
    const clipped = clipTerrainToDesign(ground, triangles(2, 2, 8, 8, -100))
    expect(area(clipped)).toBeCloseTo(64, 8)
    for (const face of clipped) {
      expect(face.fill).not.toBe('missing')
      for (const v of face.vertices) expect(v.z).toBeCloseTo(2 * v.x + 3 * v.y + 4, 9)
    }
  })

  it('retains uncut face identities and removes a fully covered face', () => {
    const ground = squareFaces(0, 0, 10, 10)
    const untouched = clipTerrainToDesign(ground, triangles(20, 20, 30, 30))
    expect(untouched[0]).toBe(ground[0])
    expect(untouched[1]).toBe(ground[1])
    expect(clipTerrainToDesign(ground, triangles(-1, -1, 11, 11))).toEqual([])
    expect(clipTerrainToDesign(ground, [])).toEqual(ground)
  })
})
