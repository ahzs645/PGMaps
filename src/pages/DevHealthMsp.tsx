import { useEffect, useMemo, useState } from 'react'
import { CircleDollarSign, FlaskConical, Hospital, MapPin, Search, Stethoscope, X } from 'lucide-react'
import { Map, MapControls, MapMarker, MarkerContent, useMap } from '@/components/ui/map'
import { Timeline } from '@/components/ui/timeline'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { cn } from '@/lib/utils'

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

const TYPE_META: Record<PayeeType, { label: string; swatch: string; marker: string; icon: typeof Hospital }> = {
  hospital: {
    label: 'Hospitals',
    swatch: 'bg-red-500',
    marker: 'border-red-100 bg-red-600 text-white shadow-red-950/20',
    icon: Hospital,
  },
  clinic: {
    label: 'Clinics',
    swatch: 'bg-emerald-500',
    marker: 'border-emerald-100 bg-emerald-600 text-white shadow-emerald-950/20',
    icon: Stethoscope,
  },
  diagnostic_facility: {
    label: 'Diagnostics',
    swatch: 'bg-sky-500',
    marker: 'border-sky-100 bg-sky-600 text-white shadow-sky-950/20',
    icon: FlaskConical,
  },
}

function DevHealthMsp() {
  const [showSidebar, setShowSidebar] = useState(true)
  const [facilities, setFacilities] = useState<MspFacility[]>([])
  const [metadata, setMetadata] = useState<MspFacilityCollection['metadata']>()
  const [selected, setSelected] = useState<MspFacility | null>(null)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [timelineDate, setTimelineDate] = useState(() => new Date(2024, 0, 1))
  const [timelineWindowSize, setTimelineWindowSize] = useState(-1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    async function loadFacilities() {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(MSP_FACILITIES_URL, { signal: controller.signal })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await response.json() as MspFacilityCollection
        setFacilities(data.features.filter((feature) => feature.geometry?.type === 'Point'))
        setMetadata(data.metadata)
        const maxYear = data.metadata?.fiscalStartYearRange?.max
        if (Number.isFinite(maxYear)) setTimelineDate(new Date(Number(maxYear), 0, 1))
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setError('Failed to load MSP facility layer.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    loadFacilities()
    return () => controller.abort()
  }, [])

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
  const selectedFiscalYears = useMemo(
    () => fiscalYearsForWindow(selectedFiscalStartYear, timelineWindowSize, fiscalYearRange.min),
    [fiscalYearRange.min, selectedFiscalStartYear, timelineWindowSize],
  )

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
    const counts = new Map<string, number>()
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
    const byType = facilities.reduce<Record<PayeeType, number>>((acc, feature) => {
      acc[feature.properties.payeeType] += 1
      return acc
    }, { hospital: 0, clinic: 0, diagnostic_facility: 0 })
    return {
      byType,
      visible: filteredFacilities.length,
      visibleAmount,
    }
  }, [facilities, filteredFacilities, selectedFiscalYears])

  const timelineStatsLabel = `${stats.visible} visible | ${formatCurrency(stats.visibleAmount)}`
  const timelinePeriodLabel = timelineWindowLabel(selectedFiscalStartYear, timelineWindowSize, fiscalYearRange.min)

  const sidebar = (
    <aside className="flex h-full w-full min-w-0 flex-col bg-background/95 md:w-[380px] md:border-r md:shadow-xl">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="rounded-md border bg-muted p-2">
            <CircleDollarSign className="size-4" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-semibold leading-tight">MSP facility payments</h1>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              BC MSP Blue Book payees joined to BC provider locations.
            </p>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 md:pr-5">
        <section className="grid grid-cols-2 gap-2">
          <StatCard label="Mapped payees" value={String(metadata?.matchedFacilities ?? facilities.length)} />
          <StatCard label="Unmatched" value={String(metadata?.unmatchedFacilities ?? '--')} />
          <StatCard label="Mapped amount" value={formatCurrency(metadata?.matchedAmount ?? stats.visibleAmount)} />
          <StatCard label="Coverage" value={formatPercent(metadata?.matchedAmountShare)} />
        </section>

        <section className="space-y-2">
          <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground" htmlFor="msp-search">
            Search
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              id="msp-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Facility, city, address"
              className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm outline-none transition-colors focus:border-sky-500"
            />
          </div>
        </section>

        <section className="space-y-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Facility type</div>
          <div className="grid grid-cols-2 gap-1">
            {(['all', 'hospital', 'clinic', 'diagnostic_facility'] as TypeFilter[]).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setTypeFilter(id)}
                aria-pressed={typeFilter === id}
                className={cn(
                  'rounded-md border px-2 py-1.5 text-xs font-medium transition-colors',
                  typeFilter === id
                    ? 'border-sky-500 bg-sky-500/10 text-sky-700'
                    : 'border-border bg-background text-muted-foreground hover:bg-muted',
                )}
              >
                {id === 'all' ? 'All' : TYPE_META[id].label}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-2 border-t border-border pt-4">
          <div className="flex items-center justify-between gap-3 pr-2 text-sm">
            <h2 className="font-semibold">Visible facilities</h2>
            <span className="shrink-0 rounded-md border bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground">{stats.visible}</span>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">{timelinePeriodLabel}</p>
          <div className="space-y-1.5">
            {filteredFacilities.slice(0, 80).map((feature) => (
              <FacilityListButton
                key={feature.properties.id}
                feature={feature}
                amount={periodAmount(feature, selectedFiscalYears)}
                selected={selected?.properties.id === feature.properties.id}
                onSelect={setSelected}
              />
            ))}
          </div>
        </section>
      </div>
    </aside>
  )

  return (
    <MapSectionLayout
      sidebar={sidebar}
      showDesktopSidebar={showSidebar}
      onToggleDesktopSidebar={() => setShowSidebar((value) => !value)}
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
      >
        <MapControls position="top-right" showFullscreen showLocate />
        <ZoomToSelected selected={selected} />
        <div className="absolute left-3 top-3 z-10 rounded-md border border-border bg-background/95 px-3 py-2 text-xs shadow-md backdrop-blur md:left-auto md:right-14">
          <div className="font-semibold text-foreground">BC MSP matched facilities</div>
          <div className="mt-1 text-muted-foreground">{filteredFacilities.length} visible points</div>
          {error && <div className="mt-1 text-red-600">{error}</div>}
        </div>
        <div className="absolute right-3 z-10 hidden rounded-md border border-border bg-background/95 p-3 text-xs shadow-md backdrop-blur md:block md:bottom-[calc(var(--map-timeline-height,0px)+1rem)]">
          <div className="mb-2 font-semibold">Legend</div>
          {(Object.keys(TYPE_META) as PayeeType[]).map((type) => (
            <div key={type} className="flex items-center gap-2 py-0.5">
              <span className={cn('size-3 rounded-full', TYPE_META[type].swatch)} />
              <span>{TYPE_META[type].label} ({stats.byType[type]})</span>
            </div>
          ))}
        </div>
        <MspMarkers facilities={filteredFacilities} selectedYears={selectedFiscalYears} selectedId={selected?.properties.id ?? null} onSelect={setSelected} />
        {selected && <SelectedPanel feature={selected} selectedYears={selectedFiscalYears} periodLabel={timelinePeriodLabel} onClose={() => setSelected(null)} />}
        <Timeline
          startDate={new Date(fiscalYearRange.min, 0, 1)}
          endDate={new Date(fiscalYearRange.max, 0, 1)}
          currentDate={timelineDate}
          onDateChange={setTimelineDate}
          bucketCounts={timelineBucketCounts}
          bucketValueFormatter={formatCurrency}
          bucketValueLabel="MSP payments"
          granularity="year"
          statsLabel={timelineStatsLabel}
          windowMode={{
            size: timelineWindowSize,
            onSizeChange: setTimelineWindowSize,
            anchor: 'end',
            options: [
              { value: 1, label: '1 yr' },
              { value: 3, label: '3 yr' },
              { value: 5, label: '5 yr' },
              { value: -1, label: 'Cumul.' },
            ],
          }}
        />
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
    <div className="absolute left-3 right-3 z-20 rounded-md border border-border bg-background/95 shadow-xl backdrop-blur bottom-[calc(var(--map-timeline-height,0px)+0.75rem)] md:left-auto md:right-4 md:w-[360px]">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase text-muted-foreground">{TYPE_META[props.payeeType].label}</div>
          <h2 className="mt-0.5 text-sm font-semibold leading-5">{props.payeeName}</h2>
          <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="size-3" />
            <span className="truncate">{props.matchedLocality ?? 'BC'}</span>
          </div>
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-1 hover:bg-muted" aria-label="Close details">
          <X className="size-4" />
        </button>
      </div>
      <div className="space-y-3 px-4 py-3">
        <div className="rounded-md border bg-muted/35 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">MSP payments</div>
          <div className="mt-0.5 text-xl font-semibold">{formatCurrency(amount)}</div>
          <div className="mt-1 text-xs text-muted-foreground">{periodLabel}</div>
        </div>
        <div className="grid gap-1.5 text-sm">
          <DetailRow label="Matched location" value={props.matchedName ?? props.payeeName} />
          <DetailRow label="Address" value={props.matchedAddress ?? '--'} />
          <DetailRow label="Health authority" value={props.matchedHealthAuthority ?? '--'} />
          <DetailRow label="Max annual" value={formatCurrency(props.maxAnnualAmount)} />
          <DetailRow label="Average annual" value={formatCurrency(props.averageAnnualAmount)} />
          <DetailRow label="Join method" value={`${props.matchMethod} (${formatPercent(props.matchScore)})`} />
        </div>
      </div>
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
    <button
      type="button"
      onClick={() => onSelect(feature)}
      className={cn(
        'flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left transition-colors',
        selected ? 'border-sky-500 bg-sky-500/10' : 'border-border bg-background hover:bg-muted',
      )}
    >
      <span className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-white', TYPE_META[props.payeeType].swatch)}>
        <Icon className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{props.payeeName}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {[props.matchedLocality, formatCurrency(amount)].filter(Boolean).join(' · ')}
        </span>
      </span>
    </button>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold">{value}</div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-[210px] text-right font-medium">{value}</span>
    </div>
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
  if (value == null || !Number.isFinite(value)) return '--'
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })}b`
  if (value >= 1_000_000) return `$${(value / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}m`
  if (value >= 1_000) return `$${(value / 1_000).toLocaleString(undefined, { maximumFractionDigits: 0 })}k`
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '--'
  return `${(value * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
}

export default DevHealthMsp
