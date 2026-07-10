import { MobileFeatureCard } from '@/components/ui/mobile-feature-card'
import { datasetById, GEOMETRY_TYPE_LABEL } from '../constants'
import type { ExplorerItem } from '../types'
import { formatRelevance } from './ExplorerSidebar'

interface MobileExplorerFeatureCardProps {
  item: ExplorerItem
  onClose: () => void
}

export function MobileExplorerFeatureCard({ item, onClose }: MobileExplorerFeatureCardProps) {
  const dataset = datasetById(item.datasetId)

  return (
    <MobileFeatureCard
      title={item.name}
      subtitle={item.subtitle}
      onClose={onClose}
    >
      <div className="text-xs text-cyan-800 dark:text-cyan-200">
        Relevance {formatRelevance(item.relevance)} / 100
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {dataset.label} | {GEOMETRY_TYPE_LABEL[dataset.geometryType]}
      </div>

      <div className="mt-3 rounded-md border border-cyan-300/60 bg-cyan-50 p-3 text-xs text-cyan-900 dark:border-cyan-800/60 dark:bg-cyan-950/25 dark:text-cyan-100">
        {item.summary}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-cyan-800 dark:text-cyan-300">
        {item.details.slice(0, 8).map((detail) => (
          <div key={`${item.id}-${detail.label}`}>
            <span className="font-medium">{detail.label}:</span> {detail.value}
          </div>
        ))}
      </div>

      {item.relevanceBreakdown.length > 0 && (
        <div className="mt-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
          <div className="mb-1 font-semibold text-foreground">Score Breakdown</div>
          {item.relevanceBreakdown.map((entry) => (
            <div key={`${item.id}-${entry.label}`} className="flex items-center justify-between gap-3 py-0.5 text-muted-foreground">
              <span>{entry.label}</span>
              <span className="font-medium text-foreground">+{entry.points}</span>
            </div>
          ))}
        </div>
      )}
    </MobileFeatureCard>
  )
}
