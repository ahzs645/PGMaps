import { useCallback, useMemo } from 'react'
import { useToggleArray } from '@/hooks/useToggleArray'
import {
  booleanCodec,
  nullableStringArrayCodec,
  stringArrayCodec,
  stringCodec,
  stringUnionCodec,
  useUrlState,
} from '@/hooks/useUrlState'
import type { UrlCodec } from '@/hooks/useUrlState'
import {
  getDefaultLevelForSource,
  getLevelOptionsForSource,
  isValidLevelForSource,
  STUDY_AREA_LEVEL_LABELS,
  useStudyAreaRegions,
} from '@/lib/studyArea'
import type { StudyAreaRegion } from '@/lib/studyArea'
import type {
  AirMonitor,
  AirQualityBasemap,
  AirQualityBoundaryColorMetric,
  AirQualityCorrectionModel,
  AirQualityObservationLayer,
  BoundarySource,
  RegionLevel,
  SelectedBoundaryRegion,
} from '../types'

export const REGION_LEVEL_LABELS: Record<RegionLevel, string> = STUDY_AREA_LEVEL_LABELS

/** Study-area boundary picker selection; null means boundaries are hidden. */
export interface StudyAreaSelection {
  source: BoundarySource
  level: RegionLevel
  regionCode: string | null
}

export interface AirQualityViewState {
  searchQuery: string
  selectedNetworks: string[]
  observationLayers: AirQualityObservationLayer[]
  showHeatmap: boolean
  showPoints: boolean
  basemap: AirQualityBasemap
  correctionModel: AirQualityCorrectionModel
  boundaryColorMetric: AirQualityBoundaryColorMetric
  boundariesVisible: boolean
  boundarySource: BoundarySource
  selectedRegionLevel: RegionLevel
  selectedRegionCode: string | null
  selectedMonitor: AirMonitor | null
}

export interface AirQualityActions {
  setSearchQuery: (query: string) => void
  toggleNetwork: (network: string) => void
  setNetworks: (networks: string[]) => void
  toggleObservationLayer: (layer: AirQualityObservationLayer) => void
  toggleHeatmap: () => void
  togglePoints: () => void
  setBasemap: (basemap: AirQualityBasemap) => void
  setCorrectionModel: (model: AirQualityCorrectionModel) => void
  setBoundaryColorMetric: (metric: AirQualityBoundaryColorMetric) => void
  setBoundarySource: (source: BoundarySource) => void
  setRegionLevel: (level: RegionLevel) => void
  clearBoundaries: () => void
  selectRegion: (code: string) => void
  selectMonitor: (monitor: AirMonitor) => void
  clearMonitor: () => void
}

export interface AirQualityStudyAreaState {
  /** Regions for the active source/level; empty while boundaries are hidden. */
  regions: StudyAreaRegion[]
  loading: boolean
  error: string | null
  levelOptions: Array<{ value: RegionLevel; label: string }>
  selectedRegion: SelectedBoundaryRegion | null
  selectedRegionFeature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null
}

export interface UseAirQualityStateResult {
  state: AirQualityViewState
  actions: AirQualityActions
  studyArea: AirQualityStudyAreaState
}

const BASEMAPS = ['light', 'topographic', 'dark'] as const
const CORRECTION_MODELS = [
  'rawPurpleAir',
  'epaBarkjohn',
  'nilsonLocal',
  'wildfireSmoke',
  'siteSpecific',
] as const
const BOUNDARY_COLOR_METRICS = [
  'sensorCount',
  'overallDensity',
  'lowCostDensity',
  'otherDensity',
  'correctedPm25',
  'rawPm25',
  'networkCount',
] as const
const OBSERVATION_LAYERS = ['rawPA', 'correctedPA', 'rawEGG', 'correctedEGG', 'agencyFEM'] as const
const BOUNDARY_SOURCES = [
  'bcHealth',
  'regionalDistrict',
  'bcMunicipality',
  'census',
  'cityCommunity',
  'cityPG',
  'watershed',
  'bcDrainage',
  'bcWildfire',
  'bcRfc',
  'nrAdmin',
  'uwr',
  'crownTenure',
  'rangeTenure',
  'mineralTenure',
] as const satisfies readonly BoundarySource[]

const DEFAULT_BOUNDARY_SOURCE: BoundarySource = 'bcHealth'
const DEFAULT_REGION_LEVEL: RegionLevel = 'lha'

/** Level used when a shared URL names a source but no (valid) level. */
function getUrlFallbackLevel(source: BoundarySource): RegionLevel {
  if (source === 'bcHealth') return 'lha'
  if (source === 'census') return 'da'
  return getDefaultLevelForSource(source)
}

