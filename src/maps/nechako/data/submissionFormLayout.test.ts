import { describe, expect, it } from 'vitest'
import {
  checkedSubmissionFormDefinitions,
  publicSubmissionChildren,
  submissionFormLayout,
  submissionRecordCsv,
  submissionRecordHtml,
} from './submissionFormLayout'
import type { SubmissionRecord } from './submissionSnapshot'

const record: SubmissionRecord = {
  id: '9',
  formId: '3',
  formName: 'Literature',
  title: 'resources & literature',
  name: '',
  date: '',
  parentId: -1,
  sourceUrl: 'https://nechakowatershed-portal.ca/',
  attachments: [{ id: '42', name: 'Report' }],
  layers: [{ id: '31', name: 'Stations', kind: 'linked' }],
  media: [
    {
      fieldId: '20',
      ordinal: 1,
      kind: 'embedded',
      mime: 'image/png',
      sourceUrl: 'https://nechakowatershed-portal.ca/',
    },
  ],
  fields: [
    {
      id: '20',
      label: 'Description',
      type: 'htmleditor',
      value: '<script>alert(1)</script><p>Fish &amp; water <img src="data:image/png;base64,SECRET"></p>',
    },
    { id: '10', label: 'Count', type: 'number', value: 0 },
    { id: '11', label: 'Verified', type: 'checkbox', value: false },
    { id: '12', label: 'Notes', type: 'textarea', value: [] },
  ],
  searchText: '',
}
function definitions() {
  return {
    schema: 'nechako-public-form-definitions-v1',
    source: record.sourceUrl,
    capturedAt: '2026-10-12',
    forms: [
      {
        id: '3',
        name: 'Literature',
        pages: [{ id: 1 }, { id: '2', label: 'Context' }],
        nodes: [
          {
            fieldId: '20',
            label: 'Description',
            type: 'htmleditor',
            dynamic: true,
            page: 1,
            nodeRank: 0,
            fieldRank: '7',
            nodeType: '2',
            semanticType: 'dynamic',
          },
          {
            fieldId: '10',
            label: 'Count',
            type: 'number',
            dynamic: true,
            page: 1,
            nodeRank: 0,
            fieldRank: '1',
            nodeType: '2',
            semanticType: 'dynamic',
          },
          {
            fieldId: '41',
            label: 'Attachments',
            type: '5',
            dynamic: false,
            page: 1,
            nodeRank: 1,
            fieldRank: '0',
            nodeType: '5',
            semanticType: 'attachments',
          },
          {
            fieldId: '11',
            label: 'Verified',
            type: 'checkbox',
            dynamic: true,
            page: '2',
            nodeRank: 0,
            fieldRank: '0',
            nodeType: '2',
            semanticType: 'dynamic',
          },
          {
            fieldId: '13',
            label: 'Not captured',
            type: 'text',
            dynamic: true,
            page: '2',
            nodeRank: 0,
            fieldRank: '1',
            nodeType: '2',
            semanticType: 'dynamic',
          },
        ],
      },
    ],
  }
}
describe('anonymous submission form layout', () => {
  it('preserves source array order instead of resorting ranks, groups pages and maps resource sections', () => {
    const layout = submissionFormLayout(record, checkedSubmissionFormDefinitions(definitions()).forms[0])
    expect(layout.map((section) => section.fields.map(({ field }) => field.id))).toEqual([
      ['20', '10'],
      [],
      ['11', '13'],
      ['12'],
    ])
    expect(layout[1].resource).toBe('attachments')
    expect(layout[2].pageLabel).toBe('Context')
    expect(layout[2].fields[1].field.value).toBeUndefined()
    expect(layout[0].fields[1].field.value).toBe(0)
    expect(layout[2].fields[0].field.value).toBe(false)
    expect(layout[3].fields[0].field.value).toEqual([])
  })
  it('falls back to every captured field and rejects duplicate or unidentified dynamic nodes', () => {
    expect(submissionFormLayout(record)[0].fields.map(({ field }) => field.id)).toEqual(['20', '10', '11', '12'])
    const duplicate = definitions()
    duplicate.forms[0].nodes.push(duplicate.forms[0].nodes[0])
    expect(() => checkedSubmissionFormDefinitions(duplicate)).toThrow(/unique/)
    const invalid = definitions()
    delete (invalid.forms[0].nodes[0] as { fieldId?: string }).fieldId
    expect(() => checkedSubmissionFormDefinitions(invalid)).toThrow(/invalid/)
    expect(() => checkedSubmissionFormDefinitions({ ...definitions(), schema: 'private-archive' })).toThrow(/invalid/)
  })
  it('derives only verified public child relationships and does not include self references', () => {
    const child = { ...record, id: '10', parentId: 9 }
    expect(publicSubmissionChildren([record, child, { ...record, id: '11' }, { ...record, parentId: 9 }], '9')).toEqual(
      [child],
    )
  })
  it('exports safe readable values, IDs and provenance without embedded bodies or script execution', () => {
    const html = submissionRecordHtml(record, '2026-10-12', checkedSubmissionFormDefinitions(definitions()).forms[0])
    expect(html).toContain('Fish &amp; water')
    expect(html).toContain('Field ID 10')
    expect(html).toContain('>0</div>')
    expect(html).toContain('>false</div>')
    expect(html).toContain('>[]</div>')
    expect(html).toContain('(empty string)')
    expect(html).toContain('2026-10-12')
    expect(html).toContain('Source ID 42')
    expect(html).not.toContain('SECRET')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('alert(1)')
    const csv = submissionRecordCsv({
      ...record,
      fields: [
        { id: '20', label: '=SUM(1)', type: 'text', value: '=HYPERLINK("malicious")' },
        ...record.fields.slice(1),
      ],
    })
    expect(csv).toContain("'=SUM(1)")
    expect(csv).toContain("'=HYPERLINK")
    expect(csv).toContain('false')
    expect(csv).toContain('[]')
  })
  it('keeps decoded safe citation links in readable HTML and rejects executable and credential URLs', () => {
    const html = submissionRecordHtml(
      {
        ...record,
        fields: [
          {
            id: '20',
            label: 'Reference',
            type: 'htmleditor',
            value:
              '<a href="https://example.com/paper?a=1&amp;b=2">Paper</a><a href="http://example.org/record">Older reference</a><a href="javascript:alert(1)">Unsafe</a><a href="https://user:secret@example.com/">Private URL</a>',
          },
        ],
      },
      '2026-10-12',
    )
    expect(html).toContain('href="https://example.com/paper?a=1&amp;b=2"')
    expect(html).toContain('href="http://example.org/record"')
    expect(html).not.toContain('href="javascript:')
    expect(html).not.toContain('user:secret')
  })
})
