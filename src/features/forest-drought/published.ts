/**
 * Browser adapter for the published BC forDRAT table.
 * Copyright 2024 Province of British Columbia (source data), Apache-2.0.
 * PG Maps adaptation: parsing, validation, selection and export only. Published
 * AET/PET values and species ratings are never recalculated by this adapter.
 */

export const PUBLISHED_SOURCE = {
  id: 'bcgov-fordrat-ac51aafe7b66',
  title: 'BC forDRAT published drought risk',
  repository: 'https://github.com/bcgov/forDRAT',
  commit: 'ac51aafe7b66d039c990964a9acd809a2ea73848',
  sourcePath: 'data/forDrat.csv',
  csvPath: '/data/forest-drought/fordrat.csv',
  manifestPath: '/data/forest-drought/manifest.json',
  licensePath: '/data/forest-drought/LICENSE-fordrat.md',
  noticePath: '/data/forest-drought/NOTICE.md',
  sha256: 'abdb1a26645d6d24e6d45380f55aa555a5f69ffdad79c5f7fb47627003f0d2df',
  gitBlobSha: '29fcf5e9207802e3516b809418bbbe73ab96ff12',
  bytes: 338744,
  rows: 6120,
  bgcUnits: 204,
  becVersion: 11,
  license: 'Apache-2.0',
  attribution: 'Copyright 2024 Province of British Columbia. Source: bcgov/forDRAT.',
  climate: 'ClimateBC 6.21; 15-model ensemble; RCP 4.5',
  scopeNote:
    'Published estimates concern drought-related mortality in mature forest stands and interior tree species. Soil moisture regimes wetter than subhygric are outside the model.',
  occurrenceNote:
    'A rating does not establish that a species occurs at this site or is suitable for planting. The table supplies ratings for every listed species, including outside its natural range.',
  spatialNote:
    'BGC identifiers refer to BEC v11. A matching identifier on another map version does not verify matching boundaries. Relative soil moisture regime requires a site assessment.',
} as const

export const PUBLISHED_PERIODS = [
  { id: '1961-1990', label: '1961–1990', kind: 'historical', years: [1961, 1990] },
  { id: '1971-2000', label: '1971–2000', kind: 'historical', years: [1971, 2000] },
  { id: '1981-2010', label: '1981–2010', kind: 'historical', years: [1981, 2010] },
  { id: '2020', label: '2020 (2011–2040)', kind: 'projection', years: [2011, 2040] },
  { id: '2050', label: '2050 (2041–2070)', kind: 'projection', years: [2041, 2070] },
  { id: '2080', label: '2080 (2071–2100)', kind: 'projection', years: [2071, 2100] },
] as const

export const SOIL_MOISTURE_REGIMES = [
  { id: 1, label: 'Xeric' },
  { id: 2, label: 'Subxeric' },
  { id: 3, label: 'Submesic' },
  { id: 4, label: 'Mesic' },
  { id: 5, label: 'Subhygric' },
] as const

// Species names follow the forDRAT catalogue metadata, rather than expanding
// ambiguous historical BC codes using a different inventory's code list.
export const TREE_SPECIES = [
  { code: 'Pl', name: 'Lodgepole pine' },
  { code: 'Sx', name: 'Hybrid white spruce' },
  { code: 'Fd', name: 'Interior Douglas-fir' },
  { code: 'Bl', name: 'Subalpine fir' },
  { code: 'Cw', name: 'Western redcedar' },
  { code: 'Hw', name: 'Western hemlock' },
  { code: 'Lw', name: 'Western larch' },
  { code: 'Py', name: 'Ponderosa pine' },
  { code: 'Ac', name: 'Black cottonwood' },
  { code: 'At', name: 'Trembling aspen' },
] as const

export const RISK_LEVELS = [
  { code: 'L', label: 'Low', rank: 0 },
  { code: 'M', label: 'Moderate', rank: 1 },
  { code: 'H', label: 'High', rank: 2 },
  { code: 'VH', label: 'Very high', rank: 3 },
] as const

export type PublishedPeriod = (typeof PUBLISHED_PERIODS)[number]['id']
export type SoilMoistureRegime = (typeof SOIL_MOISTURE_REGIMES)[number]['id']
export type SpeciesCode = (typeof TREE_SPECIES)[number]['code']
export type RiskCode = (typeof RISK_LEVELS)[number]['code']

export interface PublishedRow {
  bgc: string
  period: PublishedPeriod
  smr: SoilMoistureRegime
  smrText: string
  aetPet: number
  risks: Record<SpeciesCode, RiskCode>
}

export interface PublishedDataset {
  rows: PublishedRow[]
  bgcUnits: string[]
}

export const PUBLISHED_CSV_HEADER = [
  'BGC',
  'Period',
  'SMR_text',
  'SMR',
  'AET_PET',
  ...TREE_SPECIES.map(({ code }) => code),
].join(',')

const periodIds = new Set<string>(PUBLISHED_PERIODS.map(({ id }) => id))
const riskCodes = new Set<string>(RISK_LEVELS.map(({ code }) => code))
const periodOrder = new Map<string, number>(PUBLISHED_PERIODS.map(({ id }, index) => [id, index]))