const searchCodec = stringCodec('')
const heatmapCodec = booleanCodec(false)
const pointsCodec = booleanCodec(true)
const basemapCodec = stringUnionCodec<AirQualityBasemap>(BASEMAPS, 'light')
const correctionModelCodec = stringUnionCodec<AirQualityCorrectionModel>(CORRECTION_MODELS, 'epaBarkjohn')
const boundaryColorMetricCodec = stringUnionCodec<AirQualityBoundaryColorMetric>(
  BOUNDARY_COLOR_METRICS,
  'sensorCount',
)
const observationLayersCodec = stringArrayCodec<AirQualityObservationLayer>(
  OBSERVATION_LAYERS,
  OBSERVATION_LAYERS,
)

const monitorIdCodec: UrlCodec<string | null> = {
  encode: (value) => value,
  decode: (raw) => raw,
}

/** Absent means "all networks" (the data-driven default), which is distinct from an explicit empty selection. */
const networksCodec = nullableStringArrayCodec()

/**
 * Boundary picker state packed into one param (`source:level[:regionCode]`)
 * because source, level, and region change together and react-router's
 * setSearchParams cannot safely write multiple params in a single event.
 * The region code segment is percent-encoded so it can never contain ':'.
 */
const studyAreaCodec: UrlCodec<StudyAreaSelection | null> = {
  encode: (value) => {
    if (!value) return null
    const parts: string[] = [value.source, value.level]
    if (value.regionCode) parts.push(encodeURIComponent(value.regionCode))
    return parts.join(':')
  },
  decode: (raw) => {
    if (!raw) return null
    const [rawSource, rawLevel, ...rawCodeParts] = raw.split(':')
    const source = BOUNDARY_SOURCES.find((candidate) => candidate === rawSource)
    if (!source) return null
    const level = rawLevel && isValidLevelForSource(source, rawLevel as RegionLevel)
      ? (rawLevel as RegionLevel)
      : getUrlFallbackLevel(source)
    let regionCode: string | null = rawCodeParts.length > 0 ? rawCodeParts.join(':') : null
    if (regionCode) {
      try {
        regionCode = decodeURIComponent(regionCode)
      } catch {
        // Keep the raw segment when it is not valid percent-encoding.
      }
    }
    return { source, level, regionCode }
  },
}

/**
 * Owns all shareable air-quality view state (filters, layer toggles, boundary
 * picker, selected monitor), persisting it to URL search params so views can
 * be shared and restored. Default state produces a clean URL.
 */
