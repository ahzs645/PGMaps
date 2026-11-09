import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clampImageView,
  createImageTileReader,
  fitImageScale,
  moveImageView,
  validateImagePyramidMetadata,
  visibleImageTiles,
} from './imagePyramid'
import type { ImagePyramid } from './catalogue'

const remote = vi.hoisted(() => ({
  header: vi.fn(),
  metadata: vi.fn(),
  tile: vi.fn(),
  sources: [] as { getBytes: (offset: number, length: number, signal?: AbortSignal) => Promise<unknown> }[],
}))
vi.mock('pmtiles', () => ({
  TileType: { Png: 2, Jpeg: 3, Webp: 4, Avif: 5 },
  PMTiles: class {
    constructor(source: { getBytes: (offset: number, length: number, signal?: AbortSignal) => Promise<unknown> }) {
      remote.sources.push(source)
    }
    getHeader = remote.header
    getMetadata = remote.metadata
    getZxy = remote.tile
  },
}))
const hash = 'a'.repeat(64)
const pyramid: ImagePyramid = {
  format: 'pmtiles-image-v1',
  url: 'https://maps.example.test/source.pmtiles',
  width: 12095,
  height: 6712,
  tileSize: 512,
  maxZoom: 5,
  sha256: 'b'.repeat(64),
}
const metadata = {
  kind: 'pgmaps-image-pyramid-v1',
  width: pyramid.width,
  height: pyramid.height,
  tileSize: 512,
  maxZoom: 5,
  sourceSha256: hash,
}
const viewport = { width: 640, height: 400 }

describe('Source-image tile coordinates', () => {
  it('fetches small overview tiles for the whole sheet and native tiles only for the zoomed viewport', () => {
    const view = {
      x: pyramid.width / 2,
      y: pyramid.height / 2,
      scale: fitImageScale(pyramid.width, pyramid.height, viewport),
    }
    const overview = visibleImageTiles(pyramid, view, viewport)
    expect(overview.map((tile) => [tile.z, tile.x, tile.y])).toEqual([
      [1, 0, 0],
      [1, 1, 0],
    ])
    const detail = visibleImageTiles(pyramid, { ...view, scale: 1 }, viewport, 2)
    expect(detail.map((tile) => [tile.z, tile.x, tile.y])).toEqual([
      [5, 11, 6],
      [5, 12, 6],
    ])
    expect(detail[0].left).toBe(11 * 512)
    expect(detail[0].top).toBe(6 * 512)
  })

  it('preserves power-of-two source spacing at odd image edges instead of stretching an edge tile', () => {
    const odd = { ...pyramid, width: 1001, height: 501, maxZoom: 1 }
    const tiles = visibleImageTiles(odd, { x: 500.5, y: 250.5, scale: 0.5 }, { width: 501, height: 251 })
    expect(tiles).toEqual([{ key: '0/0/0', z: 0, x: 0, y: 0, left: 0, top: 0, width: 1002, height: 502 }])
    // The image container clips the one-pixel transparent padding to 1001 × 501.
  })

  it('caps visible requests and never wraps flat image coordinates around the world', () => {
    const large = { ...pyramid, width: 200000, height: 180000, maxZoom: 9 }
    const tiles = visibleImageTiles(large, { x: 100000, y: 90000, scale: 1 }, { width: 30000, height: 30000 }, 2)
    expect(tiles.length).toBeLessThanOrEqual(64)
    expect(
      tiles.every((tile) => tile.left >= 0 && tile.top >= 0 && tile.left < large.width && tile.top < large.height),
    ).toBe(true)
    expect(visibleImageTiles(pyramid, { x: -100000, y: -100000, scale: 1 }, viewport)).toEqual([])
  })

  it('keeps an interior source pixel under the pinch centre while zooming and pans within the image', () => {
    const view = { x: 6000, y: 3300, scale: 1 }
    const from: [number, number] = [200, 100],
      to: [number, number] = [220, 140]
    const moved = moveImageView(view, viewport, pyramid.width, pyramid.height, from, to, 2)
    expect(moved.x + (to[0] - 320) / moved.scale).toBe(view.x + from[0] - 320)
    expect(moved.y + (to[1] - 200) / moved.scale).toBe(view.y + from[1] - 200)
    expect(clampImageView({ x: -1e6, y: 1e6, scale: 1 }, pyramid.width, pyramid.height, viewport)).toEqual({
      x: 320,
      y: 6512,
      scale: 1,
    })
    expect(clampImageView({ x: 50, y: 25, scale: 1 }, 100, 50, viewport).scale).toBe(1)
  })
})

