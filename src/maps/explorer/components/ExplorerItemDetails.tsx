import { KeyValueRows } from '@/components/ui/map-panels'
import { cn } from '@/lib/utils'
import { datasetById, GEOMETRY_TYPE_LABEL } from '../constants'
import type { ExplorerItem } from '../types'

export function formatRelevance(value: number): string {
  return `${Math.round(value)}`
}

/** One-line score breakdown, e.g. for a `title` tooltip on a result row. */
export function formatRelevanceBreakdown(item: ExplorerItem): string {
  const parts = item.relevanceBreakdown.map((entry) => `${entry.label} +${entry.points}`)
  return `Relevance ${formatRelevance(item.relevance)}${parts.length ? `: ${parts.join(', ')}` : ''}`
}

/** A selected item's relevance, summary, details and score breakdown, for the sidebar card and the phone card. */
export function ExplorerItemDetails({ item, className }: { item: ExplorerItem; className?: string }) {
  const dataset = datasetById(item.datasetId)

  return (
    <div className={cn('space-y-3 text-xs', className)}>
      <div>
        <div className="text-cyan-800 dark:text-cyan-200">Relevance {formatRelevance(item.relevance)} / 100</div>
        <div className="mt-1 text-muted-foreground">
          {dataset.label} · {GEOMETRY_TYPE_LABEL[dataset.geometryType]}
        </div>
      </div>

      {item.summary && <p className="text-cyan-900 dark:text-cyan-100">{item.summary}</p>}

      <KeyValueRows
        variant="grid"
        rows={item.details.slice(0, 8).map((detail) => ({ key: detail.label, label: detail.label, value: detail.value }))}
      />

      {item.relevanceBreakdown.length > 0 && (
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
          <div className="mb-1 font-semibold text-foreground">Score Breakdown</div>
          <KeyValueRows
            variant="divided"
            rows={[
              ...item.relevanceBreakdown.map((entry, index) => ({
                key: `${index}-${entry.label}`,
                label: entry.label,
                value: `+${entry.points}`,
              })),
              { key: 'total', label: 'Total', value: formatRelevance(item.relevance) },
            ]}
          />
        </div>
      )}
    </div>
  )
}
