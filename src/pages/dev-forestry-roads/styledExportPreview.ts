/**
 * The Save & export preview of a styled GIS export, built from the bundle its download writes: each
 * layer's legend drawn with the symbols the files carry, the files in the zip, and what each format
 * approximated. The symbol library previews as the catalogue itself. Self-contained HTML with no
 * scripts. No DOM or network access.
 */
import type { SheetSymbol } from '@/lib/mapSheet/symbols'
import { symbolSwatchSvg, svgDataUrl } from '@/lib/mapSheet/symbolSvg'
import type { ExchangeDiagnostic, ExchangeFile, RuleFilter } from '@/lib/styleExchange/model'
import type { StyledExportBundle } from './styledExports'
import { screenColour } from '@/lib/screenPage'

const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const swatch = (symbol: SheetSymbol) =>
  `<img class="sw" alt="" width="40" height="20" src="${escape(svgDataUrl(symbolSwatchSvg(symbol, 30, 15)))}">`

export function filterText(filter: RuleFilter | null): string {
  if (!filter) return 'everything else'
  if (filter.op === 'eq') return `${filter.field} = ${JSON.stringify(filter.value)}`
  if (filter.op === 'in') return `${filter.field} in ${filter.values.map((v) => JSON.stringify(v)).join(', ')}`
  const parts = [
    filter.min !== undefined ? `${filter.field} ≥ ${filter.min}` : '',
    filter.max !== undefined ? `${filter.field} < ${filter.max}` : '',
  ].filter(Boolean)
  return parts.join(' and ')
}

const size = (file: ExchangeFile) => {
  const bytes = typeof file.content === 'string' ? new TextEncoder().encode(file.content).length : file.content.length
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} kB`
      : `${(bytes / 1048576).toFixed(1)} MB`
}

function diagnosticsHtml(diagnostics: readonly ExchangeDiagnostic[]) {
  const shown = diagnostics.filter((d) => d.severity !== 'info')
  if (!shown.length) return '<p>Every symbol is written exactly in every format.</p>'
  const seen = new Set<string>()
  const rows = shown
    .map((d) => `<tr><td>${escape(d.format)}</td><td>${escape(d.subject ?? '')}</td><td>${escape(d.message)}</td></tr>`)
    .filter((row) => !seen.has(row) && seen.add(row))
  return `<table><thead><tr><th>Format</th><th>Symbol</th><th>Approximated</th></tr></thead><tbody>${rows.join('')}</tbody></table>`
}

const STYLE = `<style>
body{font:13px/1.45 system-ui,sans-serif;margin:16px;color:${screenColour('fg')};background:${screenColour('bg')}}
h2{font-size:15px;margin:18px 0 6px}h3{font-size:13px;margin:12px 0 4px}
table{border-collapse:collapse;width:100%;margin:4px 0 12px}td,th{border-bottom:1px solid ${screenColour('line')};padding:3px 6px;text-align:left;vertical-align:middle}
th{font-weight:600;color:${screenColour('muted', '#57534e')}}.sw{display:block}.muted{color:${screenColour('muted')}}code{font-size:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:2px 12px}
.grid div{display:flex;gap:8px;align-items:center;min-height:24px}
</style>`

export function styledExportPreviewHtml(title: string, bundle: StyledExportBundle): string {
  const body: string[] = [`<h2>${escape(title)}</h2>`]
  if (bundle.document)
    for (const layer of [...bundle.document.layers].reverse()) {
      body.push(`<h3>${escape(layer.name)} <span class="muted"><code>${escape(layer.id)}</code></span></h3>`)
      body.push(
        `<table><tbody>${layer.rules
          .map(
            (rule) =>
              `<tr><td style="width:48px">${swatch(rule.symbol)}</td><td>${escape(rule.label)}</td><td class="muted">${escape(filterText(rule.filter))}</td></tr>`,
          )
          .join('')}</tbody></table>`,
      )
      if (layer.label) body.push(`<p class="muted">Labelled with ${escape(layer.label.field)}.</p>`)
    }
  if (bundle.library) {
    const categories = new Map<string, typeof bundle.library.symbols>()
    for (const entry of bundle.library.symbols)
      categories.set(entry.category, [...(categories.get(entry.category) ?? []), entry])
    body.push(`<p>${bundle.library.symbols.length} symbols in ${categories.size} groups.</p>`)
    for (const [category, entries] of categories)
      body.push(
        `<h3>${escape(category)}</h3><div class="grid">${entries
          .map((entry) => `<div>${swatch(entry.symbol)}<span>${escape(entry.name)}</span></div>`)
          .join('')}</div>`,
      )
  }
  body.push('<h2>Files</h2>')
  body.push(
    `<table><tbody>${bundle.files
      .filter((file) => !/\.(shx|dbf|prj|cpg)$/.test(file.path))
      .map((file) => `<tr><td><code>${escape(file.path)}</code></td><td class="muted">${size(file)}</td></tr>`)
      .join('')}</tbody></table>`,
  )
  body.push('<h2>What each format approximates</h2>', diagnosticsHtml(bundle.diagnostics))
  return `<!doctype html><html><head><meta charset="utf-8">${STYLE}</head><body>${body.join('')}</body></html>`
}
