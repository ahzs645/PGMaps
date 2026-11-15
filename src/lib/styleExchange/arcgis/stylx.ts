/**
 * Symbol libraries as ArcGIS Pro styles (`.stylx`) and back. A style is an SQLite file; the schema,
 * the `CLASSES` and `BINARY_CLASSES` rows and the `meta` rows copy what Pro 3.2 wrote in Esri's
 * Parks.stylx and Calls.stylx (Esri/dictionary-renderer-toolkit), statement for statement. Each
 * symbol is one `ITEMS` row: CLASS 3 point, 4 line or 5 polygon symbol, the library category,
 * `;`-joined tags, the symbol's CIM JSON with compact `[r, g, b, alpha 0–255]` colours (Pro's style
 * encoding), and the symbol id as the unique KEY. sql.js is passed in, so this runs in Node and in a
 * worker alike. No DOM or network access.
 */
import type { Database, SqlJsStatic } from 'sql.js'
import {
  safeFileStem,
  type ExchangeDiagnostic,
  type LibrarySymbol,
  type ReadResult,
  type SymbolLibrary,
  type WriteResult,
} from '../model'
import { cimSymbol, sheetSymbolFromCim } from './cim'
import { CIM_BUILD, CIM_VERSION, diagnostic } from './cimCommon'

/** Pro's schema, as `sqlite_master` holds it in Esri's styles. */
export const STYLX_SCHEMA = [
  'CREATE TABLE ITEMS (ID INTEGER PRIMARY KEY, CLASS INTEGER, CATEGORY TEXT, NAME TEXT, TAGS TEXT, CONTENT TEXT, KEY TEXT UNIQUE)',
  "CREATE INDEX 'ITEMS_ID' ON 'ITEMS' (ID)",
  "CREATE INDEX 'ITEMS_CLASS' ON 'ITEMS' (CLASS)",
  "CREATE INDEX 'ITEMS_KEY' ON 'ITEMS' (KEY)",
  'CREATE TABLE CLASSES (ID INTEGER PRIMARY KEY, NAME TEXT)',
  "CREATE INDEX 'CLASSES_ID' ON 'CLASSES' (ID)",
  'CREATE TABLE meta (key TEXT, value TEXT)',
  'CREATE TABLE BINARY_CLASSES (ID INTEGER PRIMARY KEY, NAME TEXT)',
  "CREATE INDEX 'BINARY_CLASSES_ID' ON 'BINARY_CLASSES' (ID)",
  'CREATE TABLE BINARIES (ID INTEGER PRIMARY KEY, MD5 STRING UNIQUE, CLASS INTEGER, CONTENT BLOB)',
  "CREATE INDEX 'BINARIES_ID' ON 'BINARIES' (ID)",
  "CREATE INDEX 'BINARIES_MD5' ON 'BINARIES' (MD5)",
  "CREATE INDEX 'BINARIES_CLASS' ON 'BINARIES' (CLASS)",
  'CREATE TABLE STYLE_ITEM_BINARY_REFERENCES (ID INTEGER PRIMARY KEY, ITEMS_ID INTEGER NOT NULL, BINARIES_ID INTEGER NOT NULL, FOREIGN KEY(ITEMS_ID) REFERENCES ITEMS(ID), FOREIGN KEY(BINARIES_ID) REFERENCES BINARIES(ID), UNIQUE(ITEMS_ID, BINARIES_ID))',
]

export const STYLX_CLASSES = [
  'Color',
  'Color Scheme',
  'Point Symbol',
  'Line Symbol',
  'Polygon Symbol',
  'Text Symbol',
  'North Arrow',
  'Scale Bar',
  'Standard Label Placement',
  'Maplex Label Placement',
  'Grid',
  'Mesh Symbol',
  'Legend',
  'Table Frame',
  'Map Surround',
] as const

export const STYLX_META: [string, string][] = [
  ['version', '1.0'],
  ['cim_version', CIM_VERSION],
  ['build', String(CIM_BUILD)],
  ['content', 'json'],
  ['forceRGB', 'true'],
  ['vectorizeCM', 'true'],
  ['densifyCurves', 'true'],
  ['colorModel', 'RGB'],
  ['RGBColorProfile', 'sRGB IEC61966-2-1 noBPC'],
  ['CMYKColorProfile', 'U.S. Web Coated (SWOP) v2'],
  ['readonly', 'false'],
]

const POINT_CLASS = 3
const LINE_CLASS = 4
const POLYGON_CLASS = 5
const classOf = (kind: LibrarySymbol['symbol']['kind']) =>
  kind === 'point' ? POINT_CLASS : kind === 'line' ? LINE_CLASS : POLYGON_CLASS

