import { useClipboardText } from '@/hooks/useClipboardText'
import { useMemo, useState } from 'react'
import { Check, Copy, X } from 'lucide-react'
import { StudyAreaSelector } from '@/components/StudyAreaSelector'
import { CollapsibleSection, InlineAlert } from '@/components/ui/map-panels'
import { DEFAULT_LOCALE } from '@/lib/format'
import { cn } from '@/lib/utils'
import { getLevelOptionsForSource } from '@/lib/studyArea'
import type { BoundarySource, RegionLevel } from '@/maps/airquality'
import { SCORE_BUILDER_BOUNDARY_SOURCE_OPTIONS } from '../constants'
import type {
  ScoreDataSource,
  ScoredBoundaryRegion,
  ScoreMetricDefinition,
  ScoreMetricKey,
  ScoreMetricWeightMap,
} from '../types'
import type { CorrelationResult, MetricCorrelation } from '../lib/correlation'
import { getScoreLab } from '../lib/labs'
import { formatMetricValue, getMetricLabel, getUnavailableWeightedMetrics } from '../lib/metrics'
import { CorrelateTab } from './CorrelateTab'
import { DataSourceToggleList } from './DataSourceToggleList'
import { DensityTab } from './DensityTab'
import { InactiveTermNotice } from './WeightRow'

interface DensityLensProps {
  lab: 'density'
  densityMetric: ScoreMetricKey
  onDensityMetricChange: (metric: ScoreMetricKey) => void
  densitySummary: { min: number; max: number; median: number; average: number } | null
  densityLeaders: ScoredBoundaryRegion[]
}

interface CorrelateLensProps {
  lab: 'correlate'
  correlateMetricX: ScoreMetricKey
  correlateMetricY: ScoreMetricKey
  onCorrelateMetricXChange: (metric: ScoreMetricKey) => void
  onCorrelateMetricYChange: (metric: ScoreMetricKey) => void
  correlateVisStyle: 'bivariate' | 'residual'
  onCorrelateVisStyleChange: (style: 'bivariate' | 'residual') => void
  correlationResult: CorrelationResult
  correlationTopPairs: MetricCorrelation[]
  onApplyTopPair: (metricX: ScoreMetricKey, metricY: ScoreMetricKey) => void
}

type LensLabSidebarProps = (DensityLensProps | CorrelateLensProps) & {
  className?: string
  /** The desktop header already describes the lab; the phone sheet has no header, so it does. */
  showDescription?: boolean
  dataErrors: string[]
  regionCount: number
  metrics: ScoreMetricDefinition[]
  boundarySource: BoundarySource
  onBoundarySourceChange: (source: BoundarySource) => void
  selectedRegionLevel: RegionLevel
  onRegionLevelChange: (level: RegionLevel) => void
  boundaryLevelOptions: Array<{ value: RegionLevel; label: string }>
  enabledDataSources: ScoreDataSource[]
  onToggleDataSource: (source: ScoreDataSource) => void
  onEnableDataSource: (source: ScoreDataSource) => void
  showPoints: boolean
  onTogglePoints: () => void
  selectedRegion: ScoredBoundaryRegion | null
  onRegionSelect: (regionId: string) => void
  onClearRegionSelection: () => void
}

/**
 * The one sidebar of the Density and Correlation labs, on desktop and in the phone
 * sheet: the lens controls first, then the selected region's lens values, then the
 * study area and the data sources the lens metrics draw on. There is no equation here;
 * the Index Lab owns weighting.
 */
