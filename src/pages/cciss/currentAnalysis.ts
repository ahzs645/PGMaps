import { summarizeVotes, type SpeciesReport, type Votes } from './shinyReport'

// Calculation stages adapted from Province of British Columbia / ccissr,
// Apache-2.0, a6ab8ee3a714ebf4a3f41e16f04d9f58404de7ce:
// R/data_etl.R (dbGetCCISS_v13, dbGetCCISS_novelty), R/eda_overlap.R and
// R/feasibility.R. This is a source-stage port; authentic deployed-site parity
// still requires a version-matched owner export and independent reference runs.
export const CURRENT_BUNDLE_LIMIT = 25_000_000
type JsonRow = Record<string, unknown>
export interface CurrentDimension {
  array_ordinal: number
  gcm_id: number
  scenario_id: number
  futureperiod_id: number
  run_id: number
  gcm: string
  scenario: string
  futureperiod: string
  run: string
}
type Ring = number[][]
export type CurrentGeometry = { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] }
export interface CurrentPilot {
  schema: 'cciss-current-pilot-v1'
  requestValid: true
  synthetic?: boolean
  requestedSites: number[]
  dimensions: CurrentDimension[]
  bgcCodes: { bgc_id: number; bgc: string }[]
  future: { siteno: number; bgc_id: (number | null)[] }[]
  observed: { siteno: number; bgc_pred: string | null }[]
  novelty: { siteno: number; novelty: (number | null)[] }[]
  attribution: { siteno: number; bgc: string }[]
  siteGeometry: { siteno: number; geometry: CurrentGeometry }[]
}
export interface CurrentProvenance {
  datasetVersion: string
  source: string
  ccissrCommit?: string
  shinyCommit?: string
  versionMatched: boolean
  synthetic?: boolean
}
export interface CurrentEdatope {
  BGC: string
  SS_NoSpace: string
  Edatopic: string
  SpecialCode: string | null
  MainUnit?: string
}
export interface CurrentSuitability {
  BGC: string
  SS_NoSpace: string
  Spp: string
  Feasible: number
  OHR?: boolean
}
export interface CurrentEcology {
  schema: 'cciss-ecology-v1'
  tables: { E1: CurrentEdatope[]; E1_Phase: CurrentEdatope[]; S1: CurrentSuitability[] }
}
export interface CurrentBundle {
  schema: 'cciss-current-analysis-v1'
  pilot: CurrentPilot
  provenance: CurrentProvenance
  ecology?: CurrentEcology
}
export interface CurrentSettings {
  siteId: number
  series?: string
  modelWeights?: Record<string, number>
  scenarioWeights?: Record<string, number>
  noveltyCutoff?: number | null
  includeOutOfRange?: boolean
  establishmentWeights?: number[]
  maturationWeights?: number[]
}
export interface CurrentAssessment {
  siteId: number
  bgc: string
  series: string | null
  bgcProbabilities: { period: string; bgc: string; probability: number; members: number }[]
  species: SpeciesReport[]
  overlap: { period: string; predictedBgc: string; predictedSeries: string; probability: number }[]
  summaries: { species: string; summary: ReturnType<typeof summarizeVotes> }[]
  warnings: string[]
  capabilities: { predictions: boolean; siteSeries: boolean; suitability: boolean; summaries: boolean }
  provenance: CurrentProvenance
}

