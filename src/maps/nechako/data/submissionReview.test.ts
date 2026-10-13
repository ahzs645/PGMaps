import { describe, expect, it } from 'vitest'
import {
  fieldIssue,
  fieldLinks,
  formReportCsv,
  formReportHtml,
  formReportRows,
  formReportStatistics,
  parseReviewForm,
  buildDraftReview,
  type FormReport,
} from './submissionReview'
import { buildFormReportArchive } from './formReportExport'

// Definition shape verified anonymously against getForm.php id39, October 12, 2026.
// Data values used below are deliberate fixtures, not protected submission bodies.
const nativeForm = {
  success: true,
  status: 'success',
  attributes: {
    name: 'nechako_subbasin',
    nodes: [
      {
        field_id: 561,
        form_id: 39,
        field_type: 'text',
        field_label: 'Sub-basin Name',
        nodeInfo: { node_is_dynamic: true, node_name: 'dynamiccontentNode.form' },
      },
      {
        field_id: 562,
        form_id: 39,
        field_type: 'text',
        field_label: 'Comments',
        nodeInfo: { node_is_dynamic: true, node_name: 'dynamiccontentNode.form' },
      },
      {
        field_id: 563,
        form_id: 39,
        field_type: 'htmleditor',
        field_label: 'Other Notes',
        nodeInfo: { node_is_dynamic: true, node_name: 'dynamiccontentNode.form' },
      },
      {
        field_id: 564,
        field_type: '5',
        field_label: 'Attachments',
        nodeInfo: { node_is_dynamic: false, node_name: 'attachmentsNode.form' },
      },
    ],
  },
  loggedIn: false,
}

describe('Native source form and local draft review', () => {
  it('preserves verified native field IDs/order/types and distinguishes workflow nodes', () => {
    const form = parseReviewForm(nativeForm)
    expect(form.title).toBe('nechako_subbasin')
    expect(form.fields.map(({ id, type }) => [id, type])).toEqual([
      ['561', 'text'],
      ['562', 'text'],
      ['563', 'htmleditor'],
    ])
    expect(form.staticNodes).toEqual(['attachmentsNode.form'])
    expect(form.original).toEqual(nativeForm)
    const schema = parseReviewForm({
      success: true,
      status: 'success',
      attributes: [
        { attr_id: 87, attr_name: 'year', attr_type: 'bigint', linked_to_name: null, link_type: null },
        { attr_id: 93, attr_name: 'mean_temp_c', attr_type: 'double precision', linked_to_name: null, link_type: null },
      ],
    })
    expect(schema.fields[0]).toMatchObject({ id: '87', label: 'year', type: 'bigint' })
    expect(() => parseReviewForm({ success: false, error: 'Denied', attributes: {} })).toThrow('Denied')
  })

  it('retains original columns, values and large numeric strings while flagging declared type/required/duplicate issues', () => {
    const form = parseReviewForm({
      id: 'local-review',
      title: 'Review',
      fields: [
        { id: 'name', label: 'Name', type: 'text', required: true },
        { id: 'large', label: 'Large value', type: 'bigint' },
        { id: 'date', label: 'Date', type: 'date' },
        { id: 'flag', label: 'Flag', type: 'checkbox' },
      ],
    })
    const source = [
      { Title: 'A', Key: 'dup', N: '9007199254740993', Date: '2024-02-29', Flag: false, Unmapped: '=2+2' },
      { Title: '', Key: 'dup', N: '1.5', Date: '2024-02-31', Flag: 'maybe', Unmapped: null },
    ]
    const review = buildDraftReview(
      form,
      { name: 'Title', large: 'N', date: 'Date', flag: 'Flag' },
      source,
      'sample.csv',
      'Key',
    )
    expect(review.publication).toBe('not-submitted')
    expect(review.drafts[0].source).toEqual(source[0])
    expect(review.drafts[0].values.large).toBe('9007199254740993')
    expect(review.drafts[0].values.flag).toBe(false)
    expect(review.drafts[1].issues).toHaveLength(5)
    expect(buildDraftReview(form, {}, source, 'sample').drafts[0].issues).toContain(
      'No source values are mapped to target fields',
    )
    expect(() => buildDraftReview(form, { invented: 'Title' }, source, 'sample')).toThrow('unknown target')
    expect(() =>
      buildDraftReview(
        form,
        {},
        Array.from({ length: 10_001 }, () => ({})),
        'sample',
      ),
    ).toThrow('10,000')
  })

  it('validates calendar dates/numerics without coercing source text or inventing undeclared requirements', () => {
    const field = parseReviewForm({ fields: [{ id: 1, label: 'Temperature', type: 'double precision' }] }).fields[0]
    expect(fieldIssue(field, null)).toBeUndefined()
    expect(fieldIssue(field, '0')).toBeUndefined()
    expect(fieldIssue(field, 'Infinity')).toBe('Invalid numeric value')
    expect(() => parseReviewForm({ fields: [{ id: 1 }, { id: 1 }] })).toThrow('unique')
    expect(() => parseReviewForm({ fields: [{ id: 9007199254740992 }] })).toThrow('invalid')
  })

  it('derives citation links only from supplied DOI/HTTPS values and refuses scripts/credential URLs', () => {
    expect(fieldLinks('DOI', '10.1234/example')).toEqual(['https://doi.org/10.1234/example'])
    expect(fieldLinks('Title', '10.1234/example')).toEqual([])
    expect(fieldLinks('URL', 'javascript:alert(1) https://user:password@example.com/a')).toEqual([])
  })
})

