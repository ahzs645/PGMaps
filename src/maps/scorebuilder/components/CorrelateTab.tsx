import { useMemo, useState, type ReactNode } from 'react'
import { FlipHorizontal } from 'lucide-react'
import { InlineAlert } from '@/components/ui/map-panels'
import { EmptyHint } from '@/components/ui/result-list'
import { AppSelect } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { BoundarySource, RegionLevel } from '@/maps/airquality'
import { SCORE_METRICS_BY_CATEGORY } from '../constants'
import { METRIC_CATEGORY_LABELS, type ScoreMetricKey } from '../types'
import { formatMetricValue, getMetricLabel, isMetricAvailableOnBoundary } from '../lib/metrics'
import { describeAssociation, type CorrelationResult, type MetricCorrelation } from '../lib/correlation'

interface CorrelateTabProps {
  className?: string
  metricX: ScoreMetricKey
  metricY: ScoreMetricKey
  onMetricXChange: (metric: ScoreMetricKey) => void
  onMetricYChange: (metric: ScoreMetricKey) => void
  visStyle: 'bivariate' | 'residual'
  onVisStyleChange: (style: 'bivariate' | 'residual') => void
  result: CorrelationResult
  topPairs: MetricCorrelation[]
  onApplyTopPair: (metricX: ScoreMetricKey, metricY: ScoreMetricKey) => void
  boundarySource: BoundarySource
  regionLevel: RegionLevel
  selectedRegionId: string | null
  onRegionSelect: (regionId: string) => void
}

