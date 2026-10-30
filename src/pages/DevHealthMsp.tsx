import { useEffect, useMemo, useState } from 'react'
import { Clock, FlaskConical, Hospital, MapPin, Stethoscope } from 'lucide-react'
import { Map, MapControls, MapMarker, MarkerContent, useMap } from '@/components/ui/map'
import { AppSelect } from '@/components/ui/select'
import { Timeline } from '@/components/ui/timeline'
import { MAP_SIDEBAR_CLASS, MapSectionLayout } from '@/components/layout/MapSectionLayout'
import {
  FilterChipGroup,
  KeyValueRows,
  LegendItem,
  MapLegendPanel,
  MapSidebarShell,
  SearchInput,
  SidebarSection,
  StatGrid,
} from '@/components/ui/map-panels'
import { MapPopupCard } from '@/components/ui/map-popup-card'
import { ListHeader, ListState, ResultRow } from '@/components/ui/result-list'
import { VirtualResultList } from '@/components/ui/virtual-result-list'
import { useFetchData } from '@/hooks/useFetchData'
import { cn } from '@/lib/utils'
import { formatCompactCurrency, formatPercent as formatPercentFraction } from '@/lib/format'

const MSP_FACILITIES_URL = '/data/health/msp-facilities.geojson'
const MAP_CENTER: [number, number] = [-124.7, 53.3]

type PayeeType = 'hospital' | 'clinic' | 'diagnostic_facility'
type TypeFilter = 'all' | PayeeType

interface MspFacilityProperties {
  id: string
  payeeName: string
  payeeType: PayeeType
  fiscalYearCount: number
  firstFiscalYear: string
  latestFiscalYear: string
  firstFiscalStartYear: number
  latestFiscalStartYear: number
  totalAmount: number
  maxAnnualAmount: number
  averageAnnualAmount: number
  annualPayments?: Array<{
    fiscalYear: string
    fiscalStartYear: number
    amount: number
  }>
  matchMethod: string
  matchScore: number
  matchedName: string | null
  matchedAddress: string | null
  matchedLocality: string | null
  matchedPostalCode: string | null
  matchedPhone: string | number | null
  matchedWebsite: string | null
  matchedHealthAuthority: string | null
}

type MspFacility = GeoJSON.Feature<GeoJSON.Point, MspFacilityProperties>

interface MspFacilityCollection extends GeoJSON.FeatureCollection<GeoJSON.Point, MspFacilityProperties> {
  metadata?: {
    generatedAt?: string
    facilityPayees?: number
    matchedFacilities?: number
    unmatchedFacilities?: number
    totalAmount?: number
    matchedAmount?: number
    matchedAmountShare?: number
    fiscalStartYearRange?: {
      min: number
      max: number
    }
  }
}

const TYPE_META: Record<PayeeType, { label: string; color: string; swatch: string; marker: string; icon: typeof Hospital }> = {
  hospital: {
    label: 'Hospitals',
    color: '#ef4444',
    swatch: 'bg-red-500',
    marker: 'border-red-100 bg-red-600 text-white shadow-red-950/20',
    icon: Hospital,
  },
  clinic: {
    label: 'Clinics',
    color: '#10b981',
    swatch: 'bg-emerald-500',
    marker: 'border-emerald-100 bg-emerald-600 text-white shadow-emerald-950/20',
    icon: Stethoscope,
  },
  diagnostic_facility: {
    label: 'Diagnostics',
    color: '#0ea5e9',
    swatch: 'bg-sky-500',
    marker: 'border-sky-100 bg-sky-600 text-white shadow-sky-950/20',
    icon: FlaskConical,
  },
}

