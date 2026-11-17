import { describe, expect, it } from 'vitest'
import { analyzeRoad, offsetCoordinate } from './engine'
import { designSurface, designSurfaceLandXml, VERTICAL_FACE_INSET_M } from './designSurfaceExport'
import { exportUnavailable, type ExportContext } from './exportCatalog'
import { readXml, type XmlNode } from './landXmlImport'
import { DEFAULT_ROAD_SETTINGS, exportGrid } from './terrain'
import type { Alignment, Coordinate, RoadAnalysis, RoadStation, RoadTemplate, TerrainMetadata } from './types'

const origin: Coordinate = [-122.8, 53.9]
const R = 6371008.8,
  RAD = Math.PI / 180
/** Local east/north metres about the origin: plain enough to check winding by hand. */
const toGrid = ([lng, lat]: Coordinate): [number, number] => [
  (lng - origin[0]) * RAD * R * Math.cos(origin[1] * RAD),
  (lat - origin[1]) * RAD * R,
]
const terrain: TerrainMetadata = { kind: 'demo', name: 'Flat', resolutionM: 1, verticalReference: 'CGVD2013' }
const template: RoadTemplate = {
  leftWidth: 3,
  rightWidth: 3,
  crossfallPercent: 0,
  cutSlope: 1,
  fillSlope: 1.5,
  ditchWidth: 0,
  ditchDepth: 0,
  surfaceDepth: 0.3,
}

/** A fill section: crowned formation 3 m each side, 1.5:1 batters to ground 1 m below the edge. */
function station(index: number, chainage: number, complete = true): RoadStation {
  const z = 801 + chainage * 0.01
  const design = [
    [-4.5, z - 1.03],
    [-3, z - 0.03],
    [0, z],
    [3, z - 0.03],
    [4.5, z - 1.03],
  ]
  return {
    index,
    chainage,
    coordinate: offsetCoordinate(origin, 0, chainage),
    bearing: 0,
    groundElevation: z - 1,
    designElevation: z,
    gradePercent: 1,
    groundGradePercent: 0,
    curveRadiusM: null,
    leftWidth: 3,
    rightWidth: 3,
    section: design.map(([offset, level]) => ({
      offset,
      design: complete ? level : null,
      ground: Math.abs(offset) === 4.5 ? level : z - 1,
    })),
    cutAreaM2: 0,
    fillAreaM2: 5,
    cutVolumeM3: null,
    fillVolumeM3: null,
    massM3: null,
    leftDaylightM: 4.5,
    rightDaylightM: 4.5,
    complete,
    flags: [],
    ...(complete ? {} : { incompleteReasons: ['ground missing'] }),
  }
}
const alignment: Alignment = {
  id: 'r',
  name: 'Spur 7',
  color: '#000000',
  points: [
    { id: 'a', coordinate: origin, radiusM: 0 },
    { id: 'b', coordinate: offsetCoordinate(origin, 0, 100), radiusM: 0 },
  ],
  vertical: [],
  template,
  overrides: [],
}
const analysisOf = (stations: RoadStation[]) =>
  ({ stations, length: stations[stations.length - 1].chainage }) as unknown as RoadAnalysis
const planArea = (pts: [number, number, number][]) =>
  pts.reduce((sum, p, i) => {
    const q = pts[(i + 1) % pts.length]
    return sum + (p[0] * q[1] - q[0] * p[1]) / 2
  }, 0)

