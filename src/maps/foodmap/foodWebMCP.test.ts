import { describe, expect, it } from 'vitest'

import { rankFoodOptionsBySafety, resolveFoodEstablishment, summarizeFoodEstablishment } from './foodWebMCP'
import type { CrimeIncident } from '@/maps/pgdata/types'
import type { RestaurantWithStats } from './types'

function establishment(name: string, address: string, riskScore = 0): RestaurantWithStats {
  return {
    name,
    address,
    latitude: 53.9,
    longitude: -122.7,
    facility_type: 'Restaurant',
    establishment_type: 'Restaurant',
    hazard_rating: 'Low',
    details_url: `https://example.test/${encodeURIComponent(name)}-${encodeURIComponent(address)}`,
    inspections: [],
    filteredInspections: [],
    hazardRatingAtDate: 'Low',
    violationStats: {
      total: riskScore,
      critical: 0,
      nonCritical: riskScore,
      inspectionCount: 1,
      risk: {
        severe: 0,
        elevated: 0,
        moderate: riskScore,
        administrative: 0,
        unknown: 0,
        score: riskScore,
        worstBand: riskScore > 0 ? 'Moderate' : 'Unknown',
      },
    },
  }
}

describe('food-safety WebMCP helpers', () => {
  const places = [
    establishment('North Cafe', '10 First Avenue', 3),
    establishment('North Cafe', '99 Second Avenue', 1),
    establishment('River Bakery', '5 River Road'),
  ]

  it('resolves a unique partial establishment name', () => {
    expect(resolveFoodEstablishment(places, 'River').name).toBe('River Bakery')
  })

  it('uses an address fragment to resolve duplicate names', () => {
    expect(resolveFoodEstablishment(places, 'North Cafe', 'Second').address).toBe('99 Second Avenue')
    expect(() => resolveFoodEstablishment(places, 'North Cafe')).toThrow(/ambiguous/i)
  })

  it('returns a compact inspection summary without raw violation text', () => {
    expect(summarizeFoodEstablishment(places[0])).toMatchObject({
      name: 'North Cafe',
      violations: 3,
      riskBand: 'Moderate',
      mapped: true,
    })
  })

  it('balances violations and nearby crime with a transparent score', () => {
    const incidents: CrimeIncident[] = [
      {
        id: 1,
        fileNumber: 'A',
        date: new Date('2026-08-01T00:00:00Z'),
        crimeType: 'Mischief',
        time: '',
        address: 'Near First',
        community: 'Test',
        latitude: 53.9001,
        longitude: -122.7001,
      },
      {
        id: 2,
        fileNumber: 'B',
        date: new Date('2026-08-02T00:00:00Z'),
        crimeType: 'Theft',
        time: '',
        address: 'Near First',
        community: 'Test',
        latitude: 53.9002,
        longitude: -122.7002,
      },
    ]
    const lowViolationAwayFromCrime = {
      ...establishment('Quiet Deli', '20 Quiet Road', 0),
      latitude: 53.95,
      longitude: -122.75,
    }

    const ranked = rankFoodOptionsBySafety([...places, lowViolationAwayFromCrime], incidents, {
      radiusMeters: 500,
      lookbackMonths: 12,
      crimeWeight: 50,
      maxResults: 4,
      referenceDate: new Date('2026-09-01T00:00:00Z'),
    })

    expect(ranked[0]).toMatchObject({
      name: 'Quiet Deli',
      violations: 0,
      nearbyCrimeIncidents: 0,
      suitabilityScore: 100,
    })
    expect(ranked.at(-1)?.nearbyCrimeIncidents).toBe(2)
  })
})
