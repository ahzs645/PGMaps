import { describe, expect, it } from 'vitest'
import { designSurface } from './designSurfaceExport'
import { analyzeRoad, offsetCoordinate } from './engine'
import { exportGrid, DEFAULT_ROAD_SETTINGS } from './terrain'
import { stationOffsetCoordinate } from './designExports'
import {
  clipTerrainToDesign,
  cutTerrainToDesign,
  terrainSceneFrame,
  terrainSceneGeometry,
  terrainSeamBlendRadius,
  terrainSkirtDepth,
  unfinishedBatterCurtains,
  TERRAIN_SEAM_BLEND_MIN_M,
  TERRAIN_SKIRT_MIN_DEPTH_M,
  type DesignSeam,
  type TerrainSkirtEdge,
} from './terrainSceneGeometry'
import { terrainMesh, type TerrainVertex } from './terrainMesh'
import { terrainBandMesh } from './terrainBandMesh'
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

  it('makes seams of the TIN outline edges that join one side’s catch points, never its end sections', () => {
    const result = analysis()
    const frame = terrainSceneFrame(metadata, origin)
    const middle = Math.floor(result.stations.length / 2)
    const split: RoadAnalysis = {
      ...result,
      stations: result.stations.map((station, i) => (i === middle ? { ...station, complete: false } : station)),
    }
    for (const [road, runs] of [
      [result, [result.stations.length]],
      [split, [middle, result.stations.length - middle - 1]],
    ] as const) {
      const scene = terrainSceneGeometry({ kind: 'finished', alignment, analysis: road, frame })
      expect(scene.seams).toHaveLength(runs.reduce((sum, stations) => sum + 2 * (stations - 1), 0))
      const catches = road.stations
        .filter((station) => station.complete)
        .flatMap((station) =>
          [-station.leftDaylightM!, station.rightDaylightM!].map((offset) =>
            frame.point(stationOffsetCoordinate(station, offset)),
          ),
        )
      const isCatch = (v: TerrainVertex) => catches.some(([x, y]) => Math.hypot(v.x - x, v.y - y) < 1e-6)
      for (const { a, b } of scene.seams) {
        expect(isCatch(a) && isCatch(b)).toBe(true)
        // Along the road (north here), never across it: a section's ends are open.
        expect(Math.abs(b.y - a.y)).toBeGreaterThan(Math.abs(b.x - a.x))
        // The fill met the level ground: the seam is at the ground's 800 m.
        expect(a.z).toBeCloseTo(800, 6)
        // A seam is an edge of a drawn footprint triangle, so the ground's cut edge can follow it exactly.
        expect(
          scene.footprint.some((face) =>
            face.some((p, i) => {
              const q = face[(i + 1) % face.length]
              return (p === a && q === b) || (p === b && q === a)
            }),
          ),
        ).toBe(true)
      }
    }
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

  it('stitches ground on a seam to it however far off, and leaves open edges, far ground and unseamed cuts alone', () => {
    const slope = (x: number, y: number) => ({ x, y, z: 100 + (x + 1) / 3 })
    // The faces' shared diagonal crosses the open end at x = 0, so that end has a cut ground vertex of its own.
    const ground = [
      { vertices: [slope(-1, -1), slope(11, -1), slope(11, 13)], fill: '#abc', estimated: false },
      { vertices: [slope(-1, -1), slope(11, 13), slope(-1, 13)], fill: '#abc', estimated: false },
    ]
    const original = structuredClone(ground)
    // A design 6 m above the ground's plane. Its two long sides met the ground (seams); its ends did not.
    const footprint = triangles(0, 0, 10, 10).map((face) => face.map((v) => ({ ...v, z: slope(v.x, v.y).z + 6 })))
    const level = (x: number, y: number) => slope(x, y).z + 6
    const seams = [
      { a: vertex(0, 0, level(0, 0)), b: vertex(10, 0, level(10, 0)) },
      { a: vertex(10, 10, level(10, 10)), b: vertex(0, 10, level(0, 10)) },
    ]
    const onSeam = (v: TerrainVertex) =>
      (Math.abs(v.y) < 1e-9 || Math.abs(v.y - 10) < 1e-9) && v.x > -1e-9 && v.x < 10 + 1e-9
    const onOpenEnd = (v: TerrainVertex) =>
      (Math.abs(v.x) < 1e-9 || Math.abs(v.x - 10) < 1e-9) && v.y > 1e-9 && v.y < 10 - 1e-9
    // With no blend (`blendM: 0`) only the vertices on a seam move.
    const stitchedOnly = cutTerrainToDesign(ground, footprint, { seams, blendM: 0 })
    const drawn = stitchedOnly.faces.flatMap((face) => face.vertices)
    expect(drawn.filter(onSeam).length).toBeGreaterThan(2)
    expect(drawn.filter(onOpenEnd).length).toBeGreaterThan(0)
    for (const v of drawn) expect(v.z).toBeCloseTo(onSeam(v) ? level(v.x, v.y) : slope(v.x, v.y).z, 9)
    // Without seams nothing moves, whatever the faces' relief.
    for (const v of clipTerrainToDesign(ground, footprint).flatMap((face) => face.vertices))
      expect(v.z).toBeCloseTo(slope(v.x, v.y).z, 9)
    expect(area(stitchedOnly.faces)).toBeCloseTo(12 * 14 - 100, 8)
    // The skirt runs round the whole outline, seams and open ends, at the ground's own edge levels.
    const outline = (skirt: TerrainSkirtEdge[]) =>
      skirt.reduce((sum, { a, b }) => sum + Math.hypot(b.x - a.x, b.y - a.y), 0)
    expect(outline(stitchedOnly.skirt)).toBeCloseTo(40, 8)
    for (const { a, b } of stitchedOnly.skirt)
      for (const v of [a, b]) {
        expect(onSeam(v) || Math.abs(v.x) < 1e-9 || Math.abs(v.x - 10) < 1e-9).toBe(true)
        expect(v.z).toBeCloseTo(onSeam(v) ? level(v.x, v.y) : slope(v.x, v.y).z, 9)
      }
    // With the blend, ground within its radius of a seam is eased up to the seam's 6 m lift, an open end included.
    const { faces, skirt } = cutTerrainToDesign(ground, footprint, { seams, blendM: 3 })
    const toSeam = (v: TerrainVertex) => Math.min(Math.abs(v.y), Math.abs(v.y - 10))
    const blended = faces.flatMap((face) => face.vertices)
    for (const v of blended) {
      const move = v.z - slope(v.x, v.y).z
      if (onSeam(v)) expect(move).toBeCloseTo(6, 9)
      else if (toSeam(v) >= 3) expect(move).toBeCloseTo(0, 9)
      else expect(move >= -1e-9 && move <= 6 + 1e-9).toBe(true)
    }
    expect(blended.some((v) => onOpenEnd(v) && v.z - slope(v.x, v.y).z > 1)).toBe(true)
    expect(area(faces)).toBeCloseTo(12 * 14 - 100, 8)
    expect(outline(skirt)).toBeCloseTo(40, 8)
    for (const { a, b } of skirt)
      for (const v of [a, b]) expect(blended.some((w) => w.x === v.x && w.y === v.y && w.z === v.z)).toBe(true)
    expect(ground).toEqual(original)
  })

  it('hangs the skirt only where the ground ends on the footprint, not at the window edge or inside a union', () => {
    const footprint = [...triangles(2, 2, 6, 6), ...triangles(4, 4, 8, 8).map((face) => [...face].reverse())]
    const { skirt } = cutTerrainToDesign(squareFaces(0, 0, 10, 10), footprint)
    // The union of two 4 m squares sharing a 2 m square has a 24 m outline.
    expect(skirt.reduce((sum, { a, b }) => sum + Math.hypot(b.x - a.x, b.y - a.y), 0)).toBeCloseTo(24, 8)
    for (const { a, b } of skirt) {
      const { x, y } = centroid([a, b])
      expect(x > 0.5 && x < 9.5 && y > 0.5 && y < 9.5).toBe(true)
      expect(
        (x > 2 + 1e-6 && x < 6 - 1e-6 && y > 2 + 1e-6 && y < 6 - 1e-6) ||
          (x > 4 + 1e-6 && x < 8 - 1e-6 && y > 4 + 1e-6 && y < 8 - 1e-6),
      ).toBe(false)
    }
    expect(cutTerrainToDesign(squareFaces(0, 0, 10, 10), triangles(20, 20, 30, 30)).skirt).toEqual([])
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

/** A 30 % side slope with LiDAR-like micro-relief: the display mesh at any cell size misses some of it. */
const roughGround = (x: number, y: number) =>
  500 +
  0.3 * y +
  0.04 * x +
  0.2 * Math.sin(x / 2.3 + y / 3.1) +
  0.15 * Math.sin(x / 0.9 - y / 1.7) +
  0.6 * Math.sin(x / 14) * Math.cos(y / 11)

/**
 * A road-like footprint every 5 m: a centreline 3 m into the ground (a cut) between two catch lines on the source
 * ground. Its side edges are seams; its first and last sections are open edges.
 */
function roadFootprint() {
  const rows = Array.from({ length: 11 }, (_, i) => {
    const x = 100.3 + 5 * i
    const left = 100 - 6 - 2 * Math.sin(x / 17),
      right = 100 + 7 + 2.5 * Math.cos(x / 23)
    return {
      left: vertex(x, left, roughGround(x, left)),
      centre: vertex(x + 0.4, 100.2, roughGround(x + 0.4, 100.2) - 3),
      right: vertex(x, right, roughGround(x, right)),
    }
  })
  const footprint: TerrainVertex[][] = []
  const seams: DesignSeam[] = []
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1],
      b = rows[i]
    footprint.push([a.left, a.centre, b.centre], [a.left, b.centre, b.left])
    footprint.push([a.centre, a.right, b.right], [a.centre, b.right, b.centre])
    seams.push({ a: a.left, b: b.left }, { a: a.right, b: b.right })
  }
  const ends = [rows[0], rows[rows.length - 1]].flatMap(({ left, centre, right }) => [
    { a: left, b: centre },
    { a: centre, b: right },
  ])
  return { footprint, seams, ends }
}

const along = (v: TerrainVertex, { a, b }: { a: TerrainVertex; b: TerrainVertex }, tolerance = 1e-6) => {
  const dx = b.x - a.x,
    dy = b.y - a.y
  const length = Math.hypot(dx, dy)
  const t = ((v.x - a.x) * dx + (v.y - a.y) * dy) / (length * length)
  const off = Math.abs((v.y - a.y) * dx - (v.x - a.x) * dy) / length
  return off <= tolerance && t * length >= -tolerance && (t - 1) * length <= tolerance
    ? Math.min(1, Math.max(0, t))
    : null
}
const levelOn = (v: TerrainVertex, seams: readonly DesignSeam[], tolerance = 1e-6) => {
  for (const seam of seams) {
    const t = along(v, seam, tolerance)
    if (t !== null) return seam.a.z + (seam.b.z - seam.a.z) * t
  }
  return null
}
/** How near a seam, in plan, the cut counts a ground vertex as on it (`SEAM_EPS_M`). */
const ON_SEAM_M = 1e-5
/** The level of a sampled ground triangle's plane at a plan point. */
const planeLevel = ([p, q, r]: readonly TerrainVertex[], v: { x: number; y: number }) => {
  const det = (q.x - p.x) * (r.y - p.y) - (r.x - p.x) * (q.y - p.y)
  const u = ((v.x - p.x) * (r.y - p.y) - (r.x - p.x) * (v.y - p.y)) / det
  const w = ((q.x - p.x) * (v.y - p.y) - (v.x - p.x) * (q.y - p.y)) / det
  return p.z + (q.z - p.z) * u + (r.z - p.z) * w
}

/**
 * The blend's contract on cut ground whose faces carry their `source` ground face: a vertex on a seam is at the seam's
 * level; one farther than `radius` from every seam lies exactly on its source plane; one nearer is moved by no more than
 * the lift at its nearest seam point, and the same way. A seam's lift runs straight between the ground vertices on it,
 * each lifted from its own ground level to the seam's. Every seam here has ground along its whole length. The centre
 * of a polygon fanned from its middle is held to the same rule.
 */
function expectBlended(
  faces: readonly { vertices: TerrainVertex[]; source: TerrainVertex[] }[],
  seams: readonly DesignSeam[],
  radius: number,
) {
  const knots = seams.map(() => [] as Array<{ t: number; lift: number }>)
  for (const face of faces)
    for (const v of face.vertices)
      seams.forEach((seam, id) => {
        const t = along(v, seam, ON_SEAM_M)
        if (t !== null) knots[id].push({ t, lift: v.z - planeLevel(face.source, v) })
      })
  for (const list of knots) list.sort((p, q) => p.t - q.t)
  const liftAt = (id: number, t: number) => {
    const list = knots[id]
    if (t <= list[0].t) return list[0].lift
    for (let k = 1; k < list.length; k++)
      if (t <= list[k].t) {
        const span = list[k].t - list[k - 1].t
        return span > 0
          ? list[k - 1].lift + ((list[k].lift - list[k - 1].lift) * (t - list[k - 1].t)) / span
          : list[k].lift
      }
    return list[list.length - 1].lift
  }
  const counts = { onSeam: 0, blended: 0, far: 0 }
  for (const face of faces)
    for (const v of face.vertices) {
      const own = planeLevel(face.source, v)
      const level = levelOn(v, seams, ON_SEAM_M)
      if (level !== null) {
        expect(Math.abs(v.z - level)).toBeLessThan(1e-9)
        counts.onSeam++
        continue
      }
      let nearest = Infinity,
        lift = 0
      seams.forEach(({ a, b }, id) => {
        const dx = b.x - a.x,
          dy = b.y - a.y
        const t = Math.min(1, Math.max(0, ((v.x - a.x) * dx + (v.y - a.y) * dy) / (dx * dx + dy * dy)))
        const distance = Math.hypot(v.x - (a.x + dx * t), v.y - (a.y + dy * t))
        if (distance < nearest) {
          nearest = distance
          lift = liftAt(id, t)
        }
      })
      const move = v.z - own
      if (nearest >= radius) {
        expect(Math.abs(move)).toBeLessThan(1e-9)
        counts.far++
      } else {
        expect(Math.abs(move)).toBeLessThanOrEqual(Math.abs(lift) + 1e-9)
        expect(move * lift).toBeGreaterThanOrEqual(-1e-12)
        if (Math.abs(move) > 1e-6) counts.blended++
      }
    }
  return counts
}

describe('display ground stitched to the seams at every ground cell size', () => {
  for (const cell of [10, 5, 2, 1, 0.5])
    it(`closes every seam on rough sloping ground meshed at ${cell} m, and keeps open edges and far ground`, () => {
      const { footprint, seams, ends } = roadFootprint()
      const mesh = terrainMesh([95, 85, 155, 115], roughGround, [], false, { maxSide: 256, minSpacing: cell })
      expect(mesh.spacing).toBe(cell)
      const ground = mesh.faces.map((vertices) => ({ vertices, fill: '', source: vertices }))
      const before = structuredClone(ground)
      const { faces, skirt } = cutTerrainToDesign(ground, footprint, { seams })
      const plain = clipTerrainToDesign(ground, footprint)
      // (e) The input is untouched, and stitching moves heights only: the plan area is the cut's.
      expect(ground).toEqual(before)
      const footprintArea = area(footprint.map((vertices) => ({ vertices })))
      expect(area(faces)).toBeCloseTo(area(ground) - footprintArea, 6)
      expect(area(plain)).toBeCloseTo(area(faces), 6)

      const drawn = faces.flatMap((face) => face.vertices)
      // (a) Every ground vertex on a seam is at the seam's level: none left open, whatever the cell size.
      const onSeams = drawn.filter((v) => levelOn(v, seams) !== null)
      expect(onSeams.length).toBeGreaterThan(20)
      expect(onSeams.filter((v) => Math.abs(v.z - levelOn(v, seams)!) > 1e-9)).toEqual([])
      // (b) One level per plan position on a seam, across every face sharing it.
      const levels = new Map<string, Set<number>>()
      for (const v of onSeams) {
        const key = `${v.x.toFixed(6)}:${v.y.toFixed(6)}`
        levels.set(key, (levels.get(key) ?? new Set()).add(v.z))
      }
      expect([...levels.values()].filter((zs) => zs.size > 1)).toEqual([])
      // (c) No seam corner lies inside a ground face edge running along the seam: the cut edge has a vertex there.
      const corners = seams.flatMap(({ a, b }) => [a, b])
      for (const face of faces)
        face.vertices.forEach((p, i) => {
          const q = face.vertices[(i + 1) % face.vertices.length]
          if (levelOn(p, seams) === null || levelOn(q, seams) === null) return
          const length = Math.hypot(q.x - p.x, q.y - p.y)
          for (const corner of corners) {
            const t = along(corner, { a: p, b: q })
            if (t !== null) expect(t * length < 1e-6 || (1 - t) * length < 1e-6).toBe(true)
          }
        })
      // (d) Off the seams the ground is eased to them within the blend's radius and keeps its own level beyond it: each
      // such vertex lies on the plane of the ground face it was cut from. An open end moves only by a seam's blend.
      const counts = expectBlended(faces, seams, TERRAIN_SEAM_BLEND_MIN_M)
      expect(counts.far).toBeGreaterThan(20)
      if (cell <= 2) expect(counts.blended).toBeGreaterThan(20)
      const offSeams = drawn.filter((v) => levelOn(v, seams) === null)
      expect(offSeams.some((v) => ends.some((end) => along(v, end) !== null))).toBe(true)
      const measured = new Set(mesh.faces.flatMap((face) => face.map((v) => `${v.x}:${v.y}`)))
      const distanceToSeams = (v: TerrainVertex) =>
        Math.min(
          ...seams.map(({ a, b }) => {
            const dx = b.x - a.x,
              dy = b.y - a.y
            const t = Math.min(1, Math.max(0, ((v.x - a.x) * dx + (v.y - a.y) * dy) / (dx * dx + dy * dy)))
            return Math.hypot(v.x - a.x - dx * t, v.y - a.y - dy * t)
          }),
        )
      for (const v of offSeams)
        if (measured.has(`${v.x}:${v.y}`) && distanceToSeams(v) >= TERRAIN_SEAM_BLEND_MIN_M)
          expect(v.z).toBe(roughGround(v.x, v.y))
      // The skirt follows the whole outline (both seams and both open ends) at the ground's drawn edge.
      const outline = [...seams, ...ends].reduce((sum, { a, b }) => sum + Math.hypot(b.x - a.x, b.y - a.y), 0)
      expect(skirt.reduce((sum, { a, b }) => sum + Math.hypot(b.x - a.x, b.y - a.y), 0)).toBeCloseTo(outline, 6)
      const drawnLevels = new Map(drawn.map((v) => [`${v.x}:${v.y}`, v.z]))
      for (const { a, b } of skirt)
        for (const v of [a, b]) {
          expect([...seams, ...ends].some((edge) => along(v, edge) !== null)).toBe(true)
          expect(drawnLevels.get(`${v.x}:${v.y}`)).toBe(v.z)
        }
    })
})

/**
 * A road footprint between two catch lines, every `step` m from x = 100 to 160, turned by `angle` about (130, 100).
 * Straight, one station's left catch point is exactly on a ground vertex (110, 90) and another's right catch point on a
 * ground edge (130, 112.5) at every cell size used here. Its side edges are seams; its two end sections are open. The
 * catch points are on the source ground, or `lift` above it on the left and below it on the right, as a design met on
 * finer ground than the display's.
 */
function steppedRoad(step: number, angle: number, lift = 0) {
  const cos = Math.cos(angle),
    sin = Math.sin(angle)
  const at = (x: number, y: number, up: number) => {
    const turned = { x: 130 + (x - 130) * cos - (y - 100) * sin, y: 100 + (x - 130) * sin + (y - 100) * cos }
    return vertex(turned.x, turned.y, roughGround(turned.x, turned.y) + up)
  }
  const rows: Array<{ left: TerrainVertex; right: TerrainVertex }> = []
  for (let x = 100; x <= 160; x += step) {
    const left = x === 110 && !angle ? 90 : 100 - 6 - 2 * Math.sin(x / 17)
    const right = x === 130 && !angle ? 112.5 : 100 + 7 + 2.5 * Math.cos(x / 23)
    rows.push({ left: at(x, left, lift), right: at(x, right, -lift) })
  }
  const footprint: TerrainVertex[][] = []
  const seams: DesignSeam[] = []
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1],
      b = rows[i]
    footprint.push([a.left, a.right, b.right], [a.left, b.right, b.left])
    seams.push({ a: a.left, b: b.left }, { a: a.right, b: b.right })
  }
  return { footprint, seams }
}

