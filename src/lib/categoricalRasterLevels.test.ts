import { describe, expect, it } from 'vitest'
import { canPublishRasterLevel, selectRasterLevel, type RasterLevel } from './categoricalRasterLevels'

const levels: RasterLevel[] = [0, 6, 7, 8].map((minZoom) => ({
  id: String(minZoom),
  label: String(minZoom),
  minZoom,
  manifest: '',
  overview: minZoom < 8,
}))

describe('categorical raster zoom levels', () => {
  it('selects the overview on a distant cold start and full cells at close zoom', () => {
    expect(selectRasterLevel(levels, 5.16).id).toBe('0')
    expect(selectRasterLevel(levels, 7.5).id).toBe('7')
    expect(selectRasterLevel(levels, 13).id).toBe('8')
  })
  it('does not thrash around a boundary, but follows large zoom jumps', () => {
    expect(selectRasterLevel(levels, 8.1, levels[2])).toBe(levels[2])
    expect(selectRasterLevel(levels, 7.9, levels[3])).toBe(levels[3])
    expect(selectRasterLevel(levels, 8.3, levels[2])).toBe(levels[3])
    expect(selectRasterLevel(levels, 5, levels[3])).toBe(levels[0])
    expect(selectRasterLevel(levels, 7.1, levels[0])).toBe(levels[2])
  })
  it('keeps previous geometry until all visible replacement blocks are ready', () => {
    expect(canPublishRasterLevel('overview', 'full', 3, 4)).toBe(false)
    expect(canPublishRasterLevel('overview', 'full', 4, 4)).toBe(true)
    expect(canPublishRasterLevel('full', 'full', 3, 4)).toBe(true)
    expect(canPublishRasterLevel(undefined, 'full', 1, 4)).toBe(true)
  })
})
