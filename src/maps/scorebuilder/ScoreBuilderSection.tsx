import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Redo2, Undo2 } from 'lucide-react'
import {
  DESKTOP_SIDEBAR_MAX_WIDTH,
  DESKTOP_SIDEBAR_MIN_WIDTH,
  MapSectionLayout,
} from '@/components/layout/MapSectionLayout'
import type { MapRef } from '@/components/ui/map'
import { ScoreBuilderBuildView } from './components/ScoreBuilderBuildView'
import { IndexLabHeader, LabsBackLink } from './components/IndexLabHeader'
import { ScoreBuilderEquationBar } from './components/ScoreBuilderEquationBar'
import { RecipesDialog } from './components/RecipesDialog'
import { SCORE_PRESETS } from './constants'
import { presetAppliesToBoundary } from './lib/presets'
import { LensLabSidebar } from './components/LensLabSidebar'
import { ScoreBuilderLeftPanel } from './components/ScoreBuilderLeftPanel'
import { ScoreBuilderMap } from './components/ScoreBuilderMap'
import { ScoreBuilderCoverageNotice } from './components/ScoreBuilderCoverageNotice'
import { ScoreBuilderMapLegend } from './components/ScoreBuilderMapLegend'
import { ScoreBuilderMobileRegionCard } from './components/ScoreBuilderMobileRegionCard'
import { ScoreBuilderRegionInsightDialog } from './components/ScoreBuilderRegionInsightDialog'
import { ScoreBuilderRightPanel } from './components/ScoreBuilderRightPanel'
import { ScoreBuilderSettingsDialog } from './components/ScoreBuilderSettingsDialog'
import { ScoreBuilderSidebar } from './components/ScoreBuilderSidebar'
import { ScoreBuilderWalkabilitySurfacePanel } from './components/ScoreBuilderWalkabilitySurfacePanel'
import { BcEnviroScreenMapControls } from './components/BcEnviroScreenMapControls'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useScoreBuilderDatasets } from './hooks/useScoreBuilderDatasets'
import { useScoreBuilderMapColors } from './hooks/useScoreBuilderMapColors'
import { useScoreBuilderMetricRows } from './hooks/useScoreBuilderMetricRows'
import { useScoreBuilderPointRecords } from './hooks/useScoreBuilderPointRecords'
import { useScoreBuilderResults } from './hooks/useScoreBuilderResults'
import { useScoreBuilderState } from './hooks/useScoreBuilderState'
import { useUserDatasets } from './hooks/useUserDatasets'
import { useWalkabilityMiZonal } from './hooks/useWalkabilityMiZonal'
import { exportMapImage, exportScoredRegions, type ScoreBuilderExportFormat } from './lib/exportRegions'
import { exportPdfReport } from './lib/exportPdfReport'
import { captureBaselineSnapshot, compareAgainstBaseline, type BaselineSnapshot } from './lib/baselineComparison'
import {
  BC_ENVIRO_SCREEN_DEFAULT_COLOR_BINS,
  BC_ENVIRO_SCREEN_DEFAULT_MAP_VARIABLE,
  buildBcEnviroScreenMapView,
  type BcEnviroScreenMapVariable,
} from './lib/bcEnviroScreenMapView'
import {
  buildProjectPackageFromShareState,
  downloadProjectPackage,
  findProjectPackageBySlug,
} from '@/lib/projectPackages'
import { DEFAULT_LOCALE } from '@/lib/format'
import { formatMetricValue } from './lib/metrics'
import { getScoreLab, type ScoreLabKind } from './lib/labs'

/** Each lab keeps its own panel layout; the lens labs have a single sidebar. */
function layoutStorageKey(lab: ScoreLabKind): string {
  return lab === 'index' ? 'pgmaps.indexLab.layout' : `pgmaps.${lab}Lab.layout`
}

interface StoredLayoutPrefs {
  showSidebar?: boolean
  showRightSidebar?: boolean
  sidebarWidth?: number
  rightSidebarWidth?: number
}

const DEFAULT_SIDEBAR_WIDTH = 300
const DEFAULT_RIGHT_SIDEBAR_WIDTH = 380
/** Both side panels only fit alongside a useful map from Tailwind's `xl` breakpoint up. */
const BOTH_PANELS_MEDIA_QUERY = '(min-width: 1280px)'

type LabViewMode = 'build' | 'explore'

function initialLabViewMode(lab: ScoreLabKind): LabViewMode {
  // Only the Index Lab has a Build view; the lens labs are map-first.
  if (lab !== 'index' || typeof window === 'undefined') return 'explore'
  const params = new URLSearchParams(window.location.search)
  const explicit = params.get('view')
  if (explicit === 'build' || explicit === 'explore') return explicit
  // The map-first Explore view is the default; Build is an explicit opt-in via `view=build`.
  return 'explore'
}

