import { describe, expect, it, vi } from 'vitest'
import type { StyleSpecification } from 'maplibre-gl'
import {
  applyBasemap,
  imageryCitationUrl,
  installVectorContext,
  LABEL_ANCHOR,
  parseImageryCitations,
  prepareVectorContext,
  SATELLITE_LAYER,
} from './basemaps'

const provider: StyleSpecification = {
  version: 8,
  sources: {
    roads: { type: 'vector', tiles: ['https://example.org/{z}/{x}/{y}.pbf'] },
    relief: { type: 'raster', tiles: ['https://example.org/{z}/{x}/{y}.png'] },
  },
  glyphs: 'https://example.org/fonts/{fontstack}/{range}.pbf',
  sprite: 'https://example.org/sprite',
  layers: [
    { id: 'background', type: 'background' },
    { id: 'relief', type: 'raster', source: 'relief' },
    { id: 'roads', type: 'line', source: 'roads', 'source-layer': 'transportation' },
    {
      id: 'labels',
      type: 'symbol',
      source: 'roads',
      'source-layer': 'transportation_name',
      layout: { 'text-field': ['get', 'name'] },
      paint: { 'text-color': '#333333', 'text-halo-color': '#ffffff', 'text-halo-width': 1 },
    },
    { id: 'hidden-labels', type: 'symbol', source: 'roads', 'source-layer': 'place', layout: { visibility: 'none' } },
  ],
}

describe('LiDAR vector and satellite integration', () => {
  it('uses vector geometry sources, strips provider raster relief and keeps provider input intact', () => {
    const before = JSON.stringify(provider)
    const context = prepareVectorContext(provider)
    expect(Object.values(context.sources).map((source) => source.type)).toEqual(['vector'])
    expect(context.layers.find((layer) => layer.type === 'raster')).toBeUndefined()
    expect(context.layers.find((layer) => layer.id === 'context-roads')).toMatchObject({ source: 'context-roads' })
    expect(JSON.stringify(provider)).toBe(before)
    expect(() => prepareVectorContext({ version: 8, sources: {}, layers: [] })).toThrow('no vector tile source')
  })

  it('places vector geometry below the measured surface and labels above it without replacing analysis or LiDAR', () => {
    const order = [
      'base',
      SATELLITE_LAYER,
      'analysis-height',
      'analysis-slope',
      LABEL_ANCHOR,
      'trees',
      'roofs',
      'lidar-custom-layer',
    ]
    const originalAnalysis = order.filter((id) => id.startsWith('analysis-') || id === 'lidar-custom-layer')
    const map = {
      setGlyphs: vi.fn(),
      setSprite: vi.fn(),
      addSource: vi.fn(),
      addLayer: vi.fn((layer: { id: string }, before?: string) => {
        order.splice(before ? order.indexOf(before) : order.length, 0, layer.id)
      }),
    }
    installVectorContext(map as unknown as Parameters<typeof installVectorContext>[0], prepareVectorContext(provider))
    expect(order.indexOf('context-roads')).toBeLessThan(order.indexOf('analysis-height'))
    expect(order.indexOf('context-labels')).toBeGreaterThan(order.indexOf('analysis-slope'))
    expect(order.indexOf('context-labels')).toBeLessThan(order.indexOf('trees'))
    expect(order.filter((id) => id.startsWith('analysis-') || id === 'lidar-custom-layer')).toEqual(originalAnalysis)
  })

  it('switches basemaps repeatedly while preserving overlays, hidden labels and the original label colours', () => {
    const context = prepareVectorContext(provider)
    const visibility: Record<string, unknown> = {
      'analysis-height': 'visible',
      trees: 'visible',
      'lidar-custom-layer': 'visible',
    }
    const paint: Record<string, unknown> = {}
    const map = {
      setLayoutProperty: (id: string, _key: string, value: unknown) => {
        visibility[id] = value
      },
      setPaintProperty: (id: string, key: string, value: unknown) => {
        paint[`${id}:${key}`] = value
      },
    }
    for (let i = 0; i < 3; i++) {
      applyBasemap(map as unknown as Parameters<typeof applyBasemap>[0], context.layers, 'satellite')
      expect(visibility[SATELLITE_LAYER]).toBe('visible')
      expect(visibility['context-roads']).toBe('none')
      expect(visibility['context-labels']).toBe('visible')
      expect(visibility['context-hidden-labels']).toBe('none')
      expect(paint['context-labels:text-color']).toBe('#f8fafc')
      applyBasemap(map as unknown as Parameters<typeof applyBasemap>[0], context.layers, 'vector')
      expect(visibility[SATELLITE_LAYER]).toBe('none')
      expect(visibility['context-roads']).toBe('visible')
      expect(paint['context-labels:text-color']).toBe('#333333')
      expect([visibility['analysis-height'], visibility.trees, visibility['lidar-custom-layer']]).toEqual([
        'visible',
        'visible',
        'visible',
      ])
    }
  })
})

describe('imagery provenance', () => {
  it('queries longitude/latitude explicitly in WGS84 and requests source metadata without geometry', () => {
    const params = new URL(imageryCitationUrl(-122.8, 53.89)).searchParams
    expect(params.get('geometry')).toBe('-122.8,53.89')
    expect(params.get('inSR')).toBe('4326')
    expect(params.get('returnGeometry')).toBe('false')
  })
  it('preserves unknown dates/resolution and rejects impossible calendar dates instead of inventing provenance', () => {
    const rows = parseImageryCitations({
      features: [
        {
          attributes: {
            SRC_DATE: 20230515,
            SRC_RES: 0.075,
            NICE_DESC: 'City of Prince George',
            MinMapLevel: 12,
            MaxMapLevel: 18,
          },
        },
        { attributes: { SRC_DATE: null, SRC_RES: 15, NICE_NAME: 'TerraColor' } },
        { attributes: { SRC_DATE: 20230231, SRC_RES: -1 } },
      ],
    })
    expect(rows[0]).toMatchObject({ date: '2023-05-15', resolution: 0.075, minLevel: 12, maxLevel: 18 })
    expect(rows[1].date).toBeNull()
    expect(rows[2]).toMatchObject({ date: null, resolution: null })
    expect(() => parseImageryCitations({ error: { code: 499 } })).toThrow('metadata unavailable')
  })
})
