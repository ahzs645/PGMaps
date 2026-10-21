import { EMPTY_REVIEW, type InventoryData, type TreeReview } from './types'
export function parseReviews(value: unknown, data: InventoryData): Record<string, TreeReview> {
  if (!value || typeof value !== 'object') throw Error('Invalid review manifest')
  const v = value as {
    schema_version: number
    run_id: string
    source_sha256: string
    reviews: Record<string, TreeReview>
  }
  if (v.schema_version !== 1) throw Error('Unsupported review manifest version')
  if (v.run_id !== data.run_id || v.source_sha256 !== data.source_sha256 || !v.reviews || typeof v.reviews !== 'object')
    throw Error('Review manifest belongs to a different inventory run')
  const ids = new Set(data.crowns.features.map((f) => f.properties.id)),
    out: Record<string, TreeReview> = {}
  for (const [id, r] of Object.entries(v.reviews)) {
    if (
      !ids.has(id) ||
      !r ||
      !['unreviewed', 'accepted', 'excluded', 'split', 'merged'].includes(r.status) ||
      typeof r.species !== 'string' ||
      r.species.length > 12 ||
      typeof r.note !== 'string' ||
      r.note.length > 5000 ||
      (r.dbh_cm !== null && (!Number.isFinite(r.dbh_cm) || r.dbh_cm <= 0 || r.dbh_cm > 500))
    )
      throw Error('Invalid tree review row')
    out[id] = { ...EMPTY_REVIEW, ...r }
  }
  return out
}
export const reviewManifest = (data: InventoryData, reviews: Record<string, TreeReview>) => ({
  schema_version: 1,
  run_id: data.run_id,
  source_sha256: data.source_sha256,
  reviews,
})