describe('design surface TIN', () => {
  it('joins two sections with counter-clockwise faces matched at the break lines', () => {
    const surface = designSurface('subgrade', alignment, analysisOf([station(0, 0), station(1, 20)]), toGrid)
    expect(surface.gaps).toEqual([])
    expect(surface.pieces).toHaveLength(1)
    const [piece] = surface.pieces
    // Five points a section: (5 − 1) + (5 − 1) faces.
    expect(piece.points).toHaveLength(10)
    expect(piece.faces).toHaveLength(8)
    expect(piece.folded).toBe(0)
    for (const face of piece.faces) {
      expect(planArea(face.map((i) => piece.points[i]))).toBeGreaterThan(0)
      // Every face touches both sections: nothing is drawn within one section.
      expect(face.some((i) => i < 5) && face.some((i) => i >= 5)).toBe(true)
    }
    // Matched break lines are face edges: centreline to centreline, catch to catch.
    const edges = new Set(piece.faces.flatMap(([a, b, c]) => [`${a}-${b}`, `${b}-${c}`, `${c}-${a}`]))
    for (const k of [0, 1, 2, 3, 4]) expect(edges.has(`${k}-${k + 5}`) || edges.has(`${k + 5}-${k}`)).toBe(true)
    // Negative offsets are left looking up-station (north): the first point is west of the centreline.
    expect(piece.points[0][0]).toBeCloseTo(-4.5, 2)
    expect(piece.points[2][0]).toBeCloseTo(0, 2)
    // The outer boundary runs counter-clockwise round every point of the piece's edge.
    expect(piece.boundary).toEqual([0, 1, 2, 3, 4, 9, 8, 7, 6, 5])
    expect(planArea(piece.boundary.map((i) => piece.points[i]))).toBeCloseTo(9 * 20, 1)
  })

  it('raises the running surface by the courses and keeps the edges on the subgrade', () => {
    const surface = designSurface('finished', alignment, analysisOf([station(0, 0), station(1, 20)]), toGrid)
    const [piece] = surface.pieces
    // Square-edged course: its top edge is drawn VERTICAL_FACE_INSET_M inside the formation edge.
    expect(piece.points).toHaveLength(14)
    expect(piece.faces).toHaveLength(2 * (7 - 1))
    const first = piece.points.slice(0, 7)
    expect(first.map((p) => +p[0].toFixed(3) || 0)).toEqual([
      -4.5,
      -3,
      -3 + VERTICAL_FACE_INSET_M,
      0,
      3 - VERTICAL_FACE_INSET_M,
      3,
      4.5,
    ])
    expect(first[3][2]).toBeCloseTo(801.3, 6)
    expect(first[1][2]).toBeCloseTo(800.97, 6)
    expect(first[2][2]).toBeCloseTo(800.97 + 0.3 + 0.01 * (0.03 / 3), 6)
    for (const face of piece.faces) expect(planArea(face.map((i) => piece.points[i]))).toBeGreaterThan(0)
  })

  it('never bridges an incomplete section: the surface splits and says where', () => {
    const stations = [0, 20, 40, 60, 80, 100].map((c, i) => station(i, c, c !== 60))
    const { xml, notice, surface } = designSurfaceLandXml({
      kind: 'subgrade',
      name: 'Job',
      alignment,
      analysis: analysisOf(stations),
      terrain,
      toGrid,
      epsg: 3005,
    })
    expect(surface.pieces.map((p) => [p.from, p.to])).toEqual([
      [0, 40],
      [80, 100],
    ])
    expect(surface.gaps).toEqual([{ from: 40, to: 80, reason: 'ground missing' }])
    expect(notice).toMatch(/2 pieces: 0\+000\.0 to 0\+040\.0, 0\+080\.0 to 0\+100\.0/)
    expect(notice).toMatch(/No surface from 0\+040\.0 to 0\+080\.0 \(ground missing\)/)
    expect(xml).toMatch(/Spur 7 Subgrade part 2/)
    // No face reaches across the gap: the second piece holds only its own two sections.
    expect(surface.pieces[1].points).toHaveLength(10)
    expect(surface.pieces[1].faces).toHaveLength(8)
  })

  it('refuses a road with no two complete sections in a row', () => {
    const stations = [0, 20, 40].map((c, i) => station(i, c, c === 20))
    expect(() =>
      designSurfaceLandXml({
        kind: 'finished',
        name: 'Job',
        alignment,
        analysis: analysisOf(stations),
        terrain,
        toGrid,
        epsg: 3005,
      }),
    ).toThrow(/no two complete sections/)
  })

  it('writes LandXML 1.2 surfaces with points, faces and an outer boundary', () => {
    const { xml } = designSurfaceLandXml({
      kind: 'subgrade',
      name: 'Job & co',
      alignment,
      analysis: analysisOf([station(0, 0), station(1, 20), station(2, 40)]),
      terrain,
      toGrid,
      epsg: 3005,
    })
    const root = readXml(xml).children[0]
    const child = (node: XmlNode, name: string) => node.children.filter((c) => c.name === name)
    expect(root.name).toBe('LandXML')
    expect(root.attributes.version).toBe('1.2')
    expect(child(root, 'Units')[0].children[0].attributes.linearUnit).toBe('meter')
    expect(child(root, 'CoordinateSystem')[0].attributes).toMatchObject({
      epsgCode: '3005',
      verticalDatum: 'CGVD2013',
    })
    const surfaces = child(child(root, 'Surfaces')[0], 'Surface')
    expect(surfaces).toHaveLength(1)
    const [surface] = surfaces
    // LandXML 1.2 puts SourceData before Definition.
    expect(surface.children.map((c) => c.name)).toEqual(['SourceData', 'Definition'])
    const boundary = child(child(child(surface, 'SourceData')[0], 'Boundaries')[0], 'Boundary')[0]
    expect(boundary.attributes.bndType).toBe('outer')
    const ring = boundary.children[0]
    expect(ring.name).toBe('PntList3D')
    const coords = ring.text.trim().split(/\s+/).map(Number)
    expect(coords.length % 3).toBe(0)
    // Closed: first point repeated at the end.
    expect(coords.slice(0, 3)).toEqual(coords.slice(-3))
    const definition = child(surface, 'Definition')[0]
    expect(definition.attributes.surfType).toBe('TIN')
    const pnts = child(child(definition, 'Pnts')[0], 'P')
    const faces = child(child(definition, 'Faces')[0], 'F')
    expect(pnts).toHaveLength(15)
    expect(faces).toHaveLength(16)
    const ids = new Set(pnts.map((p) => p.attributes.id))
    expect(ids.size).toBe(15)
    for (const f of faces) {
      const refs = f.text.trim().split(/\s+/)
      expect(refs).toHaveLength(3)
      for (const r of refs) expect(ids.has(r)).toBe(true)
    }
    // Points are "northing easting level".
    const [n, e, z] = pnts[0].text.trim().split(/\s+/).map(Number)
    expect(e).toBeCloseTo(-4.5, 2)
    expect(n).toBeCloseTo(0, 2)
    expect(z).toBeCloseTo(799.97, 3)
  })

  it('refuses a road whose results leave out an invalid input', () => {
    const invalid = {
      ...analysisOf([station(0, 0), station(1, 20)]),
      invalidInput: { message: 'Fill slope must be positive.' },
    } as RoadAnalysis
    expect(() => designSurface('subgrade', alignment, invalid, toGrid)).toThrow(/Fill slope must be positive/)
  })

  it('builds from a calculated road, and splits it where the terrain has a gap', () => {
    const road: Alignment = {
      ...alignment,
      points: [
        { id: 'a', coordinate: origin, radiusM: 0 },
        { id: 'b', coordinate: offsetCoordinate(origin, 0, 300), radiusM: 0 },
      ],
      vertical: [
        { id: 'v0', chainage: 0, elevation: 801, curveLength: 0 },
        { id: 'v1', chainage: 300, elevation: 804, curveLength: 0 },
      ],
    }
    const gappy = {
      elevationAt: (_lng: number, lat: number) => {
        const north = (lat - origin[1]) * RAD * R
        return north > 120 && north < 160 ? NaN : 800
      },
    }
    const analysis = analyzeRoad(road, gappy, DEFAULT_ROAD_SETTINGS)
    expect(analysis.stations.some((s) => !s.complete)).toBe(true)
    const grid = exportGrid(terrain, origin)
    for (const kind of ['subgrade', 'finished'] as const) {
      const { surface } = designSurfaceLandXml({ kind, name: 'Job', alignment: road, analysis, terrain, ...grid })
      expect(surface.pieces.length).toBe(2)
      expect(surface.gaps).toHaveLength(1)
      const [gap] = surface.gaps
      expect(gap.from).toBeLessThanOrEqual(120)
      expect(gap.to).toBeGreaterThanOrEqual(160)
      for (const piece of surface.pieces) {
        expect(piece.folded).toBe(0)
        expect(piece.faces.length).toBeGreaterThan(0)
        expect(planArea(piece.boundary.map((i) => piece.points[i]))).toBeGreaterThan(0)
      }
    }
  })
})

