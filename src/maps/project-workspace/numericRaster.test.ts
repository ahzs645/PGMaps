import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { numericRasterColor, numericRasterGradient, parseNumericRasterManifest } from './numericRaster'

const source = JSON.parse(
  readFileSync('vendor/bcdatamapper/datascrapers/climate/echoscreen/output/hot-days-future/manifest.json', 'utf8'),
)

describe('consultant numeric raster styles', () => {
  it('uses the original continuous 0–64 ramp and QGIS channel truncation for a fractional cell', () => {
    const m = parseNumericRasterManifest(source)
    expect(numericRasterColor(m.style, 39.28333282470703)).toEqual([253, 151, 66, 255])
    expect(numericRasterColor(m.style, 0)).toEqual([246, 255, 0, 255])
    expect(numericRasterColor(m.style, 64)).toEqual([227, 26, 28, 255])
    expect(numericRasterColor(m.style, 100)).toEqual([227, 26, 28, 255])
    expect(numericRasterGradient(m.style)[0]).toBe('rgba(246, 255, 0, 1) 0%')
    expect(numericRasterGradient(m.style).at(-1)).toBe('rgba(227, 26, 28, 1) 100%')
  })
  it('preserves alpha, non-uniform stop positions, and clipped/missing transparency', () => {
    const m = parseNumericRasterManifest({
      ...source,
      style: {
        ...source.style,
        clip: true,
        stops: [
          { value: -10, color: [200, 0, 0, 255] },
          { value: 0, color: [255, 255, 255, 0] },
          { value: 30, color: [0, 0, 200, 255] },
        ],
      },
    })
    expect(numericRasterColor(m.style, 0)).toEqual([255, 255, 255, 0])
    expect(numericRasterColor(m.style, 15)).toEqual([128, 128, 228, 127])
    expect(numericRasterColor(m.style, -11)).toEqual([0, 0, 0, 0])
    expect(numericRasterColor(m.style, NaN)).toEqual([0, 0, 0, 0])
    expect(numericRasterGradient(m.style)[1]).toBe('rgba(255, 255, 255, 0) 25%')
  })
  it('rejects broken ramps instead of displaying a plausible default style', () => {
    expect(() =>
      parseNumericRasterManifest({ ...source, style: { ...source.style, stops: [...source.style.stops].reverse() } }),
    ).toThrow('colour ramp')
    expect(() =>
      parseNumericRasterManifest({
        ...source,
        style: {
          ...source.style,
          stops: [
            { value: 0, color: [0, 0, 0, 300] },
            { value: 1, color: [1, 1, 1, 255] },
          ],
        },
      }),
    ).toThrow('colour ramp')
  })
})
