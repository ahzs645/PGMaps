import { describe, expect, it } from 'vitest'
import type { FeatureCollection, Geometry, MultiPolygon } from 'geojson'
import { demoMission } from './demo'
import { makeLayer } from './model'
import { parseMission, readMissionJson } from './missionCodec'
import { featureIndex, identifyFeatures, prepareMissionLayer, sourceFeatureKey } from './featureIdentity'
import { editVertex, geometryHandles, insertVertex, removeVertex, snapCoordinate } from './geometryEditing'
import { captureSite, restoreSite } from './sites'

const ring = [
  [0, 0, 100],
  [1, 0, 200],
  [1, 1, 300],
  [0, 0, 100],
]
const multi: MultiPolygon = {
  type: 'MultiPolygon',
  coordinates: [[structuredClone(ring), structuredClone(ring)], [structuredClone(ring)]],
}

describe('editing every geometry part', () => {
  it('edits interior rings and multipart collection leaves without losing Z or changing other parts', () => {
    const geometry: Geometry = {
      type: 'GeometryCollection',
      geometries: [{ type: 'GeometryCollection', geometries: [multi] }],
    }
    const handles = geometryHandles(geometry)
    expect(handles.vertices).toHaveLength(9)
    expect(handles.edges).toHaveLength(9)
    const hole = handles.vertices[3]
    const changed = editVertex(geometry, hole.address, [0.2, 0.3])
    if (changed.type !== 'GeometryCollection') throw Error('collection')
    const inner = changed.geometries[0]
    if (inner.type !== 'GeometryCollection' || inner.geometries[0].type !== 'MultiPolygon')
      throw Error('nested collection')
    expect(inner.geometries[0].coordinates[0][1][0]).toEqual([0.2, 0.3, 100])
    expect(inner.geometries[0].coordinates[0][1].at(-1)).toEqual([0.2, 0.3, 100])
    expect(inner.geometries[0].coordinates[1]).toEqual(multi.coordinates[1])
    expect(geometry.geometries[0]).toEqual({ type: 'GeometryCollection', geometries: [multi] })
  })
  it('inserts on closing edges, interpolates Z and restores ring closure when deleting the first vertex', () => {
    const g: Geometry = { type: 'Polygon', coordinates: [ring] }
    const inserted = insertVertex(g, geometryHandles(g).edges[2].after)
    if (inserted.type !== 'Polygon') throw Error('polygon')
    expect(inserted.coordinates[0]).toEqual([ring[0], ring[1], ring[2], [0.5, 0.5, 200], ring[0]])
    const removed = removeVertex(inserted, geometryHandles(inserted).vertices[0].address)
    if (removed.type !== 'Polygon') throw Error('polygon')
    expect(removed.coordinates[0].at(-1)).toEqual(ring[1])
    expect(removed.coordinates[0]).toHaveLength(4)
    expect(() => removeVertex(removed, geometryHandles(removed).vertices[0].address)).toThrow('at least')
  })
  it('inserts across the date line along the short arc', () => {
    const g: Geometry = {
      type: 'LineString',
      coordinates: [
        [179, 0, 10],
        [-179, 2, 30],
      ],
    }
    const result = insertVertex(g, geometryHandles(g).edges[0].after)
    expect(result.type === 'LineString' && result.coordinates[1]).toEqual([-180, 1, 20])
  })
  it('preserves minimum sizes for lines, multipoints and all rings', () => {
    for (const g of [
      {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
      { type: 'MultiPoint', coordinates: [[0, 0]] },
      multi,
    ] as Geometry[]) {
      expect(geometryHandles(g).vertices.every((v) => !v.removable)).toBe(true)
      expect(() => removeVertex(g, geometryHandles(g).vertices[0].address)).toThrow()
    }
    const g: Geometry = {
      type: 'MultiLineString',
      coordinates: [
        [
          [0, 0],
          [1, 1],
          [2, 2],
        ],
        [
          [3, 3],
          [4, 4],
        ],
      ],
    }
    expect(removeVertex(g, geometryHandles(g).vertices[1].address)).toEqual({
      type: 'MultiLineString',
      coordinates: [
        [
          [0, 0],
          [2, 2],
        ],
        [
          [3, 3],
          [4, 4],
        ],
      ],
    })
  })
  it('snaps to visible input vertices only inside the screen tolerance', () => {
    const project = ([lng, lat]: [number, number]) => ({ x: lng * 100, y: lat * 100 })
    expect(snapCoordinate([0.05, 0], [multi], project)).toEqual([0, 0])
    expect(snapCoordinate([0.2, 0], [multi], project)).toEqual([0.2, 0])
    expect(snapCoordinate([0.05, 0], [], project)).toEqual([0.05, 0])
  })
})

describe('persistent feature identity', () => {
  const points: FeatureCollection = {
    type: 'FeatureCollection',
    features: [undefined, 'feature-0', 'duplicate', 'duplicate', 'feature-3', 42, '42'].map((id, i) => ({
      type: 'Feature',
      ...(id === undefined ? {} : { id }),
      properties: { name: `Point ${i}` },
      geometry: { type: 'Point', coordinates: [i, 0] },
    })),
  }
  it('deduplicates without consuming an existing ID and survives export/import unchanged', () => {
    const data = identifyFeatures(points)
    expect(new Set(data.features.map((f) => String(f.id))).size).toBe(points.features.length)
    expect(data.features[1].id).toBe('feature-0')
    expect(data.features[4].id).toBe('feature-3')
    expect(identifyFeatures(data)).toEqual(data)
    expect(points.features[0].id).toBeUndefined()
  })
  it('does not retarget a selection or hidden ID after deleting an earlier source feature', () => {
    const layer = makeLayer('Points', points),
      key = sourceFeatureKey(layer, 2),
      id = String(layer.data.features[2].id)
    layer.hiddenFeatures = [id]
    layer.data = { ...layer.data, features: layer.data.features.slice(1) }
    expect(featureIndex(layer, key)).toBe(1)
    expect(prepareMissionLayer(layer).collection.features[1].properties.__devDataId).toBe(key)
    const mission = { ...demoMission(), layers: [layer] }
    const restored = readMissionJson(JSON.stringify(mission)).layers[0]
    expect(restored.hiddenFeatures).toEqual([id])
    expect(sourceFeatureKey(restored, 1)).toBe(key)
  })
})

describe('sites with mission settings', () => {
  it('round trips layer, tile, time, camera and view settings without copying or replacing data', () => {
    const original = demoMission()
    original.layers[0].opacity = 0.4
    original.layers[0].filter = { column: 'name', values: ['Boundary'] }
    original.time.enabled = true
    original.view = 'split'
    original.terrain = true
    const site = captureSite(original, ' Field site ', original.camera)
    const changed = {
      ...original,
      layers: original.layers.map((l) => ({ ...l, visible: false, opacity: 0.9 })),
      time: { ...original.time, enabled: false },
      view: 'map' as const,
      terrain: false,
      bookmarks: [site],
    }
    const saved = readMissionJson(JSON.stringify(changed))
    const restored = restoreSite(changed, saved.bookmarks[0])
    expect(restored.layers[0]).toEqual(original.layers[0])
    expect(restored.layers[0].data).toBe(original.layers[0].data)
    expect(restored.time).toEqual(original.time)
    expect([restored.view, restored.terrain]).toEqual(['split', true])
    expect(site.name).toBe('Field site')
  })
  it('supports legacy camera-only sites and leaves layers added after saving alone', () => {
    const m = demoMission(),
      site = captureSite(m, 'Camera only', m.camera, false)
    m.bookmarks = [site]
    expect(parseMission(m).bookmarks[0]).toEqual(site)
    const added = makeLayer('New', { type: 'FeatureCollection', features: [] })
    const changed = { ...m, layers: [...m.layers, added], terrain: true }
    expect(restoreSite(changed, site).terrain).toBe(true)
    expect(restoreSite(changed, captureSite(m, 'Full', m.camera)).layers.at(-1)).toBe(added)
  })
})
