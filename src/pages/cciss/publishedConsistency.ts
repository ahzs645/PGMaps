import { csvFormatRows } from 'd3'
import { rRound, type ShinyReport, type Votes } from './shinyReport'

export type PublishedRatingClass = 1 | 2 | 3 | 4
export interface PublishedConsistencyRow {
  site: string
  series: string
  species: string
  period: string
  status: 'match' | 'difference' | 'skipped'
  reason: string | null
  score: number | null
  derivedClass: PublishedRatingClass | null
  sourceClass: PublishedRatingClass | null
  sourceValue: string | null
  votes: Votes | null
}
export interface PublishedConsistencyResult {
  available: boolean
  reason: string | null
  method: string
  rows: PublishedConsistencyRow[]
  counts: { total: number; compared: number; matched: number; different: number; skipped: number }
  limitations: string[]
}

export const PUBLISHED_CONSISTENCY_METHOD =
  'Historical period class: round-to-even(high + 2 × moderate + 3 × low + 5 × unsuitable), capped at class 4.'

const LIMITATIONS = [
  'This checks an existing historical file’s vote proportions against its own NewSuit class column. It does not regenerate model predictions, site-series overlaps or Shiny summaries.',
  'Original site, site-series, species and period identifiers are retained. Historical periods are not remapped to the current calculator.',
  'Rounded or incomplete vote totals and novelty-scaled votes are excluded. A matching class does not establish matching unrounded inputs or agreement with the deployed Shiny calculator.',
]

const classNames = ['1', '2', '3', 'X'] as const
const identifier = (row: Record<string, string>) => ({
  site: row.SiteRef || row.SiteNo || '',
  series: row.SS_NoSpace || '',
  species: row.Spp || '',
  period: row.FuturePeriod || '',
})
const key = (row: Record<string, string>) => JSON.stringify(Object.values(identifier(row)))
const missing = (value: string | undefined) =>
  value === undefined || value.trim() === '' || ['NA', 'NaN'].includes(value.trim())

function summarize(rows: PublishedConsistencyRow[], reason: string | null = null): PublishedConsistencyResult {
  const counts = {
    total: rows.length,
    compared: rows.filter((row) => row.status !== 'skipped').length,
    matched: rows.filter((row) => row.status === 'match').length,
    different: rows.filter((row) => row.status === 'difference').length,
    skipped: rows.filter((row) => row.status === 'skipped').length,
  }
  return {
    available: counts.compared > 0,
    reason: reason ?? (counts.compared ? null : 'No rows have complete, unscaled votes and a supported source class.'),
    method: PUBLISHED_CONSISTENCY_METHOD,
    rows,
    counts,
    limitations: [...LIMITATIONS],
  }
}

/** A bounded historical-file consistency check, not an end-to-end parity test.
 * The original raw rows are necessary: SpeciesReport.original preserves just the
 * first long-form row and cannot provide other periods' published NewSuit values.
 * Current wide exports can contain fractional NewSuit scores, so their columns
 * must not be silently interpreted as this historical class convention.
 */
export function comparePublishedPeriodRatings(report: ShinyReport): PublishedConsistencyResult {
  if (!report.input)
    return summarize(
      [],
      'Original CSV rows are unavailable. Reload the historical source CSV to check its published period classes.',
    )
  if (report.format !== 'historical-raw')
    return summarize(
      [],
      'This historical class check requires long-form FuturePeriod and NewSuit columns. Current wide exports use a different score convention and are not checked by this rule.',
    )
  if (!report.input.columns.includes('NewSuit'))
    return summarize([], 'The imported file has no published per-period NewSuit class column to compare.')

  const frequencies = new Map<string, number>()
  for (const row of report.input.rows) frequencies.set(key(row), (frequencies.get(key(row)) ?? 0) + 1)
  const rows = report.input.rows.map((input): PublishedConsistencyRow => {
    const row: PublishedConsistencyRow = {
      ...identifier(input),
      status: 'skipped',
      reason: null,
      score: null,
      derivedClass: null,
      sourceClass: null,
      sourceValue: input.NewSuit ?? null,
      votes: null,
    }
    const skip = (reason: string) => ({ ...row, reason })
    if (!row.site || !row.series || !row.species || !/^\d{4}$/.test(row.period))
      return skip('Missing or unsupported original site, series, species or period identifier.')
    if (frequencies.get(key(input)) !== 1) return skip('Duplicate site, series, species and period rows are ambiguous.')
    if (missing(input.NewSuit)) return skip('The published period class is missing.')
    const sourceClass = input.NewSuit.trim() === 'X' ? 4 : Number(input.NewSuit)
    if (!Number.isInteger(sourceClass) || sourceClass < 1 || sourceClass > 4)
      return skip('The published value is not a supported historical class (1, 2, 3 or X/4).')
    row.sourceClass = sourceClass as PublishedRatingClass
    if ('NOV' in input) {
      if (missing(input.NOV)) return skip('An exported novelty value is missing.')
      const novelty = Number(input.NOV)
      if (!Number.isFinite(novelty) || novelty < 0 || novelty > 1) return skip('The exported novelty value is invalid.')
      if (novelty > 0) return skip('Novelty-scaled display votes cannot reproduce the unscaled published period class.')
    }
    if (classNames.some((name) => missing(input[name]))) return skip('One or more vote proportions are missing.')
    const votes = classNames.map((name) => Number(input[name])) as Votes
    if (votes.some((value) => !Number.isFinite(value) || value < 0 || value > 1))
      return skip('Vote proportions must be finite values from zero to one.')
    row.votes = votes
    if (Math.abs(votes.reduce((sum, value) => sum + value, 0) - 1) > 1e-6)
      return skip('Vote proportions are rounded or incomplete; they are not normalized or repaired.')
    row.score = votes[0] + 2 * votes[1] + 3 * votes[2] + 5 * votes[3]
    row.derivedClass = Math.min(4, rRound(row.score)) as PublishedRatingClass
    row.status = row.derivedClass === row.sourceClass ? 'match' : 'difference'
    return row
  })
  return summarize(rows)
}

export function publishedConsistencyCsv(result: PublishedConsistencyResult): string {
  return csvFormatRows(
    [
      [
        'Site',
        'Site series',
        'Species',
        'Original period',
        'Status',
        'Reason',
        'High',
        'Moderate',
        'Low',
        'Unsuitable',
        'Score',
        'Derived class',
        'Published class',
        'Original published value',
      ],
      ...result.rows.map((row) => [
        row.site,
        row.series,
        row.species,
        row.period,
        row.status,
        row.reason ?? '',
        ...[0, 1, 2, 3].map((index) => row.votes?.[index] ?? ''),
        row.score ?? '',
        row.derivedClass ?? '',
        row.sourceClass ?? '',
        row.sourceValue ?? '',
      ]),
    ].map((row) => row.map(String)),
  )
}
