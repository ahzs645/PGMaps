import { Beaker, Building2, FlaskConical } from 'lucide-react'
import { StudyAreaSelector } from '@/components/StudyAreaSelector'
import { FilterChipGroup, SidebarSection } from '@/components/ui/map-panels'
import { AppSelect } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { formatDate } from '../shared'
import { WATER_HAZARD_DOT_COLORS, WATER_SOURCE_OPTIONS } from './constants'
import { firstDate, firstString, formatMetricValue, formatUnknown } from './utils'
import { WaterDetailSection, WaterNoticeCard } from './WaterDetails'
import { WaterSamplingReportModal } from './WaterSamplingReportModal'
import type { WaterBoundaryLevel, WaterBoundarySource, WaterLayerMode, WaterPointCategory, WaterSampleKindFilter } from './types'
import type { WaterState } from './useWaterData'

const WATER_LAYER_OPTIONS: Array<{
  value: WaterLayerMode
  label: string
}> = [
  { value: 'facilities', label: 'Facilities' },
  { value: 'samples', label: 'Samples' },
  { value: 'notices', label: 'Notices' },
]

function getHazardDotColor(rating: string): string {
  return WATER_HAZARD_DOT_COLORS[rating] ?? WATER_HAZARD_DOT_COLORS.Unknown
}

export function WaterSidebar({ water }: { water: WaterState }) {
  const selectedHazardRatings = water.selectedHazardRatings ?? water.hazardOptions
  const selectedFacilityTypes = water.selectedFacilityTypes ?? water.facilityTypeOptions
  const sampleFilterItems: Array<{ value: WaterSampleKindFilter; label: string; color: string }> = [
    { value: 'all', label: 'All rows', color: '#0ea5e9' },
    { value: 'bacteriological', label: 'Bacteriological', color: '#0891b2' },
    { value: 'chemical', label: 'Chemical', color: '#7c3aed' },
  ]
  const handleLayerModeChange = (mode: WaterLayerMode) => {
    const pointCategory: WaterPointCategory = mode === 'notices' ? 'notice' : mode === 'samples' ? 'samples' : 'facility'
    water.setLayerMode(mode)
    water.setBoundaryMetric(mode === 'notices' ? 'activeNotices' : mode === 'samples' ? 'sampleRows' : 'facilities')
    water.setShowPoints(true)
    if (!water.visiblePointCategories.includes(pointCategory)) water.togglePointCategory(pointCategory)
  }

  return (
    <>
      <WaterLayerTabs value={water.layerMode} onChange={handleLayerModeChange} />

      <StudyAreaSelector<WaterBoundarySource, WaterBoundaryLevel>
        source={water.showBoundaries ? water.boundarySource : undefined}
        sourceOptions={WATER_SOURCE_OPTIONS}
        level={water.boundaryLevel}
        levelOptions={water.showBoundaries ? water.boundaryLevelOptions : []}
        onSourceChange={water.handleBoundarySourceChange}
        onSelectedSourceClick={() => water.setShowBoundaries(false)}
        onLevelChange={water.setBoundaryLevel}
        levelSelectId="water-study-area-level"
      />

      {(water.selectedBoundary || water.selectedFacility) && (
        <section className="border-b border-border bg-background/95 p-4">
          <div className="space-y-3">
          {water.selectedBoundary && <WaterBoundarySummary water={water} />}
          {water.selectedFacility && <WaterFacilityDetailCard water={water} />}
          </div>
        </section>
      )}

      {water.layerMode !== 'notices' && (
        <SidebarSection title="Facility filters" icon={Building2}>
          <div className="space-y-4">
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-xs font-medium text-foreground">Hazard rating</h3>
                <span className="text-xs text-muted-foreground">{selectedHazardRatings.length} of {water.hazardOptions.length}</span>
              </div>
              <FilterChipGroup
                items={water.hazardOptions.map((rating) => ({
                  value: rating,
                  label: rating,
                  count: (water.hazardCounts[rating] ?? 0).toLocaleString(),
                  color: getHazardDotColor(rating),
                }))}
                selectedValues={selectedHazardRatings}
                onToggle={water.toggleHazardRating}
                layout="wrap"
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-xs font-medium text-foreground">Connection size</h3>
                <span className="text-xs text-muted-foreground">{selectedFacilityTypes.length} of {water.facilityTypeOptions.length}</span>
              </div>
              <FilterChipGroup
                items={water.facilityTypeOptions.map((facilityType) => ({
                  value: facilityType,
                  label: facilityType,
                  count: (water.facilityTypeCounts[facilityType] ?? 0).toLocaleString(),
                  color: '#0284c7',
                }))}
                selectedValues={selectedFacilityTypes}
                onToggle={water.toggleFacilityType}
                layout="wrap"
              />
            </div>
          </div>
        </SidebarSection>
      )}

      {water.layerMode === 'samples' && (
        <SidebarSection title="Sampling filters" icon={FlaskConical}>
          <div className="space-y-4">
            <div>
              <h3 className="mb-2 text-xs font-medium text-foreground">Sample type</h3>
              <FilterChipGroup
                items={sampleFilterItems}
                selectedValues={[water.sampleKindFilter]}
                onToggle={(value) => water.setSampleKindFilter(value)}
                layout="wrap"
                chipClassName="justify-center rounded-md py-1"
              />
            </div>

            <label className="block text-xs font-medium text-foreground">
              Sample parameter
              <AppSelect
                value={water.sampleParameterFilter}
                onValueChange={water.setSampleParameterFilter}
                options={[
                  { value: 'all', label: 'All parameters' },
                  ...water.sampleParameterOptions,
                ]}
                className="mt-1"
                triggerClassName="h-8 rounded-md text-xs"
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded border border-border bg-background p-2">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Beaker className="h-3 w-3" />
                  Bacteriological
                </div>
                <div className="mt-1 text-sm font-semibold text-foreground">{water.sampleKindCounts.bacteriological.toLocaleString()}</div>
              </div>
              <div className="rounded border border-border bg-background p-2">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <FlaskConical className="h-3 w-3" />
                  Chemical
                </div>
                <div className="mt-1 text-sm font-semibold text-foreground">{water.sampleKindCounts.chemical.toLocaleString()}</div>
              </div>
            </div>
          </div>
        </SidebarSection>
      )}

      {water.showSelectedFacilityReport && water.selectedFacility && (
        <WaterSamplingReportModal water={water} onClose={() => water.setShowSelectedFacilityReport(false)} />
      )}
    </>
  )
}