/**
 * Where the drawn ground is not closed: along every ground edge with ground on both sides, each stretch between the
 * vertices lying on it (its own ends and any neighbour's) must be an edge of a neighbouring face at the same level at
 * both ends. Edges with footprint just across them, or on the mesh's border, end the ground and are left out, as are
 * faces with no area in plan, which draw nothing.
 */
function openings(
  faces: readonly { vertices: TerrainVertex[] }[],
  footprint: readonly (readonly TerrainVertex[])[],
  border: [number, number, number, number],
) {
  const cell = 2
  const cellsOf = (x0: number, y0: number, x1: number, y1: number) => {
    const keys: string[] = []
    for (let i = Math.floor(Math.min(x0, x1) / cell); i <= Math.floor(Math.max(x0, x1) / cell); i++)
      for (let j = Math.floor(Math.min(y0, y1) / cell); j <= Math.floor(Math.max(y0, y1) / cell); j++)
        keys.push(`${i}:${j}`)
    return keys
  }
  const edges: Array<{ a: TerrainVertex; b: TerrainVertex; face: number }> = []
  const edgesIn = new Map<string, number[]>()
  const verticesIn = new Map<string, TerrainVertex[]>()
  faces.forEach(({ vertices }, face) => {
    if (area([{ vertices }]) < 1e-9) return
    vertices.forEach((a, i) => {
      const b = vertices[(i + 1) % vertices.length]
      for (const key of cellsOf(a.x, a.y, b.x, b.y)) edgesIn.set(key, [...(edgesIn.get(key) ?? []), edges.length])
      for (const key of cellsOf(a.x, a.y, a.x, a.y)) verticesIn.set(key, [...(verticesIn.get(key) ?? []), a])
      edges.push({ a, b, face })
    })
  })
  const on = (p: { x: number; y: number }, a: TerrainVertex, b: TerrainVertex, tolerance: number) => {
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    const t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (length * length)
    const off = Math.abs((p.y - a.y) * (b.x - a.x) - (p.x - a.x) * (b.y - a.y)) / length
    if (off > tolerance || t * length < -tolerance || (t - 1) * length > tolerance) return null
    return Math.min(1, Math.max(0, t))
  }
  const inFootprint = (x: number, y: number) =>
    footprint.some(([a, b, c]) => {
      const d1 = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x)
      const d2 = (c.x - b.x) * (y - b.y) - (c.y - b.y) * (x - b.x)
      const d3 = (a.x - c.x) * (y - c.y) - (a.y - c.y) * (x - c.x)
      return (d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0)
    })
  const onBorder = (x: number, y: number) =>
    Math.min(Math.abs(x - border[0]), Math.abs(y - border[1]), Math.abs(x - border[2]), Math.abs(y - border[3])) < 1e-6
  const found: string[] = []
  let stretches = 0
  for (const e of edges) {
    const length = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y)
    if (!(length > 1e-9)) continue
    const keys = cellsOf(e.a.x, e.a.y, e.b.x, e.b.y)
    const ts = [0, 1]
    for (const key of keys)
      for (const v of verticesIn.get(key) ?? []) {
        const t = on(v, e.a, e.b, 2e-5)
        if (t !== null && t > 0 && t < 1) ts.push(t)
      }
    ts.sort((p, q) => p - q)
    for (let k = 0; k + 1 < ts.length; k++) {
      if ((ts[k + 1] - ts[k]) * length < 1e-7) continue
      const point = (t: number) => ({ x: e.a.x + (e.b.x - e.a.x) * t, y: e.a.y + (e.b.y - e.a.y) * t })
      const mid = point((ts[k] + ts[k + 1]) / 2)
      const nx = (-(e.b.y - e.a.y) / length) * 1e-6,
        ny = ((e.b.x - e.a.x) / length) * 1e-6
      if (inFootprint(mid.x + nx, mid.y + ny) || inFootprint(mid.x - nx, mid.y - ny) || onBorder(mid.x, mid.y)) continue
      stretches++
      const level = (t: number) => e.a.z + (e.b.z - e.a.z) * t
      const neighbours = new Set(keys.flatMap((key) => edgesIn.get(key) ?? []))
      let met = false
      for (const id of neighbours) {
        const f = edges[id]
        if (f.face === e.face || on(mid, f.a, f.b, 1e-6) === null) continue
        const [s, u] = [ts[k], ts[k + 1]].map((t) => on(point(t), f.a, f.b, 2e-5))
        if (s === null || u === null) continue
        met = true
        const gap = Math.max(
          Math.abs(level(ts[k]) - (f.a.z + (f.b.z - f.a.z) * s)),
          Math.abs(level(ts[k + 1]) - (f.a.z + (f.b.z - f.a.z) * u)),
        )
        if (gap > 1e-9) found.push(`${gap.toFixed(4)} m open at (${mid.x.toFixed(3)}, ${mid.y.toFixed(3)})`)
      }
      if (!met) found.push(`no ground across (${mid.x.toFixed(3)}, ${mid.y.toFixed(3)})`)
    }
  }
  return { found, stretches }
}

