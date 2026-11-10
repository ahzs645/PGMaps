import { afterEach, describe, expect, it, vi } from 'vitest'
import { fromArrayBuffer, writeArrayBuffer } from 'geotiff'
import type { PointCloudResult, RunPointCloudOptions } from './pointCloudClient'
import {
  LIDAR_BASE,
  TerrainImportQuestion,
  createDemoProject,
  demoTerrain,
  exportGrid,
  importTerrainWithAnswers,
  localMetricGrid,
  loadLas,
  loadRaster,
  loadTerrainMetadata,
  pointCloudImportSummary,
  roadProjection,
  terrainBounds,
  terrainFromMetadata,
  type TerrainImportNeeds,
} from './terrain'
import { encodeLas, type PointCloud } from './pointCloud'
import { assumeCrs } from './pointCloud.worker'
import type { TerrainMetadata } from './types'
import { analyzeRoad, offsetCoordinate } from './engine'
import { projectReportHtml } from './project'

afterEach(() => vi.unstubAllGlobals())

// Worker stand-in: records the call, detaches the bytes as a transfer does, and reports the CRS
// a read found (`worker.epsg`), or failing that the stated one as the worker's `assumeCrs` does,
// before returning a 2 × 2 grid.
const worker = vi.hoisted(() => ({
  epsg: null as number | null,
  calls: [] as Array<{ bytes: unknown; options: RunPointCloudOptions; breaklines?: unknown }>,
}))
vi.mock('./pointCloudClient', () => ({
  runPointCloudWorker: vi.fn(async (bytes: ArrayBuffer, options: RunPointCloudOptions): Promise<PointCloudResult> => {
    const call: (typeof worker.calls)[number] = { bytes, options }
    worker.calls.push(call)
    if (options.transfer) structuredClone(bytes, { transfer: [bytes] })
    const epsg = worker.epsg ?? options.assumedEpsg ?? null
    call.breaklines = options.breaklinesFor?.(epsg)
    const empty = { x: new Float64Array(), y: new Float64Array(), z: new Float64Array() }
    return {
      type: 'done',
      cloud: {
        ...empty,
        classification: new Uint8Array(),
        count: 4,
        epsg,
        verticalEpsg: null,
        version: '1.4',
        format: 'laz',
        bounds: [500000, 6000000, 800, 500001, 6000001, 803],
        sourceCount: 4,
        thinCellM: null,
      },
      surface: {
        grid: {
          epsg,
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

function fixture(pointPixels = false, noData = false, tiepoint = [0, 0, 0, 512500, 5972000, 0]) {
  const values = Array.from({ length: 16 }, (_, i) => 100 + (i % 4) * 2 + Math.floor(i / 4) * 3)
  if (noData) values[5] = 255
  const buffer: ArrayBuffer = writeArrayBuffer(values, {
    width: 4,
    height: 4,
    BitsPerSample: [8],
    SampleFormat: [1],
    SamplesPerPixel: [1],
    ModelPixelScale: [1, 1, 0],
    ModelTiepoint: tiepoint,
    ProjectedCSTypeGeoKey: 3157,
    GTModelTypeGeoKey: 1,
    GTRasterTypeGeoKey: pointPixels ? 2 : 1,
    ...(noData ? { GDAL_NODATA: '255' } : {}),
  })
  return new File([buffer], 'native-1m-fixture.tif', { type: 'image/tiff' })
}
const coordinate = (x: number, y: number) => roadProjection(3157).inverse([x, y]) as [number, number]

describe('ground-metre drainage projection', () => {
  it.each([
    [-120.4, 50.67],
    [-119.2, 50.27],
    [151.2, -33.9],
  ] as [number, number][])('keeps local distances in ground metres at %s, %s', (lon, lat) => {
    const origin: [number, number] = [lon, lat]
    const grid = localMetricGrid(origin)
    const start = grid.toGrid(origin)
    for (const bearing of [0, 90]) {
      const point = offsetCoordinate(origin, bearing, 100)
      const end = grid.toGrid(point)
      // The road uses mean-Earth-radius chainage; UTM uses an ellipsoid. Both are
      // ground metre measures, within 1%, rather than Mercator's ~157 m here.
      expect(Math.hypot(end[0] - start[0], end[1] - start[1])).toBeGreaterThan(99)
      expect(Math.hypot(end[0] - start[0], end[1] - start[1])).toBeLessThan(101)
      expect(grid.toLonLat(end)[0]).toBeCloseTo(point[0], 8)
      expect(grid.toLonLat(end)[1]).toBeCloseTo(point[1], 8)
    }
    expect(grid.epsg >= 32700).toBe(lat < 0)
  })

  it('preserves the source CRS for exports while drainage uses its local metric grid', () => {
    const at: [number, number] = [-120.4, 50.67]
    const metadata: TerrainMetadata = {
      kind: 'geotiff',
      name: 'Web Mercator DEM',
      resolutionM: 6,
      verticalReference: 'metres',
      epsg: 3857,
    }
    expect(exportGrid(metadata, at).epsg).toBe(3857)
    expect(localMetricGrid(at).epsg).toBe(32610)
  })
})

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

  it('registers a tiepoint at nonzero raster coordinates at the correct map position', async () => {
    const { metadata, source } = await loadRaster(
      fixture(false, false, [10, 20, 0, 512510, 5971980, 0]),
      'CGVD2013; metres',
    )
    expect(metadata.raster?.origin).toEqual([512500.5, 5971999.5])
    expect(source.elevationAt(...coordinate(512501.75, 5971998.25))).toBeCloseTo(106.25, 6)
    expect(terrainFromMetadata(metadata)!.elevationAt(...coordinate(512501.75, 5971998.25))).toBeCloseTo(106.25, 6)
  })

  it('compares a decimal GDAL no-data tag at the Float32 sample precision', async () => {
    const noData = -9999.999
    // geotiff's writer encodes byte pixels only; retain its metadata and write a Float32 strip.
    const byteFixture = writeArrayBuffer(new Array(16).fill(0), {
      width: 4,
      height: 4,
      BitsPerSample: [32],
      SampleFormat: [3],
      SamplesPerPixel: [1],
      StripByteCounts: [64],
      ModelPixelScale: [1, 1, 0],
      ModelTiepoint: [0, 0, 0, 512500, 5972000, 0],
      ProjectedCSTypeGeoKey: 3157,
      GTModelTypeGeoKey: 1,
      GTRasterTypeGeoKey: 1,
      GDAL_NODATA: String(noData),
    })
    const image = await (await fromArrayBuffer(byteFixture)).getImage()
    const offset = image.fileDirectory.StripOffsets[0]
    const bytes = new Uint8Array(offset + 16 * 4)
    bytes.set(new Uint8Array(byteFixture))
    const view = new DataView(bytes.buffer)
    const littleEndian = view.getUint16(0) === 0x4949
    for (let i = 0; i < 16; i++) view.setFloat32(offset + i * 4, i === 5 ? noData : 100 + i, littleEndian)
    const { metadata, source } = await loadRaster(new File([bytes], 'float32-nodata.tif'), 'CGVD2013; metres')
    expect(metadata.raster?.values[5]).toBeNull()
    expect(Number.isNaN(source.elevationAt(...coordinate(512501, 5971999)))).toBe(true)
    expect(source.elevationAt(...coordinate(512503, 5971997))).toBeCloseTo(112.5, 6)
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

  /** A small LAS 1.2 tile with real header bounds, with or without CRS keys. */
  const tile = (name: string, epsg?: number, verticalEpsg?: number, east = 511800) =>
    new File(
      [
        encodeLas({
          x: Float64Array.of(east, east + 300),
          y: Float64Array.of(5971300, 5971850),
          z: Float64Array.of(750, 760),
          classification: Uint8Array.of(2, 2),
          epsg,
          verticalEpsg,
        }).buffer as ArrayBuffer,
      ],
      name,
    )
  const question = async (attempt: Promise<unknown>): Promise<TerrainImportNeeds> => {
    const error = await attempt.then(
      () => null,
      (cause: unknown) => cause,
    )
    expect(error).toBeInstanceOf(TerrainImportQuestion)
    return (error as TerrainImportQuestion).needs
  }

  it('asks for the CRS of a cloud without one: a LAS at once, a LAZ once the worker finds none either', async () => {
    const needs = await question(loadLas(tile('Tile_1.las'), 'CGVD2013; metres'))
    // The header extent comes with the question, so the numbers can be checked against a zone.
    expect(needs).toEqual({ crs: { files: ['Tile_1.las'], bounds: [511800, 5971300, 512100, 5971850] } })
    expect(worker.calls).toHaveLength(0)
    expect((await question(loadLas(headerOnly(true), 'CGVD2013; metres'))).crs?.files).toEqual(['cloud.laz'])
    expect(worker.calls).toHaveLength(1)
    await expect(loadLas(tile('Tile_1.las'), 'CGVD2013; metres')).rejects.toThrow(
      'Tile_1.las has no CRS in the header. State the EPSG code to import.',
    )
  })

  it('imports a cloud without a CRS in the one that was stated, and says so', async () => {
    const { metadata, summary } = await loadLas(tile('Tile_1.las'), 'CGVD2013; metres', {
      classify: 'auto',
      surface: 'mean',
      assumedEpsg: 3157,
    })
    expect(worker.calls[0].options.assumedEpsg).toBe(3157)
    expect(metadata).toMatchObject({ epsg: 3157, verticalReference: 'CGVD2013; metres', raster: { epsg: 3157 } })
    expect(metadata.preparation?.sources[0]).toMatchObject({ name: 'Tile_1.las', epsg: 3157 })
    expect(summary).toContain(
      'CRS EPSG:3157 as entered (the file states none); vertical datum CGVD2013; metres as entered.',
    )
    // The stated CRS is part of the terrain's identity: the same bytes in another zone are other ground.
    const other = await loadLas(tile('Tile_1.las'), 'CGVD2013; metres', {
      classify: 'auto',
      surface: 'mean',
      assumedEpsg: 26910,
    })
    expect(other.metadata.sha256).not.toBe(metadata.sha256)
    // A CRS outside the accepted list is refused before anything is read into it.
    await expect(
      loadLas(tile('Tile_1.las'), 'CGVD2013; metres', { classify: 'auto', surface: 'mean', assumedEpsg: 2955 }),
    ).rejects.toThrow(/Use WGS84, Web Mercator, BC Albers/)
  })

  it('never lets a stated CRS override the one a file carries', async () => {
    await expect(
      loadLas(tile('Tile_1.las', 26910), 'CGVD2013; metres', { classify: 'auto', surface: 'mean', assumedEpsg: 3157 }),
    ).rejects.toThrow('Tile_1.las states EPSG:26910, not the EPSG:3157 entered.')
    // A file with its own CRS and vertical key needs no answer at all, and the summary says where they came from.
    const { summary, metadata } = await (async () => {
      worker.epsg = 3157
      return loadLas(tile('Tile_1.las', 3157, 6647), '')
    })()
    expect(metadata.verticalReference).toBe('EPSG:6647; metres')
    expect(summary).toContain('CRS EPSG:3157 from the file; vertical datum EPSG:6647; metres from the file.')
  })

  it('asks for the vertical datum when the field is empty and the file names none, never borrowing one', async () => {
    expect(await question(loadLas(tile('Tile_1.las', 3157), ''))).toEqual({
      verticalDatum: { files: ['Tile_1.las'] },
    })
    // A cloud missing both is asked for both in one go.
    expect(await question(loadLas(tile('Tile_1.las'), '  '))).toEqual({
      crs: { files: ['Tile_1.las'], bounds: [511800, 5971300, 512100, 5971850] },
      verticalDatum: { files: ['Tile_1.las'] },
    })
    expect(await question(loadRaster(fixture(), ''))).toEqual({ verticalDatum: { files: ['native-1m-fixture.tif'] } })
    expect(worker.calls).toHaveLength(0)
  })

  it('combines tiles that state no CRS under one stated CRS, and refuses tiles that disagree', async () => {
    const tiles = [tile('Tile_1.las'), tile('Tile_2.las', undefined, undefined, 512100)]
    const needs = await question(
      loadLas(tiles[0], '', { classify: 'auto', surface: 'mean', additionalFiles: tiles.slice(1) }),
    )
    expect(needs).toEqual({
      crs: { files: ['Tile_1.las', 'Tile_2.las'], bounds: [511800, 5971300, 512400, 5971850] },
      verticalDatum: { files: ['Tile_1.las', 'Tile_2.las'] },
    })
    const { metadata } = await loadLas(tiles[0], 'CGVD2013', {
      classify: 'auto',
      surface: 'mean',
      additionalFiles: tiles.slice(1),
      assumedEpsg: 3157,
    })
    expect(metadata.preparation?.sources.map((source) => [source.name, source.epsg])).toEqual([
      ['Tile_1.las', 3157],
      ['Tile_2.las', 3157],
    ])
    expect(metadata.name).toMatch(/^2 point-cloud sources/)
    // One tile states its CRS: the others are asked about, with that CRS offered.
    const mixed = await question(
      loadLas(tile('A.las', 3157), 'CGVD2013', { classify: 'auto', surface: 'mean', additionalFiles: [tile('B.las')] }),
    )
    expect(mixed.crs).toMatchObject({ files: ['B.las'], suggestedEpsg: 3157 })
    await expect(
      loadLas(tile('A.las', 3157), 'CGVD2013', {
        classify: 'auto',
        surface: 'mean',
        additionalFiles: [tile('B.las', 26910)],
      }),
    ).rejects.toThrow('These point clouds are in different CRSs (A.las: EPSG:3157, B.las: EPSG:26910).')
  })

  it('runs an import again with the answers, and changes nothing when the question is cancelled', async () => {
    const asked: TerrainImportNeeds[] = []
    const loaded = await importTerrainWithAnswers(
      (answers) =>
        loadLas(tile('Tile_1.las'), answers.verticalReference ?? '', {
          classify: 'auto',
          surface: 'mean',
          assumedEpsg: answers.epsg,
        }),
      async (needs) => {
        asked.push(needs)
        return { epsg: 3157, verticalReference: 'CGVD2013 (CGG2013), EPSG:6647; metres' }
      },
    )
    expect(asked).toHaveLength(1)
    expect(Object.keys(asked[0])).toEqual(['crs', 'verticalDatum'])
    expect(loaded?.metadata).toMatchObject({ epsg: 3157, verticalReference: 'CGVD2013 (CGG2013), EPSG:6647; metres' })
    worker.calls.length = 0
    expect(
      await importTerrainWithAnswers(
        (answers) => loadLas(tile('Tile_1.las'), answers.verticalReference ?? ''),
        async () => null,
      ),
    ).toBeNull()
    expect(worker.calls).toHaveLength(0)
    // Any other failure is still a failure.
    await expect(
      importTerrainWithAnswers(
        async () => {
          throw Error('The LAS point records are truncated.')
        },
        async () => ({}),
      ),
    ).rejects.toThrow('truncated')
  })

  it('gives a stated CRS only to a cloud that carries none', () => {
    const cloud = { epsg: null, count: 0 } as unknown as PointCloud
    expect(assumeCrs(cloud, 3157).epsg).toBe(3157)
    expect(assumeCrs({ ...cloud, epsg: 26910 }, 3157).epsg).toBe(26910)
    expect(assumeCrs(cloud, undefined).epsg).toBeNull()
  })

  it('keeps the import summary with the terrain so it can be read after the notice has gone', async () => {
    const { metadata } = await loadLas(tile('Tile_1.las'), 'CGVD2013', {
      classify: 'auto',
      surface: 'mean',
      assumedEpsg: 3157,
    })
    expect(pointCloudImportSummary(metadata)).toEqual([
      { label: 'Ground points', value: '4 of 4 · 1.0 per m² of gridded ground' },
      { label: 'Classes found', value: '2 ground 4' },
      { label: 'Extent', value: 'E 500,000 to 500,001 · N 6,000,000 to 6,000,001 · Z 800 to 803 m' },
      { label: 'Grid', value: '2 × 2 cells at 1.00 m · 0 left missing' },
      { label: 'CRS', value: 'EPSG:3157 as entered; the files state none' },
      { label: 'Vertical datum', value: 'CGVD2013 as entered' },
      { label: 'Sources', value: 'Tile_1.las' },
    ])
    // It survives the project file, and terrain that is not a point-cloud import has none.
    const reopened = JSON.parse(JSON.stringify(metadata)) as TerrainMetadata
    expect(pointCloudImportSummary(reopened)).toEqual(pointCloudImportSummary(metadata))
    expect(pointCloudImportSummary((await loadRaster(fixture(), 'CGVD2013; metres')).metadata)).toBeNull()
  })

  it('prints the import summary in the report with the terrain it describes', async () => {
    const { metadata } = await loadLas(tile('Tile_1.las'), 'CGVD2013', {
      classify: 'auto',
      surface: 'mean',
      assumedEpsg: 3157,
    })
    const project = createDemoProject()
    const analysis = analyzeRoad(project.alignments[0], demoTerrain, project.settings)
    expect(projectReportHtml(project, analysis)).not.toContain('Point cloud')
    const report = projectReportHtml({ ...project, terrain: metadata }, analysis)
    expect(report).toContain('<dt>Point cloud · Ground points</dt><dd>4 of 4 · 1.0 per m² of gridded ground</dd>')
    expect(report).toContain('<dt>Point cloud · CRS</dt><dd>EPSG:3157 as entered; the files state none</dd>')
    expect(report).toContain('<dt>Point cloud · Sources</dt><dd>Tile_1.las</dd>')
    // In the terrain block, between the source's checksum and the design inputs.
    const at = report.indexOf('Point cloud · Ground points')
    expect(at).toBeGreaterThan(report.indexOf('<h2>Terrain and assumptions</h2>'))
    expect(at).toBeGreaterThan(report.indexOf('<dt>SHA-256</dt>'))
    expect(at).toBeLessThan(report.indexOf('<dt>Sampling interval</dt>'))
  })
})
