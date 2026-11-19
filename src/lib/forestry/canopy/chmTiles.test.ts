import { describe, expect, it } from 'vitest'
import { canopyColours } from './chmView'
import {
  chmTileAddress,
  chmTileCellM,
  chmTileRgba,
  chmTilesIn,
  CHM_TILE_MAX_ZOOM,
  CHM_TILE_MIN_ZOOM,
  readChmTile,
  type ChmTileDeps,
} from './chmTiles'
import { mercatorLonLat, mercatorPixel, readMetaChm, type ChmTiff } from './metaChm'

const PG: [number, number] = [-122.81, 53.89]
/** A value for every cell of the world at full resolution (zoom 25), so any read can be checked. */
const height = (gx: number, gy: number, overview: number) => (gx * 7 + gy * 13 + overview * 31) % 256

const fileXY = (url: string) => {
  const key = url.match(/(\d{10})\.tif$/)![1]
  const x = parseInt([...key].map((d) => (Number(d) & 1 ? '1' : '0')).join(''), 2)
  const y = parseInt([...key].map((d) => (Number(d) & 2 ? '1' : '0')).join(''), 2)
  return [x, y]
}

/**
 * A stand-in for one file as the bucket lays it out: the full-resolution image, its mask, the
 * overviews down to 512 px, then their masks. Blocks are 512 px; a block's "bytes" name its image
 * and index, and `decode` fills it from `height`.
 */
function fakeFile(url: string): ChmTiff {
  const widths = [32768, 32768, 16384, 8192, 4096, 2048, 1024, 512, 16384, 8192, 4096, 2048, 1024, 512]
  const masks = [0, 4, 1, 1, 1, 1, 1, 1, 5, 5, 5, 5, 5, 5]
  const [fx, fy] = fileXY(url)
  return {
    getImageCount: async () => widths.length,
    getImage: async (i: number) => {
      const width = widths[i]
      const blocks = (width / 512) ** 2
      const overview = Math.log2(32768 / width)
      return {
        getWidth: () => width,
        getTileWidth: () => 512,
        getTileHeight: () => 512,
        fileDirectory: {
          NewSubfileType: masks[i],
          TileOffsets: Array.from({ length: blocks }, (_, b) => i * 1e7 + b),
          TileByteCounts: Array.from({ length: blocks }, () => 100),
        },
        readRasters: async ({ window: [x0, y0, x1, y1] }: { window: number[] }) => {
          const out = new Uint8Array((x1 - x0) * (y1 - y0))
          for (let r = y0; r < y1; r++)
            for (let c = x0; c < x1; c++)
              out[(r - y0) * (x1 - x0) + (c - x0)] = height(fx * width + c, fy * width + r, overview)
          return out
        },
      }
    },
  } as unknown as ChmTiff
}

function deps(missing: string[] = [], log: string[] = []): ChmTileDeps {
  const files = new Map<string, ChmTiff>()
  return {
    openTiff: async (url) => {
      log.push(`open ${url}`)
      if (missing.some((key) => url.includes(key))) return null
      let file = files.get(url)
      if (!file) files.set(url, (file = fakeFile(url)))
      return file
    },
    readBytes: async (url, offset, length) => {
      log.push(`bytes ${offset}+${length}`)
      return new Float64Array([offset, ...fileXY(url)]).buffer
    },
    decode: async (_fd, bytes) => {
      const [offset, fx, fy] = new Float64Array(bytes)
      const image = Math.floor(offset / 1e7),
        block = offset % 1e7
      const width = [32768, 32768, 16384, 8192, 4096, 2048, 1024, 512][image]
      const perRow = width / 512
      const bx = (block % perRow) * 512,
        by = Math.floor(block / perRow) * 512
      const overview = Math.log2(32768 / width)
      const out = new Uint8Array(512 * 512)
      for (let r = 0; r < 512; r++)
        for (let c = 0; c < 512; c++) out[r * 512 + c] = height(fx * width + bx + c, fy * width + by + r, overview)
      return out.buffer
    },
  }
}

