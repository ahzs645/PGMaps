import { describe, expect, it, vi } from 'vitest'
import { writeArrayBuffer } from 'geotiff'
import { BARREL_RING_SIDES } from './culvertBarrel'
import { stationOffsetCoordinate } from './designExports'
import { analyzeRoad, offsetCoordinate } from './engine'
import { createEngineeringDesign, type Culvert } from './engineeringTypes'
import { DEFAULT_ROAD_SETTINGS, roadProjection } from './terrain'
import { loadTerrainBackground } from './terrainBackgroundImport'
import { terrainMesh, type TerrainVertex } from './terrainMesh'
import * as sceneGeometry from './terrainSceneGeometry'
import { terrainScenePresentation } from './terrainScenePresentation'
import type { Alignment, Coordinate, TerrainMetadata } from './types'
import { DEFAULT_DESIGN_STANDARDS, gradeRule, reviewGrades } from './designStandards'

type PresentationInput = Parameters<typeof terrainScenePresentation>[0]
const origin: Coordinate = [-122.7, 53.9]
const metadata: TerrainMetadata = {
  kind: 'geotiff',
  name: 'Survey ground',
  epsg: 3005,
  resolutionM: 2,
  verticalReference: 'CGVD2013',
}

/** A 100 m northbound road, in a 10 m deep cut with 1:1 batters and a known finished depth. */
function fixture({
  groundAt = () => 800,
  culverts = [],
}: {
  groundAt?: (x: number, y: number) => number
  culverts?: Culvert[]
} = {}) {
  const frame = sceneGeometry.terrainSceneFrame(metadata, origin)
  const source = vi.fn((lon: number, lat: number) => groundAt(...frame.point([lon, lat])))
  const alignment: Alignment = {
    id: 'road',
    name: 'Test cut',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: offsetCoordinate(origin, 0, 100), radiusM: 0 },
    ],
    vertical: [
      { id: 'v0', chainage: 0, elevation: 790, curveLength: 0 },
      { id: 'v1', chainage: 100, elevation: 790, curveLength: 0 },
    ],
    template: {
      leftWidth: 3,
      rightWidth: 3,
      crossfallPercent: 0,
      cutSlope: 1,
      fillSlope: 1,
      ditchWidth: 0,
      ditchDepth: 0,
      surfaceDepth: 0.3,
    },
    overrides: [],
    engineering: { ...createEngineeringDesign(), culverts },
  }
  const analysis = analyzeRoad(
    alignment,
    { elevationAt: source },
    { ...DEFAULT_ROAD_SETTINGS, stationInterval: 10, crossSectionHalfWidth: 30 },
  )
  const design = sceneGeometry.terrainSceneGeometry({ kind: 'finished', alignment, analysis, frame })
  const bounds = [-30, -10, 30, 110]
  const mesh = terrainMesh(bounds, (x, y) => source(...frame.coordinate(x, y)), [], false, { minSpacing: 2 })
  const at = (chainage: number, offset = 0) => {
    const station = analysis.stations.reduce((best, next) =>
      Math.abs(next.chainage - chainage) < Math.abs(best.chainage - chainage) ? next : best,
    )
    const [x, y] = frame.point(stationOffsetCoordinate(station, offset))
    return { x, y, z: station.designElevation! }
  }
  const geometry: PresentationInput['geometry'] = {
    frame,
    ground: mesh.faces.map((vertices) => ({ vertices, fill: '#829876' })),
    road: analysis.stations.slice(1).map((station, i) => ({
      vertices: [
        at(analysis.stations[i].chainage, -3),
        at(analysis.stations[i].chainage, 3),
        at(station.chainage, 3),
        at(station.chainage, -3),
      ],
      fill: '#d9b27c',
    })),
    earthwork: [],
    ditches: [],
    line: analysis.stations.map((station, i) => ({
      vertex: at(station.chainage),
      chainage: station.chainage,
      connected: i > 0,
    })),
    groundLow: 800,
    groundHigh: 800,
    low: 790,
    bounds,
  }
  const input: PresentationInput = {
    geometry,
    design,
    analysis,
    culvertDesigns: culverts,
    terrainOnly: false,
    colour: 'slope',
    showEarthwork: true,
  }
  return { input, source, frame, at }
}

