import { useCallback, useMemo, useState } from 'react'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { point } from '@turf/helpers'
import { useJsonManifest } from '../shared'
import {
  WATER_BOUNDARY_CONFIG,
  WATER_CENSUS_LEVEL_OPTIONS,
  WATER_HEALTH_LEVEL_OPTIONS,
  WATER_NR_ADMIN_LEVEL_OPTIONS,
  WATER_POINT_CATEGORIES,
  WATER_REGIONAL_DISTRICT_LEVEL_OPTIONS,
  WATER_ROOT,
  WATER_WATERSHED_LEVEL_OPTIONS,
} from './constants'
import {
  collectRows,
  findArray,
  firstString,
  getBoundaryMetricValue,
  getFacilitySampleTotal,
  getInspectionRows,
  isRecord,
  normalizeFacility,
  normalizeNotice,
  normalizeSample,
  orderHazardRatings,
  prepareBoundaries,
  sameFacility,
} from './utils'
import type {
  BoundaryFeatureCollection,
  CombinedWaterNoticesSummary,
  GeocodedLocationsFile,
  WaterBoundaryAggregateProperties,
  WaterBoundaryLevel,
  WaterBoundaryMetric,
  WaterBoundarySource,
  WaterFacility,
  WaterFacilityFeatureProperties,
  WaterLayerMode,
  WaterManifest,
  WaterPointCategory,
  WaterSampleKindFilter,
  WaterSampleRow,
} from './types'

function useWaterJson<T>(active: boolean, filename: string) {
  return useJsonManifest<T>(active ? `${WATER_ROOT}/${filename}` : null)
}

