import type { SqlJsStatic } from 'sql.js'
import type { FeatureCollection, Position } from 'geojson'
import { loadBrowserSqlite } from './geopaparazzi'
import { normalizeGeojson, type Workspace } from './workspace'

export const SMASH_EXPORT_REFERENCES = [
  'https://github.com/geopaparazzi/smash/blob/bf104ae4e27ae50302155557798d22c7b8cc0281/lib/eu/hydrologis/smash/project/project_database.dart',
  'https://github.com/geopaparazzi/smash/blob/bf104ae4e27ae50302155557798d22c7b8cc0281/lib/eu/hydrologis/smash/forms/form_smash_utils.dart',
  'https://github.com/geopaparazzi/smashlibs/tree/9ba8a7195e5cc45e77b3476820dfa7a4073cc6c3/lib/com/hydrologis/flutterlibs/projectdb',
  'https://smash-smart-mobile-app-for-surveyors-happyness.readthedocs.io/en/latest/map_types.html',
] as const
export type SmashExportLayer = { id: string; name: string; data: FeatureCollection; color?: string }
export type SmashProjectSummary = {
  schema: 'nechako-smash-export-v1'
  createdAt: string
  name: string
  noteCount: number
  missingElevationCount: number
  featureCount: number
  mapOnlyFeatureCount: number
  idMap: {
    noteId: number
    layerId: string
    featureIndex: number
    featureId: string | number | null
    pointIndex: number
  }[]
  warnings: string[]
  references: readonly string[]
}
export type SmashProjectInput = {
  name: string
  layers: SmashExportLayer[]
  exportedAt?: string
  camera?: Workspace['camera']
}

