// Site-condition keys are supplied by the dataset (B2/C4/D6 in the bundled snapshot).
export type Edatope = string
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
  role?: 'reference' | 'observed' | 'projection' | 'aggregate'
}
export interface LegacyManifest {
  schema: 'cciss-legacy-analysis-v1'
  reference: { file: string }
  regions: { id: string; file: string; label?: string }[]
  rasters: LegacyRaster[]
}
export interface SummaryTable {
  columns: string[]
  rows: { id: Record<string, string>; values: (number | null)[] }[]
}
export interface LegacyRegion {
  tables: Record<string, SummaryTable>
}

export function legacyRasterRole(raster: LegacyRaster): NonNullable<LegacyRaster['role']> {
  if (raster.role) return raster.role
  if (raster.model === 'Reference') return 'reference'
  if (raster.model === 'Observed') return 'observed'
  if (/ensemble/i.test(raster.model) || /ensemble/i.test(raster.run ?? '')) return 'aggregate'
  return 'projection'
}

/** Preserve dataset order; summary columns define the supported comparison roster. */
export function legacySpecies(reference: LegacyReference, region: LegacyRegion | undefined, edatope: Edatope) {
  return [...new Set(region?.tables[`PredSum.spp.${edatope}`]?.columns ?? Object.keys(reference.ratings))].filter(
    (species) => species !== 'X',
  )
}

export function legacySiteConditions(reference: LegacyReference, region?: LegacyRegion) {
  return [
    ...new Set([
      ...Object.values(reference.sites).flatMap((site) => Object.keys(site)),
      ...Object.keys(region?.tables ?? {}).flatMap((key) => /^PredSum\.spp\.(?!home\.)(.+)$/.exec(key)?.slice(1) ?? []),
    ]),
  ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}

/** Human-readable names are optional; unfamiliar dataset codes stay visible verbatim. */
export function legacyConditionLabel(edatope: Edatope) {
  const known: Record<string, string> = { B2: 'Poor / subxeric', C4: 'Medium / mesic', D6: 'Rich / hygric' }
  return known[edatope] ? `${edatope} · ${known[edatope]}` : edatope
}
export function legacyScenarioLabel(scenario: string) {
  const ssp = /^ssp(\d)(\d)(\d)$/i.exec(scenario)
  return ssp ? `SSP${ssp[1]}-${ssp[2]}.${ssp[3]}` : scenario
}

export function preferredLegacyOption(options: string[], preferred: string) {
  return options.includes(preferred) ? preferred : (options[0] ?? '')
}

/** Validate resource identity before fetching; ambiguous members would silently mislabel results. */
export function validateLegacyManifest(value: LegacyManifest): LegacyManifest {
  const file = (path: unknown) =>
    typeof path === 'string' &&
    path.length > 0 &&
    !path.startsWith('/') &&
    !/^[a-z]+:|[\\?#%]/i.test(path) &&
    !path.split('/').some((part) => part === '..' || part === '.' || !part)
  if (!value || value.schema !== 'cciss-legacy-analysis-v1') throw new Error('Unsupported legacy dataset')
  if (!value.reference || !file(value.reference.file) || !Array.isArray(value.regions) || !Array.isArray(value.rasters))
    throw new Error('Legacy dataset needs reference, regions and raster definitions.')
  const regions = new Set<string>(),
    rasters = new Set<string>()
  for (const region of value.regions) {
    if (!region || typeof region.id !== 'string' || !region.id.trim() || !file(region.file) || regions.has(region.id))
      throw new Error('Invalid or duplicate legacy region.')
    regions.add(region.id)
  }
  for (const raster of value.rasters) {
    if (
      !raster ||
      !file(raster.file) ||
      !['model', 'period', 'scenario'].every(
        (key) =>
          typeof raster[key as keyof LegacyRaster] === 'string' && String(raster[key as keyof LegacyRaster]).trim(),
      ) ||
      (raster.run !== null && typeof raster.run !== 'string') ||
      (raster.role !== undefined && !['reference', 'observed', 'projection', 'aggregate'].includes(raster.role))
    )
      throw new Error('Invalid legacy raster definition.')
    const identity = JSON.stringify([
      legacyRasterRole(raster),
      raster.model,
      raster.scenario,
      raster.run,
      raster.period,
    ])
    if (rasters.has(identity)) throw new Error('Duplicate legacy model/scenario/run/period.')
    rasters.add(identity)
  }
  if (!value.rasters.some((raster) => legacyRasterRole(raster) === 'projection'))
    throw new Error('Legacy dataset contains no model projections.')
  return value
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
export function regionalOutlook(
  region: LegacyRegion,
  edatope: Edatope,
  species: string,
  model: string,
  selection?: { scenario?: string; run?: string | null; baselinePeriod?: string },
) {
  const total = region.tables[`PredSum.spp.${edatope}`]
  const home = region.tables[`PredSum.spp.home.${edatope}`]
  if (!total || !home) return []
  const column = total.columns.indexOf(species)
  const homeColumn = home.columns.indexOf(species)
  if (column < 0 || homeColumn < 0) return []
  const baselinePeriod =
    selection?.baselinePeriod ??
    total.rows
      .filter((r) => r.id.GCM === 'obs')
      .map((r) => r.id.PERIOD)
      .sort()[0]
  const baselineRows = total.rows.filter((r) => r.id.GCM === 'obs' && r.id.PERIOD === baselinePeriod)
  const baseline = baselineRows.length === 1 ? baselineRows[0].values[column] : null
  const homes = new Map(home.rows.map((r) => [identity(r), r.values[homeColumn]]))
  return total.rows
    .filter(
      (r) =>
        r.id.GCM === model &&
        (selection?.scenario === undefined || r.id.SSP === selection.scenario) &&
        (selection?.run === undefined || r.id.RUN === selection.run),
    )
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
        baselinePeriod,
        persistence: valid ? retained / baseline : null,
        expansion: valid ? (count - retained) / baseline : null,
      }
    })
    .sort((a, b) => (a.PERIOD ?? '').localeCompare(b.PERIOD ?? '') || (a.RUN ?? '').localeCompare(b.RUN ?? ''))
}