export function CorrelateTab({
  className,
  metricX,
  metricY,
  onMetricXChange,
  onMetricYChange,
  visStyle,
  onVisStyleChange,
  result,
  topPairs,
  onApplyTopPair,
  boundarySource,
  regionLevel,
  selectedRegionId,
  onRegionSelect,
}: CorrelateTabProps) {
  const metricOptions = useMemo(() => {
    const groups = Object.keys(SCORE_METRICS_BY_CATEGORY)
    const out: Array<{ value: ScoreMetricKey; label: string; disabled?: boolean; title?: string }> = []
    for (const category of groups) {
      const categoryMetrics = SCORE_METRICS_BY_CATEGORY[category]
      const categoryLabel = METRIC_CATEGORY_LABELS[category as keyof typeof METRIC_CATEGORY_LABELS] ?? category
      for (const metric of categoryMetrics) {
        const available = isMetricAvailableOnBoundary(metric, boundarySource, regionLevel)
        out.push({
          value: metric.key,
          label: `${categoryLabel} - ${metric.label}`,
          disabled: !available,
          title: available ? undefined : metric.boundaryRequirementLabel,
        })
      }
    }
    return out.sort((a, b) => a.label.localeCompare(b.label))
  }, [boundarySource, regionLevel])

  const stats = result.stats
  const association = stats ? describeAssociation(stats.pearson, stats.spearman) : null
  const flipAxes = () => {
    onMetricXChange(metricY)
    onMetricYChange(metricX)
  }

  return (
    <div className={cn('space-y-3', className)} data-score-builder-section="correlate">
      <div className="space-y-2">
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">Metric X</div>
          <AppSelect
            triggerAriaLabel="Correlation metric X"
            value={metricX}
            onValueChange={(value) => onMetricXChange(value as ScoreMetricKey)}
            options={metricOptions}
            triggerClassName="h-8 rounded text-xs focus:ring-1 focus:ring-cyan-500"
          />
        </div>
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">Metric Y</div>
          <AppSelect
            triggerAriaLabel="Correlation metric Y"
            value={metricY}
            onValueChange={(value) => onMetricYChange(value as ScoreMetricKey)}
            options={metricOptions}
            triggerClassName="h-8 rounded text-xs focus:ring-1 focus:ring-cyan-500"
          />
        </div>
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={flipAxes}
            className="inline-flex items-center gap-1 rounded border border-input px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <FlipHorizontal className="h-3 w-3" /> Swap X / Y
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-border p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase text-muted-foreground">Map style</span>
          <div className="inline-flex overflow-hidden rounded border border-input">
            <button
              type="button"
              onClick={() => onVisStyleChange('bivariate')}
              className={cn(
                'px-2 py-1 text-xs font-medium transition-colors',
                visStyle === 'bivariate'
                  ? 'bg-cyan-500 text-white'
                  : 'bg-background text-muted-foreground hover:bg-accent',
              )}
            >
              Bivariate
            </button>
            <button
              type="button"
              onClick={() => onVisStyleChange('residual')}
              className={cn(
                'px-2 py-1 text-xs font-medium transition-colors',
                visStyle === 'residual'
                  ? 'bg-cyan-500 text-white'
                  : 'bg-background text-muted-foreground hover:bg-accent',
              )}
            >
              Residual
            </button>
          </div>
        </div>
        <div className="text-xs leading-snug text-muted-foreground">
          {visStyle === 'bivariate'
            ? 'Each region is colored by its (X tertile, Y tertile) cell in the 3x3 grid. Top-right of the grid = high on both.'
            : 'Each region is colored by its residual from a least-squares line of Y on X. Red = above the line; blue = below. Color tops out at the 90th percentile so outliers do not wash out the rest.'}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <StatTile label="Pearson r" value={stats ? stats.pearson.toFixed(2) : '-'} />
        <StatTile label="r2" value={stats ? stats.rSquared.toFixed(2) : '-'} />
        <StatTile label="n" value={stats ? String(stats.n) : '-'} />
      </div>
      {stats && (stats.xMin === stats.xMax || stats.yMin === stats.yMax) && (
        <InlineAlert tone="warning" className="leading-snug">
          {`${getMetricLabel(stats.xMin === stats.xMax ? metricX : metricY)} has the same value in every region of this study area, so a correlation cannot be measured.`}
        </InlineAlert>
      )}
      <div className="grid grid-cols-2 gap-2">
        <StatTile label="Spearman" value={stats ? stats.spearman.toFixed(2) : '-'} />
        <StatTile label="Strength" value={association?.strength ?? '-'} />
      </div>
      {association?.note && (
        <InlineAlert tone="info" className="leading-snug">
          {association.note}
        </InlineAlert>
      )}

      <CorrelationScatter
        result={result}
        metricX={metricX}
        metricY={metricY}
        selectedRegionId={selectedRegionId}
        onRegionSelect={onRegionSelect}
      />

      <div>
        <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Strongest pairs across topics</div>
        {topPairs.length === 0 ? (
          <div className="text-xs text-muted-foreground">Computing pairs...</div>
        ) : (
          <div className="space-y-1">
            {topPairs.map((pair) => (
              <button
                key={`${pair.metricX}-${pair.metricY}`}
                type="button"
                onClick={() => onApplyTopPair(pair.metricX, pair.metricY)}
                className="flex w-full items-center justify-between gap-2 rounded border border-border bg-background px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
              >
                <span className="line-clamp-2 min-w-0 text-foreground">
                  {getMetricLabel(pair.metricX)} <span className="text-muted-foreground">x</span>{' '}
                  {getMetricLabel(pair.metricY)}
                </span>
                <span
                  className={cn(
                    'shrink-0 font-medium',
                    pair.pearson >= 0 ? 'text-cyan-700 dark:text-cyan-300' : 'text-rose-700 dark:text-rose-300',
                  )}
                >
                  {pair.pearson.toFixed(2)} - n={pair.n}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StatTile({ label, value }: { label: ReactNode; value: string }) {
  return (
    <div className="rounded border border-border bg-muted/20 p-2">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold text-foreground">{value}</div>
    </div>
  )
}

function CorrelationScatter({
  result,
  metricX,
  metricY,
  selectedRegionId,
  onRegionSelect,
}: {
  result: CorrelationResult
  metricX: ScoreMetricKey
  metricY: ScoreMetricKey
  selectedRegionId: string | null
  onRegionSelect: (regionId: string) => void
}) {
  const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null)
  const { stats, points } = result
  if (!stats || points.length === 0) {
    return <EmptyHint>No region has finite values for both metrics in the current boundary level.</EmptyHint>
  }

  const xLabel = getMetricLabel(metricX)
  const yLabel = getMetricLabel(metricY)
  const width = 280
  const height = 210
  const margin = { top: 10, right: 12, bottom: 38, left: 34 }
  const innerW = width - margin.left - margin.right
  const innerH = height - margin.top - margin.bottom
  const xRange = stats.xMax - stats.xMin || 1
  const yRange = stats.yMax - stats.yMin || 1
  const xAt = (xValue: number) => margin.left + ((xValue - stats.xMin) / xRange) * innerW
  const yAt = (yValue: number) => margin.top + innerH - ((yValue - stats.yMin) / yRange) * innerH

  const describe = (point: (typeof points)[number]) =>
    `${point.regionName}: ${formatMetricValue(metricX, point.x, true)} × ${formatMetricValue(metricY, point.y, true)}`
  const focused =
    points.find((point) => point.regionId === hoveredRegionId) ??
    points.find((point) => point.regionId === selectedRegionId)
  // Dots shrink and lighten as they crowd; a spare invisible target keeps them tappable.
  const dense = points.length > 150
  const dotRadius = dense ? 2 : 3.5
  const hitRadius = points.length > 600 ? dotRadius : 9

  return (
    <div className="rounded border border-border bg-background p-2 text-foreground">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label={`Scatter plot of ${xLabel} against ${yLabel}, one dot per region`}
        onPointerLeave={() => setHoveredRegionId(null)}
      >
        <rect x={margin.left} y={margin.top} width={innerW} height={innerH} fill="hsl(var(--muted))" opacity={0.25} />
        <line
          x1={xAt(stats.xMin)}
          y1={yAt(stats.slope * stats.xMin + stats.intercept)}
          x2={xAt(stats.xMax)}
          y2={yAt(stats.slope * stats.xMax + stats.intercept)}
          stroke="currentColor"
          strokeWidth={1.25}
          strokeDasharray="3 3"
          opacity={0.7}
        />
        <line
          x1={margin.left}
          y1={margin.top + innerH}
          x2={margin.left + innerW}
          y2={margin.top + innerH}
          stroke="currentColor"
          strokeWidth={0.75}
          opacity={0.4}
        />
        <line
          x1={margin.left}
          y1={margin.top}
          x2={margin.left}
          y2={margin.top + innerH}
          stroke="currentColor"
          strokeWidth={0.75}
          opacity={0.4}
        />
        {points.map((point) => {
          const isFocused = point.regionId === focused?.regionId
          return (
            <g
              key={point.regionId}
              className="cursor-pointer"
              onPointerEnter={() => setHoveredRegionId(point.regionId)}
              onClick={() => onRegionSelect(point.regionId)}
            >
              <title>{describe(point)}</title>
              <circle cx={xAt(point.x)} cy={yAt(point.y)} r={hitRadius} fill="transparent" />
              <circle
                cx={xAt(point.x)}
                cy={yAt(point.y)}
                r={isFocused ? dotRadius + 2 : dotRadius}
                className="fill-cyan-600 dark:fill-cyan-400"
                fillOpacity={isFocused ? 1 : dense ? 0.45 : 0.7}
                stroke={isFocused ? 'currentColor' : 'none'}
                strokeWidth={1.25}
              />
            </g>
          )
        })}
        <g fontSize={9} fill="currentColor" opacity={0.65}>
          <text x={margin.left} y={margin.top + innerH + 11}>
            {formatMetricValue(metricX, stats.xMin, true)}
          </text>
          <text x={margin.left + innerW} y={margin.top + innerH + 11} textAnchor="end">
            {formatMetricValue(metricX, stats.xMax, true)}
          </text>
        </g>
        <text
          x={margin.left + innerW / 2}
          y={height - 6}
          textAnchor="middle"
          fontSize={10}
          fill="currentColor"
          opacity={0.7}
        >
          {xLabel}
        </text>
        <text
          x={-margin.top - innerH / 2}
          y={11}
          textAnchor="middle"
          fontSize={10}
          fill="currentColor"
          opacity={0.7}
          transform="rotate(-90)"
        >
          {yLabel}
        </text>
      </svg>
      <div className="mt-1 min-h-8 text-xs leading-4 text-muted-foreground" data-correlation-readout="true">
        {focused ? (
          <span className="font-medium text-foreground">{describe(focused)}</span>
        ) : (
          `Each dot is a region: hover or tap to name it. Dashed line = least-squares fit. ${points.length} regions.`
        )}
      </div>
    </div>
  )
}