function WaterLayerTabs({
  value,
  onChange,
}: {
  value: WaterLayerMode
  onChange: (value: WaterLayerMode) => void
}) {
  return (
    <section className="border-b border-border p-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Water view</h3>
      <div
        role="tablist"
        aria-label="Water data view"
        className="grid grid-cols-3 rounded-lg border border-border bg-muted/40 p-0.5"
      >
        {WATER_LAYER_OPTIONS.map((option) => {
          const active = value === option.value
          return (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(option.value)}
              className={cn(
                'rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
                active
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </section>
  )
}

function WaterBoundarySummary({ water }: { water: WaterState }) {
  const properties = water.selectedBoundary?.properties
  if (!properties) return null
  const scopeRows = water.layerMode === 'notices'
    ? [
        { label: 'Active notices', value: properties.activeNotices.toLocaleString(), emphasis: true },
        { label: 'Notice points', value: properties.facilityCount.toLocaleString() },
      ]
    : water.layerMode === 'samples'
      ? [
          { label: 'Sample rows', value: properties.sampleRows.toLocaleString(), emphasis: true },
          { label: 'Sample facilities', value: properties.facilityCount.toLocaleString() },
          { label: 'Avg / facility', value: formatMetricValue(properties.avgSamplesPerFacility, 'avgSamplesPerFacility') },
        ]
      : [
          { label: 'Facilities', value: properties.facilityCount.toLocaleString(), emphasis: true },
          { label: 'Active notices', value: properties.activeNotices.toLocaleString() },
        ]
  const scopeLabel = water.layerMode === 'notices'
    ? 'Selected notice scope'
    : water.layerMode === 'samples'
      ? 'Selected sample scope'
      : 'Selected facility scope'

  return (
    <div className="rounded-md border border-sky-200 bg-sky-50/80 p-3 text-xs text-sky-950 dark:border-sky-900/60 dark:bg-sky-950/25 dark:text-sky-50">
      <div className="text-xs font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">{scopeLabel}</div>
      <div className="mt-1 font-semibold">{properties.boundaryName}</div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
        {scopeRows.map((row) => (
          <div key={row.label} className="contents">
            <span className="text-sky-800/75 dark:text-sky-200/75">{row.label}</span>
            <span className={cn('text-right font-medium', row.emphasis && 'text-sky-950 dark:text-sky-50')}>{row.value}</span>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="mt-2 text-xs font-medium text-sky-700 hover:text-sky-950 dark:text-sky-300 dark:hover:text-sky-100"
        onClick={() => water.setSelectedBoundaryId(null)}
      >
        Clear scope
      </button>
    </div>
  )
}

function WaterFacilityDetailCard({ water }: { water: WaterState }) {
  const facility = water.selectedFacility
  if (!facility) return null
  const sampleRows = facility.bacteriologicalSamples + facility.chemicalResults
  const showNoticeDetails = water.layerMode === 'notices' && water.selectedFacilityNotices.length > 0
  const showSamplingDetails = water.layerMode === 'samples' && water.selectedFacilitySamples.length > 0
  const showHistoryDetails = water.layerMode === 'facilities' && water.selectedFacilityInspections.length > 0
  const reportButtonLabel = water.layerMode === 'notices' || facility.noticeOnly
    ? 'Open notice details'
    : water.layerMode === 'samples'
      ? 'Open sampling report'
      : 'Open facility report'

  return (
    <div className="rounded-md border border-border bg-background p-3 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-foreground">{facility.name}</div>
          <div className="mt-1 text-muted-foreground">{facility.community || facility.address || 'No locality provided'}</div>
        </div>
        <button
          type="button"
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
          onClick={() => water.setSelectedFacilityId(null)}
        >
          Clear
        </button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1">
        <span className="text-muted-foreground">Bacteriological</span>
        <span className="text-right font-medium">{facility.bacteriologicalSamples.toLocaleString()}</span>
        <span className="text-muted-foreground">Chemical</span>
        <span className="text-right font-medium">{facility.chemicalResults.toLocaleString()}</span>
        <span className="text-muted-foreground">All sample rows</span>
        <span className="text-right font-medium">{sampleRows.toLocaleString()}</span>
        <span className="text-muted-foreground">Active notices</span>
        <span className="text-right font-medium">{facility.activeNotices.toLocaleString()}</span>
        <span className="text-muted-foreground">Last sample</span>
        <span className="text-right font-medium">{formatDate(facility.lastSampleDate?.toISOString())}</span>
      </div>
      {facility.geocodedAddress && (
        <div className="mt-2 border-t border-border pt-2 text-muted-foreground">
          {facility.geocodedAddress}
          {facility.geocodePartialMatch ? ' (partial match)' : ''}
        </div>
      )}
      <button
        type="button"
        className="mt-3 w-full rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-sky-700"
        onClick={() => water.setShowSelectedFacilityReport(true)}
      >
        {reportButtonLabel}
      </button>

      {showNoticeDetails && (
        <WaterDetailSection title="Active notices" count={water.selectedFacilityNotices.length}>
          {water.selectedFacilityNotices.map((notice) => (
          <WaterNoticeCard key={notice.id} notice={notice} compact />
          ))}
        </WaterDetailSection>
      )}

      {showSamplingDetails && (
        <WaterDetailSection title="Sampling" count={water.selectedFacilitySamples.length}>
          {water.selectedFacilitySamples.map((sample) => (
          <div key={sample.id} className="rounded border border-border p-2">
            <div className="flex items-start justify-between gap-2">
              <div className="font-medium capitalize text-foreground">{sample.kind}</div>
              <div className="text-muted-foreground">{formatDate(sample.date?.toISOString())}</div>
            </div>
            <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1 text-muted-foreground">
              <span>Parameter</span>
              <span className="text-right text-foreground">{sample.parameter || formatUnknown(sample.source.type)}</span>
              <span>Result</span>
              <span className="text-right text-foreground">{sample.result || formatUnknown(sample.source.value)}</span>
              {sample.kind === 'bacteriological' && (
                <>
                  <span>Total coliform</span>
                  <span className="text-right text-foreground">{formatUnknown(sample.source.total_coliform)}</span>
                  <span>E. coli</span>
                  <span className="text-right text-foreground">{formatUnknown(sample.source.e_coli)}</span>
                </>
              )}
            </div>
          </div>
          ))}
        </WaterDetailSection>
      )}

      {showHistoryDetails && (
        <WaterDetailSection title="Facility history" count={water.selectedFacilityInspections.length}>
          {water.selectedFacilityInspections.map((inspection, index) => (
          <div key={`${facility.id}-inspection-${index}`} className="rounded border border-border p-2">
            <div className="flex items-start justify-between gap-2">
              <div className="font-medium text-foreground">{firstString(inspection, ['type', 'inspectionType', 'description'], `History ${index + 1}`)}</div>
              <div className="text-muted-foreground">{formatDate(firstDate(inspection, ['date', 'inspectionDate', 'inspection_date'])?.toISOString())}</div>
            </div>
            <div className="mt-1 text-muted-foreground">{firstString(inspection, ['result', 'status', 'summary', 'comments'], 'No summary listed')}</div>
          </div>
          ))}
        </WaterDetailSection>
      )}
    </div>
  )
}
