import { describe, expect, it } from 'vitest'
import {
  GeoFileImportError,
  parseCsvRows,
  parseCsvText,
  parseGeoJsonText,
  parseKmlText,
  toFeatureCollection,
} from './geoFileImport'

describe('toFeatureCollection', () => {
  it('flattens collections, bare geometries and geometry collections and skips empty features', () => {
    const { collection, skipped } = toFeatureCollection([
      { type: 'Point', coordinates: [1, 2] },
      {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', geometry: null, properties: {} },
          {
            type: 'Feature',
            properties: { name: 'both' },
            geometry: {
              type: 'GeometryCollection',
              geometries: [
                { type: 'Point', coordinates: [0, 0] },
                {
                  type: 'LineString',
                  coordinates: [
                    [0, 0],
                    [1, 1],
                  ],
                },
              ],
            },
          },
        ],
      },
    ])
    expect(collection.features.map((feature) => feature.geometry.type)).toEqual(['Point', 'Point', 'LineString'])
    expect(collection.features[2].properties).toEqual({ name: 'both' })
    expect(skipped).toBe(1)
  })
})

describe('parseGeoJsonText', () => {
  it('rejects JSON without features', () => {
    expect(() => parseGeoJsonText('{"type":"FeatureCollection","features":[]}')).toThrow(GeoFileImportError)
    expect(() => parseGeoJsonText('nope')).toThrow('not valid JSON')
  })
})

describe('CSV', () => {
  it('reads quoted fields, escaped quotes and embedded newlines', () => {
    expect(parseCsvRows('a,b\n"x, ""y""","multi\nline"\r\n')).toEqual([
      ['a', 'b'],
      ['x, "y"', 'multi\nline'],
    ])
  })

  it('places rows from latitude/longitude columns and keeps numbers numeric', () => {
    const { collection, skipped } = parseCsvText('Name,Lat,Lng,Count,Code\nA,53.9,-122.7,4,007\nB,,,1,1\n')
    expect(skipped).toBe(1)
    expect(collection.features).toHaveLength(1)
    expect(collection.features[0].geometry).toEqual({ type: 'Point', coordinates: [-122.7, 53.9] })
    expect(collection.features[0].properties).toEqual({ Name: 'A', Count: 4, Code: '007' })
  })

  it('explains missing coordinate columns', () => {
    expect(() => parseCsvText('Name,Value\nA,1\n')).toThrow('latitude and longitude')
  })
})

describe('parseKmlText', () => {
  it('reads placemarks with names, extended data and polygons with holes', () => {
    const kml = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
      <Placemark><name>Rink &amp; park</name><ExtendedData><Data name="Surface"><value>Ice</value></Data></ExtendedData>
        <Point><coordinates>-122.7,53.9,0</coordinates></Point></Placemark>
      <Placemark><name>Lot</name><Polygon>
        <outerBoundaryIs><LinearRing><coordinates>0,0 4,0 4,4 0,4 0,0</coordinates></LinearRing></outerBoundaryIs>
        <innerBoundaryIs><LinearRing><coordinates>1,1 2,1 2,2 1,1</coordinates></LinearRing></innerBoundaryIs>
      </Polygon></Placemark>
      <Placemark><name>No geometry</name></Placemark>
    </Document></kml>`
    const { collection, skipped } = parseKmlText(kml)
    expect(skipped).toBe(1)
    expect(collection.features[0].properties).toEqual({ name: 'Rink & park', Surface: 'Ice' })
    expect(collection.features[0].geometry).toEqual({ type: 'Point', coordinates: [-122.7, 53.9] })
    const polygon = collection.features[1].geometry as GeoJSON.Polygon
    expect(polygon.coordinates).toHaveLength(2)
  })
})
