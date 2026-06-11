import { Droplets } from 'lucide-react'
import { StudyAreaSelector } from '@/components/StudyAreaSelector'
import { InlineAlert, StatGrid } from '@/components/ui/map-panels'
import { AppSelect } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { formatDate } from '../shared'
import { WATER_BOUNDARY_METRIC_OPTIONS, WATER_ROOT, WATER_SOURCE_OPTIONS } from './constants'
import { firstDate, firstString, formatMetricValue, formatUnknown, getHazardColorClass } from './utils'
import { EmptyWaterDetail, WaterDetailSection, WaterNoticeCard } from './WaterDetails'
import { WaterSamplingReportModal } from './WaterSamplingReportModal'
import type { WaterBoundaryLevel, WaterBoundaryMetric, WaterBoundarySource, WaterLayerMode } from './types'
import type { WaterState } from './useWaterData'

export function WaterSidebar({ water }: { water: WaterState }) {
  return (
    <>
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

      <div className="border-b border-border p-4">
        <div className="mb-3 flex items-center gap-2">
          <Droplets className="h-4 w-4 text-sky-600" />
          <h2 className="text-sm font-semibold text-foreground">Drinking Water</h2>
        </div>
        <div className="space-y-3">
          <label className="block text-xs font-medium text-foreground">
            Layer
            <AppSelect
              value={water.layerMode}
              onValueChange={(value) => water.setLayerMode(value as WaterLayerMode)}
              options={[
                { value: 'facilities', label: 'Facilities' },
                { value: 'samples', label: 'Sampling activity' },
                { value: 'notices', label: 'Active notices' },
              ]}
              className="mt-1"
              triggerClassName="h-8 rounded-md text-xs"
            />
          </label>
          {water.showBoundaries && (
            <label className="block text-xs font-medium text-foreground">
              Boundary metric
              <AppSelect
                value={water.boundaryMetric}
                onValueChange={(value) => water.setBoundaryMetric(value as WaterBoundaryMetric)}
                options={WATER_BOUNDARY_METRIC_OPTIONS}
                className="mt-1"
                triggerClassName="h-8 rounded-md text-xs"
              />
            </label>
          )}
          <StatGrid
            columns={2}
            stats={[
              { label: water.layerMode === 'notices' ? 'visible notices' : 'visible facilities', value: water.visibleFacilities.length.toLocaleString() },
              { label: 'sample rows', value: water.filteredSamples.length.toLocaleString() },
              { label: 'active notices', value: water.visibleNoticeCount.toLocaleString() },
              { label: 'mapped now', value: water.mappedFacilities.length.toLocaleString() },
            ]}
          />
          {water.selectedBoundary && <WaterBoundarySummary water={water} />}
          {water.selectedFacility && <WaterFacilityDetailCard water={water} />}
          {water.facilities.length === 0 && (water.facilitiesJson.error || water.bacteriologicalJson.error || water.chemicalJson.error || water.noticesJson.error) && (
            <InlineAlert tone="warning">
              Water JSON files were not found at {WATER_ROOT}. Copy the downloaded files into public/data/water to populate this section.
            </InlineAlert>
          )}
          {!water.facilitiesJson.error && water.facilities.length > 0 && water.mappedFacilities.length === 0 && (
            <InlineAlert tone="warning">
              The copied water facility records do not include coordinates, so this section can summarize the files and timeline but cannot place facility markers yet.
            </InlineAlert>
          )}
          {!water.geocodedLocations.error && water.facilities.length > 0 && water.mappedFacilities.length > 0 && (
            <InlineAlert>
              Using consolidated Google geocodes for mapped water locations.
            </InlineAlert>
          )}
        </div>
      </div>

      <div className="space-y-4 border-b border-border bg-background/95 p-4">
        <div>
          <h3 className="mb-2 text-sm font-medium text-foreground">Hazard Rating</h3>
          <div className="flex flex-wrap gap-2">
            {water.hazardOptions.map((rating) => {
              const selected = !water.selectedHazardRatings || water.selectedHazardRatings.includes(rating)
              return (
                <button
                  key={rating}
                  type="button"
                  onClick={() => water.toggleHazardRating(rating)}
                  className={cn(
                    'px-3 py-1 text-xs rounded-full border transition-colors',
                    selected
                      ? `${getHazardColorClass(rating)} text-white border-transparent`
                      : 'border-input bg-background text-foreground hover:bg-accent',
                  )}
                >
                  {rating}
                  <span className="ml-1 opacity-75">({(water.hazardCounts[rating] ?? 0).toLocaleString()})</span>
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-medium text-foreground">Facility Type</h3>
          <div className="flex flex-wrap gap-2">
            {water.facilityTypeOptions.map((facilityType) => {
              const selected = !water.selectedFacilityTypes || water.selectedFacilityTypes.includes(facilityType)
              return (
                <button
                  key={facilityType}
                  type="button"
                  onClick={() => water.toggleFacilityType(facilityType)}
                  className={cn(
                    'px-3 py-1 text-xs rounded-full border transition-colors',
                    selected
                      ? 'bg-sky-500 text-white border-transparent'
                      : 'border-input bg-background text-foreground hover:bg-accent',
                  )}
                >
                  {facilityType}
                  <span className="ml-1 opacity-75">({(water.facilityTypeCounts[facilityType] ?? 0).toLocaleString()})</span>
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-medium text-foreground">Sample Type</h3>
          <div className="flex flex-wrap gap-2">
            {[
              { value: 'all' as const, label: 'All', count: water.samples.length },
              { value: 'bacteriological' as const, label: 'Bacteriological', count: water.sampleKindCounts.bacteriological },
              { value: 'chemical' as const, label: 'Chemical', count: water.sampleKindCounts.chemical },
            ].map((option) => {
              const selected = water.sampleKindFilter === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => water.setSampleKindFilter(option.value)}
                  className={cn(
                    'px-3 py-1 text-xs rounded-full border transition-colors',
                    selected
                      ? 'bg-cyan-600 text-white border-transparent'
                      : 'border-input bg-background text-foreground hover:bg-accent',
                  )}
                >
                  {option.label}
                  <span className="ml-1 opacity-75">({option.count.toLocaleString()})</span>
                </button>
              )
            })}
          </div>
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
      </div>
      {water.showSelectedFacilityReport && water.selectedFacility && (
        <WaterSamplingReportModal water={water} onClose={() => water.setShowSelectedFacilityReport(false)} />
      )}
    </>
  )
}

function WaterBoundarySummary({ water }: { water: WaterState }) {
  const properties = water.selectedBoundary?.properties
  if (!properties) return null

  return (
    <div className="rounded-md border border-sky-200 bg-sky-50/80 p-3 text-xs text-sky-950 dark:border-sky-900/60 dark:bg-sky-950/25 dark:text-sky-50">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">Selected scope</div>
      <div className="mt-1 font-semibold">{properties.boundaryName}</div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
        <span className="text-sky-800/75 dark:text-sky-200/75">Facilities</span>
        <span className="text-right font-medium">{properties.facilityCount.toLocaleString()}</span>
        <span className="text-sky-800/75 dark:text-sky-200/75">Sample rows</span>
        <span className="text-right font-medium">{properties.sampleRows.toLocaleString()}</span>
        <span className="text-sky-800/75 dark:text-sky-200/75">Avg / facility</span>
        <span className="text-right font-medium">{formatMetricValue(properties.avgSamplesPerFacility, 'avgSamplesPerFacility')}</span>
        <span className="text-sky-800/75 dark:text-sky-200/75">Active notices</span>
        <span className="text-right font-medium">{properties.activeNotices.toLocaleString()}</span>
      </div>
      <button
        type="button"
        className="mt-2 text-[11px] font-medium text-sky-700 hover:text-sky-950 dark:text-sky-300 dark:hover:text-sky-100"
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

  return (
    <div className="rounded-md border border-border bg-background p-3 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-foreground">{facility.name}</div>
          <div className="mt-1 text-muted-foreground">{facility.community || facility.address || 'No locality provided'}</div>
        </div>
        <button
          type="button"
          className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
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
        {facility.noticeOnly ? 'Open notice details' : 'Open sampling report'}
      </button>

      <WaterDetailSection title="Active notices" count={water.selectedFacilityNotices.length}>
        {water.selectedFacilityNotices.length === 0 ? (
          <EmptyWaterDetail label="No active notices for this facility." />
        ) : water.selectedFacilityNotices.map((notice) => (
          <WaterNoticeCard key={notice.id} notice={notice} compact />
        ))}
      </WaterDetailSection>

      <WaterDetailSection title="Sampling" count={water.selectedFacilitySamples.length}>
        {water.selectedFacilitySamples.length === 0 ? (
          <EmptyWaterDetail label="No sample rows for this facility." />
        ) : water.selectedFacilitySamples.map((sample) => (
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

      <WaterDetailSection title="Facility history" count={water.selectedFacilityInspections.length}>
        {water.selectedFacilityInspections.length === 0 ? (
          <EmptyWaterDetail label="No inspection history included in the copied facility record." />
        ) : water.selectedFacilityInspections.map((inspection, index) => (
          <div key={`${facility.id}-inspection-${index}`} className="rounded border border-border p-2">
            <div className="flex items-start justify-between gap-2">
              <div className="font-medium text-foreground">{firstString(inspection, ['type', 'inspectionType', 'description'], `History ${index + 1}`)}</div>
              <div className="text-muted-foreground">{formatDate(firstDate(inspection, ['date', 'inspectionDate', 'inspection_date'])?.toISOString())}</div>
            </div>
            <div className="mt-1 text-muted-foreground">{firstString(inspection, ['result', 'status', 'summary', 'comments'], 'No summary listed')}</div>
          </div>
        ))}
      </WaterDetailSection>
    </div>
  )
}
