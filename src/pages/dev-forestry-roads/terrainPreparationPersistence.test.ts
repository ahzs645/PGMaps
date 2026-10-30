import { describe, expect, it } from 'vitest'
import { writeArrayBuffer } from 'geotiff'
import {
  createDemoProject,
  parseTerrainReferenceSurfaces,
  preparedTerrain,
  terrainFromMetadata,
  terrainReferenceSurfaces,
} from './terrain'
import { parseProject, serializeProject } from './project'
import { loadTerrainBackground } from './terrainBackgroundImport'
import type { LocalRaster } from '../dev-forestry/types'

const source: LocalRaster = {
  id: 'source',
  name: 'Original ground',
  kind: 'terrain',
  epsg: 32610,
  origin: [500000, 6000000],
  pixelSize: [1, -1],
  width: 2,
  height: 2,
  values: [100, 101, 102, 103],
  acquired: '',
  verticalReference: 'CGVD2013',
  sha256: 'a'.repeat(64),
}
describe('prepared terrain project round trips', () => {
  it('keeps grid processing, named analytical surfaces and survey observations in the portable project', async () => {
    const loaded = await preparedTerrain(source, {
      operation: 'mosaic',
      sources: [
        { name: source.name, sha256: source.sha256, epsg: source.epsg, verticalReference: source.verticalReference },
      ],
      method: 'Native-resolution mosaic',
      parameters: { overlap: 'first' },
    })
    const project = createDemoProject()
    project.terrain = {
      ...loaded.metadata,
      referenceSurfaces: [{ id: 'surface:original', name: 'Original', raster: source }],
    }
    project.surveyBooks = [
      {
        id: 'observations',
        name: 'Measured survey',
        epsg: 32610,
        verticalReference: 'CGVD2013',
        input: {
          start: [500000, 6000000, 100],
          adjustment: 'none',
          legs: [{ id: 'A', bearingDegrees: 0, horizontalDistanceM: 20, gradePercent: 1 }],
        },
      },
    ]
    const reopened = parseProject(JSON.parse(serializeProject(project)))
    expect(reopened.terrain.preparation).toEqual(loaded.metadata.preparation)
    expect(reopened.terrain.referenceSurfaces).toEqual(project.terrain.referenceSurfaces)
    expect(reopened.surveyBooks).toEqual(project.surveyBooks)
    expect(terrainFromMetadata(reopened.terrain)).not.toBeNull()
    expect(Object.keys(terrainReferenceSurfaces(reopened.terrain))).toEqual(['surface:original'])
    expect(() =>
      parseTerrainReferenceSurfaces([{ id: 'chm', name: 'Display canopy', raster: { ...source, kind: 'canopy' } }]),
    ).toThrow(/Invalid terrain raster/)
  })
  it('uses the processing record in derived terrain identities', async () => {
    const record = {
      operation: 'mosaic' as const,
      sources: [
        { name: source.name, sha256: source.sha256, epsg: source.epsg, verticalReference: source.verticalReference },
      ],
      method: 'Mosaic',
      parameters: { overlap: 'first' },
    }
    const a = await preparedTerrain(source, record),
      b = await preparedTerrain(source, { ...record, parameters: { overlap: 'last' } })
    expect(a.metadata.sha256).not.toBe(b.metadata.sha256)
  })
  it('refuses a named analytical surface in a different vertical datum at parse and resolution boundaries', async () => {
    const record = {
      operation: 'mosaic' as const,
      sources: [
        { name: source.name, sha256: source.sha256, epsg: source.epsg, verticalReference: source.verticalReference },
      ],
      method: 'Mosaic',
      parameters: {},
    }
    const loaded = await preparedTerrain(source, record),
      mismatched = {
        id: 'surface:old-datum',
        name: 'Legacy CGVD28',
        raster: { ...source, verticalReference: 'CGVD28' },
      }
    expect(() => parseTerrainReferenceSurfaces([mismatched], 'CGVD2013')).toThrow(/different vertical datum/)
    expect(() => terrainReferenceSurfaces({ ...loaded.metadata, referenceSurfaces: [mismatched] })).toThrow(
      /different vertical datum/,
    )
    const project = createDemoProject()
    project.terrain = { ...loaded.metadata, referenceSurfaces: [mismatched] }
    expect(() => parseProject(project)).toThrow(/different vertical datum/)
    expect(
      parseTerrainReferenceSurfaces(
        [{ ...mismatched, raster: { ...source, verticalReference: ' CGVD2013 ' } }],
        'CGVD2013',
      ),
    ).toHaveLength(1)
  })
  it('imports a checked canopy image independently, preserving source data and transparency', async () => {
    const bytes = writeArrayBuffer([0, 10, 20, 255], {
      width: 2,
      height: 2,
      BitsPerSample: [8],
      SampleFormat: [1],
      SamplesPerPixel: [1],
      ModelPixelScale: [1, 1, 0],
      ModelTiepoint: [0, 0, 0, 500000, 6000000, 0],
      ProjectedCSTypeGeoKey: 32610,
      GTModelTypeGeoKey: 1,
      GTRasterTypeGeoKey: 1,
      GDAL_NODATA: '255',
    })
    const layer = await loadTerrainBackground(new File([bytes], 'canopy.tif'), 'canopy')
    expect(layer.kind).toBe('canopy')
    expect(layer.origin).toEqual([500000.5, 5999999.5])
    expect(layer.rgba[15]).toBe(0)
    expect(layer.rgba.slice(0, 4)).toEqual([245, 245, 230, 255])
    await expect(loadTerrainBackground(new File([bytes], 'single-band.tif'), 'ortho')).rejects.toThrow(
      /three RGB bands/,
    )
  })
})
