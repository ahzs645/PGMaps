import { describe, expect, it } from 'vitest'
import { formReportGraph, formReportGraphOptions, type FormReportGraphOption } from './formReportGraph'
import { formReportRows, type FormReport } from './submissionReview'

function report(original: Record<string, unknown>): FormReport {
  return {
    title: 'Fixture report',
    source: 'Synthetic source fixture',
    formId: '39',
    mapping: { '561': 'Basin', '562': 'Count' },
    rows: formReportRows(original),
    original,
  }
}
const rowOption: FormReportGraphOption = { kind: 'rows', key: 'Count', label: 'Returned rows · Count' }

describe('native form report graphs', () => {
  it('plots exact numeric observations in original positions while preserving IDs and missing/non-numeric cells', () => {
    const original = {
      rows: {
        '11': { Count: 0, Basin: 'North' },
        '12': { Count: false },
        '13': { Count: null },
        '14': { Count: ' ' },
        '15': { Count: '-2.5' },
        '16': { Count: '2e1' },
        '17': { Count: '=1+1' },
      },
    }
    const source = report(original)
    expect(formReportGraphOptions(source).options).toEqual([rowOption])
    const graph = formReportGraph(source, rowOption)
    expect(graph.points).toEqual([
      { x: 1, y: 0, label: 'Submission 11', original: 0 },
      { x: 5, y: -2.5, label: 'Submission 15', original: '-2.5' },
      { x: 6, y: 20, label: 'Submission 16', original: '2e1' },
    ])
    expect(graph.considered).toBe(7)
    expect(graph.excluded).toBe(4)
    expect(source.original).toEqual(original)
    expect(source.rows[1].Count).toBe(false)
    expect(source.rows[2].Count).toBeNull()
  })

  it('keeps source result counts separate from submission rows and never recomputes source sums', () => {
    const source = report({
      rows: { '11': { Count: 4 }, '12': { Count: 5 } },
      statistics: { results: 9, sum: { Count: 0 }, count: { Basin: '2', Unknown: null }, unsupported: { nested: {} } },
    })
    const choices = formReportGraphOptions(source)
    expect(choices.statisticsNote).toContain('1 source statistic group')
    const result = formReportGraph(source, choices.options.find((option) => option.key === 'results')!)
    expect(result.points.map((point) => point.y)).toEqual([9])
    expect(result.points[0].label).toBe('results')
    expect(source.rows).toHaveLength(2)
    expect(formReportGraph(source, choices.options.find((option) => option.key === 'sum')!).points[0].y).toBe(0)
    const count = formReportGraph(source, choices.options.find((option) => option.key === 'count')!)
    expect(count.points).toEqual([{ x: 1, y: 2, label: 'Basin', original: '2' }])
    expect(count.excluded).toBe(1)
  })

  it('reports unsupported statistics honestly and rejects unknown selections and unsafe numeric conversions', () => {
    const source = report({
      rows: {
        '11': { Count: '9007199254740993' },
        '12': { Count: Infinity },
        '13': { Count: '1e-400' },
        '14': { Count: [] },
        '15': { Count: true },
        '16': { Count: '1.0000000000000001' },
      },
      statistics: [{ count: 3 }],
    })
    expect(formReportGraphOptions(source)).toEqual({
      options: [],
      statisticsNote: 'This source statistics shape is not supported by graphs; inspect it in Table.',
    })
    expect(formReportGraph(source, rowOption).excluded).toBe(6)
    expect(() => formReportGraph(source, { ...rowOption, key: 'invented' })).toThrow('mapped')
    expect(() => formReportGraph(source, { kind: 'statistics', key: 'count', label: '' })).toThrow('returned')
  })

  it('keeps a measured zero visible with non-degenerate axes and never replaces an empty series with a zero', () => {
    const zero = formReportGraph(report({ rows: { '11': { Count: 0 } } }), rowOption)
    expect(zero.points[0].y).toBe(0)
    expect(zero.extent).toEqual([0.5, 1.5, -1, 1])
    const empty = formReportGraph(report({ rows: {} }), rowOption)
    expect(empty.points).toEqual([])
    expect(empty.considered).toBe(0)
  })
})
