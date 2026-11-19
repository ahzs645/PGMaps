import { useMemo } from 'react'
import type { CorrelationPoint } from '../lib/correlation'
import type { MapImageLegend } from '../lib/exportRegions'
import type { CorrelateClusterVariable, CorrelateVisStyle, ScoreLabKind } from '../lib/labs'
import { getMetricLabel } from '../lib/metrics'
import type { RegionMetricRow } from '../lib/scoring'
import {
  CLUSTER_COLORS,
  CLUSTER_LABELS,
  CLUSTER_MAP_CLASSES,
  clusterExportColumns,
  clusterFillColors,
  clusterMapCounts,
} from '../lib/spatialPatternView'
import type { ScoredBoundaryRegion, ScoreBuilderRegion, ScoreMetricKey } from '../types'
import { useSpatialPattern, type SpatialObservation } from './useSpatialPattern'

export interface LabSpatialPatternOptions {
  lab: ScoreLabKind
  /** Every region of the study area: the contiguity graph is built from these once. */
  regions: readonly ScoreBuilderRegion[]
  regionMetricRows: RegionMetricRow[]
  /** The regions the map draws, in the Index Lab with their scores. */
  scoredRegions: ScoredBoundaryRegion[]
  correlationPoints: CorrelationPoint[]
  densityMetric: ScoreMetricKey
  correlateMetricX: ScoreMetricKey
  correlateMetricY: ScoreMetricKey
  correlateVisStyle: CorrelateVisStyle
  correlateClusterVariable: CorrelateClusterVariable
  clusterMap: boolean
  clusterFdr: boolean
  /** The Spatial pattern section is open, so its figures are wanted even with the map on values. */
  panelOpen: boolean
  /** False while the Index Lab shows the walkability source grid, which has no regions. */
  boundarySurface: boolean
}

function metricObservations(rows: RegionMetricRow[], metric: ScoreMetricKey): SpatialObservation[] {
  return rows.map((row) => ({ id: row.region.id, value: row.metrics[metric] }))
}

/**
 * The spatial pattern of whatever the lab maps: the Index Lab's score, the Density Lab's
 * metric, or the Correlation Lab's chosen variable, plus the Moran's I of the Correlation
 * Lab's residuals. Everything is computed once per change of its inputs, outside the
 * scoring passes, and only while something shows it.
 */
export function useLabSpatialPattern(options: LabSpatialPatternOptions) {
  const {
    lab,
    regions,
    regionMetricRows,
    scoredRegions,
    correlationPoints,
    densityMetric,
    correlateMetricX,
    correlateMetricY,
    correlateVisStyle,
    correlateClusterVariable,
    clusterMap,
    clusterFdr,
    panelOpen,
    boundarySurface,
  } = options

  const clusterShown = boundarySurface && (lab === 'correlate' ? correlateVisStyle === 'clusters' : clusterMap)

  const variable = useMemo<{ label: string; observations: SpatialObservation[] }>(() => {
    if (lab === 'index') {
      return {
        label: 'Index score',
        observations: scoredRegions.map((entry) => ({ id: entry.region.id, value: entry.score })),
      }
    }
    if (lab === 'density') {
      return { label: getMetricLabel(densityMetric), observations: metricObservations(regionMetricRows, densityMetric) }
    }
    if (correlateClusterVariable === 'residual') {
      return {
        label: `Residual of ${getMetricLabel(correlateMetricY)}`,
        observations: correlationPoints.map((point) => ({ id: point.regionId, value: point.residual })),
      }
    }
    const metric = correlateClusterVariable === 'x' ? correlateMetricX : correlateMetricY
    return { label: getMetricLabel(metric), observations: metricObservations(regionMetricRows, metric) }
  }, [
    correlateClusterVariable,
    correlateMetricX,
    correlateMetricY,
    correlationPoints,
    densityMetric,
    lab,
    regionMetricRows,
    scoredRegions,
  ])

  const summary = useSpatialPattern({
    regions,
    observations: variable.observations,
    enabled: boundarySurface && (clusterShown || panelOpen),
    local: true,
    fdr: clusterFdr,
  })

  const residualObservations = useMemo<SpatialObservation[] | null>(
    () =>
      lab === 'correlate' ? correlationPoints.map((point) => ({ id: point.regionId, value: point.residual })) : null,
    [correlationPoints, lab],
  )
  const residualSummary = useSpatialPattern({
    regions,
    observations: residualObservations,
    enabled: lab === 'correlate',
    local: false,
    fdr: false,
  })

  const drawnIds = useMemo(() => scoredRegions.map((entry) => entry.region.id), [scoredRegions])
  const clusterById = summary?.clusterById
  const map = useMemo(() => {
    if (!clusterShown) return null
    // Until the run is in, or when it cannot run, every region reads as not analysed.
    const byId = clusterById ?? new Map()
    return { fillColors: clusterFillColors(drawnIds, byId), counts: clusterMapCounts(drawnIds, byId) }
  }, [clusterById, clusterShown, drawnIds])

  const imageLegend = useMemo<MapImageLegend | null>(() => {
    if (!map) return null
    return {
      kind: 'categories',
      title: `Clusters: ${variable.label}`,
      items: CLUSTER_MAP_CLASSES.filter((cluster) => cluster !== 'none' || map.counts.none > 0).map((cluster) => ({
        color: CLUSTER_COLORS[cluster],
        label: `${CLUSTER_LABELS[cluster]} (${map.counts[cluster]})`,
      })),
      note: `PGMaps-derived local Moran · ${clusterFdr ? '5% FDR' : 'p ≤ 0.05'}`,
    }
  }, [clusterFdr, map, variable.label])

  const legend = useMemo(
    () => (map ? { variableLabel: variable.label, counts: map.counts, fdr: clusterFdr } : null),
    [clusterFdr, map, variable.label],
  )
  const exportColumns = useMemo(
    () => (map && summary ? clusterExportColumns(summary, variable.label) : null),
    [map, summary, variable.label],
  )

  return {
    variableLabel: variable.label,
    summary,
    residualPattern: residualSummary?.global ?? null,
    clusterShown,
    fillColors: map?.fillColors ?? null,
    mapCounts: map?.counts ?? null,
    legend,
    imageLegend,
    exportColumns,
  }
}