function clampStoredWidth(width: number | undefined, fallback: number): number {
  if (typeof width !== 'number' || !Number.isFinite(width)) return fallback
  return Math.min(DESKTOP_SIDEBAR_MAX_WIDTH, Math.max(DESKTOP_SIDEBAR_MIN_WIDTH, Math.round(width)))
}

function readLayoutPrefs(lab: ScoreLabKind): StoredLayoutPrefs {
  try {
    const raw = window.localStorage.getItem(layoutStorageKey(lab))
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as StoredLayoutPrefs) : {}
  } catch {
    return {}
  }
}

function writeLayoutPrefs(lab: ScoreLabKind, prefs: StoredLayoutPrefs) {
  try {
    window.localStorage.setItem(layoutStorageKey(lab), JSON.stringify(prefs))
  } catch {
    // Private browsing or full storage — layout prefs just won't persist.
  }
}

/**
 * Composition root for the Index Lab (score builder) and its two lens labs. All three
 * run the same data pipeline; `lab` fixes what the map shows:
 * - `index` — the composite score, with the Build view, equation bar, and ranked regions;
 * - `density` — one metric painted across the study area (Density Lab);
 * - `correlate` — the relationship between two metrics (Correlation Lab).
 *
 * Responsibilities are split across dedicated hooks:
 * - `useScoreBuilderState` — all control state (boundary, weights, sources, presets,
 *   examples, modes, selection) behind a reducer, plus URL/share synchronisation;
 * - `useScoreBuilderDatasets` — raw dataset fetching gated on the enabled sources;
 * - `useScoreBuilderPointRecords` — per-domain point/line/buffer record collections;
 * - `useScoreBuilderMetricRows` — region aggregation into metric rows and ranges;
 * - `useScoreBuilderResults` — scoring, ranking, filtering, and derived analysis;
 * - `useScoreBuilderMapColors` — map fill colors for the active lens.
 */