describe('display ground closed beside the footprint', () => {
  const window = [90, 75, 170, 125]
  for (const angle of [0, 0.37])
    for (const step of [5, 10, 20])
      it(`leaves no opening between ground faces at 10, 5, 2 and 1 m cells, stations every ${step} m${angle ? ', turned to the grid' : ''}`, () => {
        const { footprint, seams } = steppedRoad(step, angle)
        for (const cell of [10, 5, 2, 1]) {
          const mesh = terrainMesh(window, roughGround, [], false, { maxSide: 256, minSpacing: cell })
          expect(mesh.spacing).toBe(cell)
          const ground = mesh.faces.map((vertices) => ({ vertices, source: vertices }))
          const radius = terrainSeamBlendRadius(cell)
          const { faces } = cutTerrainToDesign(ground, footprint, { seams, blendM: radius })
          const xs = mesh.faces.flatMap((face) => face.map((v) => v.x)),
            ys = mesh.faces.flatMap((face) => face.map((v) => v.y))
          const border: [number, number, number, number] = [
            Math.min(...xs),
            Math.min(...ys),
            Math.max(...xs),
            Math.max(...ys),
          ]
          const { found, stretches } = openings(faces, footprint, border)
          expect(stretches).toBeGreaterThan(100)
          expect({ cell, found }).toEqual({ cell, found: [] })
          // Seam vertices sit at the seam's level, the ground within the radius is eased to it, and the rest stays on
          // its own ground face's plane.
          expect(expectBlended(faces, seams, radius).far).toBeGreaterThan(20)
          expect(area(faces)).toBeCloseTo(area(ground) - area(footprint.map((vertices) => ({ vertices }))), 6)
        }
      })

  it('puts the seam corner on a ground vertex and the one on a ground edge into every face around them', () => {
    const { footprint, seams } = steppedRoad(10, 0)
    for (const cell of [10, 5, 2, 1]) {
      const mesh = terrainMesh(window, roughGround, [], false, { maxSide: 256, minSpacing: cell })
      const { faces } = cutTerrainToDesign(
        mesh.faces.map((vertices) => ({ vertices })),
        footprint,
        { seams },
      )
      for (const corner of [vertex(110, 90), vertex(130, 112.5)]) {
        const level = levelOn(corner, seams)!
        const around = faces.filter(({ vertices }) =>
          vertices.some((p, i) => on(corner, p, vertices[(i + 1) % vertices.length])),
        )
        expect(around.length).toBeGreaterThan(1)
        for (const { vertices } of around) {
          const at = vertices.find((v) => Math.hypot(v.x - corner.x, v.y - corner.y) < 1e-9)
          expect(at?.z).toBeCloseTo(level, 9)
        }
      }
    }
    function on(v: TerrainVertex, a: TerrainVertex, b: TerrainVertex) {
      const t = along(v, { a, b })
      return t !== null
    }
  })

  it('closes the fine band against its coarse ground where the band ends beside the seams', () => {
    const { footprint, seams } = steppedRoad(5, 0.37)
    // A band reaching only 4 m from the centreline ends inside the batters, so seams cross its coarse border.
    const band = terrainBandMesh(window, roughGround, [], false, {
      maxSide: 16,
      minSpacing: 1,
      segments: [{ a: [100, 100], b: [160, 100] }].map(({ a, b }) => ({
        a: [130 + (a[0] - 130) * Math.cos(0.37), 100 + (a[0] - 130) * Math.sin(0.37)] as [number, number],
        b: [130 + (b[0] - 130) * Math.cos(0.37), 100 + (b[0] - 130) * Math.sin(0.37)] as [number, number],
        reachM: 4,
      })),
      maxCells: Infinity,
    })
    expect(band.bandDivisions).toBeGreaterThan(1)
    expect(band.refinedCells).toBeLessThan(band.coarseFaces.length / 2)
    const xs = band.faces.flatMap((face) => face.map((v) => v.x)),
      ys = band.faces.flatMap((face) => face.map((v) => v.y))
    const border: [number, number, number, number] = [
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs),
      Math.max(...ys),
    ]
    const ground = band.faces.map((vertices) => ({ vertices }))
    // The band alone is closed: its border vertices lie on the coarse neighbours' straight edges.
    expect(openings(ground, [], border).found).toEqual([])
    const { faces } = cutTerrainToDesign(ground, footprint, { seams })
    const { found, stretches } = openings(faces, footprint, border)
    expect(stretches).toBeGreaterThan(100)
    expect(found).toEqual([])
  })
})

