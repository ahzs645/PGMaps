import { filterResearchRecords, summarizeResearchDecades } from './filterResearchRecords'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { fetchJson } from '@/lib/fetchJson'
import type { ProjectMapExplorerWorkspaceDef } from '@/lib/projectPackages'

import type {
  ExplorerLocationFeatureProperties,
  ResearchRecord,
  ResearchRecordsLocation,
  ResearchRecordsOverview,
  ResearchRecordsTimelineBucket,
} from './researchRecordsTypes'
import { researchLocationDisplayName } from './researchLocationNames'

export function useResearchRecordsAdapter(config: ProjectMapExplorerWorkspaceDef, timelineMode = false) {
  const [overview, setOverview] = useState<ResearchRecordsOverview | null>(null)
  const [submissions, setSubmissions] = useState<ResearchRecord[]>([])
  const [locations, setLocations] = useState<ResearchRecordsLocation[]>([])
  const [decades, setDecades] = useState<ResearchRecordsTimelineBucket[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [selectedDecade, setSelectedDecade] = useState<number | null>(null)
  const [timelineDecade, setTimelineDecade] = useState<number | null>(null)
  const effectiveDecade = timelineMode ? (timelineDecade ?? decades.at(-1)?.decade ?? null) : selectedDecade
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null)
  const resourceTypeColors = useMemo(
    () => Object.fromEntries(config.data.categories.map((type) => [type.id, type.color])),
    [config.data.categories],
  )
  const resourceTypeLabels = useMemo(
    () => Object.fromEntries(config.data.categories.map((type) => [type.id, type.label])),
    [config.data.categories],
  )
  const regionalLocationIds = useMemo(
    () => new Set(config.data.aggregateLocationIds),
    [config.data.aggregateLocationIds],
  )
  const searchFields = useMemo(
    () => config.features.find((feature) => feature.type === 'search')?.fields ?? [],
    [config.features],
  )

  useEffect(() => {
    const controller = new AbortController()
    const base = config.data.baseUrl

    Promise.all([
      fetchJson<ResearchRecordsOverview>(`${base}${config.data.files.overview}`, controller.signal),
      fetchJson<ResearchRecord[]>(`${base}${config.data.files.records}`, controller.signal),
      fetchJson<ResearchRecordsLocation[]>(`${base}${config.data.files.locations}`, controller.signal),
      fetchJson<ResearchRecordsTimelineBucket[]>(`${base}${config.data.files.timeline}`, controller.signal),
    ])
      .then(([nextOverview, nextSubmissions, nextLocations, nextDecades]) => {
        setOverview(nextOverview)
        setSubmissions(nextSubmissions)
        setLocations(
          nextLocations.map((location) => ({
            ...location,
            name: researchLocationDisplayName(location),
          })),
        )
        setDecades(nextDecades)
        setLoading(false)
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        setError(reason instanceof Error ? reason.message : 'The research data could not be loaded.')
        setLoading(false)
      })

    return () => controller.abort()
  }, [config.data.baseUrl, config.data.files, reloadKey])

  const matchingSubmissions = useMemo(
    () => filterResearchRecords(submissions, searchQuery, selectedTypes, searchFields),
    [submissions, searchQuery, selectedTypes, searchFields],
  )
  const filteredDecades = useMemo(
    () => summarizeResearchDecades(matchingSubmissions, decades),
    [matchingSubmissions, decades],
  )
  const filteredSubmissions = useMemo(
    () => matchingSubmissions.filter((record) => effectiveDecade === null || record.decade === effectiveDecade),
    [matchingSubmissions, effectiveDecade],
  )

  const regionalOnlySubmissions = useMemo(
    () =>
      filteredSubmissions.filter(
        (submission) =>
          submission.locationIds.length > 0 &&
          submission.locationIds.every((locationId) => regionalLocationIds.has(locationId)),
      ),
    [filteredSubmissions, regionalLocationIds],
  )

  const locationStatsMap = useMemo(() => {
    const stats = new Map<string, { count: number; resourceTypes: Record<string, number> }>()
    for (const submission of filteredSubmissions) {
      for (const locationId of submission.locationIds) {
        const current = stats.get(locationId) ?? { count: 0, resourceTypes: {} }
        current.count += 1
        current.resourceTypes[submission.resourceTypeMain] =
          (current.resourceTypes[submission.resourceTypeMain] ?? 0) + 1
        stats.set(locationId, current)
      }
    }
    return stats
  }, [filteredSubmissions])

  const filteredLocations = useMemo(
    () =>
      locations
        .filter((location) => !regionalLocationIds.has(location.id))
        .map((location) => ({
          ...location,
          filteredCount: locationStatsMap.get(location.id)?.count ?? 0,
          filteredResourceTypes: locationStatsMap.get(location.id)?.resourceTypes ?? {},
        }))
        .filter((location) => location.filteredCount > 0)
        .sort((a, b) => b.filteredCount - a.filteredCount),
    [locationStatsMap, locations, regionalLocationIds],
  )

  const locationGeoJSON = useMemo((): GeoJSON.FeatureCollection<GeoJSON.Point, ExplorerLocationFeatureProperties> => {
    const maxCount = Math.max(1, ...filteredLocations.map((location) => location.filteredCount))
    return {
      type: 'FeatureCollection',
      features: filteredLocations
        .filter((location) => location.coordinates)
        .map((location) => {
          const dominantType =
            Object.entries(location.filteredResourceTypes).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'other'
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
              bandCounts: config.data.categories.map((category) => location.filteredResourceTypes[category.id] ?? 0),
            },
          }
        }),
    }
  }, [config.data.categories, filteredLocations, resourceTypeColors])

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
    for (const record of filterResearchRecords(submissions, searchQuery, new Set(), searchFields, effectiveDecade)) {
      types.set(record.resourceTypeMain, (types.get(record.resourceTypeMain) ?? 0) + 1)
    }
    return [...types.entries()].sort((a, b) => b[1] - a[1])
  }, [searchFields, searchQuery, effectiveDecade, submissions])

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

  return {
    overview,
    submissions,
    decades: filteredDecades,
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
    selectedDecade: effectiveDecade,
    setSelectedDecade: timelineMode ? setTimelineDecade : setSelectedDecade,
    timelineDecade: effectiveDecade,
    setTimelineDecade,
    selectedTypes,
    setSelectedTypes,
    toggleResourceType,
    searchQuery,
    setSearchQuery,
    selectedLocationId,
    setSelectedLocationId,
    selectedLocation,
    clearFilters,
    resourceTypeColors,
    resourceTypeLabels,
  }
}

export type ResearchRecordsAdapterData = ReturnType<typeof useResearchRecordsAdapter>
