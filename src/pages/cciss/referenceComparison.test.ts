import { describe, expect, it } from 'vitest'
import type { CurrentAssessment } from './currentAnalysis'
import { parseShinyReport } from './shinyReport'
import { compareShinyReference, DEFAULT_REFERENCE_TOLERANCE, MAX_REFERENCE_TOLERANCE } from './referenceComparison'

const periods = ['1961', '1991', '2021', '2041', '2061', '2081']
const votes = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1],
  [0.5, 0.5, 0, 0],
  [0, 1, 0, 0],
]
function reference(site = '1', series = 'A/01') {
  return parseShinyReport(
    [
      [
        'SiteRef',
        'SS_NoSpace',
        'Spp',
        'Curr',
        ...periods.flatMap((p) => ['1', '2', '3', 'X', 'NOV'].map((c) => `${c}_${p}`)),
        'EstabFeas',
        'ccissFeas',
        'Improve',
        'Decline',
      ].join(','),
      [site, series, 'Pl', 2, ...votes.flatMap((vote) => [...vote, 0]), 2, 3, 50, 50].join(','),
    ].join('\n'),
  )
}
function assessment(): CurrentAssessment {
  const row = reference().rows[0]
  return {
    siteId: 1,
    bgc: 'A',
    series: 'A/01',
    species: [row],
    overlap: [],
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
      source: 'Independent hand-calculated vectors',
      synthetic: true,
      versionMatched: true,
    },
  }
}

