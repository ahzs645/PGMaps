import { useCallback, useEffect, useState } from 'react'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { ScoreBuilderEquationBar } from './components/ScoreBuilderEquationBar'
import { ScoreBuilderLeftPanel } from './components/ScoreBuilderLeftPanel'
import { ScoreBuilderMap } from './components/ScoreBuilderMap'
import { ScoreBuilderMapLegend } from './components/ScoreBuilderMapLegend'
import { ScoreBuilderMobileRegionCard } from './components/ScoreBuilderMobileRegionCard'
import { ScoreBuilderRegionInsightDialog } from './components/ScoreBuilderRegionInsightDialog'
import { ScoreBuilderRightPanel } from './components/ScoreBuilderRightPanel'
import { ScoreBuilderSettingsDialog } from './components/ScoreBuilderSettingsDialog'
import { ScoreBuilderSidebar } from './components/ScoreBuilderSidebar'
import { useMediaQuery } from './hooks/useMediaQuery'
import { useScoreBuilderDatasets } from './hooks/useScoreBuilderDatasets'
import { useScoreBuilderMapColors } from './hooks/useScoreBuilderMapColors'
import { useScoreBuilderMetricRows } from './hooks/useScoreBuilderMetricRows'
import { useScoreBuilderPointRecords } from './hooks/useScoreBuilderPointRecords'
import { useScoreBuilderResults } from './hooks/useScoreBuilderResults'
import { useScoreBuilderState } from './hooks/useScoreBuilderState'
import { exportScoredRegions } from './lib/exportRegions'

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

  const [showSidebar, setShowSidebar] = useState(() => !sb.initializedFromUrlWeights)
  const [showRightSidebar, setShowRightSidebar] = useState(() => !sb.initializedFromUrlWeights)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const datasets = useScoreBuilderDatasets({
    enabledSourceSet: sb.enabledSourceSet,
    boundarySource: state.boundarySource,
    selectedRegionLevel: sb.selectedRegionLevel,
    customMetricRecipes: state.customMetricRecipes,
  })

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
    datasetCollections: datasets.datasetCollections,
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

  const handleExport = useCallback(
    (format: 'csv' | 'geojson') => {
      exportScoredRegions(format, results.scoredRegions, sb.activeMetricDefinitions, state.methodSettings.aggregation)
    },
    [results.scoredRegions, sb.activeMetricDefinitions, state.methodSettings.aggregation],
  )

  const excludedRegionCount = Math.max(0, results.unfilteredScoredRegions.length - results.scoredRegions.length)
  const activeRecipeLabel = results.activeExample?.label || results.activePreset?.label || 'Custom index'

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
      datasetProfiles={datasets.datasetProfiles}
      onCreateCustomMetric={sb.handleCreateCustomMetric}
      onRemoveCustomMetric={sb.handleRemoveCustomMetric}
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
      datasetProfiles={datasets.datasetProfiles}
      onCreateCustomMetric={sb.handleCreateCustomMetric}
      onRemoveCustomMetric={sb.handleRemoveCustomMetric}
    />
  )

  return (
    <>
      <MapSectionLayout
        showDesktopSidebar={showSidebar}
        onToggleDesktopSidebar={() => setShowSidebar((current) => !current)}
        desktopSidebarWidth={300}
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
        onToggleDesktopRightSidebar={() => setShowRightSidebar((current) => !current)}
        desktopRightSidebarWidth={380}
      >
        <div className="relative flex h-full min-h-0 flex-col">
          {isDesktop && (
            <ScoreBuilderEquationBar
              weights={state.weights}
              metrics={sb.activeMetricDefinitions}
              methodSettings={state.methodSettings}
              activePresetKey={results.activePresetKey}
              activeRecipeLabel={activeRecipeLabel}
              activeRecipeDescription={
                results.activeExample
                  ? results.activeExample.question
                  : results.activePreset
                    ? results.activePreset.description
                    : 'Custom weights saved in the URL.'
              }
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
              loading={datasets.loading}
            />

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
      />
    </>
  )
}
