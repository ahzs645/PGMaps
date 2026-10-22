import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { parseGpapDatabase, gpapFormFields, gpapLayers, gpapNoteRows, gpapReviewJson } from './geopaparazzi'
import { gpapLocalRecords, gpapConflicts, mappedDraftRecords } from './localIngestion'
import { parseImportJson } from './importValues'
import { checkedLocalLayer } from './localLayers'
import { buildDraftReview, parseReviewForm } from './submissionReview'

const require = createRequire(import.meta.url)
const bytes = new Uint8Array(
  readFileSync(new URL('../../../../tests/fixtures/nechako/local-field-project.gpap', import.meta.url)),
)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') })
})
function project() {
  const db = new SQL.Database(bytes)
  try {
    return parseGpapDatabase(db, { name: 'local-field-project.gpap', sha256: 'a'.repeat(64) })
  } finally {
    db.close()
  }
}

describe('GPAP browser import and local draft relationships', () => {
  it('reads real SQLite rows with exact IDs, zero coordinates, raw form values and original media', () => {
    const value = project()
    expect(value.notes.map((note) => note.id)).toEqual(['0', '9007199254740993'])
    expect(value.notes[0].feature.geometry).toEqual({ type: 'Point', coordinates: [0, 0, 0] })
    expect(value.notes[0].row.ts).toBe(0)
    expect(value.notes[0].fields.find((field) => field.key === 'Count')?.value).toBe(0)
    expect(value.notes[0].fields.find((field) => field.key === 'Observed')?.value).toBe(false)
    expect(value.notes[0].fields.filter((field) => field.key === 'Repeat').map((field) => field.value)).toEqual([
      'first',
      'second',
    ])
    expect(value.images[0].bytes?.subarray(0, 4)).toEqual(new Uint8Array([137, 80, 78, 71]))
    expect(value.images[0].noteId).toBe('0')
    expect(value.notes[0].imageIds).toEqual(['12', '999'])
    expect(value.relationships).toContainEqual({
      fromTable: 'images',
      fromId: '12',
      toTable: 'imagedata',
      toId: '4',
      role: 'image-bytes',
      resolved: true,
    })
    expect(value.issues.some((issue) => issue.code === 'unresolved-reference' && issue.message.includes('999'))).toBe(
      true,
    )
    expect(value.tables.find((table) => table.name === 'custom_unknown')?.parsed).toBe(false)
  })
  it('keeps raw/filtered tracks separate, breaks invalid geometry, and preserves parent links and orphan points', () => {
    const value = project()
    expect(value.tracks[0].points).toHaveLength(5)
    expect(value.tracks[0].feature.geometry).toEqual({
      type: 'MultiLineString',
      coordinates: [
        [
          [0, 0, 0],
          [1, 1, 1],
        ],
        [
          [2, 2, 0],
          [3, 3, 0],
        ],
      ],
    })
    expect(value.tracks[0].filteredFeature?.geometry).toEqual({
      type: 'MultiLineString',
      coordinates: [
        [
          [0, 0, 0],
          [1.1, 1.1, 1],
        ],
        [
          [2, 2, 0],
          [3, 3, 0],
        ],
      ],
    })
    expect(value.tracks[1].parentId).toBe('7')
    expect(value.orphanTrackPoints[0].logid).toBe(404)
    expect(gpapLayers(value).map((layer) => layer.data.features.length)).toEqual([2, 2, 2, 2])
  })
  it('keeps mapped form keys distinct and serializes review metadata without binary duplication', () => {
    const value = project()
    const rows = gpapNoteRows(value.notes)
    expect(rows[0]['/forms/0/formitems/3/Repeat']).toBe('first')
    expect(rows[0]['/forms/0/formitems/4/Repeat']).toBe('second')
    const review = gpapReviewJson(value) as { images: { bytes: number }[] }
    expect(review.images[0].bytes).toBe(value.images[0].bytes!.length)
    expect(JSON.stringify(review)).not.toContain('"0":137')
  })
  it('creates selected local drafts and actual binary attachments with referential integrity', async () => {
    const value = project()
    const original = new File([bytes], value.name)
    const records = await gpapLocalRecords(value, original, [0])
    expect(records.filter((record) => record.kind === 'submission')).toHaveLength(1)
    const draft = records.find((record) => record.kind === 'submission')!
    const data = draft.data as {
      sourceNoteId: string
      values: Record<string, unknown>
      attachmentIds: string[]
      sourceFeature: GeoJSON.Feature
    }
    expect(data.sourceNoteId).toBe('0')
    expect(data.values['/forms/0/formitems/0/Count']).toBe(0)
    expect(data.values['/forms/0/formitems/1/Observed']).toBe(false)
    expect(data.attachmentIds.every((id) => records.some((record) => record.id === id && record.blob))).toBe(true)
    expect(new Uint8Array(await records[0].blob!.arrayBuffer())).toEqual(bytes)
    for (const layer of records.filter((record) => record.kind === 'layer'))
      expect(() => checkedLocalLayer(layer.data)).not.toThrow()
    expect(gpapConflicts(records, records)[0].kind).toBe('duplicate')
    const changed = structuredClone(records)
    ;(changed.find((record) => record.kind === 'submission')!.data as { sourceFingerprint: string }).sourceFingerprint =
      'changed'
    expect(gpapConflicts(changed, records)[0].kind).toBe('conflict')
  })
  it('reports duplicate IDs without merging rows and rejects unrelated SQLite', () => {
    const db = new SQL.Database()
    db.run(
      'CREATE TABLE notes (_id INTEGER, lon REAL, lat REAL, text TEXT, form TEXT); INSERT INTO notes VALUES(1,0,0,"first",NULL),(1,1,1,"second",NULL);',
    )
    const value = parseGpapDatabase(db, { name: 'duplicates.gpap', sha256: 'b'.repeat(64) })
    expect(value.notes).toHaveLength(2)
    expect(value.issues.some((issue) => issue.code === 'duplicate-id')).toBe(true)
    db.close()
    const other = new SQL.Database()
    other.run('CREATE TABLE arbitrary (value TEXT)')
    expect(() => parseGpapDatabase(other, { name: 'other.db', sha256: '' })).toThrow('no recognized GPAP')
    other.close()
  })
})

