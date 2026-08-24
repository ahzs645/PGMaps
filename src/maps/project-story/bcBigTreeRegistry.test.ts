import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { normalizeProjectPackage } from '@/lib/projectPackages'

const projectRaw: unknown = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../public/data/projects/bc-big-tree-registry.json'), 'utf8'),
)
const data = JSON.parse(
  readFileSync(
    path.resolve(
      __dirname,
      '../../../vendor/bcdatamapper/datascrapers/bc/forest-map-sources/output/bc_bigtree_registry.geojson',
    ),
    'utf8',
  ),
)

describe('bc-big-tree-registry story package', () => {
  const project = normalizeProjectPackage(projectRaw)

  it('normalizes without dropping its story workspace, layers, or scenes', () => {
    expect(project).not.toBeNull()
    expect(project!.workspace?.type).toBe('story-map')
    expect(project!.layers).toHaveLength(5)
    expect(project!.scenes).toHaveLength(5)
  })

  it('ships unique point features matching the advertised registry count', () => {
    expect(data.type).toBe('FeatureCollection')
    expect(data.features).toHaveLength(1061)
    expect(data.features.every((feature: { geometry: { type: string } }) => feature.geometry.type === 'Point')).toBe(
      true,
    )
    const ids = data.features.map(
      (feature: { properties: { tree_registry_id: string } }) => feature.properties.tree_registry_id,
    )
    expect(new Set(ids).size).toBe(ids.length)
    expect(project!.catalogMetrics.find((metric) => metric.label === 'Mapped records')?.value).toBe('1,061')
  })

  it('keeps layer and highlight references aligned with real data properties', () => {
    const workspace = project!.workspace
    if (workspace?.type !== 'story-map') throw new Error('expected a story-map workspace')
    expect(new Set(workspace.layers.map((layer) => layer.id))).toEqual(
      new Set(project!.layers.map((layer) => layer.id)),
    )

    for (const layer of workspace.layers) {
      expect(layer.category).toBeDefined()
      const actualValues = new Set(
        data.features.map(
          (feature: { properties: Record<string, unknown> }) => feature.properties[layer.category!.property],
        ),
      )
      for (const category of Object.keys(layer.category!.colors)) expect(actualValues).toContain(category)
    }

    for (const scene of project!.scenes) {
      for (const layerId of scene.visibleLayerIds) {
        expect(workspace.layers.map((layer) => layer.id)).toContain(layerId)
      }
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

  it('retains the expected snapshot summary and tallest-tree record', () => {
    expect(data.metadata.counts).toEqual({
      features: 1061,
      conifers: 900,
      broadleaves: 161,
      speciesChampions: 42,
      withPhotos: 668,
      withNamedLocation: 982,
      nearestTownOnly: 79,
      withHeight: 928,
      withDbh: 1059,
      withScore: 696,
    })
    const carmanah = data.features.find(
      (feature: { properties: { tree_registry_id: string } }) => feature.properties.tree_registry_id === '87',
    )
    expect(carmanah.properties).toMatchObject({
      title: 'Carmanah Giant',
      common_name: 'Sitka spruce',
      height_m: 96,
    })
  })
})
