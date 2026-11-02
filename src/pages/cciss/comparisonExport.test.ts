import { describe, expect, it } from 'vitest'
import { compareSnapshots, parseComparisonSnapshot, type ComparisonSnapshot } from './comparison'
import {
  comparisonCsv,
  comparisonDelta,
  comparisonHtml,
  comparisonJson,
  comparisonValue,
  type ComparisonReport,
} from './comparisonExport'

function snapshot(id: string, value: number, unit = 'probability'): ComparisonSnapshot {
  return parseComparisonSnapshot({
    schema: 'cciss-comparison-snapshot-v1',
    id,
    label: id,
    family: 'test',
    provenance: { source: 'Synthetic <source>', method: 'same-test-method', synthetic: true },
    context: { site: id },
    periods: { '2021': { label: '2021–2040', startYear: 2021, endYear: 2040, kind: 'projection' } },
    metrics: [
      {
        measure: 'suitability',
        entity: 'TESTa',
        dimensions: {},
        period: '2021',
        value,
        unit,
        ...(unit === 'class' ? { scale: 'cciss-suitability-1-4', direction: 'lower-better' } : {}),
      },
    ],
  })
}
function report(left: ComparisonSnapshot, right: ComparisonSnapshot): ComparisonReport {
  return {
    schema: 'cciss-comparison-report-v1',
    generatedAt: '2026-11-02T00:00:00Z',
    intent: 'explore',
    left,
    right,
    comparison: compareSnapshots(left, right),
    notes: ['Keep <unknown> values explicit.'],
  }
}

describe('comparison presentation and exports', () => {
  it('shows percentage-point changes and retains exact numeric sources in JSON', () => {
    const result = report(snapshot('A', 0.2), snapshot('B', 0.35))
    expect(comparisonDelta(result.comparison.rows[0])).toBe('+15 pp')
    expect(JSON.parse(comparisonJson(result))).toEqual(result)
    expect(comparisonHtml(result)).toContain('20%')
    expect(comparisonHtml(result)).toContain('35%')
  })

  it('formats incompatible sides using their own units and keeps their units in CSV and HTML', () => {
    const result = report(snapshot('A', 0.5), snapshot('B', 2, 'class'))
    const row = result.comparison.rows[0]
    expect(row.compatible).toBe(false)
    expect(comparisonValue(row.leftValue, row, 'left')).toBe('50%')
    expect(comparisonValue(row.rightValue, row, 'right')).toBe('Moderate')
    expect(comparisonDelta(row)).toBe('Not calculated')
    expect(comparisonHtml(result)).not.toContain('200%')
    expect(comparisonHtml(result)).toContain('<td>Moderate</td>')
    expect(comparisonCsv(result)).toContain('A unit,B unit,A scale,B scale')
    expect(comparisonCsv(result)).toContain('probability,class,,cciss-suitability-1-4')
  })

  it('presents ordinal changes as transitions and escapes untrusted exported text', () => {
    const result = report(snapshot('=IMPORTXML("url")', 1, 'class'), snapshot('<script>bad()</script>', 3, 'class'))
    expect(comparisonDelta(result.comparison.rows[0])).toBe('High → Low')
    const html = comparisonHtml(result)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;bad()&lt;/script&gt;')
    expect(html).toContain('Synthetic &lt;source&gt;')
    expect(html).toContain('Keep &lt;unknown&gt; values explicit.')
    expect(comparisonCsv(result)).toContain("'=IMPORTXML")
  })
})