describe('loss-aware local ingestion values', () => {
  it('preserves unsafe JSON integers and string escapes without turning zero or false into missing data', () => {
    const value = parseImportJson(
      String.raw`{"id":9007199254740993,"negative":-9007199254740993,"zero":0,"false":false,"text":"quote\" 9007199254740993","nested":[9223372036854775807,1.5]}`,
    )
    expect(value).toEqual({
      id: '9007199254740993',
      negative: '-9007199254740993',
      zero: 0,
      false: false,
      text: 'quote" 9007199254740993',
      nested: ['9223372036854775807', 1.5],
    })
    expect(() => parseImportJson('{"n":1e999}')).toThrow('finite range')
    expect(() => parseImportJson('{"n":01}')).toThrow()
  })
  it('keeps native media reference types and scoped duplicate field values', () => {
    const value = gpapFormFields({
      forms: [
        {
          formitems: [
            { key: 'x', type: 'imagelib', value: '0;4' },
            { key: 'x', type: 'map', value: '7' },
            { key: 'y', type: 'sketch', value: '8;9' },
          ],
        },
      ],
    })
    expect(value.imageIds).toEqual(['0', '4', '7', '8', '9'])
    expect(value.fields).toHaveLength(3)
    expect(value.issues).toHaveLength(1)
  })
  it('maps selected GIS drafts without changing field values or feature IDs and rejects invalid selections', () => {
    const form = parseReviewForm({
      id: 'form1',
      fields: [{ id: 'count', label: 'Count', type: 'integer', required: true }],
    })
    const review = buildDraftReview(form, { count: 'Source' }, [{ Source: 0, Extra: false }, { Source: 2 }], 'samples')
    const geometry: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: '9007199254740993',
          properties: { Source: 0 },
          geometry: { type: 'Point', coordinates: [0, 0] },
        },
        { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [1, 1] } },
      ],
    }
    const records = mappedDraftRecords(review, ['row-1'], geometry)
    expect(records[0].data).toMatchObject({
      status: 'draft',
      values: { count: 0 },
      original: { Source: 0, Extra: false },
      sourceFeature: { id: '9007199254740993' },
    })
    expect(() => mappedDraftRecords(review, ['row-9'], geometry)).toThrow('invalid')
  })
})
