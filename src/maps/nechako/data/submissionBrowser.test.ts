import { describe, expect, it } from 'vitest'
import {
  browseSubmissionSnapshot,
  snapshotSearchFieldGroups,
  submissionBrowserForms,
  UNKNOWN_SUBMISSION_YEAR,
} from './submissionBrowser'
import { compileSearchClause } from './searchBuilder'
import { filterSubmissionSnapshot, type SubmissionRecord } from './submissionSnapshot'
import { parsePortalSearch } from '@/lib/nechakoPortal'

function record(id: string, formId: string, date: string, values: unknown[]): SubmissionRecord {
  return {
    id,
    formId,
    date,
    formName: 'Repeated form label',
    title: `Submission ${id}`,
    name: `Site ${id}`,
    sourceUrl: 'https://nechakowatershed-portal.ca/',
    attachments: [],
    layers: [],
    media: [],
    searchText: '',
    fields: [
      { id: '20', label: 'Repeated field label', type: 'integer', value: values[0] },
      { id: '21', label: 'Repeated field label', type: 'checkbox', value: values[1] },
      { id: '22', label: 'Narrative', type: 'htmleditor', value: values[2] },
    ],
  }
}
const records = [
  record('1', '3', '2025-12-31 23:30:00', [0, false, 'River']),
  record('2', '3', '2026-01-01', [5, true, 'Forest']),
  record('3', '4', '2026-02-01', [0, false, 'River']),
  record('4', '3', '', [9, false, 'Lake']),
]

describe('captured submission browser', () => {
  it('groups by exact form identity and supplied calendar year, including missing dates', () => {
    const groups = submissionBrowserForms(records)
    expect(groups.map((group) => [group.id, group.count])).toEqual([
      ['3', 3],
      ['4', 1],
    ])
    expect(groups[0].years).toEqual([
      { year: '2026', count: 1 },
      { year: '2025', count: 1 },
      { year: UNKNOWN_SUBMISSION_YEAR, count: 1 },
    ])
    expect(groups.reduce((count, group) => count + group.count, 0)).toBe(records.length)
  })

  it('preserves source IDs and records while browsing a selected form/year or local title filter', () => {
    expect(browseSubmissionSnapshot(records, '3', '2025', '')).toEqual([records[0]])
    expect(browseSubmissionSnapshot(records, '3', UNKNOWN_SUBMISSION_YEAR, '')).toEqual([records[3]])
    expect(browseSubmissionSnapshot(records, '', '', 'SITE 3')[0]).toBe(records[2])
    expect(browseSubmissionSnapshot(records, '9999', '', '')).toEqual([])
    expect(browseSubmissionSnapshot(records, '', '', '')).toEqual(records)
  })

  it('keeps repeated labels distinct by form and field IDs instead of guessing label aliases', () => {
    const groups = snapshotSearchFieldGroups(records)
    expect(groups.map((group) => group.id)).toEqual(['general', 'form:3', 'form:4'])
    const fields = groups[1].fields.filter((field) => field.label.startsWith('Repeated field label'))
    expect(fields).toMatchObject([
      { field: 'field_20', label: 'Repeated field label · Field 20', valueType: 'number', scopeFormId: '3' },
      { field: 'field_21', label: 'Repeated field label · Field 21', valueType: 'boolean', scopeFormId: '3' },
    ])
    expect(new Set(groups.flatMap((group) => group.fields.map((field) => field.id))).size).toBe(
      groups.reduce((sum, group) => sum + group.fields.length, 0),
    )
  })

  it('compiles picked form fields into existing Form ID and field_ID operands with typed false/zero', () => {
    const numeric = compileSearchClause({
      kind: 'field',
      field: 'field_20',
      scopeFormId: '3',
      operator: '=',
      value: '0',
      valueType: 'number',
    })
    const boolean = compileSearchClause({
      kind: 'field',
      field: 'field_21',
      scopeFormId: '4',
      operator: '=',
      value: 'false',
      valueType: 'boolean',
    })
    expect(numeric).toBe('({Form ID} = 3 AND {field_20} = 0)')
    expect(parsePortalSearch(numeric)).toMatchObject({
      token: 'AND',
      left: { left: { token: 'column', value: 'Form ID' } },
      right: { left: { value: 'field_20' }, right: { token: 'number' } },
    })
    expect(filterSubmissionSnapshot(records, numeric).map((record) => record.id)).toEqual(['1'])
    expect(filterSubmissionSnapshot(records, boolean).map((record) => record.id)).toEqual(['3'])
    expect(
      compileSearchClause({ kind: 'field', field: 'Submission ID', operator: '>=', value: '1', valueType: 'number' }),
    ).toBe('{Submission ID} >= 1')
  })

  it('rejects invalid form scopes and leaves nonnegative-number constraints unchanged', () => {
    for (const scopeFormId of ['-1', '0', '3 OR 1', '9007199254740993'])
      expect(() =>
        compileSearchClause({
          kind: 'field',
          field: 'field_20',
          scopeFormId,
          operator: '=',
          value: '0',
          valueType: 'number',
        }),
      ).toThrow(/form ID/)
    expect(() =>
      compileSearchClause({
        kind: 'field',
        field: 'field_20',
        scopeFormId: '3',
        operator: '=',
        value: '-1',
        valueType: 'number',
      }),
    ).toThrow(/nonnegative/)
  })
})
