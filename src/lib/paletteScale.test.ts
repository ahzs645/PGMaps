import { describe, expect, it } from 'vitest'
import { paletteContrast, paletteInterpolator, resolvePaletteScale, samplePalette } from './paletteScale'
import catalog from '@/pages/dev-color-palettes/catalog.generated.json'

const base = { colors: ['#000000', '#ffffff'], domain: [0, 100] as const, classes: 5, missingColor: '#777777' }
describe('palette sampling and classification', () => {
  it('trims the colour range without changing numeric class breaks', () => {
    const scale = resolvePaletteScale({ ...base, range: [0.2, 0.8] })
    expect(scale.breaks).toEqual([20, 40, 60, 80])
    expect(scale.colors[0]).toBe('rgb(51, 51, 51)')
    expect(scale.colors[4]).toBe('rgb(204, 204, 204)')
    expect(scale.colorForValue(20)).toBe(scale.colors[1])
    expect(scale.colorForValue(-1)).toBe(scale.colors[0])
    expect(scale.colorForValue(101)).toBe(scale.colors[4])
    expect(scale.colorForValue(0)).not.toBe(base.missingColor)
    for (const value of [null, undefined, NaN, Infinity]) expect(scale.colorForValue(value)).toBe(base.missingColor)
  })
  it('resamples across the selected interval and reverses only colours', () => {
    const a = samplePalette({ ...base, range: [0.2, 0.8] }, 3)
    expect(samplePalette({ ...base, range: [0.2, 0.8], reverse: true }, 3)).toEqual([...a].reverse())
    expect(samplePalette(base, 1)).toEqual(['rgb(128, 128, 128)'])
  })
  it('preserves uneven stop positions', () => {
    expect(paletteInterpolator({ colors: ['#000000', '#ff0000', '#ffffff'], positions: [0, 10, 100] })(0.1)).toBe(
      'rgb(255, 0, 0)',
    )
  })
  it('deduplicates quantiles, excludes missing observations and collapses constant data', () => {
    const scale = resolvePaletteScale({
      ...base,
      classification: 'quantile',
      values: [0, 0, 0, 10, 10, 10, 100, null, NaN],
    })
    expect(scale.breaks).toHaveLength(2)
    expect(scale.breaks[0]).toBeCloseTo(4)
    expect(scale.breaks[1]).toBe(10)
    expect(scale.effectiveClasses).toBe(3)
    expect(resolvePaletteScale({ ...base, classification: 'quantile', values: [7, 7, 7] }).effectiveClasses).toBe(1)
    expect(resolvePaletteScale({ ...base, domain: [0, 0] }).effectiveClasses).toBe(1)
  })
  it('uses manual breaks exactly, including their upper-bin boundary convention', () => {
    const scale = resolvePaletteScale({ ...base, classification: 'manual', breaks: [2, 5, 20] })
    expect(scale.effectiveClasses).toBe(4)
    expect(scale.indexForValue(5)).toBe(2)
    expect(scale.bins[3]).toMatchObject({ min: 20, max: 100, includesMax: true })
  })
  it('rejects inverted ranges, invalid colours and unordered thresholds', () => {
    expect(() => samplePalette({ ...base, range: [0.8, 0.2] }, 5)).toThrow()
    expect(() => samplePalette({ colors: ['invalid'] }, 2)).toThrow()
    expect(() => resolvePaletteScale({ ...base, classification: 'manual', breaks: [50, 20] })).toThrow()
    expect(() => resolvePaletteScale({ ...base, classification: 'quantile', values: [null] })).toThrow()
  })
  it('computes sRGB luminance contrast after alpha compositing', () => {
    expect(paletteContrast('#000000', '#ffffff')).toBeCloseTo(21)
    expect(paletteContrast('rgba(0,0,0,0)', '#ffffff')).toBeCloseTo(1)
    expect(paletteContrast('#000000', '#ffffff', 0.5)).toBeCloseTo(3.97665)
    expect(paletteContrast('rgb(0 0 0 / 50%)', 'hsl(0 0% 100%)')).toBeCloseTo(3.97665)
  })
  it('can preview every captured authored palette without a colour-parser crash', () => {
    for (const palette of catalog.palettes) {
      for (const fill of palette.colors)
        expect(Number.isFinite(paletteContrast(fill, '#0a0a0a')), `${palette.name}: ${fill}`).toBe(true)
    }
  })
})
