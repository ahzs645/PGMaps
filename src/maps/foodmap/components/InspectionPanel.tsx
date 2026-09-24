import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { RecordDialog, RecordEmptyState } from '@/components/ui/record-dialog'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { StatGroup } from '@/components/ui/stat-group'
import { formatFullAddress } from '../address'
import { assessViolationRisk, summarizeViolationRisk } from '../risk'
import { getHazardRating } from '../hazard'
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

const RISK_BANDS = ['Severe', 'Elevated', 'Moderate', 'Administrative'] as const
const RISK_SUMMARY_KEYS = {
  Severe: 'severe',
  Elevated: 'elevated',
  Moderate: 'moderate',
  Administrative: 'administrative',
} as const

/**
 * Period labels come in three shapes: "Oct 2025 – Sep 2026", "Through Sep
 * 2026" and "All time through Sep 2026". Lower-case the leading word of the
 * last two so they read mid-sentence; a month name keeps its capital.
 */
function periodPhrase(label: string): string {
  return /^(through|all time)\b/i.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label
}

function describePeriod(label: string): string {
  const phrase = periodPhrase(label)
  return phrase.startsWith('through') ? `Inspections ${phrase}` : `Inspections, ${phrase}`
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

function getInspectionKey(inspection: Inspection, index: number): string {
  return [
    inspection.inspection_date || inspection.date || '',
    inspection.inspection_type || inspection.type || '',
    inspection.hazard_rating,
    inspection.critical_violations_count,
    inspection.non_critical_violations_count,
    inspection.follow_up_required || '',
    inspection.violations?.length || 0,
    index,
  ].join('|')
}

export function InspectionPanel({ restaurant, periodLabel, useFilteredInspections = false, onClose }: InspectionPanelProps) {
  // When the active period is empty, open the available history immediately.
  // Keep the period view one click away so its zero counts remain inspectable.
  const [historyView, setHistoryView] = useState<boolean | null>(null)
  const showHistory = useFilteredInspections && (
    historyView ?? (restaurant.filteredInspections.length === 0 && (restaurant.inspections?.length || 0) > 0)
  )
  const inspections = useMemo(() => {
    const source = useFilteredInspections && !showHistory ? restaurant.filteredInspections : restaurant.inspections
    return source || []
  }, [restaurant, useFilteredInspections, showHistory])

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

  const currentRating = getHazardRating(restaurant)

  // Master-detail navigation: the panel shows a list of inspection cards, and
  // opening one drills into a dedicated detail view of its violations. With a
  // single inspection there is nothing to choose, so open it directly.
  const inspectionKeys = useMemo(() => inspections.map(getInspectionKey), [inspections])
  const [selectedInspectionKey, setSelectedInspectionKey] = useState<string | null>(null)
  const selectedInspection =
    inspections.length === 1
      ? inspections[0]
      : selectedInspectionKey
        ? inspections[inspectionKeys.indexOf(selectedInspectionKey)] ?? null
        : null

  const hasAnyRecords = (restaurant.inspections?.length || 0) > 0
  // The switch only earns its place when the period hides some of the history.
  const periodDiffers = useFilteredInspections && restaurant.filteredInspections.length !== (restaurant.inspections?.length || 0)
  const context = !hasAnyRecords
    ? undefined
    : showHistory || !useFilteredInspections
      ? 'All inspection history'
      : periodLabel && describePeriod(periodLabel)
  const severityCounts = RISK_BANDS.map((band) => ({ band, count: riskSummary[RISK_SUMMARY_KEYS[band]] })).filter(
    (entry) => entry.count > 0,
  )

  return (
    <RecordDialog
      title={restaurant.name}
      subtitle={formatFullAddress(restaurant)}
      context={context}
      closeLabel="Close inspection panel"
      source="Northern Health Authority HealthSpace"
      sourceHref={restaurant.details_url}
      sourceLinkLabel="View on HealthSpace"
      onClose={onClose}
      toolbar={
        hasAnyRecords && periodDiffers ? (
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl
              label="Inspection history range"
              size="sm"
              className="w-full sm:w-auto"
              value={showHistory ? 'all' : 'period'}
              onChange={(value) => {
                setHistoryView(value === 'all')
                setSelectedInspectionKey(null)
              }}
              options={[
                { value: 'period', label: 'Selected period' },
                { value: 'all', label: 'All history' },
              ]}
            />
            {showHistory && restaurant.filteredInspections.length === 0 && periodLabel && (
              <span className="text-xs text-muted-foreground">None in {periodPhrase(periodLabel)}, so all dates are shown.</span>
            )}
          </div>
        ) : undefined
      }
      summary={
        hasAnyRecords ? (
          <StatGroup
            variant="tiles"
            items={[
              { label: 'Inspections', shortLabel: 'Insp.', value: inspections.length },
              { label: 'Violations', value: totalViolations },
              { label: 'Critical', value: totalCritical, tone: totalCritical > 0 ? 'danger' : 'default' },
              {
                label: 'Current rating',
                shortLabel: 'Rating',
                compact: true,
                value: (
                  <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium sm:text-sm', getHazardColor(currentRating))}>
                    {currentRating || 'Unknown'}
                  </span>
                ),
              },
            ]}
          />
        ) : undefined
      }
      headerExtra={
        hasAnyRecords && (severityCounts.length > 0 || detailMismatchNote) ? (
          <div className="space-y-2">
            {severityCounts.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-muted-foreground">Severity</span>
                {severityCounts.map(({ band, count }) => (
                  <span key={band} className={cn('rounded-full px-2.5 py-0.5 font-medium', getRiskBandClass(band))}>
                    {count} {band.toLowerCase()}
                  </span>
                ))}
              </div>
            )}
            {detailMismatchNote && (
              <div className="flex items-start gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs leading-snug text-muted-foreground">
                <svg className="mt-0.5 h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{detailMismatchNote} The <span className="font-medium">Violations</span> count above reflects the detailed rows shown below.</span>
              </div>
            )}
          </div>
        ) : undefined
      }
    >
      {!hasAnyRecords ? (
        <RecordEmptyState
          title="No inspection records on file"
          description={`Northern Health has not published an inspection for this establishment. Its listed hazard rating is ${currentRating || 'Unknown'}.`}
        />
      ) : inspections.length === 0 ? (
        <RecordEmptyState
          title={periodLabel ? `No inspections in ${periodPhrase(periodLabel)}` : 'No inspections in this period'}
          description="Switch to All history to see earlier records."
        />
      ) : selectedInspection ? (
        <InspectionDetailView
          inspection={selectedInspection}
          showBack={inspections.length > 1}
          onBack={() => setSelectedInspectionKey(null)}
        />
      ) : (
        <div className="space-y-3 sm:space-y-4">
          <p className="px-1 text-xs text-muted-foreground">
            Select an inspection to view its violations.
          </p>
          {inspections.map((inspection, index) => (
            <InspectionSummaryCard
              key={inspectionKeys[index]}
              inspection={inspection}
              onOpen={() => setSelectedInspectionKey(inspectionKeys[index])}
            />
          ))}
        </div>
      )}
    </RecordDialog>
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
