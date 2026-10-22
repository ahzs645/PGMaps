import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeArrayBuffer } from 'geotiff'
import type { PointCloudResult, RunPointCloudOptions } from './pointCloudClient'
import {
  LIDAR_BASE,
  loadLas,
  loadRaster,
  loadTerrainMetadata,
  roadProjection,
  terrainBounds,
  terrainFromMetadata,
} from './terrain'
import type { TerrainMetadata } from './types'

afterEach(() => vi.unstubAllGlobals())

// Worker stand-in: records the call, detaches the bytes as a transfer does, and reports the CRS
// a LAZ read found (`worker.epsg`) before returning a 2 × 2 grid.
const worker = vi.hoisted(() => ({
  epsg: null as number | null,
  calls: [] as Array<{ bytes: unknown; options: RunPointCloudOptions; breaklines?: unknown }>,
}))
vi.mock('./pointCloudClient', () => ({
  runPointCloudWorker: vi.fn(async (bytes: ArrayBuffer, options: RunPointCloudOptions): Promise<PointCloudResult> => {
    const call: (typeof worker.calls)[number] = { bytes, options }
    worker.calls.push(call)
    if (options.transfer) structuredClone(bytes, { transfer: [bytes] })
    call.breaklines = options.breaklinesFor?.(worker.epsg)
    const empty = { x: new Float64Array(), y: new Float64Array(), z: new Float64Array() }
    return {
      type: 'done',
      cloud: {
        ...empty,
        classification: new Uint8Array(),
        count: 4,
        epsg: worker.epsg,
        verticalEpsg: null,
        version: '1.4',
        format: 'laz',
        bounds: [500000, 6000000, 800, 500001, 6000001, 803],
        sourceCount: 4,
        thinCellM: null,
      },
      surface: {
        grid: {
          epsg: worker.epsg,
          origin: [500000.5, 6000000.5],
          pixelSize: [1, -1],
          width: 2,
          height: 2,
          values: [800, 801, 802, 803],
          groundPoints: 4,
          totalPoints: 4,
          filledCells: 0,
          cellM: 1,
        },
      },
      summary: { total: 4, ground: 4, noise: 0, byClass: [{ cls: 2, count: 4 }] },
      classifiedBy: null,
      timings: { readMs: 0, classifyMs: 0, gridMs: 0 },
    }
  }),
}))

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

/** A header-only LAS 1.2 with no CRS keys; `compressed` sets the LAZ bit of the point format. */
function headerOnly(compressed: boolean) {
  const bytes = new Uint8Array(227)
  const view = new DataView(bytes.buffer)
  bytes.set(new TextEncoder().encode('LASF'), 0)
  view.setUint8(24, 1)
  view.setUint8(25, 2)
  view.setUint16(94, 227, true)
  view.setUint32(96, 227, true)
  view.setUint8(104, compressed ? 0x80 : 0)
  view.setUint16(105, 20, true)
  return new File([bytes], compressed ? 'cloud.laz' : 'cloud.las')
}

describe('point-cloud import', () => {
  afterEach(() => {
    worker.calls.length = 0
    worker.epsg = null
  })

  const breaklines = {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: [
        [-123, 54.1, 700],
        [-122.999, 54.1, 701],
      ],
    },
  }

  it('takes a LAZ CRS the worker finds when the header has none, projecting breaklines with it', async () => {
    worker.epsg = 26910
    const { metadata, summary } = await loadLas(headerOnly(true), 'CGVD2013; metres', {
      classify: 'auto',
      surface: 'tin',
      breaklines,
    })
    expect(metadata).toMatchObject({ epsg: 26910, raster: { epsg: 26910, width: 2 } })
    expect(summary).toMatch(/^LAZ 1\.4: 4 of 4 points are ground/)
    // The bytes were handed over, not copied, and nothing read them after the transfer.
    const [call] = worker.calls
    expect(call.options.transfer).toBe(true)
    expect(call.bytes).toBeInstanceOf(ArrayBuffer)
    expect((call.bytes as ArrayBuffer).byteLength).toBe(0)
    // Breaklines arrive in UTM 10N metres, built from the CRS the worker reported.
    const [line] = call.breaklines as Array<{ points: Array<[number, number, number | null]> }>
    const expected = roadProjection(26910).forward([-123, 54.1])
    expect(line.points[0][0]).toBeCloseTo(expected[0], 6)
    expect(line.points[0][1]).toBeCloseTo(expected[1], 6)
    expect(line.points[0][2]).toBe(700)
  })

  it('refuses a cloud without a CRS: a LAS at once, a LAZ once the worker finds none either', async () => {
    await expect(loadLas(headerOnly(false), 'CGVD2013; metres')).rejects.toThrow('no projected CRS key')
    expect(worker.calls).toHaveLength(0)
    await expect(loadLas(headerOnly(true), 'CGVD2013; metres')).rejects.toThrow('no projected CRS key')
    expect(worker.calls).toHaveLength(1)
  })
})
