import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { csvParse } from 'd3'
import {
  createReportAnalysis,
  parseShinyReport,
  reportAnalysisCsv,
  reportSummaryStatus,
  rRound,
  SHINY_SUMMARY_POLICIES,
  summarizeVotes,
  shinyDefaultWeights,
  SHINY_GCM_WEIGHTS,
  SHINY_SCENARIO_WEIGHTS,
  supportedSummaryPolicies,
  type Votes,
} from './shinyReport'

// Deliberately synthetic votes with independently hand-calculated results.
const periods = ['1961', '1991', '2021', '2041', '2061', '2081']
const votes: Votes[] = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1],
  [0.5, 0.5, 0, 0],
  [0, 1, 0, 0],
]
const header = [
  'SiteRef',
  'SS_NoSpace',
  'Spp',
  'Curr',
  ...periods.flatMap((p) => ['1', '2', '3', 'X'].map((c) => `${c}_${p}`)),
].join(',')
const values = ['test', 'TEST/01', 'Pl', 2, ...votes.flat()].join(',')
const csv = header + '\n' + values
const row = () => parseShinyReport(csv).rows[0]

describe('Shiny report summary stage', () => {
  it('reads the unchanged historical published file and does not remap periods', () => {
    const real = gunzipSync(
      readFileSync('vendor/bcdatamapper/datascrapers/bc/cciss/output/report-examples/williams-lake-raw.csv.gz'),
    ).toString()
    const report = parseShinyReport(real)
    expect(report.format).toBe('historical-raw')
    expect(report.periods).toEqual(['1975', '2000', '2025', '2055', '2085'])
    const ac = report.rows.find((r) => r.site === '4812311' && r.series === 'IDFxm/01' && r.species === 'Ac')!
    expect(ac.votes['2055']).toEqual([0, 0, 0.03, 0.97])
    expect(summarizeVotes(ac)).toBeNull()
    expect(supportedSummaryPolicies(report)).toEqual([])
    expect(report.input?.rows).toHaveLength(real.trim().split('\n').length - 1)
    const analysis = createReportAnalysis(report, 'Published Williams Lake')
    expect(analysis.policy).toBeNull()
    expect(analysis.results.every((result) => result.summary === null)).toBe(true)
    expect(analysis.report.input?.rows.some((r) => r.FuturePeriod === '2055')).toBe(true)
  })
  it('selects a source-backed period policy and explains unavailable summaries per species', () => {
    const report = parseShinyReport(csv)
    const policy = SHINY_SUMMARY_POLICIES[0]
    expect(supportedSummaryPolicies(report)).toEqual([policy])
    expect(reportSummaryStatus(row(), policy)).toContain('Complete exported votes')
    const missing = row()
    delete missing.votes['2041']
    expect(reportSummaryStatus(missing, policy)).toContain('2041')
    const novelty = row()
    novelty.novelty['2041'] = 0.5
    expect(reportSummaryStatus(novelty, policy)).toContain('Novelty-scaled')
    expect(reportSummaryStatus({ ...row(), current: null }, policy)).toContain('baseline')
  })
  it('exports every site with exact original fields, separate browser summaries and both weight forms', () => {
    const augmentedHeader = header + ',EstabFeas,ccissFeas,Improve,Decline,Comment'
    const report = parseShinyReport(
      augmentedHeader + '\n' + values + ',2,3,50,50,"A, B"\n' + values.replace('test,', 'other,') + ',2,3,50,50,other',
    )
    const analysis = createReportAnalysis(report, 'results.zip / nested/cciss_export.csv', [10, 0, 0], [0, 0, 1, 0])
    expect(analysis.results).toHaveLength(2)
    expect(analysis.policy?.establishmentWeights).toEqual([10, 0, 0])
    expect(analysis.normalizedWeights.establishment).toEqual([1, 0, 0])
    const exported = csvParse(reportAnalysisCsv(analysis))
    expect(exported).toHaveLength(2)
    expect(exported[0]).toMatchObject({
      SiteRef: 'test',
      Browser_EstabFeas: '1',
      Original_EstabFeas: '2',
      Original_Comment: 'A, B',
      EstablishmentWeights: '[10,0,0]',
      Source: 'results.zip / nested/cciss_export.csv',
    })
    expect(exported[1].SiteRef).toBe('other')
    expect(parseShinyReport(reportAnalysisCsv(analysis)).rows[0].votes).toEqual(report.rows[0].votes)
    expect(() => createReportAnalysis(report, 'test', [0, 0, 0])).toThrow('positive total')
  })
  it('matches hand calculations using the R source default weights and direction cuts', () => {
    expect(summarizeVotes(row())).toMatchObject({ establishment: 2, maturation: 3, improve: 50, decline: 50 })
    expect(summarizeVotes(row())!.establishmentScore).toBeCloseTo(2.25, 12)
    expect(summarizeVotes(row())!.maturationScore).toBeCloseTo(2.85, 12)
    expect(summarizeVotes({ ...row(), current: 4 })).toMatchObject({ improve: 75, decline: 25 })
  })
  it('normalizes each weight group and leaves direction proportions unweighted', () => {
    expect(summarizeVotes(row(), [10, 0, 0], [0, 0, 10, 0])).toMatchObject({
      establishment: 1,
      maturation: 2,
      improve: 50,
      decline: 50,
    })
    expect(() => summarizeVotes(row(), [0, 0, 0])).toThrow('positive total')
    expect(() => summarizeVotes(row(), [NaN, 0, 1])).toThrow()
    expect(() => summarizeVotes(row(), [Number.MAX_VALUE, Number.MAX_VALUE, 0])).toThrow('positive total')
  })
  it('reproduces R ties-to-even and maps high scores to unsuitable', () => {
    expect([1.5, 2.5, 3.5, 4.5].map(rRound)).toEqual([2, 2, 4, 4])
    expect(summarizeVotes(row(), [0, 0, 1], [0, 1, 0, 0])).toMatchObject({ establishment: 3, maturation: 4 })
  })
  it('seeds model and scenario weights from the Shiny defaults where labels match', () => {
    const models = shinyDefaultWeights(['ACCESS-ESM1-5', 'CanESM5', 'my-model'], SHINY_GCM_WEIGHTS)
    expect(models).toEqual({
      weights: { 'ACCESS-ESM1-5': 1, CanESM5: 0, 'my-model': 1 },
      unmatched: ['my-model'],
      fallback: false,
    })
    expect(shinyDefaultWeights(['ssp126', 'ssp245', 'ssp585'], SHINY_SCENARIO_WEIGHTS).weights).toEqual({
      ssp126: 0.8,
      ssp245: 1,
      ssp585: 0,
    })
    // A bundle offering only options Shiny weights at zero still gets a usable default run.
    expect(shinyDefaultWeights(['ssp585'], SHINY_SCENARIO_WEIGHTS)).toEqual({
      weights: { ssp585: 1 },
      unmatched: [],
      fallback: true,
    })
  })

  it('follows feasibility.R for browser votes in periods where a species has no rating', () => {
    const ALL_PERIODS = new Set(['1961', '1991', '2021', '2041', '2061', '2081'])
    // A species arriving only in later periods: R has no vote rows for 1961/1991/2021.
    const arriving = {
      ...row(),
      current: 4,
      votes: { '2041': [1, 0, 0, 0], '2061': [0, 1, 0, 0], '2081': [0, 0, 1, 0] } as Record<string, Votes>,
      novelty: {},
    }
    // Imported exports may omit periods, so they stay withheld.
    expect(summarizeVotes(arriving)).toBeNull()
    // Establishment: X2 puts every absent period's weight in X (score 5 -> X). Maturation is the weighted mean of
    // the present periods ((1 + 2 + 3) / 3); improve/decline average the present periods only.
    expect(summarizeVotes(arriving, undefined, undefined, undefined, ALL_PERIODS)).toMatchObject({
      establishment: 4,
      establishmentScore: 5,
      maturation: 2,
      maturationScore: 2,
      improve: 100,
      decline: 0,
    })
    // Only 2021 rated: establishment = 0.5 x class 1 + 0.5 (absent 1961/1991) x X = 0.5 + 2.5 = 3.
    const early = { ...arriving, votes: { '2021': [1, 0, 0, 0] } as Record<string, Votes> }
    expect(summarizeVotes(early, undefined, undefined, undefined, ALL_PERIODS)).toMatchObject({
      establishmentScore: 3,
      establishment: 3,
      maturation: 1,
    })
    // R's weighted.mean is NaN when the only present maturation periods carry no weight.
    expect(summarizeVotes(early, undefined, [0, 1, 1, 1], undefined, ALL_PERIODS)).toBeNull()
    // A period whose input data were unavailable (not assessed) still withholds the summary.
    expect(
      summarizeVotes(arriving, undefined, undefined, undefined, new Set(['1991', '2021', '2041', '2061', '2081'])),
    ).toBeNull()
    // Rounded or incomplete votes that are present are still never reweighted.
    expect(
      summarizeVotes(
        { ...arriving, votes: { ...arriving.votes, '2041': [0.33, 0.33, 0.33, 0] } },
        undefined,
        undefined,
        undefined,
        ALL_PERIODS,
      ),
    ).toBeNull()
  })

  it('does not invent summaries for absent, all-zero, rounded or novelty-scaled votes', () => {
    for (const v of [null, [0, 0, 0, 0], [0.33, 0.33, 0.33, 0]]) {
      const r = row()
      r.votes['1961'] = v as Votes | null
      expect(summarizeVotes(r)).toBeNull()
    }
    expect(summarizeVotes({ ...row(), current: null })).toBeNull()
    const novel = parseShinyReport(
      'SiteRef,SS_NoSpace,Spp,Curr,1_2021,2_2021,3_2021,X_2021,NOV_2021\na,TEST/01,Pl,2,0.5,0,0,0,0.5',
    ).rows[0]
    expect(novel.novelty['2021']).toBe(0.5)
    expect(novel.votes['2021']).toEqual([0.5, 0, 0, 0])
    expect(summarizeVotes(novel)).toBeNull()
  })
  it('rejects ambiguous and corrupt imports without accepting arbitrary CSVs', () => {
    expect(() => parseShinyReport('a,b\n1,2')).toThrow('Shiny suitability')
    expect(() => parseShinyReport(csv + '\n' + values)).toThrow('Duplicate')
    expect(() => parseShinyReport(header + ',Curr\n' + values + ',2')).toThrow('Duplicate CSV')
    expect(() => parseShinyReport(csv.replace('test,TEST/01,Pl,2,1,0', 'test,TEST/01,Pl,2,2,0'))).toThrow(
      'between 0 and 1',
    )
    expect(() => parseShinyReport(csv.replace('test,TEST/01,Pl,2,1,0', 'test,TEST/01,Pl,2,0.5,0'))).toThrow(
      'sum to one',
    )
  })
})
