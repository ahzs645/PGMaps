import { describe, expect, it } from 'vitest'
import { fromArrayBuffer, writeArrayBuffer } from 'geotiff'
import { createCogReader } from './cogReader'
import { SENTINEL_LIST_SCL_PX, SENTINEL_MAX_WINDOW_PX } from './limits'
import type { LonLatBounds, SentinelScene } from './stac'
import {
  clearShare,
  clipRequest,
  coarseWindow,
  pasteBands,
  readSceneClearShare,
  sceneWindow,
  terrainZoneEpsg,
  windowLonLatBounds,
  windowQuad,
  type RasterReader,
} from './window'

const DEMO: LonLatBounds = [-122.731, 53.884, -122.689, 53.907]

describe('Sentinel-2 read window', () => {
  it('places BC terrain in its UTM zone and refuses ground it cannot read', () => {
    expect(terrainZoneEpsg(DEMO)).toBe(32610)
    expect(terrainZoneEpsg([-117.5, 49.2, -117.4, 49.3])).toBe(32611)
    expect(() => terrainZoneEpsg(null)).toThrow('Load terrain first')
    expect(() => terrainZoneEpsg([-100.1, 50, -100, 50.1])).toThrow("outside British Columbia's UTM zones 7–11")
    expect(() => terrainZoneEpsg([-122.7, 40, -122.6, 40.1])).toThrow('outside British Columbia')
  })

  it('covers the terrain plus the margin on the 10 m grid', () => {
    const window = sceneWindow(DEMO, 32610, { marginM: 250 })
    expect(window.pixelM).toBe(10)
    for (const value of window.bbox) expect(value % 10).toBe(0)
    expect(window.width).toBe((window.bbox[2] - window.bbox[0]) / 10)
    expect(window.height).toBe((window.bbox[3] - window.bbox[1]) / 10)
    // About 2.8 × 2.6 km of terrain, 0.5 km of margin.
    expect(window.width).toBeGreaterThan(300)
    expect(window.width).toBeLessThan(360)
    const [west, south, east, north] = windowLonLatBounds(window)
    expect(west).toBeLessThan(DEMO[0])
    expect(south).toBeLessThan(DEMO[1])
    expect(east).toBeGreaterThan(DEMO[2])
    expect(north).toBeGreaterThan(DEMO[3])
    // The margin is a few hundred metres, not kilometres.
    expect(DEMO[0] - west).toBeLessThan(0.01)
  })

  it('reads coarser pixels for wide terrain and refuses terrain past the window limit', () => {
    const wide = sceneWindow([-123.0, 53.7, -122.6, 53.95], 32610)
    expect(wide.pixelM).toBe(20)
    expect(Math.max(wide.width, wide.height)).toBeLessThanOrEqual(SENTINEL_MAX_WINDOW_PX)
    expect(() => sceneWindow([-123.5, 53.5, -122.4, 54.2], 32610)).toThrow(
      /spans .* km; Sentinel-2 imagery is read over at most 60 km/,
    )
  })

  it('returns the corners in image-source order: NW, NE, SE, SW', () => {
    const [nw, ne, se, sw] = windowQuad(sceneWindow(DEMO, 32610))
    expect(nw[1]).toBeGreaterThan(sw[1])
    expect(ne[0]).toBeGreaterThan(nw[0])
    expect(se[1]).toBeLessThan(ne[1])
    expect(sw[0]).toBeLessThan(se[0])
  })

  it('shrinks a window for whole-window statistics', () => {
    const window = sceneWindow(DEMO, 32610)
    const coarse = coarseWindow(window)
    expect(Math.max(coarse.width, coarse.height)).toBeLessThanOrEqual(SENTINEL_LIST_SCL_PX)
    expect(coarse.bbox).toEqual(window.bbox)
  })
})

