/**
 * Limited Entry Hunting (LEH) draws for a management unit, and where to read
 * its general open seasons.
 *
 * LEH is BC's lottery for hunts where demand exceeds what the herd can bear:
 * a hunter applies for a hunt code and a fixed number of authorizations are
 * drawn. The province publishes every draw since 2002 as one CSV, the "Limited
 * Entry Hunting Draw Hunt Code Report". It is read here at run time and never
 * copied into the repository or a cache: its catalogue record is marked "Access
 * Only", not Open Government Licence, so redistributing it needs the province's
 * permission. The file's address names its last season ("2002-to-fall-2025"),
 * so the catalogue record is asked for its current CSV each visit
 * (`lehCsvUrlFromPackage`), and the address last checked is only the fallback.
 * The CSV's last year is the most recent *completed* draw; the coming season's hunt codes and tag numbers exist only in the
 * printed synopsis, so everything shown from here is labelled with its year.
 *
 * General open seasons (the ones needing no draw, such as Sitka deer on Haida
 * Gwaii) are published only as PDF tables. This module links to them and
 * never restates a season date.
 *
 * Everything here is pure except `loadLehDraws`, which takes its `fetch`.
 */
import { readBoundedText } from '@/lib/boundedText'
import { parseCsvRows } from '@/lib/parseCsv'

export const LEH_DRAW_CSV_URL =
  'https://catalogue.data.gov.bc.ca/dataset/50555048-1ab7-4f50-bb4a-8b8142f0cba5/resource/321110dd-b95c-4cc0-8a36-b98d9e284a58/download/leh-draw-hunt-code-report-2002-to-fall-2025.csv'
/** The catalogue record by its id, which stays when the report is renamed for a new season. */
export const LEH_DRAW_RECORD_URL = 'https://catalogue.data.gov.bc.ca/dataset/50555048-1ab7-4f50-bb4a-8b8142f0cba5'
/** The catalogue record, asked for the draw report's current CSV (CKAN's `package_show`). */
export const LEH_DRAW_PACKAGE_URL =
  'https://catalogue.data.gov.bc.ca/api/3/action/package_show?id=50555048-1ab7-4f50-bb4a-8b8142f0cba5'
/** The report is about 3 MB; anything far past that is not the report. */
export const MAX_LEH_CSV_BYTES = 16 * 1024 * 1024
const MAX_LEH_PACKAGE_BYTES = 1024 * 1024

/**
 * The draw report's CSV in a catalogue answer: the CSV resource that is not the field definitions.
 * Null when the record lists none, so the caller falls back to the address last checked.
 */
export function lehCsvUrlFromPackage(payload: unknown): string | null {
  const resources = (payload as { result?: { resources?: unknown } } | null)?.result?.resources
  if (!Array.isArray(resources)) return null
  for (const entry of resources) {
    const resource = entry as { format?: unknown; name?: unknown; url?: unknown }
    const format = typeof resource.format === 'string' ? resource.format.toLowerCase() : ''
    const name = typeof resource.name === 'string' ? resource.name.toLowerCase() : ''
    const url = typeof resource.url === 'string' ? resource.url : ''
    if (format !== 'csv' || name.includes('field definition')) continue
    if (/^https:\/\/catalogue\.data\.gov\.bc\.ca\//.test(url)) return url
  }
  return null
}

const SYNOPSIS_BASE =
  'https://www2.gov.bc.ca/assets/gov/sports-recreation-arts-and-culture/outdoor-recreation/fishing-and-hunting/hunting'
export const LEH_SYNOPSIS_URL = `${SYNOPSIS_BASE}/limited-entry-hunting/leh-regulations-synopsis.pdf`
export const HUNTING_SYNOPSIS_URL = `${SYNOPSIS_BASE}/regulations/hunting-trapping-synopsis.pdf`
export const REGULATIONS_PAGE_URL =
  'https://www2.gov.bc.ca/gov/content/sports-culture/recreation/fishing-hunting/hunting/regulations-synopsis'

/**
 * "725A" → management unit "7-25", zone "A". The planner's unit ids carry no
 * leading zero ("6-5"), while the draw report pads to two digits ("605").
 */
export function unitFromHuntArea(huntArea: string): { unitId: string; zone: string | null } | null {
  const match = /^(\d)(\d{2})([A-Z])?$/.exec(huntArea.trim().toUpperCase())
  if (!match) return null
  return { unitId: `${match[1]}-${Number(match[2])}`, zone: match[3] ?? null }
}

/** Planner ids may arrive padded ("6-05") or not ("6-5"); compare them unpadded. */
export function normalizeUnitId(unitId: string): string {
  const match = /^\s*(\d+)\s*-\s*0*(\d+)\s*$/.exec(unitId)
  return match ? `${match[1]}-${match[2]}` : unitId.trim()
}

export interface LehSeason {
  /** ISO dates, yyyy-mm-dd. */
  open: string
  close: string
}

export interface LehHunt {
  drawYear: number
  huntCode: string
  species: string
  unitId: string
  zone: string | null
  /** The draw report's own name for the area, e.g. "Prince George". */
  areaName: string | null
  /** "Bull Only", "Antlerless Only"… as the report words it. */
  animalClass: string | null
  seasons: LehSeason[]
  authorizations: number | null
  /** First-choice applicants per authorization: 6.7 means 6.7 to 1. */
  odds: number | null
  applicants: number | null
  youth: boolean
  shared: boolean
}

function isoDate(value: string | undefined): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value?.trim() ?? '')
  if (!match) return null
  return `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`
}

