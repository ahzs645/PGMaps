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

describe('species views for forestry tasks', () => {
  const context = JSON.parse(
    readFileSync(new URL('./species-context.generated.json', import.meta.url), 'utf8'),
  ) as import('./species').SpeciesContext
  const forest = JSON.parse(
    readFileSync(new URL('./forestry.generated.json', import.meta.url), 'utf8'),
  ) as import('./forestry').ForestData
  it('uses a distinct, stable colour for all seven inventory species', async () => {
    const { SPECIES_COLOURS } = await import('./species')
    expect(new Set(Object.values(SPECIES_COLOURS)).size).toBe(7)
    expect(Object.keys(SPECIES_COLOURS).sort()).toEqual(data.species_order)
  })
  it('maps each species share without turning missing inventory into zero', () => {
    for (const code of data.species_order) {
      const rows = speciesFeatures(data, { ...INITIAL_ANALYSIS, mode: 'species-share', speciesCode: code })
      for (const f of rows) {
        const p = data.stands.features.find((s) => s.properties.id === f.properties.id)!.properties
        expect(f.properties.map_value).toBe(p.labelled ? p.composition[code] : null)
      }
      const filtered = speciesFeatures(data, {
        ...INITIAL_ANALYSIS,
        mode: 'species-share',
        speciesCode: code,
        speciesShareMinimum: 10,
      })
      expect(filtered.every((f) => f.properties.map_value !== null && f.properties.map_value! >= 10)).toBe(true)
    }
  })
  it('defines effective mixture with correct pure and evenly mixed limits', async () => {
    const { effectiveSpecies } = await import('./species')
    expect(effectiveSpecies({ EP: 100 })).toBe(1)
    expect(effectiveSpecies({ EP: 50, AT: 50 })).toBe(2)
    expect(effectiveSpecies({ EP: 0 })).toBeNull()
  })
  it('retains signed disagreement while filtering on its magnitude', () => {
    const rows = speciesFeatures(data, {
      ...INITIAL_ANALYSIS,
      mode: 'species-disagreement',
      speciesDifferenceMinimum: 20,
    })
    expect(rows.length).toBeGreaterThan(0)
    for (const f of rows) {
      const p = data.stands.features.find((s) => s.properties.id === f.properties.id)!.properties
      expect(f.properties.difference_pp).toBeCloseTo(p.model!.broadleaf_percent - p.broadleaf_percent!)
      expect(f.properties.map_value).toBeCloseTo(Math.abs(f.properties.difference_pp!))
      expect(f.properties.map_value!).toBeGreaterThanOrEqual(20)
    }
  })
  it('screens tall/closed and low/open plots with independent support and inventory matching', () => {
    const tall = speciesFeatures(data, { ...INITIAL_ANALYSIS, mode: 'species-structure' }, forest, context)
    const low = speciesFeatures(data, { ...INITIAL_ANALYSIS, mode: 'species-regeneration' }, forest, context)
    expect(tall.length).toBeGreaterThan(0)
    expect(low.length).toBeGreaterThan(0)
    for (const [rows, tallMode] of [
      [tall, true],
      [low, false],
    ] as const)
      for (const f of rows) {
        const p = forest.plots.features.find((p) => p.properties.id === f.properties.id)!.properties
        expect(p.support_percent).toBeGreaterThanOrEqual(95)
        if (tallMode) {
          expect(p.surface_p95_m).toBeGreaterThanOrEqual(20)
          expect(p.canopy_percent).toBeGreaterThanOrEqual(70)
        } else {
          expect(p.surface_p95_m).toBeLessThanOrEqual(10)
          expect(p.canopy_percent).toBeLessThanOrEqual(40)
        }
        expect(f.properties.stand_id).toBe(context.plots[p.id].stand_id)
        if (!context.plots[p.id].stand_id) expect(f.properties.leading).toBeNull()
      }
    const texture = speciesFeatures(
      data,
      { ...INITIAL_ANALYSIS, mode: 'species-structure', speciesStructureMetric: 'texture' },
      forest,
      context,
    )
    for (const f of texture)
      expect(f.properties.map_value).toBe(
        forest.plots.features.find((p) => p.properties.id === f.properties.id)!.properties.rugosity_m,
      )
  })
  it('shortlists distinct stands representing leading species and missing holdout coverage', async () => {
    const { fieldShortlist } = await import('./species')
    const rows = fieldShortlist(data, INITIAL_ANALYSIS)
    expect(rows).toHaveLength(8)
    expect(new Set(rows.map((f) => f.properties.id)).size).toBe(8)
    expect(new Set(rows.map((f) => f.properties.leading))).toEqual(
      new Set(data.stands.features.filter((f) => f.properties.labelled).map((f) => f.properties.leading)),
    )
    if (data.stands.features.some((f) => f.properties.labelled && !f.properties.model))
      expect(rows.some((f) => !f.properties.model)).toBe(true)
    const filtered = fieldShortlist(data, { ...INITIAL_ANALYSIS, speciesFilter: 'FDI' })
    expect(filtered.every((f) => f.properties.leading === 'FDI')).toBe(true)
  })
  it('exports the same eight review stands with source-supported coordinates and reasons', async () => {
    const { fieldShortlistCSV, fieldShortlist } = await import('./species')
    const csv = fieldShortlistCSV(data, context, INITIAL_ANALYSIS).split('\n')
    const rows = fieldShortlist(data, INITIAL_ANALYSIS)
    expect(csv).toHaveLength(9)
    for (const [i, f] of rows.entries()) {
      const fields = csv[i + 1].split(',')
      expect(fields[0]).toBe(f.properties.id)
      expect(Number(fields[2])).toBeCloseTo(context.field_points[f.properties.id][0], 6)
      expect(Number(fields[3])).toBeCloseTo(context.field_points[f.properties.id][1], 6)
      expect(fields[6]).toBe(
        f.properties.model ? 'Species representation / model disagreement' : 'Missing held-out coverage',
      )
    }
  })
})
