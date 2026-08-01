import type {
  BoundaryLevel,
  BoundarySource,
  CensusBoundaryLevel,
  CityBoundaryLevel,
  CommunityBoundaryLevel,
  DrainageBoundaryLevel,
  FireZoneBoundaryLevel,
  MunicipalityBoundaryLevel,
  NrAdminBoundaryLevel,
  RegionalDistrictBoundaryLevel,
  RegionLevel,
  WatershedBoundaryLevel,
} from '@/maps/airquality'
import { toggleArrayItem } from '@/hooks/useToggleArray'
import {
  SCORE_BUILDER_EXAMPLES,
  SCORE_METRICS,
  SCORE_PRESETS,
  createDefaultWeights,
  createMetricValueMap,
  decodeWeightsFromParams,
  getScoreDataSourcesForWeights,
} from '../constants'
import { metricToDataSource } from '../lib/metrics'
import { metricRecipeToDefinition } from '../lib/metricDefinitions'
import type { MetricRecipe } from '../lib/metricRecipes'
import {
  createDefaultWalkabilitySurfaceTuning,
  parseWalkabilitySurfaceTuning,
  type WalkabilitySurfaceTuning,
} from '../lib/walkabilitySurface'
import type { ScoreBuilderShareState } from '../lib/shareState'
import {
  getQuickIndexLabPresetKey,
  parseAccessMinimumHits,
  parseAccessThresholdValue,
  parseAggregationMethod,
  parseBoundarySource,
  parseCensusBoundaryLevel,
  parseCityBoundaryLevel,
  parseCommunityBoundaryLevel,
  parseCustomMetricRecipes,
  parseCustomMetricWeights,
  parseDataSources,
  parseDrainageBoundaryLevel,
  parseFireZoneBoundaryLevel,
  parseHealthBoundaryLevel,
  parseMapColorScale,
  parseMapSurface,
  parseMissingDataMethod,
  parseMunicipalityBoundaryLevel,
  parseNormalizationMethod,
  parseNrAdminBoundaryLevel,
  parsePaletteOverride,
  parseRegionalDistrictBoundaryLevel,
  parseScoreMetricKey,
  parseSelectedNetworks,
  parseVisualOutputMode,
  parseWatershedBoundaryLevel,
} from '../lib/urlState'
import type {
  ScoreDataSource,
  ScoreExample,
  ScoreFilterKey,
  ScoreFilterState,
  ScoreMetricKey,
  ScoreMetricWeightMap,
  ScoreMethodSettings,
} from '../types'

export const DEFAULT_SCORE_FILTERS: ScoreFilterState = {
  // On by default: an unranked region is a better answer than a confidently
  // wrong mid-table one built from zero-filled metrics.
  requireCoverage: true,
  requirePopulation: false,
  requireParks: false,
  limitCrime: false,
  limitFoodRisk: false,
}

export interface ScoreBuilderControlState {
  boundarySource: BoundarySource
  healthBoundaryLevel: BoundaryLevel
  censusBoundaryLevel: CensusBoundaryLevel
  communityBoundaryLevel: CommunityBoundaryLevel
  cityBoundaryLevel: CityBoundaryLevel
  regionalDistrictBoundaryLevel: RegionalDistrictBoundaryLevel
  municipalityBoundaryLevel: MunicipalityBoundaryLevel
  watershedBoundaryLevel: WatershedBoundaryLevel
  drainageBoundaryLevel: DrainageBoundaryLevel
  fireZoneBoundaryLevel: FireZoneBoundaryLevel
  nrAdminBoundaryLevel: NrAdminBoundaryLevel
  weights: ScoreMetricWeightMap
  enabledDataSources: ScoreDataSource[]
  selectedNetworks: string[]
  /** Set when the initial example wants "all networks" before any monitors have loaded. */
  pendingNetworkSelectAll: boolean
  customMetricRecipes: MetricRecipe[]
  methodSettings: ScoreMethodSettings
  activeExampleKey: string | null
  mapSurface: 'source' | 'boundary'
  /** Direct 44-factor tuning for the walkability MI source surface (visualization only). */
  walkabilitySurfaceTuning: WalkabilitySurfaceTuning
  showPoints: boolean
  densityMetric: ScoreMetricKey
  densityMode: boolean
  correlateMode: boolean
  correlateMetricX: ScoreMetricKey
  correlateMetricY: ScoreMetricKey
  correlateVisStyle: 'bivariate' | 'residual'
  scoreFilters: ScoreFilterState
  searchQuery: string
  selectedRegionId: string | null
  regionInsightRegionId: string | null
  regionInsightOpen: boolean
  comparisonIds: string[]
}

