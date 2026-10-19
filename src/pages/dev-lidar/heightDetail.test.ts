import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, it, expect, vi } from 'vitest'
import { applyHeightDetail, maskEligible, detailColour, type HeightDetail } from './heightDetail'
import { sourceCell, sourceValue, readSourceGrid } from './sourceGrids'
const detail = JSON.parse(
  readFileSync(new URL('./height-detail.generated.json', import.meta.url), 'utf8'),
) as HeightDetail

describe('native canopy height resolution', () => {
  it('preserves exact heatmap mask support at the native 1 m grid', () => {
    const mask = Uint8Array.from(atob(detail.mask_base64), (c) => c.charCodeAt(0))
    let count = 0
    for (let i = 0; i < detail.grid.width * detail.grid.height; i++) if (maskEligible(mask, i)) count++
    expect(count).toBe(detail.eligible_cells)
    expect(count).toBe(2246943)
    expect(maskEligible(mask, -1)).toBe(false)
    expect(detailColour(0)).toEqual([44, 30, 133])
    expect(detailColour(40)).toEqual(detailColour(80))
  })
  it('keeps the overview until detail is ready and restores it when native detail is disabled', () => {
    const layout: Record<string, unknown> = {},
      zooms: Record<string, number[]> = {},
      paint: Record<string, unknown> = {}
    const map = {
      getLayer: () => true,
      setLayoutProperty: (id: string, _key: string, value: unknown) => (layout[id] = value),
      setPaintProperty: (id: string, _key: string, value: unknown) => (paint[id] = value),
      setLayerZoomRange: (id: string, min: number, max: number) => (zooms[id] = [min, max]),
    }
    applyHeightDetail(map as never, true, 0.4, false)
    expect(zooms['canopy-heatmap-height']).toEqual([0, 24])
    expect(layout['canopy-height-native-detail']).toBe('none')
    applyHeightDetail(map as never, true, 0.4, true)
    expect(zooms['canopy-heatmap-height']).toEqual([0, 16])
    expect(layout['canopy-height-native-detail']).toBe('visible')
    expect(paint['canopy-height-native-detail']).toBe(0.4)
    applyHeightDetail(map as never, false, 0.4, true)
    expect(zooms['canopy-heatmap-height']).toEqual([0, 24])
    expect(layout['canopy-height-native-detail']).toBe('none')
  })
  it('reads the actual verified source GeoTIFF, preserves precision/NoData and rejects bad hashes', async () => {
    const raw = readFileSync(new URL('./fixtures/source-height-1m.tif', import.meta.url)),
      hash = createHash('sha256').update(raw).digest('hex')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(raw)),
    )
    try {
      const grid = await readSourceGrid('https://example.invalid/source/', 'height-1m.tif', hash)
      expect(grid.width).toBe(4)
      expect(grid.height).toBe(4)
      expect(grid.resolution).toBe(1)
      const i = sourceCell(grid, 511498.5, 5972414.5)
      expect(i).toBe(0)
      expect(sourceValue(grid, i)).toBeCloseTo(1.234, 5)
      expect(sourceValue(grid, 1)).toBeNull()
      expect(sourceValue(grid, -1)).toBeNull()
      await expect(readSourceGrid('https://example.invalid/source/', 'height-1m.tif', 'wrong')).rejects.toThrow(
        'hash mismatch',
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
