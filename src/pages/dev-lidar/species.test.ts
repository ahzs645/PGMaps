import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { speciesFeatures, type SpeciesData } from './species'
import { INITIAL_ANALYSIS } from './analysisWorkflows'
const data = JSON.parse(readFileSync(new URL('./species.generated.json', import.meta.url), 'utf8')) as SpeciesData

describe('species inventory and held-out model', () => {
  it('keeps missing inventory and model results missing when the map mode changes', () => {
    const inventory = speciesFeatures(data, { ...INITIAL_ANALYSIS, mode: 'species' })
    const model = speciesFeatures(data, { ...INITIAL_ANALYSIS, mode: 'species-model' })
    expect(inventory).toHaveLength(30)
    expect(model.filter((f) => f.properties.map_value !== null)).toHaveLength(21)
    for (const f of model) {
      const p = data.stands.features.find((s) => s.properties.id === f.properties.id)!.properties
      expect(f.properties.map_value).toBe(p.model?.broadleaf_percent ?? null)
      if (p.model) expect(p.model.train_groups).not.toContain(p.feature_id)
    }
  })
  it('reports failed broadleaf baseline comparison without claiming field accuracy', () => {
    expect(data.experiment.status).toBe('exploratory_weak_labels')
    expect(data.experiment.plots).toBe(443)
    expect(data.experiment.model.broadleaf_mae_pp).toBeGreaterThan(data.experiment.baseline.broadleaf_mae_pp)
    expect(Object.values(data.area_weighted_inventory_index).reduce((a, b) => a + b, 0)).toBeCloseTo(100)
  })
})
