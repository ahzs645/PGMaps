import { describe, expect, it } from 'vitest'
import { previewTiles, projectedBounds } from './rasterPreview'

describe('Image preview tile planning', () => {
  it('uses the same north-down Mercator coordinates as the stored XYZ tiles', () => {
    expect(previewTiles([-85, 1, -5, 60], 2)).toEqual([{ x: 1, y: 1, z: 2 }])
    const box = projectedBounds([-126, 53, -124, 55])
    expect(box.left).toBeLessThan(box.right)
    expect(box.top).toBeLessThan(box.bottom)
  })
  it('clamps polar bounds and keeps the world within valid tile indices', () => {
    const tiles = previewTiles([-180, -90, 180, 90], 0)
    expect(tiles).toEqual([{ x: 0, y: 0, z: 0 }])
  })
  it('bounds preview requests instead of trying to fetch an entire high-zoom world', () => {
    expect(() => previewTiles([-180, -80, 180, 80], 16)).toThrow(/too large/)
  })
})
