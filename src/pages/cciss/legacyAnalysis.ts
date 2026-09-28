export type Edatope = 'B2' | 'C4' | 'D6'
export interface LegacyReference {
  levels: (string | null)[]
  sites: Record<string, Record<Edatope, string>>
  ratings: Record<string, Record<string, number | null>>
  names: Record<string, string>
}
export interface LegacyRaster {
  model: string
  period: string
  scenario: string
  run: string | null
  file: string
}
export interface LegacyManifest {
  schema: 'cciss-legacy-analysis-v1'
  reference: { file: string }
  regions: { id: string; file: string }[]
  rasters: LegacyRaster[]
}
export interface SummaryTable {
  columns: string[]
  rows: { id: Record<string, string>; values: (number | null)[] }[]
}
export interface LegacyRegion {
  tables: Record<string, SummaryTable>
}

/** Shiny uses levels.bgc[code] (R's one-based indexing). */
export function bgcLabel(reference: LegacyReference, code: number): string | null {
  if (!Number.isInteger(code) || code < 1) return null
  const label = reference.levels[code - 1]
  return label && label !== '(None)' ? label : null
}

/** Port of the selected-model branch in spatial_app/app.R:707–724.
 * Missing species/site matches remain unknown, never silently unsuitable.
 */
export function legacyRating(reference: LegacyReference, bgc: string, edatope: Edatope, species: string) {
  const site = reference.sites[bgc]?.[edatope]
  const value = site ? reference.ratings[species.substring(0, 2)]?.[site] : null
  return value != null && Number.isFinite(value) ? value : null
}
export const ratingLabel = (value: number | null) =>
  value == null
    ? 'No rating'
    : value === 1
      ? 'High'
      : value === 2
        ? 'Moderate'
        : value === 3
          ? 'Low'
          : value === 4
            ? 'Unsuitable'
            : `Rating ${value}`

const identity = (r: SummaryTable['rows'][number]) =>
  ['GCM', 'SSP', 'RUN', 'PERIOD'].map((k) => r.id[k] ?? '').join('|')
/** Port of persistence = home / baseline; expansion = (total-home) / baseline.
 * Raw values are grid-cell summaries, not hectares or site probabilities.
 */
export function regionalOutlook(region: LegacyRegion, edatope: Edatope, species: string, model: string) {
  const total = region.tables[`PredSum.spp.${edatope}`]
  const home = region.tables[`PredSum.spp.home.${edatope}`]
  if (!total || !home) return []
  const column = total.columns.indexOf(species)
  const homeColumn = home.columns.indexOf(species)
  if (column < 0 || homeColumn < 0) return []
  const baselineRows = total.rows.filter((r) => r.id.GCM === 'obs' && r.id.PERIOD === '1961_1990')
  const baseline = baselineRows.length === 1 ? baselineRows[0].values[column] : null
  const homes = new Map(home.rows.map((r) => [identity(r), r.values[homeColumn]]))
  return total.rows
    .filter((r) => r.id.GCM === model)
    .map((r) => {
      const count = r.values[column]
      const retained = homes.get(identity(r)) ?? null
      const valid = baseline != null && baseline > 0 && count != null && retained != null
      return {
        PERIOD: r.id.PERIOD,
        RUN: r.id.RUN,
        GCM: r.id.GCM,
        SSP: r.id.SSP,
        total: count,
        baseline,
        persistence: valid ? retained / baseline : null,
        expansion: valid ? (count - retained) / baseline : null,
      }
    })
    .sort((a, b) => (a.PERIOD ?? '').localeCompare(b.PERIOD ?? '') || (a.RUN ?? '').localeCompare(b.RUN ?? ''))
}
