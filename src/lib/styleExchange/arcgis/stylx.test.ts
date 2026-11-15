import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { catalogueSymbolLibrary } from '@/lib/forestry/blockSheet/symbolLibrary'
import { FIXTURE_LIBRARY } from '../fixtures'
import { readArcgisFile } from './read'
import { arcgisStylx, readStylx, STYLX_CLASSES, STYLX_META, STYLX_SCHEMA } from './stylx'
import { canonicalSymbol } from './testCanonical'

let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs()
})

/** `sqlite_master` as Pro's styles have it: every table and index, autoindexes included. */
const ESRI_MASTER = [
  ['table', 'ITEMS'],
  ['index', 'sqlite_autoindex_ITEMS_1'],
  ['index', 'ITEMS_ID'],
  ['index', 'ITEMS_CLASS'],
  ['index', 'ITEMS_KEY'],
  ['table', 'CLASSES'],
  ['index', 'CLASSES_ID'],
  ['table', 'meta'],
  ['table', 'BINARY_CLASSES'],
  ['index', 'BINARY_CLASSES_ID'],
  ['table', 'BINARIES'],
  ['index', 'sqlite_autoindex_BINARIES_1'],
  ['index', 'BINARIES_ID'],
  ['index', 'BINARIES_MD5'],
  ['index', 'BINARIES_CLASS'],
  ['table', 'STYLE_ITEM_BINARY_REFERENCES'],
  ['index', 'sqlite_autoindex_STYLE_ITEM_BINARY_REFERENCES_1'],
]

const rows = (bytes: Uint8Array, sql: string) => {
  const db = new SQL.Database(bytes)
  try {
    return db.exec(sql)[0]?.values ?? []
  } finally {
    db.close()
  }
}