/**
 * Near-vertical steps: ground edges shorter than 5 cm in plan that rise more than 5 cm, between a vertex on a seam and
 * one off it. Before the blend, the whole lift was taken up there, beside a seam vertex.
 */
function seamSteps(faces: readonly { vertices: TerrainVertex[] }[], seams: readonly DesignSeam[]) {
  let count = 0
  for (const { vertices } of faces)
    vertices.forEach((p, i) => {
      const q = vertices[(i + 1) % vertices.length]
      const plan = Math.hypot(q.x - p.x, q.y - p.y)
      if (plan > 0 && plan < 0.05 && Math.abs(q.z - p.z) > 0.05)
        if ((levelOn(p, seams, ON_SEAM_M) === null) !== (levelOn(q, seams, ON_SEAM_M) === null)) count++
    })
  return count
}

/** A triangle's slope in plan, as a ratio, or null when it is flat in plan. */
function slopeOf([a, b, c]: readonly TerrainVertex[]) {
  const det = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)
  if (Math.abs(det) < 1e-12) return null
  const gx = ((b.z - a.z) * (c.y - a.y) - (c.z - a.z) * (b.y - a.y)) / det
  const gy = ((c.z - a.z) * (b.x - a.x) - (b.z - a.z) * (c.x - a.x)) / det
  return Math.hypot(gx, gy)
}