/** `<library>.stylx` holding every symbol of the library. */
export function arcgisStylx(lib: SymbolLibrary, SQL: SqlJsStatic): WriteResult {
  const diagnostics: ExchangeDiagnostic[] = []
  const db = new SQL.Database()
  try {
    for (const statement of STYLX_SCHEMA) db.run(statement)
    STYLX_CLASSES.forEach((name, i) => db.run('INSERT INTO CLASSES (ID, NAME) VALUES (?, ?)', [i + 1, name]))
    db.run('INSERT INTO BINARY_CLASSES (ID, NAME) VALUES (1, ?)', ['GLB'])
    for (const [key, value] of STYLX_META) db.run('INSERT INTO meta (key, value) VALUES (?, ?)', [key, value])
    const keys = new Set<string>()
    const insert = db.prepare('INSERT INTO ITEMS (CLASS, CATEGORY, NAME, TAGS, CONTENT, KEY) VALUES (?, ?, ?, ?, ?, ?)')
    try {
      for (const item of lib.symbols) {
        let key = item.id
        for (let n = 2; keys.has(key); n++) key = `${item.id}-${n}`
        if (key !== item.id)
          diagnostics.push(
            diagnostic('stylx', 'warning', `The id ${item.id} is used twice; the second is ${key}.`, item.name),
          )
        keys.add(key)
        const written = cimSymbol(item.symbol, { colors: 'compact', format: 'stylx' })
        diagnostics.push(...written.diagnostics.map((d) => ({ ...d, subject: item.name })))
        insert.run([
          classOf(item.symbol.kind),
          item.category,
          item.name,
          item.tags.map((tag) => tag.replace(/;/g, ',')).join(';'),
          JSON.stringify(written.symbol),
          key,
        ])
      }
    } finally {
      insert.free()
    }
    return {
      files: [{ path: `${safeFileStem(lib.name)}.stylx`, content: db.export(), mime: 'application/x-sqlite3' }],
      diagnostics,
    }
  } finally {
    db.close()
  }
}

/** Largest number of style items read. */
export const MAX_STYLX_ITEMS = 20000

const CLASS_NAMES: Record<number, string> = Object.fromEntries(STYLX_CLASSES.map((name, i) => [i + 1, name]))

function tables(db: Database): Set<string> {
  const result = db.exec("SELECT name FROM sqlite_master WHERE type = 'table'")
  return new Set((result[0]?.values ?? []).map((row) => String(row[0])))
}

/** The point, line and polygon symbols of a style; every other item is counted and named. */
export function readStylx(bytes: Uint8Array, SQL: SqlJsStatic): ReadResult {
  const diagnostics: ExchangeDiagnostic[] = []
  let db: Database
  try {
    db = new SQL.Database(bytes)
    tables(db)
  } catch {
    throw Error('The file is not an SQLite database, so not an ArcGIS Pro style.')
  }
  try {
    if (!tables(db).has('ITEMS')) throw Error('The file has no ITEMS table, so it is not an ArcGIS Pro style.')
    const meta = new Map<string, string>()
    if (tables(db).has('meta'))
      for (const row of db.exec('SELECT key, value FROM meta')[0]?.values ?? [])
        meta.set(String(row[0]), String(row[1]))
    const content = meta.get('content')
    if (content && content !== 'json')
      throw Error(
        `The style stores its symbols as ${content}, which only ArcGIS Pro reads; open and save it in Pro 2.0 or later.`,
      )
    if (meta.has('dictionary_script'))
      diagnostics.push(
        diagnostic(
          'stylx',
          'info',
          `${meta.get('dictionary_name') ?? 'The style'} is a dictionary style; its Arcade script is not read, only its symbols.`,
        ),
      )
    const count = Number(db.exec('SELECT COUNT(*) FROM ITEMS')[0]?.values[0]?.[0] ?? 0)
    if (count > MAX_STYLX_ITEMS) throw Error(`The style holds ${count} items; at most ${MAX_STYLX_ITEMS} are read.`)
    const symbols: LibrarySymbol[] = []
    const skipped = new Map<string, number>()
    const ids = new Set<string>()
    const statement = db.prepare('SELECT CLASS, CATEGORY, NAME, TAGS, CONTENT, KEY FROM ITEMS ORDER BY ID')
    try {
      while (statement.step()) {
        const [cls, category, name, tags, json, key] = statement.get()
        const kind = Number(cls)
        if (kind !== POINT_CLASS && kind !== LINE_CLASS && kind !== POLYGON_CLASS) {
          const what = CLASS_NAMES[kind] ?? `class ${kind}`
          skipped.set(what, (skipped.get(what) ?? 0) + 1)
          continue
        }
        const label = String(name ?? '').trim() || String(key ?? '').trim() || 'Symbol'
        let parsed: unknown
        try {
          // Pro ends some items' JSON with a NUL, the C string terminator.
          parsed = JSON.parse(String(json ?? '').replace(/\0+$/, ''))
        } catch {
          diagnostics.push(diagnostic('stylx', 'error', 'The symbol is not readable JSON.', label))
          continue
        }
        const read = sheetSymbolFromCim(parsed, { label, format: 'stylx', subject: label })
        diagnostics.push(...read.diagnostics)
        if (!read.symbol) continue
        let id = safeFileStem(String(key ?? label)).toLowerCase() || 'symbol'
        for (let n = 2; ids.has(id); n++) id = `${safeFileStem(String(key ?? label)).toLowerCase()}-${n}`
        ids.add(id)
        symbols.push({
          id,
          name: label,
          category: String(category ?? '').trim() || 'ArcGIS Pro',
          tags: String(tags ?? '')
            .split(';')
            .map((tag) => tag.trim())
            .filter(Boolean),
          symbol: read.symbol,
        })
      }
    } finally {
      statement.free()
    }
    for (const [what, n] of skipped)
      diagnostics.push(
        diagnostic(
          'stylx',
          'info',
          `${n} ${what} item${n === 1 ? ' was' : 's were'} not read; PGMaps reads point, line and polygon symbols.`,
        ),
      )
    return { format: 'stylx', layers: [], symbols, layouts: [], diagnostics }
  } finally {
    db.close()
  }
}
