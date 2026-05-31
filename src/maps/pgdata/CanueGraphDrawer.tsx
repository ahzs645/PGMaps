import { BarChart3, X } from 'lucide-react'
import { MobileFeatureCard } from '@/components/ui/mobile-feature-card'
import { cn } from '@/lib/utils'
import { formatNullableNumber } from './shared'
import type { CanueAggregateRow } from './canueV2Aggregates'
import type { CanueBoundaryFeatureCardData } from './canueCore'

export interface CanueGraphVariableOption {
  key: string
  label: string
}

interface CanueGraphPoint {
  id: string
  name: string
  value: number
}

interface CanueGraphSeries {
  key: string
  label: string
  color: string
  points: CanueGraphPoint[]
  min: number
  max: number
  mean: number
}

const CANUE_GRAPH_COLORS = ['#0891b2', '#ea580c', '#16a34a', '#7c3aed']

function makeCanueGraphSeries(rows: CanueAggregateRow[], variables: CanueGraphVariableOption[]): CanueGraphSeries[] {
  return variables
    .map((variable, index) => {
      const points = rows.flatMap((row) => {
        const value = Number(row.values[variable.key])
        if (!Number.isFinite(value)) return []
        return [
          {
            id: row.boundaryId,
            name: row.boundaryName,
            value,
          },
        ]
      })
      const values = points.map((point) => point.value)
      const min = Math.min(...values)
      const max = Math.max(...values)
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length
      return {
        key: variable.key,
        label: variable.label,
        color: CANUE_GRAPH_COLORS[index % CANUE_GRAPH_COLORS.length],
        points,
        min,
        max,
        mean,
      }
    })
    .filter((series) => series.points.length > 0 && Number.isFinite(series.min) && Number.isFinite(series.max))
}

function makeHistogram(values: number[], min: number, max: number, bucketCount = 10) {
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    index,
    count: 0,
    start: min,
    end: max,
  }))
  if (!values.length) return buckets
  if (min === max) {
    buckets[0].count = values.length
    return buckets
  }
  const span = max - min
  for (const value of values) {
    const bucketIndex = Math.min(bucketCount - 1, Math.max(0, Math.floor(((value - min) / span) * bucketCount)))
    buckets[bucketIndex].count += 1
  }
  return buckets.map((bucket) => ({
    ...bucket,
    start: min + (span * bucket.index) / bucketCount,
    end: min + (span * (bucket.index + 1)) / bucketCount,
  }))
}

