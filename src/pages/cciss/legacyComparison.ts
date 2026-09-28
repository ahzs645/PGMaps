import {
  bgcLabel,
  legacyRating,
  ratingLabel,
  type Edatope,
  type LegacyRaster,
  type LegacyReference,
} from './legacyAnalysis'
import type { RasterSample } from './raster'

export interface LegacyPointSample extends LegacyRaster {
  sample: RasterSample
}
export const memberKey = (r: LegacyRaster) => JSON.stringify([r.model, r.run, r.scenario])
export function compareLegacyPoint(
  reference: LegacyReference,
  samples: LegacyPointSample[],
  edatope: Edatope,
  species: string[],
) {
  const resolved = samples.map((r) => ({
    ...r,
    bgc: r.sample.status === 'value' ? bgcLabel(reference, r.sample.value) : null,
  }))
  const baseline = resolved.find((r) => r.model === 'Reference') ?? null
  const observed = resolved.find((r) => r.model === 'Observed') ?? null
  const projections = resolved.filter((r) => r.scenario === 'ssp245')
  const periods = [...new Set(projections.map((r) => r.period))].sort()
  const members = [
    ...new Map(
      projections.map((r) => [memberKey(r), { key: memberKey(r), model: r.model, run: r.run, scenario: r.scenario }]),
    ).values(),
  ]
  const rating = (bgc: string | null | undefined, spp: string) =>
    bgc ? legacyRating(reference, bgc, edatope, spp) : null
  return {
    baseline,
    observed,
    periods,
    members,
    projections,
    species: species.map((spp) => ({
      species: spp,
      name: reference.names[spp] ?? spp,
      baseline: rating(baseline?.bgc, spp),
      observed: rating(observed?.bgc, spp),
      projections: projections.map((r) => ({
        member: memberKey(r),
        model: r.model,
        run: r.run,
        scenario: r.scenario,
        period: r.period,
        bgc: r.bgc,
        rating: rating(r.bgc, spp),
        file: r.file,
      })),
    })),
  }
}
export type LegacyComparison = ReturnType<typeof compareLegacyPoint>
export const LEGACY_LIMITATION =
  'Legacy spatial prototype, SSP2-4.5, 0.025-degree grid. Point results are provisional: BGC labels were reconciled from 37 raster summaries because the bundled codebook disagrees. Not a current CCISS site-series assessment. No ensemble probabilities are calculated.'
export interface LegacyComparisonReport {
  schema: 'cciss-legacy-comparison-v1'
  method: string
  source: string
  dataset: string
  provenance?: unknown
  longitude: number
  latitude: number
  edatope: Edatope
  comparison: LegacyComparison
  regional: {
    region: string
    species: string
    model: string
    trends: ReturnType<typeof import('./legacyAnalysis').regionalOutlook>
  }
}
const escapeHtml = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
/** Standalone report: all sampled members and periods, with unknowns preserved. */
export function legacyComparisonHtml(report: LegacyComparisonReport) {
  const c = report.comparison
  const table = (headers: string[], rows: unknown[][]) =>
    `<table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((v) => `<td>${escapeHtml(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
  const speciesTables = c.members
    .map(
      (m) =>
        `<h2>${escapeHtml(m.model)} · ${escapeHtml(m.run)}</h2>` +
        table(
          ['Species', '1961–1990 baseline', '2001–2020 observed', ...c.periods.map((p) => p.replace('_', '–'))],
          c.species.map((s) => [
            s.species + ' · ' + s.name,
            ratingLabel(s.baseline),
            ratingLabel(s.observed),
            ...c.periods.map((p) =>
              ratingLabel(s.projections.find((r) => r.member === m.key && r.period === p)?.rating ?? null),
            ),
          ]),
        ),
    )
    .join('')
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Legacy CCISS comparison</title><style>body{font:14px system-ui;margin:30px;color:#111}table{border-collapse:collapse;width:100%;margin:15px 0}td,th{border:1px solid #ccc;padding:6px;text-align:left}h2{break-after:avoid}tr{break-inside:avoid}@media print{body{margin:0}thead{display:table-header-group}}</style><h1>Legacy CCISS comparison</h1><p>${escapeHtml(report.method)}</p><p>Source: ${escapeHtml(report.source)}; dataset: ${escapeHtml(report.dataset)}.</p><p>Location: ${report.latitude}, ${report.longitude}; site condition: ${escapeHtml(report.edatope)}.</p><p>Baseline BGC: ${escapeHtml(c.baseline?.bgc ?? 'No data')}; observed BGC: ${escapeHtml(c.observed?.bgc ?? 'No data')}. No rating means missing data, not unsuitable. Model 2001–2020 projections are distinct from observed 2001–2020.</p><h2>BGC projections</h2>${table(
    ['Model / run', ...c.periods],
    c.members.map((m) => [
      m.model + ' · ' + m.run,
      ...c.periods.map((p) => c.projections.find((r) => memberKey(r) === m.key && r.period === p)?.bgc ?? 'No data'),
    ]),
  )}${speciesTables}<h2>Regional outlook</h2><p>Named region: ${escapeHtml(report.regional.region)}; species: ${escapeHtml(report.regional.species)}; model: ${escapeHtml(report.regional.model)}. Regional ratios have a separate geographic scope from the point; counts are grid cells, not hectares. Persistence = home / historical total; expansion = (future total − home) / historical total.</p>${table(
    ['Period', 'Run', 'Persistence', 'Expansion', 'Historical cells', 'Future cells'],
    report.regional.trends.map((r) => [
      r.PERIOD,
      r.RUN,
      r.persistence == null ? 'No ratio' : (100 * r.persistence).toFixed(1) + '%',
      r.expansion == null ? 'No ratio' : (100 * r.expansion).toFixed(1) + '%',
      r.baseline ?? 'No data',
      r.total ?? 'No data',
    ]),
  )}</html>`
}