export function useWaterData(active: boolean) {
  const [boundarySource, setBoundarySource] = useState<WaterBoundarySource>('bcHealth')
  const [boundaryLevel, setBoundaryLevel] = useState<WaterBoundaryLevel>('chsa')
  const [showBoundaries, setShowBoundaries] = useState(true)
  const [boundaryMetric, setBoundaryMetric] = useState<WaterBoundaryMetric>('avgSamplesPerFacility')
  const [selectedBoundaryId, setSelectedBoundaryId] = useState<string | null>(null)
  const [layerMode, setLayerMode] = useState<WaterLayerMode>('facilities')
  const [selectedHazardRatings, setSelectedHazardRatings] = useState<string[] | null>(null)
  const [selectedFacilityTypes, setSelectedFacilityTypes] = useState<string[] | null>(null)
  const [sampleKindFilter, setSampleKindFilter] = useState<WaterSampleKindFilter>('all')
  const [sampleParameterFilter, setSampleParameterFilter] = useState('all')
  const [showPoints, setShowPoints] = useState(true)
  const [visiblePointCategories, setVisiblePointCategories] = useState<WaterPointCategory[]>(WATER_POINT_CATEGORIES)
  const [showHeatmap, setShowHeatmap] = useState(false)
  const [selectedFacilityId, setSelectedFacilityIdState] = useState<string | null>(null)
  const [showSelectedFacilityReport, setShowSelectedFacilityReport] = useState(false)
  const setSelectedFacilityId = useCallback((facilityId: string | null) => {
    setSelectedFacilityIdState(facilityId)
    if (!facilityId) setShowSelectedFacilityReport(false)
  }, [])
  const [timelineEnabled, setTimelineEnabled] = useState(false)
  const [timelineDate, setTimelineDate] = useState<Date | null>(null)
  const [timelineWindowSize, setTimelineWindowSize] = useState(12)

  const manifest = useWaterJson<WaterManifest>(active, 'water_download_manifest.json')
  const facilitiesJson = useWaterJson<unknown>(active, 'drinking_water_facilities.json')
  const bacteriologicalJson = useWaterJson<unknown>(active, 'bacteriological_samples.json')
  const chemicalJson = useWaterJson<unknown>(active, 'chemical_samples.json')
  const noticesJson = useWaterJson<unknown>(active, 'active_water_notices.json')
  const combinedNoticesJson = useWaterJson<unknown>(active, 'combined_water_notices.json')
  const combinedNoticesSummary = useWaterJson<CombinedWaterNoticesSummary>(active, 'combined_water_notices_summary.json')
  const referenceJson = useWaterJson<unknown>(active, 'water_reference.json')
  const geocodedLocations = useJsonManifest<GeocodedLocationsFile>(active ? '/data/geocoding/geocoded_locations.json' : null)
  const boundaryConfig = WATER_BOUNDARY_CONFIG[boundaryLevel]
  const boundaryJson = useJsonManifest<BoundaryFeatureCollection>(active && showBoundaries ? boundaryConfig.path : null)

  const samples = useMemo(() => {
    const bacteriologicalRows: WaterSampleRow[] = []
    findArray(bacteriologicalJson.data, ['facilities', 'records', 'rows']).forEach((facility, facilityIndex) => {
      const facilityId = firstString(facility, ['facilityId', 'facility_id', 'details_url', 'id'], `bacteriological-facility-${facilityIndex}`)
      const facilityName = firstString(facility, ['facilityName', 'facility_name', 'name'])
      const rows = Array.isArray(facility.samples) ? facility.samples.filter(isRecord) : []
      rows.forEach((row, rowIndex) => {
        bacteriologicalRows.push(normalizeSample({
          ...row,
          facilityId,
          facilityName,
        }, bacteriologicalRows.length + rowIndex, 'bacteriological'))
      })
    })

    const chemicalRows: WaterSampleRow[] = []
    findArray(chemicalJson.data, ['facilities', 'records', 'rows']).forEach((facility, facilityIndex) => {
      const facilityId = firstString(facility, ['facilityId', 'facility_id', 'details_url', 'id'], `chemical-facility-${facilityIndex}`)
      const facilityName = firstString(facility, ['facilityName', 'facility_name', 'name'])
      const packages = Array.isArray(facility.chemical_result_packages) ? facility.chemical_result_packages.filter(isRecord) : []
      packages.forEach((samplePackage, packageIndex) => {
        const packageDate = firstString(samplePackage, ['date'])
        const results = Array.isArray(samplePackage.results) ? samplePackage.results.filter(isRecord) : []
        results.forEach((result, resultIndex) => {
          chemicalRows.push(normalizeSample({
            ...result,
            facilityId,
            facilityName,
            date: packageDate,
            sampleId: `${facilityId}-${packageIndex}-${resultIndex}`,
          }, chemicalRows.length + resultIndex, 'chemical'))
        })
      })
    })

    if (!bacteriologicalRows.length && !chemicalRows.length) {
      return [
        ...collectRows(bacteriologicalJson.data, ['sample', 'result']).map((row, index) => normalizeSample(row, index, 'bacteriological')),
        ...collectRows(chemicalJson.data, ['result']).map((row, index) => normalizeSample(row, index, 'chemical')),
      ]
    }
    return [...bacteriologicalRows, ...chemicalRows]
  }, [bacteriologicalJson.data, chemicalJson.data])

  const notices = useMemo(() => (
    findArray(combinedNoticesJson.data, ['notices', 'activeNotices', 'records', 'rows'])
      .map(normalizeNotice)
  ), [combinedNoticesJson.data])

  const fallbackNotices = useMemo(() => (
    findArray(noticesJson.data, ['notices', 'activeNotices', 'records', 'rows'])
      .map(normalizeNotice)
  ), [noticesJson.data])

  const activeNotices = notices.length > 0 ? notices : fallbackNotices

  const facilities = useMemo(() => {
    const geocodedByIndex = new Map(
      (geocodedLocations.data?.locations ?? [])
        .filter((location) => location.dataset === 'water_drinking')
        .map((location) => [location.source_index, location]),
    )
    const baseFacilities = findArray(facilitiesJson.data, ['facilities', 'records', 'rows'])
      .map((record, index) => {
        const facility = normalizeFacility(record, index)
        const geocoded = geocodedByIndex.get(index)
        if (!facility || !geocoded) return facility
        return {
          ...facility,
          latitude: geocoded.latitude,
          longitude: geocoded.longitude,
          geocodedAddress: geocoded.google_geocoded_address,
          geocodePartialMatch: geocoded.google_partial_match,
        }
      })
      .filter((facility): facility is WaterFacility => Boolean(facility))
    const mutableFacilities = baseFacilities.map((facility) => ({
      ...facility,
      noticeIds: facility.noticeIds ? [...facility.noticeIds] : undefined,
    }))
    const byId = new Map<string, WaterFacility>()
    const byName = new Map<string, WaterFacility>()

    for (const facility of mutableFacilities) {
      byId.set(facility.id, facility)
      byName.set(facility.name.toLowerCase(), facility)
    }

    const facilityUpdates = new Map<string, {
      bacteriologicalSamples: number
      chemicalResults: number
      activeNotices: number
      lastSampleDate: Date | null
      noticeIds: string[]
    }>()
    const getFacilityUpdate = (facility: WaterFacility) => {
      const existing = facilityUpdates.get(facility.id)
      if (existing) return existing
      const update = {
        bacteriologicalSamples: facility.bacteriologicalSamples,
        chemicalResults: facility.chemicalResults,
        activeNotices: facility.activeNotices,
        lastSampleDate: facility.lastSampleDate,
        noticeIds: [...(facility.noticeIds ?? [])],
      }
      facilityUpdates.set(facility.id, update)
      return update
    }

    for (const sample of samples) {
      const facility = (sample.facilityId && byId.get(sample.facilityId)) || (sample.facilityName && byName.get(sample.facilityName.toLowerCase()))
      if (!facility) continue
      const update = getFacilityUpdate(facility)
      if (sample.kind === 'bacteriological') update.bacteriologicalSamples += 1
      else update.chemicalResults += 1
      if (sample.date && (!update.lastSampleDate || sample.date > update.lastSampleDate)) update.lastSampleDate = sample.date
    }

    const matchedNoticeIds = new Set<string>()

    for (const notice of activeNotices) {
      const facility = (notice.facilityId && byId.get(notice.facilityId)) || (notice.facilityName && byName.get(notice.facilityName.toLowerCase()))
      if (!facility) continue
      const update = getFacilityUpdate(facility)
      update.activeNotices += 1
      update.noticeIds.push(notice.id)
      matchedNoticeIds.add(notice.id)
    }

    for (const notice of activeNotices) {
      if (matchedNoticeIds.has(notice.id) || notice.latitude == null || notice.longitude == null) continue
      const id = `notice-point:${notice.id}`
      byId.set(id, {
        id,
        name: notice.facilityName || `Notice ${notice.id}`,
        operator: '',
        type: notice.primarySource || 'Notice',
        status: notice.status,
        hazardRating: 'Unknown',
        address: '',
        community: notice.locationSummary,
        latitude: notice.latitude,
        longitude: notice.longitude,
        bacteriologicalSamples: 0,
        chemicalResults: 0,
        activeNotices: 1,
        lastSampleDate: null,
        noticeOnly: true,
        noticeIds: [notice.id],
        primarySource: notice.primarySource,
        mergeBucket: notice.mergeBucket,
        sourceCount: notice.sourceCount,
        source: notice.source,
      })
    }

    return Array.from(byId.values())
      .map((facility) => {
        const update = facilityUpdates.get(facility.id)
        return update
          ? { ...facility, ...update }
          : facility
      })
      .sort((left, right) => right.activeNotices - left.activeNotices || right.bacteriologicalSamples + right.chemicalResults - left.bacteriologicalSamples - left.chemicalResults)
  }, [activeNotices, facilitiesJson.data, geocodedLocations.data, samples])

  const hazardCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const facility of facilities) {
      if (facility.noticeOnly) continue
      const rating = facility.hazardRating || 'Unknown'
      counts[rating] = (counts[rating] ?? 0) + 1
    }
    return counts
  }, [facilities])

  const hazardOptions = useMemo(() => (
    orderHazardRatings(Object.keys(hazardCounts))
  ), [hazardCounts])

  const facilityTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const facility of facilities) {
      if (facility.noticeOnly) continue
      const type = facility.type || 'Unknown'
      counts[type] = (counts[type] ?? 0) + 1
    }
    return counts
  }, [facilities])

  const facilityTypeOptions = useMemo(() => (
    Object.keys(facilityTypeCounts).sort((left, right) => facilityTypeCounts[right] - facilityTypeCounts[left] || left.localeCompare(right))
  ), [facilityTypeCounts])

  const sampleKindCounts = useMemo(() => {
    const counts: Record<WaterSampleRow['kind'], number> = {
      bacteriological: 0,
      chemical: 0,
    }
    for (const sample of samples) {
      counts[sample.kind] += 1
    }
    return counts
  }, [samples])

  const sampleParameterCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const sample of samples) {
      if (sampleKindFilter !== 'all' && sample.kind !== sampleKindFilter) continue
      const parameter = sample.parameter || (sample.kind === 'bacteriological' ? 'Bacteriological' : 'Unknown')
      counts[parameter] = (counts[parameter] ?? 0) + 1
    }
    return counts
  }, [sampleKindFilter, samples])

  const sampleParameterOptions = useMemo(() => (
    Object.entries(sampleParameterCounts)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([parameter, count]) => ({
        value: parameter,
        label: `${parameter} (${count.toLocaleString()})`,
      }))
  ), [sampleParameterCounts])

  // A parameter that drops out of the current options falls back to 'all'
  // without rewriting the user's stored choice.
  const effectiveSampleParameterFilter =
    sampleParameterFilter !== 'all' && sampleParameterOptions.some((option) => option.value === sampleParameterFilter)
      ? sampleParameterFilter
      : 'all'

  const sampleDateRange = useMemo(() => {
    let min: Date | null = null
    let max: Date | null = null
    for (const sample of samples) {
      if (!sample.date) continue
      if (!min || sample.date < min) min = sample.date
      if (!max || sample.date > max) max = sample.date
    }
    const now = new Date()
    return {
      start: min ?? new Date(now.getFullYear(), 0, 1),
      end: max ?? new Date(now.getFullYear(), now.getMonth(), 1),
    }
  }, [samples])

  // The scrub defaults to the most recent sample month until the user picks
  // one explicitly; deriving it avoids a state write when the timeline opens.
  const effectiveTimelineDate = useMemo(() => {
    if (timelineDate) return timelineDate
    return samples.length > 0
      ? new Date(sampleDateRange.end.getFullYear(), sampleDateRange.end.getMonth(), 1)
      : null
  }, [timelineDate, samples.length, sampleDateRange.end])

  const timelineFilterRange = useMemo(() => {
    if (!timelineEnabled || !effectiveTimelineDate) return null
    const timelineDate = effectiveTimelineDate
    const isCumulative = timelineWindowSize === -1
    const start = isCumulative
      ? new Date(sampleDateRange.start.getFullYear(), sampleDateRange.start.getMonth(), 1)
      : new Date(timelineDate.getFullYear(), timelineDate.getMonth(), 1)
    const end = new Date(
      timelineDate.getFullYear(),
      timelineDate.getMonth() + (isCumulative ? 1 : timelineWindowSize),
      0,
      23,
      59,
      59,
      999,
    )
    return { start: start.getTime(), end: end.getTime() }
  }, [sampleDateRange.start, effectiveTimelineDate, timelineEnabled, timelineWindowSize])

  const filteredSamples = useMemo(() => {
    return samples.filter((sample) => {
      if (sampleKindFilter !== 'all' && sample.kind !== sampleKindFilter) return false
      if (effectiveSampleParameterFilter !== 'all') {
        const parameter = sample.parameter || (sample.kind === 'bacteriological' ? 'Bacteriological' : 'Unknown')
        if (parameter !== effectiveSampleParameterFilter) return false
      }
      if (!timelineFilterRange) return true
      if (!sample.date) return false
      const time = sample.date.getTime()
      return time >= timelineFilterRange.start && time <= timelineFilterRange.end
    })
  }, [sampleKindFilter, effectiveSampleParameterFilter, samples, timelineFilterRange])

  const facilityLookup = useMemo(() => ({
    byId: new Map(facilities.map((facility) => [facility.id, facility])),
    byName: new Map(facilities.map((facility) => [facility.name.toLowerCase(), facility])),
  }), [facilities])

  const activeFacilityIds = useMemo(() => {
    const sampleFilterActive = timelineFilterRange != null || sampleKindFilter !== 'all' || effectiveSampleParameterFilter !== 'all'
    if (!sampleFilterActive) return null
    const ids = new Set<string>()
    for (const sample of filteredSamples) {
      const facility = (sample.facilityId && facilityLookup.byId.get(sample.facilityId)) || (sample.facilityName && facilityLookup.byName.get(sample.facilityName.toLowerCase()))
      if (facility) ids.add(facility.id)
    }
    return ids
  }, [facilityLookup, filteredSamples, sampleKindFilter, effectiveSampleParameterFilter, timelineFilterRange])

  const facilityFilteredSampleCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const sample of filteredSamples) {
      const facility = (sample.facilityId && facilityLookup.byId.get(sample.facilityId)) || (sample.facilityName && facilityLookup.byName.get(sample.facilityName.toLowerCase()))
      if (facility) counts.set(facility.id, (counts.get(facility.id) ?? 0) + 1)
    }
    return counts
  }, [facilityLookup, filteredSamples])

  const visibleFacilities = useMemo(() => {
    const modeFiltered = facilities.filter((facility) => {
      if (layerMode === 'notices') return facility.activeNotices > 0
      if (layerMode === 'samples') return !facility.noticeOnly && facility.bacteriologicalSamples + facility.chemicalResults > 0
      return !facility.noticeOnly
    })
    const facetFiltered = modeFiltered.filter((facility) => {
      if (facility.noticeOnly) return true
      const matchesHazard = !selectedHazardRatings || selectedHazardRatings.includes(facility.hazardRating || 'Unknown')
      const matchesType = !selectedFacilityTypes || selectedFacilityTypes.includes(facility.type || 'Unknown')
      return matchesHazard && matchesType
    })
    if (!activeFacilityIds) return facetFiltered
    return facetFiltered.filter((facility) => activeFacilityIds.has(facility.id))
  }, [activeFacilityIds, facilities, layerMode, selectedFacilityTypes, selectedHazardRatings])

  const mappedFacilities = useMemo(() => (
    visibleFacilities.filter((facility) => facility.latitude != null && facility.longitude != null)
  ), [visibleFacilities])

  const visibleNoticeCount = useMemo(() => (
    visibleFacilities.reduce((sum, facility) => sum + facility.activeNotices, 0)
  ), [visibleFacilities])

  const selectedFacility = useMemo(() => (
    selectedFacilityId ? facilities.find((facility) => facility.id === selectedFacilityId) ?? null : null
  ), [facilities, selectedFacilityId])

  const selectedFacilitySamples = useMemo(() => (
    selectedFacility
      ? samples
        .filter((sample) => sameFacility(sample, selectedFacility))
        .sort((left, right) => (right.date?.getTime() ?? 0) - (left.date?.getTime() ?? 0))
      : []
  ), [samples, selectedFacility])

  const selectedFacilityNotices = useMemo(() => (
    selectedFacility
      ? activeNotices
        .filter((notice) => sameFacility(notice, selectedFacility))
        .sort((left, right) => (right.date?.getTime() ?? 0) - (left.date?.getTime() ?? 0))
      : []
  ), [activeNotices, selectedFacility])

  const selectedFacilityInspections = useMemo(() => (
    selectedFacility ? getInspectionRows(selectedFacility) : []
  ), [selectedFacility])

  const bucketCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const sample of samples) {
      if (!sample.date) continue
      const key = `${sample.date.getFullYear()}-${String(sample.date.getMonth()).padStart(2, '0')}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [samples])

  const heatmapData = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(() => ({
    type: 'FeatureCollection',
    features: mappedFacilities.map((facility) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [facility.longitude as number, facility.latitude as number] },
      properties: {
        id: facility.id,
        weight: Math.max(1, facility.activeNotices * 8 + (facilityFilteredSampleCounts.get(facility.id) ?? getFacilitySampleTotal(facility))),
      },
    })),
  }), [facilityFilteredSampleCounts, mappedFacilities])

  const facilityPointData = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point, WaterFacilityFeatureProperties>>(() => ({
    type: 'FeatureCollection',
    features: mappedFacilities.flatMap((facility) => {
      const categories: WaterPointCategory[] = []
      if (!facility.noticeOnly) categories.push('facility')
      if (!facility.noticeOnly && getFacilitySampleTotal(facility) > 0) categories.push('samples')
      if (facility.activeNotices > 0) categories.push('notice')
      return categories.map((category) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [facility.longitude as number, facility.latitude as number] },
        properties: {
          id: facility.id,
          name: facility.name,
          category,
        },
      }))
    }),
  }), [mappedFacilities])

  const togglePointCategory = useCallback((category: WaterPointCategory) => {
    setVisiblePointCategories((current) => (
      current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category]
    ))
  }, [])

  const boundaryLevelOptions = boundarySource === 'bcHealth'
    ? WATER_HEALTH_LEVEL_OPTIONS
    : boundarySource === 'regionalDistrict'
      ? WATER_REGIONAL_DISTRICT_LEVEL_OPTIONS
    : boundarySource === 'census'
      ? WATER_CENSUS_LEVEL_OPTIONS
      : boundarySource === 'watershed'
        ? WATER_WATERSHED_LEVEL_OPTIONS
        : WATER_NR_ADMIN_LEVEL_OPTIONS

  const boundaries = useMemo(() => prepareBoundaries(boundaryJson.data, boundaryConfig), [boundaryConfig, boundaryJson.data])

  const boundaryData = useMemo<GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, WaterBoundaryAggregateProperties>>(() => ({
    type: 'FeatureCollection',
    features: boundaries.features.map((feature, index) => {
      const boundaryId = String(feature.properties?.boundaryId ?? feature.id ?? index)
      const boundaryName = String(feature.properties?.boundaryName ?? 'Boundary')
      const containedFacilities = mappedFacilities.filter((facility) => (
        booleanPointInPolygon(point([facility.longitude as number, facility.latitude as number]), feature)
      ))
      const properties: WaterBoundaryAggregateProperties = {
        ...feature.properties,
        boundaryId,
        boundaryName,
        facilityCount: containedFacilities.length,
        sampleRows: containedFacilities.reduce((sum, facility) => sum + (facilityFilteredSampleCounts.get(facility.id) ?? getFacilitySampleTotal(facility)), 0),
        avgSamplesPerFacility: 0,
        activeNotices: containedFacilities.reduce((sum, facility) => sum + facility.activeNotices, 0),
        metricValue: 0,
      }
      properties.avgSamplesPerFacility = properties.facilityCount > 0 ? properties.sampleRows / properties.facilityCount : 0
      properties.metricValue = getBoundaryMetricValue(properties, boundaryMetric)
      return {
        ...feature,
        id: boundaryId,
        properties,
      }
    }),
  }), [boundaries, boundaryMetric, facilityFilteredSampleCounts, mappedFacilities])

  const boundaryMaxValue = useMemo(() => (
    Math.max(1, ...boundaryData.features.map((feature) => feature.properties?.metricValue ?? 0))
  ), [boundaryData])

  const selectedBoundary = useMemo(() => (
    selectedBoundaryId
      ? boundaryData.features.find((feature) => feature.properties.boundaryId === selectedBoundaryId) ?? null
      : null
  ), [boundaryData, selectedBoundaryId])

  const handleBoundarySourceChange = useCallback((source: WaterBoundarySource) => {
    setBoundarySource(source)
    setBoundaryLevel(
      source === 'bcHealth'
        ? 'chsa'
        : source === 'regionalDistrict'
          ? 'regionalDistrict'
          : source === 'census'
            ? 'da'
            : source === 'watershed'
              ? 'watershedGroup'
              : 'nrDistrict',
    )
    setShowBoundaries(true)
    setSelectedBoundaryId(null)
  }, [])

  const handleTimelineDisable = useCallback(() => {
    setTimelineEnabled(false)
    setTimelineDate(null)
  }, [])

  const toggleHazardRating = useCallback((rating: string) => {
    const current = selectedHazardRatings ?? hazardOptions
    setSelectedHazardRatings(current.includes(rating)
      ? current.filter((value) => value !== rating)
      : [...current, rating])
  }, [hazardOptions, selectedHazardRatings])

  const toggleFacilityType = useCallback((type: string) => {
    const current = selectedFacilityTypes ?? facilityTypeOptions
    setSelectedFacilityTypes(current.includes(type)
      ? current.filter((value) => value !== type)
      : [...current, type])
  }, [facilityTypeOptions, selectedFacilityTypes])

  return {
    manifest,
    facilitiesJson,
    bacteriologicalJson,
    chemicalJson,
    noticesJson,
    combinedNoticesJson,
    combinedNoticesSummary,
    referenceJson,
    geocodedLocations,
    boundaryJson,
    boundarySource,
    boundaryLevel,
    boundaryLevelOptions,
    showBoundaries,
    setShowBoundaries,
    boundaryMetric,
    setBoundaryMetric,
    selectedBoundaryId,
    setSelectedBoundaryId,
    handleBoundarySourceChange,
    setBoundaryLevel,
    layerMode,
    setLayerMode,
    hazardOptions,
    hazardCounts,
    selectedHazardRatings,
    toggleHazardRating,
    facilityTypeOptions,
    facilityTypeCounts,
    selectedFacilityTypes,
    toggleFacilityType,
    sampleKindFilter,
    setSampleKindFilter,
    sampleKindCounts,
    sampleParameterFilter: effectiveSampleParameterFilter,
    setSampleParameterFilter,
    sampleParameterOptions,
    sampleParameterCounts,
    showPoints,
    setShowPoints,
    visiblePointCategories,
    togglePointCategory,
    showHeatmap,
    setShowHeatmap,
    facilities,
    visibleFacilities,
    visibleNoticeCount,
    mappedFacilities,
    samples,
    filteredSamples,
    notices: activeNotices,
    combinedNoticeCount: notices.length,
    selectedFacility,
    selectedFacilitySamples,
    selectedFacilityNotices,
    selectedFacilityInspections,
    selectedFacilityId,
    setSelectedFacilityId,
    showSelectedFacilityReport,
    setShowSelectedFacilityReport,
    sampleDateRange,
    bucketCounts,
    timelineEnabled,
    setTimelineEnabled,
    timelineDate: effectiveTimelineDate,
    setTimelineDate,
    timelineWindowSize,
    setTimelineWindowSize,
    handleTimelineDisable,
    heatmapData,
    facilityPointData,
    boundaries,
    boundaryData,
    boundaryMaxValue,
    selectedBoundary,
  }
}

export type WaterState = ReturnType<typeof useWaterData>
