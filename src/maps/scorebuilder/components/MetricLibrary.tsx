import type { ComponentProps } from 'react'
import {
  MetricLibraryRows as ToolkitMetricLibraryRows,
  MetricLibraryPanel as ToolkitMetricLibraryPanel,
  MetricPickerDialog as ToolkitMetricPickerDialog,
  useMetricLibraryGroups as useToolkitMetricLibraryGroups,
} from '@pgmaps/geo-toolkit/index-lab/MetricLibrary'
import type { IndexLabMetric } from '@pgmaps/geo-toolkit/index-lab/types'
import type { BoundarySource } from '@/lib/studyArea'
import { SCORE_METRICS } from '../constants'
import { isMetricAvailableOnBoundary } from '../lib/metrics'
import { METRIC_CATEGORY_LABELS, type ScoreMetricDefinition, type ScoreMetricKey } from '../types'
import { getDefaultMetricWeight } from './scoreBuilderPanelUtils'

export interface MetricLibraryGroup {
  category: string
  metrics: ScoreMetricDefinition[]
}

function catalogOptions(metrics: ScoreMetricDefinition[], boundarySource: BoundarySource) {
  return {
    categoryLabels: METRIC_CATEGORY_LABELS,
    categoryOrder: Object.keys(METRIC_CATEGORY_LABELS),
    getDefaultWeight: getDefaultMetricWeight,
    getUnavailableReason: (metric: IndexLabMetric<ScoreMetricKey>) => {
      const definition = metrics.find((entry) => entry.key === metric.key)
      return definition && !isMetricAvailableOnBoundary(definition, boundarySource)
        ? (definition.boundaryRequirementLabel ?? 'Not populated on the current study area.')
        : null
    },
  }
}

export function useMetricLibraryGroups(metrics: ScoreMetricDefinition[], query: string): MetricLibraryGroup[] {
  const groups = useToolkitMetricLibraryGroups(metrics, query, Object.keys(METRIC_CATEGORY_LABELS))
  return groups.map((group) => ({
    category: group.category,
    metrics: group.metrics.map((metric) => metrics.find((entry) => entry.key === metric.key)!),
  }))
}

export function MetricLibraryRows({
  boundarySource,
  metrics,
  ...props
}: ComponentProps<typeof ToolkitMetricLibraryRows<ScoreMetricKey>> & {
  boundarySource: BoundarySource
  metrics: ScoreMetricDefinition[]
}) {
  return <ToolkitMetricLibraryRows {...props} metrics={metrics} {...catalogOptions(metrics, boundarySource)} />
}

export function MetricLibraryPanel({
  boundarySource,
  metrics = SCORE_METRICS,
  ...props
}: Omit<ComponentProps<typeof ToolkitMetricLibraryPanel<ScoreMetricKey>>, 'metrics'> & {
  boundarySource: BoundarySource
  metrics?: ScoreMetricDefinition[]
}) {
  return <ToolkitMetricLibraryPanel {...props} metrics={metrics} {...catalogOptions(metrics, boundarySource)} />
}

export function MetricPickerDialog({
  boundarySource,
  metrics = SCORE_METRICS,
  ...props
}: Omit<ComponentProps<typeof ToolkitMetricPickerDialog<ScoreMetricKey>>, 'metrics'> & {
  boundarySource: BoundarySource
  metrics?: ScoreMetricDefinition[]
}) {
  return <ToolkitMetricPickerDialog {...props} metrics={metrics} {...catalogOptions(metrics, boundarySource)} />
}
