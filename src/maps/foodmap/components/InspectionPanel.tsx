import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { RecordDialog, RecordEmptyState } from '@/components/ui/record-dialog'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { StatGroup } from '@/components/ui/stat-group'
import { formatFullAddress } from '../address'
import { assessViolationRisk, summarizeViolationRisk } from '../risk'
import { getHazardRating } from '../hazard'
import type { RestaurantWithStats, Inspection, Violation, ViolationRiskBand } from '../types'

interface InspectionPanelProps {
  restaurant: RestaurantWithStats
  periodLabel?: string
  useFilteredInspections?: boolean
  onClose: () => void
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

/**
 * Period labels come in three shapes: "Oct 2025 – Sep 2026", "Through Sep
 * 2026" and "All time through Sep 2026". Lower-case the leading word of the
 * last two so they read mid-sentence; a month name keeps its capital.
 */
function periodPhrase(label: string): string {
  return /^(through|all time)\b/i.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label
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

  // Counts follow the itemized rows; say briefly when HealthSpace's own tally differs.
  const detailMismatchNote = [
    missingViolationDetails > 0
      ? `${missingViolationDetails} ${missingViolationDetails === 1 ? 'finding has' : 'findings have'} no itemized detail.`
      : '',
    extraViolationDetails > 0
      ? `${extraViolationDetails} itemized ${extraViolationDetails === 1 ? 'finding is' : 'findings are'} not in HealthSpace's tally.`
      : '',
  ].filter(Boolean).join(' ')

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
  const periodCount = restaurant.filteredInspections.length
  const historyCount = restaurant.inspections?.length || 0

  return (
    <RecordDialog
      title={restaurant.name}
      subtitle={formatFullAddress(restaurant)}
      closeLabel="Close inspection panel"
      // The source link sits inline with the attribution, so the footer keeps one action.
      footerStart={
        <a
          href={restaurant.details_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Northern Health HealthSpace ↗
        </a>
      }
      onClose={onClose}
      toolbar={
        hasAnyRecords && periodDiffers ? (
          // The counts say why a range is empty, so no explanatory sentence is needed.
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
              {
                value: 'period',
                label: `${periodLabel ? periodPhrase(periodLabel) : 'Selected period'} (${periodCount})`,
                title: 'Inspections in the period chosen on the map',
              },
              { value: 'all', label: `All history (${historyCount})` },
            ]}
          />
        ) : undefined
      }
      summary={
        hasAnyRecords ? (
          <div className="space-y-1.5">
            {/* Same figures row as the food sidebar, for this one establishment. */}
            <StatGroup
              items={[
                { label: inspections.length === 1 ? 'inspection' : 'inspections', value: inspections.length },
                { label: totalViolations === 1 ? 'violation' : 'violations', value: totalViolations },
                { label: 'critical', value: totalCritical, tone: totalCritical > 0 ? 'danger' : 'default' },
                {
                  label: 'hazard now',
                  value: currentRating || 'Unknown',
                  tone: currentRating === 'Low' ? 'success' : currentRating === 'Moderate' ? 'warning' : 'default',
                },
              ]}
            />
            {detailMismatchNote && (
              <p className="text-center text-xs text-muted-foreground">
                {detailMismatchNote}
              </p>
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
        <div className="space-y-2">
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
  notItemizedCount: number
}

function getInspectionCounts(inspection: Inspection): InspectionCounts {
  const violationCount = inspection.violations?.length || 0
  const criticalCount = inspection.critical_violations_count || 0
  const nonCriticalCount = inspection.non_critical_violations_count || 0
  // HealthSpace's critical/non-critical tally can exceed the itemized rows; the heading
  // says how many went unitemized so the counts never look like a math error.
  const notItemizedCount = Math.max(0, criticalCount + nonCriticalCount - violationCount)
  return { violationCount, criticalCount, notItemizedCount }
}

/** One inspection as two lines, when and then what; shared by the list row and the detail header. */
function InspectionHeading({ inspection }: { inspection: Inspection }) {
  const inspectionType = inspection.inspection_type || inspection.type || 'Inspection'
  const inspectionDate = inspection.inspection_date || inspection.date || 'Date unavailable'
  const counts = getInspectionCounts(inspection)
  const findings =
    counts.violationCount === 0
      ? 'No violations'
      : counts.criticalCount > 0
        ? `${counts.criticalCount} critical of ${counts.violationCount}`
        : `${counts.violationCount} violation${counts.violationCount === 1 ? '' : 's'}`

  return (
    <span className="min-w-0 flex-1">
      <span className="block text-sm font-medium text-foreground">{inspectionDate}</span>
      <span className="block text-xs text-muted-foreground">
        {inspectionType} ·{' '}
        <span className={cn(counts.criticalCount > 0 && 'text-red-600 dark:text-red-400')}>{findings}</span>
        {inspection.hazard_rating ? ` · ${inspection.hazard_rating} hazard` : ''}
        {inspection.follow_up_required === 'Yes' && (
          <span className="font-medium text-red-600 dark:text-red-400"> · Follow-up required</span>
        )}
        {counts.notItemizedCount > 0 && ` · ${counts.notItemizedCount} not itemized`}
      </span>
    </span>
  )
}

// List item — click to open the inspection's detail view.
function InspectionSummaryCard({ inspection, onOpen }: { inspection: Inspection; onOpen: () => void }) {
  const counts = getInspectionCounts(inspection)
  const hasViolations = counts.violationCount > 0
  const worstBand = hasViolations ? summarizeViolationRisk([inspection]).worstBand : 'Unknown'

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5 text-left shadow-sm transition-colors hover:border-sky-300 hover:bg-muted/40 dark:hover:border-sky-700"
    >
      <span
        className={cn('h-2.5 w-2.5 shrink-0 rounded-full', getRiskDotClass(worstBand, hasViolations))}
        aria-hidden="true"
      />
      <InspectionHeading inspection={inspection} />
      <svg className="h-4 w-4 shrink-0 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </button>
  )
}

// Detail view for a single inspection: its heading, then each violation.
function InspectionDetailView({ inspection, showBack, onBack }: { inspection: Inspection; showBack: boolean; onBack: () => void }) {
  return (
    <div className="space-y-3">
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

      <div className="flex px-1">
        <InspectionHeading inspection={inspection} />
      </div>

      {(inspection.violations?.length ?? 0) > 0 ? (
        <div className="space-y-2">
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
              'mb-1.5 text-sm leading-snug',
              violation.details_unavailable ? 'italic text-muted-foreground' : 'font-medium text-foreground',
            )}
          >
            {violation.description}
          </div>
          <div className="text-sm leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground/80">Observed:</span> {violation.observation}
          </div>
          {violation.corrective_action && (
            <div className="mt-1 text-sm leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground/80">Action:</span> {violation.corrective_action}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