function DevHealthMsp() {
  const { data: source, loading, error } = useFetchData<MspFacilityCollection>(MSP_FACILITIES_URL, {
    transform: (json) => {
      const collection = json as MspFacilityCollection
      if (!Array.isArray(collection?.features)) throw new Error('The MSP facility layer has no feature collection.')
      return collection
    },
  })
  const facilities = useMemo(() => source?.features.filter((feature) => feature.geometry?.type === 'Point') ?? [], [source])
  const metadata = source?.metadata
  const [selected, setSelected] = useState<MspFacility | null>(null)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [showTimeline, setShowTimeline] = useState(false)
  const [timelineSelection, setTimelineDate] = useState<Date | null>(null)
  const maxFiscalYear = metadata?.fiscalStartYearRange?.max
  const timelineDate = useMemo(() => timelineSelection ?? new Date(Number.isFinite(maxFiscalYear) ? Number(maxFiscalYear) : 2024, 0, 1), [timelineSelection, maxFiscalYear])

  const fiscalYearRange = useMemo(() => {
    const metadataRange = metadata?.fiscalStartYearRange
    if (metadataRange && Number.isFinite(metadataRange.min) && Number.isFinite(metadataRange.max)) {
      return metadataRange
    }
    return facilities.reduce((range, feature) => ({
      min: Math.min(range.min, feature.properties.firstFiscalStartYear),
      max: Math.max(range.max, feature.properties.latestFiscalStartYear),
    }), { min: 2014, max: 2024 })
  }, [facilities, metadata?.fiscalStartYearRange])

  const selectedFiscalStartYear = timelineDate.getFullYear()
  const timelineYearOptions = useMemo(() => (
    Array.from({ length: Math.max(0, fiscalYearRange.max - fiscalYearRange.min + 1) }, (_, index) => fiscalYearRange.min + index)
  ), [fiscalYearRange.max, fiscalYearRange.min])
  const selectedFiscalYears = useMemo(() => {
    if (showTimeline) return new Set([selectedFiscalStartYear])
    return fiscalYearsForWindow(fiscalYearRange.max, -1, fiscalYearRange.min)
  }, [fiscalYearRange.max, fiscalYearRange.min, selectedFiscalStartYear, showTimeline])

  const baseFilteredFacilities = useMemo(() => {
    const term = query.trim().toLowerCase()
    return facilities.filter((feature) => {
      const props = feature.properties
      if (typeFilter !== 'all' && props.payeeType !== typeFilter) return false
      if (!term) return true
      return [
        props.payeeName,
        props.matchedName,
        props.matchedLocality,
        props.matchedHealthAuthority,
        props.matchedAddress,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    })
  }, [facilities, query, typeFilter])

  const filteredFacilities = useMemo(
    () => baseFilteredFacilities.filter((feature) => periodAmount(feature, selectedFiscalYears) > 0),
    [baseFilteredFacilities, selectedFiscalYears],
  )

  const timelineBucketCounts = useMemo(() => {
    const counts = new globalThis.Map<string, number>()
    for (let year = fiscalYearRange.min; year <= fiscalYearRange.max; year += 1) counts.set(String(year), 0)
    for (const feature of baseFilteredFacilities) {
      for (const payment of feature.properties.annualPayments ?? []) {
        counts.set(String(payment.fiscalStartYear), (counts.get(String(payment.fiscalStartYear)) ?? 0) + payment.amount)
      }
    }
    return counts
  }, [baseFilteredFacilities, fiscalYearRange.max, fiscalYearRange.min])

  const stats = useMemo(() => {
    const visibleAmount = filteredFacilities.reduce((sum, feature) => sum + periodAmount(feature, selectedFiscalYears), 0)
    const byType = filteredFacilities.reduce<Record<PayeeType, number>>((acc, feature) => {
      acc[feature.properties.payeeType] += 1
      return acc
    }, { hospital: 0, clinic: 0, diagnostic_facility: 0 })
    return {
      byType,
      visible: filteredFacilities.length,
      visibleAmount,
    }
  }, [filteredFacilities, selectedFiscalYears])

  const timelineStatsLabel = `${stats.visible} visible | ${formatCurrency(stats.visibleAmount)}`
  const timelinePeriodLabel = showTimeline
    ? `Fiscal year ${selectedFiscalStartYear}/${selectedFiscalStartYear + 1}`
    : timelineWindowLabel(fiscalYearRange.max, -1, fiscalYearRange.min)

  const sidebar = (
    <MapSidebarShell
      className={cn(MAP_SIDEBAR_CLASS, 'min-w-0')}
      title="MSP payments"
      subtitle="Blue Book facility locations"
      titleClassName="text-base"
      scrollClassName="md:pr-1"
    >
      <SidebarSection
        title="Timeline"
        actions={(
          <button
            type="button"
            onClick={() => setShowTimeline((current) => !current)}
            className={cn(
              'flex size-8 items-center justify-center rounded-lg transition-colors touch:size-10',
              showTimeline ? 'bg-sky-500 text-white hover:bg-sky-600' : 'bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
            aria-pressed={showTimeline}
            title={showTimeline ? 'Hide timeline' : 'Show timeline'}
          >
            <Clock className="size-4" />
          </button>
        )}
      >
        {showTimeline ? (
          <AppSelect
            value={String(selectedFiscalStartYear)}
            onValueChange={(value) => setTimelineDate(new Date(Number(value), 0, 1))}
            options={timelineYearOptions.map((year) => ({ value: String(year), label: String(year) }))}
            className="w-full"
            triggerClassName="h-9 rounded-md text-sm"
          />
        ) : (
          <p className="text-xs leading-5 text-muted-foreground">Showing cumulative mapped MSP payments.</p>
        )}
      </SidebarSection>

      <SidebarSection>
        <StatGrid
          columns={2}
          stats={[
            { label: 'Mapped payees', value: String(metadata?.matchedFacilities ?? facilities.length) },
            { label: 'Unmatched', value: String(metadata?.unmatchedFacilities ?? '--') },
            { label: 'Mapped amount', value: formatCurrency(metadata?.matchedAmount ?? stats.visibleAmount) },
            { label: 'Coverage', value: formatPercent(metadata?.matchedAmountShare) },
          ]}
        />
      </SidebarSection>

      <SidebarSection title="Search">
        <SearchInput
          id="msp-search"
          aria-label="Search MSP facilities"
          icon
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery('')}
          placeholder="Facility, city, address"
        />
      </SidebarSection>

      <SidebarSection title="Facility type">
        <FilterChipGroup<TypeFilter>
          layout="grid"
          columns={2}
          showDot={false}
          items={[
            { value: 'all', label: 'All', count: facilities.length },
            { value: 'hospital', label: TYPE_META.hospital.label, count: stats.byType.hospital, color: TYPE_META.hospital.color },
            { value: 'clinic', label: TYPE_META.clinic.label, count: stats.byType.clinic, color: TYPE_META.clinic.color },
            { value: 'diagnostic_facility', label: TYPE_META.diagnostic_facility.label, count: stats.byType.diagnostic_facility, color: TYPE_META.diagnostic_facility.color },
          ]}
          selectedValues={[typeFilter]}
          onToggle={(value) => setTypeFilter(value)}
          selectedClassName="border-sky-500 text-sky-700 dark:text-sky-300"
          chipClassName="justify-center rounded-md py-1.5"
        />
      </SidebarSection>

      <SidebarSection
        title="Visible facilities"
        actions={<span className="rounded-md border bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground">{stats.visible}</span>}
      >
        <div className="space-y-2">
          <p className="text-xs leading-5 text-muted-foreground">{timelinePeriodLabel}</p>
          <ListHeader count={filteredFacilities.length} noun={['facility', 'facilities']} sticky={false} />
          <ListState loading={loading} error={error} empty={!filteredFacilities.length} emptyLabel="No matching facilities." onReset={() => { setQuery(''); setTypeFilter('all') }}>
            <VirtualResultList items={filteredFacilities} getKey={(feature) => feature.properties.id} estimateSize={65} label="MSP facilities">
              {(feature) => (
                <FacilityListButton
                  feature={feature}
                  amount={periodAmount(feature, selectedFiscalYears)}
                  selected={selected?.properties.id === feature.properties.id}
                  onSelect={setSelected}
                />
              )}
            </VirtualResultList>
          </ListState>
        </div>
      </SidebarSection>
    </MapSidebarShell>
  )

  return (
    <MapSectionLayout
      sidebar={sidebar}
      desktopSidebarWidth={380}
      mobileInitialSheetState="half"
      selectedFeatureMobilePeek={selected ? {
        title: selected.properties.payeeName,
        subtitle: selected.properties.matchedLocality ?? selected.properties.matchedName ?? undefined,
      } : undefined}
      showMobilePeek={Boolean(selected)}
      mobileSnapTo={selected ? 'collapsed' : undefined}
      mobileSnapKey={selected?.properties.id ?? 'msp-controls'}
      className="bg-background"
    >
      <Map
        center={MAP_CENTER}
        zoom={4.7}
        minZoom={3}
        maxZoom={16}
        loading={loading}
        className="h-full"
       controls={<MapControls position="top-right" showFullscreen showLocate />}>
        <ZoomToSelected selected={selected} />
        <MapLegendPanel
          title="Legend"
          collapsible
          defaultCollapsed="mobile"
          elevated
          width="fit"
          contentClassName="space-y-0.5 text-xs"
        >
          {(Object.keys(TYPE_META) as PayeeType[]).map((type) => (
            <LegendItem key={type} color={TYPE_META[type].color} label={TYPE_META[type].label} value={stats.byType[type]} />
          ))}
        </MapLegendPanel>
        <MspMarkers facilities={filteredFacilities} selectedYears={selectedFiscalYears} selectedId={selected?.properties.id ?? null} onSelect={setSelected} />
        {selected && <SelectedPanel feature={selected} selectedYears={selectedFiscalYears} periodLabel={timelinePeriodLabel} onClose={() => setSelected(null)} />}
        {showTimeline && timelineYearOptions.length > 1 && (
          <Timeline
            startDate={new Date(fiscalYearRange.min, 0, 1)}
            endDate={new Date(fiscalYearRange.max, 0, 1)}
            currentDate={timelineDate}
            onDateChange={setTimelineDate}
            bucketCounts={timelineBucketCounts}
            bucketValueFormatter={formatCurrency}
            bucketValueLabel="MSP payments"
            granularity="year"
            percentChangeMode={{ enabled: true, label: 'YoY' }}
            statsLabel={timelineStatsLabel}
          />
        )}
      </Map>
    </MapSectionLayout>
  )
}

function MspMarkers({
  facilities,
  selectedYears,
  selectedId,
  onSelect,
}: {
  facilities: MspFacility[]
  selectedYears: Set<number>
  selectedId: string | null
  onSelect: (feature: MspFacility) => void
}) {
  return (
    <>
      {facilities.map((feature) => {
        const [longitude, latitude] = feature.geometry.coordinates
        const props = feature.properties
        const Icon = TYPE_META[props.payeeType].icon
        const amount = periodAmount(feature, selectedYears)
        return (
          <MapMarker key={props.id} longitude={longitude} latitude={latitude} anchor="center">
            <MarkerContent>
              <button
                type="button"
                onClick={() => onSelect(feature)}
                aria-label={props.payeeName}
                className={cn(
                  'flex items-center justify-center rounded-full border-2 shadow-lg transition-transform hover:scale-110',
                  markerSize(amount),
                  TYPE_META[props.payeeType].marker,
                  selectedId === props.id && 'ring-2 ring-sky-400 ring-offset-2 ring-offset-background',
                )}
              >
                <Icon className="size-4" />
              </button>
            </MarkerContent>
          </MapMarker>
        )
      })}
    </>
  )
}

function SelectedPanel({
  feature,
  selectedYears,
  periodLabel,
  onClose,
}: {
  feature: MspFacility
  selectedYears: Set<number>
  periodLabel: string
  onClose: () => void
}) {
  const props = feature.properties
  const amount = periodAmount(feature, selectedYears)
  return (
    <div className="absolute left-3 right-3 z-20 rounded-md border border-border bg-background/95 px-4 py-3 shadow-xl backdrop-blur bottom-[calc(var(--map-timeline-height,0px)+0.75rem)] md:left-auto md:right-4 md:w-[360px]">
      <MapPopupCard
        className="space-y-3"
        eyebrow={TYPE_META[props.payeeType].label}
        title={props.payeeName}
        subtitle={(
          <span className="mt-1 flex items-center gap-1">
            <MapPin className="size-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{props.matchedLocality ?? 'BC'}</span>
          </span>
        )}
        onClose={onClose}
      >
        <div className="rounded-md border bg-muted/35 px-3 py-2">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">MSP payments</div>
          <div className="mt-0.5 text-xl font-semibold">{formatCurrency(amount)}</div>
          <div className="mt-1 text-xs text-muted-foreground">{periodLabel}</div>
        </div>
        <KeyValueRows
          size="sm"
          valueMaxWidth="max-w-[210px]"
          className="space-y-1.5"
          rows={[
            { label: 'Matched location', value: props.matchedName ?? props.payeeName },
            { label: 'Address', value: props.matchedAddress ?? '--' },
            { label: 'Health authority', value: props.matchedHealthAuthority ?? '--' },
            { label: 'Max annual', value: formatCurrency(props.maxAnnualAmount) },
            { label: 'Average annual', value: formatCurrency(props.averageAnnualAmount) },
            { label: 'Join method', value: `${props.matchMethod} (${formatPercent(props.matchScore)})` },
          ]}
        />
      </MapPopupCard>
    </div>
  )
}

function ZoomToSelected({ selected }: { selected: MspFacility | null }) {
  const { map, isLoaded } = useMap()
  useEffect(() => {
    if (!map || !isLoaded || !selected) return
    const [longitude, latitude] = selected.geometry.coordinates
    map.flyTo({ center: [longitude, latitude], zoom: Math.max(map.getZoom(), 9), duration: 650 })
  }, [isLoaded, map, selected])
  return null
}

function FacilityListButton({
  feature,
  amount,
  selected,
  onSelect,
}: {
  feature: MspFacility
  amount: number
  selected: boolean
  onSelect: (feature: MspFacility) => void
}) {
  const props = feature.properties
  const Icon = TYPE_META[props.payeeType].icon
  return (
    <ResultRow
      onClick={() => onSelect(feature)}
      selected={selected}
      accent="sky"
      className="rounded-md border border-border"
      title={props.payeeName}
      subtitle={[props.matchedLocality, formatCurrency(amount)].filter(Boolean).join(' · ')}
      leading={(
        <span className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-white', TYPE_META[props.payeeType].swatch)}>
          <Icon className="size-3.5" />
        </span>
      )}
    />
  )
}

function markerSize(amount: number): string {
  if (amount >= 100_000_000) return 'size-11'
  if (amount >= 25_000_000) return 'size-10'
  if (amount >= 5_000_000) return 'size-9'
  return 'size-8'
}

function fiscalYearsForWindow(selectedYear: number, windowSize: number, minYear: number): Set<number> {
  if (windowSize === -1) {
    const years = new Set<number>()
    for (let year = minYear; year <= selectedYear; year += 1) years.add(year)
    return years
  }
  const start = Math.max(minYear, selectedYear - Math.max(1, windowSize) + 1)
  const years = new Set<number>()
  for (let year = start; year <= selectedYear; year += 1) years.add(year)
  return years
}

function periodAmount(feature: MspFacility, years: Set<number>): number {
  return (feature.properties.annualPayments ?? []).reduce(
    (sum, payment) => years.has(payment.fiscalStartYear) ? sum + payment.amount : sum,
    0,
  )
}

function timelineWindowLabel(selectedYear: number, windowSize: number, minYear: number): string {
  const fiscalYear = `${selectedYear}/${selectedYear + 1}`
  if (windowSize === -1) return `Cumulative through ${fiscalYear}`
  const start = Math.max(minYear, selectedYear - Math.max(1, windowSize) + 1)
  if (start === selectedYear) return `Fiscal year ${fiscalYear}`
  return `Fiscal years ${start}/${start + 1} to ${fiscalYear}`
}

function formatCurrency(value: number | null | undefined): string {
  return formatCompactCurrency(value, { fallback: '--' })
}

function formatPercent(value: number | null | undefined): string {
  return formatPercentFraction(value, { fallback: '--' })
}

export default DevHealthMsp
