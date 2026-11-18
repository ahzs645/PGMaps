/**
 * What Save & export's preview shows for a file that is not text: the downloaded bytes read back, never a summary
 * kept beside them. A GeoPackage is reopened with SQLite and its tables, columns and first rows listed; a KMZ shows
 * its `doc.kml`; a ZIP lists its files with each table's fields and record count (dBase) and each small text file
 * (README, `.prj`, `.mtl`, the head of an `.obj`); a glTF binary its header and node names; an STL its header and
 * triangle count. What could not be read says so.
 *
 * sql.js is passed in. No DOM or network access.
 */
import { strFromU8, unzipSync } from 'fflate'
import type { SqlJsStatic } from 'sql.js'

/** How the preview reads a file back, by its type. */
export type FileReadBack = 'geopackage' | 'kmz' | 'zip' | 'glb' | 'stl'

/** First rows a GeoPackage table shows. */
export const PREVIEW_ROWS = 5
/** Lines of an `.obj` shown. */
const OBJ_LINES = 30
/** Text files shown whole up to this many characters. */
const TEXT_CHARS = 4000

const kb = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1_048_576
      ? `${(bytes / 1024).toFixed(1)} kB`
      : `${(bytes / 1_048_576).toFixed(1)} MB`

/** The read-back for a file's media type, or null for one the dialog shows as it shows any other. */
export function readBackFor(mime: string, hint?: FileReadBack): FileReadBack | null {
  if (hint) return hint
  if (mime === 'application/geopackage+sqlite3') return 'geopackage'
  if (mime === 'application/vnd.google-earth.kmz') return 'kmz'
  if (mime === 'model/gltf-binary') return 'glb'
  if (mime === 'model/stl') return 'stl'
  return null
}

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`

/** A GeoPackage reopened: each feature table with its geometry type, its count, its columns and first rows. */
export function geoPackagePreview(SQL: SqlJsStatic, bytes: Uint8Array): string {
  const db = new SQL.Database(bytes)
  try {
    const lines: string[] = []
    const app = db.exec('PRAGMA application_id')[0]?.values[0]?.[0]
    lines.push(`GeoPackage, ${kb(bytes.length)}${app === 0x47504b47 ? '' : ' (no GeoPackage application id)'}`)
    const contents = db.exec(
      "SELECT c.table_name, c.identifier, c.description, g.geometry_type_name, g.srs_id FROM gpkg_contents c LEFT JOIN gpkg_geometry_columns g ON g.table_name = c.table_name WHERE c.data_type = 'features' ORDER BY c.rowid",
    )[0]
    const tables = contents?.values ?? []
    lines.push(`${tables.length} layer${tables.length === 1 ? '' : 's'}`)
    const styled = new Set(
      (() => {
        try {
          return (db.exec('SELECT f_table_name FROM layer_styles WHERE useAsDefault')[0]?.values ?? []).map((row) =>
            String(row[0]),
          )
        } catch {
          return []
        }
      })(),
    )
    for (const [table, identifier, description, geometryType, srs] of tables) {
      const name = String(table)
      const count = Number(db.exec(`SELECT count(*) FROM ${quoteIdent(name)}`)[0]?.values[0]?.[0] ?? 0)
      const columns = (db.exec(`PRAGMA table_info(${quoteIdent(name)})`)[0]?.values ?? []).map((row) => ({
        name: String(row[1]),
        type: String(row[2]),
      }))
      const shown = columns.filter((column) => column.name !== 'geom')
      lines.push(
        '',
        `${String(identifier ?? name)} (table ${name}): ${count} ${String(geometryType ?? 'feature').toLowerCase()} feature${count === 1 ? '' : 's'}, EPSG:${String(srs ?? '?')}${styled.has(name) ? ', QGIS default style' : ''}`,
      )
      if (description) lines.push(`  ${String(description)}`)
      lines.push(`  Columns: ${shown.map((column) => `${column.name} ${column.type}`).join(', ')}`)
      const rows = db.exec(
        `SELECT ${shown.map((column) => quoteIdent(column.name)).join(', ')} FROM ${quoteIdent(name)} LIMIT ${PREVIEW_ROWS}`,
      )[0]
      for (const row of rows?.values ?? [])
        lines.push(
          `  · ${row
            .map((value, index) => `${shown[index].name}=${value === null ? '' : String(value)}`)
            .filter((cell) => !cell.endsWith('='))
            .join('; ')}`,
        )
      if (count > PREVIEW_ROWS) lines.push(`  … ${count - PREVIEW_ROWS} more`)
    }
    return lines.join('\n')
  } finally {
    db.close()
  }
}

/** A dBase table's record count and fields, from its header. */
export function dbfSummary(bytes: Uint8Array): string {
  if (bytes.length < 32) return 'not a dBase table'
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const records = view.getUint32(4, true)
  const headerLength = view.getUint16(8, true)
  const fields: string[] = []
  for (let offset = 32; offset + 32 <= Math.min(headerLength, bytes.length) && bytes[offset] !== 0x0d; offset += 32) {
    let end = offset
    while (end < offset + 11 && bytes[end] !== 0) end++
    const name = strFromU8(bytes.subarray(offset, end))
    const type = String.fromCharCode(bytes[offset + 11])
    const length = bytes[offset + 16]
    const decimals = bytes[offset + 17]
    fields.push(`${name} ${type}(${length}${type === 'N' && decimals ? `,${decimals}` : ''})`)
  }
  return `${records} record${records === 1 ? '' : 's'}; fields ${fields.join(', ')}`
}

/** A ZIP's files, with what each table holds and the small text files' text. */
export function zipPreview(bytes: Uint8Array): string {
  const files = unzipSync(bytes)
  const paths = Object.keys(files)
  const lines = [`ZIP, ${kb(bytes.length)}, ${paths.length} file${paths.length === 1 ? '' : 's'}`, '']
  for (const path of paths) lines.push(`${path} (${kb(files[path].length)})`)
  for (const path of paths) {
    const lower = path.toLowerCase()
    const data = files[path]
    if (lower.endsWith('.dbf')) lines.push('', `${path}: ${dbfSummary(data)}`)
    else if (lower.endsWith('.obj')) {
      const text = strFromU8(data).split('\n')
      lines.push(
        '',
        `${path}, first ${Math.min(OBJ_LINES, text.length)} of ${text.length} lines:`,
        ...text.slice(0, OBJ_LINES),
      )
    } else if (/\.(txt|prj|cpg|mtl)$/.test(lower)) {
      const text = strFromU8(data)
      lines.push('', `${path}:`, text.length > TEXT_CHARS ? `${text.slice(0, TEXT_CHARS)}\n…` : text)
    }
  }
  return lines.join('\n')
}

/** A KMZ: its files, then its `doc.kml` as written. */
export function kmzPreview(bytes: Uint8Array): string {
  const files = unzipSync(bytes)
  const paths = Object.keys(files)
  const kml = files['doc.kml']
  return [
    `KMZ, ${kb(bytes.length)}: ${paths.map((path) => `${path} (${kb(files[path].length)})`).join(', ')}`,
    '',
    kml ? strFromU8(kml) : 'No doc.kml in the archive.',
  ].join('\n')
}

/** A glTF binary's header, its parts by name with their triangles, and the notes it carries. */
export function glbPreview(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 20 || view.getUint32(0, true) !== 0x46546c67) return 'Not a glTF binary: its header does not read.'
  const version = view.getUint32(4, true)
  const jsonLength = view.getUint32(12, true)
  const gltf = JSON.parse(strFromU8(bytes.subarray(20, 20 + jsonLength))) as {
    asset?: { generator?: string }
    nodes?: Array<{ name?: string; mesh?: number }>
    meshes?: Array<{ primitives: Array<{ indices?: number; attributes: Record<string, number> }> }>
    accessors?: Array<{ count: number }>
    extras?: Record<string, unknown>
  }
  const triangles = (mesh: number | undefined) =>
    mesh === undefined
      ? 0
      : (gltf.meshes?.[mesh]?.primitives ?? []).reduce((sum, primitive) => {
          const accessor = primitive.indices ?? primitive.attributes.POSITION
          return sum + Math.floor((gltf.accessors?.[accessor]?.count ?? 0) / 3)
        }, 0)
  // The parts: nodes with a mesh (the root node only groups them).
  const nodes = (gltf.nodes ?? []).filter((node) => node.mesh !== undefined)
  const total = nodes.reduce((sum, node) => sum + triangles(node.mesh), 0)
  return [
    `glTF ${version} binary, ${kb(bytes.length)}, ${nodes.length} part${nodes.length === 1 ? '' : 's'}, ${total.toLocaleString('en-CA')} triangles${gltf.asset?.generator ? `, written by ${gltf.asset.generator}` : ''}`,
    '',
    ...nodes.map((node) => `${node.name ?? '(unnamed)'}: ${triangles(node.mesh).toLocaleString('en-CA')} triangles`),
    ...(gltf.extras ? ['', 'Extras:', JSON.stringify(gltf.extras, null, 2)] : []),
  ].join('\n')
}

/** A binary STL's header text and triangle count. */
export function stlPreview(bytes: Uint8Array): string {
  if (bytes.length < 84) return 'Not a binary STL: shorter than its header.'
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint32(80, true)
  const header = strFromU8(bytes.subarray(0, 80)).replace(/\0+$/, '').trim()
  return [
    `Binary STL, ${kb(bytes.length)}, ${count.toLocaleString('en-CA')} triangles${84 + count * 50 === bytes.length ? '' : ' (the size does not match the count)'}`,
    `Header: ${header}`,
  ].join('\n')
}

/** The read-back's text. */
export function readBackText(kind: FileReadBack, bytes: Uint8Array, SQL?: SqlJsStatic): string {
  switch (kind) {
    case 'geopackage':
      if (!SQL) return 'SQLite did not load, so the GeoPackage could not be reopened here.'
      return geoPackagePreview(SQL, bytes)
    case 'kmz':
      return kmzPreview(bytes)
    case 'zip':
      return zipPreview(bytes)
    case 'glb':
      return glbPreview(bytes)
    case 'stl':
      return stlPreview(bytes)
  }
}
