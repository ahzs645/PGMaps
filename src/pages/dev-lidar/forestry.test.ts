import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { INITIAL_ANALYSIS } from './analysisWorkflows'
import {
  compareForestPlots,
  forestFeatures,
  forestShortlist,
  forestValue,
  profilePercentages,
  type ForestData,
} from './forestry'
const data = JSON.parse(readFileSync(new URL('./forestry.generated.json', import.meta.url), 'utf8')) as ForestData

describe('forestry explorer on actual processed returns', () => {
  it('accounts for all accepted source returns and their first-return subset', () => {
    expect(data.counts.source_points).toBe(84608005)
    expect(data.counts.accepted_returns).toBe(82613315)
    expect(data.plots.features).toHaveLength(924)
    expect(data.plots.features.reduce((n, f) => n + f.properties.profiles.all.returns, 0)).toBe(
      data.counts.accepted_returns,
    )
    for (const { properties: p } of data.plots.features) {
      expect(p.profiles.first.returns).toBeLessThanOrEqual(p.profiles.all.returns)
      for (const key of ['all', 'first'] as const) {
        const profile = p.profiles[key]
        expect(profile.bands.reduce((a, b) => a + b, 0)).toBe(profile.returns)
        if (profile.returns) expect(profilePercentages(profile).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 7)
      }
    }
  })
  it('filters coverage and canopy, maps first/all-return entropy separately and sorts actual values', () => {
    const options = { ...INITIAL_ANALYSIS, mode: 'strata' as const }
    const rows = forestFeatures(data, options)
    expect(rows).toHaveLength(640)
    expect(rows[0].properties.map_value!).toBeGreaterThanOrEqual(rows[1].properties.map_value!)
    const first = forestFeatures(data, { ...options, returnMode: 'first' })
    expect(first).toHaveLength(640)
    expect(
      first.some(
        (f) => f.properties.map_value !== rows.find((r) => r.properties.id === f.properties.id)?.properties.map_value,
      ),
    ).toBe(true)
    expect(forestFeatures(data, { ...options, canopyMinimum: 70 }).length).toBeLessThan(640)
    expect(forestFeatures(data, { ...options, support: 100 }).length).toBeLessThan(640)
    expect(forestFeatures(data, { ...options, support: 101 })).toHaveLength(0)
  })
  it('keeps edge, interior and censored cells exhaustive and decreases interior with distance', () => {
    for (const { properties: p } of data.plots.features) {
      let previous = p.canopy_m2
      for (const distance of [10, 20, 30] as const) {
        const edge = p[`edge_${distance}`]
        expect(edge.counts.reduce((a, b) => a + b, 0)).toBe(p.canopy_m2)
        expect(edge.counts[1]).toBeLessThanOrEqual(previous)
        previous = edge.counts[1]
        if (p.canopy_m2) expect(edge.percent.reduce<number>((a, b) => a + (b ?? 0), 0)).toBeCloseTo(100, 2)
        else expect(edge.percent).toEqual([null, null, null])
      }
    }
  })
  it('shortlists distinct high-value plots at least 100 metric metres apart without changing the map set', () => {
    for (const mode of ['strata', 'texture', 'edges'] as const) {
      const options = { ...INITIAL_ANALYSIS, mode },
        rows = forestFeatures(data, options),
        short = forestShortlist(data, options)
      expect(short).toHaveLength(8)
      expect(short[0].properties.id).toBe(rows[0].properties.id)
      for (let i = 0; i < short.length; i++)
        for (let j = i + 1; j < short.length; j++) {
          const a = data.plots.features.find((f) => f.properties.id === short[i].properties.id)!.properties.centre_utm
          const b = data.plots.features.find((f) => f.properties.id === short[j].properties.id)!.properties.centre_utm
          expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThanOrEqual(100)
        }
      expect(forestFeatures(data, options)).toHaveLength(rows.length)
    }
  })
  it('compares the chosen metric and returns unknown when a metric is unsupported', () => {
    const a = data.plots.features[100].properties,
      b = data.plots.features[200].properties
    for (const mode of ['strata', 'texture', 'edges'] as const) {
      const options = { ...INITIAL_ANALYSIS, mode },
        av = forestValue(a, options),
        bv = forestValue(b, options)
      const difference = compareForestPlots(a, b, mode, options)
      if (av !== null && bv !== null) expect(difference).toBeCloseTo(av - bv)
      else expect(difference).toBeNull()
    }
    const unsupported = { ...a, rugosity_m: null }
    expect(compareForestPlots(unsupported, b, 'texture', INITIAL_ANALYSIS)).toBeNull()
    expect(
      profilePercentages({
        returns: 0,
        bands: [0, 0, 0, 0, 0, 0],
        elevated_returns: 0,
        height_entropy: null,
        low_layer_percent: null,
      }),
    ).toEqual([0, 0, 0, 0, 0, 0])
  })
})
