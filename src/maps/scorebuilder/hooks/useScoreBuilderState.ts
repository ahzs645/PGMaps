import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { BoundarySource, RegionLevel } from '@/maps/airquality'
import { getLevelOptionsForSource } from '@/lib/studyArea'
import {
  SCORE_METRICS,
  SCORE_PRESETS,
  encodeWeightsToParams,
} from '../constants'
import { metricRecipeToDefinition } from '../lib/metricDefinitions'
import type { MetricRecipe } from '../lib/metricRecipes'
import {
  createSavedIndexId,
  loadSavedIndexes,
  persistSavedIndexes,
  type SavedIndexEntry,
} from '../lib/savedIndexes'
import {
  decodeScoreBuilderShareState,
  encodeScoreBuilderShareState,
  type ScoreBuilderShareState,
} from '../lib/shareState'
import {
  encodeCustomMetricRecipes,
  encodeCustomMetricWeights,
  getQuickIndexLabPresetKey,
} from '../lib/urlState'
import {
  encodeWalkabilitySurfaceTuning,
  type WalkabilitySurfaceTuning,
} from '../lib/walkabilitySurface'
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
  type ScoreBuilderAction,
  type ScoreBuilderControlState,
} from './scoreBuilderReducer'

const UNDO_HISTORY_LIMIT = 50
/** Slider drags emit a burst of setWeight actions; treat same-metric edits inside this window as one step. */
const WEIGHT_COALESCE_MS = 1200

