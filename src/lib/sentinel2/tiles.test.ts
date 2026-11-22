import { describe, expect, it } from 'vitest'
import { SENTINEL_TILE_MAX_ZOOM, SENTINEL_TILE_MIN_ZOOM } from './limits'
import {
  parseSentinelTileUrl,
  readSentinelTile,
  SENTINEL_TILE_SIZE,
  sentinelTileUrl,
  tilePointLonLat,
  tileReadWindow,
  warpTile,
} from './tiles'
import { utm, type RasterReader } from './window'

// A zoom-13 tile in Prince George, in UTM zone 10.
const Z = 13
const X = 1302
const Y = 2634
const EPSG = 32610

describe('tile geometry', () => {
  it('places a tile’s corners the way the map numbers its tiles', () => {
    const [west, north] = tilePointLonLat(Z, X, Y, 0, 0)
    const [east, south] = tilePointLonLat(Z, X, Y, SENTINEL_TILE_SIZE, SENTINEL_TILE_SIZE)
    expect(west).toBeCloseTo(-122.783, 3)
    expect(east - west).toBeCloseTo(360 / 2 ** Z, 9)
    expect(north).toBeGreaterThan(south)
    expect(north).toBeCloseTo(53.93, 1)
  })

  it('reads a deep tile at 10 m and a shallow one from a coarser overview, covering the whole tile', () => {
    const deep = tileReadWindow(Z, X, Y, EPSG)
    expect(deep.pixelM).toBe(10)
    const shallow = tileReadWindow(9, X >> 4, Y >> 4, EPSG)
    expect(shallow.pixelM).toBeGreaterThan(80)
    expect(shallow.width).toBeLessThan(600)
    const projection = utm(EPSG)
    for (const [px, py] of [
      [0, 0],
      [SENTINEL_TILE_SIZE, SENTINEL_TILE_SIZE],
    ]) {
      const [ux, uy] = projection.forward(tilePointLonLat(Z, X, Y, px, py))
      expect(ux).toBeGreaterThan(deep.bbox[0])
      expect(ux).toBeLessThan(deep.bbox[2])
      expect(uy).toBeGreaterThan(deep.bbox[1])
      expect(uy).toBeLessThan(deep.bbox[3])
    }
  })
})

describe('warpTile', () => {
  const read = tileReadWindow(Z, X, Y, EPSG)
  /** A read whose red band holds each pixel's column and green its row, so the warp can be checked. */
  const bands = () => {
    const size = read.width * read.height
    const r = new Uint8Array(size)
    const g = new Uint8Array(size)
    const b = new Uint8Array(size).fill(1)
    for (let row = 0; row < read.height; row++)
      for (let column = 0; column < read.width; column++) {
        r[row * read.width + column] = column % 256
        g[row * read.width + column] = row % 256
      }
    return { width: read.width, height: read.height, bands: [r, g, b] }
  }

  it('puts each tile pixel on the read pixel under it', () => {
    const tile = warpTile(read, bands(), Z, X, Y)
    const projection = utm(EPSG)
    for (const [px, py] of [
      [10, 10],
      [128, 200],
      [250, 30],
    ]) {
      const [ux, uy] = projection.forward(tilePointLonLat(Z, X, Y, px + 0.5, py + 0.5))
      const column = Math.floor((ux - read.bbox[0]) / read.pixelM)
      const row = Math.floor((read.bbox[3] - uy) / read.pixelM)
      const o = (py * SENTINEL_TILE_SIZE + px) * 4
      // The interpolated grid lands within one read pixel of projecting the pixel itself.
      expect(Math.abs(tile[o] - (column % 256))).toBeLessThanOrEqual(1)
      expect(Math.abs(tile[o + 1] - (row % 256))).toBeLessThanOrEqual(1)
      expect(tile[o + 3]).toBe(255)
    }
  })

  it('leaves no-data pixels clear', () => {
    const empty = {
      width: read.width,
      height: read.height,
      bands: [0, 0, 0].map(() => new Uint8Array(read.width * read.height)),
    }
    const tile = warpTile(read, empty, Z, X, Y)
    expect(tile.some((value, i) => i % 4 === 3 && value !== 0)).toBe(false)
  })
})

describe('reading a tile', () => {
  it('asks the reader for the tile’s window and nothing outside the drawn zooms', async () => {
    const asked: string[] = []
    const reader: RasterReader = {
      read: async (href, request) => {
        asked.push(href)
        return {
          width: request.width,
          height: request.height,
          bands: [1, 2, 3].map(() => new Uint8Array(request.width * request.height).fill(9)),
        }
      },
    }
    const tile = await readSentinelTile('https://cog/TCI.tif', EPSG, Z, X, Y, reader)
    expect(asked).toEqual(['https://cog/TCI.tif'])
    expect(tile?.[3]).toBe(255)
    expect(await readSentinelTile('https://cog/TCI.tif', EPSG, SENTINEL_TILE_MIN_ZOOM - 1, 0, 0, reader)).toBeNull()
    expect(await readSentinelTile('https://cog/TCI.tif', EPSG, SENTINEL_TILE_MAX_ZOOM + 1, 0, 0, reader)).toBeNull()
    expect(asked).toHaveLength(1)
  })

  it('round-trips a scene’s tile address and refuses anything else', () => {
    const template = sentinelTileUrl({ epsg: EPSG, assets: { visual: 'https://cog/a b/TCI.tif' } })
    const url = template.replace('{z}', '13').replace('{x}', '1302').replace('{y}', '2634')
    expect(parseSentinelTileUrl(url)).toEqual({
      epsg: EPSG,
      z: 13,
      x: 1302,
      y: 2634,
      visualHref: 'https://cog/a b/TCI.tif',
    })
    expect(parseSentinelTileUrl('pgmaps-s2://32610/1/2/3?cog=http%3A%2F%2Fplain')).toBeNull()
    expect(parseSentinelTileUrl('pgmaps-chm://1/2/3')).toBeNull()
  })
})
