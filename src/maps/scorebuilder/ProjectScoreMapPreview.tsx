import { useCallback, useMemo, useState } from 'react'
import { MapGradientLegendItem, MapLegendPanel, MapSteppedLegend } from '@/components/ui/map-panels'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { buildProjectLabParams, type ProjectPackage } from '@/lib/projectPackages'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/useIsMobile'
import { toWalkabilityMiLegendBands, useWalkabilityMiBands } from '@/maps/pgdata/walkabilityMiBands'
import { SCORE_METRICS } from './constants'
import { ScoreBuilderMap } from './components/ScoreBuilderMap'
import { BcEnviroScreenMapControls } from './components/BcEnviroScreenMapControls'
import { BcEnviroScreenRegionProfile } from './components/BcEnviroScreenRegionProfile'
import {
  createInitialScoreBuilderState,
  getSelectedRegionLevel,
  showsWalkabilitySourceSurface,
} from './hooks/scoreBuilderReducer'
import { useScoreBuilderDatasets } from './hooks/useScoreBuilderDatasets'
import { useScoreBuilderMetricRows } from './hooks/useScoreBuilderMetricRows'
import { useScoreBuilderPointRecords } from './hooks/useScoreBuilderPointRecords'
import { useScoreBuilderResults } from './hooks/useScoreBuilderResults'
import { useWalkabilityMiZonal } from './hooks/useWalkabilityMiZonal'
import {
  BC_ENVIRO_SCREEN_DEFAULT_COLOR_BINS,
  BC_ENVIRO_SCREEN_DEFAULT_MAP_VARIABLE,
  createBcEnviroScreenMapViewCache,
  type BcEnviroScreenMapVariable,
} from './lib/bcEnviroScreenMapView'

const TRANSPARENT_FILL = 'rgba(0, 0, 0, 0)'

/**
 * Scored map for a project package with a lab recipe. Reuses the score builder data
 * pipeline with a fixed control state derived from the package. BC EnviroScreen
 * packages additionally expose the historical variable/bin controls and LHA profiles.
 */