export type ScoreBuilderAction =
  | { type: 'setBoundarySource'; source: BoundarySource }
  | { type: 'setRegionLevel'; level: RegionLevel }
  | { type: 'setWeight'; metric: ScoreMetricKey; value: number }
  | { type: 'addMetric'; metric: ScoreMetricKey; value: number; allNetworks: string[] }
  | { type: 'buildDensityScore'; metric: ScoreMetricKey; allNetworks: string[] }
  | { type: 'applyExample'; exampleKey: string; allNetworks: string[] }
  | { type: 'applyPreset'; presetKey: string; allNetworks: string[] }
  | { type: 'applyQuickPreset'; presetKey: string }
  | { type: 'applyShareState'; share: ScoreBuilderShareState }
  | { type: 'createCustomMetric'; recipe: MetricRecipe }
  | { type: 'removeCustomMetric'; id: string }
  | { type: 'toggleDataSource'; source: ScoreDataSource }
  | { type: 'enableDataSource'; source: ScoreDataSource; allNetworks: string[] }
  | { type: 'toggleNetwork'; network: string }
  | { type: 'setSelectedNetworks'; networks: string[] }
  | { type: 'networksLoaded'; allNetworks: string[] }
  | { type: 'togglePoints' }
  | { type: 'setMapSurface'; surface: 'source' | 'boundary' }
  | { type: 'setWalkabilitySurfaceTuning'; tuning: WalkabilitySurfaceTuning }
  | { type: 'mapRegionClick'; regionId: string }
  | { type: 'selectRegion'; regionId: string | null }
  | { type: 'openRegionInsight'; regionId: string }
  | { type: 'setRegionInsightOpen'; open: boolean }
  | { type: 'closeRegionInsight' }
  | { type: 'toggleComparison'; regionId: string }
  | { type: 'clearComparison' }
  | { type: 'setSearchQuery'; query: string }
  | { type: 'setDensityMetric'; metric: ScoreMetricKey; allNetworks: string[] }
  | { type: 'toggleDensityMode' }
  | { type: 'toggleCorrelateMode' }
  | { type: 'setCorrelateMetricX'; metric: ScoreMetricKey; allNetworks: string[] }
  | { type: 'setCorrelateMetricY'; metric: ScoreMetricKey; allNetworks: string[] }
  | { type: 'setCorrelateVisStyle'; style: 'bivariate' | 'residual' }
  | { type: 'applyCorrelatePair'; metricX: ScoreMetricKey; metricY: ScoreMetricKey; allNetworks: string[] }
  | { type: 'toggleScoreFilter'; filter: ScoreFilterKey }
  | { type: 'setMethodSettings'; settings: ScoreMethodSettings }
  | { type: 'restoreState'; state: ScoreBuilderControlState }

export function getSelectedRegionLevel(state: ScoreBuilderControlState): RegionLevel {
  if (state.boundarySource === 'walkabilityCommunity') return 'walkabilityCommunity'
  if (state.boundarySource === 'cityCommunity') return state.communityBoundaryLevel
  return state.boundarySource === 'bcHealth'
    ? state.healthBoundaryLevel
    : state.boundarySource === 'regionalDistrict'
      ? state.regionalDistrictBoundaryLevel
      : state.boundarySource === 'bcMunicipality'
        ? state.municipalityBoundaryLevel
        : state.boundarySource === 'census'
          ? state.censusBoundaryLevel
          : state.boundarySource === 'cityPG'
            ? state.cityBoundaryLevel
            : state.boundarySource === 'nrAdmin'
              ? state.nrAdminBoundaryLevel
              : state.boundarySource === 'bcWildfire'
                ? state.fireZoneBoundaryLevel
                : state.boundarySource === 'bcDrainage'
                  ? state.drainageBoundaryLevel
                  : state.watershedBoundaryLevel
}

export function canUseWalkabilitySourceSurface(state: ScoreBuilderControlState): boolean {
  return state.enabledDataSources.includes('walkability') && !state.correlateMode && !state.densityMode
}

export function showsWalkabilitySourceSurface(state: ScoreBuilderControlState): boolean {
  return canUseWalkabilitySourceSurface(state) && state.mapSurface === 'source'
}

function activeMetricDefinitionsFor(state: ScoreBuilderControlState) {
  return [...SCORE_METRICS, ...state.customMetricRecipes.map(metricRecipeToDefinition)]
}

