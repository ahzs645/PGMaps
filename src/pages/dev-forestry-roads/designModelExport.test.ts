import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { MODEL_FORMATS } from '@/lib/model3d/writeModel'
import { offsetCoordinate } from './engine'
import {
  designModelFile,
  designModelNotice,
  designModelPreviewHtml,
  MODEL_PREVIEW_MAX_TRIANGLES,
} from './designModelExport'
import { DESIGN_MODEL_FORMATS } from './exportFiles'
import type { Alignment, Coordinate, RoadAnalysis, RoadStation, TerrainMetadata } from './types'

// A straight road north from the origin, as `designSurfaceModel.test.ts` builds it.
const origin: Coordinate = [-122.8, 53.9]
const R = 6371008.8,
  RAD = Math.PI / 180
const toGrid = ([lng, lat]: Coordinate): [number, number] => [
  (lng - origin[0]) * RAD * R * Math.cos(origin[1] * RAD),
  (lat - origin[1]) * RAD * R,
]
const terrain: TerrainMetadata = { kind: 'demo', name: 'Flat', resolutionM: 1, verticalReference: 'CGVD2013' }
function station(index: number, chainage: number): RoadStation {
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
    section: [
      { offset: -8, design: null, ground: z - 1.2 },
      ...design.map(([offset, level]) => ({ offset, design: level, ground: Math.abs(offset) === 4.5 ? level : z - 1 })),
      { offset: 8, design: null, ground: z - 1.2 },
    ],
    cutAreaM2: 0,
    fillAreaM2: 5,
    cutVolumeM3: null,
    fillVolumeM3: null,
    massM3: null,
    leftDaylightM: 4.5,
    rightDaylightM: 4.5,
    complete: true,
    flags: [],
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
  template: {
    leftWidth: 3,
    rightWidth: 3,
    crossfallPercent: 0,
    cutSlope: 1,
    fillSlope: 1.5,
    ditchWidth: 0,
    ditchDepth: 0,
    surfaceDepth: 0.3,
  },
  overrides: [],
}
const analysis = {
  stations: [station(0, 0), station(1, 20), station(2, 40)],
  length: 40,
} as unknown as RoadAnalysis
const input = { alignment, analysis, terrain, toGrid, epsg: 3005, projectName: 'Job' }

describe('3D surface model file', () => {
  it('names its file by format, and its glTF and STL types are the writers’ own', () => {
    expect(designModelFile(input, 'glb', 'Job').filename).toBe('Job-design-surfaces.glb')
    expect(designModelFile(input, 'stl', 'Job').filename).toBe('Job-design-surfaces.stl')
    for (const format of ['glb', 'stl'] as const)
      expect(DESIGN_MODEL_FORMATS.find((f) => f.value === format)?.mime).toBe(MODEL_FORMATS[format].mime)
    const glb = designModelFile(input, 'glb', 'Job')
    expect(String.fromCharCode(...glb.bytes.slice(0, 4))).toBe('glTF')
  })

  it('zips the OBJ with the .mtl it names, side by side', () => {
    const file = designModelFile(input, 'obj', 'Job')
    expect(file.filename).toBe('Job-design-surfaces.zip')
    expect(file.mime).toBe('application/zip')
    const files = unzipSync(file.bytes)
    expect(Object.keys(files).sort()).toEqual(['Job-design-surfaces.mtl', 'Job-design-surfaces.obj'])
    expect(strFromU8(files['Job-design-surfaces.obj'])).toContain('mtllib Job-design-surfaces.mtl')
  })

  it('says it is a picture of the surfaces, where it sits and what it leaves out', () => {
    const file = designModelFile(input, 'glb', 'Job')
    const notice = designModelNotice(file)
    expect(notice).toMatch(/^3D surface model downloaded: glTF \(\.glb\), \d+ parts, [\d,]+ triangles\./)
    expect(notice).toContain('not a machine-control file: build from the LandXML surfaces')
    expect(notice).toContain('EPSG:3005')
  })

  it('previews the parts in plan with the same notes', () => {
    const file = designModelFile(input, 'stl', 'Job')
    const html = designModelPreviewHtml(file)
    expect(html).toContain('<svg')
    expect(html).toContain('Spur 7 Subgrade')
    expect(html).toContain('Spur 7 Ground beside the road')
    expect(html).toContain('EPSG:3005')
    expect(MODEL_PREVIEW_MAX_TRIANGLES).toBeGreaterThan(1000)
  })

  it('is refused like the LandXML surfaces: no surface, or an invalid input', () => {
    const invalid = { ...analysis, invalidInput: { message: 'Fill slope must be positive.', leftOut: 'input' } }
    expect(() => designModelFile({ ...input, analysis: invalid as RoadAnalysis }, 'glb', 'Job')).toThrow(
      /not exported: an input is invalid/,
    )
    const single = { stations: [station(0, 0)], length: 0 } as unknown as RoadAnalysis
    expect(() => designModelFile({ ...input, analysis: single }, 'glb', 'Job')).toThrow(/no two complete sections/)
  })
})