export function LensLabSidebar(props: LensLabSidebarProps) {
  const {
    className,
    showDescription = false,
    dataErrors,
    regionCount,
    metrics,
    boundarySource,
    onBoundarySourceChange,
    selectedRegionLevel,
    onRegionLevelChange,
    boundaryLevelOptions,
    enabledDataSources,
    onToggleDataSource,
    onEnableDataSource,
    showPoints,
    onTogglePoints,
    selectedRegion,
    onRegionSelect,
    onClearRegionSelection,
  } = props
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const { copy, status: copyStatus } = useClipboardText({ failureResetAfterMs: 1800 })
  const enabledSourceSet = useMemo(() => new Set(enabledDataSources), [enabledDataSources])

  const primaryMetric = props.lab === 'density' ? props.densityMetric : props.correlateMetricX
  const secondaryMetric = props.lab === 'correlate' ? props.correlateMetricY : null
  const lensMetrics = useMemo<ScoreMetricKey[]>(
    () => (secondaryMetric ? [primaryMetric, secondaryMetric] : [primaryMetric]),
    [primaryMetric, secondaryMetric],
  )
  // The lens metrics stand in for the equation: a source they need that is switched off
  // is flagged the same way an orphaned weighted term is in the Index Lab.
  const unavailableTerms = useMemo(() => {
    const lensWeights = Object.fromEntries(lensMetrics.map((metric) => [metric, 1])) as ScoreMetricWeightMap
    return getUnavailableWeightedMetrics(metrics, lensWeights, enabledDataSources, boundarySource)
  }, [boundarySource, enabledDataSources, lensMetrics, metrics])

  const handleCopyLink = () => {
    void copy(window.location.href)
  }

  return (
    <div
      className={cn('flex h-full min-h-0 w-full flex-col overflow-hidden bg-background', className)}
      data-score-lab-sidebar={props.lab}
    >
      <div className="flex-1 min-h-0 overflow-y-auto" data-score-builder-scroll="true">
        <div className="border-b border-border px-4 py-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              {showDescription && (
                <p className="mb-1 text-xs leading-snug text-muted-foreground">{getScoreLab(props.lab).description}</p>
              )}
              <div className="text-xs text-muted-foreground">{regionCount.toLocaleString(DEFAULT_LOCALE)} regions</div>
            </div>
            <button
              type="button"
              disabled={copyStatus === 'pending'}
              onClick={handleCopyLink}
              className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md border border-input px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Copy link to this view"
            >
              {copyStatus === 'copied' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copyStatus === 'copied' ? 'Copied' : copyStatus === 'failed' ? 'Failed' : 'Link'}
            </button>
          </div>
        </div>

        {dataErrors.length > 0 && (
          <InlineAlert tone="error" title="Some data could not load" className="m-4 p-3">
            {dataErrors.map((err, i) => (
              <p key={i}>{err}</p>
            ))}
          </InlineAlert>
        )}

        {unavailableTerms.size > 0 && (
          <div className="space-y-1 px-4 pt-3">
            {[...unavailableTerms].map(([key, unavailable]) => {
              const metric = metrics.find((entry) => entry.key === key)
              if (!metric) return null
              return (
                <InactiveTermNotice
                  key={key}
                  metric={metric}
                  unavailable={unavailable}
                  onEnableDataSource={onEnableDataSource}
                />
              )
            })}
          </div>
        )}

        <section className="border-b border-border" data-score-builder-lens-panel={props.lab}>
          {props.lab === 'density' ? (
            <DensityTab
              className="p-4"
              densityMetric={props.densityMetric}
              onDensityMetricChange={props.onDensityMetricChange}
              densitySummary={props.densitySummary}
              densityLeaders={props.densityLeaders}
              selectedRegion={selectedRegion}
              onRegionSelect={onRegionSelect}
            />
          ) : (
            <CorrelateTab
              className="p-4"
              metricX={props.correlateMetricX}
              metricY={props.correlateMetricY}
              onMetricXChange={props.onCorrelateMetricXChange}
              onMetricYChange={props.onCorrelateMetricYChange}
              visStyle={props.correlateVisStyle}
              onVisStyleChange={props.onCorrelateVisStyleChange}
              result={props.correlationResult}
              topPairs={props.correlationTopPairs}
              onApplyTopPair={props.onApplyTopPair}
            />
          )}
        </section>

        {selectedRegion && (
          <section className="border-b border-border px-4 py-3" data-score-lab-selected-region="true">
            <div className="flex items-start justify-between gap-2">
              <h3 className="min-w-0 truncate text-sm font-semibold text-foreground">{selectedRegion.region.name}</h3>
              <button
                type="button"
                onClick={onClearRegionSelection}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Clear selected region"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <dl className="mt-1 space-y-1 text-xs">
              {lensMetrics.map((metric) => (
                <div key={metric} className="flex items-center justify-between gap-3">
                  <dt className="min-w-0 truncate text-muted-foreground">{getMetricLabel(metric)}</dt>
                  <dd className="shrink-0 font-medium text-foreground">
                    {formatMetricValue(metric, selectedRegion.metrics[metric], true)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        <StudyAreaSelector<BoundarySource, RegionLevel>
          source={boundarySource}
          sourceOptions={SCORE_BUILDER_BOUNDARY_SOURCE_OPTIONS}
          level={selectedRegionLevel}
          levelOptions={boundaryLevelOptions}
          levelOptionsForSource={getLevelOptionsForSource}
          onSourceChange={(source) => {
            onBoundarySourceChange(source)
            onClearRegionSelection()
          }}
          onLevelChange={(level) => {
            onRegionLevelChange(level)
            onClearRegionSelection()
          }}
          title="Study area"
          levelSelectId="score-lab-level"
          dataPrefix="score-builder"
        />

        <div className="pb-4" data-score-builder-section="dataSources">
          <CollapsibleSection
            open={sourcesOpen}
            onOpenChange={setSourcesOpen}
            label={<span className="text-sm font-semibold">Data sources</span>}
            summary={`${enabledDataSources.length} on`}
            className="bg-transparent px-1"
            contentClassName="px-3 pb-4"
          >
            <DataSourceToggleList
              enabledSources={enabledSourceSet}
              onToggleDataSource={onToggleDataSource}
              showPoints={showPoints}
              onTogglePoints={onTogglePoints}
              unavailableTerms={unavailableTerms}
            />
          </CollapsibleSection>
        </div>
      </div>
    </div>
  )
}