export function useAirQualityState(monitors: AirMonitor[]): UseAirQualityStateResult {
  const [searchQuery, setSearchQuery] = useUrlState('q', searchCodec)
  const [showHeatmap, setShowHeatmap] = useUrlState('heatmap', heatmapCodec)
  const [showPoints, setShowPoints] = useUrlState('points', pointsCodec)
  const [basemap, setBasemap] = useUrlState('basemap', basemapCodec)
  const [correctionModel, setCorrectionModel] = useUrlState('model', correctionModelCodec)
  const [boundaryColorMetric, setBoundaryColorMetric] = useUrlState('poly', boundaryColorMetricCodec)
  const [observationLayers, setObservationLayers] = useUrlState('obs', observationLayersCodec)
  const [networksParam, setNetworksParam] = useUrlState('net', networksCodec)
  const [selectedMonitorId, setSelectedMonitorId] = useUrlState('monitor', monitorIdCodec)
  const [studyAreaSelection, setStudyAreaSelection] = useUrlState('area', studyAreaCodec)

  const boundariesVisible = studyAreaSelection !== null
  const boundarySource = studyAreaSelection?.source ?? DEFAULT_BOUNDARY_SOURCE
  const selectedRegionLevel = studyAreaSelection?.level ?? DEFAULT_REGION_LEVEL
  const selectedRegionCode = studyAreaSelection?.regionCode ?? null

  const allNetworks = useMemo(() => {
    return Array.from(new Set(monitors.map((monitor) => monitor.network))).sort((a, b) => a.localeCompare(b))
  }, [monitors])

  const selectedNetworks = useMemo(() => networksParam ?? allNetworks, [allNetworks, networksParam])

  const setNetworks = useCallback((networks: string[]) => {
    const next = Array.from(new Set(networks))
    const isEveryNetwork = next.length === allNetworks.length && allNetworks.every((network) => next.includes(network))
    setNetworksParam(isEveryNetwork ? null : next)
  }, [allNetworks, setNetworksParam])

  const toggleNetwork = useToggleArray(selectedNetworks, setNetworks)
  const toggleObservationLayer = useToggleArray(observationLayers, setObservationLayers)

  const toggleHeatmap = useCallback(() => setShowHeatmap(!showHeatmap), [setShowHeatmap, showHeatmap])
  const togglePoints = useCallback(() => setShowPoints(!showPoints), [setShowPoints, showPoints])

  const selectedMonitor = useMemo(() => {
    if (!selectedMonitorId) return null
    return monitors.find((monitor) => monitor.id === selectedMonitorId) ?? null
  }, [monitors, selectedMonitorId])

  const clearMonitor = useCallback(() => setSelectedMonitorId(null), [setSelectedMonitorId])

  const selectMonitor = useCallback((monitor: AirMonitor) => {
    setSelectedMonitorId(monitor.id === selectedMonitorId ? null : monitor.id)
  }, [selectedMonitorId, setSelectedMonitorId])

  const setBoundarySource = useCallback((source: BoundarySource) => {
    const level = isValidLevelForSource(source, selectedRegionLevel)
      ? selectedRegionLevel
      : getDefaultLevelForSource(source)
    setStudyAreaSelection({ source, level, regionCode: null })
  }, [selectedRegionLevel, setStudyAreaSelection])

  const setRegionLevel = useCallback((level: RegionLevel) => {
    setStudyAreaSelection({ source: boundarySource, level, regionCode: null })
  }, [boundarySource, setStudyAreaSelection])

  const clearBoundaries = useCallback(() => setStudyAreaSelection(null), [setStudyAreaSelection])

  const selectRegion = useCallback((code: string) => {
    if (!studyAreaSelection) return
    setStudyAreaSelection({ ...studyAreaSelection, regionCode: code })
  }, [setStudyAreaSelection, studyAreaSelection])

  const {
    regions: studyAreaRegions,
    loading: regionsLoading,
    error: regionsError,
  } = useStudyAreaRegions(boundarySource, selectedRegionLevel)

  const activeRegions = useMemo(
    () => (boundariesVisible ? studyAreaRegions : []),
    [boundariesVisible, studyAreaRegions],
  )

  const selectedStudyAreaRegion = useMemo(() => {
    if (!selectedRegionCode) return null
    return activeRegions.find((region) => region.code === selectedRegionCode) ?? null
  }, [activeRegions, selectedRegionCode])

  const selectedRegion = useMemo<SelectedBoundaryRegion | null>(() => {
    if (!selectedStudyAreaRegion) return null
    return {
      source: selectedStudyAreaRegion.source,
      level: selectedStudyAreaRegion.level,
      code: selectedStudyAreaRegion.code,
      name: selectedStudyAreaRegion.name,
      levelLabel: REGION_LEVEL_LABELS[selectedStudyAreaRegion.level] ?? selectedStudyAreaRegion.level,
    }
  }, [selectedStudyAreaRegion])

  const levelOptions = useMemo(() => {
    return getLevelOptionsForSource(boundarySource).map((option) => ({
      value: option.value as RegionLevel,
      label: option.label,
    }))
  }, [boundarySource])

  const state = useMemo<AirQualityViewState>(() => ({
    searchQuery,
    selectedNetworks,
    observationLayers,
    showHeatmap,
    showPoints,
    basemap,
    correctionModel,
    boundaryColorMetric,
    boundariesVisible,
    boundarySource,
    selectedRegionLevel,
    selectedRegionCode,
    selectedMonitor,
  }), [
    basemap,
    boundariesVisible,
    boundaryColorMetric,
    boundarySource,
    correctionModel,
    observationLayers,
    searchQuery,
    selectedMonitor,
    selectedNetworks,
    selectedRegionCode,
    selectedRegionLevel,
    showHeatmap,
    showPoints,
  ])

  const actions = useMemo<AirQualityActions>(() => ({
    setSearchQuery,
    toggleNetwork,
    setNetworks,
    toggleObservationLayer,
    toggleHeatmap,
    togglePoints,
    setBasemap,
    setCorrectionModel,
    setBoundaryColorMetric,
    setBoundarySource,
    setRegionLevel,
    clearBoundaries,
    selectRegion,
    selectMonitor,
    clearMonitor,
  }), [
    clearBoundaries,
    clearMonitor,
    selectMonitor,
    selectRegion,
    setBasemap,
    setBoundaryColorMetric,
    setBoundarySource,
    setCorrectionModel,
    setNetworks,
    setRegionLevel,
    setSearchQuery,
    toggleHeatmap,
    toggleNetwork,
    toggleObservationLayer,
    togglePoints,
  ])

  const studyArea = useMemo<AirQualityStudyAreaState>(() => ({
    regions: activeRegions,
    loading: boundariesVisible && regionsLoading,
    error: boundariesVisible ? regionsError : null,
    levelOptions,
    selectedRegion,
    selectedRegionFeature: selectedStudyAreaRegion?.feature ?? null,
  }), [
    activeRegions,
    boundariesVisible,
    levelOptions,
    regionsError,
    regionsLoading,
    selectedRegion,
    selectedStudyAreaRegion,
  ])

  return { state, actions, studyArea }
}
