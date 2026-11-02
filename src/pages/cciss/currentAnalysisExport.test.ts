import { describe, expect, it } from 'vitest'
import { currentAnalysisHtml, currentAnalysisJson, type CurrentAnalysisReport } from './currentAnalysisExport'

const report: CurrentAnalysisReport = {
  schema: 'cciss-current-analysis-report-v1',
  generatedAt: '2026-11-02T00:00:00.000Z',
  sourceFile: '<source>.json',
  provenance: { source: 'Province & partners', validatedAgainstShiny: false },
  selection: { site: '<script>alert(1)</script>', weights: { model: 0.3333333333333333 } },
  capabilities: ['BGC probabilities'],
  limitations: ['Missing <reference> table'],
  tables: [
    {
      title: '<BGC>',
      columns: ['Period', 'Probability'],
      rows: [
        ['2021–2040', 0.3333333333333333],
        ['Unknown', null],
      ],
    },
  ],
  calculation: { probability: 0.3333333333333333, missing: null },
}

describe('imported-data assessment exports', () => {
  it('preserves source, selection, missing values and unrounded numeric results in JSON', () => {
    expect(JSON.parse(currentAnalysisJson(report))).toEqual(report)
  })

  it('escapes imported labels, retains missing values, and states the validation boundary in printable HTML', () => {
    const html = currentAnalysisHtml(report)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('&lt;source&gt;.json')
    expect(html).toContain('Province &amp; partners')
    expect(html).toContain('&lt;BGC&gt;')
    expect(html).toContain('Missing &lt;reference&gt; table')
    expect(html).toContain('<td>No data</td>')
    expect(html).toContain('does not establish agreement with the deployed Shiny application')
    expect(html).toContain('0.3333333333333333')
  })
})
