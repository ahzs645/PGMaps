import type { CurrentProvenance, CurrentSettings } from './currentAnalysis'
import type { ReferenceComparison, ReferenceComparisonRow } from './referenceComparison'

export interface ReferenceComparisonReport {
  schema: 'cciss-shiny-reference-report-v1'
  generatedAt: string
  browserSource: string
  referenceSource: string
  browserProvenance: CurrentProvenance
  browserSettings: CurrentSettings
  referenceMetadata: { datasetVersion?: string; ccissrCommit?: string; shinyCommit?: string; parametersVerified: false }
  comparison: ReferenceComparison
}

const escapeHtml = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  )
const number = (value: number) => Number(value.toPrecision(10)).toString()

export function referenceValue(value: number | null, row: ReferenceComparisonRow): string {
  if (value === null) return 'Missing'
  if (row.unit === 'probability') return `${number(value * 100)}%`
  return ({ 1: 'High', 2: 'Moderate', 3: 'Low', 4: 'Unsuitable' } as Record<number, string>)[value] ?? `Class ${value}`
}

export function referenceDelta(row: ReferenceComparisonRow): string {
  if (row.difference === null) return 'Not calculated'
  if (row.unit === 'class') return `${referenceValue(row.reference, row)} → ${referenceValue(row.browser, row)}`
  const points = row.difference * 100
  return `${points > 0 ? '+' : ''}${number(points)} pp`
}

export const referenceComparisonJson = (report: ReferenceComparisonReport) => JSON.stringify(report, null, 2)

export function referenceComparisonCsv(report: ReferenceComparisonReport): string {
  const cell = (value: unknown) => {
    if (value === null || value === undefined) return ''
    const text = typeof value === 'string' && /^[\s]*[=+\-@\t\r]/.test(value) ? `'${value}` : String(value)
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  return [
    [
      'Aligned site',
      'Original reference SiteRef',
      'Site series',
      'Species',
      'Period ID',
      'Measure',
      'Class',
      'Browser value',
      'Reference value',
      'Browser minus reference',
      'Unit',
      'Status',
      'Probability tolerance (fraction)',
      'Site alias asserted',
      'Scientific parity verified',
    ],
    ...report.comparison.rows.map((row) => [
      row.site,
      row.referenceSite,
      row.series,
      row.species,
      row.period,
      row.measure,
      row.class,
      row.browser,
      row.reference,
      row.difference,
      row.unit,
      row.status,
      report.comparison.tolerance,
      report.comparison.alignment.siteMappingConfirmed,
      false,
    ]),
  ]
    .map((row) => row.map(cell).join(','))
    .join('\r\n')
}

export function referenceComparisonHtml(report: ReferenceComparisonReport): string {
  const comparison = report.comparison
  const rows = comparison.rows
    .map(
      (row) =>
        `<tr>${[
          row.site,
          row.referenceSite,
          row.series,
          row.species,
          row.period ?? 'Summary',
          row.measure,
          row.class,
          referenceValue(row.browser, row),
          referenceValue(row.reference, row),
          referenceDelta(row),
          row.status,
        ]
          .map((value) => `<td>${escapeHtml(value === null ? 'Missing' : value)}</td>`)
          .join('')}</tr>`,
    )
    .join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CCISS Shiny reference differences</title><style>body{font:14px system-ui,sans-serif;max-width:1500px;margin:30px auto;padding:0 20px;line-height:1.5}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}td,th{border:1px solid #cbd2cc;padding:6px;text-align:left;vertical-align:top}th{background:#f0f4ef}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f6f4;padding:12px}.notice{padding:12px;border:1px solid #c2c8bd;background:#f7f8f2}@media print{body{margin:0;padding:0}tr{break-inside:avoid}}</style></head><body><h1>CCISS Shiny reference differences</h1><p>Generated: ${escapeHtml(report.generatedAt)}</p><p>Browser source: ${escapeHtml(report.browserSource)} · Reference source: ${escapeHtml(report.referenceSource)}</p><div class="notice"><p><strong>Scientific parity verified: false.</strong> Differences are browser minus reference. Probability changes use percentage points; classes use category transitions. Class comparisons remain exact.</p><p>Probability tolerance: ${escapeHtml(number(comparison.tolerance * 100))} pp.</p><ul>${comparison.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul></div><h2>Counts</h2><pre>${escapeHtml(JSON.stringify(comparison.counts, null, 2))}</pre><h2>Scope, versions and settings</h2><pre>${escapeHtml(JSON.stringify({ alignment: comparison.alignment, browserProvenance: report.browserProvenance, browserSettings: report.browserSettings, referenceMetadata: report.referenceMetadata }, null, 2))}</pre><h2>Exact-field comparison</h2><table><thead><tr>${['Aligned site', 'Original reference SiteRef', 'Site series', 'Species', 'Period', 'Measure', 'Class', 'Browser', 'Reference', 'Difference', 'Status'].map((value) => `<th scope="col">${value}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></body></html>`
}
