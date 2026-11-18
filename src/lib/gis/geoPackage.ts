/**
 * Writes neutral layers (`layers.ts`) as one OGC GeoPackage 1.3: a feature table per layer in
 * EPSG:4326, with the required `gpkg_spatial_ref_sys`, `gpkg_contents` and `gpkg_geometry_columns`,
 * GDAL's `gpkg_ogr_contents` feature counts (kept by triggers, as GDAL keeps them), typed columns,
 * each layer's extent, and GeoPackage-binary geometry with an envelope. A field's title or
 * description, or the name it had before it was sanitised, goes in `gpkg_data_columns`, which GDAL
 * and QGIS read as the column's alias.
 *
 * A style passed per layer goes in QGIS's `layer_styles` table marked `useAsDefault`, so QGIS draws
 * the layer with it as soon as it is added; other readers ignore that table.
 *
 * No R-tree spatial index: sql.js is built without SQLite's rtree module (`CREATE VIRTUAL TABLE …
 * USING rtree` fails with "no such module"), and an index written by hand would be a table no
 * trigger keeps. QGIS, GDAL and ArcGIS Pro open a GeoPackage without one; QGIS offers to build it.
 *
 * sql.js is passed in, so this module loads no WASM itself and its tests run in Node. No DOM or
 * network access. Every value or name it cannot write as given is reported in `warnings`.
 */
import type { Database, SqlJsStatic } from 'sql.js'
import {
  assertWritableCoordinates,
  closedPolygonRings,
  featureParts,
  fieldValue,
  layerHasZ,
  layerIsMulti,
  positionsWithoutHeight,
  unlistedAttributeWarnings,
  ValueProblems,
  type GisFeature,
  type GisFieldType,
  type GisLayer,
  type GisLineFeature,
  type GisPointFeature,
  type GisPolygonFeature,
  type GisPosition,
} from './layers'

/** SQLite `application_id` of a GeoPackage: "GPKG" read as a big-endian integer. */
export const GPKG_APPLICATION_ID = 0x47504b47
/** SQLite `user_version` of GeoPackage 1.3.0. */
export const GPKG_USER_VERSION = 10300
export const GPKG_SRS_ID = 4326
export const GPKG_GEOMETRY_COLUMN = 'geom'
export const GPKG_FID_COLUMN = 'fid'
const STYLES_TABLE = 'layer_styles'

const WGS84_DEFINITION =
  'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],' +
  'AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],' +
  'UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]]'

/** Column types GDAL reads back as the same field types (BOOLEAN as a boolean subtype). */
const COLUMN_TYPE: Record<GisFieldType, string> = {
  text: 'TEXT',
  integer: 'INTEGER',
  real: 'REAL',
  boolean: 'BOOLEAN',
  date: 'DATE',
  datetime: 'DATETIME',
}

/** A layer's default style for QGIS. QGIS applies `qml`; `sld` is kept beside it for other tools. */
export interface GeoPackageLayerStyle {
  qml?: string
  sld?: string
  /** The name QGIS lists the style under. Defaults to the layer's title. */
  styleName?: string
  description?: string
}

export interface GeoPackageOptions {
  /** Default styles by layer `name` (the name given, not the table name it was written as). */
  styles?: Readonly<Record<string, GeoPackageLayerStyle>>
  /** Time stamped on every layer (`gpkg_contents.last_change`); now when not given. */
  lastChange?: Date
}

export interface GeoPackageResult {
  bytes: Uint8Array
  /** One line per value, name or geometry part not written as given. */
  warnings: string[]
  /** The table each layer was written as, in layer order. */
  tables: { layer: string; table: string }[]
}

// --- names ------------------------------------------------------------------------------------

/**
 * A name GeoPackage readers take without quoting trouble: letters, digits and `_`, starting with a
 * letter (ArcGIS refuses others), unique ignoring case (SQLite identifiers are case-insensitive).
 */
