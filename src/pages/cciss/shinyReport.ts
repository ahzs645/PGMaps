import { csvFormatRows, csvParse } from 'd3'

// Summary formulas adapted from bcgov/ccissr (Apache-2.0),
// a6ab8ee3a714ebf4a3f41e16f04d9f58404de7ce/R/feasibility.R and src/ccissdev.cpp.
// This port deliberately withholds summaries for incomplete or novelty-scaled votes.

export type Votes = [number, number, number, number]
export interface SpeciesReport {
  site: string
  series: string
  species: string
  current: number | null
  votes: Record<string, Votes | null>
  novelty: Record<string, number | null>
  original: Record<string, string>
}
export interface ShinyReport {
  rows: SpeciesReport[]
  periods: string[]
  format: 'current-export' | 'historical-raw'
  /** Original lexical values, including every long-form row and extra source columns. */
  input?: { columns: string[]; rows: Record<string, string>[] }
}
const classes = ['1', '2', '3', 'X']
function numeric(value: string | undefined): number | null {
  if (value == null || value.trim() === '' || ['NA', 'NaN'].includes(value.trim())) return null
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error(`Invalid number: ${value.slice(0, 40)}`)
  return n
}
function readVotes(row: Record<string, string>, suffix: string, novelty: number | null): Votes | null {
  const v = classes.map((c) => numeric(row[c + suffix]))
  if (v.some((n) => n === null)) return null
  if (v.some((n) => n! < 0 || n! > 1)) throw new Error('Vote proportions must be between 0 and 1.')
  // Older published CSVs round each vote to two decimals; preserve those values.
  if (Math.abs(v.reduce<number>((sum, n) => sum + n!, 0) + (novelty ?? 0) - 1) > 0.021 && v.some((n) => n !== 0))
    throw new Error('Vote proportions do not sum to one.')
  return v as Votes
}
export function parseShinyReport(text: string): ShinyReport {
  if (text.length > 5_000_000) throw new Error('Please select a CSV smaller than 5 MB.')
  const csv = csvParse(text.replace(/^\uFEFF/, ''))
  if (!csv.length || csv.length > 50_000) throw new Error('Expected 1–50,000 CSV rows.')
  if (new Set(csv.columns).size !== csv.columns.length) throw new Error('Duplicate CSV column names.')
  if (!['Spp', 'SS_NoSpace', 'Curr'].every((k) => csv.columns.includes(k)))
    throw new Error('Expected a Shiny suitability CSV with Spp, SS_NoSpace and Curr columns.')
  const long = csv.columns.includes('FuturePeriod') && classes.every((c) => csv.columns.includes(c))
  const periods = long
    ? [...new Set(csv.map((r) => r.FuturePeriod))]
    : [...new Set(csv.columns.flatMap((c) => /^1_(\d{4})$/.exec(c)?.slice(1) ?? []))]
  if (!periods.length || periods.some((p) => !/^\d{4}$/.test(p)))
    throw new Error('No supported period vote columns found.')
  const grouped = new Map<string, SpeciesReport>()
  for (const row of csv) {
    const site = row.SiteRef || row.SiteNo
    if (!site || !row.SS_NoSpace || !row.Spp) throw new Error('Every row needs a site ID, site series and species.')
    const current = row.Curr === 'X' ? 4 : numeric(row.Curr)
    if (current !== null && ![1, 2, 3, 4, 5].includes(current)) throw new Error('Unexpected baseline rating.')
    const key = JSON.stringify([site, row.SS_NoSpace, row.Spp])
    const existing = grouped.get(key)
    if (existing && (!long || existing.current !== current)) throw new Error('Duplicate or inconsistent species rows.')
    const result = existing ?? {
      site,
      series: row.SS_NoSpace,
      species: row.Spp,
      current,
      votes: {},
      novelty: {},
      original: { ...row },
    }
    for (const p of long ? [row.FuturePeriod] : periods) {
      if (p in result.votes) throw new Error('Duplicate species/period row.')
      const novelty = numeric(row[long ? 'NOV' : `NOV_${p}`])
      if (novelty !== null && (novelty < 0 || novelty > 1)) throw new Error('Novelty must be between 0 and 1.')
      result.novelty[p] = novelty
      result.votes[p] = readVotes(row, long ? '' : `_${p}`, novelty)
    }
    grouped.set(key, result)
  }
  return {
    rows: [...grouped.values()],
    periods: periods.sort(),
    format: long ? 'historical-raw' : 'current-export',
    input: { columns: csv.columns, rows: csv.map((row) => ({ ...row })) },
  }
}

