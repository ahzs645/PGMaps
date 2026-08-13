import { useCallback, useMemo } from 'react'
import { MapGradientLegendItem, MapLegendPanel, MapSteppedLegend } from '@/components/ui/map-panels'
import { buildProjectLabParams, type ProjectPackage } from '@/lib/projectPackages'
import { cn } from '@/lib/utils'
import { toWalkabilityMiLegendBands, useWalkabilityMiBands } from '@/maps/pgdata/walkabilityMiBands'
import { SCORE_METRICS } from './constants'
import { ScoreBuilderMap } from './components/ScoreBuilderMap'
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

const TRANSPARENT_FILL = 'rgba(0, 0, 0, 0)'

/**
 * Read-only scored map for a project package with a lab recipe. Reuses the score
 * builder data pipeline with a fixed control state derived from the package, so the
 * project workspace shows the same surface the Index Lab opens with.
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
  })

  const results = useScoreBuilderResults({
    control: previewControl,
    selectedRegionLevel,
    activeMetricDefinitions: SCORE_METRICS,
    regionMetricRows,
    metricRanges,
    metricValueLists,
  })

  const hiddenFillColors = useMemo(() => {
    if (showScoreSurface) return null
    return Object.fromEntries(results.scoredRegions.map((entry) => [entry.region.id, TRANSPARENT_FILL]))
  }, [results.scoredRegions, showScoreSurface])
  const showWalkabilitySourceSurface = showScoreSurface && showsWalkabilitySourceSurface(previewControl)
  // Served from the fetch cache the raster already populated, so this is free
  // whenever the surface it describes is on screen.
  const miBands = useWalkabilityMiBands(showWalkabilitySourceSurface)

  const handleRegionClick = useCallback(() => {}, [])

  const palette = results.scorePaletteProfile

  return (
    <div className={cn('relative overflow-hidden bg-slate-100 dark:bg-slate-950', className)}>
      <ScoreBuilderMap
        regions={results.scoredRegions}
        selectedRegionId={null}
        monitors={points.filteredMonitors}
        showPoints={showPoints}
        onRegionClick={handleRegionClick}
        regionFillColors={hiddenFillColors}
        walkabilitySourceSurface={showWalkabilitySourceSurface}
        sourceGridWeights={previewControl.weights}
        walkabilitySurfaceTuning={previewControl.walkabilitySurfaceTuning}
        loading={datasets.loading}
      />

      <MapLegendPanel title={project.title} width="sm" collapsible>
        <div className="space-y-2">
          {/*
            The score palette only describes the boundary surface. When the
            walkability source raster is drawn instead, the boundary fills are
            transparent, so the legend has to describe the Mobility Index bands
            the raster is actually painted with.
          */}
          {showWalkabilitySourceSurface ? (
            <>
              <MapSteppedLegend
                bands={toWalkabilityMiLegendBands(miBands)}
                labelAngle={project.legendLabelAngle}
              />
              <div className="text-xs leading-snug text-muted-foreground">
                Mobility Index surface derived from the project recipe, over {results.scoredRegions.length.toLocaleString()}{' '}
                scored regions.
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
    </div>
  )
}
