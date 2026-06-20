import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { assessViolationRisk, summarizeViolationRisk } from '../risk'
import type { RestaurantWithStats, HazardRating, Inspection, Violation, ViolationRiskBand } from '../types'

interface InspectionPanelProps {
  restaurant: RestaurantWithStats
  periodLabel?: string
  useFilteredInspections?: boolean
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

function getRiskBandClass(band: string): string {
  if (band === 'Severe') return 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300'
  if (band === 'Elevated') return 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300'
  if (band === 'Moderate') return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300'
  if (band === 'Administrative') return 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300'
  return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
}

function getRiskDotClass(band: ViolationRiskBand, hasViolations: boolean): string {
  if (!hasViolations) return 'bg-emerald-500'
  if (band === 'Severe') return 'bg-red-500'
  if (band === 'Elevated') return 'bg-orange-500'
  if (band === 'Moderate') return 'bg-yellow-500'
  if (band === 'Administrative') return 'bg-blue-500'
  return 'bg-gray-400'
}

function getRiskCategoryClass(category: string): string {
  if (category === 'Pest Control') return 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300'
  if (category === 'Contamination') return 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300'
  if (category === 'Temperature Control') return 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300'
  if (category === 'Sanitization & Hygiene') return 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300'
  if (category === 'Chemical Safety') return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300'
  if (category === 'Facility & Equipment') return 'bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-300'
  if (category === 'Administrative') return 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300'
  return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
}

function formatRate(value: number): string {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: value >= 10 ? 0 : 1,
    minimumFractionDigits: value > 0 && value < 10 ? 1 : 0
  })
}

interface ViolationDetailMismatch {
  missingDetails: number
  extraDetails: number
}

function getInspectionViolationDetailMismatch(inspection: Inspection): ViolationDetailMismatch {
  const healthSpaceCount = (inspection.critical_violations_count || 0) + (inspection.non_critical_violations_count || 0)
  const detailedCount = inspection.violations?.length || 0

  return {
    missingDetails: Math.max(0, healthSpaceCount - detailedCount),
    extraDetails: Math.max(0, detailedCount - healthSpaceCount)
  }
}

