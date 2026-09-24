import { AlertTriangle } from 'lucide-react'
import { ToggleRow } from '@/components/ui/toggle-row'
import { cn } from '@/lib/utils'
import type { MetricAvailability } from '../lib/metrics'
import type { ScoreDataSource, ScoreMetricKey } from '../types'
import { SCORE_DATA_SOURCES } from '../types'

const ORPHANED_CLASS =
  'border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100/70 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100'

function OnOffLabel({ active, activeClassName }: { active: boolean; activeClassName: string }) {
  return (
    <span className={cn('font-semibold', active ? activeClassName : 'text-muted-foreground')}>
      {active ? 'ON' : 'OFF'}
    </span>
  )
}

/**
 * The ON/OFF data-source rows shared by the desktop Index Inputs panel and the
 * phone sheet: the source-points overlay first, then every data source. A
 * source that is off while weighted metrics still need it turns amber and
 * says how many metrics it is starving.
 */
export function DataSourceToggleList({
  enabledSources,
  onToggleDataSource,
  showPoints,
  onTogglePoints,
  unavailableTerms,
  rowClassName,
  className,
}: {
  enabledSources: ReadonlySet<ScoreDataSource>
  onToggleDataSource: (source: ScoreDataSource) => void
  showPoints: boolean
  onTogglePoints: () => void
  unavailableTerms: ReadonlyMap<ScoreMetricKey, MetricAvailability>
  /** Extra classes for every row, e.g. a taller hit area in the phone sheet. */
  rowClassName?: string
  className?: string
}) {
  return (
    <div className={cn('space-y-2', className)}>
      {/* Point overlays draw from the data sources, not from the study-area
          boundaries, so the toggle lives with them. */}
      <ToggleRow
        active={showPoints}
        onClick={onTogglePoints}
        label="Source points on map"
        tone="sky"
        trailing={<OnOffLabel active={showPoints} activeClassName="text-sky-600 dark:text-sky-400" />}
        className={rowClassName}
      />
      {SCORE_DATA_SOURCES.map((ds) => {
        const active = enabledSources.has(ds.id)
        const orphanedCount = [...unavailableTerms.values()].filter((entry) => entry.source === ds.id).length
        const orphaned = orphanedCount > 0 && !active
        return (
          <ToggleRow
            key={ds.id}
            active={active}
            onClick={() => onToggleDataSource(ds.id)}
            // The e2e suite finds these rows by an aria-label that ends in ON/OFF.
            aria-label={`${ds.label} ${ds.id === 'bcAssessment' ? 'Property' : ''} ${active ? 'ON' : 'OFF'}`}
            title={ds.description}
            label={ds.label}
            tone="cyan"
            trailing={
              <span className="flex items-center gap-1.5">
                {orphaned && (
                  <span className="inline-flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                    {orphanedCount} metric{orphanedCount === 1 ? '' : 's'}
                  </span>
                )}
                <OnOffLabel active={active} activeClassName="text-cyan-600 dark:text-cyan-400" />
              </span>
            }
            className={cn(orphaned && ORPHANED_CLASS, rowClassName)}
          />
        )
      })}
    </div>
  )
}
