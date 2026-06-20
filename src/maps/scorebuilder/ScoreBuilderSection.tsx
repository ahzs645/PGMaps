import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Flame, Settings as SettingsIcon, Undo2 } from 'lucide-react'
import {
  DESKTOP_SIDEBAR_MAX_WIDTH,
  DESKTOP_SIDEBAR_MIN_WIDTH,
  MapSectionLayout,
} from '@/components/layout/MapSectionLayout'
import { cn } from '@/lib/utils'
import type { MapRef } from '@/components/ui/map'
import { ScoreBuilderEquationBar } from './components/ScoreBuilderEquationBar'
import { ScoreBuilderLeftPanel } from './components/ScoreBuilderLeftPanel'
import { ScoreBuilderMap } from './components/ScoreBuilderMap'
import { ScoreBuilderMapLegend } from './components/ScoreBuilderMapLegend'
import { ScoreBuilderMobileRegionCard } from './components/ScoreBuilderMobileRegionCard'
import { ScoreBuilderRegionInsightDialog } from './components/ScoreBuilderRegionInsightDialog'
import { ScoreBuilderRightPanel } from './components/ScoreBuilderRightPanel'
import { ScoreBuilderSettingsDialog } from './components/ScoreBuilderSettingsDialog'
import { ScoreBuilderSidebar } from './components/ScoreBuilderSidebar'
import { ScoreBuilderWalkabilitySurfacePanel } from './components/ScoreBuilderWalkabilitySurfacePanel'
import { createDefaultWalkabilitySurfaceTuning, type WalkabilitySurfaceTuning } from './lib/walkabilitySurface'
import { useMediaQuery } from './hooks/useMediaQuery'
import { useScoreBuilderDatasets } from './hooks/useScoreBuilderDatasets'
import { useScoreBuilderMapColors } from './hooks/useScoreBuilderMapColors'
import { useScoreBuilderMetricRows } from './hooks/useScoreBuilderMetricRows'
import { useScoreBuilderPointRecords } from './hooks/useScoreBuilderPointRecords'
import { useScoreBuilderResults } from './hooks/useScoreBuilderResults'
import { useScoreBuilderState } from './hooks/useScoreBuilderState'
import { useUserDatasets } from './hooks/useUserDatasets'
import { exportMapImage, exportScoredRegions, type ScoreBuilderExportFormat } from './lib/exportRegions'
import { exportPdfReport } from './lib/exportPdfReport'
import {
  captureBaselineSnapshot,
  compareAgainstBaseline,
  type BaselineSnapshot,
} from './lib/baselineComparison'

const LAYOUT_STORAGE_KEY = 'pgmaps.indexLab.layout'

interface StoredLayoutPrefs {
  showSidebar?: boolean
  showRightSidebar?: boolean
  sidebarWidth?: number
  rightSidebarWidth?: number
}

const DEFAULT_SIDEBAR_WIDTH = 300
const DEFAULT_RIGHT_SIDEBAR_WIDTH = 380

function clampStoredWidth(width: number | undefined, fallback: number): number {
  if (typeof width !== 'number' || !Number.isFinite(width)) return fallback
  return Math.min(DESKTOP_SIDEBAR_MAX_WIDTH, Math.max(DESKTOP_SIDEBAR_MIN_WIDTH, Math.round(width)))
}

function readLayoutPrefs(): StoredLayoutPrefs {
  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as StoredLayoutPrefs) : {}
  } catch {
    return {}
  }
}

function writeLayoutPrefs(prefs: StoredLayoutPrefs) {
  try {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // Private browsing or full storage — layout prefs just won't persist.
  }
}

