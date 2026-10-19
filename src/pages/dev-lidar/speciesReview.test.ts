import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { EMPTY_SPECIES_REVIEW, readSpeciesReviews, speciesReviewFile } from './speciesReview'
import type { SpeciesData } from './species'
const data = JSON.parse(readFileSync(new URL('./species.generated.json', import.meta.url), 'utf8')) as SpeciesData
const id = data.stands.features[0].properties.id
const records = {
  [id]: {
    ...EMPTY_SPECIES_REVIEW,
    status: 'checked' as const,
    observedLeading: 'EP',
    date: '2026-10-18',
    note: 'Reviewed with field observations',
  },
}
describe('species field-review exchange', () => {
  it('preserves observations separately with source and inventory identity', () => {
    expect(readSpeciesReviews(speciesReviewFile(records, data), data)).toEqual(records)
  })
  it('rejects notes from another inventory, unknown stands and invalid species', () => {
    const file = JSON.parse(speciesReviewFile(records, data))
    expect(() => readSpeciesReviews(JSON.stringify({ ...file, inventory_sha256: 'other' }), data)).toThrow()
    expect(() => readSpeciesReviews(JSON.stringify({ ...file, records: { unknown: records[id] } }), data)).toThrow()
    expect(() =>
      readSpeciesReviews(
        JSON.stringify({ ...file, records: { [id]: { ...records[id], observedLeading: 'ALIEN' } } }),
        data,
      ),
    ).toThrow()
  })
})
