import type { ComparisonResult, ComparisonRow, ComparisonSnapshot, ComparisonValue } from './comparison'

export interface ComparisonReport {
  schema: 'cciss-comparison-report-v1'
  generatedAt: string
  intent: 'explore' | 'reference'
  left: ComparisonSnapshot
  right: ComparisonSnapshot
  comparison: ComparisonResult
  notes: string[]
}

const number = (value: number) => Number(value.toPrecision(10)).toString()
const escapeHtml = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  )

export function comparisonValue(value: ComparisonValue, row: ComparisonRow, side?: 'left' | 'right'): string {
  if (value === null) return 'Missing'
  if (typeof value !== 'number') return value
  const metric = side ? (row[side] ?? row.metric) : row.metric
  if (metric.unit === 'probability') return `${number(value * 100)}%`
  if (metric.unit === 'class' && metric.scale === 'cciss-suitability-1-4')
    return (
      ({ 1: 'High', 2: 'Moderate', 3: 'Low', 4: 'Unsuitable' } as Record<number, string>)[value] ?? `Class ${value}`
    )
  return number(value)
}

export function comparisonDelta(row: ComparisonRow): string {
  if (row.metric.unit === 'class' || row.metric.unit === 'category')
    return row.compatible && row.leftValue !== null && row.rightValue !== null
      ? `${comparisonValue(row.leftValue, row)} → ${comparisonValue(row.rightValue, row)}`
      : 'Not calculated'
  if (row.delta === null) return 'Not calculated'
  return `${row.delta > 0 ? '+' : ''}${number(row.delta)}${row.deltaUnit === 'percentage-points' ? ' pp' : ''}`
}

export function comparisonJson(report: ComparisonReport): string {
  return JSON.stringify(report, null, 2)
}

/** Keep numbers numeric; neutralize formula-like text from imported labels. */
function csvCell(value: ComparisonValue | boolean): string {
  if (value === null) return ''
  const text = typeof value === 'string' && /^[\s]*[=+\-@\t\r]/.test(value) ? `'${value}` : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function comparisonCsv(report: ComparisonReport): string {
  const rows: (ComparisonValue | boolean)[][] = [
    [
      'A label',
      'B label',
      'Measure',
      'Entity',
      'Dimensions',
      'Period ID',
      'A unit',
      'B unit',
      'A scale',
      'B scale',
      'A value',
      'B value',
      'B minus A',
      'Delta unit',
      'Compatible',
      'Interpretation',
      'Reason',
      'A inferred zero',
      'B inferred zero',
    ],
    ...report.comparison.rows.map((row) => [
      report.left.label,
      report.right.label,
      row.metric.measure,
      row.metric.entity,
      JSON.stringify(row.metric.dimensions),
      row.metric.period,
      row.left?.unit ?? null,
      row.right?.unit ?? null,
      row.left?.scale ?? null,
      row.right?.scale ?? null,
      row.leftValue,
      row.rightValue,
      row.delta,
      row.deltaUnit,
      row.compatible,
      row.interpretation,
      row.reason,
      row.leftImputed,
      row.rightImputed,
    ]),
  ]
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
}

export function comparisonHtml(report: ComparisonReport): string {
  const side = (snapshot: ComparisonSnapshot, label: string) =>
    `<section><h2>${label}: ${escapeHtml(snapshot.label)}</h2><p>Source: ${escapeHtml(snapshot.provenance.source)} · Family: ${escapeHtml(snapshot.family)} · Version: ${escapeHtml(snapshot.provenance.version ?? 'Unknown')}</p>${snapshot.provenance.synthetic ? '<p><strong>Synthetic verification data.</strong></p>' : ''}<pre>${escapeHtml(JSON.stringify({ context: snapshot.context, provenance: snapshot.provenance, periods: snapshot.periods }, null, 2))}</pre></section>`
  const warnings = [...report.notes, ...report.comparison.warnings]
  const table = report.comparison.rows
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row.metric.label ?? row.metric.measure)}</td><td>${escapeHtml(row.metric.entity)}</td><td>${escapeHtml(JSON.stringify(row.metric.dimensions))}</td><td>${escapeHtml(row.metric.period ?? 'Summary')}</td><td>${escapeHtml(row.left?.unit ?? 'Missing')}</td><td>${escapeHtml(row.right?.unit ?? 'Missing')}</td><td>${escapeHtml(comparisonValue(row.leftValue, row, 'left'))}${row.leftImputed ? ' (inferred zero)' : ''}</td><td>${escapeHtml(comparisonValue(row.rightValue, row, 'right'))}${row.rightImputed ? ' (inferred zero)' : ''}</td><td>${escapeHtml(comparisonDelta(row))}</td><td>${escapeHtml(row.reason ?? row.interpretation)}</td></tr>`,
    )
    .join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CCISS comparison</title><style>body{font:14px system-ui,sans-serif;max-width:1400px;margin:30px auto;padding:0 20px;line-height:1.5}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th,td{border:1px solid #cbd2cc;padding:6px;text-align:left;vertical-align:top}th{background:#f0f4ef}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;background:#f5f6f4;padding:12px}h2{break-after:avoid}.notice{padding:12px;border:1px solid #c2c8bd;background:#f7f8f2}@media print{body{margin:0;padding:0;max-width:none}tr{break-inside:avoid}}</style></head><body><h1>CCISS comparison</h1><p>Generated: ${escapeHtml(report.generatedAt)} · Intent: ${report.intent === 'reference' ? 'Shiny reference difference check' : 'Sites, models and settings'}</p><div class="notice"><p>Changes are B minus A. Probability changes use percentage points; ordinal ratings are category transitions. No global agreement with Shiny is asserted.</p><ul>${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul></div>${side(report.left, 'A')}${side(report.right, 'B')}<h2>Aligned results</h2><table><thead><tr>${['Measure', 'Entity', 'Dimensions', 'Period', 'A unit', 'B unit', 'A', 'B', 'Change', 'Status'].map((value) => `<th scope="col">${value}</th>`).join('')}</tr></thead><tbody>${table}</tbody></table></body></html>`
}
