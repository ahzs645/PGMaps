import { describe, expect, it } from 'vitest'
import {
  canopyAt,
  canopyWithin,
  mercatorLonLat,
  mercatorPixel,
  metaChmTiles,
  metaChmTileUrl,
  quadkey,
  readMetaChm,
  type ChmTiff,
} from './metaChm'

/** A stand-in COG: every full-resolution pixel holds a value from its global pixel position. */
function fakeTiff(tileX: number, tileY: number, value: (gx: number, gy: number) => number, opened: string[]) {
  return async (url: string): Promise<ChmTiff> => {
    opened.push(url)
    return {
      getImageCount: async () => 7,
      getImage: async (index: number) => ({
        getWidth: () => 2 ** (15 - index),
        readRasters: async ({ window: [x0, y0, x1, y1] }) => {
          const out = new Uint8Array((x1 - x0) * (y1 - y0))
          const key = url.match(/(\d{10})\.tif$/)![1]
          const tx = parseInt([...key].map((d) => (Number(d) & 1 ? '1' : '0')).join(''), 2)
          const ty = parseInt([...key].map((d) => (Number(d) & 2 ? '1' : '0')).join(''), 2)
          void tileX
          void tileY
          for (let r = y0; r < y1; r++)
            for (let c = x0; c < x1; c++) out[(r - y0) * (x1 - x0) + (c - x0)] = value(tx * 32768 + c, ty * 32768 + r)
          return out
        },
      }),
    }
  }
}

describe('Meta CHM v2 tiles', () => {
  it('names the zoom-10 quadkey of a point at Prince George', () => {
    // Checked against the bucket: 0212102012.tif holds the 093G086 LiDAR tile (53.89° N, 122.81° W).
    const [x, y] = mercatorPixel(-122.81, 53.89, 10).map(Math.floor)
    expect([x, y]).toEqual([162, 329])
    expect(quadkey(x, y, 10)).toBe('0212102012')
    expect(metaChmTileUrl('0212102012')).toBe('https://data.source.coop/tge-labs/meta-chm-v2/chm/0212102012.tif')
    expect(() => metaChmTileUrl('021210211')).toThrow()
  })

  it('round-trips Mercator pixels', () => {
    const [x, y] = mercatorPixel(-122.81, 53.89, 25)
    const [lon, lat] = mercatorLonLat(x, y, 25)
    expect(lon).toBeCloseTo(-122.81, 9)
    expect(lat).toBeCloseTo(53.89, 9)
  })

  it('lists every tile a box crosses', () => {
    // A box straddling the boundary between tiles x = 162 and 163.
    const edgeLon = (163 / 1024) * 360 - 180
    const tiles = metaChmTiles([edgeLon - 0.01, 53.88, edgeLon + 0.01, 53.89])
    expect(tiles.map((t) => t.x)).toEqual([162, 163])
    expect(new Set(tiles.map((t) => t.y)).size).toBe(1)
  })
})

describe('readMetaChm', () => {
  it('stitches a window across two tiles at full resolution', async () => {
    const edgeLon = (163 / 1024) * 360 - 180
    const opened: string[] = []
    const value = (gx: number, gy: number) => (gx * 7 + gy * 3) % 251
    const grid = await readMetaChm([edgeLon - 0.001, 53.885, edgeLon + 0.001, 53.886], fakeTiff(0, 0, value, opened))
    expect(opened).toHaveLength(2)
    expect(grid.zoom).toBe(25)
    // Every cell holds the value of its own global pixel, on both sides of the seam.
    for (let r = 0; r < grid.height; r += 17)
      for (let c = 0; c < grid.width; c += 13)
        expect(grid.data[r * grid.width + c]).toBe(value(grid.x0 + c, grid.y0 + r))
    expect(grid.cellM).toBeGreaterThan(0.69)
    expect(grid.cellM).toBeLessThan(0.71)
    const [px, py] = mercatorPixel(edgeLon + 0.0005, 53.8855, 25)
    expect(canopyAt(grid, edgeLon + 0.0005, 53.8855)).toBe(value(Math.floor(px), Math.floor(py)))
    expect(canopyAt(grid, edgeLon + 0.01, 53.8855)).toBeNaN()
  })

  it('reads an overview at half resolution and refuses an oversized window', async () => {
    const grid = await readMetaChm(
      [-122.82, 53.88, -122.81, 53.89],
      fakeTiff(0, 0, () => 12, []),
      { overview: 1 },
    )
    expect(grid.zoom).toBe(24)
    expect(grid.cellM).toBeCloseTo(1.4, 1)
    await expect(
      readMetaChm(
        [-122.9, 53.85, -122.8, 53.95],
        fakeTiff(0, 0, () => 1, []),
        { maxPixels: 1000 },
      ),
    ).rejects.toThrow(/smaller area/)
  })

  it('takes every cell inside a footprint radius', async () => {
    const grid = await readMetaChm(
      [-122.82, 53.88, -122.81, 53.89],
      fakeTiff(0, 0, () => 20, []),
    )
    const cells = canopyWithin(grid, -122.815, 53.885, 10)
    // π r² / cell²: about 640 cells of 0.70 m inside 10 m.
    expect(cells.length).toBeGreaterThan(600)
    expect(cells.length).toBeLessThan(680)
    expect(new Set(cells)).toEqual(new Set([20]))
  })

  it('finds an overview past the masks the COGs interleave', async () => {
    // As 0212102012.tif lists them: full, its mask, six overviews, then the overviews' masks.
    const layout = [
      [32768, 0],
      [32768, 4],
      [16384, 1],
      [8192, 1],
      [4096, 1],
      [2048, 1],
      [1024, 1],
      [512, 1],
      [16384, 5],
      [8192, 5],
    ]
    const read: number[] = []
    const tiff = async (): Promise<ChmTiff> => ({
      getImageCount: async () => layout.length,
      getImage: async (i: number) => ({
        getWidth: () => layout[i][0],
        fileDirectory: { NewSubfileType: layout[i][1] },
        readRasters: async ({ window: [x0, y0, x1, y1] }) => {
          read.push(i)
          return new Uint8Array((x1 - x0) * (y1 - y0)).fill(layout[i][1] & 4 ? 255 : 9)
        },
      }),
    })
    const grid = await readMetaChm([-122.82, 53.88, -122.81, 53.89], tiff, { overview: 1 })
    expect(read).toEqual([2])
    expect(new Set(grid.data)).toEqual(new Set([9]))
    await expect(readMetaChm([-122.82, 53.88, -122.81, 53.89], tiff, { overview: 7 })).rejects.toThrow(
      /no 256 px image/,
    )
  })
})
