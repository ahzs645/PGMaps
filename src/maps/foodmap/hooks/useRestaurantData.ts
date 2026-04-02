import { useState, useEffect, useMemo, useCallback } from 'react'
import type { Restaurant, RestaurantStats, HazardRating, EstablishmentType } from '../types'

export function useRestaurantData() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const [response, clsResponse] = await Promise.all([
        fetch(`${import.meta.env.BASE_URL}data/restaurants.json`),
        fetch(`${import.meta.env.BASE_URL}data/restaurant-classifications.json`)
      ])
      if (!response.ok) {
        throw new Error(`Failed to load data: ${response.status}`)
      }
      const data = await response.json()
      const classifications: Record<string, EstablishmentType> = clsResponse.ok
        ? await clsResponse.json()
        : {}

      const merged = data.map((r: Restaurant) => ({
        ...r,
        establishment_type: classifications[r.name] || r.facility_type || 'Restaurant'
      }))
      setRestaurants(merged)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const stats = useMemo<RestaurantStats>(() => {
    const total = restaurants.length
    const geocoded = restaurants.filter(r => r.latitude && r.longitude).length

    const byHazard = restaurants.reduce((acc, r) => {
      const rating = (r.current_hazard_rating || r.hazard_rating || 'Unknown') as HazardRating
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
