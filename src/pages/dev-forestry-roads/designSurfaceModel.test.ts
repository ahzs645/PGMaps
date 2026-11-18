import { describe, expect, it } from 'vitest'
import { analyzeRoad, offsetCoordinate } from './engine'
import { designSurfaceLandXml } from './designSurfaceExport'
import { designSurfaceModel, designSurfaceModelExport, DESIGN_SURFACE_MODEL_COLOURS } from './designSurfaceModel'
import { readXml, type XmlNode } from './landXmlImport'
import { DEFAULT_ROAD_SETTINGS } from './terrain'
import type { Alignment, Coordinate, RoadAnalysis, RoadStation, RoadTemplate, TerrainMetadata } from './types'
import type { MeshPart } from '@/lib/model3d/model'

// The fixtures of `designSurfaceExport.test.ts`: a straight road north from the origin.
const origin: Coordinate = [-122.8, 53.9]
const R = 6371008.8,
  RAD = Math.PI / 180
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

/** Each LandXML `<Surface>`'s name and face count. */
function landXmlSurfaces(xml: string): { name: string; faces: number; points: number[][] }[] {
  const child = (node: XmlNode, name: string) => node.children.filter((c) => c.name === name)
  const root = readXml(xml).children[0]
  return child(child(root, 'Surfaces')[0], 'Surface').map((surface) => {
    const definition = child(surface, 'Definition')[0]
    return {
      name: surface.attributes.name,
      faces: child(child(definition, 'Faces')[0], 'F').length,
      // LandXML points are northing, easting, level.
      points: child(child(definition, 'Pnts')[0], 'P').map((p) => {
        const [n, e, z] = p.text.trim().split(/\s+/).map(Number)
        return [e, n, z]
      }),
    }
  })
}

/** Plan area of each face, counter-clockwise positive, in local x/y. */
const faceAreas = (part: MeshPart) => {
  const p = part.positions,
    out: number[] = []
  for (let t = 0; t < part.indices.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => part.indices[t + k])
    out.push(
      ((p[b * 3] - p[a * 3]) * (p[c * 3 + 1] - p[a * 3 + 1]) - (p[c * 3] - p[a * 3]) * (p[b * 3 + 1] - p[a * 3 + 1])) /
        2,
    )
  }
  return out
}