describe('Meta CHM v2 map tiles', () => {
  it('serves zooms 10 to 16, one block of one image each', () => {
    expect([CHM_TILE_MIN_ZOOM, CHM_TILE_MAX_ZOOM]).toEqual([10, 16])
    const [x, y] = mercatorPixel(PG[0], PG[1], 16).map(Math.floor)
    const deep = chmTileAddress(16, x, y)!
    expect(deep.key).toBe('0212102012')
    expect(deep.imageWidth).toBe(32768)
    expect([deep.column, deep.row]).toEqual([x - 162 * 64, y - 329 * 64])
    const file = chmTileAddress(10, 162, 329)!
    expect(file).toMatchObject({ key: '0212102012', imageWidth: 512, column: 0, row: 0 })
    expect(chmTileAddress(12, 162 * 4 + 3, 329 * 4 + 1)).toMatchObject({ imageWidth: 2048, column: 3, row: 1 })
    expect(chmTileAddress(9, 81, 164)).toBeNull()
    expect(chmTileAddress(17, 1, 1)).toBeNull()
    expect(chmTileAddress(12, -1, 0)).toBeNull()
    expect(chmTileAddress(12, 4096, 0)).toBeNull()
  })

  it('reads the image by its width past the interleaved masks, one byte range a tile', async () => {
    const log: string[] = []
    // Tile 12/650/1317 is block (2, 1) of the 2,048 px overview, the sixth image (the mask is the second).
    const values = await readChmTile(12, 162 * 4 + 2, 329 * 4 + 1, deps([], log))
    expect(log.filter((l) => l.startsWith('bytes'))).toEqual([`bytes ${5 * 1e7 + 1 * 4 + 2}+100`])
    expect(values![0]).toBe(height(162 * 2048 + 2 * 512, 329 * 2048 + 512, 4))
  })

  it('holds the same cells as a window read of the same ground', async () => {
    for (const z of [16, 14, 12]) {
      const [x, y] = mercatorPixel(PG[0], PG[1], z).map(Math.floor)
      const tile = (await readChmTile(z, x, y, deps()))!
      const [w, n] = mercatorLonLat(x + 0.25 / 512, y + 0.25 / 512, z)
      const [e, s] = mercatorLonLat(x + 1 - 0.25 / 512, y + 1 - 0.25 / 512, z)
      const grid = await readMetaChm([w, s, e, n], async (url) => fakeFile(url), { overview: 16 - z })
      expect([grid.width, grid.height]).toEqual([512, 512])
      expect(grid.x0).toBe(x * 512)
      expect(Array.from(tile)).toEqual(Array.from(grid.data))
    }
  })

  it('leaves a tile with no file or no served zoom empty', async () => {
    const log: string[] = []
    expect(await readChmTile(12, 162 * 4, 329 * 4, deps(['0212102012'], log))).toBeNull()
    expect(log).toEqual(['open https://data.source.coop/tge-labs/meta-chm-v2/chm/0212102012.tif'])
    expect(await readChmTile(8, 40, 82, deps([], log))).toBeNull()
    expect(log).toHaveLength(1)
  })

  it('colours a tile with the sheet classes and drops an all-clear one', () => {
    const lut = canopyColours()
    const rgba = chmTileRgba(Uint8Array.from([0, 4, 12, 41]))!
    expect(Array.from(rgba.subarray(0, 8))).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    expect(Array.from(rgba.subarray(8, 12))).toEqual(Array.from(lut.subarray(48, 52)))
    expect(Array.from(rgba.subarray(12, 16))).toEqual(Array.from(lut.subarray(41 * 4, 42 * 4)))
    expect(chmTileRgba(Uint8Array.from([0, 5, 3]))).toBeNull()
  })

  it('states cell sizes and lists the tiles of a view', () => {
    expect(chmTileCellM(16, 54)).toBeCloseTo(0.702, 3)
    expect(chmTileCellM(20, 54)).toBeCloseTo(0.702, 3)
    expect(chmTileCellM(12, 54)).toBeCloseTo(0.702 * 16, 2)
    const [x, y] = mercatorPixel(PG[0], PG[1], 14).map(Math.floor)
    const [w, n] = mercatorLonLat(x + 0.5, y + 0.5, 14)
    const [e, s] = mercatorLonLat(x + 1.5, y + 2.5, 14)
    expect(chmTilesIn([w, s, e, n], 14)).toEqual([
      `14/${x}/${y}`,
      `14/${x + 1}/${y}`,
      `14/${x}/${y + 1}`,
      `14/${x + 1}/${y + 1}`,
      `14/${x}/${y + 2}`,
      `14/${x + 1}/${y + 2}`,
    ])
  })
})