/** R round(x, 0) ties-to-even, unlike JavaScript Math.round. */
export function rRound(x: number): number {
  const floor = Math.floor(x)
  return x - floor === 0.5 ? floor + (floor % 2) : Math.round(x)
}
export const voteScore = (v: Votes) => v[0] + 2 * v[1] + 3 * v[2] + 5 * v[3]
export const ESTABLISHMENT_PERIODS = ['1961', '1991', '2021']
export const MATURATION_PERIODS = ['2021', '2041', '2061', '2081']
/** Session defaults in bcgov/CCISS_ShinyApp app/server.R (gcm_weight, rcp_weight, show_novelty, nov_c). */
export const SHINY_GCM_WEIGHTS: Readonly<Record<string, number>> = {
  'ACCESS-ESM1-5': 1,
  'BCC-CSM2-MR': 0,
  CanESM5: 0,
  'CNRM-ESM2-1': 1,
  'EC-Earth3': 1,
  'GFDL-ESM4': 1,
  'GISS-E2-1-G': 1,
  'INM-CM5-0': 0,
  'IPSL-CM6A-LR': 0,
  MIROC6: 1,
  'MPI-ESM1-2-HR': 1,
  'MRI-ESM2-0': 1,
  'UKESM1-0-LL': 0,
}
export const SHINY_SCENARIO_WEIGHTS: Readonly<Record<string, number>> = {
  ssp126: 0.8,
  ssp245: 1,
  ssp370: 0.8,
  ssp585: 0,
}
export const SHINY_NOVELTY_CUTOFF = 5
/** Seed weights from Shiny's defaults where labels match exactly; unmatched labels default to 1.
 * If nothing matched would carry weight, every option gets 1 so a default run is never empty. */
export function shinyDefaultWeights(names: string[], defaults: Readonly<Record<string, number>>) {
  const unmatched = names.filter((name) => !(name in defaults))
  const seeded = Object.fromEntries(names.map((name) => [name, defaults[name] ?? 1]))
  if (!Object.values(seeded).some((w) => w > 0))
    return { weights: Object.fromEntries(names.map((name) => [name, 1])), unmatched, fallback: true }
  return { weights: seeded, unmatched, fallback: false }
}
export const DEFAULT_ESTABLISHMENT = [0.25, 0.25, 0.5]
export const DEFAULT_MATURATION = [0.1, 0.3, 0.3, 0.3]
export interface ReportSummaryPolicy {
  id: string
  label: string
  establishment: { periods: string[]; weights: number[] }
  maturation: { periods: string[]; weights: number[] }
}
/** Source-backed policies only. Historical IDs are never inferred to be modern periods. */
export const SHINY_SUMMARY_POLICIES: ReportSummaryPolicy[] = [
  {
    id: 'cciss-current-1961-2100',
    label: 'CCISS current periods (1961–2100)',
    establishment: { periods: ESTABLISHMENT_PERIODS, weights: DEFAULT_ESTABLISHMENT },
    maturation: { periods: MATURATION_PERIODS, weights: DEFAULT_MATURATION },
  },
]
export function supportedSummaryPolicies(report: ShinyReport) {
  return SHINY_SUMMARY_POLICIES.filter((policy) =>
    [...policy.establishment.periods, ...policy.maturation.periods].every((period) => report.periods.includes(period)),
  )
}
function normalize(w: number[], size: number) {
  const total = w.reduce((a, b) => a + b, 0)
  if (w.length !== size || w.some((n) => !Number.isFinite(n) || n < 0) || !Number.isFinite(total) || total <= 0)
    throw new Error('Weights must be nonnegative with a positive total.')
  return w.map((n) => n / total)
}
function complete(v: Votes | null | undefined): v is Votes {
  return !!v && Math.abs(v.reduce((a, b) => a + b, 0) - 1) < 1e-6
}
/** Port of feasibility.R's summary stage for complete current-period votes.
 * Does not perform BGC prediction, edatopic overlap, novelty or model reweighting.
 * Missing/rounded historical votes are not silently repaired or period-remapped.
 *
 * assessedPeriods:
 * - omitted (imported reports): any missing period returns null, because an export may omit it.
 * - provided (browser-computed votes): in a period that was assessed but gave the species no rating there is no
 *   vote row, as in feasibility.R. Establishment's X2 residual then counts that period's weight as X, while
 *   maturation (weighted.mean) and improve/decline (mean) use only the periods that exist. A period missing from
 *   the set (its input data were unavailable) still withholds the summary rather than being treated as X.
 */
