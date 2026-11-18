import { zipSync } from 'fflate'
import shp from 'shpjs'
import { describe, expect, it } from 'vitest'
import {
  assertWritableCoordinates,
  closedPolygonRings,
  fieldValue,
  GisCoordinateError,
  gisLayerFromShapeLayer,
  layerHasZ,
  layersFromGeoJson,
  layerToGeoJson,
  shapeLayerFromGisLayer,
  type GisLayer,
  type GisLineFeature,
  type GisPolygonFeature,
} from './layers'
import { writeShapefileLayer } from './shapefile'
import { ROAD_SHAPE_LAYERS } from './testLayers'

describe('shapefile layers', () => {
  it('become neutral layers and come back as the same shapefile layers, without a warning', () => {
    const layers = ROAD_SHAPE_LAYERS.map(gisLayerFromShapeLayer)
    expect(layers.map((layer) => layer.geometry)).toEqual(['line', 'point', 'polygon'])
    expect(layers[0].fields.map((field) => field.type)).toEqual(['text', 'real', 'integer'])
    expect((layers[2].features[0] as GisPolygonFeature).polygons).toEqual([
      (ROAD_SHAPE_LAYERS[2].features[0] as { parts: unknown }).parts,
    ])
    for (const [i, layer] of layers.entries()) {
      const back = shapeLayerFromGisLayer(layer)
      expect(back.warnings).toEqual([])
      expect(back.layer).toEqual(ROAD_SHAPE_LAYERS[i])
    }
  })

  it('folds names to dBase, splits multi-part points and polygons, and says what it changed', async () => {
    const layer: GisLayer = {
      name: 'views:of/interest',
      geometry: 'polygon',
      fields: [
        { name: 'Viewpoint name', type: 'text' },
        { name: 'Viewpoint number', type: 'integer' },
        { name: 'visible', type: 'boolean' },
        { name: 'captured', type: 'date' },
        { name: 'share', type: 'real' },
      ],
      features: [
        {
          polygons: [
            [
              [
                [-122.81, 53.9, 700],
                [-122.8, 53.9, 701],
                [-122.8, 53.91, 702],
              ],
            ],
            [
              [
                [-122.79, 53.9],
                [-122.78, 53.9],
                [-122.78, 53.91],
              ],
            ],
          ],
          attributes: {
            'Viewpoint name': 'Tabor & Hwy 16',
            'Viewpoint number': 'seven',
            visible: true,
            captured: '2026-11-10',
            share: 0.123456789012,
            extra: 1,
          },
        },
      ],
    }
    const { layer: shape, warnings } = shapeLayerFromGisLayer(layer)
    expect(shape.name).toBe('views_of_interest')
    expect(shape.fields.map((field) => [field.name, field.type, field.decimals])).toEqual([
      ['VIEWPOINT_', 'C', undefined],
      ['VIEWPOIN_1', 'N', 0],
      ['VISIBLE', 'C', undefined],
      ['CAPTURED', 'C', undefined],
      ['SHARE', 'N', 8],
    ])
    expect(shape.features).toHaveLength(2)
    expect(warnings).toEqual([
      'views:of/interest: extra left out; the layer has no field of that name.',
      'views:of/interest: written as the file name "views_of_interest".',
      'views_of_interest Viewpoint name: written as VIEWPOINT_; a dBase field name is up to 10 capitals, digits or _.',
      'views_of_interest Viewpoint number: written as VIEWPOIN_1; a dBase field name is up to 10 capitals, digits or _.',
      'views_of_interest visible: written as VISIBLE; a dBase field name is up to 10 capitals, digits or _.',
      'views_of_interest captured: written as CAPTURED; a dBase field name is up to 10 capitals, digits or _.',
      'views_of_interest share: written as SHARE; a dBase field name is up to 10 capitals, digits or _.',
      'views_of_interest: heights left out; the shapefile is written in 2D.',
      'views_of_interest Viewpoint number: left blank in 1 record; the value is not a number.',
      'views_of_interest share: rounded to 8 decimals in 1 record; give the field its decimals to choose another precision.',
      "views_of_interest: 1 multi-part feature written as one record per part, each with the feature's attributes.",
    ])
    const files = writeShapefileLayer(shape).files
    const parsed = (await shp(
      zipSync(Object.fromEntries(Object.entries(files))).buffer as ArrayBuffer,
    )) as GeoJSON.FeatureCollection
    expect(parsed.features).toHaveLength(2)
    expect(parsed.features[0].properties).toMatchObject({
      VIEWPOINT_: 'Tabor & Hwy 16',
      VISIBLE: 'true',
      CAPTURED: '2026-11-10',
      SHARE: 0.12345679,
    })
  })
})

