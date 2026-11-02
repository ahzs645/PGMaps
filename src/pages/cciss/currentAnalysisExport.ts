/** Presentation-neutral export shared by the current-data dialog and future callers. */
export interface CurrentAnalysisTable {
  title: string
  columns: string[]
  rows: (string | number | null)[][]
}

export interface CurrentAnalysisReport {
  schema: 'cciss-current-analysis-report-v1'
  generatedAt: string
  sourceFile: string
  provenance: Record<string, string | number | boolean | null>
  selection: Record<string, unknown>
  capabilities: string[]
  limitations: string[]
  tables: CurrentAnalysisTable[]
  /** Original numeric outputs stay unrounded in JSON, independently of presentation. */
  calculation: unknown
}

const escapeHtml = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  )

export function currentAnalysisJson(report: CurrentAnalysisReport): string {
  return JSON.stringify(report, null, 2)
}

export function currentAnalysisHtml(report: CurrentAnalysisReport): string {
  const definitions = (values: Record<string, unknown>) =>
    Object.entries(values)
      .map(
        ([key, value]) =>
          `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(
            value === null ? 'Not provided' : typeof value === 'object' ? JSON.stringify(value) : value,
          )}</dd>`,
      )
      .join('')
  const list = (values: string[]) => `<ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join('')}</ul>`
  const tables = report.tables
    .map(
      (table) =>
        `<section><h2>${escapeHtml(table.title)}</h2><table><thead><tr>${table.columns
          .map((column) => `<th scope="col">${escapeHtml(column)}</th>`)
          .join('')}</tr></thead><tbody>${table.rows
          .map(
            (row) =>
              `<tr>${row.map((value) => `<td>${escapeHtml(value === null ? 'No data' : value)}</td>`).join('')}</tr>`,
          )
          .join('')}</tbody></table></section>`,
    )
    .join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CCISS imported-data assessment</title><style>body{font:14px system-ui,sans-serif;max-width:1200px;margin:32px auto;padding:0 20px;line-height:1.5;color:#17221b}h1{font-size:26px}h2{font-size:19px;margin-top:28px}table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}th,td{border:1px solid #cbd2cc;padding:7px;text-align:left;vertical-align:top}th{background:#f0f4ef}dl{display:grid;grid-template-columns:minmax(120px,1fr) 3fr;gap:4px 16px}dt{font-weight:600}dd{margin:0;overflow-wrap:anywhere}.notice{padding:12px;border:1px solid #c2c8bd;background:#f7f8f2}@media print{body{margin:0;padding:0;max-width:none}tr{break-inside:avoid}th{print-color-adjust:exact}h2{break-after:avoid}}</style></head><body><h1>CCISS imported-data assessment</h1><p>Source file: ${escapeHtml(report.sourceFile)} · Generated: ${escapeHtml(report.generatedAt)}</p><div class="notice"><p>Calculated locally from the imported dataset. Availability of a calculation does not establish agreement with the deployed Shiny application.</p>${list(report.limitations)}</div><h2>Dataset and validation</h2><dl>${definitions(report.provenance)}</dl><h2>Assessment settings</h2><dl>${definitions(report.selection)}</dl><h2>Available calculations</h2>${list(report.capabilities)}${tables}</body></html>`
}
