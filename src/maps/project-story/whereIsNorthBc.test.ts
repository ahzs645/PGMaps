import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { normalizeProjectPackage } from '@/lib/projectPackages'

/**
 * Authoring guard for the shipped story package. Layer ids are threaded through
 * four separate places in the JSON, and a typo in any of them fails silently at
 * runtime (a scene simply shows nothing), so assert they line up here.
 */
const raw: unknown = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../public/data/projects/where-is-north-bc.json'), 'utf8'),
)

describe('where-is-north-bc story package', () => {
  const project = normalizeProjectPackage(raw)

  it('normalizes into a story-map workspace without dropping scenes or layers', () => {
    expect(project).not.toBeNull()
    expect(project!.workspace?.type).toBe('story-map')
    // A dropped scene or layer means normalization rejected authored content.
    expect(project!.scenes).toHaveLength((raw as { scenes: unknown[] }).scenes.length)
    expect(project!.workspace).toMatchObject({ type: 'story-map' })
  })

  it('keeps catalog layer ids and workspace layer ids in sync', () => {
    const workspace = project!.workspace
    if (workspace?.type !== 'story-map') throw new Error('expected a story-map workspace')
    expect(new Set(workspace.layers.map((layer) => layer.id))).toEqual(
      new Set(project!.layers.map((layer) => layer.id)),
    )
  })

  it('resolves every scene reference to a real layer, place, and highlight target', () => {
    const workspace = project!.workspace
    if (workspace?.type !== 'story-map') throw new Error('expected a story-map workspace')
    const layerIds = new Set(workspace.layers.map((layer) => layer.id))
    const placeIds = new Set(workspace.places.map((place) => place.id))

    for (const scene of project!.scenes) {
      expect(scene.visibleLayerIds.length).toBeGreaterThan(0)
      for (const layerId of scene.visibleLayerIds) {
        expect(layerIds, `scene "${scene.label}" visible layer`).toContain(layerId)
      }
      for (const placeId of scene.placeIds ?? []) {
        expect(placeIds, `scene "${scene.label}" place`).toContain(placeId)
      }
      for (const highlight of scene.highlights ?? []) {
        expect(layerIds, `scene "${scene.label}" highlight layer`).toContain(highlight.layerId)
        // A highlight only reads if its layer is actually on in that scene.
        expect(scene.visibleLayerIds, `scene "${scene.label}" highlight visibility`).toContain(highlight.layerId)
        expect(highlight.values.length).toBeGreaterThan(0)
      }
      for (const layerId of Object.keys(scene.layerOverrides ?? {})) {
        expect(layerIds, `scene "${scene.label}" override layer`).toContain(layerId)
      }
    }
  })

  it('advertises the scene count it actually ships', () => {
    const cards = project!.catalogMetrics.find((metric) => metric.label === 'Story cards')
    expect(cards?.value).toBe(String(project!.scenes.length))
  })
})
