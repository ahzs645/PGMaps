import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import type { CurrentAssessment } from './currentAnalysis'
import { comparisonInputSnapshots, currentSnapshot, readCurrentAssessment, shinySnapshot } from './comparisonAdapters'
import { compareSnapshots, serializeComparisonSnapshot } from './comparison'
import { createReportAnalysis, parseShinyReport } from './shinyReport'

const periods = ['1961', '1991', '2021', '2041', '2061', '2081']
const vectors = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1],
  [0.5, 0.5, 0, 0],
  [0, 1, 0, 0],
]
const csv = [
  [
    'SiteRef',
    'SS_NoSpace',
    'Spp',
    'Curr',
    ...periods.flatMap((p) => ['1', '2', '3', 'X'].map((c) => `${c}_${p}`)),
    'EstabFeas',
    'ccissFeas',
    'Improve',
    'Decline',
  ].join(','),
  ['1', 'A/01', 'Pl', 2, ...vectors.flat(), 2, 3, 50, 50].join(','),
].join('\n')
function assessment(): CurrentAssessment {
  const row = parseShinyReport(csv).rows[0]
  return {
    siteId: 1,
    bgc: 'A',
    series: 'A/01',
    species: [row],
    overlap: [{ period: '2041', predictedBgc: 'B', predictedSeries: 'B/01', probability: 1 }],
    bgcProbabilities: periods.map((period) => ({ period, bgc: 'A', probability: 1, members: 1 })),
    summaries: [
      {
        species: 'Pl',
        summary: {
          establishment: 2,
          maturation: 3,
          establishmentScore: 2.25,
          maturationScore: 2.85,
          improve: 50,
          decline: 50,
        },
      },
    ],
    warnings: ['Synthetic independent test input'],
    capabilities: { predictions: true, siteSeries: true, suitability: true, summaries: true },
    provenance: {
      datasetVersion: 'synthetic-test',
      source: 'Independent vectors',
      synthetic: true,
      versionMatched: true,
    },
  }
}