describe('Native form report export', () => {
  const original = {
    statistics: { results: 4, sum: { Count: 0 }, count: { Basin: 2 } },
    rows: {
      '1477': {
        'Submitted Time': '2024-01-01',
        'Submission Title': 'Example',
        'Submission Name': '',
        Basin: 'Café <script>alert(1)</script>',
        Count: 0,
      },
      '1478': { 'Submitted Time': null, 'Submission Title': 'Other', Basin: '=2+2', Count: false },
    },
  }
  const report: FormReport = {
    title: 'Source <report>',
    source: 'Deliberate response fixture',
    formId: '39',
    mapping: { '561': 'Basin', '999': 'Count' },
    rows: formReportRows(original),
    original,
  }

  it('preserves native row IDs, zero, false and null and accepts source error/empty semantics', () => {
    expect(report.rows.map((row) => row['Submission ID'])).toEqual(['1477', '1478'])
    expect(report.rows[0].Count).toBe(0)
    expect(report.rows[1].Count).toBe(false)
    expect(formReportStatistics(report)).toEqual(original.statistics)
    expect(report.rows).toHaveLength(2)
    expect(formReportRows({ rows: {} })).toEqual([])
    expect(() => formReportRows({ attributes: {}, success: false, error: 'Not permitted' })).toThrow('Not permitted')
    expect(() => formReportRows({ rows: [] })).toThrow('keyed')
  })

  it('exports complete escaped Unicode HTML and formula-safe CSV without executing source markup', () => {
    const html = formReportHtml(report),
      csv = formReportCsv(report)
    expect(html).toContain('Café &lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).toContain('1478')
    expect(html).toContain('false')
    expect(csv).toContain('"\'=2+2"')
    expect(csv).toContain('"0"')
  })

  it('creates a source-review ZIP with returned data and presets, without claiming attachment/GIS bodies', async () => {
    const archive = await buildFormReportArchive(report)
    const { default: JSZip } = await import('jszip')
    const zip = await JSZip.loadAsync(await archive.arrayBuffer())
    expect(Object.keys(zip.files).sort()).toEqual([
      'README.txt',
      'report-preset.json',
      'report.csv',
      'report.html',
      'returned-source-attributes.json',
    ])
    expect(JSON.parse(await zip.file('returned-source-attributes.json')!.async('string'))).toEqual(original)
    expect(await zip.file('README.txt')!.async('string')).toContain(
      'contains no downloaded external attachments or GIS files',
    )
  })
})
