import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { normalizeProjectPackage } from '@/lib/projectPackages'

const raw: unknown = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../public/data/projects/canada-administrative-divisions.json'), 'utf8'),
)

describe('canada-administrative-divisions story package', () => {
  const project = normalizeProjectPackage(raw)

  it('normalizes all authored scenes and PMTiles layers', () => {
    expect(project).not.toBeNull()
    expect(project!.workspace?.type).toBe('story-map')
    expect(project!.scenes).toHaveLength(11)
    if (project!.workspace?.type !== 'story-map') throw new Error('expected story workspace')
    expect(project!.workspace.layers).toHaveLength(7)
    expect(project!.workspace.layers.every((layer) => layer.format === 'pmtiles' && layer.sourceLayer)).toBe(true)
  })

  it('resolves every scene layer and highlight reference', () => {
    if (project!.workspace?.type !== 'story-map') throw new Error('expected story workspace')
    const workspaceIds = new Set(project!.workspace.layers.map((layer) => layer.id))
    expect(workspaceIds).toEqual(new Set(project!.layers.map((layer) => layer.id)))

    for (const scene of project!.scenes) {
      expect(scene.visibleLayerIds.length).toBeGreaterThan(0)
      for (const layerId of scene.visibleLayerIds) expect(workspaceIds).toContain(layerId)
      for (const highlight of scene.highlights ?? []) {
        expect(workspaceIds).toContain(highlight.layerId)
        expect(scene.visibleLayerIds).toContain(highlight.layerId)
      }
      for (const layerId of Object.keys(scene.layerOverrides ?? {})) expect(workspaceIds).toContain(layerId)
    }
  })

  it('advertises counts that agree with the acquired foundation', () => {
    expect(project!.catalogMetrics).toEqual(expect.arrayContaining([
      { label: 'Current regional parents', value: '290' },
      { label: 'Municipal/statistical areas', value: '5,054' },
      { label: 'Indigenous legal-land polygons', value: '3,372' },
    ]))
  })
})
