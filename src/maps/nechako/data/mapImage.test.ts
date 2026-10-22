import { describe, expect, it } from 'vitest'
import {
  checkedMapImageOptions,
  DEFAULT_MAP_IMAGE_OPTIONS,
  fitImageRect,
  imageScaleBar,
  mapImageLegends,
} from './mapImage'
import {
  checkedLayerDisplayName,
  EMPTY_WORKSPACE,
  importWorkspace,
  wmsDisplayName,
  type ActiveWms,
  type Workspace,
} from './workspace'

const wms: ActiveWms = {
  id: 'wms-one',
  source: { name: 'Source service', resource: 'https://example.test/wms', type: 'wms' },
  layer: { name: 'rain', title: 'Rainfall', queryable: true, crs: ['EPSG:3857'], styles: [] },
  style: 'annual',
  opacity: 0.8,
  formats: [],
}
const workspace: Workspace = {
  ...EMPTY_WORKSPACE,
  layers: [wms, { ...wms, id: 'hidden', visible: false }],
  vectors: [
    {
      id: 'vector-one',
      name: 'Sample sites',
      color: '#2563eb',
      visible: true,
      data: {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: { group: 1 }, geometry: { type: 'Point', coordinates: [-123, 54] } }],
      },
      categories: {
        property: 'group',
        rules: [
          { value: 1, color: '#ff0000' },
          { value: '1', color: '#00ff00' },
        ],
        fallback: '#cccccc',
      },
    },
  ],
  sourceOrder: ['wms-one', 'vector-one', 'hidden'],
}

describe('map image composition plan', () => {
  it('keeps current map aspect and complete extent in a different output aspect', () => {
    expect(fitImageRect(1200, 600, { x: 10, y: 20, width: 400, height: 300 })).toEqual({
      x: 10,
      y: 70,
      width: 400,
      height: 200,
    })
    expect(fitImageRect(600, 1200, { x: 0, y: 0, width: 400, height: 300 })).toEqual({
      x: 125,
      y: 0,
      width: 150,
      height: 300,
    })
    expect(() => fitImageRect(0, 600, { x: 0, y: 0, width: 400, height: 300 })).toThrow(/dimensions/)
  })

  it('adjusts the geographic scale for the fitted image rather than the canvas pixel ratio', () => {
    expect(imageScaleBar(100, 1200, 400, 0, 120)).toEqual({ meters: 20000, pixels: 20000 / 300, label: '20 km' })
    expect(imageScaleBar(100, 1200, 400, 0, 120, 30)).toEqual({ meters: 30000, pixels: 100, label: '30 km' })
    expect(imageScaleBar(100, 1200, 400, 61, 120)).toBeNull()
    expect(() => imageScaleBar(100, 1200, 400, 0, 120, 100)).toThrow(/too long/)
    expect(() => imageScaleBar(100, 1200, 400, 0, 120, 0.1)).toThrow(/too short/)
  })

  it('rejects invalid or excessive dimensions and legend controls before allocating a canvas', () => {
    for (const width of [0, 239, 4097, 700.5, NaN, Infinity])
      expect(() => checkedMapImageOptions({ ...DEFAULT_MAP_IMAGE_OPTIONS, width })).toThrow(/Width/)
    expect(() => checkedMapImageOptions({ ...DEFAULT_MAP_IMAGE_OPTIONS, legendScale: 4 })).toThrow(/Legend scale/)
    expect(() => checkedMapImageOptions({ ...DEFAULT_MAP_IMAGE_OPTIONS, scaleDistanceKm: NaN })).toThrow(
      /scale distance/,
    )
    expect(
      checkedMapImageOptions({ ...DEFAULT_MAP_IMAGE_OPTIONS, title: ' <script>literal title</script> ' }).title,
    ).toBe('<script>literal title</script>')
  })

  it('uses visible map order and exact typed category colors; WMS keeps advertised style', () => {
    const legends = mapImageLegends(workspace)
    expect(legends.map((item) => item.id)).toEqual(['vector-one', 'wms-one'])
    expect(legends[0].rows).toEqual([
      { label: 'group: 1 (number)', color: '#ff0000' },
      { label: 'group: 1 (string)', color: '#00ff00' },
      { label: 'Other values', color: '#cccccc' },
    ])
    expect(legends[0].symbols).toEqual(['point'])
    const url = new URL(legends[1].imageUrl!)
    expect(url.searchParams.get('STYLE')).toBe('annual')
    expect(url.searchParams.get('LAYER')).toBe('rain')
    expect(mapImageLegends({ ...workspace, layers: [{ ...wms, opacity: 0 }], vectors: [] })).toEqual([])
  })

  it('preserves WMS source identity, geometry and camera through display-name round trips', () => {
    const named = importWorkspace({
      ...workspace,
      layers: [{ ...wms, displayName: checkedLayerDisplayName(' My rain map ') }],
    })
    expect(wmsDisplayName(named.layers[0])).toBe('My rain map')
    expect(named.layers[0].layer).toEqual(wms.layer)
    expect(named.layers[0].source).toEqual(wms.source)
    expect(named.vectors[0].data).toEqual(workspace.vectors[0].data)
    expect(named.camera).toEqual(workspace.camera)
    expect(mapImageLegends(named).find((item) => item.id === wms.id)?.title).toBe('My rain map')
    expect(() => checkedLayerDisplayName('   ')).toThrow(/1–200/)
    expect(() => importWorkspace({ ...workspace, layers: [{ ...wms, displayName: 'x'.repeat(201) }] })).toThrow(/1–200/)
  })
})