/** Actions that change the index composition and therefore deserve an undo step. */
const HISTORY_ACTION_TYPES = new Set<ScoreBuilderAction['type']>([
  'setBoundarySource',
  'setRegionLevel',
  'setWeight',
  'addMetric',
  'buildDensityScore',
  'applyExample',
  'applyPreset',
  'applyShareState',
  'createCustomMetric',
  'removeCustomMetric',
  'toggleDataSource',
  'toggleNetwork',
  'setSelectedNetworks',
  'toggleScoreFilter',
  'setMethodSettings',
])

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

  // Undo/redo history. Snapshots are taken just before composition-changing actions;
  // `stateRef` mirrors the committed state so snapshots never capture mid-dispatch values.
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])
  const undoStack = useRef<ScoreBuilderControlState[]>([])
  const redoStack = useRef<ScoreBuilderControlState[]>([])
  const lastWeightEdit = useRef<{ metric: ScoreMetricKey; time: number } | null>(null)
  const [historyStatus, setHistoryStatus] = useState({ canUndo: false, canRedo: false })

  const syncHistoryStatus = useCallback(() => {
    setHistoryStatus((current) => {
      const canUndo = undoStack.current.length > 0
      const canRedo = redoStack.current.length > 0
      return current.canUndo === canUndo && current.canRedo === canRedo ? current : { canUndo, canRedo }
    })
  }, [])

  const dispatchTracked = useCallback(
    (action: ScoreBuilderAction) => {
      if (HISTORY_ACTION_TYPES.has(action.type)) {
        const now = Date.now()
        const coalesce =
          action.type === 'setWeight' &&
          lastWeightEdit.current?.metric === action.metric &&
          now - lastWeightEdit.current.time < WEIGHT_COALESCE_MS
        lastWeightEdit.current = action.type === 'setWeight' ? { metric: action.metric, time: now } : null
        if (!coalesce) {
          undoStack.current.push(stateRef.current)
          if (undoStack.current.length > UNDO_HISTORY_LIMIT) undoStack.current.shift()
          redoStack.current = []
          syncHistoryStatus()
        }
      }
      dispatch(action)
    },
    [syncHistoryStatus],
  )

  const undo = useCallback(() => {
    const previous = undoStack.current.pop()
    if (!previous) return
    redoStack.current.push(stateRef.current)
    lastWeightEdit.current = null
    dispatch({ type: 'restoreState', state: previous })
    syncHistoryStatus()
  }, [syncHistoryStatus])

  const redo = useCallback(() => {
    const next = redoStack.current.pop()
    if (!next) return
    undoStack.current.push(stateRef.current)
    lastWeightEdit.current = null
    dispatch({ type: 'restoreState', state: next })
    syncHistoryStatus()
  }, [syncHistoryStatus])

  const { canUndo, canRedo } = historyStatus

  // Cmd/Ctrl+Z to undo, Shift+Cmd/Ctrl+Z (or Ctrl+Y) to redo, except while typing.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      const key = event.key.toLowerCase()
      if (key !== 'z' && key !== 'y') return
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      event.preventDefault()
      if (key === 'y' || event.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [redo, undo])

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
    // The build/explore view param is owned by the section; carry it through rewrites.
    const view = searchParamsRef.current.get('view')
    if (view === 'build' || view === 'explore') params.set('view', view)
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
    params.set('cscale', state.methodSettings.mapColorScale)
    if (state.enabledDataSources.includes('airQuality')) {
      if (state.pendingNetworkSelectAll) params.set('networks', 'all')
      else if (state.selectedNetworks.length) params.set('networks', state.selectedNetworks.join(','))
    }
    if (state.methodSettings.paletteOverride) params.set('pal', state.methodSettings.paletteOverride)
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
    const walkabilitySurfaceToken = encodeWalkabilitySurfaceTuning(state.walkabilitySurfaceTuning)
    if (walkabilitySurfaceToken) params.set('wsurf', walkabilitySurfaceToken)
    setSearchParams(params, { replace: true })
  }, [
    state.boundarySource,
    selectedRegionLevel,
    state.weights,
    state.enabledDataSources,
    state.pendingNetworkSelectAll,
    state.selectedNetworks,
    state.mapSurface,
    state.methodSettings,
    state.customMetricRecipes,
    state.walkabilitySurfaceTuning,
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
    const options = getLevelOptionsForSource(state.boundarySource)
    return options.map((option) => ({ value: option.value, label: option.label }))
  }, [state.boundarySource])

  const onNetworksLoaded = useCallback((allNetworks: string[]) => {
    allNetworksRef.current = allNetworks
    dispatch({ type: 'networksLoaded', allNetworks })
  }, [])

  const setBoundarySource = useCallback(
    (source: BoundarySource) => {
      dispatchTracked({ type: 'setBoundarySource', source })
    },
    [dispatchTracked],
  )
  const handleRegionLevelChange = useCallback((level: RegionLevel) => {
    dispatchTracked({ type: 'setRegionLevel', level })
  }, [dispatchTracked])
  const handleWeightChange = useCallback((metric: ScoreMetricKey, value: number) => {
    dispatchTracked({ type: 'setWeight', metric, value })
  }, [dispatchTracked])
  const handleAddMetric = useCallback((metric: ScoreMetricKey, value: number) => {
    dispatchTracked({ type: 'addMetric', metric, value, allNetworks: allNetworksRef.current })
  }, [dispatchTracked])
  const handleBuildDensityScore = useCallback((metric: ScoreMetricKey) => {
    dispatchTracked({ type: 'buildDensityScore', metric, allNetworks: allNetworksRef.current })
  }, [dispatchTracked])
  const applyExample = useCallback((exampleKey: string) => {
    dispatchTracked({ type: 'applyExample', exampleKey, allNetworks: allNetworksRef.current })
  }, [dispatchTracked])
  const handleApplyPreset = useCallback((presetKey: string) => {
    dispatchTracked({ type: 'applyPreset', presetKey, allNetworks: allNetworksRef.current })
  }, [dispatchTracked])
  const handleCreateCustomMetric = useCallback((recipe: MetricRecipe) => {
    dispatchTracked({ type: 'createCustomMetric', recipe })
  }, [dispatchTracked])
  const handleRemoveCustomMetric = useCallback((id: string) => {
    dispatchTracked({ type: 'removeCustomMetric', id })
  }, [dispatchTracked])
  const toggleDataSource = useCallback((source: ScoreDataSource) => {
    dispatchTracked({ type: 'toggleDataSource', source })
  }, [dispatchTracked])
  const toggleNetwork = useCallback((network: string) => {
    dispatchTracked({ type: 'toggleNetwork', network })
  }, [dispatchTracked])
  const selectAllNetworks = useCallback(() => {
    dispatchTracked({ type: 'setSelectedNetworks', networks: allNetworksRef.current })
  }, [dispatchTracked])
  const clearNetworks = useCallback(() => {
    dispatchTracked({ type: 'setSelectedNetworks', networks: [] })
  }, [dispatchTracked])
  const togglePoints = useCallback(() => {
    dispatch({ type: 'togglePoints' })
  }, [])
  const handleMapSurfaceChange = useCallback((surface: 'source' | 'boundary') => {
    dispatch({ type: 'setMapSurface', surface })
  }, [])
  const setWalkabilitySurfaceTuning = useCallback((tuning: WalkabilitySurfaceTuning) => {
    dispatch({ type: 'setWalkabilitySurfaceTuning', tuning })
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
    dispatch({ type: 'setDensityMetric', metric, allNetworks: allNetworksRef.current })
  }, [])
  const handleToggleDensityMode = useCallback(() => {
    dispatch({ type: 'toggleDensityMode' })
  }, [])
  const handleToggleCorrelateMode = useCallback(() => {
    dispatch({ type: 'toggleCorrelateMode' })
  }, [])
  const setCorrelateMetricX = useCallback((metric: ScoreMetricKey) => {
    dispatch({ type: 'setCorrelateMetricX', metric, allNetworks: allNetworksRef.current })
  }, [])
  const setCorrelateMetricY = useCallback((metric: ScoreMetricKey) => {
    dispatch({ type: 'setCorrelateMetricY', metric, allNetworks: allNetworksRef.current })
  }, [])
  const setCorrelateVisStyle = useCallback((style: 'bivariate' | 'residual') => {
    dispatch({ type: 'setCorrelateVisStyle', style })
  }, [])
  const applyCorrelatePair = useCallback((metricX: ScoreMetricKey, metricY: ScoreMetricKey) => {
    dispatch({ type: 'applyCorrelatePair', metricX, metricY, allNetworks: allNetworksRef.current })
  }, [])
  const toggleScoreFilter = useCallback((filter: ScoreFilterKey) => {
    dispatchTracked({ type: 'toggleScoreFilter', filter })
  }, [dispatchTracked])
  const setMethodSettings = useCallback((settings: ScoreMethodSettings) => {
    dispatchTracked({ type: 'setMethodSettings', settings })
  }, [dispatchTracked])

  const buildShareState = useCallback(
    (): ScoreBuilderShareState => ({
      version: 1,
      boundarySource: state.boundarySource,
      healthBoundaryLevel: state.healthBoundaryLevel,
      censusBoundaryLevel: state.censusBoundaryLevel,
      communityBoundaryLevel: state.communityBoundaryLevel,
      regionalDistrictBoundaryLevel: state.regionalDistrictBoundaryLevel,
      municipalityBoundaryLevel: state.municipalityBoundaryLevel,
      cityBoundaryLevel: state.cityBoundaryLevel,
      watershedBoundaryLevel: state.watershedBoundaryLevel,
      drainageBoundaryLevel: state.drainageBoundaryLevel,
      fireZoneBoundaryLevel: state.fireZoneBoundaryLevel,
      enabledDataSources: state.enabledDataSources,
      selectedNetworks: state.selectedNetworks,
      weights: state.weights,
      methodSettings: state.methodSettings,
      mapSurface: state.mapSurface,
      customMetricRecipes: state.customMetricRecipes,
      walkabilitySurfaceTuning: state.walkabilitySurfaceTuning.enabled ? state.walkabilitySurfaceTuning : undefined,
    }),
    [state],
  )

  const handleShareUrl = useCallback(async () => {
    const token = await encodeScoreBuilderShareState(buildShareState())
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
  }, [buildShareState])

  // Named index recipes saved on this device.
  const [savedIndexes, setSavedIndexes] = useState<SavedIndexEntry[]>(() => loadSavedIndexes())

  const saveCurrentIndex = useCallback(
    (label: string) => {
      const trimmed = label.trim()
      if (!trimmed) return
      const entry: SavedIndexEntry = {
        id: createSavedIndexId(),
        label: trimmed,
        savedAt: new Date().toISOString(),
        state: buildShareState(),
      }
      setSavedIndexes((current) => persistSavedIndexes([entry, ...current]))
    },
    [buildShareState],
  )

  const applySavedIndex = useCallback(
    (id: string) => {
      const entry = savedIndexes.find((candidate) => candidate.id === id)
      if (!entry) return
      dispatchTracked({ type: 'applyShareState', share: entry.state })
    },
    [dispatchTracked, savedIndexes],
  )

  const deleteSavedIndex = useCallback((id: string) => {
    setSavedIndexes((current) => persistSavedIndexes(current.filter((entry) => entry.id !== id)))
  }, [])

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
    setWalkabilitySurfaceTuning,
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
    buildShareState,
    handleShareUrl,
    undo,
    redo,
    canUndo,
    canRedo,
    savedIndexes,
    saveCurrentIndex,
    applySavedIndex,
    deleteSavedIndex,
  }
}

export type ScoreBuilderStateApi = ReturnType<typeof useScoreBuilderState>
