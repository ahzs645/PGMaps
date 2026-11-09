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
import {
  BACKGROUND_LAYER_PIXELS,
  MAX_BACKGROUND_PIXELS,
  parseTerrainBackgrounds,
  resampleBackground,
} from './terrainPreparation'
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
    expect(layer.sourceSize).toBeUndefined()
  })

  /** A single-band canopy GeoTIFF of `width` × `height` 1 m pixels: 20 m everywhere, no-data in the first column. */
  const canopy = (width: number, height: number) =>
    new File(
      [
        writeArrayBuffer(
          Array.from({ length: width * height }, (_, i) => (i % width === 0 ? 255 : 20)),
          {
            width,
            height,
            BitsPerSample: [8],
            SampleFormat: [1],
            SamplesPerPixel: [1],
            ModelPixelScale: [1, 1, 0],
            ModelTiepoint: [0, 0, 0, 511800, 5972400, 0],
            ProjectedCSTypeGeoKey: 3157,
            GTModelTypeGeoKey: 1,
            GTRasterTypeGeoKey: 1,
            GDAL_NODATA: '255',
          },
        ) as ArrayBuffer,
      ],
      'CHM-Image.tif',
    )

  it('resamples a background over the display budget instead of refusing it, and records that it did', async () => {
    // The kit's canopy image is 1648 × 1396: 2.3 million pixels against a budget of 1,048,576.
    const layer = await loadTerrainBackground(canopy(1648, 1396), 'canopy')
    expect(layer.sourceSize).toEqual([1648, 1396])
    expect(layer.width * layer.height).toBeLessThanOrEqual(BACKGROUND_LAYER_PIXELS)
    expect(layer.width * layer.height).toBeGreaterThan(BACKGROUND_LAYER_PIXELS * 0.99)
    expect(layer.width / layer.height).toBeCloseTo(1648 / 1396, 2)
    // The footprint is the file's: same outer corners, larger pixels.
    const west = layer.origin[0] - layer.pixelSize[0] / 2,
      north = layer.origin[1] - layer.pixelSize[1] / 2
    expect(west).toBeCloseTo(511800, 6)
    expect(north).toBeCloseTo(5972400, 6)
    expect(west + layer.width * layer.pixelSize[0]).toBeCloseTo(511800 + 1648, 6)
    expect(north + layer.height * layer.pixelSize[1]).toBeCloseTo(5972400 - 1396, 6)
    // Colour is averaged over known pixels only: the no-data column thins the edge, it does not tint it.
    const inner = layer.rgba.slice(4 * 10, 4 * 10 + 4)
    expect(inner).toEqual([130, 178, 140, 255])
    expect(layer.rgba.slice(0, 3)).toEqual([130, 178, 140])
    expect(layer.rgba[3]).toBeGreaterThan(0)
    expect(layer.rgba[3]).toBeLessThan(255)
    // The resampled layer is a valid project background and survives the project file.
    expect(parseTerrainBackgrounds(JSON.parse(JSON.stringify([layer])))[0].sourceSize).toEqual([1648, 1396])
  })

  it('shares the display budget between backgrounds and says what to do when it is spent', async () => {
    const first = await loadTerrainBackground(canopy(1648, 1396), 'canopy')
    // A second image takes what is left, so a canopy image and an orthophoto fit together.
    const second = await loadTerrainBackground(canopy(1500, 1000), 'canopy', [{ ...first, id: 'other' }])
    expect(first.width * first.height + second.width * second.height).toBeLessThanOrEqual(MAX_BACKGROUND_PIXELS)
    expect(second.sourceSize).toEqual([1500, 1000])
    // A small image that fits what is left keeps its own pixels.
    expect(
      (await loadTerrainBackground(canopy(200, 100), 'canopy', [{ ...first, id: 'other' }])).sourceSize,
    ).toBeUndefined()
    await expect(
      loadTerrainBackground(canopy(1500, 1000), 'canopy', [{ id: 'full', width: 1024, height: 1020 }]),
    ).rejects.toThrow('The background layers already use the display budget. Remove one before adding CHM-Image.tif.')
    // Importing the same file again replaces its own layer rather than competing with it.
    const again = await loadTerrainBackground(canopy(1648, 1396), 'canopy', [first])
    expect([again.width, again.height]).toEqual([first.width, first.height])
  })

  it('averages a background down by opacity-weighted colour', () => {
    const image = {
      origin: [0.5, -0.5] as [number, number],
      pixelSize: [1, -1] as [number, number],
      width: 4,
      height: 4,
      // Left half opaque red, right half transparent blue.
      rgba: Array.from({ length: 16 }, (_, i) => (i % 4 < 2 ? [200, 0, 0, 255] : [0, 0, 200, 0])).flat(),
    }
    const half = resampleBackground(image, 4)
    expect([half.width, half.height, half.sourceSize]).toEqual([2, 2, [4, 4]])
    expect(half.rgba).toEqual([200, 0, 0, 255, 0, 0, 0, 0, 200, 0, 0, 255, 0, 0, 0, 0])
    expect(half.origin).toEqual([1, -1])
    expect(half.pixelSize).toEqual([2, -2])
    expect(resampleBackground(image, 16).sourceSize).toBeUndefined()
  })
})
