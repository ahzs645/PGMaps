import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import type { RestaurantWithStats, HazardRating, VisualizationMode } from '../types'

interface RestaurantCardProps {
  restaurant: RestaurantWithStats
  expanded?: boolean
  isSelected?: boolean
  visualizationMode?: VisualizationMode
  onClick?: () => void
}

const ratingClasses: Record<HazardRating, string> = {
  Low: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300',
  Moderate: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',
  Unknown: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
}

const dotColorClasses: Record<HazardRating, string> = {
  Low: 'bg-green-500',
  Moderate: 'bg-amber-500',
  Unknown: 'bg-gray-500'
}

function getViolationDotClass(total: number): string {
  if (total === 0) return 'bg-green-500'
  if (total <= 3) return 'bg-yellow-500'
  if (total <= 6) return 'bg-orange-500'
  return 'bg-red-500'
}

function getViolationBadgeClass(total: number): string {
  if (total === 0) return 'bg-green-500'
  if (total <= 3) return 'bg-yellow-500'
  if (total <= 6) return 'bg-orange-500'
  return 'bg-red-500'
}

export function RestaurantCard({
  restaurant,
  expanded = false,
  isSelected = false,
  visualizationMode = 'violations',
  onClick
}: RestaurantCardProps) {
  const rating = useMemo(() => {
    return (restaurant.current_hazard_rating || restaurant.hazard_rating || 'Unknown') as HazardRating
  }, [restaurant])

  const violationStats = useMemo(() => {
    return restaurant.violationStats || { total: 0, critical: 0, nonCritical: 0, inspectionCount: 0 }
  }, [restaurant])

  const dotColorClass = useMemo(() => {
    if (visualizationMode === 'violations') {
      return getViolationDotClass(violationStats.total)
    }
    return dotColorClasses[rating] || dotColorClasses.Unknown
  }, [visualizationMode, violationStats.total, rating])

  const hasLocation = Boolean(restaurant.latitude && restaurant.longitude)

  const latestInspection = restaurant.filteredInspections?.[0] || restaurant.inspections?.[0]

  return (
    <div
      className={cn(
        'p-3 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors',
        isSelected && 'bg-blue-50 dark:bg-blue-900/30'
      )}
      onClick={onClick}
    >
      <div className="flex items-start gap-2">
        <div className="flex-shrink-0 mt-1">
          <span className={cn('w-3 h-3 rounded-full inline-block', dotColorClass)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
              {restaurant.name}
            </h3>
            {!hasLocation && (
              <span className="text-xs text-gray-400 dark:text-gray-500" title="No map location">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{restaurant.address}</p>

          {/* Stats row */}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className={cn('text-xs px-2 py-0.5 rounded', ratingClasses[rating])}>
              {rating}
            </span>
            <span className={cn('text-xs px-2 py-0.5 rounded text-white', getViolationBadgeClass(violationStats.total))}>
              {violationStats.total} violation{violationStats.total !== 1 ? 's' : ''}
            </span>
            {violationStats.critical > 0 && (
              <span className="text-xs text-red-600 dark:text-red-400 font-medium">
                {violationStats.critical} critical
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {restaurant.facility_type || 'Restaurant'}
            </span>
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {violationStats.inspectionCount} insp.
            </span>
          </div>

          {/* Expanded details */}
          {expanded && (
            <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-600 space-y-2">
              <div className="text-xs text-gray-600 dark:text-gray-300">
                <span className="font-medium">Full Address:</span>{' '}
                {restaurant.full_address || restaurant.address}
              </div>

              {latestInspection && (
                <div className="text-xs">
                  <div className="font-medium text-gray-700 dark:text-gray-200">Latest Inspection:</div>
                  <div className="text-gray-600 dark:text-gray-300">
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
                  <div className="text-xs font-medium text-gray-700 dark:text-gray-200 mb-1">
                    Recent Violations:
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
                      <div className="text-xs text-gray-500 dark:text-gray-400 italic">
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
    </div>
  )
}
