import { Beaker, Building2, FlaskConical } from 'lucide-react'
import { StudyAreaSelector } from '@/components/StudyAreaSelector'
import { FilterChipGroup, KeyValueRows, SelectedItemCard, SidebarSection } from '@/components/ui/map-panels'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { AppSelect } from '@/components/ui/select'
import { StatGroup } from '@/components/ui/stat-group'
import { TextButton } from '@/components/ui/text-button'
import { formatNumber } from '@/lib/format'
import { formatDate } from '../shared'
import { WATER_HAZARD_DOT_COLORS, WATER_SOURCE_OPTIONS } from './constants'
import { firstDate, firstString, formatMetricValue, formatUnknown } from './utils'
import { WaterDetailSection, WaterNoticeCard } from './WaterDetails'
import { WaterSamplingReportModal } from './WaterSamplingReportModal'
import type { WaterBoundaryLevel, WaterBoundarySource, WaterLayerMode, WaterPointCategory, WaterSampleKindFilter } from './types'
import type { WaterState } from './useWaterData'

const WATER_LAYER_OPTIONS: Array<{ value: WaterLayerMode; label: string }> = [
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
        <SidebarSection className="space-y-3">
          {water.selectedBoundary && <WaterBoundarySummary water={water} />}
          {water.selectedFacility && <WaterFacilityDetailCard water={water} />}
        </SidebarSection>
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
                  count: formatNumber(water.hazardCounts[rating] ?? 0),
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
                  count: formatNumber(water.facilityTypeCounts[facilityType] ?? 0),
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

            <StatGroup
              variant="tiles"
              size="sm"
              columns={2}
              items={[
                {
                  label: 'Bacteriological',
                  value: formatNumber(water.sampleKindCounts.bacteriological),
                  icon: <Beaker className="h-3.5 w-3.5" />,
                },
                {
                  label: 'Chemical',
                  value: formatNumber(water.sampleKindCounts.chemical),
                  icon: <FlaskConical className="h-3.5 w-3.5" />,
                },
              ]}
            />
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
      <SegmentedControl label="Water data view" value={value} options={WATER_LAYER_OPTIONS} onChange={onChange} />
    </section>
  )
}

function WaterBoundarySummary({ water }: { water: WaterState }) {
  const properties = water.selectedBoundary?.properties
  if (!properties) return null
  const scopeRows = water.layerMode === 'notices'
    ? [
        { label: 'Active notices', value: formatNumber(properties.activeNotices) },
        { label: 'Notice points', value: formatNumber(properties.facilityCount) },
      ]
    : water.layerMode === 'samples'
      ? [
          { label: 'Sample rows', value: formatNumber(properties.sampleRows) },
          { label: 'Sample facilities', value: formatNumber(properties.facilityCount) },
          { label: 'Avg / facility', value: formatMetricValue(properties.avgSamplesPerFacility, 'avgSamplesPerFacility') },
        ]
      : [
          { label: 'Facilities', value: formatNumber(properties.facilityCount) },
          { label: 'Active notices', value: formatNumber(properties.activeNotices) },
        ]
  const scopeLabel = water.layerMode === 'notices'
    ? 'Selected notice scope'
    : water.layerMode === 'samples'
      ? 'Selected sample scope'
      : 'Selected facility scope'

  return (
    <SelectedItemCard tone="sky" eyebrow={scopeLabel} title={properties.boundaryName} rows={scopeRows}>
      <TextButton className="mt-2" onClick={() => water.setSelectedBoundaryId(null)}>
        Clear scope
      </TextButton>
    </SelectedItemCard>
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
        <TextButton tone="muted" onClick={() => water.setSelectedFacilityId(null)}>
          Clear
        </TextButton>
      </div>
      <KeyValueRows
        className="mt-3"
        rows={[
          { label: 'Bacteriological', value: formatNumber(facility.bacteriologicalSamples) },
          { label: 'Chemical', value: formatNumber(facility.chemicalResults) },
          { label: 'All sample rows', value: formatNumber(sampleRows) },
          { label: 'Active notices', value: formatNumber(facility.activeNotices) },
          { label: 'Last sample', value: formatDate(facility.lastSampleDate?.toISOString()) },
        ]}
      />
      {facility.geocodedAddress && (
        <div className="mt-2 border-t border-border pt-2 text-muted-foreground">
          {facility.geocodedAddress}
          {facility.geocodePartialMatch ? ' (partial match)' : ''}
        </div>
      )}
      <button
        type="button"
        className="mt-3 w-full rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-sky-700 touch:min-h-10"
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
            <KeyValueRows
              className="mt-1"
              valueClassName="font-normal"
              rows={[
                { label: 'Parameter', value: sample.parameter || formatUnknown(sample.source.type) },
                { label: 'Result', value: sample.result || formatUnknown(sample.source.value) },
                sample.kind === 'bacteriological' && { label: 'Total coliform', value: formatUnknown(sample.source.total_coliform) },
                sample.kind === 'bacteriological' && { label: 'E. coli', value: formatUnknown(sample.source.e_coli) },
              ]}
            />
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