export function summarizeVotes(
  row: SpeciesReport,
  establishment = DEFAULT_ESTABLISHMENT,
  maturation = DEFAULT_MATURATION,
  policy = SHINY_SUMMARY_POLICIES[0],
  assessedPeriods?: ReadonlySet<string>,
) {
  const ew = normalize(establishment, policy.establishment.periods.length),
    mw = normalize(maturation, policy.maturation.periods.length)
  const ep = policy.establishment.periods.map((p) => row.votes[p] ?? null),
    mp = policy.maturation.periods.map((p) => row.votes[p] ?? null)
  if (row.current == null) return null
  const usable = (v: Votes | null, period: string) => (v === null ? !!assessedPeriods?.has(period) : complete(v))
  if (
    !ep.every((v, i) => usable(v, policy.establishment.periods[i])) ||
    !mp.every((v, i) => usable(v, policy.maturation.periods[i]))
  )
    return null
  if ([...policy.establishment.periods, ...policy.maturation.periods].some((p) => (row.novelty[p] ?? 0) > 0))
    return null
  const maturing = mp.flatMap((v, i) => (v ? [{ v, w: mw[i] }] : []))
  if (!maturing.length) return null
  const weighted = [0, 1, 2, 3].map((c) => ep.reduce((sum, v, i) => sum + (v ? v[c] * ew[i] : 0), 0)) as Votes
  const residual = 1 - weighted.reduce((a, b) => a + b, 0)
  weighted[3] += residual // feasibility.R's X2 correction, before establishment scoring.
  const est = voteScore(weighted)
  // R's weighted.mean is NaN when every present period has zero weight; report no summary then.
  const maturingWeight = maturing.reduce((sum, { w }) => sum + w, 0)
  if (!(maturingWeight > 0)) return null
  const mat = maturing.reduce((sum, { v, w }) => sum + voteScore(v) * w, 0) / maturingWeight
  const current = Math.min(row.current, 4),
    cut = current === 4 ? 3 : current
  const improve = maturing.reduce((sum, { v }) => sum + v.slice(0, cut).reduce((a, b) => a + b, 0), 0) / maturing.length
  const decline = maturing.reduce((sum, { v }) => sum + v.slice(cut).reduce((a, b) => a + b, 0), 0) / maturing.length
  return {
    establishment: Math.min(4, rRound(est)),
    maturation: Math.min(4, rRound(mat)),
    establishmentScore: est,
    maturationScore: mat,
    improve: rRound(improve * 100),
    decline: rRound(decline * 100),
  }
}

export function reportSummaryStatus(row: SpeciesReport, policy: ReportSummaryPolicy | null): string {
  if (!policy) return 'No source-backed summary policy matches the exported period IDs.'
  const periods = [...new Set([...policy.establishment.periods, ...policy.maturation.periods])]
  const missing = periods.filter((period) => !row.votes[period])
  if (missing.length) return `Missing votes for periods: ${missing.join(', ')}.`
  if (row.current == null) return 'The baseline rating is missing.'
  if (periods.some((period) => (row.novelty[period] ?? 0) > 0))
    return 'Novelty-scaled votes cannot reproduce the source summary stage.'
  if (periods.some((period) => !complete(row.votes[period])))
    return 'Rounded, zero or incomplete vote totals cannot be reweighted.'
  return 'Complete exported votes support browser period reweighting.'
}

export function createReportAnalysis(
  report: ShinyReport,
  source: string,
  establishment = DEFAULT_ESTABLISHMENT,
  maturation = DEFAULT_MATURATION,
  policy: ReportSummaryPolicy | null = supportedSummaryPolicies(report)[0] ?? null,
) {
  const normalizedEstablishment = policy ? normalize(establishment, policy.establishment.periods.length) : null
  const normalizedMaturation = policy ? normalize(maturation, policy.maturation.periods.length) : null
  return {
    schema: 'cciss-imported-report-analysis-v1' as const,
    source,
    method:
      'Imported Shiny results; browser summaries use exported votes only. No new climate predictions or model/scenario reweighting.',
    policy: policy ? { ...policy, establishmentWeights: establishment, maturationWeights: maturation } : null,
    normalizedWeights: { establishment: normalizedEstablishment, maturation: normalizedMaturation },
    report,
    results: report.rows.map((row) => ({
      site: row.site,
      series: row.series,
      species: row.species,
      status: reportSummaryStatus(row, policy),
      summary: policy ? summarizeVotes(row, establishment, maturation, policy) : null,
    })),
  }
}

/** One row per imported site/series/species; source columns and browser results remain separate. */
export function reportAnalysisCsv(analysis: ReturnType<typeof createReportAnalysis>): string {
  const { report, results, source, policy } = analysis
  const originals = [...new Set(report.rows.flatMap((row) => Object.keys(row.original)))]
  const headings = [
    'SiteRef',
    'SS_NoSpace',
    'Spp',
    'Curr',
    ...report.periods.flatMap((period) => ['1', '2', '3', 'X', 'NOV'].map((c) => `${c}_${period}`)),
    'Browser_EstabFeas',
    'Browser_ccissFeas',
    'Browser_Improve',
    'Browser_Decline',
    'Browser_Status',
    'Source',
    'SummaryPolicy',
    'EstablishmentWeights',
    'MaturationWeights',
    ...originals.map((column) => `Original_${column}`),
  ]
  return csvFormatRows([
    headings,
    ...report.rows.map((row, i) =>
      [
        row.site,
        row.series,
        row.species,
        row.current ?? '',
        ...report.periods.flatMap((period) => [...(row.votes[period] ?? ['', '', '', '']), row.novelty[period] ?? '']),
        results[i].summary?.establishment ?? '',
        results[i].summary?.maturation ?? '',
        results[i].summary?.improve ?? '',
        results[i].summary?.decline ?? '',
        results[i].status,
        source,
        policy?.id ?? '',
        policy ? JSON.stringify(policy.establishmentWeights) : '',
        policy ? JSON.stringify(policy.maturationWeights) : '',
        ...originals.map((column) => row.original[column] ?? ''),
      ].map(String),
    ),
  ])
}
