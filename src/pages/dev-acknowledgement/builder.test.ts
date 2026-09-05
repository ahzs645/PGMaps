import { describe, expect, it } from 'vitest'
import { chosenCandidates, createLocation, defaultSources, locationCandidates, locationReady } from './builder'
import { locationFromCoordinates } from './geocode'

const result = locationFromCoordinates({ latitude: 53.9, longitude: -122.8 })
describe('location evidence used by single and combined drafts', () => {
  it('does not treat language or treaty overlap names as Nations', () => {
    const location = createLocation(result)
    location.lookups = {
      ...location.lookups,
      nativeLand: {
        status: 'success',
        matches: [
          { source: 'nativeLand', name: 'Nation A', label: 'Native Land territory overlap' },
          { source: 'nativeLand', name: 'Language A', label: 'Native Land language overlap' },
          { source: 'nativeLand', name: 'Treaty A', label: 'Native Land treaty overlap' },
        ],
      },
    }
    const candidates = locationCandidates(location, null, { ...defaultSources, nativeLand: true })
    expect(candidates.map((item) => item.name)).toEqual(['Nation A'])
    expect(chosenCandidates(location, candidates)).toEqual([])
    location.selectedIds = [candidates[0].id]
    expect(chosenCandidates(location, candidates).map((item) => item.name)).toEqual(['Nation A'])
    expect(locationCandidates(location, null, defaultSources)).toEqual([])
  })
  it('selects all strong documented relationships and preserves explicit deselection', () => {
    const location = createLocation(result)
    location.lookups = {
      ...location.lookups,
      verified: {
        status: 'success',
        matches: [
          { source: 'verified', name: 'Nation A', label: 'Place', verificationStatus: 'verified_institutional' },
          { source: 'verified', name: 'Nation B', label: 'Place', verificationStatus: 'verified_local_context' },
          { source: 'verified', name: 'Nation C', label: 'Area', verificationStatus: 'boundary_context' },
        ],
      },
    }
    const candidates = locationCandidates(location, null, defaultSources)
    expect(chosenCandidates(location, candidates).map((item) => item.name)).toEqual(['Nation A', 'Nation B'])
    expect(locationReady(location, chosenCandidates(location, candidates))).toBe(false)
    location.status = 'done'
    expect(locationReady(location, chosenCandidates(location, candidates))).toBe(true)
    location.selectedIds = [...chosenCandidates(location, candidates).map((item) => item.id), 'unavailable-selection']
    expect(locationReady(location, chosenCandidates(location, candidates))).toBe(false)
    location.selectedIds = []
    expect(chosenCandidates(location, candidates)).toEqual([])
    expect(locationReady(location, [])).toBe(false)
  })
})