function record(value: unknown, label: string): JsonRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}: expected an object.`)
  return value as JsonRow
}
function rows(value: unknown, label: string, min = 0, max = 200_000): JsonRow[] {
  if (!Array.isArray(value) || value.length < min || value.length > max)
    throw new Error(`${label}: expected ${min}–${max} rows.`)
  return value.map((r) => record(r, label))
}
function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) throw new Error(`${label}: missing text.`)
  return value
}
function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${label}: expected a safe integer.`)
  return value as number
}
function geometry(value: unknown): CurrentGeometry {
  const g = record(value, 'Site geometry')
  if (!['Polygon', 'MultiPolygon'].includes(g.type as string)) throw new Error('Site geometry must be a polygon.')
  const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
  if (!Array.isArray(polygons) || !polygons.length) throw new Error('Site geometry has no polygons.')
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || !polygon.length) throw new Error('Site geometry has no rings.')
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4) throw new Error('Site geometry has an invalid ring.')
      for (const point of ring)
        if (
          !Array.isArray(point) ||
          point.length < 2 ||
          !Number.isFinite(point[0]) ||
          !Number.isFinite(point[1]) ||
          Math.abs(point[0]) > 180 ||
          Math.abs(point[1]) > 90
        )
          throw new Error('Site geometry must use finite WGS84 coordinates.')
      if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])
        throw new Error('Site polygon rings must be closed.')
    }
  }
  return value as CurrentGeometry
}
function parsePilot(value: unknown): CurrentPilot {
  const p = record(value, 'Pilot')
  if (p.schema !== 'cciss-current-pilot-v1') throw new Error('Expected a cciss-current-pilot-v1 export.')
  if (p.requestValid !== true) throw new Error('Pilot export request was not valid.')
  if (!Array.isArray(p.requestedSites) || !p.requestedSites.length || p.requestedSites.length > 25)
    throw new Error('Expected 1–25 requested site IDs.')
  const requestedSites = p.requestedSites.map((id) => integer(id, 'Site ID'))
  if (new Set(requestedSites).size !== requestedSites.length) throw new Error('Duplicate requested site IDs.')
  const labels = new Map<string, Map<number, string>>()
  const labelIds = new Map<string, Map<string, number>>()
  const tuples = new Set<string>()
  const dimensions = rows(p.dimensions, 'Model dimensions', 1, 50_000).map((r, i) => {
    const d = { ...r } as unknown as CurrentDimension
    if (integer(r.array_ordinal, 'Array ordinal') !== i + 1) throw new Error('Non-contiguous array ordinals.')
    const key: number[] = []
    for (const [id, name] of [
      ['gcm_id', 'gcm'],
      ['scenario_id', 'scenario'],
      ['futureperiod_id', 'futureperiod'],
      ['run_id', 'run'],
    ]) {
      const n = integer(r[id], `Dimension ${id}`)
      // PostgreSQL to_jsonb preserves an integer year column as a JSON number.
      // Converting that exact ID to text does not remap period boundaries.
      const label =
        name === 'futureperiod' && Number.isSafeInteger(r[name])
          ? String(r[name])
          : string(r[name], `Dimension ${name}`)
      if (name === 'futureperiod') d.futureperiod = label
      key.push(n)
      const map = labels.get(name) ?? new Map<number, string>()
      const reverse = labelIds.get(name) ?? new Map<string, number>()
      if (map.has(n) && map.get(n) !== label) throw new Error(`Conflicting ${name} dimension labels.`)
      if (reverse.has(label) && reverse.get(label) !== n) throw new Error(`Duplicate ${name} dimension labels.`)
      map.set(n, label)
      labels.set(name, map)
      reverse.set(label, n)
      labelIds.set(name, reverse)
    }
    if (!/^\d{4}$/.test(d.futureperiod)) throw new Error('Future periods must retain four-digit source IDs.')
    if (['1961', '1991'].includes(d.futureperiod))
      throw new Error('Future dimensions cannot reuse the reserved 1961 baseline or 1991 observed period IDs.')
    const tuple = JSON.stringify(key)
    if (tuples.has(tuple)) throw new Error('Duplicate model dimension IDs.')
    tuples.add(tuple)
    if (i) {
      const previous = p.dimensions as JsonRow[]
      const before = ['gcm_id', 'scenario_id', 'futureperiod_id', 'run_id'].map((k) => previous[i - 1][k] as number)
      const firstDifference = key.findIndex((n, j) => n !== before[j])
      if (firstDifference < 0 || key[firstDifference] < before[firstDifference])
        throw new Error('Array dimensions must be ordered by GCM, scenario, period and run IDs.')
    }
    return d
  })
  const cartesianSize = [...labels.values()].reduce((n, map) => n * map.size, 1)
  if (cartesianSize !== dimensions.length)
    throw new Error('Model dimensions must preserve the complete Cartesian index.')
  for (const [name, max] of [
    ['gcm', 128],
    ['scenario', 32],
    ['futureperiod', 64],
    ['run', 256],
  ] as const)
    if (labels.get(name)!.size > max) throw new Error(`Pilot exceeds the browser limit of ${max} ${name} choices.`)
  const bgcCodes = rows(p.bgcCodes, 'BGC codebook', 1, 10_000).map((r) => ({
    bgc_id: integer(r.bgc_id, 'BGC ID'),
    bgc: string(r.bgc, 'BGC codebook label'),
  }))
  if (new Set(bgcCodes.map((r) => r.bgc_id)).size !== bgcCodes.length) throw new Error('Duplicate BGC IDs.')
  const codeIds = new Set(bgcCodes.map((r) => r.bgc_id))
  const onePerSite = (section: string) => {
    const sectionRows = rows(p[section], section, requestedSites.length, requestedSites.length)
    const ids = sectionRows.map((r) => integer(r.siteno, `${section} site ID`))
    if (new Set(ids).size !== requestedSites.length || ids.some((id) => !requestedSites.includes(id)))
      throw new Error(`${section}: missing, duplicate or unexpected sites.`)
    return sectionRows
  }
  const future = onePerSite('future').map((r) => {
    if (!Array.isArray(r.bgc_id) || r.bgc_id.length !== dimensions.length)
      throw new Error('Future array length does not match dimensions.')
    if (r.bgc_id.some((id) => id !== null && (!Number.isSafeInteger(id) || !codeIds.has(id))))
      throw new Error('Unknown BGC code in future array.')
    return { siteno: r.siteno as number, bgc_id: r.bgc_id as (number | null)[] }
  })
  const novelty = onePerSite('novelty').map((r) => {
    if (
      !Array.isArray(r.novelty) ||
      r.novelty.length !== dimensions.length ||
      r.novelty.some((v) => v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v < 0))
    )
      throw new Error('Novelty arrays must match dimensions and contain nonnegative finite values or null.')
    return { siteno: r.siteno as number, novelty: r.novelty as (number | null)[] }
  })
  const attribution = onePerSite('attribution').map((r) => ({
    siteno: r.siteno as number,
    bgc: string(r.bgc, 'Attribution bgc (original source column)'),
  }))
  const observed = onePerSite('observed').map((r) => ({
    siteno: r.siteno as number,
    bgc_pred: r.bgc_pred === null ? null : string(r.bgc_pred, 'Observed bgc_pred (original source column)'),
  }))
  const siteGeometry = onePerSite('siteGeometry').map((r) => ({
    siteno: r.siteno as number,
    geometry: geometry(r.geometry),
  }))
  if (p.synthetic !== undefined && typeof p.synthetic !== 'boolean') throw new Error('Pilot.synthetic must be boolean.')
  return {
    schema: 'cciss-current-pilot-v1',
    requestValid: true,
    ...(p.synthetic === undefined ? {} : { synthetic: p.synthetic as boolean }),
    requestedSites,
    dimensions,
    bgcCodes,
    future,
    novelty,
    attribution,
    observed,
    siteGeometry,
  }
}
function parseEcology(value: unknown): CurrentEcology {
  const e = record(value, 'Ecology')
  if (e.schema !== 'cciss-ecology-v1') throw new Error('Unsupported ecological attachment schema.')
  const tables = record(e.tables, 'Ecological tables')
  const edatopes = (name: 'E1' | 'E1_Phase') =>
    rows(tables[name], name, name === 'E1' ? 1 : 0).map((r) => ({
      BGC: string(r.BGC, `${name}.BGC`),
      SS_NoSpace: string(r.SS_NoSpace, `${name}.SS_NoSpace`),
      Edatopic: string(r.Edatopic, `${name}.Edatopic`),
      SpecialCode: r.SpecialCode === null ? null : string(r.SpecialCode, `${name}.SpecialCode`),
      ...(name === 'E1_Phase' ? { MainUnit: string(r.MainUnit, 'E1_Phase.MainUnit') } : {}),
    }))
  const E1 = edatopes('E1'),
    E1_Phase = edatopes('E1_Phase')
  const attribution = new Map<string, { bgc: string; special: string | null }>()
  for (const r of [...E1, ...E1_Phase]) {
    const previous = attribution.get(r.SS_NoSpace)
    if (previous && (previous.bgc !== r.BGC || previous.special !== r.SpecialCode))
      throw new Error(`Conflicting ecological attribution for ${r.SS_NoSpace}.`)
    attribution.set(r.SS_NoSpace, { bgc: r.BGC, special: r.SpecialCode })
  }
  const seen = new Map<string, number>()
  const S1 = rows(tables.S1, 'S1', 1).map((r) => {
    const result: CurrentSuitability = {
      BGC: string(r.BGC, 'S1.BGC'),
      SS_NoSpace: string(r.SS_NoSpace, 'S1.SS_NoSpace'),
      Spp: string(r.Spp, 'S1.Spp'),
      Feasible: integer(r.Feasible, 'S1.Feasible'),
    }
    if (result.Feasible < 1 || result.Feasible > 5) throw new Error('S1.Feasible must be a source class from 1 to 5.')
    if (r.OHR !== undefined) {
      if (typeof r.OHR !== 'boolean') throw new Error('S1.OHR must be boolean when supplied.')
      result.OHR = r.OHR
    }
    const key = JSON.stringify([result.SS_NoSpace, result.Spp, result.OHR])
    if (seen.has(key) && seen.get(key) !== result.Feasible) throw new Error('Conflicting species suitability rows.')
    seen.set(key, result.Feasible)
    return result
  })
  return { schema: 'cciss-ecology-v1', tables: { E1, E1_Phase, S1 } }
}

