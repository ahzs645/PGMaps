import { KeyValueRows } from '@/components/ui/map-panels'
import { RankedBarList } from '@/components/ui/ranked-bar-list'
import type { ColumnStats } from '@/lib/featureAttributes'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * Felt's "column stats": how full a column is, its spread for numbers, and its
 * most common values. `formatValue` formats numeric summaries with the column's
 * own format so they read like the table cells.
 */
export function ColumnStatsSummary({
  stats,
  title,
  formatValue = (value) => formatNumber(value, { maximumFractionDigits: 2 }),
  className,
}: {
  stats: ColumnStats
  title?: string
  formatValue?: (value: number) => string
  className?: string
}) {
  const numeric = stats.type !== 'text' && stats.min != null
  return (
    <div className={cn('space-y-3 p-3 text-xs', className)} aria-label={title ? `${title} statistics` : undefined}>
      {title && <div className="text-sm font-semibold text-foreground">{title}</div>}
      <KeyValueRows
        variant="grid"
        rows={[
          { label: 'Rows with a value', value: formatNumber(stats.count) },
          stats.missing > 0 && { label: 'Empty', value: formatNumber(stats.missing) },
          { label: 'Distinct values', value: formatNumber(stats.distinct) },
          numeric && stats.min != null && { label: 'Minimum', value: formatValue(stats.min) },
          numeric && stats.median != null && { label: 'Median', value: formatValue(stats.median) },
          numeric && stats.max != null && { label: 'Maximum', value: formatValue(stats.max) },
          numeric &&
            stats.type === 'numeric' &&
            stats.mean != null && { label: 'Mean', value: formatValue(stats.mean) },
          numeric && stats.type === 'numeric' && stats.sum != null && { label: 'Sum', value: formatValue(stats.sum) },
        ]}
      />
      {!numeric && stats.topValues.length > 0 && (
        <div>
          <div className="mb-1 font-medium text-muted-foreground">Most common</div>
          <RankedBarList
            items={stats.topValues.map((entry) => ({ id: entry.value, label: entry.value, value: entry.count }))}
          />
        </div>
      )}
    </div>
  )
}
