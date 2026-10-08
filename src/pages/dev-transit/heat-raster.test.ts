import { describe, expect, it } from 'vitest'
import { blendHeatPixels, heatColor, makeHeatRaster } from './heat-raster'

describe('travel-time raster interpolation', () => {
  it('keeps coverage stable throughout transitions instead of flashing the basemap', () => {
    const previous = new Uint8ClampedArray([40, 160, 30, 155])
    const next = new Uint8ClampedArray([220, 100, 80, 155])
    const out = new Uint8ClampedArray(4)
    for (const progress of [0, 0.1, 0.25, 0.5, 0.75, 1]) {
      blendHeatPixels(previous, next, progress, out)
      expect(out[3]).toBe(155)
      for (let channel = 0; channel < 3; channel++) {
        expect(out[channel]).toBeGreaterThanOrEqual(Math.min(previous[channel], next[channel]))
        expect(out[channel]).toBeLessThanOrEqual(Math.max(previous[channel], next[channel]))
      }
    }
    blendHeatPixels(previous, new Uint8ClampedArray([0, 0, 0, 0]), 0.5, out)
    expect(Array.from(out.slice(0, 3))).toEqual([40, 160, 30])
    expect(out[3]).toBe(78)
  })
  it('colours the interpolated minutes, including the cell centres at the image edges', () => {
    const raster = makeHeatRaster([0, 40], 2, 1, 40)
    expect([raster.width, raster.height]).toEqual([4, 2])
    for (const [col, minutes] of [0, 10, 30, 40].entries()) {
      const expected = heatColor(minutes, 40)
      expected.forEach((channel, i) => expect(Math.abs(raster.pixels[col * 4 + i] - channel)).toBeLessThanOrEqual(1))
    }
  })
  it('keeps disconnected gaps transparent and fades their edges without treating missing access as zero minutes', () => {
    const raster = makeHeatRaster([20, -1, -1, -1, 30], 5, 1, 45)
    for (const col of [3, 4, 5, 6]) expect(raster.pixels[col * 4 + 3]).toBe(0)
    const edge = Array.from(raster.pixels.slice(4, 8))
    const color = heatColor(20, 45)
    expect(edge.slice(0, 3)).toEqual(color.slice(0, 3))
    expect(edge[3]).toBe(Math.round(color[3] * 0.75))
  })
  it('does not show reachable colours where interpolation exceeds the travel-time scale', () => {
    const raster = makeHeatRaster([0, 100], 2, 1, 20)
    expect(raster.pixels[3]).toBe(155)
    for (const col of [1, 2, 3]) expect(raster.pixels[col * 4 + 3]).toBe(0)
    expect(makeHeatRaster([-1, Infinity, NaN], 3, 1, 45).pixels.every((n) => n === 0)).toBe(true)
  })
})