/** Accept the owner SQL export directly, or a self-contained versioned attachment. */
export function parseCurrentBundle(text: string): CurrentBundle {
  if (text.length > CURRENT_BUNDLE_LIMIT) throw new Error('Please select a current CCISS bundle smaller than 25 MB.')
  let input: unknown
  try {
    input = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    throw new Error('The current CCISS bundle must be valid JSON.')
  }
  const root = record(input, 'Bundle')
  if (root.schema === 'cciss-current-pilot-v1')
    return {
      schema: 'cciss-current-analysis-v1',
      pilot: parsePilot(root),
      provenance: {
        datasetVersion: root.synthetic === true ? 'Synthetic verification pilot' : 'Unversioned pilot export',
        source: 'Imported CCISS pilot export',
        versionMatched: false,
        ...(root.synthetic === true ? { synthetic: true } : {}),
      },
    }
  if (root.schema !== 'cciss-current-analysis-v1') throw new Error('Unsupported current CCISS bundle schema.')
  const p = record(root.provenance, 'Provenance')
  if (typeof p.versionMatched !== 'boolean') throw new Error('Provenance must state versionMatched explicitly.')
  const provenance: CurrentProvenance = {
    datasetVersion: string(p.datasetVersion, 'Dataset version'),
    source: string(p.source, 'Dataset source'),
    versionMatched: p.versionMatched,
  }
  for (const key of ['ccissrCommit', 'shinyCommit'] as const)
    if (p[key] !== undefined) {
      const commit = string(p[key], key)
      if (!/^[a-f\d]{40}$/i.test(commit)) throw new Error(`${key} must be an exact 40-character commit.`)
      provenance[key] = commit
    }
  if (p.synthetic !== undefined) {
    if (typeof p.synthetic !== 'boolean') throw new Error('Provenance.synthetic must be boolean.')
    provenance.synthetic = p.synthetic
  }
  const pilot = parsePilot(root.pilot)
  if (pilot.synthetic === true || root.synthetic === true) provenance.synthetic = true
  if (provenance.versionMatched && !provenance.ccissrCommit)
    throw new Error('Version-matched bundles must identify the exact ccissr commit.')
  return {
    schema: 'cciss-current-analysis-v1',
    pilot,
    provenance,
    ...(root.ecology === undefined ? {} : { ecology: parseEcology(root.ecology) }),
  }
}