describe('clipping a read to the image', () => {
  it('keeps whole output pixels inside the image and says where they land', () => {
    const clip = clipRequest({ bbox: [0, 0, 100, 100], width: 10, height: 10 }, [25, -50, 200, 75])
    expect(clip).toEqual({ column: 3, row: 3, width: 7, height: 7, bbox: [30, 0, 100, 70] })
    expect(clipRequest({ bbox: [0, 0, 100, 100], width: 10, height: 10 }, [200, 0, 300, 100])).toBeNull()
  })

  it('pastes the part into a window of no-data zeros', () => {
    const clip = { column: 1, row: 2, width: 2, height: 1, bbox: [0, 0, 0, 0] as [number, number, number, number] }
    const pasted = pasteBands({ width: 2, height: 1, bands: [[7, 9]] }, clip, 4, 4)
    expect(Array.from(pasted.bands[0])).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 7, 9, 0, 0, 0, 0, 0])
  })
})

describe('scene classification', () => {
  it('rates clear ground over covered pixels and coverage over the window', () => {
    // 0 no data, 4–7 clear, 8–9 cloud, 3 shadow, 11 snow.
    expect(clearShare([0, 0, 4, 5, 6, 7, 8, 9, 3, 11])).toEqual({ clear: 0.5, coverage: 0.8 })
    expect(clearShare([0, 0])).toEqual({ clear: 0, coverage: 0 })
  })

  it('reads the scene classification coarsely over the window', async () => {
    const requests: Array<{ width: number; height: number }> = []
    const reader: RasterReader = {
      async read(_href, { width, height }) {
        requests.push({ width, height })
        return { width, height, bands: [new Uint16Array(width * height).fill(4)] }
      },
    }
    const scene = { assets: { scl: 'https://x/SCL.tif' } } as SentinelScene
    expect(await readSceneClearShare(scene, sceneWindow(DEMO, 32610), reader)).toEqual({ clear: 1, coverage: 1 })
    expect(Math.max(requests[0].width, requests[0].height)).toBeLessThanOrEqual(SENTINEL_LIST_SCL_PX)
  })
})

describe('the COG reader', () => {
  // A 20 × 20 three-band GeoTIFF on the 10 m grid in UTM 10N; band values encode column, row and 200.
  const x0 = 500_000,
    y0 = 5_970_000
  const file = () => {
    const values: number[] = []
    for (let row = 0; row < 20; row++) for (let column = 0; column < 20; column++) values.push(column + 1, row + 1, 200)
    return writeArrayBuffer(values, {
      width: 20,
      height: 20,
      ModelPixelScale: [10, 10, 0],
      ModelTiepoint: [0, 0, 0, x0, y0, 0],
      ProjectedCSTypeGeoKey: 32610,
      GTModelTypeGeoKey: 1,
      GTRasterTypeGeoKey: 1,
    }) as ArrayBuffer
  }

  it('reads a window that runs past the image, leaving no-data outside it', async () => {
    const reader = createCogReader({ openFile: () => fromArrayBuffer(file()) })
    // Two pixels west of the image and two pixels into it from the north-west corner.
    const result = await reader.read('memory', { bbox: [x0 - 20, y0 - 40, x0 + 20, y0], width: 4, height: 4 })
    expect(result.bands).toHaveLength(3)
    const at = (band: number, column: number, row: number) => result.bands[band][row * 4 + column]
    expect(at(0, 0, 0)).toBe(0)
    expect(at(0, 1, 3)).toBe(0)
    expect([at(0, 2, 0), at(1, 2, 0), at(2, 2, 0)]).toEqual([1, 1, 200])
    expect([at(0, 3, 3), at(1, 3, 3)]).toEqual([2, 4])
  })

  it('resamples to a coarser output', async () => {
    const reader = createCogReader({ openFile: () => fromArrayBuffer(file()) })
    const result = await reader.read('memory', { bbox: [x0, y0 - 200, x0 + 200, y0], width: 5, height: 5 })
    expect(result.width).toBe(5)
    expect(result.bands[2].length).toBe(25)
    expect(Array.from(result.bands[2]).every((value) => value === 200)).toBe(true)
  })

  it('states a read failure', async () => {
    const reader = createCogReader({ openFile: async () => Promise.reject(new Error('403')) })
    await expect(reader.read('memory', { bbox: [0, 0, 10, 10], width: 1, height: 1 })).rejects.toThrow(
      'A Sentinel-2 image could not be read from the AWS archive.',
    )
  })
})
