import { describe, expect, it } from 'vitest'
import {
  findValueBand,
  interpolateStopColor,
  stopColor,
  mergeValueBandMetadata,
  valueBandColorsById,
  valueBandLegendItems,
  valueBandRampColors,
  type ValueBand,
} from './valueBands'

const BANDS: readonly ValueBand<number>[] = [
  { id: 1, min: 0, max: 10, label: 'low', color: '#111111' },
  { id: 2, min: 10, max: 20, label: 'mid', color: '#222222' },
  { id: 3, min: 20, max: Number.POSITIVE_INFINITY, label: 'high', color: '#333333' },
]

describe('findValueBand', () => {
  it('is inclusive of min and exclusive of max', () => {
    expect(findValueBand(BANDS, 0)?.id).toBe(1)
    expect(findValueBand(BANDS, 9.999)?.id).toBe(1)
    expect(findValueBand(BANDS, 10)?.id).toBe(2)
    expect(findValueBand(BANDS, 20)?.id).toBe(3)
  })

  it('lands anything above the last cut point in the open-ended band', () => {
    expect(findValueBand(BANDS, 1e9)?.id).toBe(3)
  })

  it('returns null rather than clamping values below the first band', () => {
    expect(findValueBand(BANDS, -1)).toBeNull()
  })

  it('returns null for missing and non-finite values', () => {
    expect(findValueBand(BANDS, null)).toBeNull()
    expect(findValueBand(BANDS, undefined)).toBeNull()
    expect(findValueBand(BANDS, Number.NaN)).toBeNull()
  })
})

describe('band derivations', () => {
  it('reduces to label/colour pairs for the stepped legend', () => {
    expect(valueBandLegendItems(BANDS)).toEqual([
      { label: 'low', color: '#111111' },
      { label: 'mid', color: '#222222' },
      { label: 'high', color: '#333333' },
    ])
  })

  it('keeps ramp order lowest band first', () => {
    expect(valueBandRampColors(BANDS)).toEqual(['#111111', '#222222', '#333333'])
  })

  it('keys colours by band id', () => {
    expect(valueBandColorsById(BANDS)).toEqual({ 1: '#111111', 2: '#222222', 3: '#333333' })
  })
})

describe('mergeValueBandMetadata', () => {
  it('overlays colours and labels by band id', () => {
    const merged = mergeValueBandMetadata(BANDS, {
      colors: { 2: '#abcdef' },
      labels: { 3: 'highest' },
    })
    expect(merged[1].color).toBe('#abcdef')
    expect(merged[2].label).toBe('highest')
  })

  it('merges per field, so colour-only metadata keeps the original labels', () => {
    const merged = mergeValueBandMetadata(BANDS, { colors: { 1: '#000000' } })
    expect(merged[0].color).toBe('#000000')
    expect(merged[0].label).toBe('low')
  })

  it('falls back for blank and non-textual entries', () => {
    const merged = mergeValueBandMetadata(BANDS, {
      colors: { 1: '   ' },
      labels: { 1: 42 as unknown as string },
    })
    expect(merged[0].color).toBe('#111111')
    expect(merged[0].label).toBe('low')
  })

  it('never takes ranges from metadata', () => {
    const merged = mergeValueBandMetadata(BANDS, { labels: { 1: '0-99' } })
    expect(merged[0].label).toBe('0-99')
    expect(merged[0].min).toBe(0)
    expect(merged[0].max).toBe(10)
  })

  it('lets formatLabel reject a label and keep the default', () => {
    const merged = mergeValueBandMetadata(
      BANDS,
      { labels: { 1: 'Component 0-9', 2: 'skip me' } },
      { formatLabel: (raw) => (raw.startsWith('Component ') ? raw.slice('Component '.length) : null) },
    )
    expect(merged[0].label).toBe('0-9')
    expect(merged[1].label).toBe('mid')
  })

  it('leaves the source bands untouched', () => {
    mergeValueBandMetadata(BANDS, { colors: { 1: '#ffffff' } })
    expect(BANDS[0].color).toBe('#111111')
  })
})

describe('stopColor', () => {
  // Thresholds are upper bounds, matching bcassessment's assessed-value ramp.
  const stops = [
    [0, '#000000'],
    [100, '#808080'],
    [200, '#ffffff'],
  ] as const

  it('returns the first stop at or above the value', () => {
    expect(stopColor(stops, 0)).toBe('#000000')
    expect(stopColor(stops, 1)).toBe('#808080')
    expect(stopColor(stops, 100)).toBe('#808080')
    expect(stopColor(stops, 101)).toBe('#ffffff')
  })

  it('clamps below the first stop and above the last', () => {
    expect(stopColor(stops, -50)).toBe('#000000')
    expect(stopColor(stops, 9999)).toBe('#ffffff')
  })

  it('does not throw on an empty ramp', () => {
    expect(stopColor([], 5)).toBe('#000000')
  })
})

describe('interpolateStopColor', () => {
  const stops = [
    [0, '#000000'],
    [100, '#ffffff'],
  ] as const

  it('blends between the bracketing stops', () => {
    expect(interpolateStopColor(stops, 50)).toBe('#808080')
    expect(interpolateStopColor(stops, 25)).toBe('#404040')
  })

  it('returns the exact stop colour at a threshold', () => {
    expect(interpolateStopColor(stops, 0)).toBe('#000000')
    expect(interpolateStopColor(stops, 100)).toBe('#ffffff')
  })

  it('clamps outside the ramp', () => {
    expect(interpolateStopColor(stops, -10)).toBe('#000000')
    expect(interpolateStopColor(stops, 500)).toBe('#ffffff')
  })

  it('survives duplicate thresholds instead of dividing by zero', () => {
    const duplicated = [[0, '#000000'], [10, '#ff0000'], [10, '#00ff00']] as const
    expect(interpolateStopColor(duplicated, 10)).toBe('#ff0000')
  })

  it('does not throw on an empty ramp', () => {
    expect(interpolateStopColor([], 5)).toBe('#000000')
  })
})