export function currentOptions(bundle: CurrentBundle, siteId?: number) {
  const p = bundle.pilot
  const bgc = p.attribution.find((r) => r.siteno === siteId)?.bgc
  const unique = (values: string[]) => [...new Set(values)].sort()
  return {
    sites: p.attribution.map((r) => ({ id: r.siteno, bgc: r.bgc })),
    models: unique(p.dimensions.map((d) => d.gcm)),
    scenarios: unique(p.dimensions.map((d) => d.scenario)),
    periods: unique([
      '1961',
      ...(p.observed.some((r) => r.bgc_pred !== null) ? ['1991'] : []),
      ...p.dimensions.map((d) => d.futureperiod),
    ]),
    runs: unique(p.dimensions.map((d) => d.run)),
    series: unique(
      bundle.ecology
        ? [...bundle.ecology.tables.E1, ...bundle.ecology.tables.E1_Phase.filter((r) => r.SpecialCode !== null)]
            .filter((r) => !bgc || r.BGC === bgc)
            .map((r) => r.SS_NoSpace)
        : [],
    ),
    species: unique(bundle.ecology?.tables.S1.map((r) => r.Spp) ?? []),
  }
}

function ringLocation(ring: Ring, [x, y]: [number, number]): 'inside' | 'outside' | 'boundary' {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j],
      [bx, by] = ring[i]
    const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax)
    if (
      Math.abs(cross) < 1e-12 &&
      x >= Math.min(ax, bx) &&
      x <= Math.max(ax, bx) &&
      y >= Math.min(ay, by) &&
      y <= Math.max(ay, by)
    )
      return 'boundary'
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside
  }
  return inside ? 'inside' : 'outside'
}
/** Return every containing pilot site. A shared edge is ambiguous, never nearest. */
export function currentSitesAtPoint(bundle: CurrentBundle, point: [number, number]): number[] {
  if (!point.every(Number.isFinite) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90)
    throw new Error('Enter valid WGS84 longitude and latitude.')
  return bundle.pilot.siteGeometry
    .filter(({ geometry: g }) => {
      const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
      return polygons.some(([outer, ...holes]) => {
        const outerLocation = ringLocation(outer, point)
        if (outerLocation === 'outside') return false
        if (outerLocation === 'boundary') return true
        return holes.every((hole) => ringLocation(hole, point) !== 'inside')
      })
    })
    .map((r) => r.siteno)
}