describe('GeoJSON', () => {
  const collection: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 7,
        properties: { name: 'Landing', count: 3, open: true },
        geometry: { type: 'Point', coordinates: [-122.8, 53.9] },
      },
      {
        type: 'Feature',
        id: 8,
        properties: { name: 'Pair', count: 2.5, open: false, note: { a: 1 } },
        geometry: {
          type: 'MultiPoint',
          coordinates: [
            [-122.8, 53.9],
            [-122.7, 53.8],
          ],
        },
      },
      {
        type: 'Feature',
        properties: { name: 'Road', grade: 8 },
        geometry: {
          type: 'LineString',
          coordinates: [
            [-122.8, 53.9, 700],
            [-122.79, 53.91, 710],
          ],
        },
      },
      {
        type: 'Feature',
        properties: { name: 'Two blocks' },
        geometry: {
          type: 'MultiPolygon',
          coordinates: [
            [
              [
                [-122.81, 53.9],
                [-122.8, 53.9],
                [-122.8, 53.91],
                [-122.81, 53.9],
              ],
            ],
            [
              [
                [-122.71, 53.9],
                [-122.7, 53.9],
                [-122.7, 53.91],
                [-122.71, 53.9],
              ],
            ],
          ],
        },
      },
      {
        type: 'Feature',
        properties: { name: 'Collection of lines' },
        geometry: {
          type: 'GeometryCollection',
          geometries: [
            {
              type: 'LineString',
              coordinates: [
                [-122.8, 53.9],
                [-122.8, 53.95],
              ],
            },
            {
              type: 'MultiLineString',
              coordinates: [
                [
                  [-122.7, 53.9],
                  [-122.7, 53.95],
                ],
              ],
            },
          ],
        },
      },
      { type: 'Feature', properties: { name: 'Nothing' }, geometry: null as unknown as GeoJSON.Geometry },
      {
        type: 'Feature',
        properties: { name: 'Mixed' },
        geometry: {
          type: 'GeometryCollection',
          geometries: [
            { type: 'Point', coordinates: [-122.8, 53.9] },
            {
              type: 'LineString',
              coordinates: [
                [-122.8, 53.9],
                [-122.8, 53.95],
              ],
            },
          ],
        },
      },
    ],
  }

  it('splits a collection by geometry family, types its fields and reports what it left out', () => {
    const { layers, warnings } = layersFromGeoJson(collection, { name: 'scene', title: 'Scene' })
    expect(layers.map((layer) => [layer.name, layer.title, layer.geometry, layer.features.length])).toEqual([
      ['scene_points', 'Scene (points)', 'point', 2],
      ['scene_lines', 'Scene (lines)', 'line', 2],
      ['scene_polygons', 'Scene (polygons)', 'polygon', 1],
    ])
    const [points, lines] = layers
    expect(points.fields.map((field) => [field.name, field.type])).toEqual([
      ['id', 'integer'],
      ['name', 'text'],
      ['count', 'real'],
      ['open', 'boolean'],
      ['note', 'text'],
    ])
    expect(points.features[0].attributes.id).toBe(7)
    expect(lines.fields.map((field) => [field.name, field.type])).toEqual([
      ['name', 'text'],
      ['grade', 'integer'],
    ])
    expect(layerHasZ(lines)).toBe(true)
    expect((lines.features[1] as GisLineFeature).lines).toHaveLength(2)
    expect(warnings).toEqual([
      'scene: 1 feature without a geometry left out.',
      'scene: 1 feature left out; a geometry collection that mixes points, lines and polygons, or a geometry type this writer does not know, fits no one layer.',
    ])
  })

  it('writes a layer back as the same features', () => {
    const { layers } = layersFromGeoJson(collection, { name: 'scene' })
    const back = layers.flatMap((layer) => layerToGeoJson(layer).features)
    expect(back.map((feature) => feature.geometry?.type)).toEqual([
      'Point',
      'MultiPoint',
      'LineString',
      'MultiLineString',
      'MultiPolygon',
    ])
    expect(back[0].properties).toEqual({ id: 7, name: 'Landing', count: 3, open: true, note: null })
    expect(back[4].geometry).toEqual(collection.features[3].geometry)
    expect(back[2].geometry).toEqual(collection.features[2].geometry)
  })

  it('names the id field so it does not collide with a property', () => {
    const { layers } = layersFromGeoJson(
      {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', id: 'a', properties: { id: 1 }, geometry: { type: 'Point', coordinates: [0, 0] } },
        ],
      },
      { name: 'one' },
    )
    expect(layers[0].name).toBe('one')
    expect(layers[0].fields.map((field) => field.name)).toEqual(['feature_id', 'id'])
    expect(layers[0].features[0].attributes).toEqual({ feature_id: 'a', id: 1 })
  })
})

