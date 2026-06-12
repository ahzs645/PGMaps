import { describe, expect, it } from 'vitest'
import { isUserDatasetSource, parseUserDatasetText, userDatasetSourceId } from './userDatasets'

describe('parseUserDatasetText — GeoJSON', () => {
  it('parses a FeatureCollection of points', () => {
    const text = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [-122.75, 53.92] }, properties: { kind: 'cafe' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [-122.76, 53.93] }, properties: { kind: 'shop' } },
      ],
    })
    const parsed = parseUserDatasetText(text, 'places.geojson')
    expect(parsed.format).toBe('geojson')
    expect(parsed.featureCount).toBe(2)
    expect(parsed.propertyKeys).toContain('kind')
    expect(parsed.warnings).toEqual([])
  })

  it('reduces polygons to representative points with a warning', () => {
    const text = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [0, 2],
                [2, 2],
                [2, 0],
                [0, 0],
              ],
            ],
          },
          properties: { name: 'square' },
        },
      ],
    })
    const parsed = parseUserDatasetText(text, 'areas.geojson')
    expect(parsed.featureCount).toBe(1)
    expect(parsed.collection.features[0].geometry.type).toBe('Point')
    expect(parsed.warnings.join(' ')).toMatch(/representative points/)
  })

  it('accepts a single Feature and rejects non-GeoJSON JSON', () => {
    const single = JSON.stringify({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [1, 2] },
      properties: {},
    })
    expect(parseUserDatasetText(single, 'one.json').featureCount).toBe(1)
    expect(() => parseUserDatasetText('{"rows": []}', 'rows.json')).toThrow(/FeatureCollection/)
    expect(() => parseUserDatasetText('not json', 'bad.json')).toThrow(/not valid JSON/)
  })

  it('skips features with invalid coordinates', () => {
    const text = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [-122.75, 53.92] }, properties: {} },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [null, 53.93] }, properties: {} },
        { type: 'Feature', geometry: null, properties: {} },
      ],
    })
    const parsed = parseUserDatasetText(text, 'mixed.geojson')
    expect(parsed.featureCount).toBe(1)
    expect(parsed.warnings.join(' ')).toMatch(/skipped/)
  })
})

describe('parseUserDatasetText — CSV', () => {
  it('parses rows with lat/lon columns and typed properties', () => {
    const csv = ['name,latitude,longitude,visits', 'Library,53.91,-122.74,120', '"Pool, Indoor",53.92,-122.75,45'].join(
      '\n',
    )
    const parsed = parseUserDatasetText(csv, 'visits.csv')
    expect(parsed.format).toBe('csv')
    expect(parsed.featureCount).toBe(2)
    expect(parsed.collection.features[1].properties).toMatchObject({ name: 'Pool, Indoor', visits: 45 })
    const first = parsed.collection.features[0].geometry as GeoJSON.Point
    expect(first.coordinates).toEqual([-122.74, 53.91])
  })

  it('recognizes alternate coordinate column names', () => {
    const csv = ['id,lat,lng', 'a,53.9,-122.7'].join('\n')
    expect(parseUserDatasetText(csv, 'alt.csv').featureCount).toBe(1)
  })

  it('rejects CSVs without coordinate columns and skips bad rows', () => {
    expect(() => parseUserDatasetText('a,b\n1,2', 'plain.csv')).toThrow(/latitude\/longitude/)
    const csv = ['lat,lon,n', '53.9,-122.7,1', '999,-122.7,2', 'abc,def,3'].join('\n')
    const parsed = parseUserDatasetText(csv, 'partial.csv')
    expect(parsed.featureCount).toBe(1)
    expect(parsed.warnings.join(' ')).toMatch(/2 rows/)
  })
})

describe('user dataset source ids', () => {
  it('round-trips the user source prefix', () => {
    const sourceId = userDatasetSourceId('abc123')
    expect(sourceId).toBe('user.abc123')
    expect(isUserDatasetSource(sourceId)).toBe(true)
    expect(isUserDatasetSource('healthyplanPg.businessPois')).toBe(false)
  })
})
