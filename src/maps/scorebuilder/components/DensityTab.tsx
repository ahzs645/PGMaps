import { AppSelect } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { DENSITY_METRIC_OPTIONS } from '../constants'
import type { ScoredBoundaryRegion, ScoreMetricKey } from '../types'
import { formatMetricValue, getMetricDescription, getMetricLabel } from '../lib/metrics'

interface DensityTabProps {
  className?: string
  densityMetric: ScoreMetricKey
  onDensityMetricChange: (metric: ScoreMetricKey) => void
  densitySummary: { min: number; max: number; median: number; average: number } | null
  densityLeaders: ScoredBoundaryRegion[]
  selectedRegion: ScoredBoundaryRegion | null
  onRegionSelect: (regionId: string) => void
}

export function DensityTab({
  className,
  densityMetric,
  onDensityMetricChange,
  densitySummary,
  densityLeaders,
  selectedRegion,
  onRegionSelect,
}: DensityTabProps) {
  return (
    <div className={cn('space-y-2', className)} data-score-builder-section="density">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor="score-builder-density" className="text-xs font-medium text-muted-foreground">
          Heat-map metric
        </label>
        <AppSelect
          id="score-builder-density"
          aria-label="Density metric"
          value={densityMetric}
          onValueChange={(value) => onDensityMetricChange(value as ScoreMetricKey)}
          options={DENSITY_METRIC_OPTIONS.map((metric) => ({ value: metric, label: getMetricLabel(metric) }))}
          className="w-44"
          triggerClassName="h-8 rounded text-xs focus:ring-1 focus:ring-cyan-500"
        />
      </div>

      {densitySummary ? (
        <>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {(['median', 'average', 'min', 'max'] as const).map((stat) => (
              <div key={stat} className="rounded border border-border bg-muted/30 p-2">
                <div className="text-xs capitalize text-muted-foreground">{stat}</div>
                <div className="font-semibold text-foreground">
                  {formatMetricValue(densityMetric, densitySummary[stat], true)}
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-1">
            {densityLeaders.map((entry) => (
              <button
                key={`density-${entry.region.id}`}
                onClick={() => onRegionSelect(entry.region.id)}
                className={cn(
                  'flex w-full items-center justify-between rounded border border-border bg-background px-2 py-1.5 text-xs transition-colors hover:bg-accent',
                  selectedRegion?.region.id === entry.region.id && 'bg-cyan-50 dark:bg-cyan-950/40',
                )}
              >
                <span className="truncate text-left text-foreground">{entry.region.name}</span>
                <span className="font-medium text-cyan-700 dark:text-cyan-300">
                  {formatMetricValue(densityMetric, entry.metrics[densityMetric], true)}
                </span>
              </button>
            ))}
          </div>
          <div className="text-xs text-muted-foreground">{getMetricDescription(densityMetric)}</div>
        </>
      ) : (
        <div className="text-xs text-muted-foreground">No values available for this density lens.</div>
      )}
    </div>
  )
}
