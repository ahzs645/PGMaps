import { describe, expect, it } from 'vitest'
import {
  WALKABILITY_MI_BANDS,
  WALKABILITY_MI_BAND_COLORS,
  resolveWalkabilityMiBands,
  toWalkabilityMiLegendBands,
} from './walkabilityMiBands'

describe('resolveWalkabilityMiBands', () => {
  it('falls back to the report defaults when the grid has not loaded', () => {
    const bands = resolveWalkabilityMiBands(null)
    expect(bands).toHaveLength(5)
    expect(bands.map((band) => band.label)).toEqual(['1-27', '28-45', '46-63', '64-82', '83+'])
    expect(bands[0].color).toBe('#4f9ad6')
  })

  it('takes colours and labels from the generated grid', () => {
    const bands = resolveWalkabilityMiBands({
      bandColors: { 1: '#111111', 5: '#555555' },
      bandLabels: { 1: 'Component 1-30', 5: 'Component 90-200' },
    })
    expect(bands[0].color).toBe('#111111')
    expect(bands[0].label).toBe('1-30')
    expect(bands[4].color).toBe('#555555')
    expect(bands[4].label).toBe('90-200')
  })

  it('merges per band, so a grid defining only colours keeps default labels', () => {
    const bands = resolveWalkabilityMiBands({ bandColors: { 2: '#222222' } })
    expect(bands[1].color).toBe('#222222')
    expect(bands[1].label).toBe('28-45')
    expect(bands[0].color).toBe(WALKABILITY_MI_BANDS[0].color)
  })

  it('ignores empty or non-string band metadata', () => {
    const bands = resolveWalkabilityMiBands({
      bandColors: { 1: '' },
      bandLabels: { 1: '   ' },
    } as never)
    expect(bands[0].color).toBe('#4f9ad6')
    expect(bands[0].label).toBe('1-27')
  })

  it('passes through labels that do not use the generator prefix', () => {
    const bands = resolveWalkabilityMiBands({ bandLabels: { 3: 'Moderate' } })
    expect(bands[2].label).toBe('Moderate')
  })

  it('keeps the worker thresholds, which the grid does not carry', () => {
    const bands = resolveWalkabilityMiBands({ bandLabels: { 1: 'Component 1-30' } })
    expect(bands[0].max).toBe(27.4)
    expect(bands[4].max).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('walkability MI band exports', () => {
  it('keys the raster fallback colours by grid band value', () => {
    expect(WALKABILITY_MI_BAND_COLORS).toEqual({
      1: '#4f9ad6',
      2: '#9ec99c',
      3: '#f5e451',
      4: '#e89c4a',
      5: '#d33b3b',
    })
  })

  it('reduces to label/colour pairs for the stepped legend', () => {
    const legend = toWalkabilityMiLegendBands(resolveWalkabilityMiBands(null))
    expect(legend[0]).toEqual({ label: '1-27', color: '#4f9ad6' })
    expect(Object.keys(legend[0])).toEqual(['label', 'color'])
  })
})
