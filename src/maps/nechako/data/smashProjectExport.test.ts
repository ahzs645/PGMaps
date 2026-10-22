import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { beforeAll, describe, expect, it } from 'vitest'
import type { FeatureCollection } from 'geojson'
import { parseGpapDatabase } from './geopaparazzi'
import { writeSmashProject } from './smashProjectExport'

let SQL: SqlJsStatic
beforeAll(async () => {
  const require = createRequire(import.meta.url)
  SQL = await initSqlJs({
    wasmBinary: Uint8Array.from(readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))).buffer,
  })
})
const exportedAt = '2026-10-21T00:00:00.000Z'
const data: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 'original-string-id',
      properties: { value: 0, enabled: false, empty: null, nested: { text: "O'Brien" }, observed_at: '2014-01-01' },
      geometry: { type: 'Point', coordinates: [-123, 54, 765.25] },
    },
    {
      type: 'Feature',
      id: 0,
      properties: {},
      geometry: {
        type: 'MultiPoint',
        coordinates: [
          [-124, 54],
          [-125, 55],
        ],
      },
    },
    {
      type: 'Feature',
      id: 'polygon-original',
      properties: { type: 'area' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-123, 54],
            [-122, 54],
            [-122, 55],
            [-123, 54],
          ],
        ],
      },
    },
  ],
}
describe('native SMASH project writer', () => {
  it('creates a real SQLite GPAP with the official note/extension tables and lossless source mapping', () => {
    const result = writeSmashProject(SQL, {
      name: 'Synthetic native export',
      exportedAt,
      layers: [{ id: 'source-layer-7', name: 'Original features', color: '#123456', data }],
      camera: { center: [-123, 54], zoom: 8, bearing: 0, pitch: 0 },
    })
    expect(new TextDecoder().decode(result.bytes.slice(0, 16))).toBe('SQLite format 3\0')
    const db = new SQL.Database(result.bytes)
    try {
      expect(db.exec('PRAGMA integrity_check')[0].values).toEqual([['ok']])
      expect(db.exec('PRAGMA foreign_key_check')).toEqual([])
      expect(db.exec('SELECT count(*) FROM notesext')[0].values[0][0]).toBe(3)
      expect(db.exec('SELECT lon,lat,zoom FROM bookmarks')[0].values[0]).toEqual([-123, 54, 8])
      const project = parseGpapDatabase(db, { name: 'synthetic.gpap', sha256: 'synthetic-test' })
      expect(project.notes).toHaveLength(3)
      expect(project.tracks).toHaveLength(0)
      expect(project.images).toHaveLength(0)
      expect(project.issues).toEqual([])
      const first = project.notes[0]
      expect(first.row).toMatchObject({ lon: -123, lat: 54, altim: 765.25, ts: Date.parse(exportedAt), isdirty: 1 })
      expect(JSON.parse(String(first.fields.find((field) => field.key === 'source_properties_json')?.value))).toEqual(
        data.features[0].properties,
      )
      expect(JSON.parse(String(first.fields.find((field) => field.key === 'source_feature_id')?.value))).toBe(
        'original-string-id',
      )
      expect(first.extension[0]).toMatchObject({ noteid: 1, color: '#FF123456', marker: 'mapMarker' })
      expect(result.summary.idMap).toEqual([
        { noteId: 1, layerId: 'source-layer-7', featureIndex: 0, featureId: 'original-string-id', pointIndex: 0 },
        { noteId: 2, layerId: 'source-layer-7', featureIndex: 1, featureId: 0, pointIndex: 0 },
        { noteId: 3, layerId: 'source-layer-7', featureIndex: 1, featureId: 0, pointIndex: 1 },
      ])
    } finally {
      db.close()
    }
  })
  it('labels missing elevations and export time, retaining non-point features as companion-map requirements', () => {
    const result = writeSmashProject(SQL, {
      name: 'Point notes',
      exportedAt,
      layers: [{ id: 'layer', name: 'Layer', data }],
    })
    expect(result.summary).toMatchObject({
      noteCount: 3,
      missingElevationCount: 2,
      featureCount: 3,
      mapOnlyFeatureCount: 1,
    })
    expect(result.summary.warnings.join(' ')).toContain('not a measured height')
    expect(result.summary.warnings.join(' ')).toContain('not a survey observation')
    const db = new SQL.Database(result.bytes)
    try {
      const project = parseGpapDatabase(db, { name: 'points.gpap', sha256: 'synthetic' })
      expect(project.notes[1].row.altim).toBe(-1)
      expect(project.notes[1].fields.find((field) => field.key === 'source_elevation_status')?.value).toContain(
        'Not supplied',
      )
      expect(project.notes[1].fields.find((field) => field.key === 'source_feature_id')?.value).toBe('0')
    } finally {
      db.close()
    }
  })
  it('supports an empty native notebook with polygon GIS companions and rejects invalid coordinates', () => {
    const result = writeSmashProject(SQL, {
      name: 'Polygon field project',
      layers: [{ id: 'area', name: 'Area', data: { type: 'FeatureCollection', features: [data.features[2]] } }],
    })
    expect(result.summary.noteCount).toBe(0)
    expect(result.summary.mapOnlyFeatureCount).toBe(1)
    const db = new SQL.Database(result.bytes)
    try {
      expect(parseGpapDatabase(db, { name: 'empty.gpap', sha256: 'synthetic' }).notes).toEqual([])
    } finally {
      db.close()
    }
    expect(() =>
      writeSmashProject(SQL, {
        name: 'Bad coordinates',
        layers: [
          {
            id: 'bad',
            name: 'Bad',
            data: {
              type: 'FeatureCollection',
              features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [999, 54] } }],
            },
          },
        ],
      }),
    ).toThrow('outside longitude/latitude')
  })
})