/**
 * A triangle's narrowest width in plan, and how far the vertex across its longest edge stands off that edge's level:
 * how tall a step the face draws.
 */
function widthAndStep(triangle: readonly TerrainVertex[]) {
  let longest = -1,
    k = 0
  for (let i = 0; i < 3; i++) {
    const a = triangle[(i + 1) % 3],
      b = triangle[(i + 2) % 3]
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (length > longest) {
      longest = length
      k = i
    }
  }
  const v = triangle[k],
    a = triangle[(k + 1) % 3],
    b = triangle[(k + 2) % 3]
  const dx = b.x - a.x,
    dy = b.y - a.y
  const t = ((v.x - a.x) * dx + (v.y - a.y) * dy) / (dx * dx + dy * dy)
  return {
    width: Math.abs((v.y - a.y) * dx - (v.x - a.x) * dy) / longest,
    step: Math.abs(v.z - (a.z + (b.z - a.z) * t)),
  }
}

describe('display ground eased to the seams', () => {
  const window = [90, 75, 170, 125]
  /** Narrower faces are the cut's slivers: their slope says little, so the step they draw is checked instead. */
  const SLIVER_M = 0.05
  for (const angle of [0, 0.37])
    for (const step of [5, 10, 20])
      it(`spreads a lift of several decimetres over the blend at 2 and 1 m cells, stations every ${step} m${angle ? ', turned' : ''}`, () => {
        const { footprint, seams } = steppedRoad(step, angle, 0.4)
        const distance = (x: number, y: number) =>
          Math.min(
            ...seams.map(({ a, b }) => {
              const dx = b.x - a.x,
                dy = b.y - a.y
              const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)))
              return Math.hypot(x - a.x - dx * t, y - a.y - dy * t)
            }),
          )
        for (const cell of [2, 1]) {
          const mesh = terrainMesh(window, roughGround, [], false, { maxSide: 256, minSpacing: cell })
          const ground = mesh.faces.map((vertices) => ({ vertices, source: vertices }))
          const radius = terrainSeamBlendRadius(cell)
          const stitchedOnly = cutTerrainToDesign(ground, footprint, { seams, blendM: 0 }).faces
          const { faces } = cutTerrainToDesign(ground, footprint, { seams, blendM: radius })
          // Without the blend the lift is taken up beside each seam vertex; with it, nowhere.
          expect(seamSteps(stitchedOnly, seams)).toBeGreaterThan(0)
          expect({ cell, steps: seamSteps(faces, seams) }).toEqual({ cell, steps: 0 })
          // Still closed along every ground edge, and eased as the blend's contract says.
          const xs = mesh.faces.flatMap((face) => face.map((v) => v.x)),
            ys = mesh.faces.flatMap((face) => face.map((v) => v.y))
          const border: [number, number, number, number] = [
            Math.min(...xs),
            Math.min(...ys),
            Math.max(...xs),
            Math.max(...ys),
          ]
          expect({ cell, found: openings(faces, footprint, border).found }).toEqual({ cell, found: [] })
          expect(expectBlended(faces, seams, radius).blended).toBeGreaterThan(20)
          expect(area(faces)).toBeCloseTo(area(ground) - area(footprint.map((vertices) => ({ vertices }))), 6)

          // The lift along each seam, and how fast it changes along the seam, from the ground vertices on it.
          let lift = 0,
            liftGrade = 0
          for (const seam of seams) {
            const length = Math.hypot(seam.b.x - seam.a.x, seam.b.y - seam.a.y)
            const knots = faces
              .flatMap((face) =>
                face.vertices.flatMap((v) => {
                  const t = along(v, seam, ON_SEAM_M)
                  return t === null ? [] : [{ s: t * length, lift: v.z - planeLevel(face.source, v) }]
                }),
              )
              .sort((p, q) => p.s - q.s)
            for (let k = 0; k < knots.length; k++) {
              lift = Math.max(lift, Math.abs(knots[k].lift))
              const run = k ? knots[k].s - knots[k - 1].s : 0
              if (run > 1e-3) liftGrade = Math.max(liftGrade, Math.abs(knots[k].lift - knots[k - 1].lift) / run)
            }
          }
          expect(lift).toBeGreaterThan(0.4)
          // The blend adds at most its own grade: the lift eased over the radius, and the lift's change along the seam.
          const bound = (Math.PI / 2) * (lift / radius) + liftGrade
          const near = (drawn: typeof faces) =>
            drawn.flatMap((face) =>
              face.vertices.slice(2).flatMap((_, i) => {
                const triangle = [face.vertices[0], face.vertices[i + 1], face.vertices[i + 2]]
                const x = (triangle[0].x + triangle[1].x + triangle[2].x) / 3,
                  y = (triangle[0].y + triangle[1].y + triangle[2].y) / 3
                return distance(x, y) <= radius ? [{ triangle, source: face.source }] : []
              }),
            )
          let faceCount = 0,
            sliverStep = 0,
            sliverStepBefore = 0
          for (const { triangle, source } of near(faces)) {
            const { width, step: rise } = widthAndStep(triangle)
            if (width < SLIVER_M) sliverStep = Math.max(sliverStep, rise)
            else {
              expect(slopeOf(triangle)!).toBeLessThanOrEqual(slopeOf(source)! + bound)
              faceCount++
            }
          }
          for (const { triangle } of near(stitchedOnly)) {
            const { width, step: rise } = widthAndStep(triangle)
            if (width < SLIVER_M) sliverStepBefore = Math.max(sliverStepBefore, rise)
          }
          expect(faceCount).toBeGreaterThan(100)
          // A sliver's step: under 10 cm, and a quarter of the tallest the stitch alone leaves (0.39 to 0.89 m here).
          expect(sliverStep).toBeLessThan(0.1)
          expect(sliverStep).toBeLessThan(sliverStepBefore / 4)
        }
      })
})

