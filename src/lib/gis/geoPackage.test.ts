import { readFileSync } from 'node:fs'
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { GPKG_APPLICATION_ID, GPKG_USER_VERSION, writeGeoPackage } from './geoPackage'
import { GisCoordinateError, gisLayerFromShapeLayer, type GisLayer } from './layers'
import { ROAD_SHAPE_LAYERS } from './testLayers'

let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({
    wasmBinary: new Uint8Array(
      readFileSync(new URL('../../../node_modules/sql.js/dist/sql-wasm.wasm', import.meta.url)),
    ).buffer,
  })
})

const rows = (db: Database, sql: string, params: (string | number)[] = []) => {
  const result = db.exec(sql, params)[0]
  return result ? result.values.map((values) => Object.fromEntries(result.columns.map((c, i) => [c, values[i]]))) : []
}

/** Reads a GeoPackage geometry blob: its header, envelope and the ISO WKB under it. */
function decodeBlob(blob: Uint8Array) {
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength)
  const magic = String.fromCharCode(blob[0], blob[1])
  const flags = blob[3]
  const littleEndian = (flags & 1) === 1
  const envelopeCode = (flags >> 1) & 0b111
  const envelopeLength = [0, 4, 6, 6, 8][envelopeCode]
  const envelope = Array.from({ length: envelopeLength }, (_, i) => view.getFloat64(8 + i * 8, littleEndian))
  let at = 8 + envelopeLength * 8
  const readGeometry = (): { type: number; coordinates: unknown } => {
    const little = view.getUint8(at) === 1
    at += 1
    const type = view.getUint32(at, little)
    at += 4
    const dims = type >= 1000 && type < 2000 ? 3 : 2
    const base = type % 1000
    const position = () => {
      const p = Array.from({ length: dims }, (_, i) => view.getFloat64(at + i * 8, little))
      at += dims * 8
      return p
    }
    const count = () => {
      const n = view.getUint32(at, little)
      at += 4
      return n
    }
    const line = () => Array.from({ length: count() }, position)
    if (base === 1) return { type, coordinates: position() }
    if (base === 2) return { type, coordinates: line() }
    if (base === 3) return { type, coordinates: Array.from({ length: count() }, line) }
    return { type, coordinates: Array.from({ length: count() }, () => readGeometry().coordinates) }
  }
  const geometry = readGeometry()
  return {
    magic,
    version: blob[2],
    flags,
    littleEndian,
    envelopeCode,
    empty: (flags & 0b10000) !== 0,
    srsId: view.getInt32(4, littleEndian),
    envelope,
    geometry,
    consumed: at === blob.length,
  }
}

const scene: GisLayer[] = [
  ...ROAD_SHAPE_LAYERS.map(gisLayerFromShapeLayer),
  {
    name: 'Views of interest',
    title: 'Views of interest',
    description: 'Planned viewpoints & their framing',
    geometry: 'point',
    fields: [
      { name: 'Viewpoint name', type: 'text', title: 'Viewpoint' },
      { name: 'fid', type: 'integer' },
      { name: 'eye_m', type: 'real', description: 'Eye height above the road' },
      { name: 'visible', type: 'boolean' },
      { name: 'captured', type: 'datetime' },
    ],
    features: [
      {
        points: [[-122.79, 53.905, 812.5]],
        attributes: {
          'Viewpoint name': 'Tabor lookout',
          fid: 4,
          eye_m: 1.5,
          visible: true,
          captured: '2026-11-10T19:30:00Z',
        },
      },
      {
        points: [[-122.78, 53.906]],
        attributes: { 'Viewpoint name': 'Hwy 16', fid: 'four', eye_m: null, visible: false, captured: null },
      },
    ],
  },
  {
    name: 'blocks',
    geometry: 'polygon',
    fields: [{ name: 'NAME', type: 'text' }],
    features: [
      {
        polygons: [
          [
            [
              [-122.81, 53.9],
              [-122.81, 53.91],
              [-122.8, 53.91],
              [-122.8, 53.9],
            ],
          ],
          [
            [
              [-122.71, 53.9],
              [-122.7, 53.9],
              [-122.7, 53.91],
            ],
          ],
        ],
        attributes: { NAME: 'Two parts' },
      },
      { polygons: [], attributes: { NAME: 'No shape' } },
    ],
  },
  { name: 'empty', geometry: 'line', fields: [], features: [] },
]