/** Mirrors the former `applyExample` callback so it can run from the reducer and lazy init alike. */
function applyExampleToState(
  state: ScoreBuilderControlState,
  example: ScoreExample,
  allNetworks: string[],
  options?: { deferNetworkSelectAll?: boolean },
): ScoreBuilderControlState {
  const next: ScoreBuilderControlState = {
    ...state,
    activeExampleKey: example.key,
    boundarySource: example.boundarySource,
    enabledDataSources: [...example.dataSources],
    mapSurface: example.dataSources.includes('walkability') ? 'source' : 'boundary',
    weights: { ...example.weights },
    methodSettings: { ...state.methodSettings, ...example.methodSettings },
    pendingNetworkSelectAll: false,
    selectedRegionId: null,
    comparisonIds: [],
    searchQuery: '',
  }
  if (example.boundarySource === 'bcHealth') {
    next.healthBoundaryLevel = example.boundaryLevel as BoundaryLevel
  } else if (example.boundarySource === 'regionalDistrict') {
    next.regionalDistrictBoundaryLevel = parseRegionalDistrictBoundaryLevel(example.boundaryLevel)
  } else if (example.boundarySource === 'bcMunicipality') {
    next.municipalityBoundaryLevel = parseMunicipalityBoundaryLevel(example.boundaryLevel)
  } else if (example.boundarySource === 'census') {
    next.censusBoundaryLevel = example.boundaryLevel as CensusBoundaryLevel
  } else if (example.boundarySource === 'cityCommunity') {
    next.communityBoundaryLevel = parseCommunityBoundaryLevel(example.boundaryLevel)
  } else if (example.boundarySource === 'cityPG') {
    next.cityBoundaryLevel = example.boundaryLevel as CityBoundaryLevel
  } else if (example.boundarySource === 'bcWildfire') {
    next.fireZoneBoundaryLevel = parseFireZoneBoundaryLevel(example.boundaryLevel)
  } else if (example.boundarySource === 'bcDrainage') {
    next.drainageBoundaryLevel = parseDrainageBoundaryLevel(example.boundaryLevel)
  } else {
    next.watershedBoundaryLevel = parseWatershedBoundaryLevel(example.boundaryLevel)
  }
  if (example.networkFilter === 'all') {
    if (allNetworks.length > 0) {
      next.selectedNetworks = allNetworks
    } else {
      next.selectedNetworks = []
      if (options?.deferNetworkSelectAll) next.pendingNetworkSelectAll = true
    }
  } else if (example.networkFilter === 'none') {
    next.selectedNetworks = []
  } else {
    next.selectedNetworks = [...example.networkFilter]
  }
  return next
}

function applyPresetToState(
  state: ScoreBuilderControlState,
  presetKey: string,
  allNetworks: string[],
): ScoreBuilderControlState {
  const preset = SCORE_PRESETS.find((entry) => entry.key === presetKey)
  if (!preset) return state
  const next: ScoreBuilderControlState = {
    ...state,
    activeExampleKey: null,
    weights: { ...preset.weights },
    methodSettings: { ...state.methodSettings, ...preset.methodSettings },
    mapSurface: getScoreDataSourcesForWeights(preset.weights).includes('walkability') ? 'source' : 'boundary',
  }
  if (preset.recommendedBoundarySource) {
    next.boundarySource = preset.recommendedBoundarySource
  }
  if (preset.recommendedBoundaryLevel) {
    if (preset.recommendedBoundarySource === 'bcHealth') {
      next.healthBoundaryLevel = parseHealthBoundaryLevel(preset.recommendedBoundaryLevel)
    } else if (preset.recommendedBoundarySource === 'regionalDistrict') {
      next.regionalDistrictBoundaryLevel = parseRegionalDistrictBoundaryLevel(preset.recommendedBoundaryLevel)
    } else if (preset.recommendedBoundarySource === 'bcMunicipality') {
      next.municipalityBoundaryLevel = parseMunicipalityBoundaryLevel(preset.recommendedBoundaryLevel)
    } else if (preset.recommendedBoundarySource === 'census') {
      next.censusBoundaryLevel = parseCensusBoundaryLevel(preset.recommendedBoundaryLevel)
    } else if (preset.recommendedBoundarySource === 'cityCommunity') {
      next.communityBoundaryLevel = parseCommunityBoundaryLevel(preset.recommendedBoundaryLevel)
    } else if (preset.recommendedBoundarySource === 'cityPG') {
      next.cityBoundaryLevel = parseCityBoundaryLevel(preset.recommendedBoundaryLevel)
    } else if (preset.recommendedBoundarySource === 'watershed') {
      next.watershedBoundaryLevel = parseWatershedBoundaryLevel(preset.recommendedBoundaryLevel)
    } else if (preset.recommendedBoundarySource === 'bcWildfire') {
      next.fireZoneBoundaryLevel = parseFireZoneBoundaryLevel(preset.recommendedBoundaryLevel)
    } else if (preset.recommendedBoundarySource === 'bcDrainage') {
      next.drainageBoundaryLevel = parseDrainageBoundaryLevel(preset.recommendedBoundaryLevel)
    }
  }
  const neededSources = getScoreDataSourcesForWeights(preset.weights)
  const needsAirNetworks = neededSources.includes('airQuality')
  next.enabledDataSources = neededSources
  next.selectedNetworks = needsAirNetworks ? allNetworks : []
  // If monitors haven't loaded yet, defer the select-all so networksLoaded picks every network.
  next.pendingNetworkSelectAll = needsAirNetworks && allNetworks.length === 0
  next.showPoints = needsAirNetworks
  return next
}

