import { describe, expect, it } from 'vitest'

import { writeShapefile } from '@/lib/gis/shapefile'
import {
  collectImportedGeometry,
  featureGroup,
  featureName,
  planningIds,
  readShapeFiles,
  toFeatures,
} from './shapeImport'

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

  it('reads the identifier whatever its case, as ArcGIS exports write Block_ID', () => {
    // The CHU_26_1_4 planning shapefile: Block_ID, Shape_Leng, Shape_Area, Area, Operating_.
    expect(featureName({ Block_ID: 'CHU_26_1', Operating_: 'Chuchinka' }, 0)).toBe('CHU_26_1')
  })

  it('carries block, licence and permit for the block summary', () => {
    // A BCTS block export (CHUC_19_13).
    expect(
      planningIds({ BLOCK_ID: 'CHUC_19_13', LICENCE_ID: '!PG_COFA_DEFER', PERMIT_ID: 'APR - !PG_COFA_DEFER', UBI: '' }),
    ).toEqual({ blockId: 'CHUC_19_13', licenceId: '!PG_COFA_DEFER', permitId: 'APR - !PG_COFA_DEFER', openingId: null })
    expect(planningIds({ Shape_Area: 12 })).toBeUndefined()
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

describe('naming unnamed blocks by operating area', () => {
  /** A planning layer as ArcGIS writes it: the operating area cut to `Operating_`, the id on few blocks. */
  const plan = (rows: Array<Record<string, unknown>>) =>
    collectImportedGeometry({
      type: 'FeatureCollection',
      features: rows.map((properties) => ({ type: 'Feature', geometry: SQUARE, properties })),
    }).polygons.map((polygon) => polygon.name)

  const row = (Block_ID: string | null, Operating_: string | null) => ({
    Block_ID,
    Operating_,
    Shape_Leng: 1234.5,
    Shape_Area: 98765.4,
    Area: 9.88,
  })

  it('keeps a block id exactly where one is filled', () => {
    expect(plan([row('XY 101-A', 'Alder Flats'), row(' XY-102 ', 'Alder Flats')])).toEqual(['XY 101-A', 'XY-102'])
  })

  it('numbers unnamed blocks within their operating area, in file order', () => {
    expect(
      plan([
        row(null, 'Alder Flats'),
        row(null, 'Birch Ridge'),
        row('XY 101', 'Alder Flats'),
        row('', 'Alder Flats'),
        row(null, 'Birch Ridge'),
        row(null, 'Alder Flats'),
      ]),
    ).toEqual(['Alder Flats 1', 'Birch Ridge 1', 'XY 101', 'Alder Flats 2', 'Birch Ridge 2', 'Alder Flats 3'])
  })

  it('falls back to the polygon number with no area, without repeating another name', () => {
    expect(plan([row(null, 'Alder Flats'), row(null, null), row(null, '  '), row('Polygon 4', null), row(null, '')]))
      // The fourth polygon's own id is "Polygon 4", so the fifth unnamed one cannot also be.
      .toEqual(['Alder Flats 1', 'Polygon 2', 'Polygon 3', 'Polygon 4', 'Polygon 5'])
    expect(plan([row('Alder Flats 1', 'Alder Flats'), row(null, 'Alder Flats')])).toEqual([
      'Alder Flats 1',
      'Alder Flats 2',
    ])
  })

  it('reads the area column whatever its case or dBASE truncation, and never a numeric area', () => {
    expect(featureGroup({ OPERATING_: 'Alder Flats' })).toBe('Alder Flats')
    expect(featureGroup({ operating_area: 'Alder Flats' })).toBe('Alder Flats')
    expect(featureGroup({ Landscape_: 'Upper Creek' })).toBe('Upper Creek')
    expect(featureGroup({ oper_area: 'Birch Ridge', LOCATION: 'Somewhere else' })).toBe('Birch Ridge')
    expect(featureGroup({ Area: 9.88, Shape_Area: 98765.4, AREA_NAME: 12 })).toBeNull()
    expect(featureGroup({ LOCATION: '1234' })).toBeNull()
    expect(
      plan([
        { BLOCK_ID: null, operating_: 'Alder Flats' },
        { block_id: 'xy 9', OPERATING_: 'Alder Flats' },
      ]),
    ).toEqual(['Alder Flats 1', 'xy 9'])
  })

  it('leaves the single-feature label as it was', () => {
    expect(featureName({ Operating_: 'Alder Flats' }, 4)).toBe('Polygon 5')
  })
})

describe('readShapeFiles', () => {
  // One block as ArcGIS leaves a layer: its parts, the indexes and metadata beside them, and the lock files.
  const parts = writeShapefile({
    name: 'Plan',
    type: 'polygon',
    fields: [{ name: 'BLOCK_ID', type: 'C', length: 10 }],
    features: [{ parts: [SQUARE.coordinates[0] as [number, number][]], attributes: { BLOCK_ID: 'A101' } }],
  })
  const file = (name: string) => new File([(parts[name] ?? new Uint8Array()).slice()], name)
  const layer = ['Plan.shp', 'Plan.dbf', 'Plan.prj', 'Plan.cpg'].map(file)
  const extras = ['Plan.shx', 'Plan.sbn', 'Plan.shp.xml', 'Plan.shp.HOST.332.1996.sr.lock'].map(file)

  it('reads a loose shapefile from its parts and passes over what ArcGIS keeps beside it', async () => {
    const read = await readShapeFiles([...layer, ...extras])
    expect(read.polygons.map((polygon) => polygon.name)).toEqual(['A101'])
    expect(read.polygons[0].geometry.coordinates[0][0][0]).toBeCloseTo(0, 6)
    expect(read.sourceName).toBe('Plan.shp')
  })

  it('refuses a .shp without its .prj rather than guessing its coordinate system', async () => {
    await expect(readShapeFiles(layer.filter((f) => !f.name.endsWith('.prj')))).rejects.toThrow(/without its \.prj/)
  })

  it('refuses parts without their .shp, and a lone .shp read as a zip', async () => {
    await expect(readShapeFiles([file('Plan.dbf'), file('Plan.prj')])).rejects.toThrow(/without its \.shp/)
    await expect(readShapeFiles(extras)).rejects.toThrow(/None of these files hold shapes/)
  })
})