describe('design surface on a curved road with ditches', () => {
  it('keeps every face upright and the break lines continuous through cut, fill and a 60 m curve', () => {
    const corner = offsetCoordinate(origin, 0, 200)
    const road: Alignment = {
      ...alignment,
      points: [
        { id: 'a', coordinate: origin, radiusM: 0 },
        { id: 'b', coordinate: corner, radiusM: 60 },
        { id: 'c', coordinate: offsetCoordinate(corner, 90, 200), radiusM: 0 },
      ],
      vertical: [
        { id: 'v0', chainage: 0, elevation: 799, curveLength: 0 },
        { id: 'v1', chainage: 200, elevation: 801, curveLength: 40 },
        { id: 'v2', chainage: 380, elevation: 799, curveLength: 0 },
      ],
      template: { ...template, ditchWidth: 1, ditchDepth: 0.5 },
    }
    const analysis = analyzeRoad(road, { elevationAt: () => 800 }, DEFAULT_ROAD_SETTINGS)
    const grid = exportGrid(terrain, origin)
    for (const kind of ['subgrade', 'finished'] as const) {
      const surface = designSurface(kind, road, analysis, grid.toGrid)
      expect(surface.gaps).toEqual([])
      expect(surface.pieces).toHaveLength(1)
      const [piece] = surface.pieces
      expect(piece.folded).toBe(0)
      expect(piece.faces.length).toBeGreaterThanOrEqual(2 * (analysis.stations.length - 1))
      // Every point is used by a face: nothing dangles.
      const used = new Set(piece.faces.flat())
      expect(used.size).toBe(piece.points.length)
    }
  })
})

describe('design surfaces in the export catalogue', () => {
  const ready: ExportContext = {
    designPreview: false,
    hasResults: true,
    terrainProfile: false,
    hasTerrainGrid: false,
    hasProvincialEvidence: false,
    hasStreams: false,
    hasCulverts: false,
    hasNotes: false,
  }
  it('is offered beside the LandXML alignment and refused on the same terms', () => {
    for (const kind of ['subgrade-landxml', 'finished-surface-landxml'] as const) {
      expect(exportUnavailable(kind, ready)).toBeNull()
      expect(exportUnavailable(kind, { ...ready, terrainProfile: true })).toMatch(/Return to the road/)
      expect(
        exportUnavailable(kind, {
          ...ready,
          invalidInput: () => ({ message: 'Road section: bad.', leftOut: 'input' }),
        }),
      ).toMatch(/Correct the invalid input/)
    }
  })
})