export default function ScoreBuilderSection({ lab = 'index' }: { lab?: ScoreLabKind }) {
  const sb = useScoreBuilderState(lab)
  const { state } = sb
  const isDesktop = !useIsMobile()
  const isIndexLab = lab === 'index'
  const labInfo = getScoreLab(lab)

  // Build/Explore split: same state, two layouts. The choice is linkable via `view=`.
  const [searchParams, setSearchParams] = useSearchParams()
  const [viewMode, setViewModeState] = useState<LabViewMode>(() => initialLabViewMode(lab))
  const setViewMode = useCallback(
    (mode: LabViewMode) => {
      setViewModeState(mode)
      const next = new URLSearchParams(searchParams)
      next.set('view', mode)
      setSearchParams(next, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  // Panel visibility: explicit user choice (localStorage) wins; otherwise default to open,
  // except the right panel below `xl` where both panels would crowd out the map. A lens
  // lab's sidebar holds all of its controls, so it opens even on a deep link.
  const [showSidebar, setShowSidebar] = useState(
    () => readLayoutPrefs(lab).showSidebar ?? (lab !== 'index' || !sb.initializedFromUrlWeights),
  )
  const [showRightSidebar, setShowRightSidebar] = useState(() => {
    const stored = readLayoutPrefs(lab).showRightSidebar
    if (stored != null) return stored
    if (typeof window !== 'undefined' && !window.matchMedia(BOTH_PANELS_MEDIA_QUERY).matches) return false
    return !sb.initializedFromUrlWeights
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [recipesOpen, setRecipesOpen] = useState(false)
  const [bcEnviroScreenMapVariable, setBcEnviroScreenMapVariable] = useState<BcEnviroScreenMapVariable>(
    BC_ENVIRO_SCREEN_DEFAULT_MAP_VARIABLE,
  )
  const [bcEnviroScreenColorBins, setBcEnviroScreenColorBins] = useState(BC_ENVIRO_SCREEN_DEFAULT_COLOR_BINS)
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    clampStoredWidth(readLayoutPrefs(lab).sidebarWidth, DEFAULT_SIDEBAR_WIDTH),
  )
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() =>
    clampStoredWidth(readLayoutPrefs(lab).rightSidebarWidth, DEFAULT_RIGHT_SIDEBAR_WIDTH),
  )

  // Persist panel widths after drags settle rather than on every pointer move.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const prefs = readLayoutPrefs(lab)
      if (prefs.sidebarWidth === sidebarWidth && prefs.rightSidebarWidth === rightSidebarWidth) return
      writeLayoutPrefs(lab, { ...prefs, sidebarWidth, rightSidebarWidth })
    }, 400)
    return () => window.clearTimeout(timer)
  }, [lab, rightSidebarWidth, sidebarWidth])

  const toggleSidebar = useCallback(() => {
    setShowSidebar((current) => {
      writeLayoutPrefs(lab, { ...readLayoutPrefs(lab), showSidebar: !current })
      return !current
    })
  }, [lab])
  const toggleRightSidebar = useCallback(() => {
    setShowRightSidebar((current) => {
      writeLayoutPrefs(lab, { ...readLayoutPrefs(lab), showRightSidebar: !current })
      return !current
    })
  }, [lab])

  const datasets = useScoreBuilderDatasets({
    enabledSourceSet: sb.enabledSourceSet,
    boundarySource: state.boundarySource,
    selectedRegionLevel: sb.selectedRegionLevel,
    customMetricRecipes: state.customMetricRecipes,
  })

  // User-uploaded datasets (Dexie/IndexedDB) join the recipe pipeline as `user.*` sources.
  const userDatasets = useUserDatasets()
  const datasetCollections = useMemo(
    () => ({ ...datasets.datasetCollections, ...userDatasets.collections }),
    [datasets.datasetCollections, userDatasets.collections],
  )
  const datasetProfiles = useMemo(
    () => ({ ...datasets.datasetProfiles, ...userDatasets.profiles }),
    [datasets.datasetProfiles, userDatasets.profiles],
  )

  const points = useScoreBuilderPointRecords({
    enabledSourceSet: sb.enabledSourceSet,
    datasets,
    selectedNetworks: state.selectedNetworks,
    parkBufferAccessNeeded: state.weights.parkAccessGap1Mile !== 0,
  })

  // Keep the control state in sync with the networks present in the monitor data.
  const { onNetworksLoaded } = sb
  useEffect(() => {
    onNetworksLoaded(points.allNetworks)
  }, [onNetworksLoaded, points.allNetworks])

  // The MI-surface zonal aggregation is expensive, so it only runs when the user
  // actually weights the metric (turning the raster into a scored, ranked input).
  const walkabilityMiByRegion = useWalkabilityMiZonal((state.weights.walkabilityMiSurface ?? 0) !== 0, datasets.regions)

  const { regionMetricRows, metricRanges, metricValueLists } = useScoreBuilderMetricRows({
    regions: datasets.regions,
    points,
    customMetricRecipes: state.customMetricRecipes,
    censusCategoryData: datasets.censusCategoryData,
    datasetCollections,
    healthyPlanPgEnabled: sb.enabledSourceSet.has('healthyPlanPg'),
    activeMetricDefinitions: sb.activeMetricDefinitions,
    walkabilityMiByRegion,
    bcEnviroScreenRowsByLhaCode: datasets.bcEnviroScreen.rowsByLhaCode,
  })

  const results = useScoreBuilderResults({
    control: state,
    selectedRegionLevel: sb.selectedRegionLevel,
    activeMetricDefinitions: sb.activeMetricDefinitions,
    regionMetricRows,
    metricRanges,
    metricValueLists,
  })

  const { correlationResult, correlationTopPairs, mapRegionFillColors } = useScoreBuilderMapColors({
    correlateMode: state.correlateMode,
    correlateMetricX: state.correlateMetricX,
    correlateMetricY: state.correlateMetricY,
    correlateVisStyle: state.correlateVisStyle,
    densityMode: state.densityMode,
    densityMetric: state.densityMetric,
    regionMetricRows,
    metricRanges,
    scoredRegions: results.scoredRegions,
    scorePaletteProfile: results.scorePaletteProfile,
    visualOutput: state.methodSettings.visualOutput,
    mapColorScale: state.methodSettings.mapColorScale,
    scoreSpread: results.scoreSpread,
    canUseWalkabilitySourceSurface: sb.canUseWalkabilitySourceSurface,
    showWalkabilitySourceSurface: sb.showWalkabilitySourceSurface,
  })

  const bcEnviroScreenMapActive =
    state.methodSettings.aggregation === 'bcEnviroScreenProduct' && !state.correlateMode && !state.densityMode
  const bcEnviroScreenMapView = useMemo(
    () =>
      bcEnviroScreenMapActive
        ? buildBcEnviroScreenMapView(
            results.unfilteredScoredRegions,
            bcEnviroScreenMapVariable,
            bcEnviroScreenColorBins,
          )
        : null,
    [
      bcEnviroScreenColorBins,
      bcEnviroScreenMapActive,
      bcEnviroScreenMapVariable,
      results.unfilteredScoredRegions,
    ],
  )
  const resolvedMapRegionFillColors = bcEnviroScreenMapView?.regionFillColors ?? mapRegionFillColors

  // Drop stale selection/insight ids once their regions leave the scored set.
  const { selectRegion, closeRegionInsight } = sb
  useEffect(() => {
    if (state.selectedRegionId && !results.selectedRegion) selectRegion(null)
  }, [results.selectedRegion, selectRegion, state.selectedRegionId])

  useEffect(() => {
    if (state.regionInsightRegionId && !results.regionInsightRegion) closeRegionInsight()
  }, [closeRegionInsight, results.regionInsightRegion, state.regionInsightRegionId])

  const excludedRegionCount = Math.max(0, results.unfilteredScoredRegions.length - results.scoredRegions.length)
  const activeRecipeLabel = results.activeExample?.label || results.activePreset?.label || 'Custom index'

  // Scenario A/B: a user-pinned snapshot of the ranking that later edits are diffed against.
  const [baseline, setBaseline] = useState<BaselineSnapshot | null>(null)
  const pinBaseline = useCallback(() => {
    setBaseline(captureBaselineSnapshot(results.scoredRegions, activeRecipeLabel))
  }, [activeRecipeLabel, results.scoredRegions])
  const clearBaseline = useCallback(() => setBaseline(null), [])
  const baselineComparison = useMemo(
    () => (baseline ? compareAgainstBaseline(baseline, results.scoredRegions) : null),
    [baseline, results.scoredRegions],
  )

  // Deep links from a project package carry a `project` param (read once at mount — the
  // URL-persistence effect strips it). Once the recipe's data is fully scored, pin the
  // project as the baseline so edits are compared against the published version.
  const [projectContextSlug] = useState(() =>
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('project'),
  )
  const [projectContextTitle, setProjectContextTitle] = useState<string | null>(null)
  useEffect(() => {
    if (!projectContextSlug) return
    let cancelled = false
    findProjectPackageBySlug(projectContextSlug).then((pkg) => {
      if (!cancelled) setProjectContextTitle(pkg?.title ?? projectContextSlug)
    })
    return () => {
      cancelled = true
    }
  }, [projectContextSlug])
  const projectBaselinePinned = useRef(false)
  useEffect(() => {
    if (!projectContextSlug || !projectContextTitle || projectBaselinePinned.current) return
    if (datasets.loading || results.scoredRegions.length === 0) return
    projectBaselinePinned.current = true
    // One-shot pin after the async scoring settles; the ref guard prevents any cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBaseline(captureBaselineSnapshot(results.scoredRegions, `Project: ${projectContextTitle}`))
  }, [datasets.loading, projectContextSlug, projectContextTitle, results.scoredRegions])

  const mapInstanceRef = useRef<MapRef | null>(null)
  const handleMapInstance = useCallback((map: MapRef | null) => {
    mapInstanceRef.current = map
  }, [])

  const activeRecipeDescription = results.activeExample
    ? results.activeExample.question
    : results.activePreset
      ? results.activePreset.description
      : 'Custom index built in the PGMaps Index Lab.'

  const handleExportProjectPackage = useCallback(
    (label: string) => {
      const pkg = buildProjectPackageFromShareState(
        sb.buildShareState(),
        label.trim() || activeRecipeLabel,
        activeRecipeDescription,
      )
      downloadProjectPackage(pkg)
    },
    [activeRecipeDescription, activeRecipeLabel, sb],
  )

  const handleExport = useCallback(
    (format: ScoreBuilderExportFormat) => {
      if (format === 'png') {
        const map = mapInstanceRef.current
        if (map) void exportMapImage(map, activeRecipeLabel).catch(() => {})
        return
      }
      if (format === 'pdf') {
        void exportPdfReport({
          map: mapInstanceRef.current,
          title: activeRecipeLabel,
          description: activeRecipeDescription,
          equationPreview: results.equationPreview,
          methodSettings: state.methodSettings,
          scoredRegions: results.scoredRegions,
          metrics: sb.activeMetricDefinitions,
          scoreSpread: results.scoreSpread,
        }).catch(() => {})
        return
      }
      exportScoredRegions(format, results.scoredRegions, sb.activeMetricDefinitions, state.methodSettings.aggregation)
    },
    [
      activeRecipeDescription,
      activeRecipeLabel,
      results.equationPreview,
      results.scoreSpread,
      results.scoredRegions,
      sb.activeMetricDefinitions,
      state.methodSettings,
    ],
  )

  const visiblePresets = useMemo(
    () => SCORE_PRESETS.filter((preset) => presetAppliesToBoundary(preset, state.boundarySource)),
    [state.boundarySource],
  )
  const openRecipes = useCallback(() => setRecipesOpen(true), [])
  const openSettings = useCallback(() => setSettingsOpen(true), [])

  const desktopLeftPanel = (
    <ScoreBuilderLeftPanel
      boundarySource={state.boundarySource}
      onBoundarySourceChange={sb.setBoundarySource}
      selectedRegionLevel={sb.selectedRegionLevel}
      onRegionLevelChange={sb.handleRegionLevelChange}
      boundaryLevelOptions={sb.boundaryLevelOptions}
      weights={state.weights}
      metrics={sb.activeMetricDefinitions}
      onAddMetric={sb.handleAddMetric}
      onWeightChange={sb.handleWeightChange}
      enabledDataSources={state.enabledDataSources}
      onToggleDataSource={sb.toggleDataSource}
      onEnableDataSource={sb.enableDataSource}
      networkCounts={points.networkCounts}
      selectedNetworks={state.selectedNetworks}
      onToggleNetwork={sb.toggleNetwork}
      onSelectAllNetworks={sb.selectAllNetworks}
      onClearNetworks={sb.clearNetworks}
      showPoints={state.showPoints}
      onTogglePoints={sb.togglePoints}
      regionCount={results.scoredRegions.length}
      canUseWalkabilitySourceSurface={sb.canUseWalkabilitySourceSurface}
      mapSurface={state.mapSurface}
      onMapSurfaceChange={sb.handleMapSurfaceChange}
      customMetricRecipes={state.customMetricRecipes}
      datasetProfiles={datasetProfiles}
      onCreateCustomMetric={sb.handleCreateCustomMetric}
      onRemoveCustomMetric={sb.handleRemoveCustomMetric}
      userDatasets={userDatasets.summaries}
      onUploadUserDataset={userDatasets.uploadDataset}
      onRemoveUserDataset={userDatasets.removeDataset}
    />
  )

  const desktopRightPanel = (
    <ScoreBuilderRightPanel
      loading={datasets.loading}
      dataErrors={datasets.dataErrors}
      weights={state.weights}
      activePresetKey={results.activePresetKey}
      hasActiveBoundarySurface={!sb.showWalkabilitySourceSurface}
      scoreSpread={results.scoreSpread}
      populationEquitySummary={results.populationEquitySummary}
      regions={results.scoredRegions}
      filteredRegions={results.filteredRegions}
      selectedRegion={results.selectedRegion}
      searchQuery={state.searchQuery}
      onSearchQueryChange={sb.setSearchQuery}
      onRegionSelect={sb.selectRegion}
      onClearRegionSelection={sb.clearRegionSelection}
      onOpenRegionInsight={sb.handleOpenRegionInsight}
      comparisonIds={state.comparisonIds}
      comparisonRegions={results.comparisonRegions}
      onToggleComparison={sb.toggleComparison}
      onClearComparison={sb.clearComparison}
      onExport={handleExport}
      onShareUrl={sb.handleShareUrl}
      activeExampleKey={results.resolvedExampleKey}
      baseline={baseline}
      baselineComparison={baselineComparison}
      onPinBaseline={pinBaseline}
      onClearBaseline={clearBaseline}
    />
  )

  const mobileSidebar = (
    <ScoreBuilderSidebar
      className="h-full w-full border-0 shadow-none"
      loading={datasets.loading}
      dataErrors={datasets.dataErrors}
      activeRecipeLabel={activeRecipeLabel}
      activeRecipeDescription={activeRecipeDescription}
      boundarySource={state.boundarySource}
      onBoundarySourceChange={sb.setBoundarySource}
      selectedRegionLevel={sb.selectedRegionLevel}
      onRegionLevelChange={sb.handleRegionLevelChange}
      boundaryLevelOptions={sb.boundaryLevelOptions}
      metrics={sb.activeMetricDefinitions}
      weights={state.weights}
      onWeightChange={sb.handleWeightChange}
      onAddMetric={sb.handleAddMetric}
      enabledDataSources={state.enabledDataSources}
      onToggleDataSource={sb.toggleDataSource}
      onEnableDataSource={sb.enableDataSource}
      showPoints={state.showPoints}
      onTogglePoints={sb.togglePoints}
      canUseWalkabilitySourceSurface={sb.canUseWalkabilitySourceSurface}
      mapSurface={state.mapSurface}
      onMapSurfaceChange={sb.handleMapSurfaceChange}
      scoreSpread={results.scoreSpread}
      populationEquitySummary={results.populationEquitySummary}
      regions={results.scoredRegions}
      filteredRegions={results.filteredRegions}
      selectedRegion={results.selectedRegion}
      searchQuery={state.searchQuery}
      onSearchQueryChange={sb.setSearchQuery}
      onRegionSelect={sb.selectRegion}
      onClearRegionSelection={sb.clearRegionSelection}
      onOpenRegionInsight={sb.handleOpenRegionInsight}
      comparisonIds={state.comparisonIds}
      comparisonRegions={results.comparisonRegions}
      onToggleComparison={sb.toggleComparison}
      onClearComparison={sb.clearComparison}
      onExport={handleExport}
      onShareUrl={sb.handleShareUrl}
      baseline={baseline}
      baselineComparison={baselineComparison}
      onPinBaseline={pinBaseline}
      onClearBaseline={clearBaseline}
      onOpenRecipes={openRecipes}
      onOpenSettings={openSettings}
      onOpenBuild={() => setViewMode('build')}
    />
  )

  const lensSidebarProps = {
    dataErrors: datasets.dataErrors,
    regionCount: results.scoredRegions.length,
    metrics: sb.activeMetricDefinitions,
    boundarySource: state.boundarySource,
    onBoundarySourceChange: sb.setBoundarySource,
    selectedRegionLevel: sb.selectedRegionLevel,
    onRegionLevelChange: sb.handleRegionLevelChange,
    boundaryLevelOptions: sb.boundaryLevelOptions,
    enabledDataSources: state.enabledDataSources,
    onToggleDataSource: sb.toggleDataSource,
    onEnableDataSource: sb.enableDataSource,
    showPoints: state.showPoints,
    onTogglePoints: sb.togglePoints,
    selectedRegion: results.selectedRegion,
    onRegionSelect: sb.selectRegion,
    onClearRegionSelection: sb.clearRegionSelection,
    className: isDesktop ? 'border-r border-border shadow-xl' : 'border-0 shadow-none',
    showDescription: !isDesktop,
  }
  const lensSidebar =
    lab === 'density' ? (
      <LensLabSidebar
        {...lensSidebarProps}
        lab="density"
        densityMetric={state.densityMetric}
        onDensityMetricChange={sb.setDensityMetric}
        densitySummary={results.densitySummary}
        densityLeaders={results.densityLeaders}
      />
    ) : (
      <LensLabSidebar
        {...lensSidebarProps}
        lab="correlate"
        correlateMetricX={state.correlateMetricX}
        correlateMetricY={state.correlateMetricY}
        onCorrelateMetricXChange={sb.setCorrelateMetricX}
        onCorrelateMetricYChange={sb.setCorrelateMetricY}
        correlateVisStyle={state.correlateVisStyle}
        onCorrelateVisStyleChange={sb.setCorrelateVisStyle}
        correlationResult={correlationResult}
        correlationTopPairs={correlationTopPairs}
        onApplyTopPair={sb.applyCorrelatePair}
      />
    )

  // On a phone the sheet peeks the selected region and, in a lens lab, its lens values.
  const selectedRegion = results.selectedRegion
  const mobilePeekSubtitle = (() => {
    if (!selectedRegion) {
      const count = `${results.scoredRegions.length.toLocaleString(DEFAULT_LOCALE)} regions`
      return isIndexLab ? `${count} · avg ${results.scoreSpread.average.toFixed(1)}` : count
    }
    if (lab === 'density') {
      return `${selectedRegion.region.name} · ${formatMetricValue(state.densityMetric, selectedRegion.metrics[state.densityMetric], true)}`
    }
    if (lab === 'correlate') {
      const x = formatMetricValue(state.correlateMetricX, selectedRegion.metrics[state.correlateMetricX], true)
      const y = formatMetricValue(state.correlateMetricY, selectedRegion.metrics[state.correlateMetricY], true)
      return `${selectedRegion.region.name} · ${x} / ${y}`
    }
    return `#${selectedRegion.rank} ${selectedRegion.region.name}`
  })()

  const buildView = (
    <ScoreBuilderBuildView
      weights={state.weights}
      metrics={sb.activeMetricDefinitions}
      enabledDataSources={state.enabledDataSources}
      onEnableDataSource={sb.enableDataSource}
      onWeightChange={sb.handleWeightChange}
      onAddMetric={sb.handleAddMetric}
      totalAbsoluteWeight={sb.totalAbsoluteWeight}
      methodSettings={state.methodSettings}
      onMethodSettingsChange={sb.setMethodSettings}
      boundarySource={state.boundarySource}
      onBoundarySourceChange={sb.setBoundarySource}
      selectedRegionLevel={sb.selectedRegionLevel}
      onRegionLevelChange={sb.handleRegionLevelChange}
      boundaryLevelOptions={sb.boundaryLevelOptions}
      equationPreview={results.equationPreview}
      scoreSpread={results.scoreSpread}
      scoredRegions={results.scoredRegions}
      metricRanges={metricRanges}
      loading={datasets.loading}
      activeRecipeLabel={activeRecipeLabel}
      activeRecipeDescription={activeRecipeDescription}
      baseline={baseline}
      baselineComparison={baselineComparison}
      onPinBaseline={pinBaseline}
      onClearBaseline={clearBaseline}
      monitors={points.filteredMonitors}
      showPoints={state.showPoints}
      regionFillColors={mapRegionFillColors}
      onSwitchToExplore={() => setViewMode('explore')}
      onOpenRecipes={openRecipes}
      onOpenSettings={openSettings}
      onUndo={sb.undo}
      onRedo={sb.redo}
      canUndo={sb.canUndo}
      canRedo={sb.canRedo}
      customMetricRecipes={state.customMetricRecipes}
      datasetProfiles={datasetProfiles}
      onCreateCustomMetric={sb.handleCreateCustomMetric}
      onRemoveCustomMetric={sb.handleRemoveCustomMetric}
      userDatasets={userDatasets.summaries}
      onUploadUserDataset={userDatasets.uploadDataset}
      onRemoveUserDataset={userDatasets.removeDataset}
    />
  )

  const mobileIconButtonClass =
    'inline-flex min-h-10 min-w-10 items-center justify-center rounded-md border border-border bg-background/95 text-foreground shadow-sm backdrop-blur transition-colors disabled:opacity-40'

  return (
    <>
      {viewMode === 'build' && buildView}
      {viewMode === 'explore' && (
        <div className="flex h-full min-h-0 flex-col">
          {/* Same header strip as the Build view, so the toggle and actions stay put on swap. */}
          {isDesktop &&
            (isIndexLab ? (
              <IndexLabHeader
                mode="explore"
                onSwitchToBuild={() => setViewMode('build')}
                title={activeRecipeLabel}
                description={activeRecipeDescription}
                onOpenRecipes={openRecipes}
                onOpenSettings={openSettings}
                history={{ onUndo: sb.undo, onRedo: sb.redo, canUndo: sb.canUndo, canRedo: sb.canRedo }}
                onExport={handleExport}
              />
            ) : (
              <IndexLabHeader title={labInfo.title} description={labInfo.description} />
            ))}
          <div className="min-h-0 flex-1">
            <MapSectionLayout
              showDesktopSidebar={showSidebar}
              onToggleDesktopSidebar={toggleSidebar}
              desktopSidebarWidth={sidebarWidth}
              onDesktopSidebarWidthChange={setSidebarWidth}
              mobileInitialSheetState="collapsed"
              mobilePeekTitle={isIndexLab ? activeRecipeLabel : labInfo.title}
              mobilePeekSubtitle={mobilePeekSubtitle}
              sidebar={!isIndexLab ? lensSidebar : isDesktop ? desktopLeftPanel : mobileSidebar}
              rightSidebar={isDesktop && isIndexLab ? desktopRightPanel : undefined}
              showDesktopRightSidebar={showRightSidebar}
              onToggleDesktopRightSidebar={toggleRightSidebar}
              desktopRightSidebarWidth={rightSidebarWidth}
              onDesktopRightSidebarWidthChange={setRightSidebarWidth}
            >
              <div className="relative flex h-full min-h-0 flex-col">
                {isDesktop && isIndexLab && (
                  <ScoreBuilderEquationBar
                    weights={state.weights}
                    metrics={sb.activeMetricDefinitions}
                    enabledDataSources={state.enabledDataSources}
                    onEnableDataSource={sb.enableDataSource}
                    methodSettings={state.methodSettings}
                    boundarySource={state.boundarySource}
                    equationPreview={results.equationPreview}
                    onWeightChange={sb.handleWeightChange}
                    onAddMetric={sb.handleAddMetric}
                  />
                )}

                <div className="relative min-h-0 flex-1">
                  <ScoreBuilderMap
                    regions={results.scoredRegions}
                    selectedRegionId={state.selectedRegionId}
                    monitors={points.filteredMonitors}
                    showPoints={state.showPoints}
                    onRegionClick={sb.handleMapRegionClick}
                    regionFillColors={resolvedMapRegionFillColors}
                    walkabilitySourceSurface={sb.showWalkabilitySourceSurface}
                    sourceGridWeights={state.weights}
                    walkabilitySurfaceTuning={state.walkabilitySurfaceTuning}
                    loading={datasets.loading}
                    onMapInstance={handleMapInstance}
                    fitAllRegions={bcEnviroScreenMapActive}
                  />

                  {bcEnviroScreenMapActive && (
                    <BcEnviroScreenMapControls
                      variable={bcEnviroScreenMapVariable}
                      onVariableChange={setBcEnviroScreenMapVariable}
                      colorBins={bcEnviroScreenColorBins}
                      onColorBinsChange={setBcEnviroScreenColorBins}
                      isDesktop={isDesktop}
                    />
                  )}

                  {!datasets.loading && results.scoredRegions.length === 0 && results.lowCoverageExcludedCount > 0 && (
                    <ScoreBuilderCoverageNotice
                      excludedCount={results.lowCoverageExcludedCount}
                      onShowAnyway={() => sb.toggleScoreFilter('requireCoverage')}
                    />
                  )}

                  {sb.showWalkabilitySourceSurface && (
                    <ScoreBuilderWalkabilitySurfacePanel
                      tuning={state.walkabilitySurfaceTuning}
                      onChange={sb.setWalkabilitySurfaceTuning}
                      metricWeights={state.weights}
                      isDesktop={isDesktop}
                    />
                  )}

                  {/* Phone strip: back to Labs, plus undo/redo in the Index Lab. Build, Recipes, and Settings live in the sheet. */}
                  {!isDesktop && (
                    <div
                      className="absolute left-2 right-2 top-[calc(env(safe-area-inset-top)+3.75rem)] z-20 flex items-center gap-1.5"
                      data-score-builder-mobile-actions="true"
                    >
                      <LabsBackLink size="lg" />
                      {isIndexLab && (
                        <div className="ml-auto flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            onClick={sb.undo}
                            disabled={!sb.canUndo}
                            aria-label="Undo"
                            className={mobileIconButtonClass}
                          >
                            <Undo2 className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={sb.redo}
                            disabled={!sb.canRedo}
                            aria-label="Redo"
                            className={mobileIconButtonClass}
                          >
                            <Redo2 className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {!isDesktop && isIndexLab && results.selectedRegion && (
                    <ScoreBuilderMobileRegionCard
                      region={results.selectedRegion}
                      drivers={results.selectedRegionDrivers}
                      enabledDataSources={state.enabledDataSources}
                      pinned={state.comparisonIds.includes(results.selectedRegion.region.id)}
                      onOpenInsight={() => sb.handleOpenRegionInsight(results.selectedRegion!.region.id)}
                      onToggleComparison={() => sb.toggleComparison(results.selectedRegion!.region.id)}
                      onClose={sb.clearRegionSelection}
                    />
                  )}

                  <ScoreBuilderMapLegend
                    correlateMode={state.correlateMode}
                    correlateMetricX={state.correlateMetricX}
                    correlateMetricY={state.correlateMetricY}
                    correlateVisStyle={state.correlateVisStyle}
                    correlationResult={correlationResult}
                    densityMode={state.densityMode}
                    densityMetric={state.densityMetric}
                    densityRange={metricRanges[state.densityMetric]}
                    showWalkabilitySourceSurface={sb.showWalkabilitySourceSurface}
                    canUseWalkabilitySourceSurface={sb.canUseWalkabilitySourceSurface}
                    methodSettings={state.methodSettings}
                    scorePaletteProfile={results.scorePaletteProfile}
                    scoreSpread={results.scoreSpread}
                    enabledDataSourceCount={state.enabledDataSources.length}
                    regionCount={datasets.regions.length}
                    thinCoverageCount={results.thinCoverageCount}
                    lowCoverageExcludedCount={results.lowCoverageExcludedCount}
                    bcEnviroScreenMapView={bcEnviroScreenMapView}
                  />
                </div>
              </div>
            </MapSectionLayout>
          </div>
        </div>
      )}

      <RecipesDialog
        open={recipesOpen}
        onOpenChange={setRecipesOpen}
        presets={visiblePresets}
        activePresetKey={results.activePresetKey}
        onApplyPreset={sb.handleApplyPreset}
        activeExampleKey={results.resolvedExampleKey}
        onApplyExample={sb.applyExample}
        savedIndexes={sb.savedIndexes}
        onSaveIndex={sb.saveCurrentIndex}
        onApplySavedIndex={sb.applySavedIndex}
        onDeleteSavedIndex={sb.deleteSavedIndex}
        onExportProjectPackage={handleExportProjectPackage}
        activeRecipeLabel={activeRecipeLabel}
      />

      <ScoreBuilderRegionInsightDialog
        open={state.regionInsightOpen}
        onOpenChange={sb.handleRegionInsightOpenChange}
        region={results.regionInsightRegion}
        weights={state.weights}
        methodSettings={state.methodSettings}
        isMobile={!isDesktop}
        metrics={sb.activeMetricDefinitions}
      />

      <ScoreBuilderSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        weights={state.weights}
        methodSettings={state.methodSettings}
        onMethodSettingsChange={sb.setMethodSettings}
        componentSummaries={results.componentSummaries}
        activePresetKey={results.activePresetKey}
        totalAbsoluteWeight={sb.totalAbsoluteWeight}
        scoreFilters={state.scoreFilters}
        onToggleScoreFilter={sb.toggleScoreFilter}
        scoreBands={results.scoreBands}
        scenarioComparison={results.scenarioComparison}
        regions={results.scoredRegions}
        totalRegionCount={results.unfilteredScoredRegions.length}
        excludedRegionCount={excludedRegionCount}
        scoreSpread={results.scoreSpread}
        robustnessResults={results.robustnessResults}
      />
    </>
  )
}