const covers = (faces: Array<{ vertices: TerrainVertex[] }>, point: Pick<TerrainVertex, 'x' | 'y'>) =>
  faces.some(({ vertices }) => {
    const signs = vertices.map((a, i) => {
      const b = vertices[(i + 1) % vertices.length]
      return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)
    })
    return signs.every((value) => value >= -1e-7) || signs.every((value) => value <= 1e-7)
  })

const culvert = (patch: Partial<Culvert> = {}): Culvert => ({
  id: 'c1',
  name: 'Three box barrels',
  chainage: 50,
  skewDegrees: 17,
  lengthM: 20,
  diameterM: 1.2,
  shape: 'box',
  spanM: 2.4,
  barrels: 3,
  inletInvertM: 786.8,
  outletInvertM: 786.4,
  minCoverM: 0.5,
  unitCost: 100,
  fixedCost: 500,
  ...patch,
})

describe('the GPU terrain scene presentation', () => {
  it('uses reviewed grade runs on simplified lines, including a skipped adverse breach', () => {
    const { input } = fixture()
    const stations = input.analysis.stations
    stations.forEach((station) => {
      station.gradePercent = station.index === 1 ? 10 : 0
    })
    const rule = gradeRule(
      { maxGradePercent: 12 },
      { ...DEFAULT_DESIGN_STANDARDS, loadedDirection: 'start-to-end', adverseGradePercent: 8 },
    )
    const flags = reviewGrades(stations, rule, 'ahead').flags
    stations.forEach((station, i) => {
      station.flags = flags.has(i) ? [flags.get(i)!] : []
    })
    input.geometry.line = [input.geometry.line[0], input.geometry.line[3], input.geometry.line.at(-1)!]
    input.maxGradePercent = 12
    input.gradeSpan = 'ahead'
    const result = terrainScenePresentation(input)
    expect(result.data.lines.map((line) => line.color)).toEqual(['#dc5a51', '#1e8790'])

    // The same uphill run is allowed by a short-pitch rule, without changing its signed grade.
    const permitted = reviewGrades(stations, { ...rule, shortPitch: { gradePercent: 16, maxLengthM: 20 } }, 'ahead')
    expect(permitted.flags.size).toBe(0)
    stations.forEach((station) => {
      station.flags = []
    })
    expect(terrainScenePresentation(input).data.lines.map((line) => line.color)).toEqual(['#1e8790', '#1e8790'])
  })

  it('maps an imported PixelIsArea orthophoto into another CRS at its corners and pixel centres', async () => {
    const { input, frame, source } = fixture()
    const projection = roadProjection(32610)
    const [easting, northing] = projection.forward([...origin])
    const west = Math.floor(easting / 10) * 10 - 10
    const north = Math.ceil(northing / 20) * 20 + 20
    // Different colours in every position reveal a flipped row or a missing half-pixel shift.
    const rgb = [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0, 255, 0, 255, 0, 255, 255]
    const bytes = writeArrayBuffer(rgb, {
      width: 3,
      height: 2,
      BitsPerSample: [8, 8, 8],
      SampleFormat: [1, 1, 1],
      SamplesPerPixel: [3],
      PhotometricInterpretation: 2,
      ModelPixelScale: [10, 20, 0],
      ModelTiepoint: [0, 0, 0, west, north, 0],
      ProjectedCSTypeGeoKey: 32610,
      GTModelTypeGeoKey: 1,
      GTRasterTypeGeoKey: 1,
    })
    const imported = await loadTerrainBackground(new File([bytes], 'six-pixels.tif'), 'ortho')
    const ortho = { ...imported, opacity: 0.37 }
    const before = structuredClone(ortho)
    const samples = source.mock.calls.length
    const { data } = terrainScenePresentation({ ...input, colour: 'ortho', ortho })
    expect(imported.origin).toEqual([west + 5, north - 10])
    expect(imported.pixelSize).toEqual([10, -20])
    expect(frame.epsg).not.toBe(ortho.epsg)
    const uv = (x: number, y: number) => data.imagePoint!(...frame.point(projection.inverse([x, y]) as Coordinate))
    const corner = uv(west, north)
    expect(corner[0]).toBeCloseTo(0, 7)
    expect(corner[1]).toBeCloseTo(0, 7)
    const far = uv(west + 30, north - 40)
    expect(far[0]).toBeCloseTo(1, 7)
    expect(far[1]).toBeCloseTo(1, 7)
    for (let row = 0; row < 2; row++)
      for (let col = 0; col < 3; col++) {
        const point = uv(west + (col + 0.5) * 10, north - (row + 0.5) * 20)
        expect(point[0]).toBeCloseTo((col + 0.5) / 3, 7)
        expect(point[1]).toBeCloseTo((row + 0.5) / 2, 7)
        const pixel = row * 3 + col
        expect(data.ortho!.rgba.slice(pixel * 4, pixel * 4 + 4)).toEqual([...rgb.slice(pixel * 3, pixel * 3 + 3), 255])
      }
    expect(uv(west - 10, north + 20)[0]).toBeLessThan(0)
    expect(uv(west - 10, north + 20)[1]).toBeLessThan(0)
    expect(data.ortho).toBe(ortho)
    expect(ortho).toEqual(before)
    expect(data.ortho!.opacity).toBe(0.37)
    expect(source.mock.calls).toHaveLength(samples)
  })

  it('draws every entered barrel at the calculated inlet and outlet elevations', () => {
    const entered = culvert()
    const { input, frame, source } = fixture({ culverts: [entered] })
    const before = JSON.stringify(input.analysis)
    const samples = source.mock.calls.length
    const { data } = terrainScenePresentation(input)
    const calculated = input.analysis.engineering!.culverts[0]
    expect(data.culverts).toHaveLength(1)
    const drawn = data.culverts[0]
    expect(drawn.id).toBe(calculated.id)
    expect(drawn.station).toBe(calculated.chainage)
    expect(drawn.faces).toHaveLength(entered.barrels! * BARREL_RING_SIDES)
    const inlets: Array<[number, number]> = []
    const outlets: Array<[number, number]> = []
    for (let n = 0; n < entered.barrels!; n++) {
      const sides = drawn.faces.slice(n * BARREL_RING_SIDES, (n + 1) * BARREL_RING_SIDES)
      const inlet = sides.map((face) => face.vertices[0])
      const outlet = sides.map((face) => face.vertices[3])
      expect(Math.min(...inlet.map((p) => p.z))).toBeCloseTo(entered.inletInvertM!, 9)
      expect(Math.max(...inlet.map((p) => p.z))).toBeCloseTo(entered.inletInvertM! + entered.diameterM, 9)
      expect(Math.min(...outlet.map((p) => p.z))).toBeCloseTo(entered.outletInvertM!, 9)
      expect(Math.max(...outlet.map((p) => p.z))).toBeCloseTo(entered.outletInvertM! + entered.diameterM, 9)
      const centre = (ring: TerrainVertex[]): [number, number] => [
        ring.reduce((sum, point) => sum + point.x, 0) / ring.length,
        ring.reduce((sum, point) => sum + point.y, 0) / ring.length,
      ]
      inlets.push(centre(inlet))
      outlets.push(centre(outlet))
    }
    for (let i = 1; i < inlets.length; i++)
      expect(Math.hypot(inlets[i][0] - inlets[i - 1][0], inlets[i][1] - inlets[i - 1][1])).toBeGreaterThan(
        entered.spanM!,
      )
    // Schematic side-by-side spacing must not move the site axis away from its calculated location.
    for (const [centres, coordinate] of [
      [inlets, calculated.profile[0].coordinate],
      [outlets, calculated.profile[calculated.profile.length - 1].coordinate],
    ] as const) {
      const expected = frame.point(coordinate)
      expect(centres.reduce((sum, c) => sum + c[0], 0) / centres.length).toBeCloseTo(expected[0], 8)
      expect(centres.reduce((sum, c) => sum + c[1], 0) / centres.length).toBeCloseTo(expected[1], 8)
    }
    expect(JSON.stringify(input.analysis)).toBe(before)
    expect(source.mock.calls).toHaveLength(samples)
  })

  it('leaves an incomplete design interval open without filling a missing source strip', () => {
    const groundAt = (x: number, y: number) => (x < -7 && y > 44 && y < 56 ? NaN : 800)
    const { input, at, source } = fixture({ groundAt })
    expect(input.design!.status).toBe('partial')
    expect(input.design!.pieces).toHaveLength(2)
    const before = JSON.stringify({ analysis: input.analysis, geometry: input.geometry })
    const samples = source.mock.calls.length
    const result = terrainScenePresentation(input)
    expect(result.data.design).toBe(input.design)
    expect(result.notice).toContain('incomplete stretch')
    expect(covers(input.geometry.ground, at(20))).toBe(true)
    expect(covers(result.data.ground, at(20))).toBe(false)
    expect(covers(result.data.ground, at(50))).toBe(true)
    expect(covers(input.geometry.ground, at(50, -10))).toBe(false)
    expect(covers(result.data.ground, at(50, -10))).toBe(false)
    // The ground keeps its level: on flat ground the seam moves a vertex by rounding only, never to the open end of
    // the incomplete stretch a metre or two below it.
    expect(result.data.ground.every((face) => face.vertices.every((v) => Math.abs(v.z - 800) < 1e-6))).toBe(true)
    expect(source.mock.calls).toHaveLength(samples)
    expect(Number.isNaN(groundAt(-10, 50))).toBe(true)
    expect(JSON.stringify({ analysis: input.analysis, geometry: input.geometry })).toBe(before)
  })

  it('keeps ground over hidden batters while opening only the visible formation', () => {
    const { input, at } = fixture()
    expect(input.design!.status).toBe('ready')
    const withBatters = terrainScenePresentation(input)
    const formationOnly = terrainScenePresentation({ ...input, showEarthwork: false })
    expect(withBatters.data.design).toBe(input.design)
    expect(formationOnly.data.design).toBeNull()
    expect(formationOnly.data.road).toBe(input.geometry.road)
    expect(covers(input.geometry.ground, at(50, 8))).toBe(true)
    expect(covers(withBatters.data.ground, at(50, 8))).toBe(false)
    expect(covers(formationOnly.data.ground, at(50, 8))).toBe(true)
    expect(covers(formationOnly.data.ground, at(50))).toBe(false)
    expect(covers(formationOnly.data.ground, at(50, 20))).toBe(true)
  })

  it('reports a clipping budget failure and retains the complete ground with a simplified road', () => {
    const { input, source } = fixture()
    const samples = source.mock.calls.length
    const before = JSON.stringify(input.geometry.ground)
    const clip = vi.spyOn(sceneGeometry, 'clipTerrainToDesign').mockImplementationOnce(() => {
      throw Error('The cut 3D terrain exceeds this view’s face budget.')
    })
    try {
      const result = terrainScenePresentation(input)
      expect(result.notice).toContain('face budget')
      expect(result.notice).toContain('Showing the simplified formation')
      expect(result.requiresCanvas).toBe(true)
      expect(result.data.design).toBeNull()
      expect(result.data.ground).toBe(input.geometry.ground)
      expect(result.data.road).toBe(input.geometry.road)
      expect(JSON.stringify(input.geometry.ground)).toBe(before)
      expect(source.mock.calls).toHaveLength(samples)
    } finally {
      clip.mockRestore()
    }
  })

  it('does not invent a barrel when the entered outlet elevation is unknown', () => {
    const { input } = fixture({ culverts: [culvert({ outletInvertM: null })] })
    expect(input.analysis.engineering!.culverts[0].profile.some((p) => p.invertElevation === null)).toBe(true)
    expect(terrainScenePresentation(input).data.culverts).toHaveLength(0)
  })
})
