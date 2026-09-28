import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeProjectPackage } from '@/lib/projectPackages'

const root = path.resolve(__dirname, '../../..')
const project = normalizeProjectPackage(
  JSON.parse(readFileSync(path.join(root, 'public/data/projects/bc-economic-dependencies.json'), 'utf8')),
)!
const data = JSON.parse(
  readFileSync(
    path.join(root, 'vendor/bcdatamapper/datascrapers/bc/laep/output/regional-districts.json'),
    'utf8',
  ),
) as { records: Record<string, string | number | null>[] }

describe('BC economic dependencies project', () => {
  it('keeps the complete scene, layer and data-field contract', () => {
    const workspace = project.workspace
    if (workspace?.type !== 'story-map') throw new Error('Expected a story map')
    expect(project.scenes).toHaveLength(7)
    // Recolour one persistent layer; switching source-sharing layer identities
    // can recreate an empty MapLibre source when the draw-order prop changes.
    expect(workspace.layers).toHaveLength(1)
    expect(data.records).toHaveLength(29)
    const layerIds = new Set(workspace.layers.map((layer) => layer.id))
    for (const scene of project.scenes) {
      for (const id of scene.visibleLayerIds) expect(layerIds.has(id)).toBe(true)
      const category = scene.layerOverrides?.['regional-economy']?.category
      expect(category).toBeDefined()
      for (const row of data.records) expect(Object.keys(category!.colors)).toContain(row[category!.property])
      for (const highlight of scene.highlights ?? []) {
        for (const value of highlight.values) {
          expect(data.records.some((row) => row[highlight.property] === value)).toBe(true)
        }
      }
    }
    for (const layer of workspace.layers) {
      expect(layer.attributes?.data).toBe('/data/bc/laep/regional-districts.json')
      for (const row of data.records) {
        expect(row[layer.labelProperty]).toBeTruthy()
        expect(row[layer.selectionDetailProperty!]).toBeTruthy()
        expect(Object.keys(layer.category!.colors)).toContain(row[layer.category!.property])
      }
    }
  })

  it('uses the same dependency scale in both reference years', () => {
    const workspace = project.workspace
    if (workspace?.type !== 'story-map') throw new Error('Expected a story map')
    expect(project.scenes[5].layerOverrides?.['regional-economy']?.category?.colors).toEqual(
      project.scenes[0].layerOverrides?.['regional-economy']?.category?.colors,
    )
  })

  it('anchors the regional story to the matching geography and period', () => {
    const region = data.records.find((row) => row.id === '5953')!
    expect(region.name).toBe('Fraser-Fort George')
    expect(region.forestry_dependency_2020).toBe(12.4)
    expect(region.forestry_lq_2020).toBe(5.06)
    expect(region.dependency_change_pp).toBe(-2.7)
    expect(project.scenes[1].callout?.value).toBe(`${region.forestry_dependency_2020}%`)
    expect(project.scenes[4].text).toContain('where people live')
    expect(project.sourceNote).toContain('employment and location quotients refer to the census year')
  })
})