interface SeriesCells {
  series: string
  bgc: string
  cells: Set<string>
  cellCounts: Map<string, number>
  count: number
  special: string | null
  main?: string
}
function seriesCells(rows: CurrentEdatope[]) {
  const groups = new Map<string, SeriesCells>()
  for (const row of rows) {
    const group = groups.get(row.SS_NoSpace) ?? {
      series: row.SS_NoSpace,
      bgc: row.BGC,
      cells: new Set<string>(),
      cellCounts: new Map<string, number>(),
      count: 0,
      special: row.SpecialCode,
      main: row.MainUnit,
    }
    group.cells.add(row.Edatopic)
    group.cellCounts.set(row.Edatopic, (group.cellCounts.get(row.Edatopic) ?? 0) + 1)
    group.count++ // Source NumEdas counts input rows, including source-edition duplicates.
    groups.set(row.SS_NoSpace, group)
  }
  return [...groups.values()]
}
const intersection = (a: Set<string>, b: Set<string>) => [...a].filter((cell) => b.has(cell)).length
// Unlike the regular stage, the source's phase join does not deduplicate E1 or
// E1_Phase first. Its .N counts every matching raw row pair for each edatope.
const phaseIntersection = (a: SeriesCells, b: SeriesCells) =>
  [...a.cellCounts].reduce((sum, [cell, count]) => sum + count * (b.cellCounts.get(cell) ?? 0), 0)
