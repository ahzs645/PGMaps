import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ForestData } from '../forestry'
import {
  convexDomain,
  fitVolumeModel,
  harvestScenario,
  parseVolumeReferences,
  predictVolume,
  volumeEligible,
  withinVolumeDomain,
} from './model'
const data: ForestData = JSON.parse(readFileSync(new URL('../forestry.generated.json', import.meta.url), 'utf8'))
const plots = data.plots.features.filter((f) => volumeEligible(f.properties)).slice(0, 30)
// Synthetic responses are only a numerical-test fixture; no real tile volumes
// or performance claims are derived from these manufactured labels.
const references = plots.map(({ properties: p }) => ({
  plot_id: p.id,
  volume_m3_ha: 8 + 9 * p.surface_p95_m + (60 * p.canopy_percent) / 100,
}))
describe('calibrated experimental volume model', () => {
  it('recovers a known synthetic relationship and computes out-of-fit diagnostics', () => {
    const model = fitVolumeModel(data, references)
    model.coefficients.forEach((v, i) => expect(v).toBeCloseTo([8, 9, 60][i], 6))
    expect(model.diagnostics.loo_rmse_m3_ha).toBeLessThan(1e-6)
    expect(model.diagnostics.predicted).toHaveLength(30)
    expect(predictVolume(model, plots[0].properties).volume_m3_ha).toBeCloseTo(references[0].volume_m3_ha, 6)
  })
  it('withholds extrapolation even when a point is within the separate variable ranges', () => {
    const hull = convexDomain([
      [0, 0],
      [10, 0],
      [0, 1],
    ])
    expect(withinVolumeDomain([2, 0.2], hull)).toBe(true)
    expect(withinVolumeDomain([9, 0.9], hull)).toBe(false)
    const model = fitVolumeModel(data, references)
    expect(predictVolume(model, { ...plots[0].properties, surface_p95_m: 100 }).volume_m3_ha).toBeNull()
  })
  it('never converts missing calibration or partial footprints into zero-volume estimates', () => {
    expect(predictVolume(null, plots[0].properties)).toEqual({ volume_m3_ha: null, status: 'Calibration required' })
    const model = fitVolumeModel(data, references)
    expect(
      predictVolume(model, { ...plots[0].properties, sampled_m2: 2400, support_percent: 96 }).volume_m3_ha,
    ).toBeNull()
  })
  it('rejects blank labels, duplicates, unmatched footprints and deficient surveys', () => {
    const csv = 'plot_id,volume_m3_ha\n' + references.map((r) => `${r.plot_id},${r.volume_m3_ha}`).join('\n')
    expect(parseVolumeReferences(csv, data)).toHaveLength(30)
    expect(() => parseVolumeReferences(csv.replace(String(references[0].volume_m3_ha), ''), data)).toThrow(
      'nonnegative',
    )
    expect(() => parseVolumeReferences(csv + '\n' + `${references[0].plot_id},100`, data)).toThrow('Duplicate')
    expect(() => parseVolumeReferences(csv.replace(references[0].plot_id, 'elsewhere'), data)).toThrow(
      'unknown source plot',
    )
    expect(() => fitVolumeModel(data, references.slice(0, 9))).toThrow('10–200')
    const same = {
      ...data,
      plots: {
        ...data.plots,
        features: data.plots.features.map((f) => ({ ...f, properties: { ...f.properties, surface_p95_m: 20 } })),
      },
    }
    expect(() => fitVolumeModel(same, references)).toThrow('variation')
  })
  it('converts m³/ha through actual plot hectares before applying harvest assumptions', () => {
    expect(harvestScenario([100, 200, null], 0.8, 0.25, 0.9)).toEqual({
      supported_plots: 2,
      unsupported_plots: 1,
      area_ha: 0.5,
      gross_stem_m3: 75,
      scenario_delivered_m3: 40.5,
    })
    expect(() => harvestScenario([100], 1.2, 0, 1)).toThrow('between 0 and 1')
  })
})