export function CanueGraphDrawer({
  rows,
  options,
  selectedKeys,
  selectedBoundaryId,
  boundaryLevelLabel,
  loading,
  elevated,
  onToggleVariable,
  onClose,
}: {
  rows: CanueAggregateRow[]
  options: CanueGraphVariableOption[]
  selectedKeys: string[]
  selectedBoundaryId: string | null
  boundaryLevelLabel: string
  loading: boolean
  elevated?: boolean
  onToggleVariable: (key: string) => void
  onClose: () => void
}) {
  const selectedOptions = options.filter((option) => selectedKeys.includes(option.key))
  const series = makeCanueGraphSeries(rows, selectedOptions)
  const selectedBoundaryName = selectedBoundaryId
    ? (rows.find((row) => row.boundaryId === selectedBoundaryId)?.boundaryName ?? null)
    : null

  return (
    <div
      className={cn(
        'absolute inset-x-3 z-20 mx-auto max-h-[50vh] max-w-5xl overflow-hidden rounded-lg border border-border bg-background/95 shadow-2xl backdrop-blur md:max-h-[22rem]',
        elevated
          ? 'bottom-[calc(var(--map-mobile-sheet-visible-height,72px)_+_var(--map-timeline-height,5.5rem)_+_0.75rem)] md:bottom-[calc(var(--map-timeline-height,5.5rem)_+_1.5rem)]'
          : 'bottom-[calc(var(--map-mobile-sheet-visible-height,72px)_+_0.75rem)] md:bottom-6',
      )}
    >
      <div className="flex items-start justify-between gap-3 border-b border-border px-3 py-2.5 md:px-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 shrink-0 text-cyan-600" />
            <h3 className="truncate text-sm font-semibold text-foreground">CANUE graphs</h3>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {rows.length.toLocaleString()} {boundaryLevelLabel} areas
            {selectedBoundaryName ? ` | selected: ${selectedBoundaryName}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-input text-muted-foreground hover:text-foreground"
          aria-label="Close CANUE graphs"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="grid max-h-[calc(50vh-3.25rem)] min-h-0 grid-cols-1 overflow-y-auto md:max-h-[18.5rem] md:grid-cols-[16rem_1fr] md:overflow-hidden">
        <div className="border-b border-border p-3 md:border-b-0 md:border-r md:p-4">
          <div className="mb-2 text-xs font-medium text-foreground">Variables</div>
          <div className="flex gap-1.5 overflow-x-auto pb-1 md:max-h-56 md:flex-col md:overflow-y-auto md:pb-0">
            {options.slice(0, 60).map((option) => {
              const active = selectedKeys.includes(option.key)
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => onToggleVariable(option.key)}
                  className={cn(
                    'shrink-0 rounded-md border px-2.5 py-1.5 text-left text-[11px] leading-4 transition-colors md:shrink',
                    active
                      ? 'border-cyan-600 bg-cyan-50 text-cyan-950 dark:bg-cyan-950/30 dark:text-cyan-100'
                      : 'border-input text-muted-foreground hover:text-foreground',
                  )}
                >
                  <span className="line-clamp-2">{option.label}</span>
                </button>
              )
            })}
          </div>
          <div className="mt-2 text-[10px] text-muted-foreground">Pick up to four variables.</div>
        </div>
        <div className="min-h-0 p-3 md:overflow-y-auto md:p-4">
          {loading && <div className="text-xs text-muted-foreground">Loading graph values...</div>}
          {!loading && !series.length && (
            <div className="text-xs text-muted-foreground">
              No graphable values are available for the selected variables.
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            {series.map((item) => {
              const histogram = makeHistogram(
                item.points.map((point) => point.value),
                item.min,
                item.max,
              )
              const maxBucket = Math.max(...histogram.map((bucket) => bucket.count), 1)
              const topPoints = item.points
                .slice()
                .sort((left, right) => right.value - left.value)
                .slice(0, 5)
              const selectedPoint = selectedBoundaryId
                ? item.points.find((point) => point.id === selectedBoundaryId)
                : null
              const selectedOffset =
                selectedPoint && item.max !== item.min
                  ? ((selectedPoint.value - item.min) / (item.max - item.min)) * 100
                  : null

              return (
                <section key={item.key} className="rounded-md border border-border bg-background p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="line-clamp-2 text-xs font-semibold leading-4 text-foreground">{item.label}</h4>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        mean {formatNullableNumber(item.mean)} | {formatNullableNumber(item.min)}-
                        {formatNullableNumber(item.max)}
                      </div>
                    </div>
                    <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                  </div>
                  <div className="relative mt-3 h-24 border-b border-l border-border px-1">
                    <div className="flex h-full items-end gap-1">
                      {histogram.map((bucket) => (
                        <div
                          key={bucket.index}
                          className="min-w-0 flex-1 rounded-t-sm"
                          style={{
                            height: `${Math.max(4, (bucket.count / maxBucket) * 100)}%`,
                            backgroundColor: item.color,
                            opacity: 0.28 + (bucket.count / maxBucket) * 0.54,
                          }}
                          title={`${formatNullableNumber(bucket.start)}-${formatNullableNumber(bucket.end)}: ${bucket.count}`}
                        />
                      ))}
                    </div>
                    {selectedOffset != null && (
                      <div
                        className="absolute bottom-0 top-0 w-0.5 bg-foreground"
                        style={{ left: `calc(${selectedOffset}% + 0.25rem)` }}
                        title={selectedBoundaryName ?? 'Selected boundary'}
                      />
                    )}
                  </div>
                  <div className="mt-2 flex justify-between gap-3 text-[10px] text-muted-foreground">
                    <span>{formatNullableNumber(item.min)}</span>
                    <span>{formatNullableNumber(item.max)}</span>
                  </div>
                  <div className="mt-3 space-y-1.5">
                    {topPoints.map((point) => (
                      <div key={point.id} className="grid grid-cols-[1fr_auto] items-center gap-2 text-[11px]">
                        <span className="truncate text-muted-foreground">{point.name}</span>
                        <span className="font-medium tabular-nums text-foreground">
                          {formatNullableNumber(point.value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

export function MobileCanueBoundaryFeatureCard({
  card,
  onClose,
}: {
  card: CanueBoundaryFeatureCardData
  onClose: () => void
}) {
  return (
    <MobileFeatureCard title={card.title} subtitle="CANUE boundary" onClose={onClose}>
      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">{card.metricLabel}</span>
          <span className="font-semibold text-foreground">{card.metricValue}</span>
        </div>
      </div>
      <div className="mt-3 text-xs text-muted-foreground">
        {card.recordCount.toLocaleString()} {card.recordLabel}
      </div>
    </MobileFeatureCard>
  )
}