const gappy = {
  elevationAt: (_lng: number, lat: number) => {
    const north = (lat - origin[1]) * RAD * R
    return north > 120 && north < 160 ? NaN : 800
  },
}
const longRoad: Alignment = {
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

describe('design surface model', () => {
  it('is the LandXML surfaces face for face and point for point', () => {
    const analysis = analysisOf([station(0, 0), station(1, 20), station(2, 40)])
    const model = designSurfaceModel({ alignment, analysis, terrain, toGrid, epsg: 3005 })
    const o = model.origin
    if (o.kind !== 'grid') throw Error('grid origin expected')
    for (const kind of ['subgrade', 'finished'] as const) {
      const { xml } = designSurfaceLandXml({ kind, name: 'Job', alignment, analysis, terrain, toGrid, epsg: 3005 })
      const surfaces = landXmlSurfaces(xml)
      const parts = model.parts.filter((p) => p.attributes?.surface === kind)
      expect(parts.map((p) => p.name)).toEqual(surfaces.map((s) => s.name))
      parts.forEach((part, i) => {
        expect(part.indices.length / 3).toBe(surfaces[i].faces)
        // Local metres plus the origin are the LandXML's grid points (to its millimetres).
        surfaces[i].points.forEach(([e, n, z], k) => {
          expect(part.positions[k * 3] + o.easting).toBeCloseTo(e, 3)
          expect(part.positions[k * 3 + 1] + o.northing).toBeCloseTo(n, 3)
          expect(part.positions[k * 3 + 2] + o.elevation).toBeCloseTo(z, 3)
        })
      })
    }
    expect(model.parts.map((p) => p.name)).toEqual(['Spur 7 Subgrade', 'Spur 7 Finished surface'])
    // Every face faces up (counter-clockwise from above), and the parts are flat-shaded.
    for (const part of model.parts) {
      for (const area of faceAreas(part)) expect(area).toBeGreaterThan(0)
      expect(part.normals).toBeUndefined()
    }
  })

  it('places itself back: grid origin with EPSG, a whole-metre centre and the lowest level rounded down', () => {
    const model = designSurfaceModel({
      alignment,
      analysis: analysisOf([station(0, 0), station(1, 20)]),
      terrain,
      toGrid,
      epsg: 3005,
    })
    expect(model.origin).toEqual({
      kind: 'grid',
      epsg: 3005,
      easting: 0,
      northing: 10,
      elevation: 799,
      verticalDatum: 'CGVD2013',
    })
    for (const part of model.parts)
      for (let i = 2; i < part.positions.length; i += 3) expect(part.positions[i]).toBeGreaterThanOrEqual(0)
    expect(model.notes.join(' ')).toMatch(/not a construction design/)
    expect(model.parts[0].color).toEqual([0xb5 / 255, 0x91 / 255, 0x6a / 255])
    expect(DESIGN_SURFACE_MODEL_COLOURS.subgrade).toBe('#b5916a')
    // These hand-made sections stop at their catch points, so there is no ground beside them.
    expect(model.parts.some((p) => p.attributes?.surface === 'ground')).toBe(false)
    expect(model.notes).toContain('Ground left out: no section had ground samples outside its catch points.')
  })

  it('breaks where a section is incomplete, as the LandXML does, and says where', () => {
    const stations = [0, 20, 40, 60, 80, 100].map((c, i) => station(i, c, c !== 60))
    const model = designSurfaceModel({ alignment, analysis: analysisOf(stations), terrain, toGrid, epsg: 3005 })
    expect(model.parts.map((p) => p.name)).toEqual([
      'Spur 7 Subgrade part 1',
      'Spur 7 Subgrade part 2',
      'Spur 7 Finished surface part 1',
      'Spur 7 Finished surface part 2',
    ])
    expect(model.parts.map((p) => [p.attributes?.from, p.attributes?.to])).toEqual([
      ['0+000.0', '0+040.0'],
      ['0+080.0', '0+100.0'],
      ['0+000.0', '0+040.0'],
      ['0+080.0', '0+100.0'],
    ])
    expect(model.notes.join(' ')).toMatch(/No surface from 0\+040\.0 to 0\+080\.0 \(ground missing\)/)
  })

  it("adds the ground beside a calculated road from the sections' own samples, never across the road or a gap", () => {
    const analysis = analyzeRoad(longRoad, gappy, DEFAULT_ROAD_SETTINGS)
    const model = designSurfaceModel({ alignment: longRoad, analysis, terrain, toGrid, epsg: 3005 })
    if (model.origin.kind !== 'grid') throw Error('grid origin expected')
    const { easting, northing } = model.origin
    const ground = model.parts.find((p) => p.attributes?.surface === 'ground')!
    expect(ground.name).toBe('Spur 7 Ground beside the road')
    expect(ground.indices.length).toBeGreaterThan(0)
    for (const area of faceAreas(ground)) expect(area).toBeGreaterThan(0)
    const subgrade = designSurfaceLandXml({
      kind: 'subgrade',
      name: 'Job',
      alignment: longRoad,
      analysis,
      terrain,
      toGrid,
      epsg: 3005,
    })
    const [gap] = subgrade.surface.gaps
    const daylight = Math.min(
      ...analysis.stations.filter((s) => s.complete).flatMap((s) => [s.leftDaylightM ?? 0, s.rightDaylightM ?? 0]),
    )
    expect(daylight).toBeGreaterThan(0)
    for (let i = 0; i < ground.positions.length; i += 3) {
      const east = ground.positions[i] + easting,
        north = ground.positions[i + 1] + northing
      // Outside the catch points (the road runs north along x = 0) and not inside the terrain gap.
      expect(Math.abs(east)).toBeGreaterThanOrEqual(daylight - 1e-3)
      expect(north <= gap.from + 1e-3 || north >= gap.to - 1e-3).toBe(true)
    }
    // The surfaces still match the LandXML piece for piece.
    const subgradeFaces = model.parts
      .filter((p) => p.attributes?.surface === 'subgrade')
      .map((p) => p.indices.length / 3)
    expect(subgradeFaces).toEqual(subgrade.surface.pieces.map((p) => p.faces.length))
    expect(model.parts.filter((p) => p.attributes?.surface === 'subgrade')).toHaveLength(2)

    const without = designSurfaceModel({ alignment: longRoad, analysis, terrain, toGrid, epsg: 3005, ground: false })
    expect(without.parts.some((p) => p.attributes?.surface === 'ground')).toBe(false)
    expect(without.notes).toContain('Ground left out.')
  })

  it('writes each format in one call', () => {
    const input = {
      alignment,
      analysis: analysisOf([station(0, 0), station(1, 20)]),
      terrain,
      toGrid,
      epsg: 3005,
    }
    const glb = designSurfaceModelExport(input, 'glb')
    expect(glb.files.map((f) => f.name)).toEqual(['Spur-7-design-surfaces.glb'])
    const view = new DataView(glb.files[0].bytes.buffer)
    expect(view.getUint32(8, true)).toBe(glb.files[0].bytes.byteLength)
    const obj = designSurfaceModelExport(input, 'obj')
    expect(obj.files.map((f) => f.name)).toEqual(['Spur-7-design-surfaces.obj', 'Spur-7-design-surfaces.mtl'])
    const stl = designSurfaceModelExport(input, 'stl')
    // Subgrade 8 faces, finished surface 12.
    expect(new DataView(stl.files[0].bytes.buffer).getUint32(80, true)).toBe(8 + 12)
    expect(stl.notes.join(' ')).toMatch(/EPSG:3005/)
  })

  it('refuses a road with no surface or an invalid input', () => {
    expect(() =>
      designSurfaceModel({
        alignment,
        analysis: analysisOf([0, 20, 40].map((c, i) => station(i, c, c === 20))),
        terrain,
        toGrid,
        epsg: 3005,
      }),
    ).toThrow(/no two complete sections/)
    const invalid = {
      ...analysisOf([station(0, 0), station(1, 20)]),
      invalidInput: { message: 'Fill slope must be positive.' },
    } as RoadAnalysis
    expect(() => designSurfaceModel({ alignment, analysis: invalid, terrain, toGrid, epsg: 3005 })).toThrow(
      /Fill slope must be positive/,
    )
  })
})