function count(value: string | undefined): number | null {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function flag(value: string | undefined): boolean {
  return ['yes', 'y', '1', 'true'].includes(value?.trim().toLowerCase() ?? '')
}

function words(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) return null
  return trimmed
    .toLowerCase()
    .replace(/(^|[\s\-/(])([a-z])/g, (_, lead: string, letter: string) => lead + letter.toUpperCase())
}

/** Every hunt in the report's most recent draw year. Rows that cannot be placed in a unit are dropped. */
export function parseLehDraws(csvText: string): { drawYear: number | null; hunts: LehHunt[] } {
  // The catalogue's CSV starts with a byte order mark, which would join the first column's name.
  const [header, ...rows] = parseCsvRows(csvText.replace(/^\uFEFF/, ''))
  if (!header) return { drawYear: null, hunts: [] }
  const column = new Map(header.map((name, index) => [name.trim(), index]))
  const read = (row: string[], name: string) => {
    const index = column.get(name)
    return index == null ? undefined : row[index]
  }
  let drawYear: number | null = null
  for (const row of rows) {
    const year = count(read(row, 'Draw Year'))
    if (year != null && (drawYear == null || year > drawYear)) drawYear = year
  }
  if (drawYear == null) return { drawYear: null, hunts: [] }

  const hunts: LehHunt[] = []
  for (const row of rows) {
    if (count(read(row, 'Draw Year')) !== drawYear) continue
    const place = unitFromHuntArea(read(row, 'LEH Hunt Area') ?? '')
    const huntCode = read(row, 'Hunt Code')?.trim()
    if (!place || !huntCode) continue
    const seasons: LehSeason[] = []
    for (const which of ['One', 'Two']) {
      const open = isoDate(read(row, `Season ${which} Open`))
      const close = isoDate(read(row, `Season ${which} Close`))
      if (open && close) seasons.push({ open, close })
    }
    hunts.push({
      drawYear,
      huntCode,
      species: words(read(row, 'Species')) ?? 'Unknown species',
      unitId: place.unitId,
      zone: place.zone,
      areaName: read(row, 'Area')?.trim() || null,
      animalClass: words(read(row, 'Licence Description')),
      seasons,
      authorizations: count(read(row, 'Available Authorizations')),
      odds: count(read(row, 'First Choice Odds')),
      applicants: count(read(row, 'First Choice Applicants')),
      youth: flag(read(row, 'Youth Hunt')),
      shared: flag(read(row, 'Shared Hunt')),
    })
  }
  return { drawYear, hunts }
}

/** A unit's hunts, grouped by species, each group ordered by zone and then season. */
export function huntsForUnit(hunts: LehHunt[], unitId: string): Array<{ species: string; hunts: LehHunt[] }> {
  const wanted = normalizeUnitId(unitId)
  const groups = new Map<string, LehHunt[]>()
  for (const hunt of hunts) {
    if (hunt.unitId !== wanted) continue
    const group = groups.get(hunt.species) ?? []
    group.push(hunt)
    groups.set(hunt.species, group)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([species, group]) => ({
      species,
      hunts: group.sort(
        (a, b) =>
          (a.zone ?? '').localeCompare(b.zone ?? '') ||
          (a.seasons[0]?.open ?? '').localeCompare(b.seasons[0]?.open ?? '') ||
          a.huntCode.localeCompare(b.huntCode),
      ),
    }))
}

/** The hunts drawn for one zone polygon: same hunt area, same species. */
export function huntsForHuntArea(hunts: LehHunt[], huntAreaId: string, species: string): LehHunt[] {
  const place = unitFromHuntArea(huntAreaId)
  if (!place) return []
  const wanted = species.trim().toLowerCase()
  return hunts
    .filter((hunt) => hunt.unitId === place.unitId && hunt.zone === place.zone && hunt.species.toLowerCase() === wanted)
    .sort((a, b) => (a.seasons[0]?.open ?? '').localeCompare(b.seasons[0]?.open ?? ''))
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function shortDate(iso: string): string {
  const [, month, day] = iso.split('-').map(Number)
  return `${MONTHS[month - 1] ?? '?'} ${day}`
}

/** "Sep 10 – Oct 5"; a second season is joined with a comma. */
export function seasonText(hunt: Pick<LehHunt, 'seasons'>): string {
  if (hunt.seasons.length === 0) return 'Season not listed'
  return hunt.seasons.map((season) => `${shortDate(season.open)} – ${shortDate(season.close)}`).join(', ')
}

/**
 * Odds as the synopsis prints them. Under 1 means fewer first-choice
 * applicants than authorizations: everyone who put it first was drawn.
 */
export function oddsText(hunt: Pick<LehHunt, 'odds'>): string {
  if (hunt.odds == null) return 'Odds not listed'
  if (hunt.odds <= 1) return 'Undersubscribed'
  return `${hunt.odds.toLocaleString(undefined, { maximumFractionDigits: 1 })} to 1`
}

export interface RegulationLink {
  label: string
  url: string
}

/**
 * Regional sections of the 2026–2028 Hunting & Trapping Regulations Synopsis
 * whose addresses and page numbers were checked in November 2026. Other
 * regions get the full synopsis without a page.
 */
const REGION_SYNOPSIS: Record<string, { name: string; url: string }> = {
  '6': { name: 'Skeena', url: `${HUNTING_SYNOPSIS_URL}#page=52` },
  '7A': {
    name: 'Omineca',
    url: `${SYNOPSIS_BASE}/regulations/hunting-trapping-synopsis-region-7a-omineca.pdf#page=3`,
  },
}

/**
 * Region 7 is split in two by unit number. Per the province's management-unit
 * layer (November 2026), 7A Omineca holds 7-1 to 7-18, 7-23 to 7-30 and 7-37
 * to 7-41; the rest are 7B Peace.
 */
function synopsisRegion(unitId: string): string | null {
  const match = /^(\d+)-(\d+)$/.exec(normalizeUnitId(unitId))
  if (!match) return null
  const unit = Number(match[2])
  if (match[1] !== '7') return match[1]
  const omineca = (unit >= 1 && unit <= 18) || (unit >= 23 && unit <= 30) || (unit >= 37 && unit <= 41)
  return omineca ? '7A' : '7B'
}

/** Where the official season tables for a unit are, most specific first. */
export function regulationLinks(unitId: string): RegulationLink[] {
  const region = synopsisRegion(unitId)
  const regional = region ? REGION_SYNOPSIS[region] : undefined
  return [
    regional
      ? { label: `Open seasons: ${regional.name} region tables (PDF)`, url: regional.url }
      : { label: 'Open seasons: Hunting & Trapping Synopsis (PDF)', url: HUNTING_SYNOPSIS_URL },
    { label: 'Limited entry hunts for the coming season (PDF)', url: LEH_SYNOPSIS_URL },
    { label: 'In-season changes and corrections', url: REGULATIONS_PAGE_URL },
  ]
}

let pending: Promise<{ drawYear: number | null; hunts: LehHunt[] }> | null = null

async function readText(fetcher: typeof fetch, url: string, maxBytes: number): Promise<string> {
  const response = await fetcher(url)
  if (!response.ok) throw new Error(`BC Data Catalogue answered ${response.status}`)
  return readBoundedText(response, { maxBytes, tooLarge: 'The draw report was larger than expected' })
}

/** The draw report's current address, or the one last checked when the catalogue cannot say. */
async function lehCsvUrl(fetcher: typeof fetch): Promise<string> {
  try {
    return (
      lehCsvUrlFromPackage(JSON.parse(await readText(fetcher, LEH_DRAW_PACKAGE_URL, MAX_LEH_PACKAGE_BYTES))) ??
      LEH_DRAW_CSV_URL
    )
  } catch {
    return LEH_DRAW_CSV_URL
  }
}

/** The draw report, fetched once per visit and shared by every unit shown. */
export function loadLehDraws(fetcher: typeof fetch = fetch): Promise<{ drawYear: number | null; hunts: LehHunt[] }> {
  pending ??= lehCsvUrl(fetcher)
    .then((url) => readText(fetcher, url, MAX_LEH_CSV_BYTES))
    .then(parseLehDraws)
    .catch((error: unknown) => {
      // A failed read must not be remembered, or the panel could never retry.
      pending = null
      throw error
    })
  return pending
}