function overlapForSeries(
  current: SeriesCells,
  targetBgc: string,
  regular: SeriesCells[],
  phases: SeriesCells[],
  expandPhases = false,
) {
  const targets = regular.filter((r) => r.bgc === targetBgc)
  let output: { series: string; weight: number }[] = []
  // eda_overlap.R joins special site series (E1 and E1_Phase rows with a SpecialCode) on their code, then
  // removes pairs with rmFlag using codes looked up from E1 only (SppCode, SppCodePred). So a special phase
  // keeps only special-phase targets, and a special E1 series keeps only special E1 targets. Flag is set
  // before rmFlag: once any same-code special matched, the ordinary overlaps of that pair are dropped too,
  // even when rmFlag then removes every special match. Checked against ccissr on generated cases
  // (scripts/cciss/eda-reference).
  const sameCode =
    current.special === null
      ? []
      : [...targets, ...phases.filter((r) => r.bgc === targetBgc)].filter((r) => r.special === current.special)
  const currentIsPhase = current.main !== undefined
  if (sameCode.length)
    output = sameCode
      .filter((r) => (currentIsPhase ? r.main !== undefined : r.main === undefined))
      .map((r) => ({ series: r.series, weight: 1 }))
  // Special current phases enter only through the SpecialCode join, never the regular E1 join.
  else if (currentIsPhase && current.special !== null) return []
  else
    for (const target of targets) {
      if (target.special !== null && target.special !== current.special) continue
      if (current.bgc === targetBgc && current.series !== target.series.replace(/[a-c]$|\.[1-9]$/, '')) continue
      const shared = intersection(current.cells, target.cells)
      if (!shared) continue
      const weight = (shared * shared) / (current.count * target.count)
      output.push({ series: target.series, weight })
    }
  if (current.bgc === targetBgc)
    output = output.filter((r) => current.series === r.series.replace(/[a-c]$|\.[1-9]$/, ''))
  const total = output.reduce((sum, r) => sum + r.weight, 0)
  const noPhase = output.map((r) => ({ series: r.series, probability: r.weight / total }))
  // generate.R passes edaOut$NoPhase to ccissOutput. Ordinary phases are an
  // independent display stage; their suitability rows must not replace mainunits.
  if (!expandPhases || current.main) return noPhase
  return noPhase.flatMap((main) => {
    const matches = phases
      .filter((p) => p.bgc === targetBgc && p.main === main.series && p.special === null)
      .map((p) => ({
        series: p.series,
        weight: phaseIntersection(current, p) ** 2 / (current.count * p.count),
      }))
      .filter((p) => p.weight > 0)
    const sum = matches.reduce((sum, r) => sum + r.weight, 0)
    return sum ? matches.map((p) => ({ series: p.series, probability: (main.probability * p.weight) / sum })) : [main]
  })
}
function sourceWeight(weights: Record<string, number> | undefined, key: string) {
  const value = weights && Object.prototype.hasOwnProperty.call(weights, key) ? weights[key] : 1
  if (!Number.isFinite(value) || value < 0)
    throw new Error('Model and scenario weights must be finite and nonnegative.')
  return value
}

