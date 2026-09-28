import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { parseShinyReport, rRound, summarizeVotes, type Votes } from './shinyReport'

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
  })
  it('reproduces R ties-to-even and maps high scores to unsuitable', () => {
    expect([1.5, 2.5, 3.5, 4.5].map(rRound)).toEqual([2, 2, 4, 4])
    expect(summarizeVotes(row(), [0, 0, 1], [0, 1, 0, 0])).toMatchObject({ establishment: 3, maturation: 4 })
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