/**
 * Parse this version's complete published table, not arbitrary user CSVs.
 * The known upstream CSV is unquoted ASCII; schema or coverage changes require
 * a deliberate source update. BOM/CRLF transport variants are accepted.
 */
export function parsePublishedCsv(text: string): PublishedDataset {
  if (text.length > 1_000_000) throw new Error('The published forDRAT table is unexpectedly large.')
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const lines = (normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized).split('\n')
  if (lines[0] !== PUBLISHED_CSV_HEADER) {
    throw new Error('The published forDRAT CSV header does not match the pinned schema.')
  }

  const rows: PublishedRow[] = []
  const seen = new Set<string>()
  const bgcSet = new Set<string>()
  for (let index = 1; index < lines.length; index += 1) {
    const cells = lines[index].split(',')
    const fail = (message: string): never => {
      throw new Error(`Published forDRAT row ${index + 1}: ${message}`)
    }
    if (cells.length !== 15) fail('expected 15 unquoted fields.')
    const [bgc, period, smrText, smrString, ratioString] = cells
    if (!/^[A-Z][A-Za-z0-9]*$/.test(bgc)) fail('invalid BGC identifier.')
    if (!periodIds.has(period)) fail('unknown period.')
    const smr = Number(smrString)
    if (!/^[1-5]$/.test(smrString)) fail('soil moisture regime must be an integer from 1 to 5.')
    const regime = SOIL_MOISTURE_REGIMES.find(({ id }) => id === smr)
    if (smrText !== regime?.label.toLowerCase()) fail('soil moisture code and label disagree.')
    const aetPet = Number(ratioString)
    if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(ratioString) || !Number.isFinite(aetPet) || aetPet < 0 || aetPet > 1) {
      fail('AET/PET must be a finite ratio from 0 to 1.')
    }
    const risks = {} as Record<SpeciesCode, RiskCode>
    TREE_SPECIES.forEach(({ code }, speciesIndex) => {
      const risk = cells[5 + speciesIndex]
      if (!riskCodes.has(risk)) fail(`unknown ${code} risk code.`)
      risks[code] = risk as RiskCode
    })
    const key = `${bgc}|${period}|${smr}`
    if (seen.has(key)) fail(`duplicate BGC/period/soil combination ${key}.`)
    seen.add(key)
    bgcSet.add(bgc)
    rows.push({ bgc, period: period as PublishedPeriod, smr: smr as SoilMoistureRegime, smrText, aetPet, risks })
  }
  if (rows.length !== PUBLISHED_SOURCE.rows || bgcSet.size !== PUBLISHED_SOURCE.bgcUnits) {
    throw new Error(
      `The published forDRAT table is incomplete: expected 6,120 rows and 204 BGC units; received ${rows.length.toLocaleString('en')} rows and ${bgcSet.size} BGC units.`,
    )
  }
  const bgcUnits = [...bgcSet].sort()
  for (const bgc of bgcUnits) {
    for (const { id: period } of PUBLISHED_PERIODS) {
      for (const { id: smr } of SOIL_MOISTURE_REGIMES) {
        if (!seen.has(`${bgc}|${period}|${smr}`)) {
          throw new Error(`The published forDRAT table is missing ${bgc}/${period}/soil ${smr}.`)
        }
      }
    }
  }
  return { rows, bgcUnits }
}

/** Exact identifier lookup only. Never drop variants, spaces or suffixes. */
export function resolvePublishedBgc(input: string, bgcUnits: readonly string[]): string | null {
  const candidate = input.trim()
  return bgcUnits.includes(candidate) ? candidate : null
}

export interface PublishedFilter {
  bgc?: string
  smr?: SoilMoistureRegime
  period?: PublishedPeriod
}

export function filterPublishedRows(dataset: PublishedDataset, filter: PublishedFilter = {}): PublishedRow[] {
  const bgc = filter.bgc === undefined ? undefined : resolvePublishedBgc(filter.bgc, dataset.bgcUnits)
  if (bgc === null) return []
  return dataset.rows.filter(
    (row) =>
      (bgc === undefined || row.bgc === bgc) &&
      (filter.smr === undefined || row.smr === filter.smr) &&
      (filter.period === undefined || row.period === filter.period),
  )
}

export function publishedSeries(dataset: PublishedDataset, bgc: string, smr: SoilMoistureRegime): PublishedRow[] {
  return filterPublishedRows(dataset, { bgc, smr }).sort(
    (a, b) => (periodOrder.get(a.period) ?? 0) - (periodOrder.get(b.period) ?? 0),
  )
}

function csvCell(value: string | number): string {
  const text = String(value)
  // Defence in depth if a caller supplies an unparsed row. Quoting alone does
  // not prevent spreadsheets from interpreting a leading formula character.
  const safe = /^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** CSV exports retain the source columns and unrounded numeric values. */
export function exportPublishedCsv(rows: readonly PublishedRow[]): string {
  return [
    PUBLISHED_CSV_HEADER,
    ...rows.map((row) =>
      [row.bgc, row.period, row.smrText, row.smr, row.aetPet, ...TREE_SPECIES.map(({ code }) => row.risks[code])]
        .map(csvCell)
        .join(','),
    ),
    '',
  ].join('\r\n')
}
