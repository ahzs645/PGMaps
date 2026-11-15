/**
 * Where a cost applies: a country, then a province or state, then a region inside it, then a named
 * place. Countries and provinces/states use ISO 3166 codes (`CA`, `CA-BC`, `US-MT`); a region is
 * named by the scheme that defines it (`bc-nr:omineca` for a BC natural resource region), so two
 * provinces' region schemes never collide.
 *
 * A place orders and labels evidence; it never weights, averages or adjusts a price. Free of DOM and
 * network access.
 */
import { object, optional, text } from '@/lib/jsonGuards'

export interface CostPlace {
  /** ISO 3166-1 alpha-2, upper case: `CA`, `US`, `NZ`. */
  country: string
  /** ISO 3166-2 inside `country`: `CA-BC`, `US-MT`, `GB-ENG`. */
  subdivision?: string
  /** `<scheme>:<id>`, a region of the subdivision's region scheme: `bc-nr:omineca`. */
  region?: string
  /** A town or site, free text: "Prince George". Never used to match. */
  locality?: string
}

/** How near a record is to the project, nearest first. */
export type PlaceRelation = 'same-region' | 'same-subdivision' | 'same-country' | 'elsewhere' | 'unplaced'

export const PLACE_RELATIONS: Record<PlaceRelation, { rank: number; label: string }> = {
  'same-region': { rank: 0, label: 'Same region' },
  'same-subdivision': { rank: 1, label: 'Same province or state' },
  'same-country': { rank: 2, label: 'Same country' },
  elsewhere: { rank: 3, label: 'Elsewhere' },
  unplaced: { rank: 4, label: 'No project location' },
}

const COUNTRY = /^[A-Z]{2}$/
const SUBDIVISION = /^([A-Z]{2})-[A-Z0-9]{1,3}$/
const REGION = /^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * How `of` (a record's place) stands to `to` (the project's). Nearer only when both name the same
 * level: a record placed only by country is "same country" even for a project with a region.
 */
export function placeRelation(of: CostPlace | undefined, to: CostPlace | undefined): PlaceRelation {
  if (!to) return 'unplaced'
  if (!of || of.country !== to.country) return 'elsewhere'
  if (of.subdivision && of.subdivision === to.subdivision) {
    return of.region && of.region === to.region ? 'same-region' : 'same-subdivision'
  }
  return 'same-country'
}

/** The region scheme a region id belongs to (`bc-nr`), or null. */
export const regionScheme = (region: string) => region.slice(0, region.indexOf(':')) || null

/** The region's id inside its scheme (`omineca`). */
export const regionLocalId = (region: string) => region.slice(region.indexOf(':') + 1)

/** One comparable key per level, most specific first: used to group and to compare. */
export function placeKeys(place: CostPlace): string[] {
  return [place.region, place.subdivision, place.country].filter((key): key is string => !!key)
}

export function samePlace(a: CostPlace | undefined, b: CostPlace | undefined): boolean {
  return (
    !!a &&
    !!b &&
    a.country === b.country &&
    a.subdivision === b.subdivision &&
    a.region === b.region &&
    (a.locality ?? '') === (b.locality ?? '')
  )
}

/** Why a place cannot be stored, or null. Codes are checked for shape, not against a list. */
export function placeProblem(place: CostPlace): string | null {
  if (!COUNTRY.test(place.country)) return 'A country is a two-letter ISO code such as CA.'
  if (place.subdivision !== undefined) {
    const match = SUBDIVISION.exec(place.subdivision)
    if (!match) return 'A province or state is an ISO 3166-2 code such as CA-BC.'
    if (match[1] !== place.country) return `${place.subdivision} is not inside ${place.country}.`
  }
  if (place.region !== undefined) {
    if (!place.subdivision) return 'A region needs its province or state.'
    if (!REGION.test(place.region)) return 'A region is written scheme:id, such as bc-nr:omineca.'
  }
  if (place.locality !== undefined && (!place.locality.trim() || place.locality.length > 120))
    return 'A locality has 1–120 characters.'
  return null
}

/** Reads a stored place. Unknown codes of the right shape are kept: a pack may be added later. */
export function parseCostPlace(raw: unknown, label: string): CostPlace {
  const r = object(raw, label)
  const place: CostPlace = {
    country: text(r.country, `${label} country`, 2),
    ...optionalText(r, 'subdivision', `${label} province or state`, 6),
    ...optionalText(r, 'region', `${label} region`, 80),
    ...optionalText(r, 'locality', `${label} locality`, 120),
  }
  const problem = placeProblem(place)
  if (problem) throw Error(`${label}: ${problem}`)
  return place
}

function optionalText<K extends string>(r: Record<string, unknown>, key: K, label: string, max: number) {
  const value = optional(r, key, (v) => text(v, label, max))
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: string }
}