describe('skirt depth and unfinished batter curtains', () => {
  it('hangs the skirt a few metres, or two ground cells where those are coarser', () => {
    expect(terrainSkirtDepth(1)).toBe(TERRAIN_SKIRT_MIN_DEPTH_M)
    expect(terrainSkirtDepth(10)).toBe(20)
    expect(terrainSkirtDepth(NaN)).toBe(TERRAIN_SKIRT_MIN_DEPTH_M)
  })

  it('draws an open edge down or up to the ground under it, split where it crosses, and skips a negligible one', () => {
    const above = unfinishedBatterCurtains([{ a: vertex(0, 0, 12), b: vertex(10, 0, 14), groundA: 10, groundB: 10 }])
    expect(above).toEqual([[vertex(0, 0, 12), vertex(10, 0, 14), vertex(10, 0, 10), vertex(0, 0, 10)]])
    const crossing = unfinishedBatterCurtains([{ a: vertex(0, 0, 12), b: vertex(10, 0, 8), groundA: 10, groundB: 10 }])
    expect(crossing).toHaveLength(2)
    expect(crossing[0][1]).toEqual(vertex(5, 0, 10))
    expect(crossing[1][0]).toEqual(vertex(5, 0, 10))
    expect(
      unfinishedBatterCurtains([{ a: vertex(0, 0, 10.01), b: vertex(10, 0, 9.99), groundA: 10, groundB: 10 }]),
    ).toEqual([])
    expect(
      unfinishedBatterCurtains([{ a: vertex(0, 0, 10), b: vertex(10, 0, 9), groundA: 10, groundB: 10 }])[0],
    ).toHaveLength(3)
  })
})