// These ordinary SQLite table/column definitions implement the pinned SMASH file format.
// No native application code or initialization logic is bundled with the browser.
const schema = `
CREATE TABLE notes (_id INTEGER PRIMARY KEY AUTOINCREMENT, lon REAL NOT NULL, lat REAL NOT NULL, altim REAL NOT NULL, ts LONG NOT NULL, description TEXT, text TEXT NOT NULL, form CLOB, style TEXT, isdirty INTEGER);
CREATE TABLE notesext (_id INTEGER PRIMARY KEY AUTOINCREMENT, noteid INTEGER NOT NULL, marker TEXT NOT NULL, size REAL NOT NULL, rotation REAL NOT NULL, color TEXT NOT NULL, accuracy REAL, heading REAL, speed REAL, speedaccuracy REAL);
CREATE TABLE gpslogs (_id INTEGER PRIMARY KEY AUTOINCREMENT, startts LONG NOT NULL, endts LONG NOT NULL, lengthm REAL NOT NULL, isdirty INTEGER NOT NULL, text TEXT NOT NULL, parentlogid INTEGER);
CREATE TABLE gpslogsdata (_id INTEGER PRIMARY KEY AUTOINCREMENT, lon REAL NOT NULL, lat REAL NOT NULL, altim REAL NOT NULL, ts LONG NOT NULL, logid INTEGER NOT NULL REFERENCES gpslogs(_id) ON DELETE CASCADE, accuracy REAL, filtered_accuracy REAL, filtered_lat REAL, filtered_lon REAL);
CREATE TABLE gpslogsproperties (_id INTEGER PRIMARY KEY AUTOINCREMENT, logid INTEGER NOT NULL REFERENCES gpslogs(_id) ON DELETE CASCADE, color TEXT NOT NULL, width REAL NOT NULL, visible INTEGER NOT NULL, keywords TEXT);
CREATE TABLE bookmarks (_id INTEGER PRIMARY KEY AUTOINCREMENT, lon REAL NOT NULL, lat REAL NOT NULL, zoom REAL NOT NULL, text TEXT NOT NULL);
CREATE TABLE images (_id INTEGER PRIMARY KEY AUTOINCREMENT, lon REAL NOT NULL, lat REAL NOT NULL, altim REAL NOT NULL, azim REAL NOT NULL, imagedata_id INTEGER NOT NULL REFERENCES imagedata(_id) ON DELETE CASCADE, ts LONG NOT NULL, text TEXT NOT NULL, note_id INTEGER, isdirty INTEGER NOT NULL);
CREATE TABLE imagedata (_id INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, thumbnail BLOB NOT NULL);
CREATE TABLE metadata (key TEXT NOT NULL, label TEXT, value TEXT NOT NULL);
CREATE INDEX notes_ts_idx ON notes(ts);
CREATE INDEX notes_x_by_y_idx ON notes(lon, lat);
CREATE INDEX notes_isdirty_idx ON notes(isdirty);
CREATE INDEX notesext_noteidx ON notesext(noteid);
CREATE INDEX gpslog_id_idx ON gpslogsdata(logid);
CREATE INDEX gpslog_ts_idx ON gpslogsdata(ts);
CREATE INDEX gpslog_x_by_y_idx ON gpslogsdata(lon, lat);
CREATE INDEX gpslog_logid_x_y_idx ON gpslogsdata(logid, lon, lat);
CREATE INDEX gpslogs_parent_idx ON gpslogs(parentlogid);
CREATE INDEX gpslogs_parent_startts_idx ON gpslogs(parentlogid, startts);
CREATE INDEX bookmarks_x_by_y_idx ON bookmarks(lat, lon);
CREATE INDEX images_ts_idx ON images(ts);
CREATE INDEX images_noteid_idx ON images(note_id);
CREATE INDEX images_isdirty_idx ON images(isdirty);
CREATE INDEX images_x_by_y_idx ON images(lat, lon);
`
const formFields = [
  { key: 'source_layer_id', label: 'Original layer ID', type: 'string' },
  { key: 'source_feature_id', label: 'Original feature ID (JSON)', type: 'string' },
  { key: 'source_feature_index', label: 'Original feature index (zero based)', type: 'integer' },
  { key: 'source_point_index', label: 'Original multipoint index (zero based)', type: 'integer' },
  { key: 'source_properties_json', label: 'Original properties (complete JSON)', type: 'stringarea' },
  { key: 'source_elevation_status', label: 'Source elevation status', type: 'string' },
  { key: 'copy_created_at', label: 'Exported copy creation time (UTC, not observation time)', type: 'string' },
] as const
function section(name: string, values: Record<string, string>) {
  return {
    sectionname: name,
    sectiondescription:
      'Point features exported by PGMaps. Original attributes and IDs are preserved in these fields and in the companion GIS data.',
    forms: [
      {
        formname: 'Source feature',
        formitems: formFields.map((field) => ({ ...field, value: values[field.key] ?? '' })),
      },
    ],
  }
}
/** Creates a native point-note project. Lines/polygons remain GIS layers; no artificial survey tracks are created. */
export function writeSmashProject(SQL: SqlJsStatic, input: SmashProjectInput) {
  const name = input.name.trim()
  if (!name || name.length > 200) throw new Error('Enter a SMASH project name of 1–200 characters.')
  const createdAt = input.exportedAt ?? new Date().toISOString()
  const timestamp = Date.parse(createdAt)
  if (!Number.isSafeInteger(timestamp)) throw new Error('Invalid project creation time.')
  const layers = input.layers.map((layer) => ({ ...layer, data: normalizeGeojson(layer.data) }))
  const summary: SmashProjectSummary = {
    schema: 'nechako-smash-export-v1',
    name,
    createdAt,
    noteCount: 0,
    missingElevationCount: 0,
    featureCount: layers.reduce((total, layer) => total + layer.data.features.length, 0),
    mapOnlyFeatureCount: 0,
    idMap: [],
    references: SMASH_EXPORT_REFERENCES,
    warnings: [
      'This is a new native SMASH project containing point notes. Numeric native note IDs are newly allocated; the original layer IDs, feature IDs and multipoint positions are preserved in the note forms and ID map.',
      'Note timestamps describe when this exported copy was created, not a survey observation. Original timestamp attributes remain unchanged in source_properties_json and the companion GIS layers.',
      'Lines, polygons, geometry collections and features without geometry remain in companion GIS layers. No GPS tracks or observation times are invented.',
      'Staged attachments and their relationships remain in the workbench archive. They are not automatically attached to these newly created native notes; original GPAP projects retain their existing native media relationships.',
      'Native note markers use the SMASH marker model. Full PGMaps vector styling is retained in companion style JSON and supported SLD sidecars.',
    ],
  }
  const db = new SQL.Database()
  try {
    db.run('PRAGMA foreign_keys=ON; BEGIN TRANSACTION;')
    db.run(schema)
    const metadata = db.prepare('INSERT INTO metadata (key,label,value) VALUES (?,?,?)')
    try {
      for (const [key, label, value] of [
        ['name', 'Project name', name],
        ['description', 'Project description', 'Browser-local PGMaps point-note export with companion GIS layers.'],
        ['notes', 'Notes', summary.warnings.join('\n')],
        ['pgmaps_exported_at', 'Export copy creation time (UTC)', createdAt],
      ])
        metadata.run([key, label, value])
    } finally {
      metadata.free()
    }
    const note = db.prepare(
      'INSERT INTO notes (lon,lat,altim,ts,description,text,form,style,isdirty) VALUES (?,?,?,?,?,?,?,?,?)',
    )
    const extension = db.prepare('INSERT INTO notesext (noteid,marker,size,rotation,color) VALUES (?,?,?,?,?)')
    try {
      for (const layer of layers) {
        for (let featureIndex = 0; featureIndex < layer.data.features.length; featureIndex++) {
          const feature = layer.data.features[featureIndex]
          const points: Position[] =
            feature.geometry?.type === 'Point'
              ? [feature.geometry.coordinates]
              : feature.geometry?.type === 'MultiPoint'
                ? feature.geometry.coordinates
                : []
          if (!points.length) summary.mapOnlyFeatureCount++
          for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
            if (summary.noteCount >= 25000)
              throw new Error(
                'Native SMASH export supports up to 25,000 point notes. Use the companion GIS export for larger layers.',
              )
            const coordinates = points[pointIndex]
            const elevation = coordinates.length > 2 ? coordinates[2] : undefined
            if (elevation === undefined) summary.missingElevationCount++
            const values = {
              source_layer_id: layer.id,
              source_feature_id: JSON.stringify(feature.id ?? null),
              source_feature_index: String(featureIndex),
              source_point_index: String(pointIndex),
              source_properties_json: JSON.stringify(feature.properties),
              source_elevation_status:
                elevation === undefined
                  ? 'Not supplied; native altim uses the documented SMASH -1 fallback.'
                  : 'Supplied as the source GeoJSON third coordinate; vertical datum is unchanged.',
              copy_created_at: createdAt,
            }
            const label = `${layer.name} · ${feature.id ?? featureIndex + 1}${points.length > 1 ? ` · point ${pointIndex + 1}` : ''}`
            note.run([
              coordinates[0],
              coordinates[1],
              elevation ?? -1,
              timestamp,
              'PGMaps exported point; timestamp is copy creation time.',
              label,
              JSON.stringify(section(layer.name, values)),
              null,
              1,
            ])
            const noteId = Number(db.exec('SELECT last_insert_rowid()')[0].values[0][0])
            const color = layer.color && /^#[a-f0-9]{6}$/i.test(layer.color) ? layer.color : '#0f766e'
            extension.run([noteId, 'mapMarker', 36, 0, `#FF${color.slice(1)}`])
            summary.noteCount++
            summary.idMap.push({ noteId, layerId: layer.id, featureIndex, featureId: feature.id ?? null, pointIndex })
          }
        }
      }
    } finally {
      note.free()
      extension.free()
    }
    if (input.camera) {
      const { center, zoom } = input.camera
      if (
        !center.every(Number.isFinite) ||
        Math.abs(center[0]) > 180 ||
        Math.abs(center[1]) > 90 ||
        !Number.isFinite(zoom)
      )
        throw new Error('Invalid project map bookmark.')
      db.run('INSERT INTO bookmarks (lon,lat,zoom,text) VALUES (?,?,?,?)', [
        center[0],
        center[1],
        zoom,
        `${name} — exported map view`,
      ])
    }
    if (summary.missingElevationCount)
      summary.warnings.push(
        `${summary.missingElevationCount} notes have no source elevation. Native altim is -1, following SMASH’s missing-position fallback; this is not a measured height.`,
      )
    db.run('UPDATE metadata SET value=? WHERE key=?', [summary.warnings.join('\n'), 'notes'])
    db.run('COMMIT;')
    const integrity = db.exec('PRAGMA integrity_check')[0]?.values[0]?.[0]
    if (integrity !== 'ok' || db.exec('PRAGMA foreign_key_check').length)
      throw new Error('The generated native project failed SQLite validation.')
    return { bytes: db.export(), summary, formDefinitions: layers.map((layer) => section(layer.name, {})) }
  } finally {
    db.close()
  }
}
export async function createSmashProject(input: SmashProjectInput) {
  const result = writeSmashProject(await loadBrowserSqlite(), input)
  return { ...result, blob: new Blob([Uint8Array.from(result.bytes).buffer], { type: 'application/x-sqlite3' }) }
}