describe('values and coordinates', () => {
  it('never rounds or parses a value into another type', () => {
    expect(fieldValue({ name: 'n', type: 'integer' }, 2.5)).toEqual({ value: null, problem: 'not a whole number' })
    expect(fieldValue({ name: 'n', type: 'integer' }, '3')).toEqual({ value: null, problem: 'not a number' })
    expect(fieldValue({ name: 'n', type: 'real' }, Number.NaN)).toEqual({ value: null })
    expect(fieldValue({ name: 'd', type: 'date' }, '2026-11-18')).toEqual({ value: '2026-11-18' })
    expect(fieldValue({ name: 'd', type: 'date' }, new Date('2026-11-18T23:30:00Z'))).toEqual({ value: '2026-11-18' })
    expect(fieldValue({ name: 'd', type: 'datetime' }, '2026-11-18T10:00:00-08:00')).toEqual({
      value: '2026-11-18T18:00:00.000Z',
    })
    expect(fieldValue({ name: 'd', type: 'date' }, 'soon')).toEqual({ value: null, problem: 'not a date' })
    expect(fieldValue({ name: 'b', type: 'boolean' }, 1)).toEqual({ value: true })
    expect(fieldValue({ name: 't', type: 'text' }, { a: 1 })).toEqual({ value: '{"a":1}' })
  })

  it('names the layer and feature of a coordinate no format can write', () => {
    const layer: GisLayer = {
      name: 'road_stations',
      geometry: 'point',
      fields: [{ name: 'NAME', type: 'text' }],
      features: [
        { points: [[-122.8, 53.9]], attributes: { NAME: 'A' } },
        { points: [[Number.NaN, 53.9]], attributes: { NAME: 'STA 0+040' } },
      ],
    }
    expect(() => assertWritableCoordinates(layer)).toThrow(GisCoordinateError)
    expect(() => assertWritableCoordinates(layer)).toThrow(/Layer "road_stations", feature 2 \(STA 0\+040\)/)
    // UTM metres handed over as degrees.
    const projected: GisLayer = { ...layer, features: [{ points: [[500_000, 5_970_000]], attributes: {} }] }
    expect(() => assertWritableCoordinates(projected)).toThrow(/feature 1:/)
  })

  it('closes rings and turns the outer ring counter-clockwise and holes clockwise', () => {
    const area = (ring: readonly (readonly number[])[]) =>
      ring.slice(0, -1).reduce((sum, p, i) => sum + p[0] * ring[i + 1][1] - ring[i + 1][0] * p[1], 0)
    const [outer, hole] = closedPolygonRings([
      [
        [0, 0],
        [0, 1],
        [1, 1],
        [1, 0],
      ],
      [
        [0.2, 0.2],
        [0.8, 0.2],
        [0.8, 0.8],
      ],
    ])
    expect(outer).toHaveLength(5)
    expect(area(outer)).toBeGreaterThan(0)
    expect(area(hole)).toBeLessThan(0)
    expect(hole[0]).toEqual(hole.at(-1))
  })
})