function identifier(raw: string, fallback: string, taken: Set<string>, reserved: (lower: string) => boolean) {
  let cleaned = raw
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}_]+/gu, '_')
    .replace(/^_+|_+$/g, '')
  if (!cleaned) cleaned = fallback
  if (!/^\p{L}/u.test(cleaned) || reserved(cleaned.toLowerCase())) cleaned = `${fallback}_${cleaned}`
  let candidate = cleaned
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${cleaned}_${n}`
  taken.add(candidate.toLowerCase())
  return candidate
}

const reservedTable = (lower: string) =>
  /^(gpkg|rtree|sqlite)_/.test(lower) || lower === STYLES_TABLE || lower === 'gpkgext_relations'
const reservedColumn = (lower: string) => lower === GPKG_FID_COLUMN || lower === GPKG_GEOMETRY_COLUMN

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`

// --- geometry ---------------------------------------------------------------------------------

/** A growable little-endian byte buffer. Adapted from GeoLibre's `geometry-wkb.ts` (MIT). */
class ByteWriter {
  private buffer = new Uint8Array(256)
  private view = new DataView(this.buffer.buffer)
  private length = 0
  private ensure(extra: number) {
    if (this.length + extra <= this.buffer.length) return
    let capacity = this.buffer.length * 2
    while (capacity < this.length + extra) capacity *= 2
    const next = new Uint8Array(capacity)
    next.set(this.buffer.subarray(0, this.length))
    this.buffer = next
    this.view = new DataView(this.buffer.buffer)
  }
  u8(value: number) {
    this.ensure(1)
    this.view.setUint8(this.length, value)
    this.length += 1
  }
  u32(value: number) {
    this.ensure(4)
    this.view.setUint32(this.length, value, true)
    this.length += 4
  }
  i32(value: number) {
    this.ensure(4)
    this.view.setInt32(this.length, value, true)
    this.length += 4
  }
  f64(value: number) {
    this.ensure(8)
    this.view.setFloat64(this.length, value, true)
    this.length += 8
  }
  bytes() {
    return this.buffer.slice(0, this.length)
  }
}

const WKB_TYPE = { point: 1, line: 2, polygon: 3, multipoint: 4, multiline: 5, multipolygon: 6 } as const

/** Envelope of the positions written: x, y and, when any is known, z. */
interface Envelope {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
}
const emptyEnvelope = (): Envelope => ({
  minX: Infinity,
  maxX: -Infinity,
  minY: Infinity,
  maxY: -Infinity,
  minZ: Infinity,
  maxZ: -Infinity,
})
function extend(box: Envelope, position: GisPosition) {
  box.minX = Math.min(box.minX, position[0])
  box.maxX = Math.max(box.maxX, position[0])
  box.minY = Math.min(box.minY, position[1])
  box.maxY = Math.max(box.maxY, position[1])
  if (position.length >= 3 && Number.isFinite(position[2])) {
    box.minZ = Math.min(box.minZ, position[2])
    box.maxZ = Math.max(box.maxZ, position[2])
  }
}

/**
 * ISO WKB (Z types are the 2D code + 1000, which GDAL writes and reads in GeoPackage). A height a Z
 * layer's vertex lacks is NaN, the WKB way of writing an unknown ordinate, never 0.
 */
function wkb(layer: GisLayer, feature: GisFeature, multi: boolean, hasZ: boolean, box: Envelope): Uint8Array {
  const writer = new ByteWriter()
  const zOffset = hasZ ? 1000 : 0
  const head = (type: number) => {
    writer.u8(1)
    writer.u32(type + zOffset)
  }
  const position = (p: GisPosition) => {
    extend(box, p)
    writer.f64(p[0])
    writer.f64(p[1])
    if (hasZ) writer.f64(p.length >= 3 && Number.isFinite(p[2]) ? p[2] : NaN)
  }
  const line = (points: readonly GisPosition[]) => {
    writer.u32(points.length)
    points.forEach(position)
  }
  const polygon = (rings: readonly (readonly GisPosition[])[]) => {
    const closed = closedPolygonRings(rings)
    writer.u32(closed.length)
    closed.forEach(line)
  }
  if (layer.geometry === 'point') {
    const points = (feature as GisPointFeature).points
    if (!multi) {
      head(WKB_TYPE.point)
      position(points[0])
    } else {
      head(WKB_TYPE.multipoint)
      writer.u32(points.length)
      for (const p of points) {
        head(WKB_TYPE.point)
        position(p)
      }
    }
  } else if (layer.geometry === 'line') {
    const lines = (feature as GisLineFeature).lines
    if (!multi) {
      head(WKB_TYPE.line)
      line(lines[0])
    } else {
      head(WKB_TYPE.multiline)
      writer.u32(lines.length)
      for (const part of lines) {
        head(WKB_TYPE.line)
        line(part)
      }
    }
  } else {
    const polygons = (feature as GisPolygonFeature).polygons
    if (!multi) {
      head(WKB_TYPE.polygon)
      polygon(polygons[0])
    } else {
      head(WKB_TYPE.multipolygon)
      writer.u32(polygons.length)
      for (const part of polygons) {
        head(WKB_TYPE.polygon)
        polygon(part)
      }
    }
  }
  return writer.bytes()
}

