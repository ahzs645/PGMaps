/**
 * Harvest evidence and its age, shared by every tool that shows BC cutblocks: the road designer's
 * harvest history (`src/pages/dev-forestry-roads/harvestHistory.ts`) and the outdoors planner's
 * cutblock layer (`src/maps/outdoors/`). The age classes are the designer's: a block whose
 * recorded years straddle a class break is "unknown", never put in the nearer class. No DOM or
 * network access.
 */

/** Layer 543 of the current BCGW service. The older `whse` view holds 10,000 records and nothing harvested after 2014. */
export const BC_HARVEST_SERVICE = 'https://delivery.maps.gov.bc.ca/arcgis/rest/services/mpcm/bcgwpub/MapServer/543'
export const HARVEST_YEAR_MIN = 1800
export const HARVEST_YEAR_MAX = 2200
export const HARVEST_RECENT_YEARS = 10
export const HARVEST_MEDIUM_YEARS = 30

export interface HarvestEvidence {
  source: 'bc-consolidated' | 'bc-ften' | 'user' | 'scenario'
  status?: 'harvested' | 'proposed'
  sourceId?: string
  sourceUrl?: string
  retrievedAt?: string
  dataSource?: string
  sourceDate?: string
  publishedDate?: string
  openingId?: string
  areaHectares?: number
  startDate?: string
  endDate?: string
  startYear?: number
  endYear?: number
  midYear?: number
  /** Describes the available source precision, not independent verification of a harvest event. */
  yearMethod: 'reported-dates' | 'reported-year' | 'estimated-range' | 'estimated-midpoint' | 'start-only' | 'unknown'
}

function record(raw: unknown, label: string): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error(`${label} must be an object.`)
  return raw as Record<string, unknown>
}
function optionalText(value: unknown, label: string, max = 1000): string | undefined {
  if (value == null || value === '') return undefined
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw Error(`${label} must be text of at most ${max} characters.`)
  return value.trim()
}
export function parseHarvestHistoryYear(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < HARVEST_YEAR_MIN || value > HARVEST_YEAR_MAX)
    throw Error(`Harvest year must be an integer between ${HARVEST_YEAR_MIN} and ${HARVEST_YEAR_MAX}.`)
  return value
}
function optionalYear(value: unknown): number | undefined {
  return value == null || value === '' ? undefined : parseHarvestHistoryYear(value)
}
function dateValue(value: unknown, label: string): string | undefined {
  if (value == null || value === '') return undefined
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw Error(`${label} must be a valid date.`)
    const date = new Date(value)
    if (!Number.isFinite(date.valueOf())) throw Error(`${label} must be a valid date.`)
    return dateValue(date.toISOString().slice(0, 10), label)
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value))
    throw Error(`${label} must be a valid ISO date.`)
  if (value.includes('T') && !Number.isFinite(Date.parse(value))) throw Error(`${label} must be a valid ISO date.`)
  const day = value.slice(0, 10),
    date = new Date(`${day}T00:00:00Z`)
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== day)
    throw Error(`${label} must be a valid date.`)
  parseHarvestHistoryYear(date.getUTCFullYear())
  return day
}
function sourceUrl(value: unknown): string | undefined {
  const text = optionalText(value, 'Harvest source URL', 2000)
  if (text === undefined) return undefined
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw Error('Harvest source URL must be an HTTP or HTTPS URL.')
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw Error('Harvest source URL must be an HTTP or HTTPS URL.')
  return text
}

