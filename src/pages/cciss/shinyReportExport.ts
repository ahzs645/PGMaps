import { escapeHtml } from '@/lib/escapeHtml'
import { ratingLabel } from './legacyAnalysis'
import type { ShinyReport, summarizeVotes } from './shinyReport'

type Summary = ReturnType<typeof summarizeVotes>

/**
 * The printable species report for one site and site series: exported votes per period beside the
 * browser's reweighted summaries and the original Shiny summaries, which are never overwritten.
 */
export function shinySpeciesReportHtml({
  report,
  rows,
  summaries,
  source,
  place,
  establishmentWeights,
  maturationWeights,
}: {
  report: ShinyReport
  rows: ShinyReport['rows']
  summaries: (Summary | null)[]
  source: string
  /** The JSON-encoded `[site, series]` pair the rows belong to. */
  place: string
  establishmentWeights: number[]
  maturationWeights: number[]
}): string {
  const headings = [
    'Species',
    'Baseline',
    ...report.periods.map((p) => `Period ${p}: high / moderate / low / unsuitable / novel climate (%)`),
    'Browser establishment',
    'Browser maturation',
    'Browser stable / improving (%)',
    'Browser declining / unsuitable (%)',
    'Original Shiny establishment',
    'Original Shiny maturation',
    'Original Shiny stable / improving (%)',
    'Original Shiny declining / unsuitable (%)',
  ]
  const body = rows
    .map(
      (r, i) =>
        '<tr>' +
        [
          r.species,
          ratingLabel(r.current),
          ...report.periods.map((p) =>
            r.votes[p]
              ? [
                  ...r.votes[p]!.map((v) => (100 * v).toFixed(1)),
                  r.novelty[p] == null ? 'Not exported' : (100 * r.novelty[p]!).toFixed(1),
                ].join(' / ')
              : 'No data',
          ),
          summaries[i] ? ratingLabel(summaries[i]!.establishment) : 'Not calculated',
          summaries[i] ? ratingLabel(summaries[i]!.maturation) : 'Not calculated',
          summaries[i]?.improve ?? 'Not calculated',
          summaries[i]?.decline ?? 'Not calculated',
          r.original.EstabFeas ?? 'Not provided',
          r.original.ccissFeas ?? 'Not provided',
          r.original.Improve ?? 'Not provided',
          r.original.Decline ?? 'Not provided',
        ]
          .map((v) => `<td>${escapeHtml(v)}</td>`)
          .join('') +
        '</tr>',
    )
    .join('')
  return `<!doctype html><meta charset="utf-8"><title>CCISS species report</title><style>body{font:14px system-ui;margin:30px}table{border-collapse:collapse;width:100%}td,th{padding:8px;border:1px solid #ccc;text-align:left}@media print{body{margin:0}}</style><h1>CCISS species report</h1><p>Source: ${escapeHtml(source)}</p><p>Site / series: ${escapeHtml(place)}. Original period identifiers retained. Imported results are not recalculated for the map point.</p><p>Browser summaries use exported vote proportions and period weights, not new climate-model predictions. Historical periods, incomplete votes or novelty-scaled exports give no browser summary.</p><p>Establishment weights: ${escapeHtml(establishmentWeights.join(', '))}; maturation: ${escapeHtml(maturationWeights.join(', '))} (normalized for calculation).</p><table><thead><tr>${headings.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`
}
