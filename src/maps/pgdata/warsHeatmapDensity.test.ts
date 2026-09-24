import { describe, expect, it } from 'vitest'
import { estimateHeatmapPeak } from './warsHeatmapDensity'
import { DEFAULT_WARS_HEATMAP, parseWarsHeatmapSettings, serializeWarsHeatmapSettings } from './WarsHeatmapControls'

describe('WARS relative heatmap density', () => {
  const peak = (points: { x: number; y: number; weight: number }[]) => estimateHeatmapPeak(points, 240, 240, 24)
  const point = { x: 120, y: 120, weight: 0.25 }

  it('matches a single MapLibre Gaussian and scales with coincident records or animal weight', () => {
    expect(peak([point])).toBeCloseTo(0.25 / Math.sqrt(2 * Math.PI), 6)
    expect(peak(Array(100).fill(point))).toBeCloseTo(100 * peak([point]), 6)
    expect(peak([{ ...point, weight: 25 }])).toBeCloseTo(100 * peak([point]), 6)
  })

  it('responds to overlap when zooming out, rather than just counting visible records', () => {
    const spread = peak([{ ...point, x: 60 }, { ...point, x: 180 }])
    const together = peak([point, point])
    expect(together).toBeCloseTo(2 * spread, 6)
  })

  it('ignores offscreen peaks but includes the tails of kernels at the viewport edge', () => {
    expect(peak([point, { ...point, x: -100, weight: 10000 }])).toBe(peak([point]))
    const edge = peak([{ ...point, x: -12 }])
    expect(edge).toBeGreaterThan(0)
    expect(edge).toBeLessThan(peak([point]))
  })

  it('handles empty views and invalid points without poisoning the density scale', () => {
    expect(peak([])).toBe(0)
    expect(peak([{ ...point, x: NaN }, { ...point, weight: Infinity }, { ...point, weight: -1 }])).toBe(0)
    expect(estimateHeatmapPeak([point], 0, 0, 24)).toBe(0)
  })

  it('uses relative density on new maps, preserves old manual links, and round-trips both modes', () => {
    expect(parseWarsHeatmapSettings(null)).toEqual(DEFAULT_WARS_HEATMAP)
    expect(parseWarsHeatmapSettings('viridis,animals,34,21,66').scale).toBe('fixed')
    for (const scale of ['relative', 'fixed'] as const) {
      const settings = { ...DEFAULT_WARS_HEATMAP, scale, radius: 30 }
      expect(parseWarsHeatmapSettings(serializeWarsHeatmapSettings(settings))).toEqual(settings)
    }
  })
})
