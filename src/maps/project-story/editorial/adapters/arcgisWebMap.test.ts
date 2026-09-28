import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import {
  authoredCamera,
  exportTileUrl,
  featureQueryUrl,
  geographicPoint,
  normalizeWebMap,
  rendererColor,
  scaleToZoom,
  type ArcgisRecord,
} from './arcgisWebMap'
const symbol = (color: number[]) => ({
  type: 'esriSFS',
  style: 'esriSFSSolid',
  color,
  outline: { style: 'esriSLSNull', width: 0 },
})
describe('native WebMap adaptation', () => {
  it('converts Web Mercator and source scale without a one-level tile-size shift', () => {
    expect(
      geographicPoint({ x: 1611536.9642140616, y: 6456286.711402813, spatialReference: { wkid: 102100 } })?.[0],
    ).toBeCloseTo(14.47666, 4)
    expect(scaleToZoom(288895.2771445)).toBeCloseTo(10)
    expect(scaleToZoom(72223.819286) - scaleToZoom(288895.2771445)).toBeCloseTo(2)
    expect(
      authoredCamera({ viewpoint: { rotation: 20, scale: 288895.2771445, targetGeometry: { x: 14, y: 50 } } }),
    ).toMatchObject({ center: [14, 50], zoom: expect.closeTo(10), bearing: -20 })
    expect(() => geographicPoint({ x: 1, y: 2, spatialReference: { wkid: 5514 } })).toThrow('Unsupported')
  })
  it('preserves original category colors and inclusive class breaks, rejecting unsupported renderers', () => {
    expect(
      rendererColor({
        type: 'uniqueValue',
        field1: 'cluster',
        uniqueValueInfos: [{ value: 12, symbol: symbol([35, 169, 96, 255]) }],
      }),
    ).toEqual(['match', ['to-string', ['get', 'cluster']], '12', 'rgba(35,169,96,1)', 'rgba(0,0,0,0)'])
    const breaks = rendererColor({
      type: 'classBreaks',
      field: 'score',
      minValue: 0.1,
      classBreakInfos: [{ classMaxValue: 0.5, symbol: symbol([68, 1, 84, 128]) }],
    })
    expect(JSON.stringify(breaks)).toContain('["<=",["to-number",["get","score"],-1e+30],0.5]')
    expect(() => rendererColor({ type: 'heatmap' })).toThrow('Unsupported')
    expect(() => rendererColor({ type: 'uniqueValue', field2: 'second' })).toThrow('multi-field')
  })
  it('keeps original sublayers in export requests and queries feature pages by extent', () => {
    const url = exportTileUrl({
      url: 'https://example.test/MapServer',
      visibleLayers: [6, 8],
      layers: [{ id: 6, layerDefinition: { definitionExpression: 'YEAR=1850' } }],
    })
    expect(url).toContain('bbox={bbox-epsg-3857}')
    const query = new URL(url).searchParams
    expect(query.get('layers')).toBe('show:6,8')
    expect(JSON.parse(query.get('layerDefs')!)).toEqual({ '6': 'YEAR=1850' })
    const feature = new URL(
      featureQueryUrl(
        {
          id: 'x',
          url: 'https://example.test/FeatureServer/1',
          where: 'cluster=12',
          fields: ['OBJECTID', 'cluster'],
          title: 'Buildings',
        },
        [14, 50, 15, 51],
        2000,
        0.0001,
      ),
    ).searchParams
    expect(feature.get('resultOffset')).toBe('2000')
    expect(feature.get('outFields')).toBe('OBJECTID,cluster')
    expect(feature.get('geometry')).toBe('14,50,15,51')
    expect(feature.get('where')).toBe('cluster=12')
  })
  it('namespaces original basemap sprites, preserves hidden layers, and reads source LODs', async () => {
    const result = await normalizeWebMap(
      {
        baseMap: {
          baseMapLayers: [{ id: 'base', layerType: 'VectorTileLayer', styleUrl: 'https://example.test/root.json' }],
        },
      },
      async (url) =>
        url.endsWith('root.json')
          ? {
              glyphs: 'fonts/{fontstack}/{range}.pbf',
              sprite: 'sprites/sprite',
              sources: { original: { url: 'https://example.test/VectorTileServer' } },
              layers: [
                {
                  id: 'beach',
                  type: 'fill',
                  source: 'original',
                  layout: { visibility: 'none' },
                  paint: { 'fill-pattern': 'sand' },
                },
              ],
            }
          : { tileInfo: { lods: [{ level: 0 }, { level: 16 }] } },
    )
    expect(result.style.glyphs).toBe('https://example.test/fonts/{fontstack}/{range}.pbf')
    expect(result.style.sources['editorial-source-base-original']).toMatchObject({
      maxzoom: 16,
      tiles: ['https://example.test/VectorTileServer/tile/{z}/{y}/{x}.pbf'],
    })
    expect(result.style.layers[1]).toMatchObject({
      layout: { visibility: 'none' },
      paint: { 'fill-pattern': 'editorial-source-base:sand' },
    })
  })
  it('adapts every captured map with supported native source types and original renderers', async () => {
    for (const filename of readdirSync('public/data/story-documents/prague/maps')) {
      const document = JSON.parse(
        readFileSync(`public/data/story-documents/prague/maps/${filename}`, 'utf8'),
      ) as ArcgisRecord
      const native = await normalizeWebMap(document, async (url) =>
        url.includes('root.json')
          ? { sources: {}, layers: [] }
          : {
              geometryType: 'esriGeometryPolygon',
              objectIdField: 'OBJECTID',
              drawingInfo: { renderer: { type: 'simple', symbol: symbol([10, 20, 30, 255]) } },
              tileInfo: { spatialReference: { wkid: 3857 }, cols: 256, lods: [{ level: 0 }, { level: 19 }] },
            },
      )
      expect(native.warnings, filename).toEqual([])
      expect(native.style.layers.length).toBeGreaterThan(1)
    }
  })
  it('uses shared local cartography without contacting the source basemap and retains operational layers below labels', async () => {
    const base = JSON.parse(readFileSync('public/map-styles/story-charcoal.json', 'utf8'))
    const called: string[] = []
    const result = await normalizeWebMap(
      {
        baseMap: {
          baseMapLayers: [{ id: 'old-base', layerType: 'VectorTileLayer', styleUrl: 'https://old.test/style.json' }],
        },
        operationalLayers: [
          {
            id: 'history',
            title: 'Historic imagery',
            url: 'https://example.test/MapServer',
            layerType: 'ArcGISMapServiceLayer',
          },
        ],
      },
      async (url) => {
        called.push(url)
        return {}
      },
      base,
    )
    expect(called).toEqual(['https://example.test/MapServer?f=json'])
    expect(result.style.sources['pgmaps-carto']).toEqual(base.sources['pgmaps-carto'])
    expect(result.style.layers.findIndex((l) => l.id === 'editorial-source-history')).toBeLessThan(
      result.style.layers.findIndex((l) => l.type === 'symbol'),
    )
    expect(base.layers.some((l: { id: string }) => l.id === 'editorial-source-history')).toBe(false)
    expect(result.warnings).toEqual([])
  })
  it('retains healthy layers and reports original source failures instead of replacing cartography', async () => {
    const result = await normalizeWebMap(
      {
        operationalLayers: [
          { id: 'old', title: '1816', url: 'https://example.test/ImageServer', layerType: 'ArcGISImageServiceLayer' },
        ],
      },
      async () => {
        throw new Error('Source returned HTTP 404')
      },
    )
    expect(result.warnings).toEqual(['“1816”: Source returned HTTP 404'])
    expect(Object.keys(result.style.sources)).toHaveLength(0)
  })
})