describe('GeoPackage writer', () => {
  it('writes the required metadata tables, typed columns and counts', () => {
    const { bytes, warnings, tables } = writeGeoPackage(SQL, scene, {
      styles: {
        road_centrelines: { qml: '<qgis version="3.40"><renderer-v2 type="singleSymbol"/></qgis>', sld: '<sld/>' },
        blocks: { sld: '<StyledLayerDescriptor/>' },
        missing: { qml: '<qgis/>' },
      },
      lastChange: new Date('2026-11-18T12:00:00Z'),
    })
    expect(new TextDecoder().decode(bytes.slice(0, 15))).toBe('SQLite format 3')
    expect(tables).toEqual([
      { layer: 'road_centrelines', table: 'road_centrelines' },
      { layer: 'road_stations', table: 'road_stations' },
      { layer: 'context_areas', table: 'context_areas' },
      { layer: 'Views of interest', table: 'Views_of_interest' },
      { layer: 'blocks', table: 'blocks' },
      { layer: 'empty', table: 'empty' },
    ])
    expect(warnings).toEqual([
      'Style for "missing" left out; no layer has that name.',
      'Layer "Views of interest" written as the table "Views_of_interest".',
      'Views of interest field "Viewpoint name" written as the column "Viewpoint_name", with its name as the alias.',
      'Views of interest field "fid" written as the column "field_fid", with its name as the alias.',
      'Views of interest: 1 vertex has no height; written as NaN, unknown, in a layer with heights.',
      'Views of interest fid: left blank in 1 record; the value is not a number.',
      'blocks: style kept as SLD only; QGIS applies a default style only from QML.',
    ])

    const db = new SQL.Database(bytes)
    try {
      expect(db.exec('PRAGMA application_id')[0].values[0][0]).toBe(GPKG_APPLICATION_ID)
      expect(db.exec('PRAGMA user_version')[0].values[0][0]).toBe(GPKG_USER_VERSION)
      expect(db.exec('PRAGMA integrity_check')[0].values[0][0]).toBe('ok')
      expect(db.exec('PRAGMA foreign_key_check')).toEqual([])
      expect(
        rows(db, 'SELECT srs_id, organization, organization_coordsys_id FROM gpkg_spatial_ref_sys ORDER BY srs_id'),
      ).toEqual([
        { srs_id: -1, organization: 'NONE', organization_coordsys_id: -1 },
        { srs_id: 0, organization: 'NONE', organization_coordsys_id: 0 },
        { srs_id: 4326, organization: 'EPSG', organization_coordsys_id: 4326 },
      ])
      const contents = rows(db, 'SELECT * FROM gpkg_contents ORDER BY rowid')
      expect(contents.map((c) => [c.table_name, c.data_type, c.identifier, c.srs_id])).toEqual([
        ['layer_styles', 'attributes', 'layer_styles', null],
        ['road_centrelines', 'features', 'road_centrelines', 4326],
        ['road_stations', 'features', 'road_stations', 4326],
        ['context_areas', 'features', 'context_areas', 4326],
        ['Views_of_interest', 'features', 'Views of interest', 4326],
        ['blocks', 'features', 'blocks', 4326],
        ['empty', 'features', 'empty', 4326],
      ])
      expect(contents[4].description).toBe('Planned viewpoints & their framing')
      expect(contents[1].last_change).toBe('2026-11-18T12:00:00.000Z')
      expect([contents[1].min_x, contents[1].min_y, contents[1].max_x, contents[1].max_y]).toEqual([
        -122.8, 53.9, -122.797, 53.902,
      ])
      expect([contents[5].min_x, contents[5].max_x]).toEqual([-122.81, -122.7])
      expect([contents[6].min_x, contents[6].max_y]).toEqual([null, null])

      expect(
        rows(db, 'SELECT table_name, column_name, geometry_type_name, srs_id, z, m FROM gpkg_geometry_columns'),
      ).toEqual([
        {
          table_name: 'road_centrelines',
          column_name: 'geom',
          geometry_type_name: 'LINESTRING',
          srs_id: 4326,
          z: 0,
          m: 0,
        },
        { table_name: 'road_stations', column_name: 'geom', geometry_type_name: 'POINT', srs_id: 4326, z: 0, m: 0 },
        { table_name: 'context_areas', column_name: 'geom', geometry_type_name: 'POLYGON', srs_id: 4326, z: 0, m: 0 },
        { table_name: 'Views_of_interest', column_name: 'geom', geometry_type_name: 'POINT', srs_id: 4326, z: 1, m: 0 },
        { table_name: 'blocks', column_name: 'geom', geometry_type_name: 'MULTIPOLYGON', srs_id: 4326, z: 0, m: 0 },
        { table_name: 'empty', column_name: 'geom', geometry_type_name: 'LINESTRING', srs_id: 4326, z: 0, m: 0 },
      ])
      // The counts are kept by triggers, so they match the tables and follow a later edit.
      for (const { table_name, feature_count } of rows(db, 'SELECT * FROM gpkg_ogr_contents'))
        expect(db.exec(`SELECT count(*) FROM "${table_name}"`)[0].values[0][0]).toBe(feature_count)
      db.run('DELETE FROM road_stations WHERE fid = 1')
      expect(rows(db, "SELECT feature_count FROM gpkg_ogr_contents WHERE table_name = 'road_stations'")).toEqual([
        { feature_count: 1 },
      ])

      expect(rows(db, 'PRAGMA table_info("Views_of_interest")').map((c) => [c.name, c.type, c.pk])).toEqual([
        ['fid', 'INTEGER', 1],
        ['geom', 'POINT', 0],
        ['Viewpoint_name', 'TEXT', 0],
        ['field_fid', 'INTEGER', 0],
        ['eye_m', 'REAL', 0],
        ['visible', 'BOOLEAN', 0],
        ['captured', 'DATETIME', 0],
      ])
      expect(rows(db, 'SELECT Viewpoint_name, field_fid, eye_m, visible, captured FROM Views_of_interest')).toEqual([
        { Viewpoint_name: 'Tabor lookout', field_fid: 4, eye_m: 1.5, visible: 1, captured: '2026-11-10T19:30:00.000Z' },
        { Viewpoint_name: 'Hwy 16', field_fid: null, eye_m: null, visible: 0, captured: null },
      ])
      expect(rows(db, 'SELECT typeof(LENGTH_M) AS length, typeof(COST_CAD) AS cost FROM road_centrelines')).toEqual([
        { length: 'real', cost: 'integer' },
      ])

      expect(rows(db, 'SELECT table_name, column_name, name, title, description FROM gpkg_data_columns')).toEqual([
        {
          table_name: 'Views_of_interest',
          column_name: 'Viewpoint_name',
          name: 'Viewpoint',
          title: 'Viewpoint',
          description: null,
        },
        { table_name: 'Views_of_interest', column_name: 'field_fid', name: 'fid', title: null, description: null },
        {
          table_name: 'Views_of_interest',
          column_name: 'eye_m',
          name: 'eye_m',
          title: null,
          description: 'Eye height above the road',
        },
      ])
      expect(rows(db, 'SELECT table_name, extension_name, scope FROM gpkg_extensions')).toEqual([
        { table_name: 'gpkg_data_columns', extension_name: 'gpkg_schema', scope: 'read-write' },
        { table_name: 'gpkg_data_column_constraints', extension_name: 'gpkg_schema', scope: 'read-write' },
      ])

      const styles = rows(db, 'SELECT * FROM layer_styles ORDER BY id')
      expect(
        styles.map((s) => [
          s.f_table_catalog,
          s.f_table_schema,
          s.f_table_name,
          s.f_geometry_column,
          s.styleName,
          s.useAsDefault,
          s.type,
        ]),
      ).toEqual([
        ['', '', 'road_centrelines', 'geom', 'road_centrelines', 1, 'vector'],
        ['', '', 'blocks', 'geom', 'blocks', 1, 'vector'],
      ])
      expect(styles[0].styleQML).toContain('singleSymbol')
      expect(styles[1].styleQML).toBeNull()
      expect(rows(db, "SELECT feature_count FROM gpkg_ogr_contents WHERE table_name = 'layer_styles'")).toEqual([
        { feature_count: 2 },
      ])
      // sql.js has no rtree module, so no spatial index is written.
      expect(rows(db, "SELECT name FROM sqlite_master WHERE name LIKE 'rtree%'")).toEqual([])
    } finally {
      db.close()
    }
  })

  it('writes GeoPackage binary geometry with its envelope over ISO WKB', () => {
    const db = new SQL.Database(writeGeoPackage(SQL, scene).bytes)
    try {
      const line = decodeBlob(db.exec('SELECT geom FROM road_centrelines')[0].values[0][0] as Uint8Array)
      expect(line).toMatchObject({
        magic: 'GP',
        version: 0,
        littleEndian: true,
        envelopeCode: 1,
        empty: false,
        srsId: 4326,
      })
      expect(line.flags).toBe(0b011)
      expect(line.envelope).toEqual([-122.8, -122.797, 53.9, 53.902])
      expect(line.geometry).toEqual({
        type: 2,
        coordinates: [
          [-122.8, 53.9],
          [-122.797, 53.902],
        ],
      })
      expect(line.consumed).toBe(true)

      const [withHeight, withoutHeight] = db
        .exec('SELECT geom FROM Views_of_interest ORDER BY fid')[0]
        .values.map((v) => decodeBlob(v[0] as Uint8Array))
      expect(withHeight.envelopeCode).toBe(2)
      expect(withHeight.envelope).toEqual([-122.79, -122.79, 53.905, 53.905, 812.5, 812.5])
      expect(withHeight.geometry).toEqual({ type: 1001, coordinates: [-122.79, 53.905, 812.5] })
      // A vertex without a height in a layer with heights is unknown (NaN), never 0.
      expect(withoutHeight.envelopeCode).toBe(1)
      expect(withoutHeight.geometry.type).toBe(1001)
      expect(Number.isNaN((withoutHeight.geometry.coordinates as number[])[2])).toBe(true)

      const [blocks, none] = db.exec('SELECT geom FROM blocks ORDER BY fid')[0].values.map((v) => v[0])
      expect(none).toBeNull()
      const multi = decodeBlob(blocks as Uint8Array)
      expect(multi.geometry.type).toBe(6)
      const [first, second] = multi.geometry.coordinates as number[][][][]
      // Rings are closed and the outer ring runs counter-clockwise.
      expect(first[0]).toEqual([
        [-122.81, 53.9],
        [-122.8, 53.9],
        [-122.8, 53.91],
        [-122.81, 53.91],
        [-122.81, 53.9],
      ])
      expect(second[0]).toHaveLength(4)
      expect(multi.envelope).toEqual([-122.81, -122.7, 53.9, 53.91])
    } finally {
      db.close()
    }
  })

  it('refuses a coordinate that is not a longitude/latitude, naming the layer and feature', () => {
    const broken: GisLayer = {
      name: 'road_stations',
      geometry: 'point',
      fields: [{ name: 'NAME', type: 'text' }],
      features: [{ points: [[-122.8, Number.POSITIVE_INFINITY]], attributes: { NAME: 'STA 0+000' } }],
    }
    expect(() => writeGeoPackage(SQL, [broken])).toThrow(GisCoordinateError)
    expect(() => writeGeoPackage(SQL, [broken])).toThrow('Layer "road_stations", feature 1 (STA 0+000)')
  })

  it('keeps layer and column names apart from the reserved ones and from each other', () => {
    const layer = (name: string): GisLayer => ({
      name,
      geometry: 'point',
      fields: [
        { name: 'geom', type: 'text' },
        { name: 'Name', type: 'text' },
        { name: 'name', type: 'text' },
        { name: '2nd', type: 'text' },
      ],
      features: [],
    })
    const { tables, warnings } = writeGeoPackage(SQL, [
      layer('gpkg_contents'),
      layer('Roads'),
      layer('roads'),
      layer('layer_styles'),
    ])
    expect(tables.map((t) => t.table)).toEqual(['layer_gpkg_contents', 'Roads', 'roads_2', 'layer_layer_styles'])
    expect(warnings).toContain(
      'gpkg_contents field "geom" written as the column "field_geom", with its name as the alias.',
    )
    expect(warnings).toContain('gpkg_contents field "name" written as the column "name_2", with its name as the alias.')
    expect(warnings).toContain(
      'gpkg_contents field "2nd" written as the column "field_2nd", with its name as the alias.',
    )
  })
})