describe('ArcGIS Pro styles', () => {
  it("writes Pro's schema, classes and meta rows, one item per symbol", () => {
    const library = catalogueSymbolLibrary()
    const { files, diagnostics } = arcgisStylx(library, SQL)
    expect(diagnostics.filter((d) => d.severity !== 'info')).toEqual([])
    const bytes = files[0].content as Uint8Array
    expect(files[0].path).toBe('PGMaps-forestry-map-symbols.stylx')
    expect(rows(bytes, 'SELECT type, name FROM sqlite_master')).toEqual(ESRI_MASTER)
    expect(rows(bytes, 'SELECT sql FROM sqlite_master WHERE sql IS NOT NULL').map((r) => r[0])).toEqual(STYLX_SCHEMA)
    expect(rows(bytes, 'SELECT ID, NAME FROM CLASSES')).toEqual(STYLX_CLASSES.map((name, i) => [i + 1, name]))
    expect(rows(bytes, 'SELECT key, value FROM meta')).toEqual(STYLX_META)
    const items = rows(bytes, 'SELECT CLASS, CATEGORY, NAME, TAGS, CONTENT, KEY FROM ITEMS ORDER BY ID')
    expect(items).toHaveLength(library.symbols.length)
    items.forEach(([cls, category, name, tags, content, key], i) => {
      const item = library.symbols[i]
      expect(cls).toBe(item.symbol.kind === 'point' ? 3 : item.symbol.kind === 'line' ? 4 : 5)
      expect([category, name, tags, key]).toEqual([item.category, item.name, item.tags.join(';'), item.id])
      // Compact colours, as Pro's styles store them.
      expect(String(content)).not.toContain('CIMRGBColor')
    })
  })

  it('reads every catalogue symbol back', () => {
    const library = catalogueSymbolLibrary()
    const read = readArcgisFile('lib.stylx', arcgisStylx(library, SQL).files[0].content, { SQL })
    expect(read.diagnostics.filter((d) => d.severity !== 'info')).toEqual([])
    expect(read.symbols.map((s) => [s.id, s.name, s.category, s.tags])).toEqual(
      library.symbols.map((s) => [s.id, s.name, s.category, s.tags]),
    )
    read.symbols.forEach((symbol, i) =>
      expect(canonicalSymbol(symbol.symbol), symbol.id).toEqual(canonicalSymbol(library.symbols[i].symbol)),
    )
  })

  it('reads a Pro-shaped style: font and text markers are errors, other item classes are counted', () => {
    const db = new SQL.Database(arcgisStylx(FIXTURE_LIBRARY, SQL).files[0].content as Uint8Array)
    const insert = (cls: number, name: string, content: unknown) =>
      db.run('INSERT INTO ITEMS (CLASS, CATEGORY, NAME, TAGS, CONTENT, KEY) VALUES (?, ?, ?, ?, ?, ?)', [
        cls,
        '',
        name,
        'rgb;black',
        JSON.stringify(content),
        name,
      ])
    const fill = (rgb: number[]) => ({
      type: 'CIMPolygonSymbol',
      symbolLayers: [{ type: 'CIMSolidFill', enable: true, color: [...rgb, 255] }],
      angleAlignment: 'Map',
    })
    insert(3, 'Arrow', {
      type: 'CIMPointSymbol',
      symbolLayers: [
        {
          type: 'CIMCharacterMarker',
          enable: true,
          characterIndex: 196,
          fontFamilyName: 'ESRI Arrowhead',
          size: 12,
          symbol: fill([230, 0, 0]),
        },
      ],
      haloSize: 1,
      scaleX: 1,
      angleAlignment: 'Display',
    })
    insert(3, 'Label', {
      type: 'CIMPointSymbol',
      symbolLayers: [
        {
          type: 'CIMVectorMarker',
          enable: true,
          primitiveName: 'label',
          size: 10,
          frame: { xmin: -5, ymin: -5, xmax: 5, ymax: 5 },
          markerGraphics: [
            {
              type: 'CIMMarkerGraphic',
              geometry: { x: 0, y: 0 },
              symbol: { type: 'CIMTextSymbol', height: 10, symbol: fill([78, 78, 78]) },
              textString: '[NAME]',
            },
          ],
        },
      ],
    })
    insert(6, 'Text', { type: 'CIMTextSymbol', height: 8 })
    db.run("INSERT INTO meta (key, value) VALUES ('dictionary_script', 'return \"x\"')")
    const bytes = db.export()
    db.close()
    const read = readStylx(bytes, SQL)
    expect(read.symbols.map((s) => s.id)).toEqual(FIXTURE_LIBRARY.symbols.map((s) => s.id))
    const errors = read.diagnostics.filter((d) => d.severity === 'error')
    expect(errors.map((d) => d.subject)).toEqual(['Arrow', 'Label'])
    expect(errors[0].message).toMatch(/symbol font \(ESRI Arrowhead #196\)/)
    expect(errors[1].message).toMatch(/draws text from a font/)
    expect(read.diagnostics.some((d) => /1 Text Symbol item was not read/.test(d.message))).toBe(true)
    expect(read.diagnostics.some((d) => /dictionary style/.test(d.message))).toBe(true)
  })

  it('refuses a file that is not a style', () => {
    expect(() => readStylx(new TextEncoder().encode('not sqlite at all, not even close'), SQL)).toThrow(/not an SQLite/)
    const empty = new SQL.Database()
    const bytes = empty.export()
    empty.close()
    expect(() => readStylx(bytes, SQL)).toThrow(/no ITEMS table/)
  })
})

/**
 * Esri's own files, when a local copy is named: PGMAPS_ESRI_SAMPLES is a folder holding Parks.stylx and
 * Calls.stylx (Esri/dictionary-renderer-toolkit) and Fire_Stations.lyrx and FlowLines.lyrx
 * (Esri/arcgis-pro-sdk-community-samples). They are not committed.
 */
const samples = process.env.PGMAPS_ESRI_SAMPLES
describe.skipIf(!samples || !existsSync(samples))("Esri's sample files", () => {
  const file = (name: string) => new Uint8Array(readFileSync(join(samples!, name)))
  it.each(['Parks.stylx', 'Calls.stylx'])('reads %s, reporting its font and text markers as errors', (name) => {
    const read = readArcgisFile(name, file(name), { SQL })
    expect(read.diagnostics.some((d) => d.severity === 'error' && /font|picture|vector marker/.test(d.message))).toBe(
      true,
    )
  })
  it.each(['Fire_Stations.lyrx', 'FlowLines.lyrx'])('reads %s without throwing', (name) => {
    const read = readArcgisFile(name, file(name))
    expect(read.layers.length + read.diagnostics.length).toBeGreaterThan(0)
  })
})