/**
 * GeoPackage binary: "GP", version 0, flags (little-endian, envelope code 1 for xy or 2 for xyz),
 * the srs id, the envelope as min/max pairs, then the WKB. A feature with no parts is SQL NULL.
 */
function geoPackageBlob(layer: GisLayer, feature: GisFeature, multi: boolean, hasZ: boolean, extent: Envelope) {
  if (!featureParts(layer, feature).length) return null
  const box = emptyEnvelope()
  const body = wkb(layer, feature, multi, hasZ, box)
  const withZ = hasZ && Number.isFinite(box.minZ)
  const envelope = withZ
    ? [box.minX, box.maxX, box.minY, box.maxY, box.minZ, box.maxZ]
    : [box.minX, box.maxX, box.minY, box.maxY]
  const blob = new Uint8Array(8 + envelope.length * 8 + body.length)
  const view = new DataView(blob.buffer)
  blob[0] = 0x47
  blob[1] = 0x50
  blob[2] = 0
  blob[3] = 0x01 | ((withZ ? 2 : 1) << 1)
  view.setInt32(4, GPKG_SRS_ID, true)
  envelope.forEach((value, i) => view.setFloat64(8 + i * 8, value, true))
  blob.set(body, 8 + envelope.length * 8)
  for (const key of ['minX', 'minY', 'minZ'] as const) extent[key] = Math.min(extent[key], box[key])
  for (const key of ['maxX', 'maxY', 'maxZ'] as const) extent[key] = Math.max(extent[key], box[key])
  return blob
}

const GEOMETRY_TYPE_NAME = {
  point: ['POINT', 'MULTIPOINT'],
  line: ['LINESTRING', 'MULTILINESTRING'],
  polygon: ['POLYGON', 'MULTIPOLYGON'],
} as const

// --- tables -----------------------------------------------------------------------------------

function createCoreTables(db: Database) {
  db.run(`PRAGMA application_id = ${GPKG_APPLICATION_ID};`)
  db.run(`PRAGMA user_version = ${GPKG_USER_VERSION};`)
  db.run(`CREATE TABLE gpkg_spatial_ref_sys (
    srs_name TEXT NOT NULL,
    srs_id INTEGER NOT NULL PRIMARY KEY,
    organization TEXT NOT NULL,
    organization_coordsys_id INTEGER NOT NULL,
    definition TEXT NOT NULL,
    description TEXT
  );`)
  const srs = db.prepare('INSERT INTO gpkg_spatial_ref_sys VALUES (?, ?, ?, ?, ?, ?);')
  try {
    srs.run(['Undefined cartesian SRS', -1, 'NONE', -1, 'undefined', 'undefined cartesian coordinate reference system'])
    srs.run(['Undefined geographic SRS', 0, 'NONE', 0, 'undefined', 'undefined geographic coordinate reference system'])
    srs.run([
      'WGS 84 geodetic',
      GPKG_SRS_ID,
      'EPSG',
      GPKG_SRS_ID,
      WGS84_DEFINITION,
      'longitude/latitude coordinates in decimal degrees on the WGS 84 spheroid',
    ])
  } finally {
    srs.free()
  }
  db.run(`CREATE TABLE gpkg_contents (
    table_name TEXT NOT NULL PRIMARY KEY,
    data_type TEXT NOT NULL,
    identifier TEXT UNIQUE,
    description TEXT DEFAULT '',
    last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    min_x DOUBLE,
    min_y DOUBLE,
    max_x DOUBLE,
    max_y DOUBLE,
    srs_id INTEGER,
    CONSTRAINT fk_gc_r_srs_id FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id)
  );`)
  db.run(`CREATE TABLE gpkg_geometry_columns (
    table_name TEXT NOT NULL,
    column_name TEXT NOT NULL,
    geometry_type_name TEXT NOT NULL,
    srs_id INTEGER NOT NULL,
    z TINYINT NOT NULL,
    m TINYINT NOT NULL,
    CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name),
    CONSTRAINT uk_gc_table_name UNIQUE (table_name),
    CONSTRAINT fk_gc_tn FOREIGN KEY (table_name) REFERENCES gpkg_contents(table_name),
    CONSTRAINT fk_gc_srs FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id)
  );`)
  db.run(`CREATE TABLE gpkg_ogr_contents (table_name TEXT NOT NULL PRIMARY KEY, feature_count INTEGER DEFAULT NULL);`)
}

