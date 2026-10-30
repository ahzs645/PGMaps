import { describe, expect, it } from 'vitest'
import { demoMission } from './demo'
import { httpUrl, parseMission, readMissionJson, validateCollection } from './missionCodec'
import {
  drawingGeometry,
  inTime,
  matchesSearch,
  measurement,
  moveLayer,
  moveVertex,
  renderableCollection,
} from './model'
import { sampleRaster } from './raster'
import type { LocalRaster } from '../dev-forestry/types'

describe('mission transport', () => {
  it('restores layer identity, styles, time, camera and bookmarks from an exported mission', () => {
    const mission = demoMission()
    mission.layers[0].filter = { column: 'name', values: ['Field study boundary'] }
    mission.bookmarks = [{ id: 'site', name: 'Lookout', camera: mission.camera }]
    const restored = readMissionJson(JSON.stringify(mission))
    expect(restored.layers.map((l) => [l.id, l.style, l.filter, l.timeProperty, l.data])).toEqual(
      mission.layers.map((l) => [l.id, l.style, l.filter, l.timeProperty, l.data]),
    )
    expect(restored.camera).toEqual(mission.camera)
    expect(restored.bookmarks).toEqual(mission.bookmarks)
  })
  it.each(['javascript:alert(1)', 'data:text/plain,hello', 'file:///tmp/map'])(
    'rejects non-HTTP data source %s',
    (url) => expect(() => httpUrl(url)).toThrow(),
  )
  it('rejects duplicate layer IDs without accepting an ambiguous selection identity', () => {
    const m = demoMission()
    m.layers[1].id = m.layers[0].id
    expect(() => parseMission(m)).toThrow('unique')
  })
  it('retains valid high-latitude globe cameras', () => {
    const mission = demoMission()
    mission.camera.center = [20, 85]
    expect(parseMission(mission).camera.center).toEqual([20, 85])
  })
  it('rejects a malformed color that the map renderer cannot parse', () => {
    const m = demoMission()
    m.layers[0].style = { type: 'simple', color: '#12345' }
    expect(() => parseMission(m)).toThrow('hexadecimal')
  })
  it('rejects invalid coordinate arrays and nonfinite or out-of-world coordinates', () => {
    for (const coordinates of [[0], ['x', 53], [Infinity, 53], [-181, 53], [0, 91]])
      expect(() =>
        validateCollection({
          type: 'FeatureCollection',
          features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates } }],
        }),
      ).toThrow()
  })
  it('rejects a reversed time window and an unsupported mission version', () => {
    const m = demoMission()
    expect(() => parseMission({ ...m, time: { ...m.time, start: '2026-07-01' } })).toThrow('date range')
    expect(() => parseMission({ ...m, schema: 'other' })).toThrow('not a PG Maps mission')
  })
  it('does not let unrecognized prototype keys pretend to be geometry types', () => {
    expect(() =>
      validateCollection({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: {}, geometry: { type: 'toString', coordinates: [0, 0] } }],
      }),
    ).toThrow()
  })
})
describe('linked queries and edits', () => {
  const feature = demoMission().layers[2].data.features[0]
  it('renders nested geometry collection leaves without losing properties or selection identity', () => {
    const collection = validateCollection({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'collection',
          properties: { name: 'Combined', __devDataId: 'layer:0' },
          geometry: {
            type: 'GeometryCollection',
            geometries: [
              { type: 'Point', coordinates: [0, 0] },
              {
                type: 'GeometryCollection',
                geometries: [
                  {
                    type: 'LineString',
                    coordinates: [
                      [0, 0],
                      [1, 1],
                    ],
                  },
                ],
              },
            ],
          },
        },
      ],
    })
    const rendered = renderableCollection(collection)
    expect(rendered.features.map((f) => f.geometry.type)).toEqual(['Point', 'LineString'])
    expect(rendered.features.map((f) => [f.id, f.properties])).toEqual([
      ['collection', collection.features[0].properties],
      ['collection', collection.features[0].properties],
    ])
    expect(collection.features[0].geometry.type).toBe('GeometryCollection')
  })
  it('includes the complete UTC end day and leaves untimed layers visible', () => {
    const time = { enabled: true, start: '2026-06-01', end: '2026-06-01' }
    expect(inTime({ ...feature, properties: { date: '2026-06-01T23:59:59.999Z' } }, 'date', time)).toBe(true)
    expect(inTime({ ...feature, properties: { date: '2026-06-02T00:00:00Z' } }, 'date', time)).toBe(false)
    expect(inTime(feature, '', time)).toBe(true)
    expect(inTime(feature, 'absent', time)).toBe(false)
  })
  it('combines search terms without treating a valid numeric zero as missing', () => {
    expect(matchesSearch({ ...feature, properties: { name: 'River station', value: 0 } }, 'river 0')).toBe(true)
    expect(matchesSearch(feature, 'river water')).toBe(false)
  })
  it('closes a polygon ring and keeps interior rings when a vertex moves', () => {
    const g = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
        [
          [0.1, 0.1],
          [0.2, 0.1],
          [0.1, 0.2],
          [0.1, 0.1],
        ],
      ],
    }
    const moved = moveVertex(g, 0, [0.01, 0.02])
    expect(moved.type === 'Polygon' && moved.coordinates[0].at(-1)).toEqual([0.01, 0.02])
    expect(moved.type === 'Polygon' && moved.coordinates[1]).toEqual(g.coordinates[1])
    expect(g.coordinates[0][0]).toEqual([0, 0])
    expect(
      drawingGeometry('polygon', [
        [0, 0],
        [1, 0],
        [1, 1],
      ]),
    ).toEqual({
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    })
  })
  it('does not construct incomplete geometries and reports real geographic measurements', () => {
    expect(
      drawingGeometry('polygon', [
        [0, 0],
        [1, 0],
      ]),
    ).toBeNull()
    expect(
      measurement(
        [
          [0, 0],
          [1, 0],
        ],
        false,
      ).length,
    ).toBeCloseTo(111195, 0)
    expect(
      measurement(
        [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
        true,
      ).area,
    ).toBeGreaterThan(6e9)
  })
  it('reorders layers immutably and respects draw stack boundaries', () => {
    const m = demoMission(),
      ids = m.layers.map((l) => l.id)
    expect(moveLayer(m, ids[0], -1)).toBe(m)
    expect(moveLayer(m, ids[0], 1).layers.map((l) => l.id)).toEqual([ids[1], ids[0], ids[2]])
    expect(m.layers.map((l) => l.id)).toEqual(ids)
  })
  it('preserves elevation/extra ordinates and polygon closure while editing XY', () => {
    expect(moveVertex({ type: 'Point', coordinates: [0, 0, 250] }, 0, [1, 2])).toEqual({
      type: 'Point',
      coordinates: [1, 2, 250],
    })
    const g = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [0, 0, 250],
          [1, 0, 260],
          [1, 1, 270],
          [0, 0, 250],
        ],
      ],
    }
    const edited = moveVertex(g, 0, [0.1, 0.2])
    expect(edited.type === 'Polygon' && edited.coordinates[0]).toEqual([
      [0.1, 0.2, 250],
      [1, 0, 260],
      [1, 1, 270],
      [0.1, 0.2, 250],
    ])
  })
  it('reads the original raster cell, preserving zero, no-data and outside coverage', () => {
    const r = {
      epsg: 4326,
      origin: [0, 1],
      pixelSize: [1, -1],
      width: 2,
      height: 2,
      values: [0, null, 10, 20],
    } as LocalRaster
    expect(sampleRaster(r, [0, 1])?.value).toBe(0)
    expect(sampleRaster(r, [1, 1])?.value).toBeNull()
    expect(sampleRaster(r, [5, 5])).toBeNull()
  })
})
