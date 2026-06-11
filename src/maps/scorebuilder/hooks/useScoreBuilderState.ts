import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { BoundarySource, RegionLevel } from '@/maps/airquality'
import {
  CENSUS_BOUNDARY_LEVEL_OPTIONS,
  CITY_BOUNDARY_LEVEL_OPTIONS,
  HEALTH_BOUNDARY_LEVEL_OPTIONS,
  NR_ADMIN_BOUNDARY_LEVEL_OPTIONS,
  REGIONAL_DISTRICT_BOUNDARY_LEVEL_OPTIONS,
  WATERSHED_BOUNDARY_LEVEL_OPTIONS,
  SCORE_METRICS,
  SCORE_PRESETS,
  encodeWeightsToParams,
} from '../constants'
import { metricRecipeToDefinition } from '../lib/metricDefinitions'
import type { MetricRecipe } from '../lib/metricRecipes'
import { decodeScoreBuilderShareState, encodeScoreBuilderShareState } from '../lib/shareState'
import {
  encodeCustomMetricRecipes,
  encodeCustomMetricWeights,
  getQuickIndexLabPresetKey,
} from '../lib/urlState'
import type {
  ScoreDataSource,
  ScoreFilterKey,
  ScoreMetricDefinition,
  ScoreMetricKey,
  ScoreMethodSettings,
} from '../types'
import {
  canUseWalkabilitySourceSurface as deriveCanUseWalkabilitySourceSurface,
  createInitialScoreBuilderState,
  getSelectedRegionLevel,
  hasUrlWeightParams,
  scoreBuilderReducer,
  showsWalkabilitySourceSurface,
} from './scoreBuilderReducer'

/**
 * Owns every piece of sidebar/control state for the score builder (boundary focus, weights,
 * data sources, presets/examples, map surface, analysis modes, selection) behind one reducer,
 * plus the URL synchronisation that goes with it.
 */
