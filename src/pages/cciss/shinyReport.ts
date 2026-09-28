import { csvParse } from 'd3'

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
  return { rows: [...grouped.values()], periods: periods.sort(), format: long ? 'historical-raw' : 'current-export' }
}

/** R round(x, 0) ties-to-even, unlike JavaScript Math.round. */
export function rRound(x: number): number {
  const floor = Math.floor(x)
  return x - floor === 0.5 ? floor + (floor % 2) : Math.round(x)
}
export const voteScore = (v: Votes) => v[0] + 2 * v[1] + 3 * v[2] + 5 * v[3]
export const ESTABLISHMENT_PERIODS = ['1961', '1991', '2021']
export const MATURATION_PERIODS = ['2021', '2041', '2061', '2081']
export const DEFAULT_ESTABLISHMENT = [0.25, 0.25, 0.5]
export const DEFAULT_MATURATION = [0.1, 0.3, 0.3, 0.3]
function normalize(w: number[], size: number) {
  if (w.length !== size || w.some((n) => !Number.isFinite(n) || n < 0) || w.reduce((a, b) => a + b, 0) <= 0)
    throw new Error('Weights must be nonnegative with a positive total.')
  const total = w.reduce((a, b) => a + b, 0)
  return w.map((n) => n / total)
}
function complete(v: Votes | null | undefined): v is Votes {
  return !!v && Math.abs(v.reduce((a, b) => a + b, 0) - 1) < 1e-6
}
/** Port of feasibility.R's summary stage for complete current-period votes.
 * Does not perform BGC prediction, edatopic overlap, novelty or model reweighting.
 * Missing/rounded historical votes are not silently repaired or period-remapped.
 */
export function summarizeVotes(
  row: SpeciesReport,
  establishment = DEFAULT_ESTABLISHMENT,
  maturation = DEFAULT_MATURATION,
) {
  const ew = normalize(establishment, 3),
    mw = normalize(maturation, 4)
  const ep = ESTABLISHMENT_PERIODS.map((p) => row.votes[p]),
    mp = MATURATION_PERIODS.map((p) => row.votes[p])
  if (!ep.every(complete) || !mp.every(complete) || row.current == null) return null
  if ([...ESTABLISHMENT_PERIODS, ...MATURATION_PERIODS].some((p) => (row.novelty[p] ?? 0) > 0)) return null
  const weighted = [0, 1, 2, 3].map((c) => ep.reduce((sum, v, i) => sum + v[c] * ew[i], 0)) as Votes
  const residual = 1 - weighted.reduce((a, b) => a + b, 0)
  weighted[3] += residual // feasibility.R's X2 correction, before establishment scoring.
  const est = voteScore(weighted)
  const mat = mp.reduce((sum, v, i) => sum + voteScore(v) * mw[i], 0)
  const current = Math.min(row.current, 4),
    cut = current === 4 ? 3 : current
  const improve = mp.reduce((sum, v) => sum + v.slice(0, cut).reduce((a, b) => a + b, 0), 0) / mp.length
  const decline = mp.reduce((sum, v) => sum + v.slice(cut).reduce((a, b) => a + b, 0), 0) / mp.length
  return {
    establishment: Math.min(4, rRound(est)),
    maturation: Math.min(4, rRound(mat)),
    establishmentScore: est,
    maturationScore: mat,
    improve: rRound(improve * 100),
    decline: rRound(decline * 100),
  }
}
