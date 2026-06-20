import { describe, expect, it } from 'vitest'
import { mapWalkabilityCommunityFeatureToRegion } from './regions'

type RawFeature = GeoJSON.Feature<GeoJSON.Geometry | null, Record<string, unknown>>

function squareFeature(properties: Record<string, unknown>, id?: string | number): RawFeature {
  return {
    type: 'Feature',
    id,
    properties,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-122.8, 53.9],
          [-122.7, 53.9],
          [-122.7, 54.0],
          [-122.8, 54.0],
          [-122.8, 53.9],
        ],
      ],
    },
  }
}

describe('mapWalkabilityCommunityFeatureToRegion', () => {
  it('maps communityId/communityName and preserves variant scores in properties', () => {
    const region = mapWalkabilityCommunityFeatureToRegion(
      squareFeature({ communityId: 7, communityName: 'Downtown', balancedScore: 82, accessScore: 60 }),
      'walkabilityCommunity',
    )
    expect(region).not.toBeNull()
    expect(region?.code).toBe('7')
    expect(region?.name).toBe('Downtown')
    expect(region?.source).toBe('walkabilityCommunity')
    expect(region?.level).toBe('walkabilityCommunity')
    expect(region?.id).toBe('walkabilityCommunity:walkabilityCommunity:7')
    expect(region?.areaKm2).toBeGreaterThan(0)
    // Precomputed scores must ride along for the community-only metrics.
    expect(region?.feature.properties?.balancedScore).toBe(82)
    expect(region?.feature.properties?.accessScore).toBe(60)
  })

  it('falls back to OBJECTID/CommunityName/feature id when the lowercase keys are absent', () => {
    const region = mapWalkabilityCommunityFeatureToRegion(
      squareFeature({ OBJECTID: 3, CommunityName: 'Hart' }, 'x'),
      'walkabilityCommunity',
    )
    expect(region?.code).toBe('3')
    expect(region?.name).toBe('Hart')
  })

  it('returns null for non-polygon / empty geometry', () => {
    const region = mapWalkabilityCommunityFeatureToRegion(
      { type: 'Feature', id: '1', properties: { communityId: 1 }, geometry: null },
      'walkabilityCommunity',
    )
    expect(region).toBeNull()
  })
})
