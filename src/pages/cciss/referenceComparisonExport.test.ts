import { describe, expect, it } from 'vitest'
import {
  referenceComparisonCsv,
  referenceComparisonHtml,
  referenceComparisonJson,
  referenceDelta,
  type ReferenceComparisonReport,
} from './referenceComparisonExport'

const report: ReferenceComparisonReport = {
  schema: 'cciss-shiny-reference-report-v1',
  generatedAt: '2026-11-02T00:00:00Z',
  browserSource: '<browser>.json',
  referenceSource: 'reference.csv',
  browserProvenance: {
    source: 'Synthetic verification',
    datasetVersion: 'test',
    versionMatched: true,
    synthetic: true,
  },
  browserSettings: { siteId: 42, series: 'TEST/01' },
  referenceMetadata: { parametersVerified: false },
  comparison: {
    schema: 'cciss-shiny-reference-comparison-v1',
    tolerance: 1e-8,
    counts: { matched: 1, withinTolerance: 0, different: 1, missingBrowser: 0, missingReference: 0, bothMissing: 0 },
    maxAbsDifferenceByMeasure: { vote: 0.2 },
    warnings: ['User asserted <alias>; parameters remain unverified.'],
    scientificParityVerified: false,
    alignment: {
      browserSite: '42',
      referenceSite: 'User label',
      browserSeries: 'TEST/01',
      referenceSeries: 'TEST/01',
      siteMappingConfirmed: true,
      aliasApplied: true,
    },
    rows: [
      {
        key: 'a',
        site: '42',
        referenceSite: 'User label',
        series: 'TEST/01',
        species: 'TESTa',
        period: '2021',
        measure: 'vote',
        class: '1',
        browser: 0.7,
        reference: 0.5,
        difference: 0.2,
        status: 'different',
        unit: 'probability',
      },
    ],
  },
}

describe('Shiny reference comparison exports', () => {
  it('retains original IDs, full precision, tolerance and unverified provenance', () => {
    expect(JSON.parse(referenceComparisonJson(report))).toEqual(report)
    const csv = referenceComparisonCsv(report)
    expect(csv).toContain('42,User label,TEST/01,TESTa,2021,vote,1,0.7,0.5,0.2,probability,different,1e-8,true,false')
    expect(referenceDelta(report.comparison.rows[0])).toBe('+20 pp')
  })

  it('escapes HTML and shows classes as reference-to-browser transitions', () => {
    const html = referenceComparisonHtml(report)
    expect(html).toContain('&lt;browser&gt;.json')
    expect(html).toContain('User asserted &lt;alias&gt;')
    expect(html).toContain('Scientific parity verified: false')
    expect(
      referenceDelta({ ...report.comparison.rows[0], unit: 'class', browser: 1, reference: 3, difference: -2 }),
    ).toBe('Low → High')
  })
})
