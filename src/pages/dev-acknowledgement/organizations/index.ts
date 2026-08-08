// Organization database — one JSON file per organization in this folder.
// Each record stores FACTS (Nations named, campus coordinates, framing) plus a
// link to the official source; the full verbatim wording is NOT stored here (it
// stays at sourceUrl). See README.md for how to add a record from a source.
//
// Files are auto-discovered, so adding an org is just dropping a `<id>.json` here.

export type OrgSector =
  | 'university'
  | 'college'
  | 'institute'
  | 'health'
  | 'crown-agency'
  | 'municipality'
  | 'regional-district'
  | 'school-district'
  | 'library'
  | 'cultural'
  | 'non-profit'

/** How the organization frames its acknowledgement(s). */
export type OrgFraming =
  | 'single_specific' // one site, names specific Nation(s)
  | 'per_campus' // distinct campus-specific acknowledgements
  | 'regional' // broad region-wide wording, no specific Nations
  | 'mixed' // broad institution-wide wording plus campus specifics

export type OrgCampus = {
  name: string
  latitude: number
  longitude: number
  /** Nations the org names for this campus (from the org's own materials). */
  acknowledges: string[]
  /**
   * Optional display label for the kind of location (e.g. "Campus", "Office",
   * "Satellite"). When unset, the UI falls back to `inferLocationType(name)`.
   */
  type?: string
}

/**
 * Derive a short location-type label from a location's name (and, as a fallback,
 * the org's sector). Keyword matches are high-precision; the sector fallback only
 * fires for post-secondary orgs, where a place-named site is reliably a campus.
 * Anything still ambiguous stays generic (no badge) rather than getting a guess.
 */
export function inferLocationType(name: string, sector?: OrgSector): string | undefined {
  const n = name.toLowerCase()
  if (n.includes('satellite')) return 'Satellite'
  if (n.includes('office')) return 'Office'
  if (n.includes('institute')) return 'Institute'
  if (n.includes('library')) return 'Library'
  if (n.includes('campus')) return 'Campus'
  if (sector === 'university' || sector === 'college' || sector === 'institute') return 'Campus'
  return undefined
}

export type OrgRecord = {
  id: string
  name: string
  sector: OrgSector
  framing: OrgFraming
  /** Nations the org names institution-wide (union across sites). */
  acknowledges: string[]
  /** Official page where the full wording lives. */
  sourceUrl: string
  /** Short factual summary of their approach. */
  note?: string
  /** Optional short structural label for the wording form (e.g. "located_on"). */
  pattern?: string
  /**
   * Optional: the organization's own acknowledgement wording, a sourced excerpt,
   * or a wording-specific note.
   */
  statement?: string
  /** Whether `statement` is a full exact source statement, exact excerpt, or not found. */
  statementKind?: 'exact_statement' | 'exact_excerpt' | 'not_found'
  campuses: OrgCampus[]
}

const modules = import.meta.glob<{ default: OrgRecord }>('./*.json', { eager: true })

export const organizations: OrgRecord[] = Object.values(modules)
  .map((mod) => mod.default)
  .filter((org): org is OrgRecord => Boolean(org && org.id && org.name))
  .sort((left, right) => left.name.localeCompare(right.name))