/** The schema extension's tables, needed only when a column has an alias or a description. */
function createDataColumnTables(db: Database) {
  db.run(`CREATE TABLE gpkg_extensions (
    table_name TEXT,
    column_name TEXT,
    extension_name TEXT NOT NULL,
    definition TEXT NOT NULL,
    scope TEXT NOT NULL,
    CONSTRAINT ge_tce UNIQUE (table_name, column_name, extension_name)
  );`)
  db.run(`CREATE TABLE gpkg_data_columns (
    table_name TEXT NOT NULL,
    column_name TEXT NOT NULL,
    name TEXT,
    title TEXT,
    description TEXT,
    mime_type TEXT,
    constraint_name TEXT,
    CONSTRAINT pk_gdc PRIMARY KEY (table_name, column_name),
    CONSTRAINT gdc_tn UNIQUE (table_name, name)
  );`)
  db.run(`CREATE TABLE gpkg_data_column_constraints (
    constraint_name TEXT NOT NULL,
    constraint_type TEXT NOT NULL,
    value TEXT,
    min NUMERIC,
    min_is_inclusive BOOLEAN,
    max NUMERIC,
    max_is_inclusive BOOLEAN,
    description TEXT,
    CONSTRAINT gdcc_ntv UNIQUE (constraint_name, constraint_type, value)
  );`)
  for (const table of ['gpkg_data_columns', 'gpkg_data_column_constraints'])
    db.run(
      `INSERT INTO gpkg_extensions VALUES (?, NULL, 'gpkg_schema', 'http://www.geopackage.org/spec/#extension_schema', 'read-write');`,
      [table],
    )
}

/**
 * Starts a table's count at 0 and adds GDAL's triggers, so the count is right after the inserts
 * that follow and stays right when another tool edits the table.
 */
