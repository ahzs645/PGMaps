import { describe, expect, it } from 'vitest'

import { collectImportedGeometry, featureName, toFeatures } from './shapeImport'

const SQUARE: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [0.01, 0],
      [0.01, 0.01],
      [0, 0.01],
      [0, 0],
    ],
  ],
}

describe('featureName', () => {
  it('prefers forestry identifiers over generic ones', () => {
    expect(featureName({ name: 'Unnamed', BLOCK_ID: 'A12' }, 0)).toBe('A12')
    expect(featureName({ OPENING_ID: 448122 }, 0)).toBe('448122')
    expect(featureName({ name: 'North face' }, 0)).toBe('North face')
  })

  it('falls back to a numbered label', () => {
    expect(featureName(null, 2)).toBe('Polygon 3')
    expect(featureName({ BLOCK_ID: '   ' }, 0, 'Road')).toBe('Road 1')
  })
})

describe('toFeatures', () => {
  it('accepts collections, features, bare geometry, and arrays of them', () => {
    const feature: GeoJSON.Feature = { type: 'Feature', geometry: SQUARE, properties: {} }
    expect(toFeatures({ type: 'FeatureCollection', features: [feature] })).toHaveLength(1)
    expect(toFeatures(feature)).toHaveLength(1)
    expect(toFeatures(SQUARE)).toHaveLength(1)
    // shpjs hands back one collection per layer in a multi-layer archive.
    expect(toFeatures([{ type: 'FeatureCollection', features: [feature, feature] }])).toHaveLength(2)
  })

  it('unwraps a geometry collection and ignores junk', () => {
    expect(toFeatures({ type: 'GeometryCollection', geometries: [SQUARE, SQUARE] })).toHaveLength(2)
    expect(toFeatures(null)).toHaveLength(0)
    expect(toFeatures({ nope: true })).toHaveLength(0)
  })
})

describe('collectImportedGeometry', () => {
  it('splits polygons from lines and measures the polygons', () => {
    const imported = collectImportedGeometry({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: SQUARE, properties: { BLOCK_ID: 'A12' } },
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [0, 0],
              [0.01, 0.01],
            ],
          },
          properties: { NAME: 'Haul road' },
        },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} },
      ],
    })

    expect(imported.polygons).toHaveLength(1)
    expect(imported.polygons[0].name).toBe('A12')
    expect(imported.polygons[0].areaMeters).toBeGreaterThan(1_000_000)
    expect(imported.lines).toHaveLength(1)
    expect(imported.lines[0].name).toBe('Haul road')
    expect(imported.skippedCount).toBe(1)
  })

  it('splits a multilinestring into one road per part', () => {
    const imported = collectImportedGeometry({
      type: 'Feature',
      geometry: {
        type: 'MultiLineString',
        coordinates: [
          [
            [0, 0],
            [0.01, 0],
          ],
          [
            [0.02, 0],
            [0.03, 0],
          ],
        ],
      },
      properties: {},
    })
    expect(imported.lines).toHaveLength(2)
    expect(imported.skippedCount).toBe(0)
  })

  it('skips lines whose coordinates are unusable', () => {
    const imported = collectImportedGeometry({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        // Unprojected BC Albers metres, the classic missing-.prj symptom.
        coordinates: [
          [1194000, 980000],
          [1194500, 980500],
        ],
      },
      properties: {},
    })
    expect(imported.lines).toHaveLength(0)
    expect(imported.skippedCount).toBe(1)
  })
})