export function ProjectScoreMapPreview({
  project,
  showScoreSurface,
  showPoints,
  className,
}: {
  project: ProjectPackage
  showScoreSurface: boolean
  showPoints: boolean
  className?: string
}) {
  const isDesktop = !useIsMobile()
  const [bcEnviroScreenMapVariable, setBcEnviroScreenMapVariable] = useState<BcEnviroScreenMapVariable>(
    BC_ENVIRO_SCREEN_DEFAULT_MAP_VARIABLE,
  )
  const [bcEnviroScreenColorBins, setBcEnviroScreenColorBins] = useState(BC_ENVIRO_SCREEN_DEFAULT_COLOR_BINS)
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null)
  const control = useMemo(() => {
    const params = buildProjectLabParams(project) ?? new URLSearchParams()
    return createInitialScoreBuilderState(params)
  }, [project])
  const selectedRegionLevel = getSelectedRegionLevel(control)
  const enabledSourceSet = useMemo(() => new Set(control.enabledDataSources), [control.enabledDataSources])

  const datasets = useScoreBuilderDatasets({
    enabledSourceSet,
    boundarySource: control.boundarySource,
    selectedRegionLevel,
    customMetricRecipes: control.customMetricRecipes,
  })
  const selectedNetworks = useMemo(() => {
    if (!control.pendingNetworkSelectAll) return control.selectedNetworks
    return Array.from(new Set(datasets.monitors.map((monitor) => monitor.network))).sort()
  }, [control.pendingNetworkSelectAll, control.selectedNetworks, datasets.monitors])
  const previewControl = useMemo(
    () =>
      control.pendingNetworkSelectAll ? { ...control, selectedNetworks, pendingNetworkSelectAll: false } : control,
    [control, selectedNetworks],
  )

  const points = useScoreBuilderPointRecords({
    enabledSourceSet,
    datasets,
    selectedNetworks,
    parkBufferAccessNeeded: (control.weights.parkAccessGap1Mile ?? 0) !== 0,
  })

  const walkabilityMiByRegion = useWalkabilityMiZonal(
    (control.weights.walkabilityMiSurface ?? 0) !== 0,
    datasets.regions,
  )

  const { regionMetricRows, metricRanges, metricValueLists } = useScoreBuilderMetricRows({
    regions: datasets.regions,
    points,
    customMetricRecipes: control.customMetricRecipes,
    censusCategoryData: datasets.censusCategoryData,
    datasetCollections: datasets.datasetCollections,
    healthyPlanPgEnabled: enabledSourceSet.has('healthyPlanPg'),
    activeMetricDefinitions: SCORE_METRICS,
    walkabilityMiByRegion,
    bcEnviroScreenRowsByLhaCode: datasets.bcEnviroScreen.rowsByLhaCode,
  })

  const results = useScoreBuilderResults({
    control: previewControl,
    selectedRegionLevel,
    activeMetricDefinitions: SCORE_METRICS,
    regionMetricRows,
    metricRanges,
    metricValueLists,
  })

  const bcEnviroScreenMapActive =
    showScoreSurface && previewControl.methodSettings.aggregation === 'bcEnviroScreenProduct'
  const bcEnviroScreenMapViewCache = useMemo(
    () => (bcEnviroScreenMapActive ? createBcEnviroScreenMapViewCache(results.unfilteredScoredRegions) : null),
    [bcEnviroScreenMapActive, results.unfilteredScoredRegions],
  )
  const bcEnviroScreenMapView = useMemo(
    () => bcEnviroScreenMapViewCache?.get(bcEnviroScreenMapVariable, bcEnviroScreenColorBins) ?? null,
    [bcEnviroScreenColorBins, bcEnviroScreenMapViewCache, bcEnviroScreenMapVariable],
  )

  const hiddenFillColors = useMemo(() => {
    if (showScoreSurface) return null
    return Object.fromEntries(results.scoredRegions.map((entry) => [entry.region.id, TRANSPARENT_FILL]))
  }, [results.scoredRegions, showScoreSurface])
  const regionFillColors = bcEnviroScreenMapView?.regionFillColors ?? hiddenFillColors
  const selectedRegion = useMemo(
    () => results.scoredRegions.find((entry) => entry.region.id === selectedRegionId) ?? null,
    [results.scoredRegions, selectedRegionId],
  )
  const showWalkabilitySourceSurface = showScoreSurface && showsWalkabilitySourceSurface(previewControl)
  // Served from the fetch cache the raster already populated, so this is free
  // whenever the surface it describes is on screen.
  const miBands = useWalkabilityMiBands(showWalkabilitySourceSurface)

  const handleRegionClick = useCallback(
    (regionId: string) => {
      if (bcEnviroScreenMapActive) setSelectedRegionId(regionId)
    },
    [bcEnviroScreenMapActive],
  )

  const palette = results.scorePaletteProfile

  return (
    <div className={cn('relative overflow-hidden bg-slate-100 dark:bg-slate-950', className)}>
      <ScoreBuilderMap
        regions={results.scoredRegions}
        selectedRegionId={bcEnviroScreenMapActive ? selectedRegionId : null}
        monitors={points.filteredMonitors}
        showPoints={showPoints}
        onRegionClick={handleRegionClick}
        regionFillColors={regionFillColors}
        walkabilitySourceSurface={showWalkabilitySourceSurface}
        sourceGridWeights={previewControl.weights}
        walkabilitySurfaceTuning={previewControl.walkabilitySurfaceTuning}
        loading={datasets.loading}
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

      <MapLegendPanel title={project.title} width="sm" collapsible defaultCollapsed={!isDesktop}>
        <div className="space-y-2">
          {/*
            The score palette only describes the boundary surface. When the
            walkability source raster is drawn instead, the boundary fills are
            transparent, so the legend has to describe the Mobility Index bands
            the raster is actually painted with.
          */}
          {bcEnviroScreenMapView ? (
            <>
              <div className="text-xs font-semibold text-foreground">{bcEnviroScreenMapView.label}</div>
              <MapSteppedLegend
                bands={bcEnviroScreenMapView.bands}
                labels={bcEnviroScreenMapView.legendLabels}
                angledLabels={bcEnviroScreenMapView.binCount > 5}
                data-bc-enviro-screen-legend="true"
              />
              <div className="text-xs leading-snug text-muted-foreground">
                {bcEnviroScreenMapView.binCount} equal-interval classes across {bcEnviroScreenMapView.valueCount} LHAs.
                Click an LHA for its full score and indicator profile.
              </div>
              {bcEnviroScreenMapView.missingCount > 0 && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="h-3 w-3 rounded-sm border border-black/10 bg-slate-400" />
                  Missing in {bcEnviroScreenMapView.missingCount} LHA
                  {bcEnviroScreenMapView.missingCount === 1 ? '' : 's'}
                </div>
              )}
            </>
          ) : showWalkabilitySourceSurface ? (
            <>
              <MapSteppedLegend bands={toWalkabilityMiLegendBands(miBands)} angledLabels={project.angledLegendLabels} />
              <div className="text-xs leading-snug text-muted-foreground">
                Mobility Index surface derived from the project recipe, over{' '}
                {results.scoredRegions.length.toLocaleString()} scored regions.
              </div>
            </>
          ) : (
            <>
              <MapGradientLegendItem
                colors={[...palette.colors]}
                minLabel={palette.legend.low}
                maxLabel={palette.legend.high}
              />
              <div className="text-xs leading-snug text-muted-foreground">
                {results.scoredRegions.length.toLocaleString()} regions scored with the project recipe.
              </div>
            </>
          )}
        </div>
      </MapLegendPanel>

      <Dialog
        open={Boolean(selectedRegion?.bcEnviroScreen)}
        onOpenChange={(open) => {
          if (!open) setSelectedRegionId(null)
        }}
      >
        <DialogContent
          variant="sheet"
          elevated
          className="max-h-[min(90dvh,760px)] sm:max-h-[min(90dvh,760px)] sm:max-w-3xl"
        >
          <DialogHeader className="shrink-0 border-b border-border px-4 pb-3 pt-5 sm:px-6 sm:pb-4 sm:pt-6">
            <DialogTitle className="pr-8 text-base sm:text-lg">
              {selectedRegion ? `Selected LHA: ${selectedRegion.region.name}` : 'Selected LHA'}
            </DialogTitle>
            <DialogDescription>
              Composite scores and provincial indicator percentiles from the current reconstruction release.
            </DialogDescription>
          </DialogHeader>
          {selectedRegion?.bcEnviroScreen && (
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 sm:px-6">
              <BcEnviroScreenRegionProfile region={selectedRegion} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
