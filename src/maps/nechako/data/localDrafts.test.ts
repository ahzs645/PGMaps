import { describe, expect, it } from 'vitest'
import { blankLocalDraft, draftValueEditor, editedLocalDraft, localDraftGeometry, parseDraftValue } from './localDrafts'
import { ingestionRecord } from './localIngestion'

const draft = () =>
  ingestionRecord('submission', 'draft-0', 'Original title', {
    schema: 'nechako-local-submission-v1',
    status: 'draft',
    sourceType: 'geopaparazzi',
    sourceNoteId: '9007199254740993',
    values: { count: 0, flag: false, empty: null, originalId: '9007199254740993' },
    original: { _id: '9007199254740993', count: 0 },
    formRaw: '{"value":0}',
    geometry: { type: 'Point', coordinates: [0, 0, 0] },
    attachmentIds: ['photo'],
    relationships: [
      { kind: 'geopaparazzi', id: 'package', role: 'source-project' },
      { kind: 'attachment', id: 'photo', role: 'note-media' },
    ],
    issues: ['Original import warning'],
  })

describe('editable local drafts', () => {
  it('starts a persisted-schema draft with missing values, retained rules and no fabricated defaults', () => {
    const schema = ingestionRecord('schema', 'schema:0', 'Field schema', {
      id: 0,
      fields: [
        { id: 0, label: 'Count', type: 'integer', required: true, default: 5 },
        { id: 'flag', label: 'Observed', type: 'boolean' },
      ],
    })
    const created = blankLocalDraft(schema)
    expect(created.data).toMatchObject({
      schema: 'nechako-local-submission-v1',
      status: 'draft',
      sourceType: 'local',
      formId: '0',
      schemaId: 'schema:0',
      values: { '0': null, flag: null },
      geometry: null,
      formOriginal: schema.data,
      localValidation: ['Count: Required value missing'],
      relationships: [{ kind: 'schema', id: 'schema:0', role: 'draft-schema' }],
    })
    expect(created.bytes).toBeGreaterThan(0)
    expect(() => blankLocalDraft({ ...schema, kind: 'attachment' })).toThrow('cached schema')
  })
  it('roundtrips zero, false, null, structured values and exact textual IDs', () => {
    for (const value of [0, false, null, '', '9007199254740993', { answer: 0, enabled: false }, [0, null]])
      expect(parseDraftValue(draftValueEditor(value))).toEqual(value)
    expect(() => parseDraftValue({ type: 'number', text: '9007199254740993' })).toThrow('exact range')
    expect(parseDraftValue({ type: 'text', text: '9007199254740993' })).toBe('9007199254740993')
    expect(() => parseDraftValue({ type: 'number', text: '' })).toThrow('finite decimal')
    expect(() => parseDraftValue({ type: 'boolean', text: '0' })).toThrow('true or false')
  })
  it('edits local values/status/geometry while retaining original IDs/forms/links and prior saved values', () => {
    const original = draft()
    const edited = editedLocalDraft(original, {
      name: 'Reviewed locally',
      status: 'reviewed',
      editors: { count: { type: 'number', text: '2' }, flag: { type: 'boolean', text: 'false' } },
      geometryText: '{"type":"Point","coordinates":[1,2,0]}',
      attachmentIds: ['other', 'other'],
    })
    expect(edited.name).toBe('Reviewed locally')
    expect(edited.data).toMatchObject({
      status: 'reviewed',
      values: { count: 2, flag: false },
      sourceNoteId: '9007199254740993',
      original: { _id: '9007199254740993', count: 0 },
      formRaw: '{"value":0}',
      issues: ['Original import warning'],
      geometry: { type: 'Point', coordinates: [1, 2, 0] },
      attachmentIds: ['other'],
    })
    expect(edited.data.relationships).toEqual([
      { kind: 'geopaparazzi', id: 'package', role: 'source-project' },
      { kind: 'attachment', id: 'other', role: 'draft-attachment' },
    ])
    expect(edited.data.history?.[0]).toMatchObject({
      name: 'Original title',
      values: { count: 0, flag: false, empty: null },
    })
    expect(original.data.values.count).toBe(0)
    expect(original.data.geometry.coordinates).toEqual([0, 0, 0])
  })
  it('validates geometry and declared rules without rewriting source definitions', () => {
    const original = {
      ...draft(),
      data: {
        ...draft().data,
        formOriginal: { fields: [{ id: 'count', label: 'Count', type: 'integer', required: true }] },
      },
    }
    const input = {
      name: 'Local review',
      status: 'draft' as const,
      editors: { count: { type: 'text' as const, text: 'unknown' } },
      geometryText: 'null',
      attachmentIds: [],
    }
    const edited = editedLocalDraft(original, input)
    expect(edited.data.geometry).toBeNull()
    const sourceFeature: GeoJSON.Feature = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [10, 20] },
    }
    expect(localDraftGeometry({ ...edited.data, sourceFeature })).toBeNull()
    expect(localDraftGeometry({ ...edited.data, geometry: undefined, sourceFeature })).toEqual(sourceFeature.geometry)
    expect(edited.data.localValidation).toEqual(['Count: Use a whole-number integer'])
    expect(() =>
      editedLocalDraft(original, { ...input, geometryText: '{"type":"Point","coordinates":[190,0]}' }),
    ).toThrow('longitude/latitude')
    expect(() => editedLocalDraft(original, { ...input, name: '' })).toThrow('title')
  })
})