export function InspectionPanel({ restaurant, periodLabel, useFilteredInspections = false, onClose }: InspectionPanelProps) {
  const inspections = useMemo(() => {
    const source = useFilteredInspections ? restaurant.filteredInspections : restaurant.inspections
    return source || []
  }, [restaurant, useFilteredInspections])

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

  const criticalPerInspection = inspections.length > 0 ? totalCritical / inspections.length : 0

  const missingViolationDetails = useMemo(() => {
    return inspections.reduce((sum, inspection) => sum + getInspectionViolationDetailMismatch(inspection).missingDetails, 0)
  }, [inspections])

  const extraViolationDetails = useMemo(() => {
    return inspections.reduce((sum, inspection) => sum + getInspectionViolationDetailMismatch(inspection).extraDetails, 0)
  }, [inspections])

  const detailMismatchNote = [
    missingViolationDetails > 0
      ? `Detailed violation text unavailable for ${missingViolationDetails} ${
          missingViolationDetails === 1 ? 'finding' : 'findings'
        }.`
      : '',
    extraViolationDetails > 0
      ? `Detailed rows include ${extraViolationDetails} ${
          extraViolationDetails === 1 ? 'finding' : 'findings'
        } outside HealthSpace critical/non-critical totals.`
      : ''
  ].filter(Boolean).join(' ')

  const riskSummary = useMemo(() => {
    return summarizeViolationRisk(inspections)
  }, [inspections])

  const currentRating = (restaurant.current_hazard_rating || restaurant.hazard_rating || 'Unknown') as HazardRating

  // Master-detail navigation: the panel shows a list of inspection cards, and
  // opening one drills into a dedicated detail view of its violations. With a
  // single inspection there is nothing to choose, so open it directly.
  const [selectedIndex, setSelectedIndex] = useState<number | null>(inspections.length === 1 ? 0 : null)
  useEffect(() => {
    setSelectedIndex(inspections.length === 1 ? 0 : null)
  }, [inspections])

  const selectedInspection = selectedIndex !== null ? inspections[selectedIndex] ?? null : null

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        variant="sheet"
        elevated
        showClose={false}
        className="h-[96dvh] sm:h-auto sm:max-h-[92dvh] sm:max-w-4xl"
      >
        {/* Header */}
        <div className="shrink-0 border-b border-border bg-background/90 p-3 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="text-lg font-bold leading-tight text-foreground sm:truncate sm:text-xl">{restaurant.name}</DialogTitle>
              <DialogDescription className="mt-1 text-sm leading-snug text-muted-foreground">
                {restaurant.full_address || restaurant.address}
              </DialogDescription>
              {useFilteredInspections && periodLabel && (
                <p className="mt-1 text-xs font-medium text-sky-600 dark:text-sky-400">
                  Showing inspections for {periodLabel}
                </p>
              )}
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
          <div className="mt-3 grid grid-cols-4 gap-1.5 sm:mt-4 sm:gap-3">
            <div className="rounded-lg border border-border bg-muted/40 px-2 py-2 sm:px-3">
              <div className="text-lg font-bold text-foreground sm:text-2xl">{inspections.length}</div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground sm:text-[11px]">
                <span className="sm:hidden">Insp.</span>
                <span className="hidden sm:inline">Inspections</span>
              </div>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 px-2 py-2 sm:px-3">
              <div className="text-lg font-bold text-foreground sm:text-2xl">{totalViolations}</div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground sm:text-[11px]">
                <span className="sm:hidden">Total</span>
                <span className="hidden sm:inline">Total Violations</span>
              </div>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 px-2 py-2 sm:px-3">
              <div className="text-lg font-bold text-red-600 dark:text-red-400 sm:text-2xl">{totalCritical}</div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground sm:text-[11px]">
                <span className="sm:hidden">HS Critical</span>
                <span className="hidden sm:inline">HealthSpace Critical</span>
              </div>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 px-2 py-2 sm:px-3">
              <div className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium sm:px-2.5 sm:py-1 sm:text-sm', getHazardColor(currentRating))}>
                {currentRating || 'Unknown'}
              </div>
              <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground sm:text-[11px]">
                <span className="sm:hidden">Rating</span>
                <span className="hidden sm:inline">Current Rating</span>
              </div>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>
              <span className="font-semibold text-foreground">{formatRate(criticalPerInspection)}</span> HealthSpace critical per inspection
            </span>
          </div>
          {detailMismatchNote && (
            <div className="mt-2 flex items-start gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs leading-snug text-muted-foreground">
              <svg className="mt-0.5 h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{detailMismatchNote} The <span className="font-medium">Total Violations</span> count above reflects the detailed rows shown below.</span>
            </div>
          )}
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
            <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-xs font-medium', getRiskBandClass('Severe'))}>
              Severe: {riskSummary.severe}
            </span>
            <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-xs font-medium', getRiskBandClass('Elevated'))}>
              Elevated: {riskSummary.elevated}
            </span>
            <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-xs font-medium', getRiskBandClass('Moderate'))}>
              Moderate: {riskSummary.moderate}
            </span>
            <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-xs font-medium', getRiskBandClass('Administrative'))}>
              Administrative: {riskSummary.administrative}
            </span>
          </div>
        </div>

        {/* Inspection list / detail */}
        <div className="flex-1 overflow-y-auto overscroll-contain bg-muted/20 p-2 sm:p-6">
          {inspections.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No inspection records available
              {useFilteredInspections && periodLabel ? ` for ${periodLabel}` : ''}
            </div>
          ) : selectedInspection ? (
            <InspectionDetailView
              inspection={selectedInspection}
              showBack={inspections.length > 1}
              onBack={() => setSelectedIndex(null)}
            />
          ) : (
            <div className="space-y-3 sm:space-y-4">
              <p className="px-1 text-xs text-muted-foreground">
                Select an inspection to view its violations.
              </p>
              {inspections.map((inspection, index) => (
                <InspectionSummaryCard
                  key={index}
                  inspection={inspection}
                  onOpen={() => setSelectedIndex(index)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-border bg-background/90 p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-muted-foreground max-sm:hidden">
              Data from Northern Health Authority HealthSpace
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-3">
              <a
                href={restaurant.details_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-lg border border-input bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent sm:px-4"
              >
                <span className="sm:hidden">HealthSpace</span>
                <span className="hidden sm:inline">View on HealthSpace</span>
              </a>
              <button
                onClick={onClose}
                className="inline-flex items-center justify-center rounded-lg border border-input bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground transition-colors hover:bg-accent sm:px-4"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface InspectionCounts {
  violationCount: number
  criticalCount: number
  nonCriticalCount: number
  otherCount: number
  notItemizedCount: number
}

function getInspectionCounts(inspection: Inspection): InspectionCounts {
  const violationCount = inspection.violations?.length || 0
  const criticalCount = inspection.critical_violations_count || 0
  const nonCriticalCount = inspection.non_critical_violations_count || 0
  // HealthSpace's critical/non-critical tally and the detailed rows can disagree;
  // surface the difference so the numbers visibly reconcile (crit + non-crit +
  // other = total) instead of looking like a math error.
  const otherCount = Math.max(0, violationCount - (criticalCount + nonCriticalCount))
  const notItemizedCount = Math.max(0, (criticalCount + nonCriticalCount) - violationCount)
  return { violationCount, criticalCount, nonCriticalCount, otherCount, notItemizedCount }
}

function ViolationCountSummary({ counts }: { counts: InspectionCounts }) {
  const { criticalCount, nonCriticalCount, otherCount, violationCount, notItemizedCount } = counts
  return (
    <>
      <span className="text-muted-foreground">
        <span className="font-medium text-red-600 dark:text-red-400">{criticalCount}</span>
        {' '}critical
      </span>
      <span className="text-muted-foreground/50">•</span>
      <span className="text-muted-foreground">
        <span className="font-medium text-amber-600 dark:text-amber-400">{nonCriticalCount}</span>
        {' '}non-critical
      </span>
      {otherCount > 0 && (
        <>
          <span className="text-muted-foreground/50">•</span>
          <span className="text-muted-foreground" title="Detailed rows beyond HealthSpace's critical/non-critical tally">
            <span className="font-medium text-foreground">{otherCount}</span>
            {' '}other
          </span>
        </>
      )}
      <span className="text-muted-foreground/50">•</span>
      <span className="text-muted-foreground">
        <span className="font-medium text-foreground">{violationCount}</span>
        {' '}total
      </span>
      {notItemizedCount > 0 && (
        <span className="italic text-muted-foreground/70">
          ({notItemizedCount} not itemized)
        </span>
      )}
    </>
  )
}

// List item — click to open the inspection's detail view.
function InspectionSummaryCard({ inspection, onOpen }: { inspection: Inspection; onOpen: () => void }) {
  const inspectionType = inspection.inspection_type || inspection.type || 'Inspection'
  const inspectionDate = inspection.inspection_date || inspection.date || 'Date unavailable'
  const counts = getInspectionCounts(inspection)
  const hasViolations = counts.violationCount > 0
  const worstBand = hasViolations ? summarizeViolationRisk([inspection]).worstBand : 'Unknown'

  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full overflow-hidden rounded-lg border border-border bg-background text-left shadow-sm transition-colors hover:border-sky-300 hover:bg-muted/40 dark:hover:border-sky-700 sm:rounded-xl"
    >
      <div className="flex items-center gap-2 px-3 py-3 sm:px-4">
        <span
          className={cn('h-2.5 w-2.5 shrink-0 rounded-full', getRiskDotClass(worstBand, hasViolations))}
          aria-hidden="true"
        />
        <span className={cn('text-sm font-medium px-3 py-1 rounded-full', getInspectionTypeColor(inspectionType))}>
          {inspectionType}
        </span>
        <span className="text-sm text-muted-foreground">{inspectionDate}</span>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <span className={cn('rounded px-2 py-1 text-sm', getHazardColor(inspection.hazard_rating))}>
            {inspection.hazard_rating}
          </span>
          {inspection.follow_up_required === 'Yes' && (
            <span className="hidden rounded bg-red-100 px-2 py-1 text-xs font-medium text-red-700 dark:bg-red-900/50 dark:text-red-300 sm:inline">
              Follow-up Required
            </span>
          )}
          <svg className="h-4 w-4 shrink-0 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 pb-3 pl-9 text-sm sm:px-4 sm:pl-9">
        <ViolationCountSummary counts={counts} />
      </div>
    </button>
  )
}

// Detail view for a single inspection — its header, counts, and full violation list.
function InspectionDetailView({ inspection, showBack, onBack }: { inspection: Inspection; showBack: boolean; onBack: () => void }) {
  const inspectionType = inspection.inspection_type || inspection.type || 'Inspection'
  const inspectionDate = inspection.inspection_date || inspection.date || 'Date unavailable'
  const counts = getInspectionCounts(inspection)

  return (
    <div className="space-y-3 sm:space-y-4">
      {showBack && (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-sky-600 transition-colors hover:text-sky-700 hover:underline dark:text-sky-400 dark:hover:text-sky-300"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          All inspections
        </button>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-background shadow-sm sm:rounded-xl">
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/35 px-3 py-3 sm:px-4">
          <span className={cn('text-sm font-medium px-3 py-1 rounded-full', getInspectionTypeColor(inspectionType))}>
            {inspectionType}
          </span>
          <span className="text-sm text-muted-foreground">{inspectionDate}</span>
          <div className="ml-auto flex flex-wrap items-center gap-2 sm:gap-3">
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
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm sm:px-4">
          <ViolationCountSummary counts={counts} />
        </div>
      </div>

      {counts.violationCount > 0 ? (
        <div className="space-y-3">
          {inspection.violations?.map((violation, vIndex) => (
            <ViolationCard key={vIndex} violation={violation} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-background p-4 text-sm italic text-muted-foreground">
          No violations recorded for this inspection
        </div>
      )}
    </div>
  )
}

function ViolationCard({ violation }: { violation: Violation }) {
  const risk = assessViolationRisk(violation)
  return (
    <div className="rounded-lg border border-border bg-background p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
              {violation.code}
            </span>
            <span className={cn('rounded px-2 py-0.5 text-xs font-medium', getRiskBandClass(risk.band))}>
              {risk.band}
            </span>
            <span className={cn('rounded px-2 py-0.5 text-xs font-medium', getRiskCategoryClass(risk.category))}>
              {risk.category}
            </span>
            {violation.corrected_during_inspection && (
              <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/50 dark:text-green-300">
                Corrected
              </span>
            )}
          </div>
          <div
            className={cn(
              'mb-2 leading-snug',
              violation.details_unavailable
                ? 'text-sm italic text-muted-foreground'
                : 'text-base font-semibold text-foreground sm:text-sm sm:font-medium'
            )}
          >
            {violation.description}
          </div>
          <div className="mb-3 text-base leading-7 text-muted-foreground sm:mb-2 sm:text-sm sm:leading-relaxed">
            <span className="font-medium">Observation:</span> {violation.observation}
          </div>
          {violation.corrective_action && (
            <div className="text-base leading-7 text-muted-foreground sm:text-sm sm:leading-relaxed">
              <span className="font-medium">Corrective Action:</span> {violation.corrective_action}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