describe('current calculation against original imported Shiny fields', () => {
  it('joins exact keys independently of row order and never upgrades field agreement to scientific parity', () => {
    const report = reference()
    report.periods.reverse()
    const result = compareShinyReference(assessment(), report)
    expect(result.counts).toEqual({
      matched: 35,
      withinTolerance: 35,
      different: 0,
      missingBrowser: 0,
      missingReference: 0,
      bothMissing: 0,
    })
    expect(result.maxAbsDifferenceByMeasure).toEqual({
      baseline: 0,
      vote: 0,
      novelty: 0,
      establishment: 0,
      maturation: 0,
      improve: 0,
      decline: 0,
    })
    expect(result.scientificParityVerified).toBe(false)
    expect(result.warnings.join(' ')).toContain('parameters are unverified')
    expect(result.warnings.join(' ')).toContain('Synthetic')
  })
  it('compares displayed votes and original conditional summaries without reweighting or de-scaling reference values', () => {
    const current = assessment(),
      report = reference()
    current.species[0].votes['2041'] = [0, 0, 0, 0.5]
    current.species[0].novelty['2041'] = 0.5
    report.rows[0].votes['2041'] = [0, 0, 0, 0.5]
    report.rows[0].novelty['2041'] = 0.5
    const result = compareShinyReference(current, report)
    expect(result.counts.different).toBe(0)
    expect(
      result.rows.find((row) => row.measure === 'vote' && row.period === '2041' && row.class === 'X'),
    ).toMatchObject({ browser: 0.5, reference: 0.5, difference: 0 })
    expect(result.rows.find((row) => row.measure === 'maturation')).toMatchObject({
      browser: 3,
      reference: 3,
      status: 'within-tolerance',
    })
  })
  it('keeps absent novelty, votes and original summaries missing instead of inferring zeros or recomputing them', () => {
    const current = assessment(),
      report = reference()
    delete report.rows[0].novelty['2041']
    report.rows[0].votes['2061'] = null
    delete report.rows[0].original.EstabFeas
    current.species[0].votes['2021'] = null
    report.rows[0].votes['2021'] = null
    const result = compareShinyReference(current, report)
    expect(result.rows.find((row) => row.measure === 'novelty' && row.period === '2041')).toMatchObject({
      reference: null,
      status: 'reference-missing',
      difference: null,
    })
    expect(result.rows.find((row) => row.measure === 'establishment')).toMatchObject({
      reference: null,
      status: 'reference-missing',
    })
    expect(
      result.rows
        .filter((row) => row.measure === 'vote' && row.period === '2021')
        .every((row) => row.status === 'both-missing'),
    ).toBe(true)
    expect(result.counts.bothMissing).toBe(4)
    expect(result.counts.missingReference).toBe(6)
  })
  it('requires explicit user confirmation to map a custom SiteRef while retaining both IDs and exact series', () => {
    const report = reference('my-field-site')
    const strict = compareShinyReference(assessment(), report, {
      referenceSite: 'my-field-site',
      referenceSeries: 'A/01',
    })
    expect(strict.counts.matched).toBe(0)
    expect(strict.alignment.aliasApplied).toBe(false)
    const mapped = compareShinyReference(assessment(), report, {
      referenceSite: 'my-field-site',
      referenceSeries: 'A/01',
      siteMappingConfirmed: true,
    })
    expect(mapped.counts.withinTolerance).toBe(35)
    expect(mapped.alignment).toMatchObject({
      browserSite: '1',
      referenceSite: 'my-field-site',
      siteMappingConfirmed: true,
      aliasApplied: true,
    })
    expect(mapped.rows.every((row) => row.site === '1' && row.referenceSite === 'my-field-site')).toBe(true)
    expect(mapped.warnings.join(' ')).toContain('User-asserted site mapping')
    const differentSeries = compareShinyReference(assessment(), reference('my-field-site', 'A/02'), {
      referenceSite: 'my-field-site',
      siteMappingConfirmed: true,
    })
    expect(differentSeries.counts.matched).toBe(0)
    expect(() => compareShinyReference(assessment(), report, { siteMappingConfirmed: true })).toThrow(
      'explicit reference SiteRef',
    )
  })
  it('does not remap historical periods and leaves unrelated species/site keys unmatched', () => {
    const report = reference()
    report.periods = ['2055']
    report.rows[0].votes = { '2055': [0.5, 0.5, 0, 0] }
    report.rows[0].novelty = { '2055': 0 }
    const result = compareShinyReference(assessment(), report)
    expect(
      result.rows
        .filter((row) => row.period === '2055')
        .every((row) => row.browser === null && row.status === 'browser-missing'),
    ).toBe(true)
    expect(
      result.rows
        .filter((row) => row.period === '2061')
        .every((row) => row.reference === null && row.status === 'reference-missing'),
    ).toBe(true)
    report.rows[0].species = 'Fd'
    expect(compareShinyReference(assessment(), report).counts.matched).toBe(0)
  })
  it('uses adjustable absolute probability tolerance, exact classes and per-measure maxima', () => {
    const current = assessment(),
      report = reference()
    report.rows[0].votes['1961'] = [1 - DEFAULT_REFERENCE_TOLERANCE / 2, DEFAULT_REFERENCE_TOLERANCE / 2, 0, 0]
    report.rows[0].original.Improve = '49.5'
    report.rows[0].original.EstabFeas = '3'
    const strict = compareShinyReference(current, report)
    expect(strict.counts.different).toBe(2)
    expect(strict.maxAbsDifferenceByMeasure.improve).toBeCloseTo(0.005)
    expect(strict.maxAbsDifferenceByMeasure.establishment).toBe(1)
    const relaxed = compareShinyReference(current, report, { tolerance: MAX_REFERENCE_TOLERANCE })
    expect(relaxed.counts.different).toBe(1)
    expect(relaxed.rows.find((row) => row.measure === 'establishment')?.difference).toBe(-1)
    for (const tolerance of [-1, NaN, Infinity, MAX_REFERENCE_TOLERANCE + 0.001])
      expect(() => compareShinyReference(current, report, { tolerance })).toThrow('tolerance')
  })
  it('normalizes source unsuitable encodings while retaining explicit supplier metadata limits', () => {
    const current = assessment(),
      report = reference()
    current.species[0].current = 4
    current.summaries[0].summary!.establishment = 4
    report.rows[0].current = 5
    report.rows[0].original.EstabFeas = 'X'
    const result = compareShinyReference(current, report, {
      referenceMetadata: {
        datasetVersion: 'other',
        ccissrCommit: 'other',
        shinyCommit: 'other',
        parametersVerified: true,
      },
    })
    expect(result.rows.find((row) => row.measure === 'baseline')?.difference).toBe(0)
    expect(result.rows.find((row) => row.measure === 'establishment')?.difference).toBe(0)
    expect(result.warnings.join(' ')).toContain('not been independently verified')
    expect(result.warnings.join(' ')).toContain('differs')
    expect(result.scientificParityVerified).toBe(false)
    expect(() => compareShinyReference(current, report, { settings: { siteId: 2, series: 'A/01' } })).toThrow(
      'settings',
    )
  })
})