/** Used on both project restore and GeoJSON import so invalid evidence never becomes a numeric age. */
export function parseHarvestEvidence(raw: unknown): HarvestEvidence {
  const r = record(raw, 'Harvest evidence')
  if (!['bc-consolidated', 'bc-ften', 'user', 'scenario'].includes(String(r.source)))
    throw Error('Unknown harvest evidence source.')
  if (r.status !== undefined && !['harvested', 'proposed'].includes(String(r.status)))
    throw Error('Unknown harvest status.')
  if (
    !['reported-dates', 'reported-year', 'estimated-range', 'estimated-midpoint', 'start-only', 'unknown'].includes(
      String(r.yearMethod),
    )
  )
    throw Error('Unknown harvest year method.')
  const startDate = dateValue(r.startDate, 'Harvest start date')
  const endDate = dateValue(r.endDate, 'Harvest end date')
  const startYear = optionalYear(r.startYear) ?? (startDate ? Number(startDate.slice(0, 4)) : undefined)
  const endYear = optionalYear(r.endYear) ?? (endDate ? Number(endDate.slice(0, 4)) : undefined)
  const midYear = optionalYear(r.midYear)
  if (
    (startDate && startYear !== Number(startDate.slice(0, 4))) ||
    (endDate && endYear !== Number(endDate.slice(0, 4)))
  )
    throw Error('Harvest dates must agree with their calendar years.')
  if (
    (startYear !== undefined && endYear !== undefined && startYear > endYear) ||
    (startDate && endDate && startDate > endDate)
  )
    throw Error('Harvest end must not precede its start.')
  if (
    midYear !== undefined &&
    ((startYear !== undefined && midYear < startYear) || (endYear !== undefined && midYear > endYear))
  )
    throw Error('Harvest midpoint year must fall within the reported harvest years.')
  if (r.status === 'proposed' && [startDate, endDate, startYear, endYear, midYear].some((value) => value !== undefined))
    throw Error('A proposed cutblock cannot contain historical harvest dates.')
  if (r.yearMethod === 'reported-dates' && !endDate)
    throw Error('Reported harvest dates need an explicit completion date.')
  if (['reported-year', 'estimated-range'].includes(String(r.yearMethod)) && endYear === undefined)
    throw Error('A harvest-year interval needs an explicit end year.')
  if (r.yearMethod === 'estimated-midpoint' && (midYear === undefined || endYear !== undefined))
    throw Error('Midpoint harvest evidence needs a midpoint year and no claimed completion year.')
  if (r.yearMethod === 'start-only' && (startYear === undefined || endYear !== undefined || midYear !== undefined))
    throw Error('Start-only harvest evidence needs only a start year.')
  if (r.yearMethod === 'unknown' && [startYear, endYear, midYear].some((value) => value !== undefined))
    throw Error('Choose the harvest-year method that describes the supplied date evidence.')
  const evidence: HarvestEvidence = {
    source: r.source as HarvestEvidence['source'],
    yearMethod: r.yearMethod as HarvestEvidence['yearMethod'],
  }
  if (r.status !== undefined) evidence.status = r.status as HarvestEvidence['status']
  for (const key of ['sourceId', 'dataSource', 'openingId'] as const) {
    const value = optionalText(r[key], `Harvest ${key}`)
    if (value !== undefined) evidence[key] = value
  }
  const url = sourceUrl(r.sourceUrl)
  if (url !== undefined) evidence.sourceUrl = url
  if (r.retrievedAt !== undefined) {
    const retrieved = optionalText(r.retrievedAt, 'Harvest retrieval date', 100)
    if (!retrieved || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(retrieved) || !Number.isFinite(Date.parse(retrieved)))
      throw Error('Harvest retrieval date must be a valid ISO date.')
    dateValue(retrieved, 'Harvest retrieval date')
    evidence.retrievedAt = retrieved
  }
  for (const key of ['sourceDate', 'publishedDate'] as const) {
    const value = dateValue(r[key], `Harvest ${key}`)
    if (value !== undefined) evidence[key] = value
  }
  if (r.areaHectares !== undefined && r.areaHectares !== null) {
    if (
      typeof r.areaHectares !== 'number' ||
      !Number.isFinite(r.areaHectares) ||
      r.areaHectares < 0 ||
      r.areaHectares > 1e8
    )
      throw Error('Harvest area must be a finite, non-negative number of hectares.')
    evidence.areaHectares = r.areaHectares
  }
  Object.assign(
    evidence,
    Object.fromEntries(
      Object.entries({ startDate, endDate, startYear, endYear, midYear }).filter(([, value]) => value !== undefined),
    ),
  )
  return evidence
}

