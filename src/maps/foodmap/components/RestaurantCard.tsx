import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { getHazardRating, HAZARD_BADGE_CLASSES, HAZARD_TAILWIND } from '../hazard'
import { getViolationBadgeLabel, getViolationBucketStyle } from '../violationBuckets'
import { cleanAddress, formatFullAddress } from '../address'
import type { RestaurantWithStats, VisualizationMode } from '../types'

interface RestaurantCardProps {
  restaurant: RestaurantWithStats
  expanded?: boolean
  isSelected?: boolean
  visualizationMode?: VisualizationMode
  onClick?: () => void
  className?: string
}

const EMPTY_STATS = { total: 0, critical: 0, nonCritical: 0, inspectionCount: 0 }

export function RestaurantCard({
  restaurant,
  expanded = false,
  isSelected = false,
  visualizationMode = 'violations',
  onClick,
  className,
}: RestaurantCardProps) {
  const rating = useMemo(
    () => getHazardRating(restaurant, { atDate: visualizationMode === 'hazard' }),
    [restaurant, visualizationMode],
  )

  const violationStats = restaurant.violationStats ?? EMPTY_STATS
  const bucketStyle = getViolationBucketStyle(violationStats)
  const violationLabel = getViolationBadgeLabel(violationStats)
  const inspectionLabel = `${violationStats.inspectionCount} inspection${violationStats.inspectionCount === 1 ? '' : 's'}`

  // The dot follows the map legend for the active mode, so the list and the
  // markers never disagree about what a colour means.
  const dotColorClass = visualizationMode === 'violations' ? bucketStyle.dotClass : HAZARD_TAILWIND[rating].bg

  const hasLocation = Boolean(restaurant.latitude && restaurant.longitude)

  const latestInspection = restaurant.filteredInspections?.[0] || restaurant.inspections?.[0]
  // The stats badges only count the selected period, so an all-time fallback
  // inspection needs to say so or the card contradicts itself.
  const latestInspectionOutsidePeriod = !restaurant.filteredInspections?.length && Boolean(restaurant.inspections?.length)
  const Root = onClick ? 'button' : 'div'

  return (
    <Root
      type={onClick ? 'button' : undefined}
      aria-pressed={onClick ? Boolean(isSelected) : undefined}
      data-restaurant-id={onClick ? restaurant.details_url : undefined}
      className={cn(
        'block w-full p-3 text-left transition-colors',
        onClick && 'cursor-pointer hover:bg-slate-100/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500 dark:hover:bg-slate-800/60',
        isSelected && 'bg-sky-50 shadow-[inset_3px_0_0_theme(colors.sky.500)] dark:bg-sky-950/30',
        className,
      )}
      onClick={onClick}
    >
      <div className="flex items-start gap-2">
        <div className="flex-shrink-0 mt-1">
          <span className={cn('w-3 h-3 rounded-full inline-block', dotColorClass)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
              {restaurant.name}
            </h3>
            {!hasLocation && (
              <span className="text-xs text-gray-400 dark:text-gray-500" title="No map location">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="sr-only">No map location</span>
              </span>
            )}
          </div>
          <p className={cn('text-xs text-slate-500 dark:text-slate-400', !expanded && 'truncate')}>
            {expanded ? formatFullAddress(restaurant) : cleanAddress(restaurant.address)}
          </p>

          {/* One status signal per mode: the legend's measure leads, the other stays text. */}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {visualizationMode === 'violations' ? (
              <>
                <span className={cn('text-xs px-2 py-0.5 rounded', bucketStyle.badgeClass)}>{violationLabel}</span>
                {violationStats.critical > 0 && (
                  <span className="text-xs text-red-600 dark:text-red-400 font-medium">
                    {violationStats.critical} critical
                  </span>
                )}
              </>
            ) : (
              <span className={cn('text-xs px-2 py-0.5 rounded', HAZARD_BADGE_CLASSES[rating])}>{rating} hazard</span>
            )}
          </div>

          <div className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
            {[
              restaurant.establishment_type || restaurant.facility_type || 'Restaurant',
              inspectionLabel,
              visualizationMode === 'violations' ? `${rating} hazard` : violationLabel,
            ].join(' · ')}
          </div>

          {/* Expanded details */}
          {expanded && (
            <div className="mt-3 space-y-2 border-t border-slate-200 pt-3 dark:border-slate-700">
              {!latestInspection && (
                <div className="text-xs text-slate-500 dark:text-slate-400">No inspection records on file.</div>
              )}
              {latestInspection && (
                <div className="text-xs">
                  <div className="font-medium text-slate-700 dark:text-slate-200">
                    {latestInspectionOutsidePeriod ? 'Latest inspection outside selected period:' : 'Latest inspection:'}
                  </div>
                  <div className="text-slate-600 dark:text-slate-300">
                    {latestInspection.inspection_date || latestInspection.date} -{' '}
                    {latestInspection.inspection_type || latestInspection.type}
                  </div>
                  {latestInspection.critical_violations_count > 0 && (
                    <div className="text-red-600 dark:text-red-400">
                      {latestInspection.critical_violations_count} critical violation(s)
                    </div>
                  )}
                  {latestInspection.follow_up_required === 'Yes' && (
                    <div className="text-orange-600 dark:text-orange-400 font-medium">
                      Follow-up Required
                    </div>
                  )}
                </div>
              )}

              {/* Recent violations preview */}
              {latestInspection?.violations && latestInspection.violations.length > 0 && (
                <div className="mt-2">
                  <div className="mb-1 text-xs font-medium text-slate-700 dark:text-slate-200">
                    Violations in this inspection:
                  </div>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {latestInspection.violations.slice(0, 2).map((violation, index) => (
                      <div
                        key={index}
                        className="text-xs p-2 bg-red-50 dark:bg-red-900/30 rounded text-red-800 dark:text-red-200 border border-red-100 dark:border-red-800"
                      >
                        <div className="font-medium">
                          [{violation.code}] {violation.description}
                        </div>
                      </div>
                    ))}
                    {latestInspection.violations.length > 2 && (
                      <div className="text-xs italic text-slate-500 dark:text-slate-400">
                        +{latestInspection.violations.length - 2} more violations
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Root>
  )
}
