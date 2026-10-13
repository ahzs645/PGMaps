import { afterEach, describe, expect, it, vi } from 'vitest'
import { gzipSync } from 'node:zlib'
import {
  checkedSubmissionRecords,
  filterSubmissionSnapshot,
  loadSubmissionSnapshot,
  snapshotFieldText,
  snapshotSourceUrl,
  submissionType,
} from './submissionSnapshot'

const source = 'https://nechakowatershed-portal.ca/'
const record = {
  id: '1',
  title: "O'Brien Creek",
  name: 'Upper site',
  formId: '3',
  formName: 'Project',
  date: '2026-10-12',
  sourceUrl: source,
  parentId: -1,
  fields: [
    { id: '101', label: 'Reviewed', type: 'checkbox', value: false },
    { id: '102', label: 'Count', type: 'number', value: 0 },
    { id: '103', label: 'Notes', type: 'text', value: '' },
    {
      id: '104',
      label: "Contributor's notes",
      type: 'htmleditor',
      value:
        '<p>Fieldonlyquartz fish &amp; habitat.</p><script>stealSecret()</script><img src="data:image/png;base64,AAAA">',
    },
  ],
  attachments: [],
  layers: [],
  media: [
    { fieldId: '104', ordinal: 1, mime: 'image/png', kind: 'embedded', sourceUrl: source },
    { fieldId: '104', ordinal: 2, mime: 'image/png', kind: 'remote', sourceUrl: source, url: 'javascript:alert(1)' },
  ],
  searchText: '',
}
const payload = (records: unknown[] = [record]) => ({
  schema: 'nechako-public-content-v1',
  source,
  capturedAt: '2026-10-12',
  records,
})
const manifest = {
  schema: 'nechako-public-content-manifest-v1',
  source,
  capturedAt: '2026-10-12',
  scope: 'Anonymous submitted records',
  recordCount: 1,
  fieldCount: 4,
  mediaCount: 2,
  attachmentCount: 0,
  layerCount: 0,
}
afterEach(() => vi.unstubAllGlobals())

describe('anonymous submission snapshot', () => {
  it('indexes actual fields when the producer search index is empty and preserves falsy values', () => {
    const records = checkedSubmissionRecords(payload())
    expect(records[0].fields.map((field) => field.value).slice(0, 3)).toEqual([false, 0, ''])
    expect(filterSubmissionSnapshot(records, 'fieldonlyquartz')).toHaveLength(1)
    expect(filterSubmissionSnapshot(records, '{Reviewed} = false AND {Count} = 0')).toHaveLength(1)
    expect(filterSubmissionSnapshot(records, '{Notes} = ""')).toHaveLength(1)
    expect(filterSubmissionSnapshot(records, 'stealSecret')).toHaveLength(0)
    expect(filterSubmissionSnapshot(records, 'data:image')).toHaveLength(0)
  })

  it('combines phrase/group/comparison filters with form and verified spatial ID selection', () => {
    const records = checkedSubmissionRecords(
      payload([
        record,
        { ...record, id: '26', title: 'Literature document', formId: '8', formName: 'Literature', parentId: 1 },
      ]),
    )
    expect(
      filterSubmissionSnapshot(records, '(fieldonlyquartz OR absent) AND {Submission ID} >= 20').map((row) => row.id),
    ).toEqual(['26'])
    expect(filterSubmissionSnapshot(records, '', '8').map((row) => row.id)).toEqual(['26'])
    expect(filterSubmissionSnapshot(records, '', '', new Set(['1'])).map((row) => row.id)).toEqual(['1'])
    expect(filterSubmissionSnapshot(records, '', '', new Set())).toEqual([])
    expect(filterSubmissionSnapshot(records, '{Type} = "A:1"').map((row) => row.id)).toEqual(['26'])
    expect(filterSubmissionSnapshot(records, '20 <= {Submission ID}').map((row) => row.id)).toEqual(['26'])
    expect(filterSubmissionSnapshot(records, '{Submission Date} = "2026-10-12"')).toHaveLength(2)
    expect(() => filterSubmissionSnapshot(records, 'fish AND')).toThrow()
    expect(() => filterSubmissionSnapshot(records, '{Unavailable field} = 1')).toThrow('Unknown snapshot field')
  })

  it('decodes native SQL apostrophe escaping for local literal and column comparisons', () => {
    const records = checkedSubmissionRecords(payload())
    expect(filterSubmissionSnapshot(records, '"O\'Brien"')).toHaveLength(1)
    expect(filterSubmissionSnapshot(records, '{Submission Title} = "O\'Brien Creek"')).toHaveLength(1)
    expect(filterSubmissionSnapshot(records, '{Contributor\'s notes} ~ "Fieldonlyquartz"')).toHaveLength(1)
  })

  it('does not invent parent types, source deep links or inline image URLs', () => {
    const records = checkedSubmissionRecords(payload([{ ...record, parentId: undefined }]))
    expect(submissionType(records[0])).toBe('—')
    expect(records[0].media[1].url).toBeUndefined()
    expect(snapshotSourceUrl('data:image/png;base64,AAAA')).toBeUndefined()
    expect(snapshotSourceUrl('javascript:alert(1)')).toBeUndefined()
    expect(snapshotSourceUrl('https://user:password@example.test/file')).toBeUndefined()
    expect(snapshotSourceUrl('/uploads/photo.png')).toBe(`${source}uploads/photo.png`)
    expect(snapshotFieldText(record.fields[3].value, 'htmleditor')).toBe('Fieldonlyquartz fish & habitat.')
    expect(snapshotFieldText(false)).toBe('false')
    expect(snapshotFieldText(0)).toBe('0')
    expect(snapshotFieldText(null)).toBe('null')
  })

  it('rejects duplicate records, duplicate fields and omitted returned values', () => {
    expect(() => checkedSubmissionRecords(payload([record, record]))).toThrow('duplicate source IDs')
    expect(() =>
      checkedSubmissionRecords(payload([{ ...record, fields: [record.fields[0], record.fields[0]] }])),
    ).toThrow('duplicate field IDs')
    expect(() =>
      checkedSubmissionRecords(payload([{ ...record, fields: [{ id: '101', label: 'Reviewed', type: 'checkbox' }] }])),
    ).toThrow('returned value')
    expect(() => checkedSubmissionRecords(payload([{ ...record, parentId: '' }]))).toThrow('parent relationship')
  })

  it('loads real gzip bytes using the shared decoder and checks manifest counts', async () => {
    const zipped = gzipSync(JSON.stringify(payload()))
    const fetch = vi
      .fn()
      .mockImplementation(async (url: string) =>
        url.endsWith('manifest.json') ? new Response(JSON.stringify(manifest)) : new Response(zipped),
      )
    vi.stubGlobal('fetch', fetch)
    expect((await loadSubmissionSnapshot()).records[0].fields[0].value).toBe(false)
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/data/nechako-portal/manifest.json',
      '/data/nechako-portal/submissions.json.gz',
    ])
    fetch.mockImplementation(async (url: string) =>
      url.endsWith('manifest.json')
        ? new Response(JSON.stringify({ ...manifest, recordCount: 2 }))
        : new Response(zipped),
    )
    await expect(loadSubmissionSnapshot()).rejects.toThrow('counts do not match')
  })

  it('rejects combining records with another capture manifest', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(
          async (url: string) =>
            new Response(
              JSON.stringify(url.endsWith('manifest.json') ? { ...manifest, capturedAt: '2025-01-01' } : payload()),
            ),
        ),
    )
    await expect(loadSubmissionSnapshot()).rejects.toThrow('manifest capture')
  })
})
