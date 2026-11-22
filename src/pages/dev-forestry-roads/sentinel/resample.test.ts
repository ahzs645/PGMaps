import { describe, expect, it } from 'vitest'
import { nativeRequest, readBandOnWindow, readIndexBands, resampleNearest } from './resample'
import type { SentinelScene } from '@/lib/sentinel2/stac'
import type { RasterReader, RasterRequest, SceneWindow } from '@/lib/sentinel2/window'

// A 10 m window whose west and north edges fall halfway across a 20 m pixel.
const WINDOW: SceneWindow = { epsg: 32610, pixelM: 10, bbox: [510, 990, 550, 1030], width: 4, height: 4 }

describe('20 m bands on a 10 m window', () => {
  it('reads the 20 m pixels that hold the window, snapped outward', () => {
    expect(nativeRequest(WINDOW, 20)).toEqual({ bbox: [500, 980, 560, 1040], width: 3, height: 3 })
  })

  it('gives each 10 m pixel the 20 m pixel under its centre', () => {
    const source = nativeRequest(WINDOW, 20)
    // 3 × 3 source: values 1…9, row by row from the north.
    const band = Uint16Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9])
    const out = resampleNearest(band, source, WINDOW)
    // Window columns' centres 515, 525, 535, 545 fall in source columns 0, 1, 1, 2; rows the same.
    expect(Array.from(out)).toEqual([1, 2, 2, 3, 4, 5, 5, 6, 4, 5, 5, 6, 7, 8, 8, 9])
    expect(out).toBeInstanceOf(Uint16Array)
  })

  it('is the same for the same window every time, and no data past the source', () => {
    const source: RasterRequest = { bbox: [500, 1000, 540, 1040], width: 2, height: 2 }
    const band = Uint8Array.from([4, 5, 6, 7])
    const once = resampleNearest(band, source, WINDOW)
    expect(Array.from(resampleNearest(band, source, WINDOW))).toEqual(Array.from(once))
    // The window's last column (540–550) and last row (990–1000) lie outside the source.
    expect(once[3]).toBe(0)
    expect(Array.from(once.slice(12))).toEqual([0, 0, 0, 0])
  })

  it('reads a band no coarser than the window directly, and a coarser one on its own grid', async () => {
    const requests: RasterRequest[] = []
    const reader: RasterReader = {
      async read(_href, request) {
        requests.push({ bbox: request.bbox, width: request.width, height: request.height })
        return {
          width: request.width,
          height: request.height,
          bands: [new Uint16Array(request.width * request.height).fill(9)],
        }
      },
    }
    await readBandOnWindow('nir', WINDOW, 10, reader)
    await readBandOnWindow('swir', WINDOW, 20, reader)
    await readBandOnWindow('swir', { ...WINDOW, pixelM: 20, bbox: [500, 980, 580, 1060] }, 20, reader)
    expect(requests).toEqual([
      { bbox: WINDOW.bbox, width: 4, height: 4 },
      { bbox: [500, 980, 560, 1040], width: 3, height: 3 },
      { bbox: [500, 980, 580, 1060], width: 4, height: 4 },
    ])
  })

  it('reads the two bands and the scene classification an index needs, and says which band is missing', async () => {
    const hrefs: string[] = []
    const reader: RasterReader = {
      async read(href, request) {
        hrefs.push(href)
        return {
          width: request.width,
          height: request.height,
          bands: [new Uint16Array(request.width * request.height)],
        }
      },
    }
    const scene = {
      id: 's',
      date: '2025-08-30',
      assets: { visual: 'v', red: 'r', nir: 'n', scl: 'c', swir22: 'b12' },
      scaling: { red: { scale: 1, offset: 0 }, nir: { scale: 1, offset: 0 }, swir22: { scale: 1, offset: 0 } },
    } as unknown as SentinelScene
    const bands = await readIndexBands(scene, 'nbr', WINDOW, reader)
    expect(Object.keys(bands).sort()).toEqual(['nir', 'scl', 'swir22'])
    expect(bands.scl).toHaveLength(16)
    expect(hrefs.sort()).toEqual(['b12', 'c', 'n'])
    await expect(readIndexBands(scene, 'ndmi', WINDOW, reader)).rejects.toThrow(
      'The 2025-08-30 scene lists no SWIR (B11) band, which NDMI needs.',
    )
  })
})
