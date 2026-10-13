import { cn } from '@/lib/utils'
import { getHazardRating, HAZARD_BADGE_CLASSES } from '../hazard'
import type { RestaurantWithStats, VisualizationMode } from '../types'

/**
 * The selected establishment at a glance, shared by the desktop sidebar, the phone card,
 * and the map popup: its hazard rating, one line about its latest inspection, and the way
 * into the full history. Violation detail lives in the inspection panel, not here.
 */
export function RestaurantSummary({
  restaurant,
  visualizationMode = 'violations',
  onViewInspections,
  size = 'sm',
  className,
}: {
  restaurant: RestaurantWithStats
  visualizationMode?: VisualizationMode
  onViewInspections: () => void
  /** `md` gives the phone card its larger touch target. */
  size?: 'sm' | 'md'
  className?: string
}) {
  const rating = getHazardRating(restaurant, { atDate: visualizationMode === 'hazard' })
  const allInspections = restaurant.inspections ?? []
  const latest = restaurant.filteredInspections?.[0] ?? allInspections[0]
  // The period filter can leave nothing to show; say the latest record predates it rather
  // than reporting "0 inspections" next to a date.
  const beforePeriod = !restaurant.filteredInspections?.length && allInspections.length > 0
  const latestCritical = latest?.critical_violations_count ?? 0

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={cn('rounded px-2 py-0.5 text-xs font-medium', HAZARD_BADGE_CLASSES[rating])}>
          {rating} hazard
        </span>
        {latest?.follow_up_required === 'Yes' && (
          <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/50 dark:text-red-300">
            Follow-up required
          </span>
        )}
      </div>

      <p className="mt-2 text-xs leading-snug text-muted-foreground" data-restaurant-latest-inspection="true">
        {latest ? (
          <>
            Last inspected <span className="font-medium text-foreground">{latest.inspection_date || latest.date}</span>
            {latestCritical > 0 && (
              <>
                {' · '}
                <span className="font-medium text-red-600 dark:text-red-400">{latestCritical} critical</span>
              </>
            )}
            {beforePeriod && <> · before this period</>}
          </>
        ) : (
          'No inspections on file'
        )}
      </p>

      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          onViewInspections()
        }}
        className={cn(
          'mt-3 w-full rounded-lg bg-sky-600 px-3 font-medium text-white transition-colors hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 dark:focus:ring-offset-slate-950',
          size === 'md' ? 'py-2 text-sm' : 'py-1.5 text-xs',
        )}
      >
        Inspection history{allInspections.length > 0 ? ` (${allInspections.length})` : ''}
      </button>
    </div>
  )
}
