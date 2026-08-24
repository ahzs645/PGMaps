import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { normalizeProjectPackage } from '@/lib/projectPackages'

const projectRaw: unknown = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../public/data/projects/inaturalist-species-at-risk-bc.json'), 'utf8'),
)
const data = JSON.parse(
  readFileSync(
    path.resolve(
      __dirname,
      '../../../vendor/bcdatamapper/datascrapers/bc/forest-map-sources/output/species-at-risk/inaturalist_species_at_risk.geojson',
    ),
    'utf8',
  ),
)

describe('inaturalist-species-at-risk-bc story package', () => {
  const project = normalizeProjectPackage(projectRaw)

  it('normalizes with four distinct thematic map views', () => {
    expect(project).not.toBeNull()
    expect(project!.workspace?.type).toBe('story-map')
    expect(project!.layers).toHaveLength(4)
    expect(project!.scenes).toHaveLength(4)
    expect(project!.scenes.map((scene) => scene.visibleLayerIds[0])).toEqual([
      'observations-groups',
      'observations-periods',
      'observations-accuracy',
      'observations-frequency',
    ])
  })

  it('ships the deduplicated historical observation snapshot', () => {
    expect(data.type).toBe('FeatureCollection')
    expect(data.features).toHaveLength(17939)
    expect(data.metadata.counts.uniqueTaxa).toBe(826)
    expect(data.metadata.counts.observationYearRange).toEqual([1980, 2021])
    const ids = data.features.map(
      (feature: { properties: { observation_id: string } }) => feature.properties.observation_id,
    )
    expect(new Set(ids).size).toBe(ids.length)
    expect(project!.catalogMetrics.find((metric) => metric.label === 'Observations')?.value).toBe('17,939')
  })

  it('keeps layer, category, and highlight references aligned with the data', () => {
    const workspace = project!.workspace
    if (workspace?.type !== 'story-map') throw new Error('expected a story-map workspace')
    const workspaceLayerIds = workspace.layers.map((layer) => layer.id)
    expect(new Set(workspaceLayerIds)).toEqual(new Set(project!.layers.map((layer) => layer.id)))

    for (const layer of workspace.layers) {
      expect(layer.category).toBeDefined()
      const configuredValues = new Set(Object.keys(layer.category!.colors))
      const actualValues = new Set(
        data.features.map(
          (feature: { properties: Record<string, unknown> }) => feature.properties[layer.category!.property],
        ),
      )
      for (const value of actualValues) expect(configuredValues).toContain(value)
    }

    for (const scene of project!.scenes) {
      for (const layerId of scene.visibleLayerIds) expect(workspaceLayerIds).toContain(layerId)
      for (const highlight of scene.highlights ?? []) {
        expect(scene.visibleLayerIds).toContain(highlight.layerId)
        const actualValues = new Set(
          data.features.map(
            (feature: { properties: Record<string, unknown> }) => feature.properties[highlight.property],
          ),
        )
        for (const value of highlight.values) expect(actualValues).toContain(value)
      }
    }
  })

  it('retains the expected group, accuracy, and leading-taxon summaries', () => {
    expect(data.metadata.counts.byGroup).toMatchObject({
      Plants: 8203,
      Birds: 7033,
      Amphibians: 1081,
    })
    expect(data.metadata.counts.byAccuracyBand).toEqual({
      'Under 10 m': 8315,
      '10–24 m': 5770,
      '25–49 m': 3854,
    })
    expect(data.metadata.topTaxa[0]).toEqual({
      taxonId: '4956',
      name: 'Great Blue Heron · Ardea herodias',
      observations: 1684,
    })
  })
})
