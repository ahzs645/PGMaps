import type { SpeciesData } from './species'
export interface SpeciesReview {
  status: 'unvisited' | 'needs-check' | 'checked'
  observedLeading: string
  date: string
  note: string
}
export type SpeciesReviews = Record<string, SpeciesReview>
export const EMPTY_SPECIES_REVIEW: SpeciesReview = { status: 'unvisited', observedLeading: '', date: '', note: '' }
export function readSpeciesReviews(text: string, data: SpeciesData): SpeciesReviews {
  const value = JSON.parse(text)
  if (
    value.schema_version !== 1 ||
    value.source_sha256 !== data.source_sha256 ||
    value.inventory_sha256 !== data.inventory_sha256 ||
    !value.records ||
    typeof value.records !== 'object' ||
    Array.isArray(value.records)
  )
    throw Error('Review belongs to another source or inventory')
  const ids = new Set(data.stands.features.map((f) => f.properties.id))
  const records: SpeciesReviews = {}
  for (const [id, raw] of Object.entries(value.records)) {
    const r = raw as SpeciesReview
    if (
      !ids.has(id) ||
      !r ||
      !['unvisited', 'needs-check', 'checked'].includes(r.status) ||
      typeof r.observedLeading !== 'string' ||
      (r.observedLeading !== '' && !data.species[r.observedLeading]) ||
      typeof r.date !== 'string' ||
      !/^$|^\d{4}-\d{2}-\d{2}$/.test(r.date) ||
      typeof r.note !== 'string' ||
      r.note.length > 2000
    )
      throw Error('Invalid stand or review record')
    records[id] = { status: r.status, observedLeading: r.observedLeading, date: r.date, note: r.note }
  }
  return records
}
export function speciesReviewFile(records: SpeciesReviews, data: SpeciesData) {
  return JSON.stringify(
    { schema_version: 1, source_sha256: data.source_sha256, inventory_sha256: data.inventory_sha256, records },
    null,
    2,
  )
}
