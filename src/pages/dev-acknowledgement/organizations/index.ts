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
  /**
   * Optional: the organization's own acknowledgement wording. Left empty by
   * default — populate only with text you have the right to store (e.g. a short
   * attributed excerpt or your own gathered notes). The full statement lives at
   * `sourceUrl`. Not auto-filled to avoid reproducing copyrighted wording.
   */
  statement?: string
  campuses: OrgCampus[]
}

// Exclude nation-registry.json — it lives here but is not an org record.
const modules = import.meta.glob<{ default: OrgRecord }>(['./*.json', '!./nation-registry.json'], { eager: true })

export const organizations: OrgRecord[] = Object.values(modules)
  .map((mod) => mod.default)
  .filter((org): org is OrgRecord => Boolean(org && org.id && org.name))
  .sort((left, right) => left.name.localeCompare(right.name))
