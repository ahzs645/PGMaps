import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PLAN_SHOW,
  maskLegendKey,
  sampleLegendKey,
  togglePlanLegendKey,
  unitLegendKey,
  withoutHiddenFeatures,
} from './planLayers'
import { createId, parseScene, serializeScene } from './scene'
import { sceneFingerprint } from './sceneInput'
import { parseTreeFreeAreas } from './treeFreeAreas'

const point = (properties: Record<string, unknown>): GeoJSON.Feature => ({
  type: 'Feature',
  properties,
  geometry: { type: 'Point', coordinates: [0, 0] },
})

describe('plan legend switches', () => {
  it('toggles one row on and off without touching the rest', () => {
    const once = togglePlanLegendKey(DEFAULT_PLAN_SHOW, 'samples:hidden')
    expect([...once.hidden]).toEqual(['samples:hidden'])
    expect(DEFAULT_PLAN_SHOW.hidden.size).toBe(0)
    expect(togglePlanLegendKey(once, 'samples:hidden').hidden.size).toBe(0)
  })

  it('drops only the features of hidden rows, and returns the same collection when nothing is hidden', () => {
    const samples: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [point({ visible: 1 }), point({ visible: 0 }), point({ visible: 2 }), point({ visible: 1 })],
    }
    expect(withoutHiddenFeatures(samples, new Set(), sampleLegendKey)).toBe(samples)
    expect(withoutHiddenFeatures(samples, new Set(['road']), sampleLegendKey)).toBe(samples)
    const seenOnly = withoutHiddenFeatures(samples, new Set(['samples:hidden', 'samples:unknown']), sampleLegendKey)
    expect(seenOnly.features.map((feature) => feature.properties?.visible)).toEqual([1, 1])
  })

  it('names every feature by the legend row that draws it', () => {
    expect(maskLegendKey({ kind: 'private' })).toBe('mask:private')
    expect(maskLegendKey({ kind: 'something else' })).toBe('mask:retained')
    expect(unitLegendKey({ objectiveId: 'modification' })).toBe('unit:modification')
    expect(unitLegendKey({ objectiveId: '' })).toBe('unit:none')
  })
})

describe('tree-free areas', () => {
  const square: GeoJSON.Polygon = {
    type: 'Polygon',
    coordinates: [
      [
        [-122.5, 53.9],
        [-122.49, 53.9],
        [-122.49, 53.91],
        [-122.5, 53.91],
        [-122.5, 53.9],
      ],
    ],
  }

  it('keeps valid polygons and drops the rest rather than failing the scene', () => {
    const areas = parseTreeFreeAreas([
      { id: 'a', name: 'Pullout', geometry: square },
      { id: 'a', name: 'Duplicate', geometry: square },
      { id: 'b', geometry: { type: 'Point', coordinates: [0, 0] } },
      null,
      { id: 'c', geometry: square },
    ])
    expect(areas.map((area) => [area.id, area.name])).toEqual([
      ['a', 'Pullout'],
      ['c', 'Tree-free area'],
    ])
    expect(parseTreeFreeAreas('nonsense')).toEqual([])
  })

  it('round-trips with the scene and never stales the run', () => {
    const scene = parseScene({})!
    const withArea = { ...scene, treeFreeAreas: [{ id: createId('tree-free'), name: 'Pullout', geometry: square }] }
    expect(parseScene(JSON.parse(serializeScene(withArea)))!.treeFreeAreas).toEqual(withArea.treeFreeAreas)
    expect(sceneFingerprint(withArea)).toBe(sceneFingerprint(scene))
  })
})
