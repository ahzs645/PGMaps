import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeArrayBuffer } from 'geotiff'
import {
  LIDAR_BASE,
  loadRaster,
  loadTerrainMetadata,
  roadProjection,
  terrainBounds,
  terrainFromMetadata,
} from './terrain'
import type { TerrainMetadata } from './types'

afterEach(() => vi.unstubAllGlobals())

function fixture(pointPixels = false, noData = false) {
  const values = Array.from({ length: 16 }, (_, i) => 100 + (i % 4) * 2 + Math.floor(i / 4) * 3)
  if (noData) values[5] = 255
  const buffer: ArrayBuffer = writeArrayBuffer(values, {
    width: 4,
    height: 4,
    BitsPerSample: [8],
    SampleFormat: [1],
    SamplesPerPixel: [1],
    ModelPixelScale: [1, 1, 0],
    ModelTiepoint: [0, 0, 0, 512500, 5972000, 0],
    ProjectedCSTypeGeoKey: 3157,
    GTModelTypeGeoKey: 1,
    GTRasterTypeGeoKey: pointPixels ? 2 : 1,
    ...(noData ? { GDAL_NODATA: '255' } : {}),
  })
  return new File([buffer], 'native-1m-fixture.tif', { type: 'image/tiff' })
}
const coordinate = (x: number, y: number) => roadProjection(3157).inverse([x, y]) as [number, number]

describe('road GeoTIFF sampling', () => {
  it('honours RasterPixelIsArea centres including edge samples and bilinear values', async () => {
    const { metadata, source } = await loadRaster(fixture(), 'CGVD2013; metres')
    expect(metadata.raster?.origin).toEqual([512500.5, 5971999.5])
    expect(metadata.raster?.pixelSize).toEqual([1, -1])
    expect(metadata.resolutionM).toBe(1)
    expect(source.elevationAt(...coordinate(512500.5, 5971999.5))).toBeCloseTo(100, 6)
    expect(source.elevationAt(...coordinate(512503.5, 5971996.5))).toBeCloseTo(115, 6)
    expect(source.elevationAt(...coordinate(512501.75, 5971998.25))).toBeCloseTo(106.25, 6)
    // The outer half-pixel is not extrapolated into measured support.
    expect(Number.isNaN(source.elevationAt(...coordinate(512500.25, 5971999.5)))).toBe(true)
    expect(terrainBounds(metadata)).not.toBeNull()
    expect(terrainFromMetadata(metadata)!.elevationAt(...coordinate(512501.75, 5971998.25))).toBeCloseTo(106.25, 6)
  })

  it('does not shift RasterPixelIsPoint samples another half pixel', async () => {
    const { metadata, source } = await loadRaster(fixture(true), 'CGVD2013; metres')
    expect(metadata.raster?.origin).toEqual([512500, 5972000])
    expect(source.elevationAt(...coordinate(512500, 5972000))).toBeCloseTo(100, 6)
    expect(source.elevationAt(...coordinate(512501.25, 5971998.75))).toBeCloseTo(106.25, 6)
  })

  it('keeps GDAL no-data cells missing instead of blending sentinel elevations', async () => {
    const { metadata, source } = await loadRaster(fixture(false, true), 'CGVD2013; metres')
    expect(metadata.raster?.values[5]).toBeNull()
    expect(Number.isNaN(source.elevationAt(...coordinate(512501, 5971999)))).toBe(true)
    expect(source.elevationAt(...coordinate(512503, 5971997))).toBeCloseTo(112.5, 6)
  })

  it('restores the recorded native raster bytes without consulting a newer manifest', async () => {
    const bytes = await fixture().arrayBuffer()
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (v) =>
      v.toString(16).padStart(2, '0'),
    ).join('')
    const fetchRaster = vi.fn(async () => new Response(bytes))
    vi.stubGlobal('fetch', fetchRaster)
    const metadata: TerrainMetadata = {
      kind: 'geotiff',
      name: 'Recorded 1 m DTM',
      epsg: 3157,
      resolutionM: 1,
      verticalReference: 'CGVD2013; metres',
      sha256,
      sourceUrl: new URL('dtm-1m.tif', LIDAR_BASE).href,
    }
    const source = await loadTerrainMetadata(metadata)
    expect(fetchRaster).toHaveBeenCalledExactlyOnceWith(metadata.sourceUrl)
    expect(source.elevationAt(...coordinate(512500.5, 5971999.5))).toBeCloseTo(100, 6)
    expect(source.elevationAt(...coordinate(512501.75, 5971998.25))).toBeCloseTo(106.25, 6)
    expect(terrainFromMetadata(metadata)).toBe(source)
    expect(terrainBounds(metadata)).not.toBeNull()
    // Invalid source metadata cannot reuse the otherwise matching cached hash.
    await expect(loadTerrainMetadata({ ...metadata, epsg: 3005 })).rejects.toThrow('original terrain')
    await expect(loadTerrainMetadata({ ...metadata, resolutionM: 2 })).rejects.toThrow('original terrain')
    expect(fetchRaster).toHaveBeenCalledTimes(1)
  })

  it('rejects changed source bytes rather than replacing them with training terrain', async () => {
    const bytes = await fixture().arrayBuffer()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(bytes)),
    )
    const metadata: TerrainMetadata = {
      kind: 'geotiff',
      name: 'Old pinned DTM',
      epsg: 3157,
      resolutionM: 1,
      verticalReference: 'CGVD2013; metres',
      sha256: 'f'.repeat(64),
      sourceUrl: new URL('dtm-1m.tif', LIDAR_BASE).href,
    }
    await expect(loadTerrainMetadata(metadata)).rejects.toThrow('hash mismatch')
    expect(terrainFromMetadata(metadata)).toBeNull()
  })
})