/**
 * Composition root for the Index Lab (score builder).
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
export default function ScoreBuilderSection() {
  const sb = useScoreBuilderState()
  const { state } = sb
  const isDesktop = useMediaQuery('(min-width: 768px)')

  // Panel visibility: explicit user choice (localStorage) wins; otherwise default to open,
  // except the right panel on narrow desktops/tablets where both panels would crowd out the map.
  const [showSidebar, setShowSidebar] = useState(
    () => readLayoutPrefs().showSidebar ?? !sb.initializedFromUrlWeights,
  )
  const [showRightSidebar, setShowRightSidebar] = useState(() => {
    const stored = readLayoutPrefs().showRightSidebar
    if (stored != null) return stored
    if (typeof window !== 'undefined' && !window.matchMedia('(min-width: 1100px)').matches) return false
    return !sb.initializedFromUrlWeights
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    clampStoredWidth(readLayoutPrefs().sidebarWidth, DEFAULT_SIDEBAR_WIDTH),
  )
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() =>
    clampStoredWidth(readLayoutPrefs().rightSidebarWidth, DEFAULT_RIGHT_SIDEBAR_WIDTH),
  )

  // Persist panel widths after drags settle rather than on every pointer move.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const prefs = readLayoutPrefs()
      if (prefs.sidebarWidth === sidebarWidth && prefs.rightSidebarWidth === rightSidebarWidth) return
      writeLayoutPrefs({ ...prefs, sidebarWidth, rightSidebarWidth })
    }, 400)
    return () => window.clearTimeout(timer)
  }, [rightSidebarWidth, sidebarWidth])

  const toggleSidebar = useCallback(() => {
    setShowSidebar((current) => {
      writeLayoutPrefs({ ...readLayoutPrefs(), showSidebar: !current })
      return !current
    })
  }, [])
  const toggleRightSidebar = useCallback(() => {
    setShowRightSidebar((current) => {
      writeLayoutPrefs({ ...readLayoutPrefs(), showRightSidebar: !current })
      return !current
    })
  }, [])

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

  const { regionMetricRows, metricRanges, metricValueLists } = useScoreBuilderMetricRows({
    regions: datasets.regions,
    points,
    customMetricRecipes: state.customMetricRecipes,
    censusCategoryData: datasets.censusCategoryData,
    datasetCollections,
    healthyPlanPgEnabled: sb.enabledSourceSet.has('healthyPlanPg'),
    activeMetricDefinitions: sb.activeMetricDefinitions,
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

  // Walkability MI source-surface tuning is visualization state (like the
  // scenario baseline), not part of the scored equation, so it lives here
  // rather than in the score reducer.
  const [walkabilitySurfaceTuning, setWalkabilitySurfaceTuning] = useState<WalkabilitySurfaceTuning>(
    createDefaultWalkabilitySurfaceTuning,
  )

  const mapInstanceRef = useRef<MapRef | null>(null)
  const handleMapInstance = useCallback((map: MapRef | null) => {
    mapInstanceRef.current = map
  }, [])

  const activeRecipeDescription = results.activeExample
    ? results.activeExample.question
    : results.activePreset
      ? results.activePreset.description
      : 'Custom index built in the PGMaps Index Lab.'

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

  const desktopLeftPanel = (
    <ScoreBuilderLeftPanel
      boundarySource={state.boundarySource}
      onBoundarySourceChange={sb.setBoundarySource}
      selectedRegionLevel={sb.selectedRegionLevel}
      onRegionLevelChange={sb.handleRegionLevelChange}
      boundaryLevelOptions={sb.boundaryLevelOptions}
      enabledDataSources={state.enabledDataSources}
      onToggleDataSource={sb.toggleDataSource}
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
      onWeightChange={sb.handleWeightChange}
      onAddMetric={sb.handleAddMetric}
      onApplyPreset={sb.handleApplyPreset}
      boundarySource={state.boundarySource}
      activePresetKey={results.activePresetKey}
      hasActiveBoundarySurface={!sb.showWalkabilitySourceSurface}
      equationPreview={results.equationPreview}
      metricRanges={metricRanges}
      scoreSpread={results.scoreSpread}
      populationEquitySummary={results.populationEquitySummary}
      densityMetric={state.densityMetric}
      onDensityMetricChange={sb.setDensityMetric}
      onBuildDensityScore={sb.handleBuildDensityScore}
      densitySummary={results.densitySummary}
      densityLeaders={results.densityLeaders}
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
      isDesktop={isDesktop}
      correlateMode={state.correlateMode}
      onToggleCorrelateMode={sb.handleToggleCorrelateMode}
      densityMode={state.densityMode}
      correlateMetricX={state.correlateMetricX}
      correlateMetricY={state.correlateMetricY}
      onCorrelateMetricXChange={sb.setCorrelateMetricX}
      onCorrelateMetricYChange={sb.setCorrelateMetricY}
      correlateVisStyle={state.correlateVisStyle}
      onCorrelateVisStyleChange={sb.setCorrelateVisStyle}
      correlationResult={correlationResult}
      correlationTopPairs={correlationTopPairs}
      onApplyTopPair={sb.applyCorrelatePair}
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
      boundarySource={state.boundarySource}
      onBoundarySourceChange={sb.setBoundarySource}
      selectedRegionLevel={sb.selectedRegionLevel}
      onRegionLevelChange={sb.handleRegionLevelChange}
      boundaryLevelOptions={sb.boundaryLevelOptions}
      networkCounts={points.networkCounts}
      selectedNetworks={state.selectedNetworks}
      onToggleNetwork={sb.toggleNetwork}
      onSelectAllNetworks={sb.selectAllNetworks}
      onClearNetworks={sb.clearNetworks}
      showPoints={state.showPoints}
      onTogglePoints={sb.togglePoints}
      canUseWalkabilitySourceSurface={sb.canUseWalkabilitySourceSurface}
      mapSurface={state.mapSurface}
      onMapSurfaceChange={sb.handleMapSurfaceChange}
      enabledDataSources={state.enabledDataSources}
      onToggleDataSource={sb.toggleDataSource}
      weights={state.weights}
      onWeightChange={sb.handleWeightChange}
      onApplyPreset={sb.handleApplyPreset}
      activePresetKey={results.activePresetKey}
      equationPreview={results.equationPreview}
      scoreSpread={results.scoreSpread}
      populationEquitySummary={results.populationEquitySummary}
      densityMetric={state.densityMetric}
      onDensityMetricChange={sb.setDensityMetric}
      onBuildDensityScore={sb.handleBuildDensityScore}
      densitySummary={results.densitySummary}
      densityLeaders={results.densityLeaders}
      regions={results.scoredRegions}
      totalRegionCount={results.unfilteredScoredRegions.length}
      excludedRegionCount={excludedRegionCount}
      scoreFilters={state.scoreFilters}
      onToggleScoreFilter={sb.toggleScoreFilter}
      methodSettings={state.methodSettings}
      onMethodSettingsChange={sb.setMethodSettings}
      componentSummaries={results.componentSummaries}
      robustnessResults={results.robustnessResults}
      scoreBands={results.scoreBands}
      scenarioComparison={results.scenarioComparison}
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
      onApplyExample={sb.applyExample}
      isDesktop={isDesktop}
      customMetricRecipes={state.customMetricRecipes}
      datasetProfiles={datasetProfiles}
      onCreateCustomMetric={sb.handleCreateCustomMetric}
      onRemoveCustomMetric={sb.handleRemoveCustomMetric}
      userDatasets={userDatasets.summaries}
      onUploadUserDataset={userDatasets.uploadDataset}
      onRemoveUserDataset={userDatasets.removeDataset}
      baseline={baseline}
      baselineComparison={baselineComparison}
      onPinBaseline={pinBaseline}
      onClearBaseline={clearBaseline}
    />
  )

  return (
    <>
      <MapSectionLayout
        showDesktopSidebar={showSidebar}
        onToggleDesktopSidebar={toggleSidebar}
        desktopSidebarWidth={sidebarWidth}
        onDesktopSidebarWidthChange={setSidebarWidth}
        mobileInitialSheetState="collapsed"
        mobilePeek={
          <div className="min-w-0 text-left">
            <div className="truncate text-xs font-semibold text-foreground">
              Index Lab | {results.scoredRegions.length.toLocaleString()} regions
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {results.selectedRegion?.region.name || activeRecipeLabel}
            </div>
          </div>
        }
        sidebar={isDesktop ? desktopLeftPanel : mobileSidebar}
        rightSidebar={isDesktop ? desktopRightPanel : undefined}
        showDesktopRightSidebar={showRightSidebar}
        onToggleDesktopRightSidebar={toggleRightSidebar}
        desktopRightSidebarWidth={rightSidebarWidth}
        onDesktopRightSidebarWidthChange={setRightSidebarWidth}
      >
        <div className="relative flex h-full min-h-0 flex-col">
          {isDesktop && (
            <ScoreBuilderEquationBar
              weights={state.weights}
              metrics={sb.activeMetricDefinitions}
              methodSettings={state.methodSettings}
              activePresetKey={results.activePresetKey}
              activeRecipeLabel={activeRecipeLabel}
              activeRecipeDescription={activeRecipeDescription}
              boundarySource={state.boundarySource}
              equationPreview={results.equationPreview}
              onWeightChange={sb.handleWeightChange}
              onAddMetric={sb.handleAddMetric}
              onApplyPreset={sb.handleApplyPreset}
              onExport={handleExport}
              correlateMode={state.correlateMode}
              onToggleCorrelateMode={sb.handleToggleCorrelateMode}
              densityMode={state.densityMode}
              onToggleDensityMode={sb.handleToggleDensityMode}
              onOpenSettings={() => setSettingsOpen(true)}
              onUndo={sb.undo}
              onRedo={sb.redo}
              canUndo={sb.canUndo}
              canRedo={sb.canRedo}
            />
          )}

          <div className="relative min-h-0 flex-1">
            <ScoreBuilderMap
              regions={results.scoredRegions}
              selectedRegionId={state.selectedRegionId}
              monitors={points.filteredMonitors}
              showPoints={state.showPoints}
              onRegionClick={sb.handleMapRegionClick}
              regionFillColors={mapRegionFillColors}
              walkabilitySourceSurface={sb.showWalkabilitySourceSurface}
              sourceGridWeights={state.weights}
              walkabilitySurfaceTuning={walkabilitySurfaceTuning}
              loading={datasets.loading}
              onMapInstance={handleMapInstance}
            />

            {isDesktop && sb.showWalkabilitySourceSurface && (
              <ScoreBuilderWalkabilitySurfacePanel
                tuning={walkabilitySurfaceTuning}
                onChange={setWalkabilitySurfaceTuning}
                metricWeights={state.weights}
              />
            )}

            {!isDesktop && (
              <div
                className="absolute left-2 top-[calc(env(safe-area-inset-top)+3.75rem)] z-20 flex items-center gap-1.5"
                data-score-builder-mobile-actions="true"
              >
                <button
                  type="button"
                  onClick={sb.handleToggleDensityMode}
                  aria-pressed={state.densityMode}
                  className={cn(
                    'inline-flex min-h-10 items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium shadow-sm backdrop-blur transition-colors',
                    state.densityMode
                      ? 'border-amber-500 bg-amber-500 text-white'
                      : 'border-border bg-background/95 text-foreground',
                  )}
                >
                  <Flame className="h-3.5 w-3.5" />
                  Density
                </button>
                <button
                  type="button"
                  onClick={sb.handleToggleCorrelateMode}
                  aria-pressed={state.correlateMode}
                  className={cn(
                    'inline-flex min-h-10 items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium shadow-sm backdrop-blur transition-colors',
                    state.correlateMode
                      ? 'border-cyan-500 bg-cyan-500 text-white'
                      : 'border-border bg-background/95 text-foreground',
                  )}
                >
                  <Activity className="h-3.5 w-3.5" />
                  Correlate
                </button>
                <button
                  type="button"
                  onClick={sb.undo}
                  disabled={!sb.canUndo}
                  aria-label="Undo"
                  className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md border border-border bg-background/95 text-foreground shadow-sm backdrop-blur transition-colors disabled:opacity-40"
                >
                  <Undo2 className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  aria-label="Open index settings"
                  className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md border border-border bg-background/95 text-foreground shadow-sm backdrop-blur transition-colors"
                >
                  <SettingsIcon className="h-4 w-4" />
                </button>
              </div>
            )}

            {!isDesktop && results.selectedRegion && (
              <ScoreBuilderMobileRegionCard
                region={results.selectedRegion}
                drivers={results.selectedRegionDrivers}
                pinned={state.comparisonIds.includes(results.selectedRegion.region.id)}
                onOpenInsight={() => sb.handleOpenRegionInsight(results.selectedRegion!.region.id)}
                onToggleComparison={() => sb.toggleComparison(results.selectedRegion!.region.id)}
                onClose={sb.clearRegionSelection}
              />
            )}

            <ScoreBuilderMapLegend
              isDesktop={isDesktop}
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
            />
          </div>
        </div>
      </MapSectionLayout>

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
        activeExampleKey={results.resolvedExampleKey}
        onApplyExample={sb.applyExample}
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
        savedIndexes={sb.savedIndexes}
        onSaveIndex={sb.saveCurrentIndex}
        onApplySavedIndex={sb.applySavedIndex}
        onDeleteSavedIndex={sb.deleteSavedIndex}
        activeRecipeLabel={activeRecipeLabel}
      />
    </>
  )
}
