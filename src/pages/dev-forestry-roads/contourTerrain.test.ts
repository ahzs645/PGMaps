import { describe, expect, it } from 'vitest'
import type { PdfContourSurface } from '@/lib/geoPdf/contours'
import { contourTerrain, isContourTerrain } from './contourTerrain'
import { TerrainImportQuestion } from './terrain'
import { slopeRangeIndex, summarizeTerrainSlopeSteps } from './terrainSlopeClasses'
import { applyLayerImport, layerImportOptions, suggestedLayerRole } from './referenceImport'
import { createDemoProject } from './terrain'
import type { SpatialFile } from './spatialImport'
import proj4 from 'proj4'

// BC Albers, a 40 × 30 grid of 5 m cells rising 3 m per 10 m east: 30% slope everywhere.
const albers =
  '+proj=aea +lat_0=45 +lon_0=-126 +lat_1=50 +lat_2=58.5 +x_0=1000000 +y_0=0 +datum=NAD83 +units=m +no_defs'
const origin: [number, number] = [1_250_000, 1_000_000]
const surface: PdfContourSurface = {
  version: 1,
  epsg: 3005,
  cellM: 5,
  origin,
  width: 40,
  height: 30,
  values: Float32Array.from({ length: 1200 }, (_, i) => (i % 40 === 39 ? NaN : 900 + 0.3 * 5 * (i % 40))),
  assignment: {
    interval: 10,
    labels: 4,
    labelsOnLines: 4,
    labelsRejected: 0,
    conflicts: 0,
    labelledLines: 4,
    inferredLines: 2,
    unassignedLines: 0,
  },
  vertices: 100,
  method: 'tin',
  notes: [],
}
const source = {
  file: 'Maps/Field_Layout.pdf',
  sha256: 'a'.repeat(64),
  page: 1,
  layer: 'Contours',
  profile: 'test',
  registrationErrorM: 0.1,
}
const lonLat = (x: number, y: number) => proj4(albers, 'EPSG:4326', [x, y]) as [number, number]

describe('terrain from a sheet’s contours', () => {
  it('asks for the vertical datum the sheet does not print', () => {
    expect(() => contourTerrain(surface, source, '')).toThrow(TerrainImportQuestion)
  })
  it('becomes a BC Albers terrain raster with missing cells kept missing', () => {
    const { metadata, source: terrain } = contourTerrain(surface, source, 'CGVD2013')
    expect(metadata).toMatchObject({ kind: 'geotiff', epsg: 3005, verticalReference: 'CGVD2013', resolutionM: 5 })
    expect(isContourTerrain(metadata.raster)).toBe(true)
    expect(metadata.raster!.values[39]).toBeNull()
    expect(terrain.elevationAt(...lonLat(origin[0] + 50, origin[1] - 50))).toBeCloseTo(915, 1)
  })
  it('is only ever offered as terrain, and adds no layer when imported', () => {
    const file: SpatialFile = {
      fileName: 'Maps/Field_Layout.pdf/Page 1/Terrain from contours',
      format: 'GeoPDF',
      crs: 'Embedded',
      collection: { type: 'FeatureCollection', features: [] },
      pdf: { source, note: '', selected: false, contourSurface: surface },
    }
    expect(layerImportOptions(file)).toEqual(['terrain'])
    expect(suggestedLayerRole(file)).toBe('terrain')
    const project = createDemoProject()
    const result = applyLayerImport(project, [{ file, role: 'terrain' }], () => 'id')
    expect(result.imported).toHaveLength(0)
    expect(result.project.reference ?? []).toHaveLength(project.reference?.length ?? 0)
  })
})

describe('slope classes from terrain', () => {
  const ranges = [
    { minimum: 20, maximum: 30 },
    { minimum: 30, maximum: 35 },
    { minimum: 85, maximum: null },
    { minimum: 95, maximum: null },
  ]
  it('puts overlapping open ranges in the one with the highest minimum', () => {
    expect(slopeRangeIndex(ranges, 10)).toBe(-1)
    expect(slopeRangeIndex(ranges, 30)).toBe(1)
    expect(slopeRangeIndex(ranges, 90)).toBe(2)
    expect(slopeRangeIndex(ranges, 97)).toBe(3)
  })
  it('counts terrain cells inside the area by the sheet’s ranges, and missing terrain as not known', () => {
    const { metadata } = contourTerrain(surface, source, 'CGVD2013')
    // 100 m × 100 m square from the second cell column; its east edge reaches the missing column.
    const [x0, y0] = [origin[0] + 97.5, origin[1] - 102.5]
    const ring = [
      [x0, y0],
      [x0 + 100, y0],
      [x0 + 100, y0 + 100],
      [x0, y0 + 100],
      [x0, y0],
    ].map(([x, y]) => lonLat(x, y))
    const steps = summarizeTerrainSlopeSteps(metadata.raster!, { type: 'Polygon', coordinates: [ring] }, ranges)
    let step = steps.next()
    while (!step.done) step = steps.next()
    const result = step.value
    expect(result.areaM2).toBeCloseTo(400 * 25, -2)
    // 30% sits on the 30–35 boundary of the published ranges: the class above it.
    expect(result.classM2[1]).toBeGreaterThan(result.areaM2 * 0.8)
    expect(result.missingM2).toBeGreaterThan(0)
    expect(result.belowM2).toBe(0)
  })
})
