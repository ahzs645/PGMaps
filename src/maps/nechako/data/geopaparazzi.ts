import type { Database, SqlJsStatic } from 'sql.js'
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'
import { parseImportJson, sha256Bytes, importFilename } from './importValues'

/** Schema references are pinned to the official Geopaparazzi and SMASH models. */
export const GPAP_SCHEMA_REFERENCES = [
  'https://github.com/geopaparazzi/geopaparazzi/blob/d84a48fd31e4fa12f43d320ec7d48df7a6d52a37/geopaparazzi_library/src/main/java/eu/geopaparazzi/library/database/TableDescriptions.java',
  'https://github.com/geopaparazzi/smashlibs/tree/9ba8a7195e5cc45e77b3476820dfa7a4073cc6c3/lib/com/hydrologis/flutterlibs/projectdb',
  'https://github.com/geopaparazzi/smashlibs/blob/9ba8a7195e5cc45e77b3476820dfa7a4073cc6c3/lib/com/hydrologis/flutterlibs/forms/forms.dart',
] as const
export type GpapValue = string | number | null | { binaryBytes: number }
export type GpapRow = Record<string, GpapValue>
export type GpapIssue = { code: string; table: string; id?: string; message: string }
export type GpapField = { path: string; key: string; type: string; value: unknown; original: Record<string, unknown> }
export type GpapNote = {
  id: string
  row: GpapRow
  formRaw: string | null
  form?: unknown
  formName: string
  fields: GpapField[]
  imageIds: string[]
  extension: GpapRow[]
  feature: Feature
  issues: string[]
}
export type GpapImage = {
  id: string
  noteId: string | null
  imageDataId: string | null
  row: GpapRow
  bytes?: Uint8Array
  thumbnail?: Uint8Array
  mime: string
  filename: string
  feature: Feature
}
export type GpapTrack = {
  id: string
  parentId: string | null
  row: GpapRow
  points: GpapRow[]
  properties: GpapRow[]
  feature: Feature
  filteredFeature?: Feature
}
export type GpapRelationship = {
  fromTable: string
  fromId: string
  toTable: string
  toId: string
  role: string
  resolved: boolean
}
export type GpapProject = {
  schema: 'nechako-gpap-review-v1'
  name: string
  sha256: string
  metadata: GpapRow[]
  tables: { name: string; columns: string[]; count: number; parsed: boolean }[]
  notes: GpapNote[]
  images: GpapImage[]
  tracks: GpapTrack[]
  orphanTrackPoints: GpapRow[]
  relationships: GpapRelationship[]
  issues: GpapIssue[]
}
const TABLES = ['metadata', 'notes', 'notesext', 'images', 'imagedata', 'gpslogs', 'gpslogsdata', 'gpslogsproperties']
const MAX_ROWS = 100000
let sql: Promise<SqlJsStatic> | undefined
export function loadBrowserSqlite(): Promise<SqlJsStatic> {
  sql ??= Promise.all([import('sql.js'), import('sql.js/dist/sql-wasm.wasm?url')])
    .then(([module, wasm]) => module.default({ locateFile: () => wasm.default }))
    .catch((error) => {
      sql = undefined
      throw error
    })
  return sql
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): string => (value === null || value === undefined ? '' : String(value))
const id = (value: unknown): string | null =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' ? String(value) : null
const number = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const quote = (value: string) => `"${value.replace(/"/g, '""')}"`
function jsonValue(value: unknown): GpapValue {
  if (typeof value === 'bigint')
    return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(value)
      : String(value)
  if (value instanceof Uint8Array) return { binaryBytes: value.byteLength }
  if (value === null || typeof value === 'string' || typeof value === 'number') return value
  throw new Error('Unsupported SQLite value in the project.')
}
function readRows(db: Database, table: string, columns?: string[]) {
  const statement = db.prepare(
    `SELECT ${columns?.map(quote).join(',') || '*'} FROM ${quote(table)} LIMIT ${MAX_ROWS + 1}`,
  )
  const rows: Record<string, unknown>[] = []
  try {
    while (statement.step()) {
      // BigInt is essential: SQLite IDs can exceed JavaScript's exact integer range.
      // @types/sql.js omits the second argument supported by the pinned runtime.
      rows.push(
        (
          statement as unknown as {
            getAsObject(params: undefined, config: { useBigInt: true }): Record<string, unknown>
          }
        ).getAsObject(undefined, { useBigInt: true }),
      )
      if (rows.length > MAX_ROWS)
        throw new Error(
          `${table} exceeds the ${MAX_ROWS.toLocaleString()}-row browser limit; no partial import was created.`,
        )
    }
  } finally {
    statement.free()
  }
  return rows
}
function point(row: GpapRow, longitude = 'lon', latitude = 'lat'): Position | null {
  const lon = number(row[longitude]),
    lat = number(row[latitude])
  if (lon === null || lat === null || Math.abs(lon) > 180 || Math.abs(lat) > 90) return null
  const elevation = number(row.altim)
  return elevation === null ? [lon, lat] : [lon, lat, elevation]
}
function feature(row: GpapRow, recordId: string): Feature {
  const coordinates = point(row)
  return {
    type: 'Feature',
    id: recordId,
    geometry: coordinates ? { type: 'Point', coordinates } : null,
    properties: { ...row },
  } as Feature
}
function mediaType(bytes?: Uint8Array): { mime: string; extension: string } {
  if (bytes?.[0] === 0xff && bytes?.[1] === 0xd8) return { mime: 'image/jpeg', extension: 'jpg' }
  if (bytes?.[0] === 0x89 && bytes?.[1] === 0x50 && bytes?.[2] === 0x4e && bytes?.[3] === 0x47)
    return { mime: 'image/png', extension: 'png' }
  if (bytes && new TextDecoder().decode(bytes.subarray(0, 3)) === 'GIF') return { mime: 'image/gif', extension: 'gif' }
  if (bytes && new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP')
    return { mime: 'image/webp', extension: 'webp' }
  return { mime: 'application/octet-stream', extension: 'bin' }
}

/** Keep scoped field paths; duplicate keys never overwrite an earlier form value. */
export function gpapFormFields(form: unknown): { fields: GpapField[]; imageIds: string[]; issues: string[] } {
  const fields: GpapField[] = [],
    imageIds: string[] = [],
    issues: string[] = []
  const walk = (value: unknown, path: string, depth: number) => {
    if (depth > 20) throw new Error('The form nesting exceeds the supported depth.')
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}/${index}`, depth + 1))
      return
    }
    if (!object(value)) return
    if (Array.isArray(value.formitems)) {
      const seen = new Set<string>()
      value.formitems.forEach((item, index) => {
        if (!object(item) || typeof item.key !== 'string') {
          issues.push(`Unrecognized form item at ${path}/formitems/${index}. Original JSON retained.`)
          return
        }
        if (seen.has(item.key)) issues.push(`Repeated form key ${item.key} at ${path}; scoped paths keep both values.`)
        seen.add(item.key)
        const type = text(item.type)
        const fieldPath = `${path}/formitems/${index}/${item.key}`
        fields.push({ path: fieldPath, key: item.key, type, value: item.value, original: item })
        if (fields.length > 5000) throw new Error('A note contains more than 5,000 form fields.')
        if (['pictures', 'imagelib', 'sketch', 'map'].includes(type) && typeof item.value === 'string') {
          for (const value of type === 'map' ? [item.value] : item.value.split(';'))
            if (value.trim()) imageIds.push(value.trim())
        }
      })
    }
    for (const [key, item] of Object.entries(value))
      if (key !== 'formitems' && (Array.isArray(item) || object(item))) walk(item, `${path}/${key}`, depth + 1)
  }
  walk(form, '', 0)
  return { fields, imageIds: [...new Set(imageIds)], issues }
}

function rowsById<T>(rows: T[], key: (row: T) => string | null): Map<string, T[]> {
  const index = new Map<string, T[]>()
  for (const row of rows) {
    const value = key(row)
    if (value === null) continue
    const group = index.get(value)
    if (group) group.push(row)
    else index.set(value, [row])
  }
  return index
}

/** Reads only ordinary known tables. Unknown tables remain in the original database. */
export function parseGpapDatabase(db: Database, source: { name: string; sha256: string }): GpapProject {
  db.run('PRAGMA query_only = ON; PRAGMA trusted_schema = OFF;')
  const catalog = db.exec("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")[0]
  const definitions = catalog?.values.map((row) => ({ name: String(row[0]), sql: String(row[1]) })) ?? []
  if (!definitions.some((table) => ['notes', 'images', 'gpslogs'].includes(table.name)))
    throw new Error(
      'This SQLite database has no recognized GPAP notes, images or GPS log tables. Use the GIS importer for GeoPackage or SpatiaLite.',
    )
  const tables: GpapProject['tables'] = []
  const raw = new Map<string, Record<string, unknown>[]>()
  for (const definition of definitions) {
    if (!TABLES.includes(definition.name)) {
      tables.push({ name: definition.name, columns: [], count: -1, parsed: false })
      continue
    }
    if (/CREATE\s+VIRTUAL\s+TABLE/i.test(definition.sql))
      throw new Error(`Virtual table ${definition.name} is not a supported GPAP table.`)
    const columns =
      db.exec(`PRAGMA table_info(${quote(definition.name)})`)[0]?.values.map((row) => String(row[1])) ?? []
    const rows = readRows(db, definition.name)
    raw.set(definition.name, rows)
    tables.push({ name: definition.name, columns, count: rows.length, parsed: true })
  }
  for (const name of ['notes', 'images', 'gpslogs', 'gpslogsdata']) {
    const table = tables.find((table) => table.name === name)
    if (table && !table.columns.includes('_id')) throw new Error(`The ${name} table is missing its source _id column.`)
  }
  const plain = (table: string) =>
    (raw.get(table) ?? []).map((row) =>
      Object.fromEntries(Object.entries(row).map(([key, value]) => [key, jsonValue(value)])),
    )
  const issues: GpapIssue[] = []
  const relationships: GpapRelationship[] = []
  const identify = (table: string, rows: GpapRow[]) => {
    const seen = new Set<string>()
    return rows.map((row, index) => {
      const sourceId = id(row._id)
      if (sourceId === null)
        issues.push({ code: 'missing-id', table, message: `${table} row ${index + 1} has no source ID.` })
      const result = sourceId ?? `missing-row-${index + 1}`
      if (seen.has(result))
        issues.push({
          code: 'duplicate-id',
          table,
          id: result,
          message: `${table} repeats source ID ${result}; records remain separate and must be reviewed.`,
        })
      seen.add(result)
      return result
    })
  }
  const noteRows = plain('notes'),
    imageRows = plain('images'),
    logRows = plain('gpslogs')
  const noteIds = identify('notes', noteRows),
    imageIds = identify('images', imageRows),
    logIds = identify('gpslogs', logRows)
  const noteSet = new Set(noteIds),
    imageSet = new Set(imageIds),
    logSet = new Set(logIds)
  const imageData = raw.get('imagedata') ?? []
  identify('imagedata', plain('imagedata'))
  const imageDataById = rowsById(imageData, (row) => id(row._id))
  const noteExtension = plain('notesext')
  const extensionsByNote = rowsById(noteExtension, (row) => id(row.noteid))
  const notes = noteRows.map((row, index): GpapNote => {
    const noteId = noteIds[index]
    const result: GpapNote = {
      id: noteId,
      row,
      formRaw: typeof row.form === 'string' ? row.form : null,
      formName: 'Simple notes',
      fields: [],
      imageIds: [],
      extension: extensionsByNote.get(noteId) ?? [],
      feature: feature(row, noteId),
      issues: [],
    }
    if (!result.feature.geometry)
      result.issues.push('Invalid or missing WGS84 position; this note has no mapped geometry.')
    if (result.formRaw?.trim()) {
      try {
        result.form = parseImportJson(result.formRaw)
        const parsed = gpapFormFields(result.form)
        result.fields = parsed.fields
        result.imageIds = parsed.imageIds
        result.issues.push(...parsed.issues)
        result.formName = object(result.form)
          ? text(result.form.sectionname ?? result.form.name) || 'Form notes'
          : 'Form notes'
        for (const imageId of result.imageIds)
          relationships.push({
            fromTable: 'notes',
            fromId: noteId,
            toTable: 'images',
            toId: imageId,
            role: 'form-media',
            resolved: imageSet.has(imageId),
          })
      } catch (reason) {
        result.issues.push(
          `Form JSON could not be parsed: ${reason instanceof Error ? reason.message : String(reason)}. The original is retained.`,
        )
      }
    }
    for (const message of result.issues) issues.push({ code: 'note-review', table: 'notes', id: noteId, message })
    return result
  })
  const images = imageRows.map((row, index): GpapImage => {
    const imageId = imageIds[index],
      noteId = id(row.note_id),
      imageDataId = id(row.imagedata_id)
    const candidates = imageDataById.get(imageDataId ?? '') ?? []
    // An ambiguous ID must not silently attach the first matching binary.
    const data = candidates.length === 1 ? candidates[0] : undefined
    const bytes = data?.data instanceof Uint8Array ? new Uint8Array(data.data) : undefined
    const thumbnail = data?.thumbnail instanceof Uint8Array ? new Uint8Array(data.thumbnail) : undefined
    const type = mediaType(bytes)
    if (noteId !== null)
      relationships.push({
        fromTable: 'images',
        fromId: imageId,
        toTable: 'notes',
        toId: noteId,
        role: 'note-media',
        resolved: noteSet.has(noteId),
      })
    if (imageDataId !== null)
      relationships.push({
        fromTable: 'images',
        fromId: imageId,
        toTable: 'imagedata',
        toId: imageDataId,
        role: 'image-bytes',
        resolved: candidates.length === 1,
      })
    if (!bytes)
      issues.push({
        code: 'missing-media',
        table: 'images',
        id: imageId,
        message: `Image ${imageId} has no readable image bytes.`,
      })
    return {
      id: imageId,
      noteId,
      imageDataId,
      row,
      bytes,
      thumbnail,
      mime: type.mime,
      filename: importFilename(`image-${imageId}.${type.extension}`),
      feature: feature(row, imageId),
    }
  })
  const imagesByNote = rowsById(images, (image) => image.noteId)
  for (const note of notes)
    note.imageIds = [...new Set([...note.imageIds, ...(imagesByNote.get(note.id) ?? []).map((image) => image.id)])]
  const pointRows = plain('gpslogsdata')
  identify('gpslogsdata', pointRows)
  const logProperties = plain('gpslogsproperties')
  const pointsByLog = rowsById(pointRows, (row) => id(row.logid))
  const propertiesByLog = rowsById(logProperties, (row) => id(row.logid))
  const trackGeometry = (rows: GpapRow[], filtered = false): Geometry | null => {
    const segments: Position[][] = [[]]
    for (const row of rows) {
      const position = point(row, filtered ? 'filtered_lon' : 'lon', filtered ? 'filtered_lat' : 'lat')
      if (position) segments[segments.length - 1].push(position)
      else if (segments[segments.length - 1].length) segments.push([])
    }
    const lines = segments.filter((segment) => segment.length >= 2)
    if (lines.length === 1) return { type: 'LineString', coordinates: lines[0] }
    if (lines.length > 1) return { type: 'MultiLineString', coordinates: lines }
    const positions = segments.flat()
    return positions.length === 1
      ? { type: 'Point', coordinates: positions[0] }
      : positions.length
        ? { type: 'MultiPoint', coordinates: positions }
        : null
  }
  const tracks = logRows.map((row, index): GpapTrack => {
    const logId = logIds[index],
      parentId = id(row.parentlogid)
    const points = [...(pointsByLog.get(logId) ?? [])]
    if (points.every((point) => number(point.ts) !== null)) points.sort((a, b) => Number(a.ts) - Number(b.ts))
    else if (points.length)
      issues.push({
        code: 'track-time',
        table: 'gpslogs',
        id: logId,
        message:
          'Missing or inexact track timestamps; source row order is retained without inventing observation times.',
      })
    const properties = propertiesByLog.get(logId) ?? []
    if (parentId !== null)
      relationships.push({
        fromTable: 'gpslogs',
        fromId: logId,
        toTable: 'gpslogs',
        toId: parentId,
        role: 'parent-log',
        resolved: logSet.has(parentId),
      })
    const invalid = points.filter((row) => !point(row)).length
    if (invalid)
      issues.push({
        code: 'track-position',
        table: 'gpslogs',
        id: logId,
        message: `${invalid} invalid GPS positions retained in raw points; track geometry breaks at those positions.`,
      })
    const geometry = trackGeometry(points)
    const base = { type: 'Feature', id: logId, geometry, properties: { ...row, pointCount: points.length } } as Feature
    const filtered = points.some((point) => point.filtered_lon !== undefined || point.filtered_lat !== undefined)
    return {
      id: logId,
      parentId,
      row,
      points,
      properties,
      feature: base,
      ...(filtered ? { filteredFeature: { ...base, geometry: trackGeometry(points, true) } as Feature } : {}),
    }
  })
  const orphanTrackPoints = pointRows.filter((point) => !logSet.has(id(point.logid) ?? ''))
  for (const point of pointRows)
    relationships.push({
      fromTable: 'gpslogsdata',
      fromId: id(point._id) ?? 'missing',
      toTable: 'gpslogs',
      toId: id(point.logid) ?? 'missing',
      role: 'track-point',
      resolved: logSet.has(id(point.logid) ?? ''),
    })
  for (const relation of relationships.filter((relation) => !relation.resolved))
    issues.push({
      code: 'unresolved-reference',
      table: relation.fromTable,
      id: relation.fromId,
      message: `${relation.role}: ${relation.toTable} ID ${relation.toId} was not found. The reference is retained.`,
    })
  return {
    schema: 'nechako-gpap-review-v1',
    name: source.name,
    sha256: source.sha256,
    metadata: plain('metadata'),
    tables,
    notes,
    images,
    tracks,
    orphanTrackPoints,
    relationships,
    issues,
  }
}

export async function readGpap(file: File): Promise<GpapProject> {
  if (file.size > 50 * 1024 * 1024)
    throw new Error('Import a GPAP project up to 50 MiB. Larger projects must be split in the source app.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (new TextDecoder().decode(bytes.subarray(0, 16)) !== 'SQLite format 3\0')
    throw new Error('The selected file is not an SQLite GPAP database.')
  const [SQL, sha256] = await Promise.all([loadBrowserSqlite(), sha256Bytes(bytes)])
  const db = new SQL.Database(bytes)
  try {
    return parseGpapDatabase(db, { name: file.name, sha256 })
  } finally {
    db.close()
  }
}
export function gpapLayers(project: GpapProject): { name: string; data: FeatureCollection }[] {
  return [
    {
      name: `${project.name} — notes`,
      data: { type: 'FeatureCollection' as const, features: project.notes.map((note) => note.feature) },
    },
    {
      name: `${project.name} — images`,
      data: { type: 'FeatureCollection' as const, features: project.images.map((image) => image.feature) },
    },
    {
      name: `${project.name} — original tracks`,
      data: { type: 'FeatureCollection' as const, features: project.tracks.map((track) => track.feature) },
    },
    {
      name: `${project.name} — filtered tracks`,
      data: {
        type: 'FeatureCollection' as const,
        features: project.tracks.flatMap((track) => (track.filteredFeature ? [track.filteredFeature] : [])),
      },
    },
  ].filter((layer) => layer.data.features.length)
}
export function gpapNoteRows(notes: GpapNote[]): Record<string, unknown>[] {
  return notes.map((note) => ({
    'GPAP note ID': note.id,
    'GPAP note text': note.row.text,
    'GPAP timestamp': note.row.ts,
    ...Object.fromEntries(note.fields.map((field) => [field.path, field.value])),
  }))
}
/** JSON review excludes binary bytes; extracted media and the untouched database travel separately. */
export function gpapReviewJson(project: GpapProject): unknown {
  return {
    ...project,
    images: project.images.map(({ bytes, thumbnail, ...image }) => ({
      ...image,
      bytes: bytes?.byteLength,
      thumbnailBytes: thumbnail?.byteLength,
    })),
    publication: 'local-only',
    schemaReferences: GPAP_SCHEMA_REFERENCES,
  }
}
