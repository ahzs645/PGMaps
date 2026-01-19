import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import type { RestaurantWithStats, HazardRating, Inspection } from '../types'

interface InspectionPanelProps {
  restaurant: RestaurantWithStats
  onClose: () => void
}

function getInspectionTypeColor(type?: string): string {
  const t = (type || '').toLowerCase()
  if (t.includes('routine')) return 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300'
  if (t.includes('follow')) return 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300'
  if (t.includes('complaint')) return 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300'
  if (t.includes('initial')) return 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300'
  return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
}

function getHazardColor(rating?: HazardRating): string {
  if (rating === 'Low') return 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300'
  if (rating === 'Moderate') return 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300'
  return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
}

export function InspectionPanel({ restaurant, onClose }: InspectionPanelProps) {
  const inspections = useMemo(() => {
    return restaurant.inspections || []
  }, [restaurant])

  const totalViolations = useMemo(() => {
    return inspections.reduce((sum, insp) => {
      return sum + (insp.violations?.length || 0)
    }, 0)
  }, [inspections])

  const totalCritical = useMemo(() => {
    return inspections.reduce((sum, insp) => {
      return sum + (insp.critical_violations_count || 0)
    }, 0)
  }, [inspections])

  const currentRating = (restaurant.current_hazard_rating || restaurant.hazard_rating || 'Unknown') as HazardRating

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 dark:border-gray-700 bg-blue-600 dark:bg-gray-700 rounded-t-xl">
          <div className="flex items-start justify-between">
            <div className="text-white">
              <h2 className="text-xl font-bold">{restaurant.name}</h2>
              <p className="text-blue-100 dark:text-gray-400 text-sm mt-1">
                {restaurant.full_address || restaurant.address}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-white hover:bg-blue-700 dark:hover:bg-gray-600 rounded-lg p-2 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Summary stats */}
          <div className="flex gap-6 mt-4">
            <div>
              <div className="text-2xl font-bold text-white">{inspections.length}</div>
              <div className="text-xs text-blue-200 dark:text-gray-400">Inspections</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-white">{totalViolations}</div>
              <div className="text-xs text-blue-200 dark:text-gray-400">Total Violations</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-red-300 dark:text-red-400">{totalCritical}</div>
              <div className="text-xs text-blue-200 dark:text-gray-400">Critical</div>
            </div>
            <div>
              <div className={cn('text-sm font-medium px-3 py-1 rounded-full', getHazardColor(currentRating))}>
                {currentRating}
              </div>
              <div className="text-xs text-blue-200 dark:text-gray-400 mt-1">Current Rating</div>
            </div>
          </div>
        </div>

        {/* Inspection list */}
        <div className="flex-1 overflow-y-auto p-6 bg-gray-50 dark:bg-gray-900">
          {inspections.length === 0 ? (
            <div className="text-center text-gray-500 dark:text-gray-400 py-8">
              No inspection records available
            </div>
          ) : (
            <div className="space-y-6">
              {inspections.map((inspection, index) => (
                <InspectionItem key={index} inspection={inspection} />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-b-xl flex items-center justify-between">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Data from Northern Health Authority HealthSpace
          </div>
          <div className="flex gap-3">
            <a
              href={restaurant.details_url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
            >
              View on HealthSpace
            </a>
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function InspectionItem({ inspection }: { inspection: Inspection }) {
  const inspectionType = inspection.inspection_type || inspection.type
  const inspectionDate = inspection.inspection_date || inspection.date

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-800">
      {/* Inspection header */}
      <div className="bg-gray-50 dark:bg-gray-700 p-4 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <span className={cn('text-sm font-medium px-3 py-1 rounded-full', getInspectionTypeColor(inspectionType))}>
            {inspectionType}
          </span>
          <span className="text-sm text-gray-600 dark:text-gray-300">{inspectionDate}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className={cn('text-sm px-2 py-1 rounded', getHazardColor(inspection.hazard_rating))}>
            {inspection.hazard_rating}
          </span>
          {inspection.follow_up_required === 'Yes' && (
            <span className="text-xs px-2 py-1 rounded bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 font-medium">
              Follow-up Required
            </span>
          )}
        </div>
      </div>

      {/* Violation summary */}
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center gap-4 text-sm">
        <span className="text-gray-600 dark:text-gray-300">
          <span className="font-medium text-red-600 dark:text-red-400">{inspection.critical_violations_count || 0}</span>
          {' '}critical
        </span>
        <span className="text-gray-400 dark:text-gray-500">|</span>
        <span className="text-gray-600 dark:text-gray-300">
          <span className="font-medium text-amber-600 dark:text-amber-400">{inspection.non_critical_violations_count || 0}</span>
          {' '}non-critical
        </span>
        <span className="text-gray-400 dark:text-gray-500">|</span>
        <span className="text-gray-600 dark:text-gray-300">
          <span className="font-medium">{inspection.violations?.length || 0}</span>
          {' '}total violations
        </span>
      </div>

      {/* Violations list */}
      {inspection.violations && inspection.violations.length > 0 ? (
        <div className="p-4 space-y-3">
          {inspection.violations.map((violation, vIndex) => (
            <div
              key={vIndex}
              className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono px-2 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                      {violation.code}
                    </span>
                    {violation.corrected_during_inspection && (
                      <span className="text-xs px-2 py-0.5 rounded bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300">
                        Corrected
                      </span>
                    )}
                  </div>
                  <div className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-2">
                    {violation.description}
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-300 mb-2">
                    <span className="font-medium">Observation:</span> {violation.observation}
                  </div>
                  {violation.corrective_action && (
                    <div className="text-sm text-gray-600 dark:text-gray-300">
                      <span className="font-medium">Corrective Action:</span> {violation.corrective_action}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-4 text-sm text-gray-500 dark:text-gray-400 italic">
          No violations recorded for this inspection
        </div>
      )}
    </div>
  )
}