function enableDataForMetric(
  state: ScoreBuilderControlState,
  metric: ScoreMetricKey,
  allNetworks: string[],
): ScoreBuilderControlState {
  const definition = activeMetricDefinitionsFor(state).find((entry) => entry.key === metric)
  const source = definition ? metricToDataSource(definition.category) : null
  if (!source) return state

  let next = state
  if (!next.enabledDataSources.includes(source)) {
    next = { ...next, enabledDataSources: [...next.enabledDataSources, source] }
  }
  if (source === 'airQuality') {
    if (!next.selectedNetworks.length) next = { ...next, selectedNetworks: allNetworks }
    if (allNetworks.length === 0) next = { ...next, pendingNetworkSelectAll: true }
    next = { ...next, showPoints: true }
  }
  if (metric === 'crimePerCapita' && !next.enabledDataSources.includes('census')) {
    next = { ...next, enabledDataSources: [...next.enabledDataSources, 'census'] }
  }
  return next
}

/**
 * Data sources exist to feed the equation, so removing the last metric that needs
 * one drops it. Sources that still back a weighted metric are always kept, and a
 * source the user switched on with no metrics of its own (for a point overlay) is
 * left alone — only the source just orphaned by this edit is pruned.
 */
function pruneOrphanedDataSource(
  state: ScoreBuilderControlState,
  removedMetric: ScoreMetricKey,
): ScoreBuilderControlState {
  const definitions = activeMetricDefinitionsFor(state)
  const removedSource = metricToDataSource(
    definitions.find((entry) => entry.key === removedMetric)?.category ?? '',
  )
  if (!removedSource || !state.enabledDataSources.includes(removedSource)) return state

  const stillNeeded = definitions.some(
    (entry) =>
      (state.weights[entry.key] ?? 0) !== 0 && metricToDataSource(entry.category) === removedSource,
  )
  // Per-capita crime borrows census population, so census outlives its own metrics.
  const borrowed = removedSource === 'census' && (state.weights.crimePerCapita ?? 0) !== 0
  if (stillNeeded || borrowed) return state

  return {
    ...state,
    enabledDataSources: state.enabledDataSources.filter((source) => source !== removedSource),
  }
}