export function assessCurrentSite(bundle: CurrentBundle, settings: CurrentSettings): CurrentAssessment {
  const { pilot, provenance, ecology } = bundle
  const attribution = pilot.attribution.find((r) => r.siteno === settings.siteId)
  if (!attribution) throw new Error('Choose a site contained in this pilot export.')
  const warnings = [
    'Source-stage browser calculation; equivalence to deployed Shiny results has not been independently verified.',
  ]
  if (provenance.synthetic)
    warnings.push('Synthetic verification data. These are invented test sites and predictions, not ecological advice.')
  if (!provenance.versionMatched)
    warnings.push(
      'The supplier has not asserted matching prediction and ecological versions. Only BGC probabilities are available.',
    )
  if (!ecology)
    warnings.push(
      'Matching E1, E1_Phase and uppercase-schema S1 tables are absent. Site-series and species calculations are unavailable.',
    )
  const future = pilot.future.find((r) => r.siteno === settings.siteId)!.bgc_id
  const novelty = pilot.novelty.find((r) => r.siteno === settings.siteId)!.novelty
  const codebook = new Map(pilot.bgcCodes.map((r) => [r.bgc_id, r.bgc]))
  const cutoff = settings.noveltyCutoff
  if (cutoff != null && (!Number.isFinite(cutoff) || cutoff < 1 || cutoff > 8))
    throw new Error('Novelty cutoff must be between 1 and 8 sigma.')
  const probabilities = new Map<string, Map<string, { weight: number; members: number }>>()
  const periods = [...new Set(pilot.dimensions.map((r) => r.futureperiod))]
  const modelWeights = pilot.dimensions.map((d) => sourceWeight(settings.modelWeights, d.gcm))
  const scenarioWeights = pilot.dimensions.map((d) => sourceWeight(settings.scenarioWeights, d.scenario))
  const largestModel = modelWeights.reduce((max, w) => Math.max(max, w), 0)
  const largestScenario = scenarioWeights.reduce((max, w) => Math.max(max, w), 0)
  if (!largestModel || !largestScenario)
    throw new Error('Select at least one model/scenario combination with a positive weight.')
  let missing = 0
  pilot.dimensions.forEach((d, i) => {
    // Per-group scaling preserves ratios and avoids overflow for finite inputs.
    const weight = (modelWeights[i] / largestModel) * (scenarioWeights[i] / largestScenario)
    if (!weight) return
    if (future[i] === null) {
      missing++
      return
    }
    if (cutoff != null && novelty[i] === null)
      throw new Error(
        'Selected members have missing novelty values; disable novelty filtering or provide complete data.',
      )
    const bgc = cutoff != null && novelty[i]! > Math.round(cutoff * 1000) / 100 ? 'novel' : codebook.get(future[i]!)!
    const map = probabilities.get(d.futureperiod) ?? new Map<string, { weight: number; members: number }>()
    const r = map.get(bgc) ?? { weight: 0, members: 0 }
    r.weight += weight
    r.members++
    map.set(bgc, r)
    probabilities.set(d.futureperiod, map)
  })
  if (missing)
    warnings.push(
      `${missing} selected prediction members are missing and excluded from probability denominators, as in the source SQL.`,
    )
  const bgcProbabilities: CurrentAssessment['bgcProbabilities'] = []
  for (const period of periods.sort()) {
    const entries = [...(probabilities.get(period) ?? [])]
    const total = entries.reduce((sum, [, r]) => sum + r.weight, 0)
    if (!total) warnings.push(`No valid selected predictions for period ${period}.`)
    for (const [bgc, r] of entries)
      bgcProbabilities.push({ period, bgc, probability: r.weight / total, members: r.members })
  }
  const observed = pilot.observed.find((r) => r.siteno === settings.siteId)!.bgc_pred
  if (observed === null)
    warnings.push('Observed BGC is missing. No 1991 observation or establishment summary is inferred.')
  else bgcProbabilities.push({ period: '1991', bgc: observed, probability: 1, members: 1 })
  bgcProbabilities.push({ period: '1961', bgc: attribution.bgc, probability: 1, members: 1 })
  bgcProbabilities.sort(
    (a, b) => a.period.localeCompare(b.period) || b.probability - a.probability || a.bgc.localeCompare(b.bgc),
  )
  const result: CurrentAssessment = {
    siteId: settings.siteId,
    bgc: attribution.bgc,
    series: settings.series ?? null,
    bgcProbabilities,
    species: [],
    overlap: [],
    summaries: [],
    warnings,
    capabilities: {
      predictions: bgcProbabilities.some((r) => !['1961', '1991'].includes(r.period)),
      siteSeries: false,
      suitability: false,
      summaries: false,
    },
    provenance,
  }
  if (!ecology || !provenance.versionMatched) return result
  const regular = seriesCells(ecology.tables.E1),
    phases = seriesCells(ecology.tables.E1_Phase)
  const regularNames = new Set(regular.map((r) => r.series))
  const currentSeries = [...regular, ...phases.filter((r) => r.special !== null && !regularNames.has(r.series))].filter(
    (r) => r.bgc === attribution.bgc,
  )
  const selected = currentSeries.find((r) => r.series === settings.series)
  if (!selected) {
    warnings.push('Choose a site series from the baseline BGC to calculate overlap and species votes.')
    return result
  }
  const regularByBgc = new Map<string, SeriesCells[]>(),
    phasesByBgc = new Map<string, SeriesCells[]>()
  for (const row of regular) {
    const group = regularByBgc.get(row.bgc) ?? []
    group.push(row)
    regularByBgc.set(row.bgc, group)
  }
  for (const row of phases) {
    const group = phasesByBgc.get(row.bgc) ?? []
    group.push(row)
    phasesByBgc.set(row.bgc, group)
  }
  const overlapCache = new Map<string, ReturnType<typeof overlapForSeries>>()
  const overlaps = (series: SeriesCells, predictedBgc: string, expandPhases = false) => {
    const key = JSON.stringify([series.series, predictedBgc, expandPhases])
    let result = overlapCache.get(key)
    if (!result) {
      if (overlapCache.size >= 50_000)
        throw new Error(
          'Ecological overlap exceeds this browser pilot budget. Supply a smaller spatial/reference extract.',
        )
      result = overlapForSeries(
        series,
        predictedBgc,
        regularByBgc.get(predictedBgc) ?? [],
        phasesByBgc.get(predictedBgc) ?? [],
        expandPhases,
      )
      overlapCache.set(key, result)
    }
    return result
  }
  const includeOutOfRange = settings.includeOutOfRange !== false
  if (!includeOutOfRange && ecology.tables.S1.some((r) => r.OHR === undefined))
    throw new Error('Out-of-range filtering requires an explicit boolean OHR on every S1 row.')
  const suitability = [
    ...new Map(
      ecology.tables.S1.filter((r) => includeOutOfRange || r.OHR === false).map((r) => [
        JSON.stringify([r.SS_NoSpace, r.Spp, r.Feasible]),
        r,
      ]),
    ).values(),
  ]
  const bySeries = new Map<string, CurrentSuitability[]>()
  for (const row of suitability) bySeries.set(row.SS_NoSpace, [...(bySeries.get(row.SS_NoSpace) ?? []), row])
  const conditionalSpecies = new Map<string, SpeciesReport>()
  const allPeriods = [...new Set(bgcProbabilities.map((r) => r.period))]
  const novelByPeriod = new Map<string, number>()
  // Periods with usable predictions. A species without a rating in one of these has no vote row, as in ccissr.
  const assessedPeriods = new Set<string>()
  for (const period of allPeriods) {
    const periodBgcs = bgcProbabilities.filter((r) => r.period === period)
    novelByPeriod.set(period, periodBgcs.find((r) => r.bgc === 'novel')?.probability ?? 0)
    const usable = periodBgcs.filter((r) => r.bgc !== 'novel' && currentSeries.some((s) => overlaps(s, r.bgc).length))
    const denominator = usable.reduce((sum, r) => sum + r.probability, 0)
    if (!denominator) {
      warnings.push(`No compatible ecological overlaps for period ${period}; no species votes are invented.`)
      continue
    }
    assessedPeriods.add(period)
    const votes = new Map<string, Votes>()
    for (const prediction of usable) {
      for (const overlap of overlaps(selected, prediction.bgc, true))
        result.overlap.push({
          period,
          predictedBgc: prediction.bgc,
          predictedSeries: overlap.series,
          probability: (prediction.probability / denominator) * overlap.probability,
        })
      for (const overlap of overlaps(selected, prediction.bgc)) {
        const probability = (prediction.probability / denominator) * overlap.probability
        for (const rating of bySeries.get(overlap.series) ?? []) {
          const vote = votes.get(rating.Spp) ?? [0, 0, 0, 0]
          vote[Math.min(rating.Feasible, 4) - 1] += probability
          votes.set(rating.Spp, vote)
        }
      }
    }
    for (const [species, vote] of votes) {
      if (vote.reduce((sum, n) => sum + n, 0) > 1 + 1e-8)
        throw new Error(
          `Overlapping suitability rows exceed probability one for ${species}. Confirm the ecological schema.`,
        )
      vote[3] = Math.max(0, 1 - vote[0] - vote[1] - vote[2]) // Source residual and classes 4/5 enter X.
      const row = conditionalSpecies.get(species) ?? {
        site: String(settings.siteId),
        series: selected.series,
        species,
        current: Math.min(bySeries.get(selected.series)?.find((r) => r.Spp === species)?.Feasible ?? 5, 4),
        votes: {},
        novelty: {},
        original: {},
      }
      row.votes[period] = vote
      row.novelty[period] = 0
      conditionalSpecies.set(species, row)
    }
  }
  result.capabilities.siteSeries = result.overlap.length > 0
  for (const row of [...conditionalSpecies.values()].sort((a, b) => a.species.localeCompare(b.species))) {
    const summary = summarizeVotes(
      row,
      settings.establishmentWeights,
      settings.maturationWeights,
      undefined,
      assessedPeriods,
    )
    result.summaries.push({ species: row.species, summary })
    result.species.push({
      ...row,
      votes: Object.fromEntries(
        Object.entries(row.votes).map(([period, vote]) => [
          period,
          vote?.map((v) => v * (1 - (novelByPeriod.get(period) ?? 0))) as Votes | null,
        ]),
      ),
      novelty: Object.fromEntries(allPeriods.map((period) => [period, novelByPeriod.get(period) ?? 0])),
    })
  }
  result.capabilities.suitability = result.species.length > 0
  result.capabilities.summaries = result.summaries.some((r) => r.summary !== null)
  if (!result.capabilities.summaries)
    warnings.push(
      'Complete 1961/1991/2021/2041/2061/2081 votes are required for source establishment and maturation summaries.',
    )
  if ([...novelByPeriod.values()].some((p) => p > 0))
    warnings.push(
      'Novel climate is shown separately. Summaries use conditional non-novel votes before display scaling, following Shiny sequencing.',
    )
  warnings.push(
    'Stocking recommendations, CFRG flags, BGC aggregation and deployed Shiny parity are outside this source-stage calculation.',
  )
  return result
}