function countFeatures(db: Database, table: string) {
  db.run('INSERT INTO gpkg_ogr_contents (table_name, feature_count) VALUES (?, 0);', [table])
  const literal = table.replace(/'/g, "''")
  db.run(
    `CREATE TRIGGER ${quote(`trigger_insert_feature_count_${table}`)} AFTER INSERT ON ${quote(table)} BEGIN UPDATE gpkg_ogr_contents SET feature_count = feature_count + 1 WHERE lower(table_name) = lower('${literal}'); END;`,
  )
  db.run(
    `CREATE TRIGGER ${quote(`trigger_delete_feature_count_${table}`)} AFTER DELETE ON ${quote(table)} BEGIN UPDATE gpkg_ogr_contents SET feature_count = feature_count - 1 WHERE lower(table_name) = lower('${literal}'); END;`,
  )
}

/**
 * QGIS's `layer_styles` table as QGIS creates it. QGIS loads the default style where
 * `f_table_schema` is '' (not NULL), the table and geometry column match and `useAsDefault` is set;
 * `type` is the column QGIS 3.28 and later add, holding the layer type.
 */
function createStylesTable(db: Database, lastChange: string) {
  db.run(`CREATE TABLE ${STYLES_TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    f_table_catalog TEXT(256),
    f_table_schema TEXT(256),
    f_table_name TEXT(256),
    f_geometry_column TEXT(256),
    styleName TEXT(30),
    styleQML TEXT,
    styleSLD TEXT,
    useAsDefault BOOLEAN,
    description TEXT,
    owner TEXT(30),
    ui TEXT(30),
    update_time DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    type TEXT
  );`)
  // Registered as an attributes table, as GDAL registers it when QGIS saves a style through it.
  db.run(
    `INSERT INTO gpkg_contents (table_name, data_type, identifier, description, last_change) VALUES (?, 'attributes', ?, ?, ?);`,
    [STYLES_TABLE, STYLES_TABLE, 'Default QGIS styles of the layers in this GeoPackage', lastChange],
  )
  countFeatures(db, STYLES_TABLE)
}

/**
 * The GeoPackage of `layers`, all in EPSG:4326. A layer's geometry type is the single type
 * (POINT, LINESTRING, POLYGON) unless some feature has several parts, then the multi type for every
 * feature; its z flag is set when any vertex has a height. Throws `GisCoordinateError` for a
 * coordinate that is not a finite longitude/latitude, naming the layer and feature.
 */
export function writeGeoPackage(
  SQL: SqlJsStatic,
  layers: readonly GisLayer[],
  options: GeoPackageOptions = {},
): GeoPackageResult {
  for (const layer of layers) assertWritableCoordinates(layer)
  const warnings: string[] = []
  const lastChange = (options.lastChange ?? new Date()).toISOString()
  const styles = options.styles ?? {}
  const layerNames = new Set(layers.map((layer) => layer.name))
  for (const name of Object.keys(styles))
    if (!layerNames.has(name)) warnings.push(`Style for "${name}" left out; no layer has that name.`)
  const styled = layers.filter((layer) => styles[layer.name]?.qml || styles[layer.name]?.sld)

  const takenTables = new Set<string>()
  const identifiers = new Set<string>(styled.length ? [STYLES_TABLE] : [])
  const plans = layers.map((layer) => {
    const table = identifier(layer.name, 'layer', takenTables, reservedTable)
    if (table !== layer.name) warnings.push(`Layer "${layer.name}" written as the table "${table}".`)
    let title = layer.title ?? layer.name
    for (let n = 2; identifiers.has(title.toLowerCase()); n++) title = `${layer.title ?? layer.name} (${n})`
    identifiers.add(title.toLowerCase())
    const takenColumns = new Set([GPKG_FID_COLUMN, GPKG_GEOMETRY_COLUMN])
    const columns = layer.fields.map((field) => {
      const column = identifier(field.name, 'field', takenColumns, reservedColumn)
      if (column !== field.name)
        warnings.push(
          `${layer.name} field "${field.name}" written as the column "${column}", with its name as the alias.`,
        )
      return { field, column }
    })
    warnings.push(...unlistedAttributeWarnings(layer))
    const hasZ = layerHasZ(layer)
    if (hasZ) {
      const missing = positionsWithoutHeight(layer)
      if (missing)
        warnings.push(
          `${layer.name}: ${missing} vert${missing === 1 ? 'ex has' : 'ices have'} no height; written as NaN, unknown, in a layer with heights.`,
        )
    }
    return { layer, table, title, columns, hasZ, multi: layerIsMulti(layer) }
  })
  const aliases = plans.flatMap(({ table, columns }) =>
    columns
      .filter(({ field, column }) => field.title || field.description || column !== field.name)
      .map(({ field, column }) => ({ table, column, name: field.title ?? field.name, field })),
  )

  const db = new SQL.Database()
  try {
    createCoreTables(db)
    if (aliases.length) createDataColumnTables(db)
    if (styled.length) createStylesTable(db, lastChange)
    for (const { layer, table, title, columns, hasZ, multi } of plans) {
      const definitions = columns.map(({ field, column }) => `${quote(column)} ${COLUMN_TYPE[field.type]}`)
      db.run(
        `CREATE TABLE ${quote(table)} (${[
          `${quote(GPKG_FID_COLUMN)} INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL`,
          `${quote(GPKG_GEOMETRY_COLUMN)} ${GEOMETRY_TYPE_NAME[layer.geometry][multi ? 1 : 0]}`,
          ...definitions,
        ].join(', ')});`,
      )
      db.run(
        `INSERT INTO gpkg_contents (table_name, data_type, identifier, description, last_change, srs_id) VALUES (?, 'features', ?, ?, ?, ?);`,
        [table, title, layer.description ?? '', lastChange, GPKG_SRS_ID],
      )
      db.run('INSERT INTO gpkg_geometry_columns VALUES (?, ?, ?, ?, ?, 0);', [
        table,
        GPKG_GEOMETRY_COLUMN,
        GEOMETRY_TYPE_NAME[layer.geometry][multi ? 1 : 0],
        GPKG_SRS_ID,
        hasZ ? 1 : 0,
      ])
      countFeatures(db, table)
      const problems = new ValueProblems()
      const extent = emptyEnvelope()
      const names = [GPKG_GEOMETRY_COLUMN, ...columns.map(({ column }) => column)]
      const insert = db.prepare(
        `INSERT INTO ${quote(table)} (${names.map(quote).join(', ')}) VALUES (${names.map(() => '?').join(', ')});`,
      )
      try {
        db.run('BEGIN;')
        for (const feature of layer.features) {
          const row: (string | number | Uint8Array | null)[] = [geoPackageBlob(layer, feature, multi, hasZ, extent)]
          for (const { field } of columns) {
            const { value, problem } = fieldValue(field, feature.attributes[field.name])
            if (problem) problems.add(field.name, problem)
            row.push(typeof value === 'boolean' ? (value ? 1 : 0) : value)
          }
          insert.run(row)
        }
        db.run('COMMIT;')
      } finally {
        insert.free()
      }
      warnings.push(...problems.warnings(layer.name))
      if (Number.isFinite(extent.minX))
        db.run('UPDATE gpkg_contents SET min_x = ?, min_y = ?, max_x = ?, max_y = ? WHERE table_name = ?;', [
          extent.minX,
          extent.minY,
          extent.maxX,
          extent.maxY,
          table,
        ])
    }
    if (aliases.length) {
      const insert = db.prepare(
        'INSERT INTO gpkg_data_columns (table_name, column_name, name, title, description) VALUES (?, ?, ?, ?, ?);',
      )
      try {
        const takenNames = new Map<string, Set<string>>()
        for (const { table, column, name, field } of aliases) {
          const taken = takenNames.get(table) ?? new Set<string>()
          takenNames.set(table, taken)
          let unique = name
          for (let n = 2; taken.has(unique); n++) unique = `${name} (${n})`
          taken.add(unique)
          insert.run([table, column, unique, field.title ?? null, field.description ?? null])
        }
      } finally {
        insert.free()
      }
    }
    if (styled.length) {
      const insert = db.prepare(
        `INSERT INTO ${STYLES_TABLE} (f_table_catalog, f_table_schema, f_table_name, f_geometry_column, styleName, styleQML, styleSLD, useAsDefault, description, owner, ui, update_time, type) VALUES ('', '', ?, ?, ?, ?, ?, 1, ?, '', NULL, ?, 'vector');`,
      )
      try {
        for (const { layer, table, title } of plans) {
          const style = styles[layer.name]
          if (!style?.qml && !style?.sld) continue
          if (!style.qml)
            warnings.push(`${layer.name}: style kept as SLD only; QGIS applies a default style only from QML.`)
          insert.run([
            table,
            GPKG_GEOMETRY_COLUMN,
            style.styleName ?? title,
            style.qml ?? null,
            style.sld ?? null,
            style.description ?? '',
            lastChange,
          ])
        }
      } finally {
        insert.free()
      }
    }
    return { bytes: db.export(), warnings, tables: plans.map(({ layer, table }) => ({ layer: layer.name, table })) }
  } finally {
    db.close()
  }
}