function reduce(state: ScoreBuilderControlState, action: ScoreBuilderAction): ScoreBuilderControlState {
  switch (action.type) {
    case 'setBoundarySource':
      return { ...state, boundarySource: action.source }
    case 'setRegionLevel': {
      if (state.boundarySource === 'bcHealth') {
        return { ...state, healthBoundaryLevel: parseHealthBoundaryLevel(action.level) }
      }
      if (state.boundarySource === 'regionalDistrict') {
        return { ...state, regionalDistrictBoundaryLevel: parseRegionalDistrictBoundaryLevel(action.level) }
      }
      if (state.boundarySource === 'bcMunicipality') {
        return { ...state, municipalityBoundaryLevel: parseMunicipalityBoundaryLevel(action.level) }
      }
      if (state.boundarySource === 'census') {
        return { ...state, censusBoundaryLevel: parseCensusBoundaryLevel(action.level) }
      }
      if (state.boundarySource === 'cityCommunity') {
        return { ...state, communityBoundaryLevel: parseCommunityBoundaryLevel(action.level) }
      }
      if (state.boundarySource === 'cityPG') {
        return { ...state, cityBoundaryLevel: parseCityBoundaryLevel(action.level) }
      }
      if (state.boundarySource === 'nrAdmin') {
        return { ...state, nrAdminBoundaryLevel: parseNrAdminBoundaryLevel(action.level) }
      }
      if (state.boundarySource === 'bcWildfire') {
        return { ...state, fireZoneBoundaryLevel: parseFireZoneBoundaryLevel(action.level) }
      }
      if (state.boundarySource === 'bcDrainage') {
        return { ...state, drainageBoundaryLevel: parseDrainageBoundaryLevel(action.level) }
      }
      return { ...state, watershedBoundaryLevel: parseWatershedBoundaryLevel(action.level) }
    }
    case 'setWeight': {
      const previous = state.weights[action.metric] ?? 0
      const next: ScoreBuilderControlState = {
        ...state,
        activeExampleKey: null,
        weights: { ...state.weights, [action.metric]: action.value },
      }
      // Source activation follows the equation: a metric that starts counting turns
      // its source on, and the last one to leave turns it back off.
      if (previous === 0 && action.value !== 0) return enableDataForMetric(next, action.metric, [])
      if (previous !== 0 && action.value === 0) return pruneOrphanedDataSource(next, action.metric)
      return next
    }
    case 'addMetric': {
      let next: ScoreBuilderControlState = {
        ...state,
        activeExampleKey: null,
        weights: { ...state.weights, [action.metric]: action.value },
      }
      const definition = activeMetricDefinitionsFor(state).find((entry) => entry.key === action.metric)
      const source = definition ? metricToDataSource(definition.category) : null
      if (!source) return next
      if (!next.enabledDataSources.includes(source)) {
        next = { ...next, enabledDataSources: [...next.enabledDataSources, source] }
      }
      if (source === 'airQuality' && !next.selectedNetworks.length) {
        next = { ...next, selectedNetworks: action.allNetworks }
      }
      return next
    }
    case 'buildDensityScore': {
      const definition = activeMetricDefinitionsFor(state).find((entry) => entry.key === action.metric)
      const source = definition ? metricToDataSource(definition.category) : null
      const nextWeights = createMetricValueMap(0) as ScoreMetricWeightMap
      nextWeights[action.metric] = 100

      const next: ScoreBuilderControlState = {
        ...state,
        activeExampleKey: null,
        weights: nextWeights,
        methodSettings: { ...state.methodSettings, normalization: 'percentile', aggregation: 'additive' },
      }
      if (source) {
        if (!next.enabledDataSources.includes(source)) {
          next.enabledDataSources = [...next.enabledDataSources, source]
        }
        if (source === 'airQuality') {
          if (!next.selectedNetworks.length) next.selectedNetworks = action.allNetworks
          next.showPoints = true
        }
        if (action.metric === 'crimePerCapita' && !next.enabledDataSources.includes('census')) {
          next.enabledDataSources = [...next.enabledDataSources, 'census']
        }
      }
      return next
    }
    case 'applyExample': {
      const example = SCORE_BUILDER_EXAMPLES.find((entry) => entry.key === action.exampleKey)
      if (!example) return state
      return applyExampleToState(state, example, action.allNetworks)
    }
    case 'applyPreset':
      return applyPresetToState(state, action.presetKey, action.allNetworks)
    case 'applyQuickPreset': {
      const preset = SCORE_PRESETS.find((entry) => entry.key === action.presetKey)
      if (!preset) return state
      const sources = getScoreDataSourcesForWeights(preset.weights)
      const next: ScoreBuilderControlState = {
        ...state,
        weights: { ...preset.weights },
        enabledDataSources: sources,
        methodSettings: {
          ...state.methodSettings,
          ...preset.methodSettings,
          accessThreshold: {
            ...state.methodSettings.accessThreshold,
            ...preset.methodSettings?.accessThreshold,
          },
          healthyPlanPriority: {
            ...state.methodSettings.healthyPlanPriority,
            ...preset.methodSettings?.healthyPlanPriority,
          },
        },
        activeExampleKey: null,
        mapSurface: sources.includes('walkability') ? 'source' : 'boundary',
      }
      if (preset.recommendedBoundarySource) next.boundarySource = preset.recommendedBoundarySource
      if (preset.recommendedBoundaryLevel && preset.recommendedBoundarySource === 'census') {
        next.censusBoundaryLevel = parseCensusBoundaryLevel(preset.recommendedBoundaryLevel)
      }
      return next
    }
    case 'applyShareState': {
      const { share } = action
      const next: ScoreBuilderControlState = {
        ...state,
        activeExampleKey: null,
        boundarySource: parseBoundarySource(share.boundarySource),
        healthBoundaryLevel: parseHealthBoundaryLevel(share.healthBoundaryLevel),
        censusBoundaryLevel: parseCensusBoundaryLevel(share.censusBoundaryLevel),
        communityBoundaryLevel: parseCommunityBoundaryLevel(share.communityBoundaryLevel ?? null),
        cityBoundaryLevel: parseCityBoundaryLevel(share.cityBoundaryLevel ?? null),
        regionalDistrictBoundaryLevel: parseRegionalDistrictBoundaryLevel(share.regionalDistrictBoundaryLevel ?? null),
        municipalityBoundaryLevel: parseMunicipalityBoundaryLevel(share.municipalityBoundaryLevel ?? null),
        watershedBoundaryLevel: parseWatershedBoundaryLevel(share.watershedBoundaryLevel ?? null),
        drainageBoundaryLevel: parseDrainageBoundaryLevel(share.drainageBoundaryLevel ?? null),
        fireZoneBoundaryLevel: parseFireZoneBoundaryLevel(share.fireZoneBoundaryLevel ?? null),
        enabledDataSources: [...share.enabledDataSources],
        selectedNetworks: [...share.selectedNetworks],
        pendingNetworkSelectAll: false,
        customMetricRecipes: [...(share.customMetricRecipes ?? [])],
        weights: { ...createDefaultWeights(), ...share.weights } as ScoreMetricWeightMap,
      }
      if (share.methodSettings) next.methodSettings = { ...state.methodSettings, ...share.methodSettings }
      if (share.mapSurface) next.mapSurface = parseMapSurface(share.mapSurface)
      next.walkabilitySurfaceTuning = share.walkabilitySurfaceTuning ?? createDefaultWalkabilitySurfaceTuning()
      return next
    }
    case 'createCustomMetric': {
      const existingIds = new Set(state.customMetricRecipes.map((entry) => entry.id))
      const baseId = action.recipe.id || `custom_metric_${state.customMetricRecipes.length + 1}`
      let registeredId = baseId
      let suffix = 2
      while (existingIds.has(registeredId) || SCORE_METRICS.some((metric) => metric.key === registeredId)) {
        registeredId = `${baseId}_${suffix}`
        suffix += 1
      }
      const next: ScoreBuilderControlState = {
        ...state,
        activeExampleKey: null,
        customMetricRecipes: [...state.customMetricRecipes, { ...action.recipe, id: registeredId }],
        weights: { ...state.weights, [registeredId]: action.recipe.direction === 'higherIsWorse' ? -35 : 35 },
      }
      if (action.recipe.source === 'census') {
        if (!next.enabledDataSources.includes('census')) {
          next.enabledDataSources = [...next.enabledDataSources, 'census']
        }
      } else if (
        action.recipe.source.startsWith('healthyplanPg.') &&
        !next.enabledDataSources.includes('healthyPlanPg')
      ) {
        // User-uploaded (`user.*`) and formula sources need no remote data source toggled on.
        next.enabledDataSources = [...next.enabledDataSources, 'healthyPlanPg']
      }
      return next
    }
    case 'removeCustomMetric':
      return {
        ...state,
        customMetricRecipes: state.customMetricRecipes.filter((recipe) => recipe.id !== action.id),
        weights: { ...state.weights, [action.id]: 0 },
      }
    case 'toggleDataSource':
      return { ...state, enabledDataSources: toggleArrayItem(state.enabledDataSources, action.source) }
    case 'enableDataSource': {
      if (state.enabledDataSources.includes(action.source)) return state
      const next: ScoreBuilderControlState = {
        ...state,
        enabledDataSources: [...state.enabledDataSources, action.source],
      }
      if (action.source !== 'airQuality') return next
      // Air quality only renders once at least one monitoring network is selected.
      return {
        ...next,
        selectedNetworks: next.selectedNetworks.length ? next.selectedNetworks : action.allNetworks,
        pendingNetworkSelectAll: next.selectedNetworks.length === 0 && action.allNetworks.length === 0,
      }
    }
    case 'toggleNetwork':
      return {
        ...state,
        selectedNetworks: toggleArrayItem(state.selectedNetworks, action.network),
        pendingNetworkSelectAll: false,
      }
    case 'setSelectedNetworks':
      return { ...state, selectedNetworks: action.networks, pendingNetworkSelectAll: false }
    case 'networksLoaded': {
      let selectedNetworks = state.selectedNetworks
      if (selectedNetworks.length) {
        const valid = selectedNetworks.filter((network) => action.allNetworks.includes(network))
        if (valid.length !== selectedNetworks.length) selectedNetworks = valid
      }
      let pendingNetworkSelectAll = state.pendingNetworkSelectAll
      if (pendingNetworkSelectAll && action.allNetworks.length > 0) {
        selectedNetworks = action.allNetworks
        pendingNetworkSelectAll = false
      }
      if (
        selectedNetworks === state.selectedNetworks &&
        pendingNetworkSelectAll === state.pendingNetworkSelectAll
      ) {
        return state
      }
      return { ...state, selectedNetworks, pendingNetworkSelectAll }
    }
    case 'togglePoints':
      return { ...state, showPoints: !state.showPoints }
    case 'setMapSurface':
      return {
        ...state,
        mapSurface: action.surface,
        selectedRegionId: action.surface === 'source' ? null : state.selectedRegionId,
      }
    case 'setWalkabilitySurfaceTuning':
      return { ...state, walkabilitySurfaceTuning: action.tuning }
    case 'mapRegionClick': {
      const next: ScoreBuilderControlState = {
        ...state,
        selectedRegionId: state.selectedRegionId === action.regionId ? null : action.regionId,
      }
      if (showsWalkabilitySourceSurface(state)) next.mapSurface = 'boundary'
      return next
    }
    case 'selectRegion':
      return { ...state, selectedRegionId: action.regionId }
    case 'openRegionInsight':
      return {
        ...state,
        selectedRegionId: action.regionId,
        regionInsightRegionId: action.regionId,
        regionInsightOpen: true,
      }
    case 'setRegionInsightOpen':
      return {
        ...state,
        regionInsightOpen: action.open,
        regionInsightRegionId: action.open ? state.regionInsightRegionId : null,
      }
    case 'closeRegionInsight':
      return { ...state, regionInsightOpen: false, regionInsightRegionId: null }
    case 'toggleComparison': {
      if (state.comparisonIds.includes(action.regionId)) {
        return { ...state, comparisonIds: state.comparisonIds.filter((id) => id !== action.regionId) }
      }
      if (state.comparisonIds.length >= 3) return state
      return { ...state, comparisonIds: [...state.comparisonIds, action.regionId] }
    }
    case 'clearComparison':
      return { ...state, comparisonIds: [] }
    case 'setSearchQuery':
      return { ...state, searchQuery: action.query }
    case 'setDensityMetric':
      return enableDataForMetric({ ...state, densityMetric: action.metric }, action.metric, action.allNetworks)
    case 'toggleDensityMode': {
      const densityMode = !state.densityMode
      if (!densityMode) return { ...state, densityMode }
      return { ...state, densityMode, correlateMode: false, mapSurface: 'boundary' }
    }
    case 'toggleCorrelateMode': {
      const correlateMode = !state.correlateMode
      if (!correlateMode) return { ...state, correlateMode }
      return { ...state, correlateMode, densityMode: false, mapSurface: 'boundary' }
    }
    case 'setCorrelateMetricX':
      return enableDataForMetric({ ...state, correlateMetricX: action.metric }, action.metric, action.allNetworks)
    case 'setCorrelateMetricY':
      return enableDataForMetric({ ...state, correlateMetricY: action.metric }, action.metric, action.allNetworks)
    case 'setCorrelateVisStyle':
      return { ...state, correlateVisStyle: action.style }
    case 'applyCorrelatePair': {
      const next = { ...state, correlateMetricX: action.metricX, correlateMetricY: action.metricY }
      return enableDataForMetric(enableDataForMetric(next, action.metricX, action.allNetworks), action.metricY, action.allNetworks)
    }
    case 'toggleScoreFilter':
      return {
        ...state,
        scoreFilters: { ...state.scoreFilters, [action.filter]: !state.scoreFilters[action.filter] },
      }
    case 'setMethodSettings':
      return { ...state, methodSettings: action.settings }
    case 'restoreState':
      return action.state
  }
}

