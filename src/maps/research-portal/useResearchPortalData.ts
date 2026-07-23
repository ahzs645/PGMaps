import { useCallback, useEffect, useMemo, useState } from 'react'

import type { ProjectDataPortalDef } from '@/lib/projectPackages'

import type {
  ResearchPortalDecadeSeries,
  ResearchPortalLocation,
  ResearchPortalLocationFeatureProperties,
  ResearchPortalOverview,
  ResearchPortalSubmission,
} from './types'

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Data request failed (${response.status})`)
  return response.json() as Promise<T>
}

export function useResearchPortalData(config: ProjectDataPortalDef) {
  const [overview, setOverview] = useState<ResearchPortalOverview | null>(null)
  const [submissions, setSubmissions] = useState<ResearchPortalSubmission[]>([])
  const [locations, setLocations] = useState<ResearchPortalLocation[]>([])
  const [decades, setDecades] = useState<ResearchPortalDecadeSeries[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [selectedDecade, setSelectedDecade] = useState<number | null>(null)
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null)
  const resourceTypeColors = useMemo(
    () => Object.fromEntries(config.resourceTypes.map((type) => [type.id, type.color])),
    [config.resourceTypes],
  )
  const resourceTypeLabels = useMemo(
    () => Object.fromEntries(config.resourceTypes.map((type) => [type.id, type.label])),
    [config.resourceTypes],
  )
  const regionalLocationIds = useMemo(() => new Set(config.regionalLocationIds), [config.regionalLocationIds])

  useEffect(() => {
    const controller = new AbortController()
    const base = config.dataBaseUrl

    Promise.all([
      fetchJson<ResearchPortalOverview>(`${base}${config.files.overview}`, controller.signal),
      fetchJson<ResearchPortalSubmission[]>(`${base}${config.files.submissions}`, controller.signal),
      fetchJson<ResearchPortalLocation[]>(`${base}${config.files.locations}`, controller.signal),
      fetchJson<ResearchPortalDecadeSeries[]>(`${base}${config.files.decades}`, controller.signal),
    ])
      .then(([nextOverview, nextSubmissions, nextLocations, nextDecades]) => {
        setOverview(nextOverview)
        setSubmissions(nextSubmissions)
        setLocations(nextLocations)
        setDecades(nextDecades)
        setLoading(false)
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        setError(reason instanceof Error ? reason.message : 'The research data could not be loaded.')
        setLoading(false)
      })

    return () => controller.abort()
  }, [config.dataBaseUrl, config.files, reloadKey])

  const filteredSubmissions = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    return submissions.filter((submission) => {
      if (selectedDecade !== null && submission.decade !== selectedDecade) return false
      if (selectedTypes.size > 0 && !selectedTypes.has(submission.resourceTypeMain)) return false
      if (!normalizedQuery) return true
      return (
        submission.title?.toLowerCase().includes(normalizedQuery) ||
        submission.author?.toLowerCase().includes(normalizedQuery) ||
        submission.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery))
      )
    })
  }, [searchQuery, selectedDecade, selectedTypes, submissions])

  const regionalOnlySubmissions = useMemo(
    () =>
      filteredSubmissions.filter(
        (submission) =>
          submission.locationIds.length > 0 &&
          submission.locationIds.every((locationId) => regionalLocationIds.has(locationId)),
      ),
    [filteredSubmissions, regionalLocationIds],
  )

  const locationCountMap = useMemo(() => {
    const counts = new Map<string, number>()
    for (const submission of filteredSubmissions) {
      for (const locationId of submission.locationIds) {
        counts.set(locationId, (counts.get(locationId) ?? 0) + 1)
      }
    }
    return counts
  }, [filteredSubmissions])

  const filteredLocations = useMemo(
    () =>
      locations
        .filter((location) => !regionalLocationIds.has(location.id))
        .map((location) => ({
          ...location,
          filteredCount: locationCountMap.get(location.id) ?? 0,
        }))
        .filter((location) => location.filteredCount > 0)
        .sort((a, b) => b.filteredCount - a.filteredCount),
    [locationCountMap, locations, regionalLocationIds],
  )

  const locationGeoJSON = useMemo((): GeoJSON.FeatureCollection<
    GeoJSON.Point,
    ResearchPortalLocationFeatureProperties
  > => {
    const maxCount = Math.max(1, ...filteredLocations.map((location) => location.filteredCount))
    return {
      type: 'FeatureCollection',
      features: filteredLocations
        .filter((location) => location.coordinates)
        .map((location) => {
          const dominantType = Object.entries(location.resourceTypes).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'other'
          return {
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: [location.coordinates!.lon, location.coordinates!.lat],
            },
            properties: {
              id: location.id,
              name: location.name,
              count: location.filteredCount,
              color: resourceTypeColors[dominantType] ?? resourceTypeColors.other ?? '#94a3b8',
              radius: 6 + Math.sqrt(location.filteredCount / maxCount) * 20,
              dominantType,
            },
          }
        }),
    }
  }, [filteredLocations, resourceTypeColors])

  const filteredStats = useMemo(() => {
    const typeBreakdown = new Map<string, number>()
    for (const submission of filteredSubmissions) {
      typeBreakdown.set(submission.resourceTypeMain, (typeBreakdown.get(submission.resourceTypeMain) ?? 0) + 1)
    }
    return {
      totalPublications: filteredSubmissions.length,
      activeLocations: filteredLocations.length,
      typeBreakdown: [...typeBreakdown.entries()].sort((a, b) => b[1] - a[1]),
    }
  }, [filteredLocations.length, filteredSubmissions])

  const allResourceTypes = useMemo(() => {
    const types = new Map<string, number>()
    const normalizedQuery = searchQuery.trim().toLowerCase()
    for (const submission of submissions) {
      if (selectedDecade !== null && submission.decade !== selectedDecade) continue
      if (
        normalizedQuery &&
        !submission.title?.toLowerCase().includes(normalizedQuery) &&
        !submission.author?.toLowerCase().includes(normalizedQuery) &&
        !submission.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery))
      ) {
        continue
      }
      types.set(submission.resourceTypeMain, (types.get(submission.resourceTypeMain) ?? 0) + 1)
    }
    return [...types.entries()].sort((a, b) => b[1] - a[1])
  }, [searchQuery, selectedDecade, submissions])

  const selectedLocation = useMemo(
    () => filteredLocations.find((location) => location.id === selectedLocationId) ?? null,
    [filteredLocations, selectedLocationId],
  )

  const toggleResourceType = useCallback((type: string) => {
    setSelectedTypes((current) => {
      const next = new Set(current)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }, [])

  const clearFilters = useCallback(() => {
    setSelectedDecade(null)
    setSelectedTypes(new Set())
    setSearchQuery('')
  }, [])

  const buildDecadeGeoJSON = useCallback(
    (decade: number): GeoJSON.FeatureCollection<GeoJSON.Point, ResearchPortalLocationFeatureProperties> => {
      const mappable = locations.filter((location) => location.coordinates && !regionalLocationIds.has(location.id))
      const globalMax = Math.max(
        1,
        ...mappable.map((location) => Math.max(0, ...Object.values(location.byDecade).map(Number))),
      )
      return {
        type: 'FeatureCollection',
        features: mappable.flatMap((location) => {
          const count = location.byDecade[String(decade)] ?? 0
          if (!count) return []
          const dominantType = Object.entries(location.resourceTypes).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'other'
          return [
            {
              type: 'Feature' as const,
              geometry: {
                type: 'Point' as const,
                coordinates: [location.coordinates!.lon, location.coordinates!.lat],
              },
              properties: {
                id: location.id,
                name: location.name,
                count,
                color: resourceTypeColors[dominantType] ?? resourceTypeColors.other ?? '#94a3b8',
                radius: 6 + Math.sqrt(count / globalMax) * 22,
                dominantType,
              },
            },
          ]
        }),
      }
    },
    [locations, regionalLocationIds, resourceTypeColors],
  )

  return {
    overview,
    submissions,
    decades,
    loading,
    error,
    retry: () => {
      setLoading(true)
      setError(null)
      setReloadKey((current) => current + 1)
    },
    filteredSubmissions,
    filteredLocations,
    locationGeoJSON,
    filteredStats,
    allResourceTypes,
    regionalOnlySubmissions,
    selectedDecade,
    setSelectedDecade,
    selectedTypes,
    toggleResourceType,
    searchQuery,
    setSearchQuery,
    selectedLocationId,
    setSelectedLocationId,
    selectedLocation,
    clearFilters,
    buildDecadeGeoJSON,
    resourceTypeColors,
    resourceTypeLabels,
  }
}

export type ResearchPortalData = ReturnType<typeof useResearchPortalData>
