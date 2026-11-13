import { describe, expect, it } from 'vitest'
import { fromArrayBuffer, writeArrayBuffer } from 'geotiff'
import { cellFactorFor, readLocalDemWindow, type DemFile } from './localDemWindow'
import { roadProjection } from './terrain'
import type { Coordinate } from './types'

/** A north-up Float32 DEM in NAD83(CSRS) / UTM 10N, the way LidarBC writes them: no vertical key. */
async function utmDem(
  name: string,
  corner: [number, number],
  width: number,
  height: number,
  value: (col: number, row: number) => number | null,
): Promise<DemFile> {
  const count = width * height
  const header = writeArrayBuffer(new Uint8Array(count), {
    width,
    height,
    BitsPerSample: [32],
    SampleFormat: [3],
    SamplesPerPixel: [1],
    StripByteCounts: [count * 4],
    ModelPixelScale: [1, 1, 0],
    ModelTiepoint: [0, 0, 0, corner[0], corner[1], 0],
    GTModelTypeGeoKey: 1,
    GTRasterTypeGeoKey: 1,
    ProjectedCSTypeGeoKey: 3157,
    ProjLinearUnitsGeoKey: 9001,
    GeoKeyDirectory: [1, 1, 0, 4, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, 3157, 3076, 0, 1, 9001],
    GDAL_NODATA: '-32767',
  }) as ArrayBuffer
  const offset = (await (await fromArrayBuffer(header)).getImage()).fileDirectory.StripOffsets[0]
  const bytes = new Uint8Array(offset + count * 4)
  bytes.set(new Uint8Array(header))
  const view = new DataView(bytes.buffer)
  const littleEndian = view.getUint16(0) === 0x4949
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++)
      view.setFloat32(offset + (row * width + col) * 4, value(col, row) ?? -32767, littleEndian)
  return Object.assign(new Blob([bytes]), { name, lastModified: 1 })
}

const utm = roadProjection(3157)
/** The lon/lat corners of a UTM box, as an area with no buffer. */
const ring = (west: number, south: number, east: number, north: number) => ({
  bufferM: 0,
  coordinates: (
    [
      [west, north],
      [east, north],
      [east, south],
      [west, south],
    ] as [number, number][]
  ).map((p) => utm.inverse(p) as Coordinate),
})
const options = { name: 'LidarBC test', verticalReference: 'CGVD2013 · test', sourceLabel: 'LidarBC test' }

