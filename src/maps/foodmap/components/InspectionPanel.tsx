import { useEffect, useMemo } from 'react'
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

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="flex w-full max-h-[92vh] max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-background/95 shadow-2xl backdrop-blur">
        {/* Header */}
        <div className="shrink-0 border-b border-border bg-background/90 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-xl font-bold text-foreground">{restaurant.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {restaurant.full_address || restaurant.address}
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label="Close inspection panel"
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Summary stats */}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
              <div className="text-2xl font-bold text-foreground">{inspections.length}</div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Inspections</div>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
              <div className="text-2xl font-bold text-foreground">{totalViolations}</div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Total Violations</div>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
              <div className="text-2xl font-bold text-red-600 dark:text-red-400">{totalCritical}</div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Critical</div>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
              <div className={cn('inline-flex rounded-full px-2.5 py-1 text-sm font-medium', getHazardColor(currentRating))}>
                {currentRating || 'Unknown'}
              </div>
              <div className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">Current Rating</div>
            </div>
          </div>
        </div>

        {/* Inspection list */}
        <div className="flex-1 overflow-y-auto bg-muted/20 p-4 sm:p-6">
          {inspections.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
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
        <div className="shrink-0 border-t border-border bg-background/90 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-muted-foreground">
              Data from Northern Health Authority HealthSpace
            </div>
            <div className="flex flex-wrap gap-2 sm:gap-3">
              <a
                href={restaurant.details_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-lg border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
              >
                View on HealthSpace
              </a>
              <button
                onClick={onClose}
                className="inline-flex items-center justify-center rounded-lg border border-input bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground transition-colors hover:bg-accent"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function InspectionItem({ inspection }: { inspection: Inspection }) {
  const inspectionType = inspection.inspection_type || inspection.type || 'Inspection'
  const inspectionDate = inspection.inspection_date || inspection.date || 'Date unavailable'
  const violationCount = inspection.violations?.length || 0

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background shadow-sm">
      {/* Inspection header */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/35 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className={cn('text-sm font-medium px-3 py-1 rounded-full', getInspectionTypeColor(inspectionType))}>
            {inspectionType}
          </span>
          <span className="text-sm text-muted-foreground">{inspectionDate}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className={cn('rounded px-2 py-1 text-sm', getHazardColor(inspection.hazard_rating))}>
            {inspection.hazard_rating}
          </span>
          {inspection.follow_up_required === 'Yes' && (
            <span className="rounded bg-red-100 px-2 py-1 text-xs font-medium text-red-700 dark:bg-red-900/50 dark:text-red-300">
              Follow-up Required
            </span>
          )}
        </div>
      </div>

      {/* Violation summary */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5 text-sm">
        <span className="text-muted-foreground">
          <span className="font-medium text-red-600 dark:text-red-400">{inspection.critical_violations_count || 0}</span>
          {' '}critical
        </span>
        <span className="text-muted-foreground/50">•</span>
        <span className="text-muted-foreground">
          <span className="font-medium text-amber-600 dark:text-amber-400">{inspection.non_critical_violations_count || 0}</span>
          {' '}non-critical
        </span>
        <span className="text-muted-foreground/50">•</span>
        <span className="text-muted-foreground">
          <span className="font-medium text-foreground">{violationCount}</span>
          {' '}total violations
        </span>
      </div>

      {/* Violations list */}
      {violationCount > 0 ? (
        <div className="p-4 space-y-3">
          {inspection.violations?.map((violation, vIndex) => (
            <div
              key={vIndex}
              className="rounded-lg border border-border bg-background p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
                      {violation.code}
                    </span>
                    {violation.corrected_during_inspection && (
                      <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/50 dark:text-green-300">
                        Corrected
                      </span>
                    )}
                  </div>
                  <div className="mb-2 text-sm font-medium text-foreground">
                    {violation.description}
                  </div>
                  <div className="mb-2 text-sm leading-relaxed text-muted-foreground">
                    <span className="font-medium">Observation:</span> {violation.observation}
                  </div>
                  {violation.corrective_action && (
                    <div className="text-sm leading-relaxed text-muted-foreground">
                      <span className="font-medium">Corrective Action:</span> {violation.corrective_action}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-4 text-sm italic text-muted-foreground">
          No violations recorded for this inspection
        </div>
      )}
    </div>
  )
}
