import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { csvParse } from 'd3'
import { describe, expect, it } from 'vitest'
import { comparePublishedPeriodRatings, publishedConsistencyCsv } from './publishedConsistency'
import { parseShinyReport, type ShinyReport } from './shinyReport'

const header = 'SiteNo,SS_NoSpace,Spp,FuturePeriod,Curr,NewSuit,1,2,3,X'
const parse = (...rows: string[]) => parseShinyReport([header, ...rows].join('\n'))

describe('published historical per-period class consistency', () => {
  it('checks the real unchanged published file and excludes rounded input without remapping periods', () => {
    const text = gunzipSync(
      readFileSync('vendor/bcdatamapper/datascrapers/bc/cciss/output/report-examples/williams-lake-raw.csv.gz'),
    ).toString()
    const result = comparePublishedPeriodRatings(parseShinyReport(text))
    expect(result.available).toBe(true)
    expect(result.counts).toEqual({ total: 1879, compared: 1580, matched: 1580, different: 0, skipped: 299 })
    expect([...new Set(result.rows.map((row) => row.period))].sort()).toEqual(['1975', '2000', '2025', '2055', '2085'])
    expect(
      result.rows.find(
        (row) => row.site === '4812311' && row.series === 'IDFxm/01' && row.species === 'Ac' && row.period === '2055',
      ),
    ).toMatchObject({ votes: [0, 0, 0.03, 0.97], sourceClass: 4, derivedClass: 4, status: 'match' })
    expect(
      result.rows
        .filter((row) => row.status === 'skipped')
        .every((row) => row.reason?.includes('rounded or incomplete')),
    ).toBe(true)
    expect(result.limitations.join(' ')).toContain('does not establish')
  })

  it('uses independently calculated ties-to-even and preserves categorical differences', () => {
    const result = comparePublishedPeriodRatings(
      parse(
        'site,S/01,Pine,2025,NA,2,0.5,0.5,0,0', // 1.5 -> 2; no baseline needed.
        'site,S/01,Pine,2055,NA,2,0,0.5,0.5,0', // 2.5 -> 2.
        'site,S/01,Pine,2085,NA,3,0,0,0.75,0.25', // 3.5 -> 4, differs from source 3.
        'site,S/01,Fir,2085,1,X,0,0,0,1',
      ),
    )
    expect(result.rows.map((row) => [row.score, row.derivedClass, row.sourceClass, row.status])).toEqual([
      [1.5, 2, 2, 'match'],
      [2.5, 2, 2, 'match'],
      [3.5, 4, 3, 'difference'],
      [5, 4, 4, 'match'],
    ])
    expect(result.counts).toEqual({ total: 4, compared: 4, matched: 3, different: 1, skipped: 0 })
  })

  it('retains unknown values and excludes zero, incomplete, novelty-scaled and missing references', () => {
    const report = parse(
      'site,S/01,missing,2025,1,2,NA,0.5,0.5,0',
      'site,S/01,zero,2025,1,4,0,0,0,0',
      'site,S/01,rounded,2025,1,2,0.33,0.33,0.33,0',
      'site,S/01,no-reference,2025,1,NA,1,0,0,0',
    )
    const rows = report.input!.rows
    rows.push({ ...rows[0], Spp: 'novel', NewSuit: '1', '1': '0.5', '2': '0', '3': '0', X: '0', NOV: '0.5' })
    rows.push({ ...rows[0], Spp: 'unknown-novelty', '1': '1', '2': '0', '3': '0', X: '0', NOV: 'NA' })
    const result = comparePublishedPeriodRatings(report)
    expect(result.counts.compared).toBe(0)
    expect(result.counts.skipped).toBe(6)
    expect(result.rows[0]).toMatchObject({ votes: null, score: null, derivedClass: null, sourceClass: 2 })
    expect(result.rows[1]).toMatchObject({ votes: [0, 0, 0, 0], score: null, derivedClass: null })
    expect(result.rows[3].sourceClass).toBeNull()
    expect(result.rows[4].reason).toContain('Novelty-scaled')
    expect(result.rows[5].reason).toContain('novelty value is missing')
  })

  it('rejects malformed direct-call data and duplicate reference identities', () => {
    const report = parse('site,S/01,Pine,2025,1,1,1,0,0,0')
    const input = report.input!
    input.rows.push({ ...input.rows[0] })
    for (const [species, value] of [
      ['fractional', '2.5'],
      ['zero', '0'],
      ['nonfinite', 'Infinity'],
    ])
      input.rows.push({ ...input.rows[0], Spp: species, NewSuit: value })
    input.rows.push({ ...input.rows[0], Spp: 'invalid-vote', '1': 'Infinity' })
    const result = comparePublishedPeriodRatings(report)
    expect(result.counts.compared).toBe(0)
    expect(result.rows.slice(0, 2).every((row) => row.reason?.includes('Duplicate'))).toBe(true)
    expect(result.rows.at(-1)?.reason).toContain('finite values')
  })

  it('requires original historical class records and does not reinterpret current fractional scores', () => {
    const noInput: ShinyReport = { format: 'historical-raw', periods: ['2025'], rows: [] }
    expect(comparePublishedPeriodRatings(noInput)).toMatchObject({
      available: false,
      reason: expect.stringContaining('Original CSV rows'),
    })
    const noReference = parseShinyReport(header.replace(',NewSuit', '') + '\nsite,S/01,Pine,2025,1,1,0,0,0')
    expect(comparePublishedPeriodRatings(noReference).reason).toContain('no published per-period NewSuit')
    const wide = parseShinyReport('SiteRef,SS_NoSpace,Spp,Curr,1_2021,2_2021,3_2021,X_2021\nsite,S/01,Pine,1,1,0,0,0')
    expect(comparePublishedPeriodRatings(wide)).toMatchObject({
      available: false,
      reason: expect.stringContaining('different score convention'),
    })
  })

  it('exports exact identities, missing values, votes, class differences and skip reasons', () => {
    const report = parse('site,S/01,Pine,2025,1,2,1,0,0,0', 'site,S/01,Fir,2055,1,NA,1,0,0,0')
    const csv = csvParse(publishedConsistencyCsv(comparePublishedPeriodRatings(report)))
    expect(csv[0]).toMatchObject({
      Site: 'site',
      'Original period': '2025',
      Status: 'difference',
      Score: '1',
      'Derived class': '1',
      'Published class': '2',
    })
    expect(csv[1]).toMatchObject({
      Score: '',
      'Derived class': '',
      'Published class': '',
      'Original published value': 'NA',
      Status: 'skipped',
    })
    expect(csv[1].Reason).toContain('missing')
  })
})