describe('reading an area out of downloaded DEMs', () => {
  it('keeps native 1 m cells and reads only the window', async () => {
    // A 200 × 100 m tile; the value records its own column and row.
    const tile = await utmDem('tile.tif', [595000, 5995000], 200, 100, (c, r) => 800 + c + r / 1000)
    const loaded = await readLocalDemWindow([tile], ring(595050.2, 5994950.2, 595080.8, 5994970.8), options)
    const raster = loaded.metadata.raster!
    expect(raster.epsg).toBe(3157)
    expect(raster.pixelSize).toEqual([1, -1])
    // Cells 50–80 across, 29–49 down (the window's corners round outward to whole cells).
    expect([raster.width, raster.height]).toEqual([31, 21])
    expect(raster.origin).toEqual([595050.5, 5994970.5])
    expect(raster.values[0]).toBeCloseTo(800 + 50 + 29 / 1000, 3)
    expect(raster.values.at(-1)).toBeCloseTo(800 + 80 + 49 / 1000, 3)
    expect(loaded.coveragePercent).toBe(100)
    expect(loaded.metadata.verticalReference).toBe('CGVD2013 · test')
    expect(loaded.metadata.preparation?.parameters.cellM).toBe(1)
  })

  it('joins neighbouring tiles, keeps no-data missing, and reports coverage', async () => {
    const west = await utmDem('west.tif', [595000, 5995000], 100, 50, (c) => (c < 90 ? 700 : null))
    const east = await utmDem('east.tif', [595100, 5995000], 100, 50, () => 710)
    const far = await utmDem('far.tif', [600000, 5995000], 10, 10, () => 1)
    const loaded = await readLocalDemWindow([west, east, far], ring(595000, 5994960, 595200, 5995000), options)
    const raster = loaded.metadata.raster!
    expect([raster.width, raster.height]).toEqual([200, 40])
    expect(raster.values[0]).toBe(700)
    expect(raster.values[95]).toBeNull()
    expect(raster.values[150]).toBe(710)
    expect(loaded.coveragePercent).toBeCloseTo(95, 6)
    expect(loaded.read).toEqual([
      { name: 'west.tif', hadData: true },
      { name: 'east.tif', hadData: true },
    ])
    expect(loaded.outside).toEqual(['far.tif'])
    expect(loaded.metadata.preparation?.sources.map((s) => s.name)).toEqual(['west.tif', 'east.tif'])
  })

  it('says a listed tile has no elevations here instead of loading an empty terrain', async () => {
    // A floodplain sheet: listed under the road, data only in one corner.
    const sheet = await utmDem('bc_093i003_xli1m_utm10_2019.tif', [595000, 5995000], 100, 100, (c, r) =>
      c < 5 && r > 95 ? 812 : null,
    )
    await expect(readLocalDemWindow([sheet], ring(595040, 5994940, 595060, 5994960), options)).rejects.toThrow(
      /has no elevations in this area: the tile is listed here/,
    )
  })

  it('reads a diagonal road by its own box in the file projection, widened by the buffer', async () => {
    const tile = await utmDem('tile.tif', [595000, 5995000], 400, 400, () => 750)
    // A road from the north-west to the south-east corner, as two points, 20 m of buffer.
    const road = {
      coordinates: [utm.inverse([595100, 5994900]), utm.inverse([595300, 5994700])] as Coordinate[],
      bufferM: 20,
    }
    const raster = (await readLocalDemWindow([tile], road, options)).metadata.raster!
    expect([raster.width, raster.height]).toEqual([240, 240])
    expect(raster.origin).toEqual([595080.5, 5994919.5])
  })

  it('reads 2 m cells as the mean of each 2 × 2 block when asked, and says so', async () => {
    const tile = await utmDem('tile.tif', [595000, 5995000], 10, 10, (c, r) => (c === 1 && r === 1 ? null : 100 + c))
    const loaded = await readLocalDemWindow([tile], ring(595000, 5994990, 595010, 5995000), {
      ...options,
      cellFactor: 2,
    })
    const raster = loaded.metadata.raster!
    expect([raster.width, raster.height, raster.pixelSize]).toEqual([5, 5, [2, -2]])
    expect(raster.origin).toEqual([595001, 5994999])
    // Columns 0 and 1: (100 + 101 + 100) / 3 with the missing cell left out; columns 2 and 3: 102.5.
    expect(raster.values[0]).toBeCloseTo(301 / 3, 9)
    expect(raster.values[1]).toBe(102.5)
    expect(raster.name).toMatch(/2 m cells, each the mean of 2 × 2 source cells$/)
    expect(loaded.metadata.preparation?.parameters).toMatchObject({ cellM: 2, sourceCellM: 1 })
  })

  it('refuses an area past the terrain cell limit and files on different grids', async () => {
    const big = await utmDem('big.tif', [595000, 5995000], 10, 10, () => 1)
    await expect(readLocalDemWindow([big], ring(595000, 5992000, 598000, 5995000), options)).rejects.toThrow(
      /needs 9\.0 million 1 m cells \(limit 4\.19 million\)\. Read it at 2 m cells, or pick one block or road/,
    )
    expect(cellFactorFor(9e6)).toBe(2)
    expect(cellFactorFor(4e6)).toBe(1)
    const shifted = await utmDem('shifted.tif', [595000.5, 5995000], 10, 10, () => 1)
    await expect(readLocalDemWindow([big, shifted], ring(595000, 5994995, 595005, 5995000), options)).rejects.toThrow(
      /not on the same cell grid/,
    )
  })
})