export function useScoreBuilderState() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [state, dispatch] = useReducer(scoreBuilderReducer, searchParams, createInitialScoreBuilderState)

  // Mount-time URL facts; both intentionally keep their first-render values.
  const initialShareToken = useRef(searchParams.get('s'))
  const [initializedFromUrlWeights] = useState(() => hasUrlWeightParams(searchParams))
  const appliedQuickPreset = useRef<string | null>(null)

  // Keeps the latest search params readable from effects without re-triggering them.
  const searchParamsRef = useRef(searchParams)
  useEffect(() => {
    searchParamsRef.current = searchParams
  }, [searchParams])

  // The latest known air-monitor networks, fed in by the section once monitors load.
  const allNetworksRef = useRef<string[]>([])

  // Quick links from other modules land with a `quick` param that maps to a preset.
  useEffect(() => {
    const quickKey = getQuickIndexLabPresetKey(searchParams.get('quick'))
    if (!quickKey || appliedQuickPreset.current === quickKey) return
    if (!SCORE_PRESETS.some((preset) => preset.key === quickKey)) return
    appliedQuickPreset.current = quickKey
    dispatch({ type: 'applyQuickPreset', presetKey: quickKey })
    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete('quick')
    setSearchParams(nextParams, { replace: true })
  }, [searchParams, setSearchParams])

  const selectedRegionLevel = getSelectedRegionLevel(state)

  // URL persistence
  useEffect(() => {
    if (searchParamsRef.current.get('quick')) return
    const params = new URLSearchParams()
    params.set('src', state.boundarySource)
    params.set('level', selectedRegionLevel)
    params.set('w', encodeWeightsToParams(state.weights))
    if (state.customMetricRecipes.some((recipe) => (state.weights[recipe.id] ?? 0) !== 0)) {
      params.set('cw', encodeCustomMetricWeights(state.weights, state.customMetricRecipes))
    }
    params.set('ds', state.enabledDataSources.join(','))
    params.set('norm', state.methodSettings.normalization)
    params.set('agg', state.methodSettings.aggregation)
    params.set('missing', state.methodSettings.missingData)
    params.set('sens', state.methodSettings.sensitivity ? 'on' : 'off')
    params.set('scope', state.methodSettings.normalizationScope)
    params.set('vis', state.methodSettings.visualOutput)
    params.set('surface', state.mapSurface)
    if (state.customMetricRecipes.length) params.set('recipes', encodeCustomMetricRecipes(state.customMetricRecipes))
    if (state.methodSettings.healthyPlanPriority.demographicMetric) {
      params.set('hpDemo', state.methodSettings.healthyPlanPriority.demographicMetric)
    }
    if (state.methodSettings.healthyPlanPriority.environmentMetric) {
      params.set('hpEnv', state.methodSettings.healthyPlanPriority.environmentMetric)
    }
    params.set('accessMin', String(state.methodSettings.accessThreshold.minimumAccess))
    params.set('accessHits', String(state.methodSettings.accessThreshold.minimumHits))
    setSearchParams(params, { replace: true })
  }, [
    state.boundarySource,
    selectedRegionLevel,
    state.weights,
    state.enabledDataSources,
    state.mapSurface,
    state.methodSettings,
    state.customMetricRecipes,
    setSearchParams,
  ])

  // Shared-state tokens are decoded asynchronously, then applied on top of the initial state.
  useEffect(() => {
    const token = initialShareToken.current
    if (!token) return
    let cancelled = false
    decodeScoreBuilderShareState(token)
      .then((share) => {
        if (cancelled || share.version !== 1) return
        dispatch({ type: 'applyShareState', share })
      })
      .catch(() => {
        // Malformed share tokens should not block the regular score builder.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const customMetricDefinitions = useMemo(
    () => state.customMetricRecipes.map(metricRecipeToDefinition),
    [state.customMetricRecipes],
  )
  const activeMetricDefinitions = useMemo<ScoreMetricDefinition[]>(
    () => [...SCORE_METRICS, ...customMetricDefinitions],
    [customMetricDefinitions],
  )
  const totalAbsoluteWeight = useMemo(
    () => activeMetricDefinitions.reduce((sum, metric) => sum + Math.abs(state.weights[metric.key] ?? 0), 0),
    [activeMetricDefinitions, state.weights],
  )

  const enabledSourceSet = useMemo(() => new Set(state.enabledDataSources), [state.enabledDataSources])

  const boundaryLevelOptions = useMemo<Array<{ value: RegionLevel; label: string }>>(() => {
    const options =
      state.boundarySource === 'bcHealth'
        ? HEALTH_BOUNDARY_LEVEL_OPTIONS
        : state.boundarySource === 'regionalDistrict'
          ? REGIONAL_DISTRICT_BOUNDARY_LEVEL_OPTIONS
          : state.boundarySource === 'cityPG'
            ? CITY_BOUNDARY_LEVEL_OPTIONS
            : state.boundarySource === 'watershed'
              ? WATERSHED_BOUNDARY_LEVEL_OPTIONS
              : state.boundarySource === 'nrAdmin'
                ? NR_ADMIN_BOUNDARY_LEVEL_OPTIONS
                : CENSUS_BOUNDARY_LEVEL_OPTIONS
    return options.map((option) => ({ value: option.value, label: option.label }))
  }, [state.boundarySource])

  const onNetworksLoaded = useCallback((allNetworks: string[]) => {
    allNetworksRef.current = allNetworks
    dispatch({ type: 'networksLoaded', allNetworks })
  }, [])

  const setBoundarySource = useCallback((source: BoundarySource) => {
    dispatch({ type: 'setBoundarySource', source })
  }, [])
  const handleRegionLevelChange = useCallback((level: RegionLevel) => {
    dispatch({ type: 'setRegionLevel', level })
  }, [])
  const handleWeightChange = useCallback((metric: ScoreMetricKey, value: number) => {
    dispatch({ type: 'setWeight', metric, value })
  }, [])
  const handleAddMetric = useCallback((metric: ScoreMetricKey, value: number) => {
    dispatch({ type: 'addMetric', metric, value, allNetworks: allNetworksRef.current })
  }, [])
  const handleBuildDensityScore = useCallback((metric: ScoreMetricKey) => {
    dispatch({ type: 'buildDensityScore', metric, allNetworks: allNetworksRef.current })
  }, [])
  const applyExample = useCallback((exampleKey: string) => {
    dispatch({ type: 'applyExample', exampleKey, allNetworks: allNetworksRef.current })
  }, [])
  const handleApplyPreset = useCallback((presetKey: string) => {
    dispatch({ type: 'applyPreset', presetKey, allNetworks: allNetworksRef.current })
  }, [])
  const handleCreateCustomMetric = useCallback((recipe: MetricRecipe) => {
    dispatch({ type: 'createCustomMetric', recipe })
  }, [])
  const handleRemoveCustomMetric = useCallback((id: string) => {
    dispatch({ type: 'removeCustomMetric', id })
  }, [])
  const toggleDataSource = useCallback((source: ScoreDataSource) => {
    dispatch({ type: 'toggleDataSource', source })
  }, [])
  const toggleNetwork = useCallback((network: string) => {
    dispatch({ type: 'toggleNetwork', network })
  }, [])
  const selectAllNetworks = useCallback(() => {
    dispatch({ type: 'setSelectedNetworks', networks: allNetworksRef.current })
  }, [])
  const clearNetworks = useCallback(() => {
    dispatch({ type: 'setSelectedNetworks', networks: [] })
  }, [])
  const togglePoints = useCallback(() => {
    dispatch({ type: 'togglePoints' })
  }, [])
  const handleMapSurfaceChange = useCallback((surface: 'source' | 'boundary') => {
    dispatch({ type: 'setMapSurface', surface })
  }, [])
  const handleMapRegionClick = useCallback((regionId: string) => {
    dispatch({ type: 'mapRegionClick', regionId })
  }, [])
  const selectRegion = useCallback((regionId: string | null) => {
    dispatch({ type: 'selectRegion', regionId })
  }, [])
  const clearRegionSelection = useCallback(() => {
    dispatch({ type: 'selectRegion', regionId: null })
  }, [])
  const handleOpenRegionInsight = useCallback((regionId: string) => {
    dispatch({ type: 'openRegionInsight', regionId })
  }, [])
  const handleRegionInsightOpenChange = useCallback((open: boolean) => {
    dispatch({ type: 'setRegionInsightOpen', open })
  }, [])
  const closeRegionInsight = useCallback(() => {
    dispatch({ type: 'closeRegionInsight' })
  }, [])
  const toggleComparison = useCallback((regionId: string) => {
    dispatch({ type: 'toggleComparison', regionId })
  }, [])
  const clearComparison = useCallback(() => {
    dispatch({ type: 'clearComparison' })
  }, [])
  const setSearchQuery = useCallback((query: string) => {
    dispatch({ type: 'setSearchQuery', query })
  }, [])
  const setDensityMetric = useCallback((metric: ScoreMetricKey) => {
    dispatch({ type: 'setDensityMetric', metric })
  }, [])
  const handleToggleDensityMode = useCallback(() => {
    dispatch({ type: 'toggleDensityMode' })
  }, [])
  const handleToggleCorrelateMode = useCallback(() => {
    dispatch({ type: 'toggleCorrelateMode' })
  }, [])
  const setCorrelateMetricX = useCallback((metric: ScoreMetricKey) => {
    dispatch({ type: 'setCorrelateMetricX', metric })
  }, [])
  const setCorrelateMetricY = useCallback((metric: ScoreMetricKey) => {
    dispatch({ type: 'setCorrelateMetricY', metric })
  }, [])
  const setCorrelateVisStyle = useCallback((style: 'bivariate' | 'residual') => {
    dispatch({ type: 'setCorrelateVisStyle', style })
  }, [])
  const applyCorrelatePair = useCallback((metricX: ScoreMetricKey, metricY: ScoreMetricKey) => {
    dispatch({ type: 'applyCorrelatePair', metricX, metricY })
  }, [])
  const toggleScoreFilter = useCallback((filter: ScoreFilterKey) => {
    dispatch({ type: 'toggleScoreFilter', filter })
  }, [])
  const setMethodSettings = useCallback((settings: ScoreMethodSettings) => {
    dispatch({ type: 'setMethodSettings', settings })
  }, [])

  const handleShareUrl = useCallback(async () => {
    const token = await encodeScoreBuilderShareState({
      version: 1,
      boundarySource: state.boundarySource,
      healthBoundaryLevel: state.healthBoundaryLevel,
      censusBoundaryLevel: state.censusBoundaryLevel,
      regionalDistrictBoundaryLevel: state.regionalDistrictBoundaryLevel,
      cityBoundaryLevel: state.cityBoundaryLevel,
      watershedBoundaryLevel: state.watershedBoundaryLevel,
      enabledDataSources: state.enabledDataSources,
      selectedNetworks: state.selectedNetworks,
      weights: state.weights,
      methodSettings: state.methodSettings,
      mapSurface: state.mapSurface,
      customMetricRecipes: state.customMetricRecipes,
    })
    const url = new URL(window.location.href)
    url.search = ''
    url.searchParams.set('s', token)
    window.history.replaceState(null, '', url)
    try {
      await navigator.clipboard?.writeText(url.toString())
    } catch {
      // The URL is still visible in the address bar if clipboard permissions are unavailable.
    }
    return url.toString()
  }, [state])

  return {
    state,
    selectedRegionLevel,
    enabledSourceSet,
    boundaryLevelOptions,
    customMetricDefinitions,
    activeMetricDefinitions,
    totalAbsoluteWeight,
    canUseWalkabilitySourceSurface: deriveCanUseWalkabilitySourceSurface(state),
    showWalkabilitySourceSurface: showsWalkabilitySourceSurface(state),
    initializedFromUrlWeights,
    onNetworksLoaded,
    setBoundarySource,
    handleRegionLevelChange,
    handleWeightChange,
    handleAddMetric,
    handleBuildDensityScore,
    applyExample,
    handleApplyPreset,
    handleCreateCustomMetric,
    handleRemoveCustomMetric,
    toggleDataSource,
    toggleNetwork,
    selectAllNetworks,
    clearNetworks,
    togglePoints,
    handleMapSurfaceChange,
    handleMapRegionClick,
    selectRegion,
    clearRegionSelection,
    handleOpenRegionInsight,
    handleRegionInsightOpenChange,
    closeRegionInsight,
    toggleComparison,
    clearComparison,
    setSearchQuery,
    setDensityMetric,
    handleToggleDensityMode,
    handleToggleCorrelateMode,
    setCorrelateMetricX,
    setCorrelateMetricY,
    setCorrelateVisStyle,
    applyCorrelatePair,
    toggleScoreFilter,
    setMethodSettings,
    handleShareUrl,
  }
}

export type ScoreBuilderStateApi = ReturnType<typeof useScoreBuilderState>