describe('Source-image identity and interrupted tile reads', () => {
  beforeEach(() => {
    remote.sources.length = 0
    remote.header.mockReset().mockResolvedValue({ minZoom: 0, maxZoom: 5, tileType: 4 })
    remote.metadata.mockReset().mockResolvedValue(metadata)
    remote.tile.mockReset().mockResolvedValue({ data: new Uint8Array([1, 2, 3]).buffer })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:tile')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('rejects a geographic archive and a different original even when its dimensions match', () => {
    expect(() => validateImagePyramidMetadata({ ...metadata, kind: 'raster-map' }, pyramid, hash)).toThrow(
      /does not match/,
    )
    expect(() => validateImagePyramidMetadata({ ...metadata, sourceSha256: 'c'.repeat(64) }, pyramid, hash)).toThrow(
      /does not match/,
    )
    expect(() => validateImagePyramidMetadata({ ...metadata, width: 12094 }, pyramid, hash)).toThrow(/does not match/)
    expect(() => validateImagePyramidMetadata(metadata, pyramid, hash)).not.toThrow()
  })

  it('does not display or retain a late tile from a source closed during loading', async () => {
    let finish!: (result: { data: ArrayBuffer }) => void
    remote.tile.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const reader = createImageTileReader(pyramid, hash)
    const tile = visibleImageTiles(pyramid, { x: 6000, y: 3300, scale: 1 }, viewport)[0]
    const promise = reader.read(tile, new AbortController().signal)
    await vi.waitFor(() => expect(remote.tile).toHaveBeenCalled())
    reader.dispose()
    finish({ data: new Uint8Array([1]).buffer })
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('rejects mismatched metadata before requesting any image tile', async () => {
    remote.metadata.mockResolvedValue({ ...metadata, sourceSha256: 'c'.repeat(64) })
    const reader = createImageTileReader(pyramid, hash)
    const tile = visibleImageTiles(pyramid, { x: 6000, y: 3300, scale: 1 }, viewport)[0]
    await expect(reader.read(tile, new AbortController().signal)).rejects.toThrow(/does not match/)
    expect(remote.tile).not.toHaveBeenCalled()
    reader.dispose()
  })

  it('uses bounded credential-free ranges, validates the published checksum and aborts metadata on disposal', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 206,
        headers: { 'Content-Length': '3', 'X-Content-SHA256': pyramid.sha256! },
      }),
    )
    vi.stubGlobal('fetch', fetch)
    const reader = createImageTileReader(pyramid, hash)
    await remote.sources[0].getBytes(32, 3)
    expect(fetch).toHaveBeenCalledWith(
      pyramid.url,
      expect.objectContaining({
        headers: { Range: 'bytes=32-34' },
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      }),
    )
    fetch.mockResolvedValue(
      new Response(new Uint8Array([1]), { status: 206, headers: { 'X-Content-SHA256': 'c'.repeat(64) } }),
    )
    await expect(remote.sources[0].getBytes(0, 3)).rejects.toThrow(/changed/)
    await expect(remote.sources[0].getBytes(0, 9 * 1024 * 1024)).rejects.toThrow(/unsupported range/)
    fetch.mockImplementation(
      (_url: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true })
        }),
    )
    const metadataRead = remote.sources[0].getBytes(0, 1024)
    reader.dispose()
    await expect(metadataRead).rejects.toMatchObject({ name: 'AbortError' })
  })
})
