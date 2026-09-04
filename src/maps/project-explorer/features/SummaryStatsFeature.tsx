import { BookOpen, Calendar, MapPin, X } from 'lucide-react'

import { StatGrid } from '@/components/ui/map-panels'
import type { ProjectExplorerSummaryIcon } from '@/lib/projectPackages'

import type { ResearchRecordsAdapterData } from '../adapters/useResearchRecordsAdapter'
import type { ExplorerFeature } from './featureTypes'

function summaryIcon(icon: ProjectExplorerSummaryIcon) {
  if (icon === 'map-pin') return <MapPin className="size-3" />
  if (icon === 'calendar') return <Calendar className="size-3" />
  return <BookOpen className="size-3" />
}

function summaryMetricValue(
  metric: ExplorerFeature<'summary-stats'>['items'][number]['metric'],
  overview: ResearchRecordsAdapterData['overview'],
  filteredStats: ResearchRecordsAdapterData['filteredStats'],
) {
  if (metric === 'records') return filteredStats.totalPublications
  if (metric === 'locations') return filteredStats.activeLocations
  if (!overview?.yearRange) return '—'
  return `${overview.yearRange.min}–${overview.yearRange.max}`
}

export function SummaryStatsFeature({
  feature,
  overview,
  filteredStats,
  hasFilters,
  onClearFilters,
}: {
  feature: ExplorerFeature<'summary-stats'>
  overview: ResearchRecordsAdapterData['overview']
  filteredStats: ResearchRecordsAdapterData['filteredStats']
  hasFilters: boolean
  onClearFilters: () => void
}) {
  return (
    <div className="shrink-0 border-b border-border p-3">
      <StatGrid
        columns={feature.items.length === 2 ? 2 : 3}
        stats={feature.items.map((item) => {
          const value = summaryMetricValue(item.metric, overview, filteredStats)
          const displayValue = typeof value === 'number' ? value.toLocaleString() : value
          return {
            label: item.label,
            value: displayValue,
            icon: summaryIcon(item.icon),
            className: 'bg-muted/30',
            valueClassName: displayValue.length > 7 ? 'text-sm' : 'text-base',
          }
        })}
      />
      {hasFilters ? (
        <button
          type="button"
          onClick={onClearFilters}
          className="mt-2 flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <X className="size-3" />
          Clear all filters
        </button>
      ) : null}
    </div>
  )
}
