// Organization database — one JSON file per organization in this folder.
// Each record stores FACTS (Nations named, campus coordinates, framing) plus a
// link to the official source; the full verbatim wording is NOT stored here (it
// stays at sourceUrl). See README.md for how to add a record from a source.
//
// Files are auto-discovered, so adding an org is just dropping a `<id>.json` here.

export type OrgSector = 'university' | 'college' | 'institute' | 'health' | 'crown-agency' | 'municipality'

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
  /** Short factual paraphrase of their approach (never their verbatim statement). */
  note?: string
  /** Optional short structural label for the wording form (e.g. "located_on"). */
  pattern?: string
  campuses: OrgCampus[]
}

const modules = import.meta.glob<{ default: OrgRecord }>('./*.json', { eager: true })

export const organizations: OrgRecord[] = Object.values(modules)
  .map((mod) => mod.default)
  .sort((left, right) => left.name.localeCompare(right.name))
