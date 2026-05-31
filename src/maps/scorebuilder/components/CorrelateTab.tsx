import { useMemo, type ReactNode } from 'react'
import { FlipHorizontal } from 'lucide-react'
import { AppSelect } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { SCORE_METRICS_BY_CATEGORY } from '../constants'
import { METRIC_CATEGORY_LABELS, type ScoreMetricKey } from '../types'
import { getMetricLabel } from '../lib/metrics'
import type { CorrelationResult, MetricCorrelation } from '../lib/correlation'

interface CorrelateTabProps {
  correlateMode: boolean
  onToggleCorrelateMode: () => void
  metricX: ScoreMetricKey
  metricY: ScoreMetricKey
  onMetricXChange: (metric: ScoreMetricKey) => void
  onMetricYChange: (metric: ScoreMetricKey) => void
  visStyle: 'bivariate' | 'residual'
  onVisStyleChange: (style: 'bivariate' | 'residual') => void
  result: CorrelationResult
  topPairs: MetricCorrelation[]
  onApplyTopPair: (metricX: ScoreMetricKey, metricY: ScoreMetricKey) => void
}

export function CorrelateTab({
  correlateMode,
  onToggleCorrelateMode,
  metricX,
  metricY,
  onMetricXChange,
  onMetricYChange,
  visStyle,
  onVisStyleChange,
  result,
  topPairs,
  onApplyTopPair,
}: CorrelateTabProps) {
  const metricOptions = useMemo(() => {
    const groups = Object.keys(SCORE_METRICS_BY_CATEGORY)
    const out: Array<{ value: ScoreMetricKey; label: string }> = []
    for (const category of groups) {
      const categoryMetrics = SCORE_METRICS_BY_CATEGORY[category]
      const categoryLabel = METRIC_CATEGORY_LABELS[category as keyof typeof METRIC_CATEGORY_LABELS] ?? category
      for (const metric of categoryMetrics) {
        out.push({ value: metric.key, label: `${categoryLabel} - ${metric.label}` })
      }
    }
    return out.sort((a, b) => a.label.localeCompare(b.label))
  }, [])

  const stats = result.stats
  const xLabel = getMetricLabel(metricX)
  const yLabel = getMetricLabel(metricY)
  const flipAxes = () => {
    onMetricXChange(metricY)
    onMetricYChange(metricX)
  }

  return (
    <div className="space-y-3 p-4" data-score-builder-section="correlate">
      <div className="rounded-lg border border-border bg-muted/20 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-foreground">Correlation mode</div>
            <div className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
              Repaints regions by the relationship between two metrics. The current scoring map is hidden while this is
              on.
            </div>
          </div>
          <button
            type="button"
            onClick={onToggleCorrelateMode}
            aria-pressed={correlateMode}
            className={cn(
              'shrink-0 rounded-md border px-2 py-1 text-xs font-medium transition-colors',
              correlateMode
                ? 'border-cyan-500 bg-cyan-500 text-white hover:bg-cyan-600'
                : 'border-input bg-background text-foreground hover:bg-accent',
            )}
          >
            {correlateMode ? 'On' : 'Off'}
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label className="text-[11px] font-medium text-muted-foreground">Metric X</label>
          <AppSelect
            aria-label="Correlation metric X"
            value={metricX}
            onValueChange={(value) => onMetricXChange(value as ScoreMetricKey)}
            options={metricOptions}
            className="w-56"
            triggerClassName="h-8 rounded text-xs focus:ring-1 focus:ring-cyan-500"
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <label className="text-[11px] font-medium text-muted-foreground">Metric Y</label>
          <AppSelect
            aria-label="Correlation metric Y"
            value={metricY}
            onValueChange={(value) => onMetricYChange(value as ScoreMetricKey)}
            options={metricOptions}
            className="w-56"
            triggerClassName="h-8 rounded text-xs focus:ring-1 focus:ring-cyan-500"
          />
        </div>
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={flipAxes}
            className="inline-flex items-center gap-1 rounded border border-input px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <FlipHorizontal className="h-3 w-3" /> Swap X / Y
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-border p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase text-muted-foreground">Map style</span>
          <div className="inline-flex overflow-hidden rounded border border-input">
            <button
              type="button"
              onClick={() => onVisStyleChange('bivariate')}
              className={cn(
                'px-2 py-1 text-[11px] font-medium transition-colors',
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
                'px-2 py-1 text-[11px] font-medium transition-colors',
                visStyle === 'residual'
                  ? 'bg-cyan-500 text-white'
                  : 'bg-background text-muted-foreground hover:bg-accent',
              )}
            >
              Residual
            </button>
          </div>
        </div>
        <div className="text-[10px] leading-snug text-muted-foreground">
          {visStyle === 'bivariate'
            ? 'Each region is colored by its (X tertile, Y tertile) cell in the 3x3 grid. Top-right of the grid = high on both.'
            : 'Each region is colored by its residual from a least-squares line of Y on X. Red = above the line; blue = below.'}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <StatTile label="Pearson r" value={stats ? stats.pearson.toFixed(2) : '-'} />
        <StatTile label="r2" value={stats ? stats.rSquared.toFixed(2) : '-'} />
        <StatTile label="n" value={stats ? String(stats.n) : '-'} />
      </div>
      {stats && (stats.xMin === stats.xMax || stats.yMin === stats.yMax) && (
        <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] leading-snug text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          {stats.xMin === stats.xMax
            ? `${getMetricLabel(metricX)} has the same value for every region - likely the data source is off in the left panel.`
            : `${getMetricLabel(metricY)} has the same value for every region - likely the data source is off in the left panel.`}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <StatTile label="Spearman" value={stats ? stats.spearman.toFixed(2) : '-'} />
        <StatTile label="Strength" value={stats ? describeStrength(stats.pearson) : '-'} />
      </div>

      <CorrelationScatter result={result} xLabel={xLabel} yLabel={yLabel} active={correlateMode} />

      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">Strongest pairs (|r|)</div>
        {topPairs.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            {correlateMode
              ? 'Computing pairs...'
              : 'Turn correlation mode on to see the strongest pairs across all metrics.'}
          </div>
        ) : (
          <div className="space-y-1">
            {topPairs.map((pair) => (
              <button
                key={`${pair.metricX}-${pair.metricY}`}
                type="button"
                onClick={() => onApplyTopPair(pair.metricX, pair.metricY)}
                className="flex w-full items-center justify-between gap-2 rounded border border-border bg-background px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
              >
                <span className="min-w-0 truncate text-foreground">
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
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold text-foreground">{value}</div>
    </div>
  )
}

function describeStrength(r: number): string {
  const abs = Math.abs(r)
  if (abs < 0.1) return 'None'
  if (abs < 0.3) return 'Weak'
  if (abs < 0.5) return 'Moderate'
  if (abs < 0.7) return 'Strong'
  return 'Very strong'
}

function CorrelationScatter({
  result,
  xLabel,
  yLabel,
  active,
}: {
  result: CorrelationResult
  xLabel: string
  yLabel: string
  active: boolean
}) {
  const { stats, points } = result
  if (!stats || points.length === 0) {
    return (
      <div className="rounded border border-dashed border-border p-4 text-center text-[11px] text-muted-foreground">
        {active
          ? 'No region has finite values for both metrics in the current boundary level.'
          : 'Turn correlation mode on to plot the scatter and load statistics.'}
      </div>
    )
  }

  const width = 280
  const height = 200
  const margin = { top: 10, right: 12, bottom: 26, left: 32 }
  const innerW = width - margin.left - margin.right
  const innerH = height - margin.top - margin.bottom

  const xRange = stats.xMax - stats.xMin || 1
  const yRange = stats.yMax - stats.yMin || 1

  const cellsX = 18
  const cellsY = 14
  const counts = new Map<string, number>()
  let maxCount = 0
  for (const point of points) {
    const cx = Math.min(cellsX - 1, Math.floor(((point.x - stats.xMin) / xRange) * cellsX))
    const cy = Math.min(cellsY - 1, Math.floor(((point.y - stats.yMin) / yRange) * cellsY))
    const key = `${cx},${cy}`
    const next = (counts.get(key) ?? 0) + 1
    counts.set(key, next)
    if (next > maxCount) maxCount = next
  }
  const cellW = innerW / cellsX
  const cellH = innerH / cellsY

  const lineX0 = stats.xMin
  const lineX1 = stats.xMax
  const lineY0 = stats.slope * lineX0 + stats.intercept
  const lineY1 = stats.slope * lineX1 + stats.intercept

  const xAt = (xValue: number) => margin.left + ((xValue - stats.xMin) / xRange) * innerW
  const yAt = (yValue: number) => margin.top + innerH - ((yValue - stats.yMin) / yRange) * innerH

  const cells: JSX.Element[] = []
  for (const [key, count] of counts) {
    const [cx, cy] = key.split(',').map(Number)
    const intensity = Math.max(0, Math.min(1, count / maxCount))
    const fill = `rgba(8, 145, 178, ${0.15 + 0.7 * intensity})`
    cells.push(
      <rect
        key={key}
        x={margin.left + cx * cellW}
        y={margin.top + innerH - (cy + 1) * cellH}
        width={cellW}
        height={cellH}
        fill={fill}
      />,
    )
  }

  return (
    <div className="rounded border border-border bg-background p-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label={`Scatter density for ${xLabel} vs ${yLabel}`}
      >
        <rect x={margin.left} y={margin.top} width={innerW} height={innerH} fill="hsl(var(--muted))" opacity={0.25} />
        {cells}
        <line
          x1={xAt(lineX0)}
          y1={yAt(lineY0)}
          x2={xAt(lineX1)}
          y2={yAt(lineY1)}
          stroke="#0f172a"
          strokeWidth={1.25}
          strokeDasharray="3 3"
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
      <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Cells shaded by region count - dashed line = least-squares fit</span>
        <span>{points.length} regions</span>
      </div>
    </div>
  )
}