describe('typed comparison adapters', () => {
  it('freezes exact current values, provenance and settings independently of later edits', () => {
    const calculation = assessment(),
      settings = { siteId: 1, series: 'A/01', modelWeights: { model: 3 }, noveltyCutoff: null }
    const snapshot = currentSnapshot(calculation, { id: 'current-a', settings, sourceFile: 'synthetic.json' })
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(snapshot.provenance.synthetic).toBe(true)
    expect(snapshot.context.settings).toEqual(settings)
    expect(snapshot.context.summaryBasis).toContain('before display scaling')
    expect(snapshot.periods['1991']).toMatchObject({ startYear: null, endYear: null })
    expect(snapshot.provenance.limitations?.join(' ')).toContain('conflicting observed-period labels')
    calculation.species[0].votes['2041']![0] = 0.25
    settings.modelWeights.model = 99
    expect(
      snapshot.metrics.find(
        (metric) => metric.measure === 'species.vote' && metric.period === '2041' && metric.dimensions.class === '1',
      )?.value,
    ).toBe(0)
    expect(snapshot.context.settings).toMatchObject({ modelWeights: { model: 3 } })
    expect(snapshot.probabilityGroups?.every((group) => group.complete && group.entity === null)).toBe(true)
    expect(JSON.parse(serializeComparisonSnapshot(snapshot))).toEqual(snapshot)
  })
  it('compares current snapshots by semantic keys and retains synthetic and unknown input limits', () => {
    const first = currentSnapshot(assessment(), { id: 'first' }),
      altered = assessment()
    altered.species[0].votes['2041'] = [0, 0.25, 0, 0.75]
    altered.summaries[0].summary!.maturation = 2
    const second = currentSnapshot(altered, { id: 'second' })
    const comparison = compareSnapshots(first, second)
    expect(
      comparison.rows.find(
        (row) =>
          row.metric.measure === 'species.vote' && row.metric.period === '2041' && row.metric.dimensions.class === '2',
      )?.delta,
    ).toBe(25)
    expect(comparison.rows.find((row) => row.metric.measure === 'species.summary.maturation.current')?.delta).toBe(-1)
    expect(comparison.warnings.join(' ')).toContain('Synthetic')
    expect(
      comparison.rows.find((row) => row.metric.measure === 'species.summary.establishment.current')?.delta,
    ).toBeNull()
    expect(comparison.rows.find((row) => row.metric.measure === 'species.baseline')?.delta).toBe(0)
  })
  it('labels default captures with model/scenario choices while retaining full settings', () => {
    const snapshot = currentSnapshot(assessment(), {
      settings: {
        siteId: 1,
        series: 'A/01',
        modelWeights: { modelA: 0, modelB: 1 },
        scenarioWeights: { ssp245: 1, ssp585: 0 },
      },
    })
    expect(snapshot.label).toContain('modelB')
    expect(snapshot.label).toContain('ssp245')
    const long = 'long-model-name'.repeat(12)
    const shortLabel = currentSnapshot(assessment(), { settings: { siteId: 1, modelWeights: { [long]: 1 } } })
    expect(shortLabel.label.length).toBeLessThanOrEqual(200)
    expect(shortLabel.context.settings).toMatchObject({ modelWeights: { [long]: 1 } })
  })
  it('keeps original Shiny and browser-reweighted summary measures distinct with explicit capture mode', () => {
    const report = parseShinyReport(csv)
    const original = shinySnapshot(report, { site: '1', series: 'A/01', summarySource: 'original', synthetic: true })
    const weighted = shinySnapshot(report, {
      site: '1',
      series: 'A/01',
      summarySource: 'browser',
      establishmentWeights: [10, 0, 0],
      synthetic: true,
    })
    expect(original.context.summarySource).toBe('original')
    expect(weighted.context.summarySource).toBe('browser')
    expect(original.metrics.find((metric) => metric.measure === 'species.summary.establishment.shiny')?.value).toBe(2)
    expect(
      weighted.metrics.find((metric) => metric.measure === 'species.summary.establishment.reweighted')?.value,
    ).toBe(1)
    expect(weighted.metrics.some((metric) => metric.measure.endsWith('.shiny'))).toBe(false)
    const mixed = compareSnapshots(currentSnapshot(assessment()), original)
    expect(mixed.compatible).toBe(false)
    expect(mixed.rows.every((row) => row.delta === null)).toBe(true)
  })
  it('retains original historical periods with unknown bounds and does not invent unavailable novelty', () => {
    const real = gunzipSync(
      readFileSync('vendor/bcdatamapper/datascrapers/bc/cciss/output/report-examples/williams-lake-raw.csv.gz'),
    ).toString()
    const report = parseShinyReport(real)
    const snapshot = shinySnapshot(report, {
      site: '4812311',
      series: 'IDFxm/01',
      source: 'Williams Lake',
      reference: true,
    })
    expect(Object.keys(snapshot.periods)).toEqual(['1975', '2000', '2025', '2055', '2085'])
    expect(snapshot.periods['2055']).toMatchObject({ startYear: null, endYear: null })
    expect(
      snapshot.metrics
        .filter((metric) => metric.measure === 'species.novelty')
        .every((metric) => metric.value === null),
    ).toBe(true)
    expect(compareSnapshots(snapshot, snapshot).rows.every((row) => row.delta === null)).toBe(true)
    expect(() => shinySnapshot(report, { site: 'missing', series: 'IDFxm/01' })).toThrow('exact site')
  })
  it('validates actual current calculation exports instead of casting formatted tables', () => {
    const calculation = assessment()
    const value = {
      schema: 'cciss-current-analysis-report-v1',
      sourceFile: 'synthetic.json',
      selection: {
        siteId: 1,
        series: 'A/01',
        establishmentWeights: [0.25, 0.25, 0.5],
        maturationWeights: [0.1, 0.3, 0.3, 0.3],
      },
      calculation,
      tables: [{ title: 'misleading formatted values', rows: [['100%']] }],
    }
    const [snapshot] = comparisonInputSnapshots(JSON.stringify(value))
    expect(snapshot.family).toBe('current-analysis')
    expect(snapshot.provenance.synthetic).toBe(true)
    expect(snapshot.metrics.find((metric) => metric.measure === 'species.summary.improve.current')?.value).toBe(0.5)
    expect(comparisonInputSnapshots(serializeComparisonSnapshot(snapshot))).toEqual([snapshot])
    expect(() => comparisonInputSnapshots(JSON.stringify({ ...value, calculation: value.tables }))).toThrow(
      'Current calculation',
    )
    expect(() =>
      comparisonInputSnapshots(JSON.stringify({ ...value, selection: { siteId: 2, series: 'A/01' } })),
    ).toThrow('different sites')
    expect(() =>
      readCurrentAssessment({
        ...calculation,
        species: [{ ...calculation.species[0], votes: { '2041': [0, '0.5', 0, 0.5] } }],
      }),
    ).toThrow('invalid number')
    expect(() =>
      readCurrentAssessment({ ...calculation, species: [...calculation.species, ...calculation.species] }),
    ).toThrow('assessment site and series')
  })
  it('imports every site from report-analysis JSON using saved weights and rejects ambiguous or fabricated result shapes', () => {
    const report = parseShinyReport(csv + '\n' + csv.split('\n')[1].replace('1,A/01', '2,A/02'))
    const exported = createReportAnalysis(report, 'source.zip / cciss_export.csv', [10, 0, 0])
    const snapshots = comparisonInputSnapshots(JSON.stringify(exported))
    expect(snapshots.map((snapshot) => snapshot.context.site)).toEqual(['1', '2'])
    expect(snapshots[0].context.establishmentWeights).toEqual([10, 0, 0])
    expect(
      snapshots[0].metrics.find((metric) => metric.measure === 'species.summary.establishment.reweighted')?.value,
    ).toBe(1)
    const duplicate = { ...exported, report: { ...report, rows: [report.rows[0], report.rows[0]] } }
    expect(() => comparisonInputSnapshots(JSON.stringify(duplicate))).toThrow('Duplicate')
    expect(() =>
      comparisonInputSnapshots(JSON.stringify({ ...exported, policy: { ...exported.policy, id: 'invented' } })),
    ).toThrow('Unsupported exported summary policy')
    expect(() => comparisonInputSnapshots('{"schema":"unknown","tables":[[1,2,3]]}')).toThrow(
      'Supported comparison JSON',
    )
  })
  it('round-trips comparison exports from validated snapshots and ignores forged derived claims', () => {
    const left = currentSnapshot(assessment(), { id: 'left' }),
      changed = assessment()
    changed.species[0].votes['2041'] = [0, 0.25, 0, 0.75]
    const right = currentSnapshot(changed, { id: 'right' })
    const exported = {
      schema: 'cciss-comparison-report-v1',
      left,
      right,
      comparison: { compatible: true, scientificParityVerified: true, rows: [{ delta: 999999 }] },
    }
    const imported = comparisonInputSnapshots(JSON.stringify(exported))
    expect(imported).toEqual([left, right])
    const recomputed = compareSnapshots(imported[0], imported[1])
    expect(recomputed.rows.some((row) => row.delta === 999999)).toBe(false)
    expect(
      recomputed.rows.find(
        (row) =>
          row.metric.measure === 'species.vote' && row.metric.period === '2041' && row.metric.dimensions.class === '2',
      )?.delta,
    ).toBe(25)
    expect(() =>
      comparisonInputSnapshots(JSON.stringify({ ...exported, right: { ...right, metrics: [{ measure: 'forged' }] } })),
    ).toThrow()
  })
})