/**
 * Cross-field invariants formerly enforced by `useEffect` blocks:
 * - the walkability source surface is only available while the walkability source is enabled;
 * - changing the active boundary clears region selection, insight, and comparison state.
 */
function applyInvariants(prev: ScoreBuilderControlState, next: ScoreBuilderControlState): ScoreBuilderControlState {
  if (prev === next) return next
  if (!next.enabledDataSources.includes('walkability') && next.mapSurface === 'source') {
    next = { ...next, mapSurface: 'boundary' }
  }
  const boundaryChanged =
    prev.boundarySource !== next.boundarySource || getSelectedRegionLevel(prev) !== getSelectedRegionLevel(next)
  if (
    boundaryChanged &&
    (next.selectedRegionId !== null ||
      next.regionInsightRegionId !== null ||
      next.regionInsightOpen ||
      next.comparisonIds.length > 0)
  ) {
    next = {
      ...next,
      selectedRegionId: null,
      regionInsightRegionId: null,
      regionInsightOpen: false,
      comparisonIds: [],
    }
  }
  return next
}

export function scoreBuilderReducer(
  state: ScoreBuilderControlState,
  action: ScoreBuilderAction,
): ScoreBuilderControlState {
  return applyInvariants(state, reduce(state, action))
}

export function hasUrlWeightParams(searchParams: URLSearchParams): boolean {
  return Boolean(
    searchParams.get('w') ||
    searchParams.get('agg') ||
    searchParams.get('hpDemo') ||
    searchParams.get('hpEnv') ||
    searchParams.get('recipes') ||
    searchParams.get('cw') ||
    searchParams.get('s'),
  )
}

