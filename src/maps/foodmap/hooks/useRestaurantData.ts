import { useState, useEffect, useMemo, useCallback } from 'react'
import { getHazardRating } from '../hazard'
import type { Restaurant, RestaurantStats, HazardRating, EstablishmentType } from '../types'
import { normalizeViolation } from '../violation-codes'

interface GeocodedLocation {
  dataset: string
  source_index: number
  latitude: number
  longitude: number
  google_geocoded_address?: string
  google_place_id?: string
  google_location_type?: string
  google_partial_match?: boolean
}

interface GeocodedLocationsFile {
  locations?: GeocodedLocation[]
}

export function useRestaurantData(enabled = true) {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    if (!enabled) {
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const [response, clsResponse, locationResponse, geocodedResponse] = await Promise.all([
        fetch(`${import.meta.env.BASE_URL}data/restaurants.json`),
        fetch(`${import.meta.env.BASE_URL}data/restaurant-classifications.json`),
        fetch(`${import.meta.env.BASE_URL}data/restaurant-location-overrides.json`),
        fetch(`${import.meta.env.BASE_URL}data/geocoding/geocoded_locations.json`)
      ])
      if (!response.ok) {
        throw new Error(`Failed to load data: ${response.status}`)
      }
      const data = await response.json()
      const classifications: Record<string, EstablishmentType> = clsResponse.ok
        ? await clsResponse.json()
        : {}
      const locationOverrides: Record<string, { latitude: number; longitude: number }> = locationResponse.ok
        ? await locationResponse.json()
        : {}
      const geocodedFile: GeocodedLocationsFile = geocodedResponse.ok
        ? await geocodedResponse.json()
        : {}
      const restaurantGeocodes = new Map(
        (geocodedFile.locations ?? [])
          .filter((location) => location.dataset === 'restaurants')
          .map((location) => [location.source_index, location])
      )

      const merged = data.map((r: Restaurant, index: number) => {
        const locationOverride = locationOverrides[r.name]
        const geocodedLocation = restaurantGeocodes.get(index)
        // Backfill junk "Critical"/"Repeat" violation titles with real rule text
        // once at load, so the panel, cards, and roulette all get clean data.
        const inspections = r.inspections?.map((inspection) => ({
          ...inspection,
          violations: inspection.violations?.map(normalizeViolation)
        }))
        return {
          ...r,
          inspections,
          latitude: locationOverride?.latitude ?? geocodedLocation?.latitude ?? r.latitude,
          longitude: locationOverride?.longitude ?? geocodedLocation?.longitude ?? r.longitude,
          google_geocoded_address: geocodedLocation?.google_geocoded_address,
          google_place_id: geocodedLocation?.google_place_id,
          google_location_type: geocodedLocation?.google_location_type,
          google_partial_match: geocodedLocation?.google_partial_match,
          establishment_type: classifications[r.name] || r.facility_type || 'Restaurant'
        }
      })
      setRestaurants(merged)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    loadData()
  }, [loadData])

  const stats = useMemo<RestaurantStats>(() => {
    const total = restaurants.length
    const geocoded = restaurants.filter(r => r.latitude && r.longitude).length

    const byHazard = restaurants.reduce((acc, r) => {
      const rating = getHazardRating(r)
      acc[rating] = (acc[rating] || 0) + 1
      return acc
    }, {} as Record<HazardRating, number>)

    const byFacilityType = restaurants.reduce((acc, r) => {
      const type = r.establishment_type || r.facility_type || 'Unknown'
      acc[type] = (acc[type] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    const totalInspections = restaurants.reduce((acc, r) => {
      return acc + (r.inspections?.length || 0)
    }, 0)

    const totalViolations = restaurants.reduce((acc, r) => {
      return acc + (r.inspections || []).reduce((sum, insp) => {
        return sum + (insp.violations?.length || 0)
      }, 0)
    }, 0)

    return {
      total,
      geocoded,
      byHazard,
      byFacilityType,
      totalInspections,
      totalViolations
    }
  }, [restaurants])

  return {
    restaurants,
    loading,
    error,
    stats,
    reload: loadData
  }
}
