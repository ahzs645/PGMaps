import { describe, expect, it } from 'vitest'
import { resolvePaletteScale } from './paletteScale.js'
import { createScaleLegend } from './legend.js'

describe('resolved scale legend contract', () => {
  const options = {
    domain: [0, 100] as const,
    colors: ['#000000', '#ffffff'],
    classes: 4,
    classification: 'manual' as const,
    breaks: [2, 5, 20],
    missingColor: '#777777',
  }

  it('keeps uneven thresholds and boundary semantics identical to rendered colours', () => {
    const scale = resolvePaletteScale({ ...options, range: [0.2, 0.8] })
    const legend = createScaleLegend(scale, { title: 'Exposure', unit: '%', missingLabel: 'Unavailable' })
    expect(legend.domain).toEqual([0, 100])
    expect(legend.breaks).toEqual([2, 5, 20])
    expect(legend.bins.map((bin) => [bin.start, bin.end])).toEqual([
      [0, 0.02],
      [0.02, 0.05],
      [0.05, 0.2],
      [0.2, 1],
    ])
    for (const bin of legend.bins) {
      expect(scale.colorForValue(bin.min)).toBe(bin.color)
      expect(bin.includesMin).toBe(true)
    }
    expect(legend.bins.map((bin) => bin.includesMax)).toEqual([false, false, false, true])
    expect(legend).toMatchObject({ title: 'Exposure', unit: '%', boundaryPolicy: 'upper-bin', outOfDomain: 'clamp' })
    expect(legend.missing).toEqual({ color: '#777777', label: 'Unavailable', values: 'null-undefined-nonfinite' })
    expect(scale.colorForValue(0)).toBe(legend.bins[0].color)
    for (const missing of [null, undefined, NaN, Infinity])
      expect(scale.colorForValue(missing)).toBe(legend.missing.color)
    expect(scale.colorForValue(-1)).toBe(legend.bins[0].color)
    expect(scale.colorForValue(101)).toBe(legend.bins[3].color)
  })

  it('represents a constant domain with a full-width single bin', () => {
    const scale = resolvePaletteScale({ ...options, domain: [7, 7], classification: 'equal-interval' })
    const legend = createScaleLegend(scale)
    expect(legend.bins).toEqual([
      { min: 7, max: 7, includesMin: true, includesMax: true, color: scale.colors[0], start: 0, end: 1 },
    ])
  })

  it('round-trips as independent JSON without carrying resolver functions', () => {
    const scale = resolvePaletteScale(options)
    const legend = createScaleLegend(scale)
    expect(JSON.parse(JSON.stringify(legend))).toEqual(legend)
    scale.breaks[0] = 1
    scale.colors[0] = '#ff0000'
    scale.bins[0].min = -100
    expect(legend.breaks[0]).toBe(2)
    expect(legend.colors[0]).toBe('#000000')
    expect(legend.bins[0].min).toBe(0)
  })
})