/**
 * Builds the full initial state from the URL. When the URL carries no explicit weights,
 * the first example is applied here (instead of in a mount effect) so the very first
 * render already reflects it.
 */
export function createInitialScoreBuilderState(searchParams: URLSearchParams): ScoreBuilderControlState {
  const quickPresetKey = getQuickIndexLabPresetKey(searchParams.get('quick'))
  const quickPreset = SCORE_PRESETS.find((preset) => preset.key === quickPresetKey) || null
  const hasUrlWeights = hasUrlWeightParams(searchParams)

  let weights: ScoreMetricWeightMap
  if (quickPreset) {
    weights = { ...quickPreset.weights }
  } else {
    const fromUrl = searchParams.get('w')
    const decoded = fromUrl ? decodeWeightsFromParams(fromUrl) : null
    weights = decoded
      ? { ...decoded, ...parseCustomMetricWeights(searchParams.get('cw')) }
      : { ...createDefaultWeights(), ...parseCustomMetricWeights(searchParams.get('cw')) }
  }

  let enabledDataSources: ScoreDataSource[]
  if (quickPreset) {
    enabledDataSources = getScoreDataSourcesForWeights(quickPreset.weights)
  } else {
    const fromUrl = parseDataSources(searchParams.get('ds'))
    if (fromUrl.length) enabledDataSources = fromUrl
    else if (!hasUrlWeights) enabledDataSources = [...(SCORE_BUILDER_EXAMPLES[0]?.dataSources ?? ['airQuality'])]
    else enabledDataSources = ['airQuality']
  }

  const networkSelection = parseSelectedNetworks(searchParams.get('networks'))

  const methodSettings: ScoreMethodSettings = {
    normalization: parseNormalizationMethod(searchParams.get('norm')),
    aggregation: quickPreset?.methodSettings?.aggregation ?? parseAggregationMethod(searchParams.get('agg')),
    missingData: parseMissingDataMethod(searchParams.get('missing')),
    sensitivity: searchParams.get('sens') === 'off' ? false : true,
    normalizationScope: 'activeBoundaryLevel',
    visualOutput: parseVisualOutputMode(searchParams.get('vis')),
    mapColorScale: parseMapColorScale(searchParams.get('cscale')),
    paletteOverride: parsePaletteOverride(searchParams.get('pal')),
    healthyPlanPriority: {
      demographicMetric: parseScoreMetricKey(searchParams.get('hpDemo'), 'cimdComposite'),
      environmentMetric: parseScoreMetricKey(searchParams.get('hpEnv'), 'canopyProxyRatio'),
    },
    accessThreshold: {
      minimumAccess: parseAccessThresholdValue(searchParams.get('accessMin')),
      minimumHits: parseAccessMinimumHits(searchParams.get('accessHits')),
    },
    metricModuleOverrides: {},
  }

  let state: ScoreBuilderControlState = {
    boundarySource: parseBoundarySource(searchParams.get('src')),
    healthBoundaryLevel: parseHealthBoundaryLevel(searchParams.get('level')),
    censusBoundaryLevel: parseCensusBoundaryLevel(searchParams.get('level')),
    communityBoundaryLevel: parseCommunityBoundaryLevel(searchParams.get('level')),
    cityBoundaryLevel: parseCityBoundaryLevel(searchParams.get('level')),
    regionalDistrictBoundaryLevel: parseRegionalDistrictBoundaryLevel(searchParams.get('level')),
    municipalityBoundaryLevel: parseMunicipalityBoundaryLevel(searchParams.get('level')),
    watershedBoundaryLevel: parseWatershedBoundaryLevel(searchParams.get('level')),
    drainageBoundaryLevel: parseDrainageBoundaryLevel(searchParams.get('level')),
    fireZoneBoundaryLevel: parseFireZoneBoundaryLevel(searchParams.get('level')),
    nrAdminBoundaryLevel: parseNrAdminBoundaryLevel(searchParams.get('level')),
    weights,
    enabledDataSources,
    selectedNetworks: networkSelection.selectedNetworks,
    pendingNetworkSelectAll: networkSelection.pendingNetworkSelectAll,
    customMetricRecipes: parseCustomMetricRecipes(searchParams.get('recipes')),
    methodSettings,
    activeExampleKey: quickPresetKey ? null : !hasUrlWeights ? SCORE_BUILDER_EXAMPLES[0]?.key || null : null,
    mapSurface: parseMapSurface(searchParams.get('surface')),
    walkabilitySurfaceTuning: parseWalkabilitySurfaceTuning(searchParams.get('wsurf')),
    showPoints: true,
    densityMetric: 'overallDensity',
    densityMode: false,
    correlateMode: false,
    correlateMetricX: 'populationDensity',
    correlateMetricY: 'crimeDensity',
    correlateVisStyle: 'bivariate',
    scoreFilters: { ...DEFAULT_SCORE_FILTERS },
    searchQuery: '',
    selectedRegionId: null,
    regionInsightRegionId: null,
    regionInsightOpen: false,
    comparisonIds: [],
  }

  const initialExample = SCORE_BUILDER_EXAMPLES[0]
  if (!quickPresetKey && !hasUrlWeights && initialExample) {
    state = applyExampleToState(state, initialExample, [], { deferNetworkSelectAll: true })
  }

  if (!state.enabledDataSources.includes('walkability') && state.mapSurface === 'source') {
    state = { ...state, mapSurface: 'boundary' }
  }
  return state
}