export interface HarvestAge {
  kind: 'proposed' | 'unknown' | 'future' | 'start-only' | 'reported' | 'estimated'
  /** Calendar-year differences, not an exact anniversary or stand age. */
  minYears?: number
  maxYears?: number
}
export function harvestAge(evidence: HarvestEvidence | undefined, year: number): HarvestAge {
  parseHarvestHistoryYear(year)
  if (evidence?.status === 'proposed') return { kind: 'proposed' }
  if (!evidence) return { kind: 'unknown' }
  const { startYear, endYear, midYear } = evidence
  if (endYear !== undefined) {
    if (year < endYear) return { kind: 'future' }
    return {
      kind:
        evidence.yearMethod === 'estimated-range' || evidence.source === 'bc-consolidated' ? 'estimated' : 'reported',
      minYears: year - endYear,
      maxYears: year - (startYear ?? endYear),
    }
  }
  if (midYear !== undefined) {
    if (year < midYear) return { kind: 'future' }
    return { kind: 'estimated', minYears: year - midYear, maxYears: year - midYear }
  }
  if (startYear !== undefined) return { kind: year < startYear ? 'future' : 'start-only', maxYears: year - startYear }
  return { kind: 'unknown' }
}
export function harvestAgeSummary(evidence: HarvestEvidence | undefined, year: number): string {
  const age = harvestAge(evidence, year)
  if (age.kind === 'proposed') return 'Proposed cutblock · no harvest history'
  if (age.kind === 'unknown') return 'Harvest date unknown'
  if (age.kind === 'future') {
    if (
      evidence?.startYear !== undefined &&
      evidence.startYear <= year &&
      evidence.endYear !== undefined &&
      evidence.endYear > year
    )
      return `Reported harvest interval spans reference year ${year} · completion recorded for ${evidence.endYear}${evidence.yearMethod === 'estimated-range' ? ' (may be estimated)' : ''}`
    return `Harvest record is after reference year ${year}`
  }
  if (age.kind === 'start-only') return `Harvest started ${evidence!.startYear} · completion unknown`
  if (age.kind === 'estimated') {
    const range = age.minYears === age.maxYears ? String(age.minYears) : `${age.minYears}–${age.maxYears}`
    const sourceYears =
      evidence!.endYear !== undefined
        ? evidence!.startYear === undefined || evidence!.startYear === evidence!.endYear
          ? String(evidence!.endYear)
          : `${evidence!.startYear}–${evidence!.endYear}`
        : String(evidence!.midYear)
    return `About ${range} calendar years since estimated harvest (${sourceYears})`
  }
  if (age.minYears !== age.maxYears)
    return `${age.minYears}–${age.maxYears} calendar years since reported harvest (${evidence!.startYear}–${evidence!.endYear})`
  return `${age.minYears} calendar years since reported harvest (${evidence!.endYear})`
}
export function harvestHistoryStyle(
  evidence: HarvestEvidence | undefined,
  year: number,
): { key: string; label: string; color: string } {
  const age = harvestAge(evidence, year)
  if (age.kind === 'proposed') return { key: 'proposed', label: 'Proposed cutblock', color: '#7c3aed' }
  const unknown = { key: 'unknown', label: 'Harvest age unknown or uncertain', color: '#64748b' }
  if (age.minYears === undefined || age.maxYears === undefined) return unknown
  const bin = (years: number) =>
    years <= HARVEST_RECENT_YEARS ? 'recent' : years <= HARVEST_MEDIUM_YEARS ? 'medium' : 'older'
  if (bin(age.minYears) !== bin(age.maxYears)) return unknown
  if (age.minYears <= HARVEST_RECENT_YEARS)
    return { key: 'recent', label: 'Harvest 0–10 calendar years ago', color: '#d97706' }
  if (age.minYears <= HARVEST_MEDIUM_YEARS)
    return { key: 'medium', label: 'Harvest 11–30 calendar years ago', color: '#0d9488' }
  return { key: 'older', label: 'Harvest over 30 calendar years ago', color: '#166534' }
}

/** The layer's fields that `bcHarvestEvidence` reads. */
export const BC_HARVEST_FIELDS = [
  'VCCB_SYSID',
  'OBJECTID',
  'OPENING_ID',
  'DATA_SOURCE',
  'AREA_HA',
  'HARVEST_START_DATE',
  'HARVEST_END_DATE',
  'HARVEST_START_YEAR_CALENDAR',
  'HARVEST_MID_YEAR_CALENDAR',
  'DATA_SOURCE_DATE',
  'PUBLISHED_DATE',
]

/** One BC consolidated-cutblock record as harvest evidence. Throws when the record cannot be read. */
export function bcHarvestEvidence(properties: Record<string, unknown>, retrievedAt?: string): HarvestEvidence {
  const startDate = dateValue(properties.HARVEST_START_DATE, 'Harvest start date')
  const endDate = dateValue(properties.HARVEST_END_DATE, 'Harvest end date')
  const startYear =
    optionalYear(properties.HARVEST_START_YEAR_CALENDAR) ?? (startDate ? Number(startDate.slice(0, 4)) : undefined)
  const midYear = optionalYear(properties.HARVEST_MID_YEAR_CALENDAR)
  const identity = properties.VCCB_SYSID ?? properties.OBJECTID
  if (identity == null || !String(identity).trim())
    throw Error('BC harvested area is missing its unique source record ID.')
  return parseHarvestEvidence({
    source: 'bc-consolidated',
    status: 'harvested',
    sourceId: String(identity),
    sourceUrl: BC_HARVEST_SERVICE,
    retrievedAt,
    openingId: properties.OPENING_ID == null ? undefined : String(properties.OPENING_ID),
    dataSource: properties.DATA_SOURCE,
    areaHectares: properties.AREA_HA,
    sourceDate: properties.DATA_SOURCE_DATE,
    publishedDate: properties.PUBLISHED_DATE,
    startDate,
    endDate,
    startYear,
    midYear,
    yearMethod: endDate
      ? 'estimated-range'
      : midYear !== undefined
        ? 'estimated-midpoint'
        : startYear !== undefined
          ? 'start-only'
          : 'unknown',
  })
}
