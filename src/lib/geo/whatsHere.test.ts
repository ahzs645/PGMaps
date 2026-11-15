import { describe, expect, it } from 'vitest'

import { featureTitle, formatAttribute, groupWhatsHere, isBasemapSource, layerLabel, MAX_PROPERTIES } from './whatsHere'

const sources = {
  carto: { type: 'vector', url: 'https://tiles.basemaps.cartocdn.com/vector/carto.streets/v1/tiles.json' },
  parks: { type: 'geojson' },
  imagery: {
    type: 'raster',
    tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
  },
  local: { type: 'vector', url: 'pmtiles:///data/canada/cell-sites.pmtiles' },
}

describe("What's here", () => {
  it('tells basemap sources from the page’s own data by host', () => {
    expect(isBasemapSource(sources.carto)).toBe(true)
    expect(isBasemapSource(sources.imagery)).toBe(true)
    expect(isBasemapSource(sources.parks)).toBe(false)
    expect(isBasemapSource(sources.local)).toBe(false)
    expect(isBasemapSource({ url: 'https://evil.example/cartocdn.com.json' })).toBe(false)
    expect(isBasemapSource(undefined)).toBe(false)
  })

  it('names layers without their drawing suffixes', () => {
    expect(layerLabel('bc-parks-fill')).toBe('Bc parks')
    expect(layerLabel('parks_outline')).toBe('Parks')
    expect(layerLabel('roadCasing')).toBe('Road casing')
    expect(layerLabel('fill')).toBe('Fill')
  })

  it('titles a feature from a name-like attribute, then its id', () => {
    expect(featureTitle({ properties: { NAME: 'Forests for the World' } }, 'Parks')).toBe('Forests for the World')
    expect(featureTitle({ id: 7, properties: {} }, 'Parks')).toBe('Parks 7')
    expect(featureTitle({ properties: {} }, 'Parks')).toBe('Parks')
  })

  it('formats attributes on one line', () => {
    expect(formatAttribute(null)).toBe('—')
    expect(formatAttribute(0.1 + 0.2)).toBe('0.3')
    expect(formatAttribute({ a: 1 })).toBe('{"a":1}')
    expect(formatAttribute('x'.repeat(200))).toHaveLength(120)
  })

  it('groups page layers first, drops fill/outline duplicates and state layers, and folds the basemap', () => {
    const park = { id: 3, source: 'parks', properties: { name: 'Fort George Park', area: 26.5 } }
    const groups = groupWhatsHere(
      [
        { ...park, layer: { id: 'parks-hover' } },
        {
          source: 'carto',
          sourceLayer: 'transportation_name',
          properties: { name: 'Patricia Blvd' },
          layer: { id: 'roadname_minor' },
        },
        { ...park, layer: { id: 'parks-outline' } },
        { ...park, layer: { id: 'parks-fill' } },
        { source: 'carto', sourceLayer: 'landuse', properties: { class: 'park' }, layer: { id: 'landuse' } },
      ],
      sources,
    )
    expect(groups.map((group) => [group.label, group.basemap, group.features.length])).toEqual([
      ['Parks', false, 1],
      ['Basemap', true, 2],
    ])
    expect(groups[0].features[0]).toMatchObject({
      title: 'Fort George Park',
      rows: [
        ['name', 'Fort George Park'],
        ['area', '26.5'],
      ],
    })
    expect(groups[1].features.map((feature) => feature.title)).toEqual([
      'Patricia Blvd · Transportation name',
      'park · Landuse',
    ])
  })

  it('caps the attribute rows and says how many it left out', () => {
    const properties = Object.fromEntries(Array.from({ length: MAX_PROPERTIES + 3 }, (_, i) => [`k${i}`, i]))
    const [group] = groupWhatsHere([{ source: 'parks', properties, layer: { id: 'parks' } }], sources)
    expect(group.features[0].rows).toHaveLength(MAX_PROPERTIES)
    expect(group.features[0].hiddenRows).toBe(3)
  })
})
